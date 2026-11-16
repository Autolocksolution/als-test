// Rangement automatique par Claude : l'appli dépose un texte (et des photos) dans la collection « ia »,
// le robot retrouve la fiche du véhicule, demande à Claude où ranger chaque information, puis complète la fiche.
// Règle d'or : on COMPLÈTE, on ne remplace jamais et on n'écrit pas deux fois la même chose.
// Ce fichier ne contient que la logique (testable sans réseau) ; le robot (send-reminders.mjs) fournit db et clé.

export const MODEL = "claude-haiku-5-5";
export const DAY_MAX = 150;          // plafond quotidien de demandes (garde-fou sur la dépense)
export const PHOTO_MAX = 3;

// Champs courts (fiche.s) et textes (fiche.t), avec leur intitulé dans l'appli.
export const S_FIELDS = {
  chip: "Transpondeur (type de puce)", blade: "Lame (profil, ex. VA2, HU83)", ml: "Mains libre (OUI/NON)", clone: "Puce clonable ? (OUI/NON)",
  immo: "Système immo", pinRead: "Lecture code PIN (OUI PAR OBD / OUI SUR TABLE (BANC) / OUI / NON)", pinLen: "Nombre de chiffres du code PIN",
  akl: "Programmation en perte totale ? (OUI PAR OBD / OUI SUR TABLE (BANC) / OUI / NON)", add: "Ajout de clé ? (OUI PAR OBD / NON)",
  immoProg: "Programmation antidémarrage", rcProg: "Programmation télécommande", precode: "Précodage puce nécessaire ? (OUI/NON)",
  immoRead: "Lecture données immo", lishi: "Lishi (référence de l'outil)", tool: "Matériel utilisé (AUTEL / ZED-FULL / …)",
  type: "Type de clé", freq: "Fréquence", batt: "Batterie (pile)", gw: "Présence gateway (OUI/NON)", obd: "Emplacement de la prise OBD",
};
export const T_FIELDS = {
  proc1: "Ajout d'une clé (une clé fonctionne déjà) : procédure", proc2: "Toutes clés perdues : procédure", tools: "Outils et logiciels compatibles",
  lock: "Crochetage / ouverture", notes: "À savoir, pièges", obdNote: "Prise OBD : précisions (démontage, cache…)",
  lameNote: "Lame : taillage, code, profil, remarques", ecuLoc: "Calculateur : où il se trouve (accès, démontage…)",
  ecuRefs: "Références des calculateurs moteur (une par ligne)", boxes: "Autres boîtiers, un par ligne : nom : emplacement",
  boxNote: "Autres boîtiers : remarques (démontage, connecteurs…)", forum: "Infos trouvées sur les forums",
};
export const PH_SECTIONS = { specs: "Spécifications / clé", obd: "Prise OBD", lame: "Lame", prog: "Programmation", lock: "Crochetage", notes: "À savoir", ecu: "Calculateur", boxes: "Autres boîtiers" };

export const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clip = (s, n) => String(s || "").slice(0, n);

export function label(v) {
  const y = v.yFrom || v.yTo ? " (" + (v.yFrom || "…") + "-" + (v.yTo || "…") + ")" : "";
  return [v.brand, v.model, v.gen && norm(v.gen) !== norm(v.model) ? v.gen : ""].filter(Boolean).join(" ") + y;
}

// Fiches possibles pour une marque / un modèle / une année (du plus précis au plus large).
export function candidates(vehicles, { brand, model, year } = {}, max = 8) {
  const nb = norm(brand), nm = norm(model), y = +year || 0;
  if (!nm && !nb) return [];
  const words = nm.split(" ").filter(Boolean);
  const score = v => {
    const vb = norm(v.brand), vm = norm([v.model, v.gen].join(" "));
    let s = 0;
    if (nb && vb === nb) s += 3; else if (nb && (vb.includes(nb) || nb.includes(vb)) && vb) s += 1; else if (nb) s -= 2;
    if (nm) {
      if (norm(v.model) === nm) s += 6;
      else if ((" " + vm + " ").includes(" " + nm + " ")) s += 5;
      else { const hit = words.filter(w => (" " + vm + " ").includes(" " + w + " ")).length; if (!hit) return -99; s += 4 * hit / words.length; }
    }
    if (y && (v.yFrom || v.yTo)) s += (!v.yFrom || y >= v.yFrom) && (!v.yTo || y <= v.yTo) ? 3 : -3;
    return s;
  };
  let list = vehicles.map(v => [score(v), v]).filter(x => x[0] >= (nm ? 3 : 2)).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  // année connue : si des fiches couvrent cette année, on écarte celles des autres générations
  const inY = v => (v.yFrom || v.yTo) && (!v.yFrom || y >= v.yFrom) && (!v.yTo || y <= v.yTo);
  if (y && list.some(inY)) list = list.filter(v => inY(v) || !(v.yFrom || v.yTo));
  return list.slice(0, max);
}

