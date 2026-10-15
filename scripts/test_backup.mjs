// Tests de la sauvegarde chiffrée, sans accès à Firebase (fausse base en mémoire).
// Vérifie aussi que le navigateur (WebCrypto) sait déchiffrer les fichiers, et l'outil dechiffrer.mjs.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { COLLECTIONS, parisDate, backupFileName, toPlain, buildBackup, countDocs, businessCount, parseKey, encrypt, decrypt, runBackup } from "./backup-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "dechiffrer.mjs");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "als-backup-test-"));
const MARK = "CONTENU-CLIENT-TRES-SECRET-" + crypto.randomBytes(4).toString("hex");
let nTests = 0;
const t = async (name, fn) => { await fn(); nTests++; };

// ---------- fausse base Firestore (sous-ensemble utilisé par runBackup) ----------
const DOCID = { fake: "documentId" };
class FakeTs { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } }
class FakeDb {
  constructor(data = {}) {
    this.store = {};
    for (const [c, docs] of Object.entries(data)) this.store[c] = new Map(Object.entries(docs));
    this.sets = []; this.creates = []; this.queries = 0; this.beforeCreate = null;
  }
  col(c) { return this.store[c] || (this.store[c] = new Map()); }
  collection(name) { return new FakeQuery(this, name); }
}
class FakeQuery {
  constructor(db, name, o = {}) { this.db = db; this.name = name; this.o = o; }
  orderBy(f) { assert.equal(f, DOCID, "tri par identifiant attendu"); return new FakeQuery(this.db, this.name, { ...this.o, ordered: true }); }
  limit(n) { return new FakeQuery(this.db, this.name, { ...this.o, limit: n }); }
  startAfter(snap) { return new FakeQuery(this.db, this.name, { ...this.o, after: snap.id }); }
  doc(id) { return new FakeRef(this.db, this.name, id); }
  async get() {
    assert.ok(this.o.ordered && this.o.limit, "lecture paginée attendue");
    this.db.queries++;
    const ids = [...this.db.col(this.name).keys()].sort().filter(id => this.o.after === undefined || id > this.o.after).slice(0, this.o.limit);
    return { docs: ids.map(id => ({ id, data: () => ({ ...this.db.col(this.name).get(id) }) })) };
  }
}
class FakeRef {
  constructor(db, c, id) { this.db = db; this.c = c; this.id = id; }
  async get() { const v = this.db.col(this.c).get(this.id); return { exists: v !== undefined, data: () => v && { ...v } }; }
  async create(v) {
    if (this.db.beforeCreate) this.db.beforeCreate(this.c, this.id);
    if (this.db.col(this.c).has(this.id)) { const e = new Error("6 ALREADY_EXISTS: Document already exists"); e.code = 6; throw e; }
    this.db.creates.push(this.c + "/" + this.id); this.db.col(this.c).set(this.id, { ...v });
  }
  async set(v) { this.db.sets.push(this.c + "/" + this.id); this.db.col(this.c).set(this.id, { ...v }); }
}
// toMillis sur des Timestamp imbriqués ; plus de documents que la taille de page.
function sampleData() {
  const d = {
    items: {}, entries: {}, ideas: { i1: { text: "Lame HU66", done: false } }, codes: { c1: { text: "1234", at: 1 } },
    photos: { p1: { d: "data:image/jpeg;base64,AAAA", by: "u1", at: 2 } },
    clients: { cl1: { name: MARK, phone: "0600000000", created: new FakeTs(1760000000123), hist: [{ when: new FakeTs(5) }] } },
    docs: {}, orders: {}, vehicles: {}, rdv: { r1: { date: "2026-10-16", time: "09:00", title: "Clio" } }, news: {},
    meta: { company: { name: "ALS" }, backup: { at: 1, by: "u1", n: 3 } },
  };
  for (let i = 0; i < 23; i++) d.items["it" + String(i).padStart(2, "0")] = { name: "Clé " + i, qty: i };
  for (let i = 0; i < 20; i++) d.entries["e" + String(i).padStart(2, "0")] = { amount: i, date: "2026-10-01" };
  return d;
}
const readKey = db => parseKey(db.col("bkey").get("main").k);
const quiet = () => { const lines = []; return { lines, log: (...a) => lines.push(a.join(" ")) }; };

