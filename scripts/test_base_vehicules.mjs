import assert from "node:assert/strict";
import { entrees, memeFiche, genNum, trie } from "./base-vehicules.mjs";
const E = entrees();
assert.ok(E.length > 200, String(E.length));
for (const e of E) { assert.ok(e.brand && e.model && e.gen && e.q, e.id); assert.ok(e.yFrom >= 1990 && (e.yTo === null || e.yTo >= e.yFrom), e.id); }
assert.equal(genNum("Clio 4 phase 1", "Clio"), "4"); assert.equal(genNum("Clio 4 (phase 1 et 2)", "Clio"), "4"); assert.equal(genNum("206 phase 2", "206"), null);
const clio4 = E.find(e => e.id === "auto-renault-clio-4-phase-1"), clio3 = E.find(e => e.id === "auto-renault-clio-3-phase-2");
assert.ok(memeFiche({ brand: "Renault", model: "Clio", gen: "Clio 4 (phase 1 et 2)", yFrom: 2012, yTo: 2019 }, clio4));
assert.ok(!memeFiche({ brand: "Renault", model: "Clio", gen: "Clio 4 (phase 1 et 2)", yFrom: 2012, yTo: 2019 }, clio3));
assert.ok(!memeFiche({ brand: "Renault", model: "Megane", gen: "Megane 4", yFrom: 2016, yTo: 2024 }, clio4));
const ii = (w, h) => [{ width: w, height: h, thumburl: "x" }];
assert.deepEqual(trie([{ title: "File:Renault Clio interior.jpg", index: 1, imageinfo: ii(2000, 1000) }, { title: "File:Renault Clio rear.jpg", index: 2, imageinfo: ii(2000, 1000) }, { title: "File:Renault Clio IV.jpg", index: 3, imageinfo: ii(2000, 1000) }, { title: "File:Renault Clio IV front.jpg", index: 4, imageinfo: ii(2000, 1000) }]).map(p => p.title), ["File:Renault Clio IV front.jpg", "File:Renault Clio IV.jpg"]);
console.log("base-vehicules: tests OK (" + E.length + " fiches)");
import { retenue } from "./base-vehicules.mjs";
{ const cand = { a: [{ t: 1 }, { t: 2 }], b: [{ t: 3 }] };
  assert.equal(retenue({ a: 2 }, cand, "a").t, 2); assert.equal(retenue({}, cand, "b").t, 3); assert.equal(retenue({ b: { from: "a", n: 1 } }, cand, "b").t, 1);
  assert.equal(retenue({ b: { q: "x" } }, cand, "b"), null); assert.equal(retenue({ a: 0 }, cand, "a"), null); }
console.log("retenue OK");
import { LOTS } from "./base-vehicules.mjs";
{ const all = Object.values(LOTS).flatMap(l => entrees(l)); assert.equal(new Set(all.map(e => e.id)).size, all.length, "id en double entre lots");
  for (const e of all) assert.ok(e.yFrom >= 1990 && (e.yTo === null || e.yTo >= e.yFrom), e.id);
  console.log("lots :", Object.entries(LOTS).map(([n, l]) => n + "=" + entrees(l).length).join(" ")); }
{ const ii = [{ width: 2000, height: 1000, thumburl: "x" }];
  assert.equal(trie([{ title: "File:Toyota Yaris 2006.jpg", index: 1, imageinfo: ii }, { title: "File:SEAT Leon 2.jpg", index: 2, imageinfo: ii }, { title: "File:Seat Ibiza interior.jpg", index: 3, imageinfo: ii }]).length, 2); }
import { complete } from "./base-vehicules.mjs";
import { infos } from "./base-vehicules/enrichir.mjs";
{ const all = Object.values(LOTS).flatMap(l => entrees(l));
  for (const e of all) { const i = infos(e); assert.ok(i.s.obd && i.t.notes, e.id); }
  const m4 = all.find(e => e.id === "auto-renault-megane-4-phase-1"), i = infos(m4);
  assert.ok(/HFM/.test(i.t.boxes) && /Lishi VA2/.test(i.t.lock) && /EMS3150/.test(i.t.ecuRefs), JSON.stringify(i));
  assert.ok(/Électrique/.test(infos(all.find(e => e.id === "auto-renault-zoe-phase-1")).t.ecuRefs));
  assert.ok(/PureTech/.test(infos(all.find(e => e.id === "auto-opel-corsa-f")).t.ecuRefs));
  assert.ok(/CAS :/.test(infos(all.find(e => e.id === "auto-bmw-serie-3-e90")).t.boxes));
  // complément : ne remplace jamais une case déjà remplie
  const r = complete({ s: { obd: "Mon OBD", type: "x" }, t: { lock: "Ma méthode", notes: "⚠️ Infos clé pré-remplies automatiquement : à vérifier avant intervention." } }, m4);
  assert.equal(r.s.obd, "Mon OBD"); assert.equal(r.t.lock, "Ma méthode"); assert.ok(r.t.ecuRefs && /calculateur/.test(r.t.notes));
  const r2 = complete({ s: {}, t: { notes: "Ma note perso" } }, m4); assert.equal(r2.t.notes, "Ma note perso");
  console.log("complément OK"); }
import { fusionne } from "./base-vehicules.mjs";
{ const a = { s: { type: "Carte", obd: "auto" }, t: { notes: "⚠️ auto", lock: "Lishi" }, ph: { lame: ["a"] }, photoId: "pA", credit: "c", by: "auto" };
  const m = { s: { obd: "Sous le cendrier" }, t: { proc1: "Ma procédure", notes: "Ma note" }, ph: { lame: ["b"], prog: ["c"] }, photoId: "pM", by: "u1", cs: [{ id: "c1" }] };
  const r = fusionne(a, m);
  assert.equal(r.s.obd, "Sous le cendrier"); assert.equal(r.s.type, "Carte"); assert.equal(r.t.proc1, "Ma procédure"); assert.ok(r.t.notes.startsWith("Ma note"));
  assert.deepEqual(r.ph.lame, ["a", "b"]); assert.deepEqual(r.ph.specs, ["pM"]); assert.equal(r.photoId, "pA"); assert.equal(r.by, "u1"); assert.equal(r.cs.length, 1);
  assert.ok(entrees(LOTS.fr).some(e => e.id === "auto-renault-arkana" && e.gen === "Arkana phase 1" && e.yTo === 2023));
  console.log("fusion OK"); }
