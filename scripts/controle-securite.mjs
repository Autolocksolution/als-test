// Contrôle de sécurité EN LECTURE SEULE (aucune écriture Firestore, Auth, règles ni IAM).
// Construit un rapport JSON (comptes, règles déployées, collections, activité récente, intégrité du site),
// le chiffre avec controle/cle.pem (RSA-OAEP-SHA256 + AES-256-GCM) et l'écrit dans controle/rapport.enc.json.
// Dépôt public : les journaux n'affichent que "OK". Jamais de données clients dans le rapport
// (seulement identifiants de comptes, e-mails masqués, nombres et dates).
import fs from "node:fs";
import crypto from "node:crypto";

const P = "autlocksolution";
const ROOT = new URL("../", import.meta.url);
const PUB = fs.readFileSync(new URL("controle/cle.pem", ROOT), "utf8");
const OUT = new URL("controle/rapport.enc.json", ROOT);
const SITE = "https://autolocksolution.github.io/als-test/";
const CONNUES = ["items", "entries", "photos", "news", "devices", "outbox", "notified", "team", "meta", "codes", "ideas",
  "clients", "docs", "locks", "orders", "rdv", "vehicles", "bkey", "importkeys"];
const NOW = Date.now(), J14 = NOW - 14 * 86400e3;
const R = { v: 1, at: new Date(NOW).toISOString() };

const msg = e => String((e && e.message) || e).replace(/\s+/g, " ").slice(0, 300);
const masque = m => { if (!m || typeof m !== "string" || !m.includes("@")) return m ? "?" : null; const [a, d] = m.split("@"); return a.slice(0, 1) + "***@" + d; };
const iso = t => (t && typeof t.toDate === "function") ? t.toDate().toISOString() : null;
const ms = t => (t && typeof t.toMillis === "function") ? t.toMillis() : null;
const jour = m => new Date(m).toISOString().slice(0, 10);
const atMs = v => typeof v === "number" ? v : (v && typeof v.toMillis === "function") ? v.toMillis() : (typeof v === "string" && !isNaN(Date.parse(v))) ? Date.parse(v) : null;
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
async function etape(nom, fn) { try { R[nom] = await fn(); } catch (e) { R[nom] = { erreur: msg(e) }; } }
async function parLots(liste, n, fn) { const out = []; for (let i = 0; i < liste.length; i += n) out.push(...await Promise.all(liste.slice(i, i + n).map(fn))); return out; }

try {
const admin = (await import("firebase-admin")).default;
const sa = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
const cred = admin.credential.cert(sa);
admin.initializeApp({ credential: cred });
const db = admin.firestore();
const tok = (await cred.getAccessToken()).access_token;
async function api(url, opt = {}) {
  const r = await fetch(url, { ...opt, headers: { authorization: "Bearer " + tok, "content-type": "application/json", ...(opt.headers || {}) } });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, j, err: r.ok ? null : msg(j && j.error ? (j.error.status || "") + " " + (j.error.message || "") : r.statusText) };
}
R.compte_robot = masque(sa.client_email);

