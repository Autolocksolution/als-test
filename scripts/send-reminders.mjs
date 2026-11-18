// Envoie les rappels de planning par notification (FCM). Lancé par GitHub Actions.
// Dépôt PUBLIC : les journaux ne contiennent ni contenu (titres, clients), ni volumes (nombres de RDV, d'appareils…).
//
// Fonctionnement : le robot reste à l'écoute de la base pendant RUN_MIN minutes (écoute en temps réel, quasi gratuite
// en lectures). Un message de l'appli (nouveau RDV, stock bas…) part donc en quelques secondes, et le rappel « 1 h avant »
// à la minute près. Avant, il ne passait qu'à chaque déclenchement GitHub : prévu toutes les 10 min, en réalité une fois
// par heure environ, d'où des rappels en retard ou jamais envoyés. RUN_MIN=0 : un seul passage (ancien comportement).
import fs from "node:fs";
import admin from "firebase-admin";
import { parisNow, due, planOutbox } from "./plan.mjs";
import { fileRequest, callClaude, apiMessage, quotaRefus } from "./ia-lib.mjs";

const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyFile, "utf8"))) });
const db = admin.firestore(), fcm = admin.messaging();
const MODE = process.env.MODE || "normal";
const RUN_MIN = Math.max(0, Number(process.env.RUN_MIN || 0));
const TICK_MS = 20000, BEAT_MS = 5 * 60000;

let devices = [];
// Bilan global en fin d'exécution (une ligne par envoi révélerait le volume d'activité).
const STATS = { sent: 0, failed: 0, codes: new Set() };
async function broadcast(n, only) {
  let ok = 0, gone = 0, err = 0;
  const list = only ? devices.filter(d => only.includes(d.id)) : devices;
  await Promise.all(list.map(async d => {
    const ref = db.collection("devices").doc(d.id);
    try {
      await fcm.send({
        token: d.token,
        data: { title: n.title, body: n.body, tag: n.tag || "", url: "./app.html" },
        webpush: { headers: { Urgency: "high", TTL: "3600" } },
      });
      ok++;
      // trace par appareil, affichée dans Réglages : dernier envoi accepté par le service de notification
      await ref.update({ okAt: Date.now(), errAt: admin.firestore.FieldValue.delete(), errCode: admin.firestore.FieldValue.delete() }).catch(() => {});
    } catch (e) {
      const c = e && e.code || "";
      // Seul un jeton réellement périmé est supprimé (l'appli le recrée à l'ouverture suivante).
      // « invalid-argument » peut aussi venir du message lui-même : ne jamais effacer un appareil pour ça.
      if (c.includes("registration-token-not-registered") || c.includes("invalid-registration-token")) {
        gone++; await ref.delete().catch(() => {});
      } else {
        err++; STATS.codes.add(c || "erreur inconnue");
        await ref.update({ errAt: Date.now(), errCode: String(c).slice(0, 80) }).catch(() => {});
      }
    }
  }));
  if (ok) STATS.sent++; if (err) STATS.failed++;
  return { ok, gone, err };
}

function report() {
  if (STATS.failed) console.error("Envois en échec (codes : " + [...STATS.codes].join(", ") + ")");
  console.log(STATS.sent ? "Notifications envoyées" : "Aucune notification envoyée");
}

const loadDevices = snap => { devices = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.token); };

if (MODE === "test") {
  loadDevices(await db.collection("devices").get());
  if (!devices.length) { console.log("Aucun appareil : activez d'abord les notifications dans l'appli (Réglages)."); process.exit(0); }
  const r = await broadcast({ title: "Test AutoLockSolution", body: "Les notifications du planning fonctionnent.", tag: "test" });
  report();
  process.exit(r.ok ? 0 : 1);
}

/* ---------- état, tenu à jour par les écoutes ---------- */
let rdvs = [], outbox = [];
const sent = new Set();          // rappels déjà envoyés (clés), pour ne jamais doubler
let said = "";                   // dernier état écrit au journal (évite une ligne par passage)
const say = t => { if (t !== said) { said = t; console.log(t); } };

async function reminders() {
  const now = parisNow();
  const todo = devices.length ? due(rdvs, now, sent) : [];
  if (todo.length) say("Rappels du planning : envoi en cours");
  for (const n of todo) {
    sent.add(n.key);
    const ref = db.collection("notified").doc(n.key);
    const day = n.key.startsWith("day_") ? n.key.slice(4) : (rdvs.find(r => n.key.startsWith("rem_" + r.id + "_")) || {}).date || now.date;
    try { await ref.create({ day, at: Date.now() }); }
    catch (e) { continue; }      // déjà envoyé par une autre exécution
    const r = await broadcast(n);
    if (!r.ok && r.err) { await ref.delete().catch(() => {}); sent.delete(n.key); }
  }
}

