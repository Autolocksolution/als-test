// Tests du rangement par Claude (sans réseau) : node test_ia.mjs
import assert from "node:assert/strict";
import { candidates, already, mergeSheet, fileRequest, imageBlock, parseJson, apiMessage, label } from "./ia-lib.mjs";
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

const V = [
  { id: "c4", brand: "Renault", model: "Clio", gen: "Clio IV", yFrom: 2012, yTo: 2019, s: { chip: "PCF7961M", type: "Carte mains-libres" }, t: { proc2: "Lire le code PIN par OBD avec Autel.\nProgrammer la carte." } },
  { id: "c4l", brand: "Renault", model: "Clio", gen: "Clio IV · clé à lame", yFrom: 2012, yTo: 2019, s: { type: "Clé à télécommande" }, t: {} },
  { id: "c3", brand: "Renault", model: "Clio", gen: "Clio III", yFrom: 2005, yTo: 2012, s: {}, t: {} },
  { id: "p308", brand: "Peugeot", model: "308", gen: "Phase II", yFrom: 2013, yTo: 2021, s: {}, t: {} },
];
// candidates
ok(candidates(V, { brand: "Renault", model: "Clio", year: "2016" }).map(v => v.id).join() === "c4,c4l", "Clio 2016 -> les deux fiches Clio IV, pas la III");
ok(candidates(V, { brand: "peugeot", model: "308" })[0].id === "p308", "308 trouvé sans année");
ok(candidates(V, { brand: "Renault", model: "Twingo" }).length === 0, "modèle absent -> aucune fiche");
ok(candidates(V, {}).length === 0, "rien d'identifié -> aucune fiche");
ok(label(V[0]) === "Renault Clio Clio IV (2012-2019)", "libellé de fiche");
// already
ok(already("Lire le code PIN par OBD avec Autel.", "lire le code pin par obd avec autel"), "même phrase, casse/ponctuation différentes");
ok(already("Il faut lire le code PIN par OBD avec Autel IM508 avant tout", "Lire le code PIN par OBD avec Autel"), "phrase déjà contenue");
ok(!already("Lire le code PIN par OBD.", "Débrancher la batterie 10 minutes avant"), "phrase nouvelle");
// mergeSheet : pas de doublon, pas d'écrasement
let m = mergeSheet(V[0], { s: { chip: "ID47", freq: "433 MHz", zzz: "x" }, t: { proc2: "Programmer la carte.\nAttendre 15 min si le tableau de bord affiche antidémarrage.", notes: "" } });
ok(m.update.s.chip === "PCF7961M" && m.update.s.freq === "433 MHz" && !("zzz" in m.update.s), "champ court : rempli seulement s'il était vide, clé inconnue ignorée");
ok(m.skipped.length === 1, "valeur différente d'un champ déjà rempli : signalée, pas écrite");
ok(m.update.t.proc2.split("\n").length === 3 && m.update.t.proc2.startsWith("Lire le code PIN"), "texte : ajouté à la suite, ligne déjà présente non répétée");
ok(m.prev.s.freq === "" && m.prev.t.proc2 === V[0].t.proc2 && !("chip" in m.prev.s), "état d'avant gardé pour annuler");
const again = mergeSheet({ ...V[0], ...m.update }, { s: { freq: "433 MHz" }, t: { proc2: "Attendre 15 min si le tableau de bord affiche antidémarrage." } });
ok(!Object.keys(again.update).length && !again.changes.length, "même demande envoyée deux fois : rien n'est ajouté");
m = mergeSheet({ id: "x", ph: { prog: ["p1"] } }, { photos: [{ i: 0, section: "prog" }, { i: 1, section: "ecu" }, { i: 5, section: "ecu" }] }, ["p1", "p2"]);
ok(m.update.ph.prog.length === 1 && m.update.ph.ecu.join() === "p2", "photo déjà sur la fiche non répétée, nouvelle photo rangée");
// utilitaires
ok(imageBlock("data:image/jpeg;base64,AAAA").source.media_type === "image/jpeg" && imageBlock("data:text/html;base64,AAAA") === null, "photo -> bloc image ; autre contenu refusé");
ok(parseJson('voici : {"a":1} fin').a === 1, "JSON extrait de la réponse");
ok(/crédit/.test(apiMessage({ status: 400 })) && /clé/i.test(apiMessage({ status: 401 })) && /occupé/.test(apiMessage({ status: 529 })), "messages d'erreur lisibles");
// fileRequest : parcours complet avec un faux Claude
const calls = [];
const deps = answers => ({ vehicles: V, getPhoto: async id => id === "bad" ? "" : "data:image/jpeg;base64,AAAA", ask: async a => { calls.push(a); return answers.shift(); } });
let r = await fileRequest({ text: "clio 4 2016 carte : attendre 15 min si antidémarrage affiché", photoIds: ["ph1"] },
  deps(['{"brand":"Renault","model":"Clio","year":"2016","variant":"ml"}', '{"vehicleId":"c4","s":{"freq":"433 MHz"},"t":{"notes":"Attendre 15 min si antidémarrage affiché."},"photos":[{"i":0,"section":"prog"}],"resume":"Rangé dans À savoir."}']));
ok(r.state === "done" && r.vehicleId === "c4" && r.update.t.notes && r.update.ph.prog[0] === "ph1" && r.changes.length === 3, "note + photo rangées sur la bonne fiche");
ok(calls.length === 2 && calls[0].content[0].type === "image" && /Renault/.test(calls[0].content[1].text) && calls[1].content.at(-1).text.includes("id=c4 |"), "2 appels : identification puis rangement avec les fiches candidates");
ok(calls[1].content.at(-1).text.indexOf("id=c4 |") < calls[1].content.at(-1).text.indexOf("id=c4l |"), "variante mains libres proposée en premier");
calls.length = 0;
r = await fileRequest({ text: "lishi VA2T", vehicleId: "p308" }, deps(['{"vehicleId":"","s":{"lishi":"VA2T"},"t":{},"photos":[],"resume":"ok"}']));
ok(r.state === "done" && r.vehicleId === "p308" && r.update.s.lishi === "VA2T" && calls.length === 1, "depuis une fiche : un seul appel, fiche imposée");
r = await fileRequest({ text: "twingo 2 perte totale" }, deps(['{"brand":"Renault","model":"Twingo","year":"","variant":""}']));
ok(r.state === "err" && /non reconnu/.test(r.msg), "véhicule sans fiche : message clair, rien d'écrit");
r = await fileRequest({ text: "", photoIds: [] }, deps([]));
ok(r.state === "err", "demande vide refusée sans appel");
r = await fileRequest({ text: "note", vehicleId: "c3", photoIds: ["bad", "ph2"] }, deps(['{"vehicleId":"c3","s":{},"t":{},"photos":[{"i":0,"section":"ecu"}],"resume":""}']));
ok(r.update.ph.ecu[0] === "ph2", "photo illisible ignorée : l'indice suit les photos réellement envoyées");
console.log("OK " + n + " vérifications");