// ---------- Règles déployées ----------
let UIDS = [];
const uidsDe = src => { const m = src.match(/request\.auth\.uid\s+in\s+\[([^\]]*)\]/); return m ? [...m[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map(x => x[1] ?? x[2]) : null; };
await etape("regles", async () => {
  const out = {};
  const rel = await api(`https://firebaserules.googleapis.com/v1/projects/${P}/releases?pageSize=100`);
  out.releases = rel.err ? { status: rel.status, err: rel.err } : (rel.j.releases || []).map(x => ({ name: x.name.split("/releases/")[1], ruleset: x.rulesetName.split("/").pop(), createTime: x.createTime, updateTime: x.updateTime }));
  const fsRel = await api(`https://firebaserules.googleapis.com/v1/projects/${P}/releases/cloud.firestore`);
  if (fsRel.err) { out.firestore = { status: fsRel.status, err: fsRel.err }; return out; }
  const rs = await api(`https://firebaserules.googleapis.com/v1/${fsRel.j.rulesetName}`);
  const src = rs.j.source.files.map(f => f.content).join("\n");
  UIDS = uidsDe(src) || [];
  const modele = fs.readFileSync(new URL("firestore.rules", ROOT), "utf8");
  const remis = UIDS.length ? src.replace(/request\.auth\.uid(\s+)in(\s+)\[[^\]]*\]/, "request.auth.uid$1in$2[__UIDS__]") : src;
  out.firestore = { ruleset: fsRel.j.rulesetName.split("/").pop(), releaseUpdate: fsRel.j.updateTime, rulesetCreate: rs.j.createTime,
    uids: UIDS, sha256: sha(src), identique_au_modele_du_depot: remis.trim() === modele.trim(),
    source_si_different: remis.trim() === modele.trim() ? null : src };
  // historique des jeux de règles (dates et listes de comptes seulement)
  const hist = []; let pt = "";
  for (let i = 0; i < 5; i++) {
    const l = await api(`https://firebaserules.googleapis.com/v1/projects/${P}/rulesets?pageSize=100${pt ? "&pageToken=" + pt : ""}`);
    if (l.err) { hist.push({ status: l.status, err: l.err }); break; }
    for (const x of l.j.rulesets || []) hist.push({ id: x.name.split("/").pop(), createTime: x.createTime });
    pt = l.j.nextPageToken; if (!pt) break;
  }
  await parLots(hist.filter(h => h.id).slice(0, 60), 5, async h => {
    const d = await api(`https://firebaserules.googleapis.com/v1/projects/${P}/rulesets/${h.id}`);
    if (d.err) { h.err = d.status; return; }
    const s = d.j.source.files.map(f => f.content).join("\n");
    h.uids = uidsDe(s); h.sha256 = sha(s).slice(0, 16); h.fichiers = d.j.source.files.map(f => f.name);
  });
  out.historique = hist;
  return out;
});
const lib = u => typeof u === "string" && UIDS.includes(u) ? "LEGIT:" + u.slice(0, 6) : null;
const auteur = v => {
  if (v === undefined || v === null || v === "") return "(aucun)";
  const l = lib(v); if (l) return l;
  if (typeof v === "string" && /^[a-z][a-z0-9_-]{0,19}$/.test(v)) return "robot:" + v;
  return "INCONNU:" + (typeof v === "string" ? `len${v.length}:` : typeof v + ":") + sha(String(v)).slice(0, 10);
};

// ---------- Auth ----------
await etape("auth", async () => {
  const users = []; let pt;
  do { const r = await admin.auth().listUsers(1000, pt); users.push(...r.users); pt = r.pageToken; } while (pt);
  const liste = users.map(u => ({ uid: u.uid, email: masque(u.email), emailVerified: u.emailVerified, disabled: u.disabled,
    creation: u.metadata.creationTime, lastSignIn: u.metadata.lastSignInTime, lastRefresh: u.metadata.lastRefreshTime || null,
    tokensValidAfter: u.tokensValidAfterTime || null, providers: (u.providerData || []).map(p => p.providerId),
    mfa: (u.multiFactor && u.multiFactor.enrolledFactors || []).length, telephone: !!u.phoneNumber,
    claims: u.customClaims ? Object.keys(u.customClaims) : [], tenant: u.tenantId || null, dans_regles: UIDS.includes(u.uid) }));
  return { total: users.length, comptes: liste,
    hors_regles: liste.filter(u => !u.dans_regles).map(u => u.uid),
    regles_sans_compte: UIDS.filter(id => !users.some(u => u.uid === id)) };
});
await etape("auth_config", async () => {
  const c = await api(`https://identitytoolkit.googleapis.com/admin/v2/projects/${P}/config`);
  if (c.err) return { status: c.status, err: c.err };
  const j = c.j;
  const idp = await api(`https://identitytoolkit.googleapis.com/admin/v2/projects/${P}/defaultSupportedIdpConfigs`);
  const oidc = await api(`https://identitytoolkit.googleapis.com/admin/v2/projects/${P}/oauthIdpConfigs`);
  const saml = await api(`https://identitytoolkit.googleapis.com/admin/v2/projects/${P}/inboundSamlConfigs`);
  return { signIn: j.signIn, client_permissions: j.client && j.client.permissions, authorizedDomains: j.authorizedDomains,
    mfa: j.mfa, blockingFunctions: j.blockingFunctions ? Object.keys(j.blockingFunctions.triggers || {}) : [],
    emailPrivacyConfig: j.emailPrivacyConfig, multiTenant: j.multiTenant, monitoring: j.monitoring,
    idp_par_defaut: idp.err ? { status: idp.status } : (idp.j.defaultSupportedIdpConfigs || []).map(x => ({ id: x.name.split("/").pop(), enabled: x.enabled })),
    oidc: oidc.err ? { status: oidc.status } : (oidc.j.oauthIdpConfigs || []).map(x => ({ id: x.name.split("/").pop(), enabled: x.enabled })),
    saml: saml.err ? { status: saml.status } : (saml.j.inboundSamlConfigs || []).map(x => ({ id: x.name.split("/").pop(), enabled: x.enabled })) };
});

