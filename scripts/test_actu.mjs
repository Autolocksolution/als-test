import fs from "node:fs";
import assert from "node:assert/strict";
import { clean, parseFile } from "./actu-lib.mjs";
const ok = { id: "c-test-1", title: "T", url: "https://x.fr/a", summary: "S", source: "x.fr", kind: "forum", date: "2026-10-01", state: "saved", by: "pirate", at: 1792000000000, extra: "<script>" };
const c = clean(ok);
assert.equal(c.data.state, "new"); assert.equal(c.data.by, "claude"); assert.equal(c.data.extra, undefined); assert.equal(c.data.kind, "forum");
assert.equal(clean({ ...ok, kind: "autre" }).data.kind, "web");
for (const bad of [{ ...ok, id: "../x" }, { ...ok, id: "x-1" }, { ...ok, url: "javascript:alert(1)" }, { ...ok, title: "" }, { ...ok, summary: 5 }, { ...ok, date: "hier" }, { ...ok, title: "a".repeat(201) }])
  assert.throws(() => clean(bad));
assert.throws(() => parseFile("{}")); assert.throws(() => parseFile(JSON.stringify(Array(61).fill(ok))));
const dir = new URL("../actu/", import.meta.url); let n = 0;
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".json"))) n += parseFile(fs.readFileSync(new URL(f, dir), "utf8")).length;
console.log(`actu: tests OK, ${n} actu(s) valides dans actu/`);
