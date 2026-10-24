// Import chiffré de dépenses (tickets, factures) dans Firestore, collection entries.
// Le dépôt est public : les dépenses n'y transitent que chiffrées.
//   mode "cle"    : crée une paire RSA ; la clé privée va dans Firestore (importkeys/current,
//                   illisible par l'appli : collection hors liste des règles) ; la clé publique
//                   est écrite dans depenses/cle-publique.pem.
//   mode "import" : déchiffre depenses/lot.enc.json avec la clé privée, vérifie chaque dépense,
//                   les crée sans jamais écraser l'existant (sauf liste REMPLACE), relit pour
//                   vérifier, puis détruit la clé privée.
// Journaux publics : seulement des nombres d'opérations, jamais de contenu.
import fs from "node:fs";
import crypto from "node:crypto";

const MODE = process.env.MODE;
const ROOT = new URL("../depenses/", import.meta.url);
const REMPLACE = new Set(["tk-cb-20260820-tridome-21900"]); // version complétée d'une ligne déjà importée

export function valide(e) {
  const ok = e && typeof e === "object"
    && typeof e.id === "string" && /^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(e.id)
    && e.kind === "depense" && ["essence", "achat", "divers"].includes(e.cat)
    && typeof e.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.date)
    && typeof e.amount === "number" && e.amount >= 0 && e.amount < 100000
    && (e.vat === null || (typeof e.vat === "number" && e.vat >= 0 && e.vat <= e.amount))
    && ["carte", "especes"].includes(e.pay)
    && typeof e.label === "string" && e.label.length <= 300
    && (e.litres === null || (typeof e.litres === "number" && e.litres > 0 && e.litres < 500))
    && typeof e.at === "number";
  if (!ok) throw new Error("dépense invalide : " + String(e && e.id).slice(0, 60));
  const { id, ...r } = e;
  return { id, data: { kind: r.kind, cat: r.cat, date: r.date, amount: r.amount, vat: r.vat, pay: r.pay, label: r.label,
    litres: r.litres ?? null, odo: null, full: null, at: r.at, src: typeof r.src === "string" ? r.src.slice(0, 40) : "import" } };
}

// Enveloppe : { k: clé AES chiffrée RSA-OAEP-SHA256, iv, ct, tag } (base64), contenu = liste JSON de dépenses.
export function scelleLot(liste, publicPem) {
  const aesKey = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(liste), "utf8"), c.final()]);
  const k = crypto.publicEncrypt({ key: publicPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, aesKey);
  return JSON.stringify({ v: 1, k: k.toString("base64"), iv: iv.toString("base64"), ct: ct.toString("base64"), tag: c.getAuthTag().toString("base64") });
}
export function ouvreLot(texte, privatePem) {
  const env = JSON.parse(texte);
  const aesKey = crypto.privateDecrypt({ key: privatePem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(env.k, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", aesKey, Buffer.from(env.iv, "base64"));
  d.setAuthTag(Buffer.from(env.tag, "base64"));
  const liste = JSON.parse(Buffer.concat([d.update(Buffer.from(env.ct, "base64")), d.final()]).toString("utf8"));
  if (!Array.isArray(liste) || liste.length === 0 || liste.length > 1000) throw new Error("lot vide ou trop grand");
  const lot = liste.map(valide);
  if (new Set(lot.map(x => x.id)).size !== lot.length) throw new Error("identifiants en double dans le lot");
  return lot;
}

async function init() {
  const admin = (await import("firebase-admin")).default;
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"))) });
  return admin.firestore();
}

async function cle() {
  const db = await init();
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 4096,
    publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  await db.doc("importkeys/current").set({ k: privateKey, at: Date.now() });
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(new URL("cle-publique.pem", ROOT), publicKey);
  console.log("Clé d'import créée");
}

// Doublons probables : une dépense déjà présente AVANT l'import, le même jour, au même montant à 1 € près.
// Chaque dépense existante ne peut écarter qu'une seule ligne du lot (la plus proche en montant).
export function doublons(lot, existantes) {
  // paires possibles, des plus proches aux plus éloignées : une égalité au centime passe toujours en premier
  const paires = [];
  lot.forEach((l, i) => existantes.forEach((x, j) => {
    const d = Math.abs(x.amount - l.data.amount);
    if (x.date === l.data.date && d <= 1.0001) paires.push({ i, j, d });
  }));
  paires.sort((a, b) => a.d - b.d);
  const prisL = new Set(), prisX = new Set(), ecartes = new Map();
  for (const { i, j } of paires) {
    if (prisL.has(i) || prisX.has(j)) continue;
    prisL.add(i); prisX.add(j);
    const { id, data } = lot[i], x = existantes[j];
    ecartes.set(id, { id, date: data.date, amount: data.amount, label: data.label, deja: { amount: x.amount, label: x.label } });
  }
  return ecartes;
}

async function importe() {
  const db = await init();
  const snap = await db.doc("importkeys/current").get();
  if (!snap.exists) throw new Error("clé d'import absente");
  const lot = ouvreLot(fs.readFileSync(new URL("lot.enc.json", ROOT), "utf8"), snap.get("k"));
  const idsLot = new Set(lot.map(x => x.id));
  const existantes = [];
  for (const date of new Set(lot.map(x => x.data.date))) {
    const q = await db.collection("entries").where("date", "==", date).get();
    q.forEach(d => { const v = d.data(); if (v.kind === "depense" && !idsLot.has(d.id) && typeof v.amount === "number") existantes.push({ date, amount: v.amount, label: String(v.label || "") }); });
  }
  const ecartes = doublons(lot, existantes);
  let crees = 0, deja = 0, remplaces = 0;
  const ecrits = [];
  for (const { id, data } of lot) {
    if (ecartes.has(id)) continue;
    const ref = db.collection("entries").doc(id);
    if (REMPLACE.has(id)) { await ref.set(data); remplaces++; ecrits.push({ id, data }); continue; }
    try { await ref.create(data); crees++; ecrits.push({ id, data }); }
    catch (e) { if (e && (e.code === 6 || /ALREADY_EXISTS/.test(e.message || ""))) deja++; else throw e; }
  }
  // relecture : chaque dépense doit exister avec le bon montant
  let ko = 0;
  for (const { id, data } of ecrits) {
    const s = await db.collection("entries").doc(id).get();
    if (!s.exists || Math.round(s.get("amount") * 100) !== Math.round(data.amount * 100) || s.get("date") !== data.date) ko++;
  }
  await db.doc("importkeys/current").delete();
  // rapport des doublons écartés, chiffré pour la personne qui a préparé le lot (jamais en clair dans le dépôt)
  const rk = new URL("rapport-cle.pem", ROOT);
  if (fs.existsSync(rk)) fs.writeFileSync(new URL("rapport.enc.json", ROOT), scelleLot([...ecartes.values(), { fin: true, crees, deja }], fs.readFileSync(rk, "utf8")));
  console.log(`Import : ${crees} créées, ${deja} déjà présentes, ${ecartes.size} doublon(s) probable(s) écarté(s), ${remplaces} complétée(s), ${ko} anomalie(s). Clé détruite.`);
  if (ko) process.exit(1);
}

if (MODE === "cle") await cle();
else if (MODE === "import") await importe();
else if (MODE) { console.error("MODE inconnu"); process.exit(2); }