// ---------- Projet Google Cloud (lecture seule ; 403 attendu si le robot n'a pas le droit) ----------
await etape("projet", async () => {
  const out = {};
  const dbs = await api(`https://firestore.googleapis.com/v1/projects/${P}/databases`);
  out.bases_firestore = dbs.err ? { status: dbs.status, err: dbs.err } : (dbs.j.databases || []).map(d => ({ name: d.name.split("/").pop(), type: d.type, createTime: d.createTime, updateTime: d.updateTime, deleteProtection: d.deleteProtectionState, pitr: d.pointInTimeRecoveryEnablement }));
  for (const k of ["webApps", "androidApps", "iosApps"]) {
    const a = await api(`https://firebase.googleapis.com/v1beta1/projects/${P}/${k}`);
    out[k] = a.err ? { status: a.status, err: a.err } : (a.j.apps || []).map(x => ({ appId: x.appId, displayName: x.displayName, state: x.state }));
  }
  const sas = await api(`https://iam.googleapis.com/v1/projects/${P}/serviceAccounts`);
  if (sas.err) out.comptes_de_service = { status: sas.status, err: sas.err };
  else out.comptes_de_service = await parLots(sas.j.accounts || [], 4, async a => {
    const k = await api(`https://iam.googleapis.com/v1/${a.name}/keys?keyTypes=USER_MANAGED`);
    return { email: a.email, disabled: !!a.disabled, cles: k.err ? { status: k.status } : (k.j.keys || []).map(x => ({ id: x.name.split("/").pop().slice(0, 8), validAfter: x.validAfterTime, disabled: !!x.disabled, origin: x.keyOrigin, cle_du_robot: x.name.endsWith(sa.private_key_id) })) };
  });
  const iam = await api(`https://cloudresourcemanager.googleapis.com/v1/projects/${P}:getIamPolicy`, { method: "POST", body: "{}" });
  out.iam_policy = iam.err ? { status: iam.status, err: iam.err } : (iam.j.bindings || []).map(b => ({ role: b.role, membres: b.members.map(m => m.startsWith("user:") ? "user:" + masque(m.slice(5)) : m) }));
  const fn = await api(`https://cloudfunctions.googleapis.com/v2/projects/${P}/locations/-/functions`);
  out.cloud_functions = fn.err ? { status: fn.status, err: fn.err } : (fn.j.functions || []).map(f => ({ name: f.name.split("/").pop(), updateTime: f.updateTime }));
  const lg = await api("https://logging.googleapis.com/v2/entries:list", { method: "POST", body: JSON.stringify({
    resourceNames: [`projects/${P}`], pageSize: 500, orderBy: "timestamp desc",
    filter: `logName="projects/${P}/logs/cloudaudit.googleapis.com%2Factivity" AND timestamp>="${new Date(NOW - 30 * 86400e3).toISOString()}"` }) });
  out.audit_admin_30j = lg.err ? { status: lg.status, err: lg.err } : (lg.j.entries || []).map(e => {
    const p = e.protoPayload || {}, who = (p.authenticationInfo || {}).principalEmail || "";
    return { t: e.timestamp, service: p.serviceName, method: p.methodName, qui: who.endsWith("gserviceaccount.com") ? who : masque(who), ip: (p.requestMetadata || {}).callerIp || null, ua: String((p.requestMetadata || {}).callerSuppliedUserAgent || "").slice(0, 60) };
  });
  return out;
});

