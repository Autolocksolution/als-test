// Diagnostic (journal public : uniquement des nombres et des prénoms, aucun montant ni client).
// Compte les interventions des 60 derniers jours par personne qui les a saisies, et repère celles
// qui ne peuvent pas s'afficher (date mal formée, type manquant, montant illisible).
import fs from "node:fs";
import admin from "firebase-admin";
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"))) });
const db = admin.firestore();
const noms = {};
(await db.collection("outbox").get()).forEach(d => { const v = d.data(); if (v.by && v.byName) noms[v.by] = String(v.byName).split(" ")[0]; });
const lim = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
const par = {}, bad = { date: 0, kind: 0, amount: 0, futur: 0 };
let total = 0;
const an = new Date().getFullYear();
(await db.collection("entries").get()).forEach(d => {
  const e = d.data();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || "")) { bad.date++; return; }
  if (e.kind !== "recette" && e.kind !== "depense") { bad.kind++; return; }
  if (typeof e.amount !== "number" || !(e.amount >= 0)) bad.amount++;
  if (+e.date.slice(0, 4) > an || +e.date.slice(0, 4) < 2000) bad.futur++;
  if (e.date < lim) return;
  total++;
  const qui = e.by ? (noms[e.by] || "inconnu-" + Object.keys(par).length) : (e.src ? "import" : "sans auteur");
  const k = `${qui} · ${e.kind} · ${e.kind === "recette" ? (e.status || "sans statut") + (e.fay || /fay/i.test(e.note || "") ? " · marqué Fayss" : "") : e.cat || ""} · ${e.pay || "?"}`;
  par[k] = (par[k] || 0) + 1;
});
console.log(`::notice::Diagnostic : ${total} lignes depuis ${lim} ; anomalies date=${bad.date} type=${bad.kind} montant=${bad.amount} année hors limites=${bad.futur}`);
for (const [k, n] of Object.entries(par).sort()) console.log(`::notice::${n} × ${k}`);
// toutes les collections : documents modifiés ces 30 derniers jours, par auteur
const depuis = Date.now() - 30 * 864e5, auteurs = {};
for (const c of await db.listCollections()) {
  if (["photos", "importkeys"].includes(c.id)) continue;
  const s = await c.get();
  s.forEach(d => { const v = d.data(); const t = typeof v.at === "number" ? v.at : 0; if (t < depuis) return;
    const qui = v.by ? (noms[v.by] || "compte " + v.by.slice(0, 4)) : "sans auteur";
    const k = `${c.id} · ${qui}`; auteurs[k] = (auteurs[k] || 0) + 1; });
}
for (const [k, n] of Object.entries(auteurs).sort()) console.log(`::notice::30 j : ${n} × ${k}`);
console.log(`::notice::Prénoms connus : ${[...new Set(Object.values(noms))].join(", ") || "aucun"}`);
