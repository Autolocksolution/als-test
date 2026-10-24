import crypto from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import { scelleLot, ouvreLot, valide, doublons } from "./import-depenses.mjs";
{ // doublons : même jour, montant à 1 € près, une existante n'écarte qu'une ligne
  const L = [{ id: "a", data: { date: "2025-09-06", amount: 38.96, label: "A" } }, { id: "b", data: { date: "2025-09-06", amount: 39.39, label: "B" } }, { id: "c", data: { date: "2025-09-07", amount: 39.39, label: "C" } }, { id: "d", data: { date: "2025-09-06", amount: 12, label: "D" } }];
  const r = doublons(L, [{ date: "2025-09-06", amount: 39.39, label: "X" }]);
  assert.equal(r.size, 1); assert.ok(r.has("b"));
  assert.equal(doublons(L, []).size, 0);
  const S = [{ id: "s", data: { date: "2025-09-27", amount: 7.44, label: "S", src: "import AliExpress" } }];
  assert.equal(doublons(S, [{ date: "2025-09-27", amount: 7.54, label: "Y", src: "import AliExpress" }]).size, 0);
  assert.equal(doublons(S, [{ date: "2025-09-27", amount: 7.54, label: "M", src: "manuel" }]).size, 1);
}
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