// Texte déjà présent ? (comparaison sans accents, ponctuation ni casse ; « contient » suffit)
export function already(existing, line) {
  const a = norm(existing), b = norm(line);
  if (!b) return true;
  if ((" " + a + " ").includes(" " + b + " ")) return true;
  const wb = b.split(" ").filter(w => w.length > 2);
  if (wb.length < 4) return false;
  // même phrase reformulée de très près : presque tous les mots significatifs déjà dans une même ligne
  return String(existing || "").split(/\n+/).some(l => { const set = new Set(norm(l).split(" ")); return wb.filter(w => set.has(w)).length / wb.length >= 0.9; });
}

// Fusion : renvoie la mise à jour Firestore, la liste lisible des changements et l'état d'avant (pour « Annuler »).
export function mergeSheet(v, add, photoIds = []) {
  const s = { ...(v.s || {}) }, t = { ...(v.t || {}) }, ph = { ...(v.ph || {}) };
  const changes = [], skipped = [], prev = { s: {}, t: {}, ph: {} };
  for (const [k, raw] of Object.entries(add.s || {})) {
    const val = clip(String(raw ?? "").trim(), 80);
    if (!(k in S_FIELDS) || !val) continue;
    if (!String(s[k] || "").trim()) { prev.s[k] = s[k] || ""; s[k] = val; changes.push(S_FIELDS[k].split(" (")[0] + " : " + val); }
    else if (norm(s[k]) !== norm(val)) skipped.push(S_FIELDS[k].split(" (")[0] + " déjà rempli (« " + clip(s[k], 40) + " ») : « " + val + " » non écrit");
  }
  for (const [k, raw] of Object.entries(add.t || {})) {
    if (!(k in T_FIELDS)) continue;
    const cur = String(t[k] || "");
    const lines = String(raw ?? "").split(/\n+/).map(x => x.trim()).filter(Boolean);
    const fresh = [];
    for (const l of lines) if (!already(cur + "\n" + fresh.join("\n"), l)) fresh.push(clip(l, 400));
    if (!fresh.length) continue;
    const next = clip((cur.trim() ? cur.trim() + "\n" : "") + fresh.join("\n"), 2000);
    if (next === cur) continue;
    prev.t[k] = cur; t[k] = next;
    changes.push(T_FIELDS[k].split(" :")[0].split(" (")[0] + " : + " + fresh.length + " ligne" + (fresh.length > 1 ? "s" : ""));
  }
  for (const p of add.photos || []) {
    const id = photoIds[p && p.i], sec = p && p.section in PH_SECTIONS ? p.section : "notes";
    if (!id) continue;
    if (Object.values(ph).some(a => (a || []).includes(id))) continue;       // même photo déjà sur la fiche
    if (!(sec in prev.ph)) prev.ph[sec] = (ph[sec] || []).slice();
    ph[sec] = [...(ph[sec] || []), id];
    changes.push("Photo ajoutée : " + PH_SECTIONS[sec]);
  }
  const update = {};
  if (Object.keys(prev.s).length) update.s = s;
  if (Object.keys(prev.t).length) update.t = t;
  if (Object.keys(prev.ph).length) update.ph = ph;
  return { update, changes, skipped, prev };
}

const sheetText = v => {
  const out = ["id=" + v.id + " | " + label(v)];
  for (const k in S_FIELDS) if ((v.s || {})[k]) out.push("  s." + k + " = " + clip(v.s[k], 80));
  for (const k in T_FIELDS) if ((v.t || {})[k]) out.push("  t." + k + " =\n" + clip(v.t[k], 1200).split("\n").map(l => "    " + l).join("\n"));
  return out.join("\n");
};

export const SYS_FIND = `Tu aides un serrurier automobile à ranger ses notes dans sa base de véhicules.
À partir de sa note (et des photos éventuelles), identifie le véhicule concerné.
Réponds UNIQUEMENT par un objet JSON : {"brand":"","model":"","year":"","variant":""}
- brand : la marque, écrite comme dans la liste fournie si elle y figure.
- model : le modèle (ex. "Clio 4", "308", "Kangoo 2"), sans la marque.
- year : l'année sur 4 chiffres si elle est donnée ou lisible, sinon "".
- variant : "ml" si la note parle d'une clé mains libres / carte, "lame" si clé à lame, sinon "".
Si aucun véhicule n'est identifiable, renvoie des chaînes vides.`;

export const sysFile = () => `Tu ranges les notes d'un serrurier automobile dans la fiche du bon véhicule de sa base.
On te donne : sa note, parfois des photos, et une ou plusieurs fiches candidates avec ce qu'elles contiennent déjà.

Réponds UNIQUEMENT par un objet JSON :
{"vehicleId":"","s":{},"t":{},"photos":[],"resume":""}
- vehicleId : l'id de la fiche qui correspond le mieux (parmi les candidates). "" si aucune ne correspond.
- s : champs courts à remplir, valeur brève. Clés autorisées :
${Object.entries(S_FIELDS).map(([k, l]) => "  " + k + " : " + l).join("\n")}
- t : textes à AJOUTER (une information par ligne, phrases courtes, en français). Clés autorisées :
${Object.entries(T_FIELDS).map(([k, l]) => "  " + k + " : " + l).join("\n")}
- photos : pour chaque photo utile, {"i": numéro de la photo (0 = première), "section": une de ${Object.keys(PH_SECTIONS).join(", ")}}.
- resume : une phrase courte disant ce que tu as rangé et où.

Règles strictes :
1. N'écris QUE ce qui vient de la note ou des photos. N'invente rien, ne complète pas avec tes connaissances.
2. N'ajoute PAS ce qui figure déjà dans la fiche, même formulé autrement. Si tout y est déjà, renvoie s et t vides.
3. Ne remplis un champ court (s) que s'il est vide dans la fiche.
4. Mets chaque information dans la rubrique la plus précise ; « notes » seulement pour les pièges et remarques générales.
5. N'écris jamais de donnée de client : pas de plaque d'immatriculation, pas de nom, pas de téléphone, pas d'adresse, pas de code PIN ni de code de clé propre à une voiture.
6. Corrige l'orthographe et mets en forme proprement, sans changer le sens ni les références techniques.`;