// Messages envoyés par l'appli (nouveau RDV, stock bas, changements faits par l'associé…)
const handled = new Set();
async function messages() {
  const ob = outbox.filter(e => !handled.has(e.id));
  if (!ob.length) return;
  const { sends, skip } = planOutbox(ob, devices, Date.now());
  say("Messages de l'appli : traitement en cours");
  const mark = id => { handled.add(id); return db.collection("outbox").doc(id).update({ sent: true, sentAt: Date.now() }).catch(() => {}); };
  await Promise.all(skip.map(mark));
  for (const m of sends) {
    await Promise.all([m.id, ...(m.also || [])].map(mark));
    if (m.deviceIds.length) await broadcast({ title: m.title, body: m.body, tag: m.tag }, m.deviceIds);
  }
}

/* ---------- Rangement par Claude : demandes déposées par l'appli dans « ia » ---------- */
// Dépôt PUBLIC : on n'écrit jamais au journal le contenu d'une note, seulement des compteurs.
const IA_KEY = process.env.ANTHROPIC_API_KEY || "";
const iaSeen = new Set();
let iaQueue = Promise.resolve(), iaCache = { at: 0, list: [] };
async function iaVehicles(onlyId) {
  if (onlyId) { const d = await db.doc("vehicles/" + onlyId).get(); return d.exists ? [{ id: d.id, ...d.data() }] : []; }
  if (Date.now() - iaCache.at > 10 * 60000) iaCache = { at: Date.now(), list: (await db.collection("vehicles").get()).docs.map(d => ({ id: d.id, ...d.data() })) };
  return iaCache.list;
}
async function iaOne(req) {
  const ref = db.doc("ia/" + req.id);
  const end = (state, extra) => ref.update({ state, doneAt: Date.now(), ...extra }).catch(() => {});
  try {
    // Plafonds : compteurs tenus par le robot seul (collection « iaq », fermée à l'appli), donc impossibles à remettre à zéro
    // en effaçant des demandes. Une demande sans auteur valable est refusée.
    const who = typeof req.by === "string" && req.by ? req.by : "";
    if (!who) return end("err", { msg: "Demande refusée." });
    const iso = new Date().toISOString(), jRef = db.doc("iaq/j-" + iso.slice(0, 10)), mRef = db.doc("iaq/m-" + iso.slice(0, 7));
    const refus = await db.runTransaction(async t => {
      const [j, m] = await Promise.all([t.get(jRef), t.get(mRef)]);
      const jd = j.exists ? j.data() : {}, md = m.exists ? m.data() : {};
      const r = quotaRefus(jd, md, who);
      if (r) return r;
      t.set(jRef, { total: (jd.total || 0) + 1, u: { ...(jd.u || {}), [who]: (((jd.u || {})[who]) || 0) + 1 } });
      t.set(mRef, { total: (md.total || 0) + 1 });
      return "";
    });
    if (refus) { console.log("Rangement : plafond atteint"); return end("err", { msg: refus }); }
    const vehicles = await iaVehicles(req.vehicleId || "");
    const r = await fileRequest(req, {
      vehicles,
      getPhoto: async id => { const d = await db.doc("photos/" + id).get(); return d.exists ? d.data().d : ""; },
      ask: a => callClaude({ key: IA_KEY, ...a }),
    });
    if (r.state !== "done") { console.log("Rangement : demande non aboutie"); return end("err", { msg: r.msg }); }
    // écriture champ par champ : ce qu'une autre personne modifie au même moment ailleurs sur la fiche est conservé
    const up = {};
    for (const k in r.prev.s) up["s." + k] = r.update.s[k];
    for (const k in r.prev.t) up["t." + k] = r.update.t[k];
    for (const k in r.prev.ph) up["ph." + k] = r.update.ph[k];
    if (Object.keys(up).length) { await db.doc("vehicles/" + r.vehicleId).update({ ...up, at: Date.now() }); iaCache.at = 0; }
    console.log("Rangement : fiche " + (Object.keys(up).length ? "complétée" : "déjà à jour"));
    return end("done", { vehicleId: r.vehicleId, label: r.label, changes: r.changes.slice(0, 30), skipped: r.skipped.slice(0, 10), resume: r.resume, prev: r.prev });
  } catch (e) {
    console.error("Rangement en échec :", e && (e.status || e.code) || "erreur");
    return end("err", { msg: e && e.status ? apiMessage(e) : "Le rangement n'a pas abouti : réessayez." });
  }
}
function iaApply(snap) {
  if (!IA_KEY) return;           // pas encore de clé : les notes restent en attente et seront rangées à l'activation
  for (const d of snap.docs) {
    if (iaSeen.has(d.id)) continue; iaSeen.add(d.id);
    const req = { id: d.id, ...d.data() };
    iaQueue = iaQueue.then(() => iaOne(req)).catch(() => {});
  }
}

