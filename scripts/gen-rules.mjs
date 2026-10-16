// Génère firestore.rules (liste des comptes autorisés) et le TESTE sans le publier. Échec = on ne publie pas.
import fs from "node:fs";
import admin from "firebase-admin";
const LOG = [];
for (const k of ["log", "error"]) { const o = console[k].bind(console); console[k] = (...a) => { LOG.push(a.join(" ")); o(...a); }; }
process.on("exit", () => { try { fs.writeFileSync("../regles-rapport.txt", LOG.join("\n")); } catch (e) {} });
const SRC = "../firestore.rules";
const cred = admin.credential.cert(JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8")));
admin.initializeApp({ credential: cred });
const users = (await admin.auth().listUsers(1000)).users.filter(u => !u.disabled);
if (!users.length) { console.error("Aucun compte actif : arrêt (on ne verrouille pas tout le monde)"); process.exit(1); }
const uids = users.map(u => u.uid), member = uids[0], stranger = "inconnu-" + Date.now();
let rules = fs.readFileSync(SRC, "utf8");
if (!rules.includes("__UIDS__")) { console.error("Modèle sans __UIDS__"); process.exit(1); }
rules = rules.replace("__UIDS__", uids.map(u => `'${u}'`).join(", "));
const tok = (await cred.getAccessToken()).access_token;
const doc = (path, auth) => ({ path });
const T = (name, uid, path, op, expect, data) => ({ name, expectation: expect, request: { auth: uid ? { uid, token: {} } : undefined, path: `/databases/(default)/documents/${path}`, method: op, resource: data ? { data } : undefined } });
const big = "x".repeat(950000), ok = "data:image/jpeg;base64,AAAA";
const cases = [
  T("membre lit items", member, "items/a", "get", "ALLOW"),
  T("membre écrit items", member, "items/a", "create", "ALLOW", { name: "x", qty: 1 }),
  T("membre écrit entries", member, "entries/a", "create", "ALLOW", { amount: 1 }),
  T("membre lit rdv", member, "rdv/a", "get", "ALLOW"),
  T("membre lit meta", member, "meta/company", "get", "ALLOW"),
  T("membre photo ok", member, "photos/p1", "create", "ALLOW", { d: ok, by: member, at: 1 }),
  T("membre photo trop lourde", member, "photos/p2", "create", "DENY", { d: big }),
  T("membre photo non texte", member, "photos/p3", "create", "DENY", { d: 12 }),
  T("membre sa fiche team", member, `team/${member}`, "create", "ALLOW", { name: "a" }),
  T("membre fiche team d'un autre", member, "team/autre", "create", "DENY", { name: "a" }),
  T("membre appareil à son nom", member, "devices/t1", "create", "ALLOW", { uid: member, token: "t1" }),
  T("membre appareil au nom d'un autre", member, "devices/t2", "create", "DENY", { uid: "autre", token: "t2" }),
  T("membre collection inconnue", member, "pirate/a", "create", "DENY", { a: 1 }),
  T("membre notified (robot seul)", member, "notified/a", "get", "DENY"),
  T("membre lit bkey/main", member, "bkey/main", "get", "ALLOW"),
  T("membre crée bkey/main (robot seul)", member, "bkey/main", "create", "DENY", { k: "x", at: 1 }),
  { ...T("membre modifie bkey/main (robot seul)", member, "bkey/main", "update", "DENY", { k: "x", at: 1 }), resource: { data: { k: "y", at: 0 } } },
  T("membre supprime bkey/main (robot seul)", member, "bkey/main", "delete", "DENY"),
  T("membre crée bkey/autre (robot seul)", member, "bkey/autre", "create", "DENY", { k: "x" }),
  T("inconnu connecté lit bkey/main", stranger, "bkey/main", "get", "DENY"),
  T("sans compte lit bkey/main", null, "bkey/main", "get", "DENY"),
  T("inconnu connecté lit items", stranger, "items/a", "get", "DENY"),
  T("inconnu connecté écrit entries", stranger, "entries/a", "create", "DENY", { amount: 1 }),
  T("inconnu connecté lit photos", stranger, "photos/p1", "get", "DENY"),
  T("sans compte lit items", null, "items/a", "get", "DENY"),
  T("sans compte écrit items", null, "items/a", "create", "DENY", { a: 1 }),
];
const r = await fetch("https://firebaserules.googleapis.com/v1/projects/autlocksolution:test", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + tok }, body: JSON.stringify({ source: { files: [{ name: "firestore.rules", content: rules }] }, testSuite: { testCases: cases.map(c => ({ expectation: c.expectation, request: c.request, ...(c.resource ? { resource: c.resource } : {}) })) } }) });
const j = await r.json();
if (!r.ok) { console.error("Test impossible :", JSON.stringify(j).slice(0, 500)); process.exit(1); }
if (j.issues && j.issues.length) { console.error("Erreurs dans les règles :", JSON.stringify(j.issues)); process.exit(1); }
const res = j.testResults || []; let bad = 0;
res.forEach((t, i) => { const okk = t.state === "SUCCESS"; if (!okk) bad++; console.log((okk ? "OK   " : "ÉCHEC ") + cases[i].name + (okk ? "" : " : " + JSON.stringify(t).slice(0, 200))); });
if (!res.length || bad) { console.error(bad + " test(s) en échec : règles NON publiées"); process.exit(1); }
fs.writeFileSync(SRC, rules);
console.log("Règles générées et testées (" + res.length + " tests réussis)");