// ---------- fonctions pures ----------
await t("date de Paris", () => {
  assert.equal(parisDate(new Date("2026-10-15T21:59:00Z")), "2026-10-15"); // 23:59 heure d'été
  assert.equal(parisDate(new Date("2026-10-15T22:30:00Z")), "2026-10-16"); // 00:30
  assert.equal(parisDate(new Date("2026-12-31T23:30:00Z")), "2027-01-01"); // heure d'hiver
  assert.equal(parisDate(new Date("2026-03-29T00:30:00Z")), "2026-03-29");
  assert.equal(backupFileName("2026-10-16"), "sauvegarde-auto-2026-10-16.alsbk");
});
await t("conversion des valeurs Firestore", () => {
  const ref = { path: "clients/x", collection() {}, firestore: {} };
  const geo = { latitude: 43.18, longitude: 3.0, isEqual() {} };
  assert.deepEqual(toPlain({ a: new FakeTs(42), b: [new FakeTs(7), { c: new FakeTs(8) }], s: "x", n: null, z: 0, f: false, r: ref, g: geo, by: Buffer.from("hé") }),
    { a: 42, b: [7, { c: 8 }], s: "x", n: null, z: 0, f: false, r: "clients/x", g: { latitude: 43.18, longitude: 3.0 }, by: Buffer.from("hé").toString("base64") });
  const b = buildBackup({ items: [{ id: "a" }] }, new Date("2026-10-15T02:17:00Z"));
  assert.deepEqual(Object.keys(b), ["app", "format", "at", "auto", "collections"]);
  assert.deepEqual([b.app, b.format, b.at, b.auto], ["AutoLockSolution", 1, "2026-10-15T02:17:00.000Z", true]);
  assert.deepEqual(Object.keys(b.collections), COLLECTIONS);
  const c = countDocs(b); assert.equal(c.items, 1); assert.equal(c.photos, 0);
  assert.equal(businessCount({ ...c, photos: 9, meta: 9, rdv: 2 }), 3);
});
await t("clé base64", () => {
  const k = crypto.randomBytes(32), s = k.toString("base64");
  assert.equal(s.length, 44); assert.ok(parseKey(s).equals(k));
  assert.ok(parseKey(" " + s.slice(0, 20) + "\n" + s.slice(20) + "\n").equals(k)); // copier-coller
  assert.throws(() => parseKey(""), /absente/);
  assert.throws(() => parseKey(crypto.randomBytes(16).toString("base64")), /16 octets/);
  assert.throws(() => parseKey("é" + s.slice(1)), /base64/);
});
await t("chiffrement : format, aléa, intégrité", () => {
  const k = crypto.randomBytes(32), p = Buffer.from(JSON.stringify({ app: "AutoLockSolution", x: MARK }));
  const f = encrypt(p, k), g = encrypt(p, k);
  assert.equal(f.subarray(0, 6).toString("ascii"), "ALSBK1");
  assert.equal(f.length, 6 + 12 + p.length + 16);
  assert.ok(!f.subarray(6, 18).equals(g.subarray(6, 18)), "IV différent à chaque fichier");
  assert.ok(!f.includes(Buffer.from(MARK)), "aucun texte clair dans le fichier");
  assert.ok(decrypt(f, k).equals(p));
  const bad = Buffer.from(f); bad[30] ^= 1; assert.throws(() => decrypt(bad, k), /Déchiffrement impossible/);
  const badTag = Buffer.from(f); badTag[badTag.length - 1] ^= 1; assert.throws(() => decrypt(badTag, k), /Déchiffrement impossible/);
  assert.throws(() => decrypt(f, crypto.randomBytes(32)), /Déchiffrement impossible/);
  assert.throws(() => decrypt(Buffer.concat([Buffer.from("XXXXXX"), f.subarray(6)]), k), /ALSBK1/);
  assert.throws(() => decrypt(f.subarray(0, 20), k), /trop court/);
});