async function cleanup() {       // ménage : messages envoyés depuis plus de 3 jours
  try {
    const old = await db.collection("outbox").where("sentAt", "<", Date.now() - 3 * 86400e3).limit(100).get();
    await Promise.all(old.docs.map(d => d.ref.delete()));
  } catch (e) { console.log("ménage ignoré :", e.code || "erreur"); }
  try {                          // demandes de rangement de plus de 30 jours
    const old = await db.collection("ia").where("at", "<", Date.now() - 30 * 86400e3).limit(100).get();
    await Promise.all(old.docs.map(d => d.ref.delete()));
  } catch (e) { console.log("ménage ignoré :", e.code || "erreur"); }
  try {                          // traces du journal de plus d'un an
    const old = await db.collection("journal").where("at", "<", Date.now() - 365 * 86400e3).limit(200).get();
    await Promise.all(old.docs.map(d => d.ref.delete()));
  } catch (e) { console.log("ménage ignoré :", e.code || "erreur"); }
}

// Un seul traitement à la fois : les écoutes et l'horloge passent par la même file.
let queue = Promise.resolve();
const pass = () => (queue = queue.then(async () => { await reminders(); await messages(); }).catch(e => { console.error("passage en échec :", e && e.code || "erreur"); }));

/* ---------- démarrage : première lecture de tout, puis écoute ---------- */
const today = parisNow().date;
const stops = [];
function listen(query, apply) {
  return new Promise((ready, fail) => {
    let first = true;
    stops.push(query.onSnapshot(snap => {
      apply(snap);
      if (first) { first = false; ready(); } else pass();
    }, err => {
      console.error("écoute interrompue :", err && err.code || "erreur");
      if (first) fail(err); else finish(1);
    }));
  });
}
const docs = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));

let ending = false;
async function finish(code) {
  if (ending) return; ending = true;
  for (const s of stops) { try { s(); } catch (e) {} }
  await queue.catch(() => {});
  await iaQueue.catch(() => {});
  report();
  process.exit(code);
}

for (const d of (await db.collection("notified").where("day", ">=", today).get()).docs) sent.add(d.id);
await Promise.all([
  listen(db.collection("devices"), loadDevices),
  listen(db.collection("rdv").where("date", ">=", today), snap => { rdvs = docs(snap); }),
  listen(db.collection("outbox").where("sent", "==", false), snap => { outbox = docs(snap); }),
  listen(db.collection("ia").where("state", "==", "new"), iaApply),
]);
await pass();
say(said || "Rappels du planning : rien à envoyer");
await cleanup();

if (!RUN_MIN) await finish(0);

// Témoin de fonctionnement, lu par l'appli (Réglages > Notifications).
const beat = () => db.doc("meta/robot").set({ at: Date.now(), ia: !!IA_KEY }).catch(() => {});   // ia : la clé Claude est en place
await beat();
console.log("Robot à l'écoute");
const t0 = Date.now();
setInterval(pass, TICK_MS);
setInterval(beat, BEAT_MS);
setInterval(() => { if (Date.now() - t0 >= RUN_MIN * 60000) finish(0); }, 5000);
// Clé Claude ajoutée après le démarrage : l'appli demande un redémarrage (meta/robotCmd) pour que le robot la prenne en compte.
// Seulement tant que la clé manque, et jamais avant 10 min de marche (en dessous, GitHub ne relance pas l'exécution suivante).
if (!IA_KEY) stops.push(db.doc("meta/robotCmd").onSnapshot(snap => {
  const at = snap.exists ? Number(snap.data().restart) || 0 : 0;
  if (at > t0) setTimeout(() => finish(0), Math.max(0, t0 + 10.5 * 60000 - Date.now()));
}, () => {}));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => finish(0));
