// Envoie les rappels de planning par notification (FCM). Lancé par GitHub Actions.
import fs from "node:fs";
import admin from "firebase-admin";
import { parisNow, addDays, due, planOutbox } from "./plan.mjs";

const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyFile, "utf8"))) });
const db = admin.firestore(), fcm = admin.messaging();
const MODE = process.env.MODE || "normal";

const devices = (await db.collection("devices").get()).docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.token);
console.log(`${devices.length} appareil(s) enregistré(s)`);

async function broadcast(n, only) {
  let ok = 0, gone = 0, err = 0;
  const list = only ? devices.filter(d => only.includes(d.id)) : devices;
  await Promise.all(list.map(async d => {
    try {
      await fcm.send({
        token: d.token,
        data: { title: n.title, body: n.body, tag: n.tag || "", url: "./app.html" },
        webpush: { headers: { Urgency: "high", TTL: "3600" } },
      });
      ok++;
    } catch (e) {
      const c = e && e.code || "";
      if (c.includes("registration-token-not-registered") || c.includes("invalid-argument") || c.includes("invalid-registration-token")) {
        gone++; await db.collection("devices").doc(d.id).delete().catch(() => {});
      } else { err++; console.error("envoi échoué:", c, e && e.message); }
    }
  }));
  console.log(`« ${n.title} » : ${ok} envoyée(s), ${gone} appareil(s) obsolète(s) retiré(s), ${err} erreur(s)`);
  return { ok, gone, err };
}

if (MODE === "test") {
  if (!devices.length) { console.log("Aucun appareil : activez d'abord les notifications dans l'appli (Réglages)."); process.exit(0); }
  const r = await broadcast({ title: "Test AutoLockSolution", body: "Les notifications du planning fonctionnent.", tag: "test" });
  process.exit(r.ok ? 0 : 1);
}

const now = parisNow();
const days = [now.date, addDays(now.date, 1)];
const rdvs = (await db.collection("rdv").where("date", "in", days).get()).docs.map(d => ({ id: d.id, ...d.data() }));
const sentSnap = await db.collection("notified").where("day", "in", days).get();
const sent = new Set(sentSnap.docs.map(d => d.id));
const todo = devices.length ? due(rdvs, now, sent) : [];
console.log(`Paris ${now.date} ${Math.floor(now.minutes / 60)}h${String(now.minutes % 60).padStart(2, "0")} · ${rdvs.length} RDV · ${todo.length} notification(s) à envoyer`);

for (const n of todo) {
  const ref = db.collection("notified").doc(n.key);
  try { await ref.create({ day: n.key.startsWith("day_") ? n.key.slice(4) : (rdvs.find(r => n.key.startsWith("rem_" + r.id + "_")) || {}).date || now.date, at: Date.now() }); }
  catch (e) { console.log("déjà envoyée:", n.key); continue; }
  const r = await broadcast(n);
  if (!r.ok && r.err) await ref.delete().catch(() => {});
}

// Messages envoyés par l'appli (stock bas, changements faits par l'associé…)
const ob = (await db.collection("outbox").where("sent", "==", false).limit(60).get()).docs.map(d => ({ id: d.id, ...d.data() }));
if (ob.length) {
  const { sends, skip } = planOutbox(ob, devices, Date.now());
  console.log(`${ob.length} message(s) de l'appli · ${sends.length} à envoyer`);
  const mark = id => db.collection("outbox").doc(id).update({ sent: true, sentAt: Date.now() }).catch(() => {});
  await Promise.all(skip.map(mark));
  for (const m of sends) {
    await Promise.all([m.id, ...(m.also || [])].map(mark));
    if (m.deviceIds.length) await broadcast({ title: m.title, body: m.body, tag: m.tag }, m.deviceIds);
  }
}
// ménage : messages envoyés depuis plus de 3 jours
try {
  const old = await db.collection("outbox").where("sentAt", "<", Date.now() - 3 * 86400e3).limit(100).get();
  await Promise.all(old.docs.map(d => d.ref.delete()));
} catch (e) { console.log("ménage ignoré:", e.message); }
