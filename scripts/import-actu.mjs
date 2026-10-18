// Ajoute les actus des fichiers actu/*.json dans Firestore (collection news).
// N'écrase jamais un document existant : l'état « gardée / masquée » reste intact.
import fs from "node:fs";
import path from "node:path";
import admin from "firebase-admin";
import { parseFile } from "./actu-lib.mjs";

const dir = new URL("../actu/", import.meta.url);
const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort();
const all = [];
for (const f of files) all.push(...parseFile(fs.readFileSync(new URL(f, dir), "utf8")));

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"))) });
const db = admin.firestore();
let added = 0, kept = 0;
for (const { id, data } of all) {
  try { await db.collection("news").doc(id).create(data); added++; }
  catch (e) { if (e && (e.code === 6 || /ALREADY_EXISTS/.test(e.message || ""))) kept++; else throw e; }
}
console.log(`${files.length} fichier(s) : ${added} actu(s) ajoutée(s), ${kept} déjà présente(s)`);