export function parseJson(text) {
  const a = String(text || "").indexOf("{"), b = String(text || "").lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("réponse illisible");
  return JSON.parse(text.slice(a, b + 1));
}

// Photo de l'appli (data:image/...;base64,...) -> bloc image de l'API
export function imageBlock(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  return m ? { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } } : null;
}

export async function callClaude({ key, system, content, maxTokens = 1200, fetchImpl = fetch }) {
  const r = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) { const e = new Error("api " + r.status); e.status = r.status; throw e; }
  const j = await r.json();
  return (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
}

// Message affiché dans l'appli quand l'appel à Claude échoue (jamais le détail technique).
export function apiMessage(e) {
  const s = e && e.status;
  if (s === 401 || s === 403) return "La clé Claude est refusée : vérifiez-la dans GitHub (secret ANTHROPIC_API_KEY).";
  if (s === 400 || s === 402) return "Claude a refusé la demande : le crédit du compte est peut-être épuisé.";
  if (s === 429 || s === 529 || s >= 500) return "Claude est occupé pour le moment : réessayez dans quelques minutes.";
  return "Le rangement n'a pas abouti : réessayez.";
}

// Traite une demande. deps : { vehicles (tableau à jour), getPhoto(id) -> dataUrl, ask({system, content}) -> texte }
export async function fileRequest(req, deps) {
  const text = clip(String(req.text || "").trim(), 4000);
  const ids = (Array.isArray(req.photoIds) ? req.photoIds : []).filter(x => typeof x === "string").slice(0, PHOTO_MAX);
  if (!text && !ids.length) return { state: "err", msg: "Rien à ranger : écrivez une note ou ajoutez une photo." };
  const imgs = [];
  for (const id of ids) { const b = imageBlock(await deps.getPhoto(id)); imgs.push(b); }
  const blocks = imgs.filter(Boolean);
  const note = "Note du serrurier :\n" + (text || "(aucun texte, voir les photos)");
  let cands;
  if (req.vehicleId) {
    const v = deps.vehicles.find(x => x.id === req.vehicleId);
    if (!v) return { state: "err", msg: "Cette fiche n'existe plus." };
    cands = [v];
  } else {
    const brands = [...new Set(deps.vehicles.map(v => v.brand).filter(Boolean))].sort().join(", ");
    const found = parseJson(await deps.ask({ system: SYS_FIND, content: [...blocks, { type: "text", text: "Marques de la base : " + brands + "\n\n" + note }], maxTokens: 200 }));
    cands = candidates(deps.vehicles, found);
    if (found.variant === "ml" || found.variant === "lame") {
      const isMl = v => /mains[- ]libres?|keyless|carte/i.test([(v.s || {}).type, v.gen, (v.s || {}).ml === "OUI" ? "mains libres" : ""].join(" "));
      const pref = cands.filter(v => isMl(v) === (found.variant === "ml"));
      if (pref.length) cands = [...pref, ...cands.filter(v => !pref.includes(v))];
    }
    if (!cands.length) return { state: "err", msg: "Véhicule non reconnu" + (found.model ? " (« " + clip([found.brand, found.model].filter(Boolean).join(" "), 60) + " »)" : "") + ". Ouvrez la fiche du véhicule et relancez depuis là." };
  }
  const ans = parseJson(await deps.ask({ system: sysFile(), content: [...blocks, { type: "text", text: note + "\n\nPhotos jointes : " + blocks.length + "\n\nFiches candidates :\n\n" + cands.map(sheetText).join("\n\n") }] }));
  const v = cands.length === 1 ? cands[0] : cands.find(x => x.id === ans.vehicleId);
  if (!v) return { state: "err", msg: "Je n'ai pas su choisir la fiche. Ouvrez la fiche du véhicule et relancez depuis là." };
  // l'indice de photo donné par Claude porte sur les photos lisibles ; on le ramène aux identifiants d'origine
  const okIds = ids.filter((_, i) => imgs[i]);
  const m = mergeSheet(v, { s: ans.s, t: ans.t, photos: ans.photos }, okIds);
  return { state: "done", vehicleId: v.id, label: label(v), update: m.update, changes: m.changes, skipped: m.skipped, prev: m.prev, resume: clip(ans.resume, 300) };
}