// ---------- sauvegarde complète avec la fausse base ----------
let saved; // { file, key, plain }
await t("sauvegarde complète : clé créée, fichier chiffré, auto-contrôle, meta/backup", async () => {
  const db = new FakeDb(sampleData()), out = path.join(TMP, "run1"), q = quiet();
  // Espionne toute écriture disque pendant la sauvegarde : seul le fichier chiffré doit être écrit.
  const writes = [], orig = { w: fs.writeFileSync, a: fs.appendFileSync, ws: fs.createWriteStream, pw: fs.promises.writeFile };
  fs.writeFileSync = (f, data, o) => { writes.push([String(f), Buffer.from(data)]); return orig.w(f, data, o); };
  fs.appendFileSync = (f) => { writes.push([String(f), null]); throw new Error("appendFileSync inattendu"); };
  fs.createWriteStream = (f) => { writes.push([String(f), null]); throw new Error("createWriteStream inattendu"); };
  fs.promises.writeFile = async (f) => { writes.push([String(f), null]); throw new Error("promises.writeFile inattendu"); };
  const before = Date.now();
  let r;
  try { r = await runBackup({ db, docIdField: DOCID, outDir: out, now: new Date("2026-10-15T22:30:00Z"), log: q.log, warn: q.log, pageSize: 10 }); }
  finally { fs.writeFileSync = orig.w; fs.appendFileSync = orig.a; fs.createWriteStream = orig.ws; fs.promises.writeFile = orig.pw; }

  assert.equal(r.name, "sauvegarde-auto-2026-10-16.alsbk");
  assert.deepEqual(writes.map(w => w[0]), [r.file]);
  assert.ok(!writes[0][1].includes(Buffer.from(MARK)));
  assert.deepEqual(fs.readdirSync(out), [r.name]);
  assert.equal(fs.statSync(r.file).mode & 0o777, 0o600);
  // clé créée par create(), jamais par set()
  assert.deepEqual(db.creates, ["bkey/main"]);
  const bk = db.col("bkey").get("main");
  assert.equal(typeof bk.at, "number"); assert.ok(bk.at >= before);
  const key = readKey(db);
  // contenu
  const plain = decrypt(fs.readFileSync(r.file), key), j = JSON.parse(plain);
  assert.deepEqual(Object.keys(j), ["app", "format", "at", "auto", "collections"]);
  assert.equal(j.at, "2026-10-15T22:30:00.000Z"); assert.equal(j.auto, true);
  assert.equal(j.collections.items.length, 23); assert.equal(j.collections.entries.length, 20); // pagination (pages de 10)
  assert.deepEqual(j.collections.items[0], { id: "it00", name: "Clé 0", qty: 0 });
  const cl = j.collections.clients[0];
  assert.equal(cl.id, "cl1"); assert.equal(cl.created, 1760000000123); assert.deepEqual(cl.hist, [{ when: 5 }]);
  assert.deepEqual(j.collections.meta.map(m => m.id), ["backup", "company"]);
  assert.ok(!("bkey" in j.collections), "la clé n'est jamais dans la sauvegarde");
  assert.equal(r.total, 23 + 20 + 1 + 1 + 1 + 1 + 1 + 2);
  // meta/backup écrit APRÈS l'auto-contrôle, n = tout sauf photos et meta
  assert.deepEqual(db.sets, ["meta/backup"]);
  const mb = db.col("meta").get("backup");
  assert.equal(mb.by, "auto"); assert.equal(mb.n, 23 + 20 + 1 + 1 + 1 + 1); assert.ok(mb.at >= before);
  // journaux : nombres et tailles uniquement
  const all = q.lines.join("\n");
  assert.ok(!all.includes(MARK) && !all.includes("Clio") && !all.includes("0600000000"), "aucun contenu dans les journaux");
  assert.ok(!all.includes(bk.k) && !all.includes(bk.k.slice(0, 12)), "jamais la clé dans les journaux");
  assert.match(all, /NOUVELLE clé/); assert.match(all, /auto-contrôle OK/);
  saved = { file: r.file, key, plain, k: bk.k };
});
await t("deuxième sauvegarde : même clé réutilisée", async () => {
  const db = new FakeDb(sampleData()); db.col("bkey").set("main", { k: saved.k, at: 1 });
  const q = quiet();
  const r = await runBackup({ db, docIdField: DOCID, outDir: path.join(TMP, "run2"), log: q.log, warn: q.log });
  assert.deepEqual(db.creates, []); assert.equal(db.col("bkey").get("main").k, saved.k);
  assert.ok(decrypt(fs.readFileSync(r.file), saved.key).length > 0);
  assert.match(q.lines.join("\n"), /existante/);
});
await t("course entre deux exécutions : create() refusé -> clé de l'autre réutilisée", async () => {
  const db = new FakeDb(sampleData()), other = crypto.randomBytes(32).toString("base64");
  db.beforeCreate = (c, id) => { db.col(c).set(id, { k: other, at: 2 }); db.beforeCreate = null; };
  const r = await runBackup({ db, docIdField: DOCID, outDir: path.join(TMP, "run3"), log() {}, warn() {} });
  assert.equal(db.col("bkey").get("main").k, other);
  assert.ok(decrypt(fs.readFileSync(r.file), parseKey(other)).length > 0);
});
await t("clé existante abîmée : arrêt, rien écrit, clé non remplacée", async () => {
  const db = new FakeDb(sampleData()); db.col("bkey").set("main", { k: "abc", at: 1 });
  const out = path.join(TMP, "run4");
  await assert.rejects(runBackup({ db, docIdField: DOCID, outDir: out, log() {}, warn() {} }), /PAS remplacée/);
  assert.equal(db.col("bkey").get("main").k, "abc"); assert.deepEqual(db.sets, []); assert.ok(!fs.existsSync(out));
});
await t("fichier mal écrit : auto-contrôle en échec, fichier supprimé, meta/backup intact", async () => {
  const db = new FakeDb(sampleData()), out = path.join(TMP, "run5");
  const truncate = (f, data, o) => fs.writeFileSync(f, data.subarray(0, data.length - 1), o);
  await assert.rejects(runBackup({ db, docIdField: DOCID, outDir: out, log() {}, warn() {}, writeFile: truncate }), /Auto-contrôle de la sauvegarde ÉCHOUÉ/);
  assert.deepEqual(db.sets, []); assert.deepEqual(fs.readdirSync(out), []);
  assert.deepEqual(db.col("meta").get("backup"), { at: 1, by: "u1", n: 3 });
});
await t("relecture avec un document manquant : écart détecté", async () => {
  const db = new FakeDb(sampleData()), k = crypto.randomBytes(32);
  db.col("bkey").set("main", { k: k.toString("base64"), at: 1 });
  const dropOne = f => { const j = JSON.parse(decrypt(fs.readFileSync(f), k)); j.collections.items.pop(); return encrypt(Buffer.from(JSON.stringify(j)), k); };
  await assert.rejects(runBackup({ db, docIdField: DOCID, outDir: path.join(TMP, "run6"), log() {}, warn() {}, readFile: dropOne }), /ÉCHOUÉ/);
  assert.deepEqual(db.sets, []);
});
await t("base vide : sauvegarde refusée", async () => {
  const db = new FakeDb({ meta: { company: { name: "x" } }, photos: { p: { d: "x" } } });
  await assert.rejects(runBackup({ db, docIdField: DOCID, outDir: path.join(TMP, "run7"), log() {}, warn() {} }), /Aucune donnée métier/);
  assert.deepEqual(db.sets, []); assert.deepEqual(db.creates, [], "pas de clé créée dans une base vide");
});
await t("forte baisse du nombre de documents : avertissement", async () => {
  const data = sampleData(); data.meta.backup = { at: 1, by: "auto", n: 500 };
  const db = new FakeDb(data), w = [];
  await runBackup({ db, docIdField: DOCID, outDir: path.join(TMP, "run8"), log() {}, warn: m => w.push(m) });
  assert.match(w.join(""), /::warning::.*500 -> 47/);
});

