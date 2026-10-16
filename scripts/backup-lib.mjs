// Sauvegarde automatique : logique pure (aucune dépendance à firebase-admin, testable sans accès à la base).
// Contrat de chiffrement partagé avec l'appli (ne pas modifier sans mettre l'appli à jour) :
//   clé   = 32 octets aléatoires, base64 standard, dans Firestore bkey/main { k, at }
//   fichier .alsbk = "ALSBK1" (6 octets ASCII) + IV (12 octets) + texte chiffré + tag GCM (16 octets)
//   algorithme = AES-256-GCM, sans données associées ; texte clair = JSON UTF-8.
//   Côté navigateur : crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, cle, octets[18..fin]).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const COLLECTIONS = ["items", "entries", "ideas", "codes", "photos", "clients", "docs", "orders", "vehicles", "rdv", "news", "meta"];
export const MAGIC = Buffer.from("ALSBK1", "ascii");
export const IV_LEN = 12, TAG_LEN = 16, KEY_LEN = 32;
const HEAD = MAGIC.length + IV_LEN;
// Petites pages pour les photos (jusqu'à ~900 Ko par document) ; le reste est léger.
const PAGE = { photos: 25 };
const DEFAULT_PAGE = 300;

// Date du jour à Paris, AAAA-MM-JJ.
export function parisDate(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export const backupFileName = date => `sauvegarde-auto-${date}.alsbk`;

// Valeurs Firestore -> JSON : Timestamp -> millisecondes, octets -> base64, référence -> chemin, GeoPoint -> {latitude, longitude}.
export function toPlain(v) {
  if (v === null || typeof v !== "object") return v;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Uint8Array) return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
  if (Array.isArray(v)) return v.map(toPlain);
  if (typeof v.path === "string" && typeof v.collection === "function" && v.firestore) return v.path;
  if (typeof v.latitude === "number" && typeof v.longitude === "number" && typeof v.isEqual === "function") return { latitude: v.latitude, longitude: v.longitude };
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = toPlain(x);
  return o;
}

export function buildBackup(collections, now = new Date()) {
  const cols = {};
  for (const c of COLLECTIONS) cols[c] = Array.isArray(collections[c]) ? collections[c] : [];
  return { app: "AutoLockSolution", format: 1, at: now.toISOString(), auto: true, collections: cols };
}

export function countDocs(backup) {
  const out = {};
  for (const c of COLLECTIONS) out[c] = Array.isArray(backup?.collections?.[c]) ? backup.collections[c].length : -1;
  return out;
}
// Nombre affiché par l'appli : tout sauf photos et meta.
export const businessCount = counts => COLLECTIONS.filter(c => c !== "photos" && c !== "meta").reduce((s, c) => s + Math.max(0, counts[c] || 0), 0);

// Clé base64 -> 32 octets. Tolère espaces / retours à la ligne d'un copier-coller.
export function parseKey(b64) {
  const s = String(b64 ?? "").replace(/\s+/g, "");
  if (!s) throw new Error("Clé absente");
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) throw new Error("Clé invalide : caractères non base64");
  const k = Buffer.from(s, "base64");
  if (k.length !== KEY_LEN) throw new Error(`Clé invalide : ${k.length} octets au lieu de ${KEY_LEN} (attendu : 44 caractères base64)`);
  return k;
}

export function encrypt(plain, key, iv = crypto.randomBytes(IV_LEN)) {
  if (key.length !== KEY_LEN || iv.length !== IV_LEN) throw new Error("Paramètres de chiffrement invalides");
  const c = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LEN });
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, ct, c.getAuthTag()]);
}

export function decrypt(file, key) {
  if (!Buffer.isBuffer(file) || file.length < HEAD + TAG_LEN) throw new Error("Fichier trop court : ce n'est pas une sauvegarde complète");
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Ce fichier n'est pas une sauvegarde chiffrée AutoLockSolution (en-tête ALSBK1 absent)");
  const iv = file.subarray(MAGIC.length, HEAD), tag = file.subarray(file.length - TAG_LEN), ct = file.subarray(HEAD, file.length - TAG_LEN);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LEN });
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(ct), d.final()]); }
  catch (e) { throw new Error("Déchiffrement impossible : mauvaise clé, ou fichier abîmé / modifié"); }
}

