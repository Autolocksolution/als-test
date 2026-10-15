// Sauvegarde automatique chiffrée de Firestore (lancée chaque nuit par GitHub Actions, dépôt PUBLIC).
// Journaux : uniquement des nombres et des tailles. Jamais de contenu, jamais la clé.
import fs from "node:fs";
import admin from "firebase-admin";
import { runBackup } from "./backup-lib.mjs";

const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const outDir = process.env.OUT_DIR || ".";
try {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyFile, "utf8"))) });
} catch (e) {
  // Ne pas afficher e.message : il pourrait citer un extrait du fichier de compte de service.
  console.error("Compte de service illisible (GOOGLE_APPLICATION_CREDENTIALS)");
  process.exit(1);
}

try {
  const r = await runBackup({ db: admin.firestore(), docIdField: admin.firestore.FieldPath.documentId(), outDir });
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `date=${r.date}\nfile=${r.file}\n`);
} catch (e) {
  console.error("Sauvegarde échouée :", (e && e.code ? `[${e.code}] ` : "") + String(e && e.message || e).slice(0, 300));
  process.exitCode = 1;
} finally {
  await admin.app().delete().catch(() => {});
}
