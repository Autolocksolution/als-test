import assert from "node:assert/strict";
import { parisNow, addDays, due } from "./plan.mjs";
// 2026-10-13 12:00 UTC = 14:00 Paris (heure d'été)
const n = parisNow(new Date("2026-10-13T12:00:00Z"));
assert.equal(n.date, "2026-10-13"); assert.equal(n.minutes, 14 * 60);
assert.equal(addDays("2026-12-31", 1), "2027-01-01");
const mk = (id, time, extra = {}) => ({ id, date: "2026-10-13", time, title: "Clio 4 clé perdue", ...extra });
// rappel : RDV à 15:00 → dans 60 min → envoyé
let r = due([mk("a", "15:00", { address: "Narbonne" })], n, new Set());
assert.equal(r.length, 1); assert.match(r[0].title, /dans 1 h · 15:00/); assert.match(r[0].body, /Narbonne/);
// trop tôt (16:00)
assert.equal(due([mk("a", "16:00")], n, new Set()).length, 0);
// dans 20 min
r = due([mk("a", "14:20")], n, new Set()); assert.match(r[0].title, /dans 20 min/);
// passé depuis 5 min -> maintenant ; depuis 30 min -> rien
assert.match(due([mk("a", "13:55")], n, new Set())[0].title, /maintenant/);
assert.equal(due([mk("a", "13:30")], n, new Set()).length, 0);
// déjà envoyé / terminé / sans heure
assert.equal(due([mk("a", "15:00")], n, new Set(["rem_a_2026-10-13_15:00"])).length, 0);
assert.equal(due([mk("a", "15:00", { done: true })], n, new Set()).length, 0);
assert.equal(due([mk("a", "")], n, new Set()).length, 0);
// heure modifiée => nouvelle clé => renvoyé
assert.equal(due([mk("a", "14:45")], n, new Set(["rem_a_2026-10-13_15:00"])).length, 1);
// RDV demain 00:30 vu à 23:40 la veille
const late = parisNow(new Date("2026-10-13T21:40:00Z")); // 23:40 Paris
r = due([{ id: "z", date: "2026-10-14", time: "00:30", title: "Nuit" }], late, new Set()); assert.equal(r.length, 1);
// récap du matin : 08:00 Paris, 3 RDV triés
const m = parisNow(new Date("2026-10-13T06:00:00Z"));
r = due([mk("b", "10:00", { title: "B" }), mk("a", "09:00", { title: "A" }), mk("c", "", { title: "C" })], m, new Set());
const day = r.find(x => x.key === "day_2026-10-13"); assert.ok(day); assert.match(day.title, /3 rendez-vous/); assert.equal(day.body, "09:00 A · 10:00 B · C");
assert.equal(due([mk("a", "09:00")], m, new Set(["day_2026-10-13"])).filter(x => x.key.startsWith("day")).length, 0);
// avant 7h30 : pas de récap
const early = parisNow(new Date("2026-10-13T05:00:00Z")); // 07:00
assert.equal(due([mk("a", "09:00")], early, new Set()).length, 0);
// après 13h : pas de récap
assert.equal(due([mk("a", "18:00")], parisNow(new Date("2026-10-13T12:00:00Z")), new Set()).filter(x => x.key.startsWith("day")).length, 0);
console.log("plan: tout est OK");