// ---------- Firestore ----------
await etape("firestore", async () => {
  const cols = (await db.listCollections()).map(c => c.id).sort();
  const out = { collections: cols, inconnues: cols.filter(c => !CONNUES.includes(c)), absentes: CONNUES.filter(c => !cols.includes(c)), detail: {} };
  for (const c of cols) {
    const snap = await db.collection(c).select("by", "uid", "at").get();
    const d = { n: snap.size, auteurs: {}, ecrits_14j: {}, crees_14j: 0, par_jour_14j: {}, at_max: null, maj_max: null, creation_min: null };
    let atMax = 0, majMax = 0, crMin = Infinity;
    for (const doc of snap.docs) {
      const by = doc.get("by"), uid = doc.get("uid");
      const a = auteur(by !== undefined ? by : uid);
      d.auteurs[a] = (d.auteurs[a] || 0) + 1;
      const am = atMs(doc.get("at")); if (am && am > atMax) atMax = am;
      const u = ms(doc.updateTime), cr = ms(doc.createTime);
      if (u > majMax) majMax = u; if (cr < crMin) crMin = cr;
      if (u >= J14) { d.ecrits_14j[a] = (d.ecrits_14j[a] || 0) + 1; d.par_jour_14j[jour(u)] = (d.par_jour_14j[jour(u)] || 0) + 1; }
      if (cr >= J14) d.crees_14j++;
    }
    d.non_legit = snap.docs.filter(x => { const v = x.get("by") !== undefined ? x.get("by") : x.get("uid"); return !lib(v); }).length;
    d.at_max = atMax ? new Date(atMax).toISOString() : null;
    d.maj_max = majMax ? new Date(majMax).toISOString() : null;
    d.creation_min = isFinite(crMin) ? new Date(crMin).toISOString() : null;
    // sous-collections (noms et nombre de documents parents)
    const sous = {};
    await parLots(snap.docs, 25, async doc => { for (const s of await doc.ref.listCollections()) sous[s.id] = (sous[s.id] || 0) + 1; });
    d.sous_collections = sous;
    out.detail[c] = d;
  }
  return out;
});
await etape("team", async () => (await db.collection("team").get()).docs.map(d => ({ id: d.id, legit: UIDS.includes(d.id), champs: Object.keys(d.data()).sort(), creation: iso(d.createTime), maj: iso(d.updateTime) })));
await etape("devices", async () => {
  const docs = (await db.collection("devices").get()).docs;
  const parUid = {};
  const liste = docs.map(d => { const x = d.data(); const a = auteur(x.uid); parUid[a] = (parUid[a] || 0) + 1;
    return { compte: a, legit: UIDS.includes(x.uid), email: masque(x.email), at: atMs(x.at) ? new Date(atMs(x.at)).toISOString() : null,
      creation: iso(d.createTime), maj: iso(d.updateTime), ua: String(x.ua || "").slice(0, 120), champs: Object.keys(x).sort(), jeton_present: !!x.token, id_egal_jeton: d.id === x.token }; });
  return { n: docs.length, par_compte: parUid, appareils: liste, jetons_compte_inconnu: liste.filter(x => !x.legit).length };
});
await etape("outbox", async () => {
  const s = await db.collection("outbox").select("by", "at", "sent", "sentAt").get();
  const r = { n: s.size, non_envoyes: 0, recents: [] };
  for (const d of s.docs) { if (d.get("sent") === false) r.non_envoyes++; const u = ms(d.updateTime);
    if (u >= J14) r.recents.push({ auteur: auteur(d.get("by")), at: atMs(d.get("at")) ? new Date(atMs(d.get("at"))).toISOString() : null, sent: d.get("sent"), maj: iso(d.updateTime) }); }
  r.recents.sort((a, b) => String(b.maj).localeCompare(String(a.maj))); r.recents = r.recents.slice(0, 50);
  return r;
});
await etape("notified", async () => {
  const s = await db.collection("notified").select("at", "day").get();
  const parJour = {}; let max = 0;
  for (const d of s.docs) { const u = ms(d.updateTime); if (u > max) max = u; if (u >= J14) parJour[jour(u)] = (parJour[jour(u)] || 0) + 1; }
  return { n: s.size, derniere_ecriture: max ? new Date(max).toISOString() : null, ecrits_par_jour_14j: parJour };
});
await etape("meta", async () => (await db.collection("meta").get()).docs.map(d => ({ id: d.id, auteur: auteur(d.get("by")), champs: Object.keys(d.data()).sort(), creation: iso(d.createTime), maj: iso(d.updateTime) })));
await etape("bkey", async () => (await db.collection("bkey").select("at").get()).docs.map(d => ({ id: d.id, creation: iso(d.createTime), maj: iso(d.updateTime) })));
await etape("importkeys", async () => { const s = await db.collection("importkeys").select("at").get(); return { n: s.size, ids: s.docs.map(d => d.id), maj: s.docs.map(d => iso(d.updateTime)) }; });