// Lit bkey/main ; la crée (create() : deux exécutions simultanées ne peuvent pas écraser la clé) si elle n'existe pas.
export async function getOrCreateKey(db, log = () => {}) {
  const ref = db.collection("bkey").doc("main");
  const read = async () => {
    const snap = await ref.get();
    if (!snap.exists) return null;
    try { return parseKey(snap.data()?.k); }
    catch (e) { throw new Error("bkey/main existe mais sa clé est inutilisable (" + e.message + ") : elle n'est PAS remplacée automatiquement, sinon les anciennes sauvegardes deviendraient illisibles"); }
  };
  const existing = await read();
  if (existing) { log("Clé de chiffrement : existante (bkey/main)"); return existing; }
  const k = crypto.randomBytes(KEY_LEN);
  try {
    await ref.create({ k: k.toString("base64"), at: Date.now() });
    log("Clé de chiffrement : NOUVELLE clé créée dans bkey/main. Copiez-la hors de Firebase (gestionnaire de mots de passe) : sans elle, les sauvegardes sont illisibles.");
    return k;
  } catch (e) {
    const already = e && (e.code === 6 || e.code === "already-exists" || /ALREADY_EXISTS/i.test(String(e.message)));
    if (!already) throw e;
    const other = await read();
    if (!other) throw new Error("bkey/main : création refusée mais document introuvable");
    log("Clé de chiffrement : créée en parallèle par une autre exécution, réutilisée");
    return other;
  }
}

// Lit tous les documents (premier niveau) d'une collection, par pages triées par identifiant.
export async function readCollection(db, name, docIdField, pageSize = PAGE[name] || DEFAULT_PAGE) {
  const out = [];
  let last = null;
  for (;;) {
    let q = db.collection(name).orderBy(docIdField).limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const d of snap.docs) out.push({ id: d.id, ...toPlain(d.data()) });
    if (snap.docs.length < pageSize) return out;
    last = snap.docs[snap.docs.length - 1];
  }
}

const sha = b => crypto.createHash("sha256").update(b).digest("hex");

// Sauvegarde complète. Le JSON en clair reste en mémoire ; seul le fichier chiffré est écrit.
// Journaux PUBLICS : aucun contenu, aucune clé, et aucun volume (ni nombre de documents, ni taille).
// Les nombres restent dans le fichier chiffré et dans meta/backup (privé).
export async function runBackup({ db, docIdField, outDir, now = new Date(), log = console.log, warn = console.log,
  writeFile = fs.writeFileSync, readFile = fs.readFileSync, pageSize } = {}) {
  if (!db || !docIdField || !outDir) throw new Error("runBackup : db, docIdField et outDir sont requis");
  const collections = {};
  for (const c of COLLECTIONS) collections[c] = await readCollection(db, c, docIdField, pageSize);
  const backup = buildBackup(collections, now);
  const counts = countDocs(backup);
  const total = COLLECTIONS.reduce((s, c) => s + counts[c], 0);
  const n = businessCount(counts);
  if (!n) throw new Error("Aucune donnée métier lue (base vide ou mauvais projet) : sauvegarde annulée");
  const prev = collections.meta.find(d => d.id === "backup");
  if (prev && prev.by === "auto" && prev.n >= 20 && n < prev.n / 2) warn("::warning::Forte baisse du nombre de documents depuis la dernière sauvegarde automatique (plus de la moitié en moins) : vérifiez les données dans l'appli");

  // Clé lue (ou créée) seulement une fois les données lues : pas de clé créée dans une base vide / un mauvais projet.
  const key = await getOrCreateKey(db, log);
  const plain = Buffer.from(JSON.stringify(backup), "utf8");
  const enc = encrypt(plain, key);
  const date = parisDate(now), name = backupFileName(date), file = path.join(outDir, name);
  fs.mkdirSync(outDir, { recursive: true });
  writeFile(file, enc, { mode: 0o600 });

  // Auto-contrôle : relire le fichier, déchiffrer, comparer.
  try {
    const back = decrypt(readFile(file), key);
    if (sha(back) !== sha(plain)) throw new Error("contenu relu différent du contenu chiffré");
    const parsed = JSON.parse(back.toString("utf8"));
    if (parsed.app !== "AutoLockSolution" || parsed.format !== 1 || parsed.auto !== true) throw new Error("en-tête JSON inattendu");
    const got = countDocs(parsed);
    const bad = COLLECTIONS.filter(c => got[c] !== counts[c]);
    if (bad.length) throw new Error("nombre de documents différent pour : " + bad.join(", "));
  } catch (e) {
    try { fs.unlinkSync(file); } catch (_) {}
    throw new Error("Auto-contrôle de la sauvegarde ÉCHOUÉ : " + e.message);
  }

  await db.collection("meta").doc("backup").set({ at: Date.now(), by: "auto", n });
  log(`Sauvegarde OK : ${name} (auto-contrôle réussi)`);
  return { file, name, date, bytes: enc.length, plainBytes: plain.length, total, n, counts };
}
