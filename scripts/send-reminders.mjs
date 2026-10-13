// Envoie les rappels de planning par notification (FCM). Lancé par GitHub Actions.
import fs from "node:fs";
import admin from "firebase-admin";
import { parisNow, addDays, due } from "./plan.mjs";

const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyFile, "utf8"))) });
const db = admin.firestore(), fcm = admin.messaging();
const MODE = process.env.MODE || "normal";

const devices = (await db.collection("devices").get()).docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.token);
console.log(`${devices.length} appareil(s) enregistré(s)`);

async function broadcast(n) {
  let ok = 0, gone = 0, err = 0;
  await Promise.all(devices.map(async d => {
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

if (!devices.length) process.exit(0);
const now = parisNow();
const days = [now.date, addDays(now.date, 1)];
const rdvs = (await db.collection("rdv").where("date", "in", days).get()).docs.map(d => ({ id: d.id, ...d.data() }));
const sentSnap = await db.collection("notified").where("day", "in", days).get();
const sent = new Set(sentSnap.docs.map(d => d.id));
const todo = due(rdvs, now, sent);
console.log(`Paris ${now.date} ${Math.floor(now.minutes / 60)}h${String(now.minutes % 60).padStart(2, "0")} · ${rdvs.length} RDV · ${todo.length} notification(s) à envoyer`);

for (const n of todo) {
  const ref = db.collection("notified").doc(n.key);
  try { await ref.create({ day: n.key.startsWith("day_") ? n.key.slice(4) : (rdvs.find(r => n.key.startsWith("rem_" + r.id + "_")) || {}).date || now.date, at: Date.now() }); }
  catch (e) { console.log("déjà envoyée:", n.key); continue; }
  const r = await broadcast(n);
  if (!r.ok && r.err) await ref.delete().catch(() => {});
}