// ---------- interopérabilité navigateur (WebCrypto) ----------
const { subtle } = globalThis.crypto;
const b64ToBytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)); // exactement ce que fera l'appli
await t("WebCrypto déchiffre le fichier produit par Node", async () => {
  const bytes = new Uint8Array(fs.readFileSync(saved.file));
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), "ALSBK1");
  const ck = await subtle.importKey("raw", b64ToBytes(saved.k), { name: "AES-GCM" }, false, ["decrypt"]);
  const pt = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(6, 18), tagLength: 128 }, ck, bytes.subarray(18)));
  assert.ok(Buffer.from(pt).equals(saved.plain));
  const j = JSON.parse(new TextDecoder().decode(pt));
  assert.equal(j.app, "AutoLockSolution"); assert.equal(j.collections.clients[0].name, MARK);
  const bad = bytes.slice(); bad[bad.length - 5] ^= 1;
  await assert.rejects(subtle.decrypt({ name: "AES-GCM", iv: bad.subarray(6, 18), tagLength: 128 }, ck, bad.subarray(18)));
});
await t("Node et dechiffrer.mjs déchiffrent un fichier produit par WebCrypto", async () => {
  const ck = await subtle.importKey("raw", b64ToBytes(saved.k), { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12)), p = new TextEncoder().encode(JSON.stringify({ app: "AutoLockSolution", format: 1, collections: { items: [{ id: "é" }] } }));
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, ck, p));
  const f = Buffer.concat([Buffer.from("ALSBK1"), iv, ct]);
  assert.ok(decrypt(f, saved.key).equals(Buffer.from(p)));
  const fp = path.join(TMP, "navigateur.alsbk"); fs.writeFileSync(fp, f);
  const r = spawnSync(process.execPath, [CLI, fp, saved.k]);
  assert.equal(r.status, 0, r.stderr.toString()); assert.ok(r.stdout.equals(Buffer.from(p)));
});

