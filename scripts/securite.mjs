// Sondes de sécurité (lecture seule sauf test d'inscription, annulé aussitôt). Sortie : ../securite.json (aucune donnée personnelle).
import fs from "node:fs";
import admin from "firebase-admin";
const PROJECT = "autlocksolution", KEY = "AIzaSyCAnJg9b_5_eRs8F3Li36FX7kevmiUZbq4";
const out = { at: new Date().toISOString(), probes: {} };
const probe = async (name, fn) => { try { out.probes[name] = await fn(); } catch (e) { out.probes[name] = { error: String(e).slice(0, 120) }; } };
const st = async (url, opt = {}) => { const r = await fetch(url, opt); let b = ""; try { b = (await r.text()).slice(0, 160).replace(/\s+/g, " "); } catch (e) {} return { status: r.status, body: b }; };
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
await probe("firestore_lecture_sans_compte", () => st(`${FS}/items?pageSize=1`));
await probe("firestore_ecriture_sans_compte", () => st(`${FS}/zz_probe?documentId=x`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fields: { a: { stringValue: "x" } } }) }));
await probe("storage_lecture_sans_compte", () => st(`https://firebasestorage.googleapis.com/v0/b/${PROJECT}.appspot.com/o?maxResults=1`));
await probe("realtime_db_sans_compte", () => st(`https://${PROJECT}-default-rtdb.firebaseio.com/.json?shallow=true`));
const IT = `https://identitytoolkit.googleapis.com/v1/accounts`;
const signUp = body => st(`${IT}:signUp?key=${KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const mail = "probe-" + Date.now() + "@example.invalid";
await probe("inscription_email_ouverte", () => signUp({ email: mail, password: "Pr0be-" + Date.now() + "Zz!", returnSecureToken: true }));
await probe("inscription_anonyme_ouverte", () => signUp({ returnSecureToken: true }));
await probe("cle_api_sans_referer", () => st(`${IT}:lookup?key=${KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: "x" }) }));
await probe("cle_api_referer_legitime", () => st(`${IT}:lookup?key=${KEY}`, { method: "POST", headers: { "content-type": "application/json", referer: "https://autolocksolution.github.io/" }, body: JSON.stringify({ idToken: "x" }) }));
await probe("cle_api_referer_pirate", () => st(`${IT}:lookup?key=${KEY}`, { method: "POST", headers: { "content-type": "application/json", referer: "https://evil.example/" }, body: JSON.stringify({ idToken: "x" }) }));
await probe("fournisseurs_connexion", () => st(`${IT}:createAuthUri?key=${KEY}`, { method: "POST", headers: { "content-type": "application/json", referer: "https://autolocksolution.github.io/" }, body: JSON.stringify({ identifier: "nobody@example.invalid", continueUri: "https://autolocksolution.github.io/" }) }));

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"))) });
const mask = e => { if (!e) return "(sans e-mail)"; const [a, d] = e.split("@"); return a.slice(0, 1) + "***@" + (d || "").slice(0, 1) + "***" + (d || "").slice(-4); };
await probe("comptes", async () => {
  const l = await admin.auth().listUsers(1000);
  // supprimer un éventuel compte créé par la sonde d'inscription
  for (const u of l.users) if (u.email && u.email.startsWith("probe-") && u.email.endsWith("@example.invalid")) { await admin.auth().deleteUser(u.uid); out.compte_sonde_supprime = true; }
  const us = (await admin.auth().listUsers(1000)).users;
  return { total: us.length, comptes: us.map(u => ({ id: u.uid.slice(0, 6) + "…", email: mask(u.email), verifie: u.emailVerified, desactive: u.disabled, fournisseurs: u.providerData.map(p => p.providerId), anonyme: u.providerData.length === 0 && !u.email, cree: u.metadata.creationTime, dernierLogin: u.metadata.lastSignInTime, mfa: (u.multiFactor && u.multiFactor.enrolledFactors || []).length })) };
});
await probe("collections", async () => {
  const db = admin.firestore(); const cols = await db.listCollections(); const r = {};
  for (const c of cols) { const s = await c.count().get(); r[c.id] = s.data().count; }
  return r;
});
await probe("regles_actuelles", async () => {
  const rs = await admin.securityRules().getFirestoreRuleset();
  return { name: rs.name, created: rs.createTime, source: rs.source.map(f => f.content).join("\n").slice(0, 600) };
});
fs.writeFileSync("../securite.json", JSON.stringify(out, null, 1));