// ---------- Intégrité du site publié ----------
await etape("site", async () => {
  const fichiers = ["app.html", "app-sw.js", "index.html", "sw.js", "ticket.js", "app.webmanifest", "manifest.webmanifest", "ocr/tesseract.min.js", "ocr/worker.min.js", "ocr/tesseract-core-simd-lstm.wasm.js", "ocr/tesseract-core-lstm.wasm.js"];
  const hotes = t => [...new Set([...t.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map(m => m[1].toLowerCase()))].sort();
  const res = [];
  for (const f of fichiers) {
    const loc = fs.existsSync(new URL(f, ROOT)) ? fs.readFileSync(new URL(f, ROOT)) : null;
    let e = null;
    for (let i = 0; i < 4; i++) {
      try {
        const r = await fetch(SITE + f + "?v=" + Date.now(), { cache: "no-store", headers: { "cache-control": "no-cache" } });
        const b = Buffer.from(await r.arrayBuffer());
        e = { f, http: r.status, taille_site: b.length, taille_depot: loc ? loc.length : null, sha_site: sha(b).slice(0, 16), sha_depot: loc ? sha(loc).slice(0, 16) : null, last_modified: r.headers.get("last-modified"), identique: !!loc && sha(b) === sha(loc) };
        if (f === "app.html" && loc) { const hs = hotes(b.toString("utf8")), hd = hotes(loc.toString("utf8")); e.hotes_site_hors_depot = hs.filter(h => !hd.includes(h)); e.hotes_site = hs; }
        if (e.identique || !loc) break;
      } catch (err) { e = { f, erreur: msg(err) }; }
      await new Promise(r => setTimeout(r, 30000));
    }
    res.push(e);
  }
  return { head: process.env.GITHUB_SHA || null, fichiers: res, tous_identiques: res.every(x => x && x.identique) };
});

// ---------- Chiffrement (comme scelleLot) ----------
const aesKey = crypto.randomBytes(32), iv = crypto.randomBytes(12);
const c = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
const ct = Buffer.concat([c.update(JSON.stringify(R), "utf8"), c.final()]);
const k = crypto.publicEncrypt({ key: PUB, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, aesKey);
fs.writeFileSync(OUT, JSON.stringify({ v: 1, k: k.toString("base64"), iv: iv.toString("base64"), ct: ct.toString("base64"), tag: c.getAuthTag().toString("base64") }));
await admin.app().delete().catch(() => {});
console.log("OK");
} catch (e) { console.log("ECHEC"); process.exit(1); }
