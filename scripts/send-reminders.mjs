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

async function cleanup() {       // ménage : messages envoyés depuis plus de 3 jours
  try {
    const old = await db.collection("outbox").where("sentAt", "<", Date.now() - 3 * 86400e3).limit(100).get();
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
  report();
  process.exit(code);
}

for (const d of (await db.collection("notified").where("day", ">=", today).get()).docs) sent.add(d.id);
await Promise.all([
  listen(db.collection("devices"), loadDevices),
  listen(db.collection("rdv").where("date", ">=", today), snap => { rdvs = docs(snap); }),
  listen(db.collection("outbox").where("sent", "==", false), snap => { outbox = docs(snap); }),
]);
await pass();
say(said || "Rappels du planning : rien à envoyer");
await cleanup();

if (!RUN_MIN) await finish(0);

// Témoin de fonctionnement, lu par l'appli (Réglages > Notifications).
const beat = () => db.doc("meta/robot").set({ at: Date.now() }).catch(() => {});
await beat();
console.log("Robot à l'écoute");
const t0 = Date.now();
setInterval(pass, TICK_MS);
setInterval(beat, BEAT_MS);
setInterval(() => { if (Date.now() - t0 >= RUN_MIN * 60000) finish(0); }, 5000);
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => finish(0));
