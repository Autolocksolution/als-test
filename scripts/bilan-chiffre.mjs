// Bilan agrégé (totaux par mois, aucun client, aucune note), chiffré avec controle/bilan-cle.pem.
// Temporaire : sert à préparer une analyse de rémunération. Journaux : "OK" uniquement.
import fs from "node:fs";
import crypto from "node:crypto";
import admin from "firebase-admin";
try {
const ROOT = new URL("../", import.meta.url);
const PUB = fs.readFileSync(new URL("controle/bilan-cle.pem", ROOT), "utf8");
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"))) });
const db = admin.firestore();
const FAYRE = /carte\s*fay|fay[cç]|faycal|fayss/i;
const c = e => Math.round((Number(e.amount) || 0) * 100);
const cash = e => e.pay === "especes" ? c(e) : e.pay === "mixte" ? Math.min(c(e), Math.round((Number(e.cash) || 0) * 100)) : 0;
const R = {};
const g = k => R[k] || (R[k] = { rec_moi_bank: 0, rec_moi_cash: 0, rec_fay_bank: 0, rec_fay_cash: 0, n_moi: 0, n_fay: 0, n_abandon: 0, dep: {}, dep_cash: 0, dep_vat: 0, cost_pieces: 0, types: {} });
(await db.collection("entries").get()).forEach(d => {
  const e = d.data(); if (!/^\d{4}-\d{2}/.test(e.date || "")) return;
  const m = g(e.date.slice(0, 7));
  if (e.kind === "recette") {
    if ((e.status || "reussi") !== "reussi") { if (e.status === "abandon") m.n_abandon++; return; }
    const w = (e.fay || FAYRE.test(e.note || "")) ? "fay" : "moi";
    m["rec_" + w + "_cash"] += cash(e); m["rec_" + w + "_bank"] += c(e) - cash(e); m["n_" + w]++;
    if (e.cost != null && e.cost !== "") m.cost_pieces += Math.round((Number(String(e.cost).replace(",", ".")) || 0) * 100);
    const t = e.type || "autre"; m.types[t] = (m.types[t] || 0) + 1;
  } else if (e.kind === "depense") {
    const k = e.cat || "divers"; m.dep[k] = (m.dep[k] || 0) + c(e); m.dep_cash += cash(e);
    if (e.vat != null && e.vat !== "") m.dep_vat += Math.round(Number(e.vat) * 100) || 0;
  }
});
let co = {};
try { const x = (await db.doc("meta/company").get()).data() || {}; co = { tvaMode: x.tvaMode || null, legal: x.legal || x.statut || x.forme || null, champs: Object.keys(x) }; } catch (e) {}
const out = { mois: R, entreprise: co, at: new Date().toISOString() };
const key = crypto.randomBytes(32), iv = crypto.randomBytes(12), ci = crypto.createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([ci.update(JSON.stringify(out), "utf8"), ci.final()]);
const k = crypto.publicEncrypt({ key: PUB, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key);
fs.writeFileSync(new URL("controle/bilan.enc.json", ROOT), JSON.stringify({ k: k.toString("base64"), iv: iv.toString("base64"), ct: ct.toString("base64"), tag: ci.getAuthTag().toString("base64") }));
await admin.app().delete().catch(() => {});
console.log("OK");
} catch (e) { console.log("ECHEC"); process.exit(1); }
