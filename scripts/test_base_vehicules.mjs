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