// ---------- outil de secours dechiffrer.mjs ----------
const cli = (args, env = {}) => {
  const e = { ...process.env, ...env }; if (!("ALS_BACKUP_KEY" in env)) delete e.ALS_BACKUP_KEY;
  const r = spawnSync(process.execPath, [CLI, ...args], { env: e });
  return { code: r.status, out: r.stdout, err: r.stderr.toString() };
};
await t("dechiffrer.mjs : clé en argument", () => {
  const r = cli([saved.file, saved.k]);
  assert.equal(r.code, 0, r.err); assert.ok(r.out.equals(saved.plain)); assert.match(r.err, /^OK : sauvegarde du 2026-10-15T22:30:00.000Z déchiffrée, 50 documents/);
});
await t("dechiffrer.mjs : clé dans ALS_BACKUP_KEY, et clé copiée avec retours à la ligne", () => {
  let r = cli([saved.file], { ALS_BACKUP_KEY: saved.k }); assert.equal(r.code, 0, r.err); assert.ok(r.out.equals(saved.plain));
  r = cli([saved.file, saved.k.slice(0, 22) + "\n " + saved.k.slice(22)]); assert.equal(r.code, 0, r.err);
});
await t("dechiffrer.mjs : -o écrit le fichier, sans écraser", () => {
  const o = path.join(TMP, "sortie.json");
  let r = cli([saved.file, saved.k, "-o", o]); assert.equal(r.code, 0, r.err); assert.equal(r.out.length, 0);
  assert.ok(fs.readFileSync(o).equals(saved.plain));
  r = cli([saved.file, saved.k, "-o", o]); assert.equal(r.code, 1); assert.match(r.err, /existe déjà/);
});
await t("dechiffrer.mjs : erreurs claires en français", () => {
  const zip = path.join(TMP, "a.zip"); fs.writeFileSync(zip, Buffer.from("PK\x03\x04xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"));
  const plainJson = path.join(TMP, "clair.json"); fs.writeFileSync(plainJson, "{}");
  const trunc = path.join(TMP, "court.alsbk"); fs.writeFileSync(trunc, Buffer.from("ALSBK1abc"));
  const tampered = path.join(TMP, "abime.alsbk"); const b = fs.readFileSync(saved.file); b[40] ^= 1; fs.writeFileSync(tampered, b);
  const cases = [
    [[], /fichier \.alsbk manquant/, 2],
    [[saved.file], /clé manquante/, 2],
    [[path.join(TMP, "absent.alsbk"), saved.k], /fichier introuvable/, 1],
    [[TMP, saved.k], /dossier/, 1],
    [[saved.file, crypto.randomBytes(32).toString("base64")], /la clé ne correspond pas/, 1],
    [[saved.file, "trop-courte"], /octets au lieu de 32/, 1],
    [[saved.file, "pas une clé !"], /caractères base64/, 1],
    [[tampered, saved.k], /abîmé/, 1],
    [[zip, saved.k], /\.zip/, 1],
    [[plainJson, saved.k], /en-tête ALSBK1 absent/, 1],
    [[trunc, saved.k], /tronqué/, 1],
    [[saved.file, saved.k, "en-trop"], /trop d'arguments/, 2],
  ];
  for (const [args, re, code] of cases) {
    const r = cli(args);
    assert.equal(r.code, code, args.join(" ") + " -> " + r.err); assert.match(r.err, /^ERREUR : /); assert.match(r.err, re); assert.equal(r.out.length, 0);
    assert.ok(!r.err.includes(saved.k), "la clé n'est jamais affichée");
  }
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`sauvegarde: ${nTests} tests OK`);
