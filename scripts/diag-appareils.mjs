// Diagnostic des notifications et de la vitesse, EN LECTURE SEULE : appareils inscrits, comptes de l'équipe,
// et le relevé technique que chaque appli dépose dans sa fiche (team/{uid}.diag : version, mode, étapes, durées).
// Dépôt public : le rapport est chiffré avec controle/appareils.pem (RSA-OAEP-SHA256 + AES-256-GCM),
// seul le détenteur de la clé privée (hors dépôt) peut le lire. Journaux : le rapport chiffré et "OK". Aucune donnée client.
import fs from "node:fs";
import crypto from "node:crypto";
import admin from "firebase-admin";
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"))) });
const db = admin.firestore();
const R = { at: Date.now() };
const step = async (k, fn) => { try { R[k] = await fn(); } catch (e) { R[k] = { erreur: String(e && e.code || e && e.message || e).slice(0, 200) }; } };
await step("devices", async () => (await db.collection("devices").get()).docs.map(d => { const v = d.data(); return { id: d.id.slice(0, 8), uid: v.uid, ua: v.ua, at: v.at, okAt: v.okAt, errAt: v.errAt, errCode: v.errCode }; }));
await step("team", async () => (await db.collection("team").get()).docs.map(d => { const v = d.data(); return { uid: d.id, name: v.name, diag: v.diag || null }; }));
await step("robot", async () => (await db.doc("meta/robot").get()).data() || null);
await step("users", async () => (await admin.auth().listUsers(50)).users.map(u => ({ uid: u.uid, mail: (u.email || "").slice(0, 3), last: u.metadata.lastSignInTime, refresh: u.metadata.lastRefreshTime })));
await step("tailles", async () => { const o = {}; for (const c of await db.listCollections()) o[c.id] = (await c.count().get()).data().count; return o; });
const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
const c = crypto.createCipheriv("aes-256-gcm", key, iv);
const data = Buffer.concat([c.update(JSON.stringify(R), "utf8"), c.final()]);
const pub = fs.readFileSync(new URL("../controle/appareils.pem", import.meta.url), "utf8");
const k = crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key);
// Rapport chiffré écrit au journal (illisible sans la clé privée) : pas de fichier joint à télécharger.
console.log("RAPPORT " + Buffer.from(JSON.stringify({ k: k.toString("base64"), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), d: data.toString("base64") })).toString("hex"));
console.log("OK");
