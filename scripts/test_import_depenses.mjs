import crypto from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import { scelleLot, ouvreLot, valide } from "./import-depenses.mjs";
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const ok = { id: "tk-x-1", kind: "depense", cat: "essence", date: "2026-10-01", amount: 20, vat: 3.33, pay: "carte", label: "Test", litres: 9.5, odo: null, full: null, at: 1, src: "t" };
const lot = ouvreLot(scelleLot([ok], publicKey), privateKey);
assert.equal(lot.length, 1); assert.equal(lot[0].data.amount, 20); assert.equal(lot[0].data.extra, undefined);
const env = JSON.parse(scelleLot([ok], publicKey)); env.ct = Buffer.from("x" + Buffer.from(env.ct, "base64").toString("latin1"), "latin1").toString("base64");
assert.throws(() => ouvreLot(JSON.stringify(env), privateKey));
for (const bad of [{ ...ok, id: "../x" }, { ...ok, kind: "recette" }, { ...ok, cat: "x" }, { ...ok, amount: "20" }, { ...ok, date: "01/10/2026" }, { ...ok, vat: 50 }, { ...ok, pay: "cheque" }])
  assert.throws(() => valide(bad));
assert.throws(() => ouvreLot(scelleLot([ok, ok], publicKey), privateKey));
const f = process.argv[2];
if (f) { const L = JSON.parse(fs.readFileSync(f, "utf8")); const r = ouvreLot(scelleLot(L, publicKey), privateKey); console.log("lot réel valide :", r.length); }
console.log("import-depenses: tests OK");
