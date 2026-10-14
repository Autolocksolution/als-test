// Ajoute les actus de actu/import.json dans Firestore (collection news).
// N'écrase jamais un document existant (l'état « gardée / masquée » reste intact).
import fs from "node:fs";
import admin from "firebase-admin";

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"))) });
const db = admin.firestore();
const items = JSON.parse(fs.readFileSync(new URL("../actu/import.json", import.meta.url), "utf8"));
let added = 0, kept = 0;
for (const it of items) {
  const { id, ...data } = it;
  try { await db.collection("news").doc(id).create(data); added++; }
  catch (e) { if (e && (e.code === 6 || /ALREADY_EXISTS/.test(e.message || ""))) kept++; else throw e; }
}
console.log(`${added} actu(s) ajoutée(s), ${kept} déjà présente(s)`);
