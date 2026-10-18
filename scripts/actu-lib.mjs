// Validation des actus avant import dans Firestore (collection news).
// Seuls des champs connus, de type et de taille contrôlés, sont acceptés.
export const KINDS = ["web", "forum", "video"];
const str = (v, max) => typeof v === "string" && v.length <= max;

export function clean(it) {
  if (!it || typeof it !== "object") throw new Error("actu illisible");
  const { id } = it;
  if (typeof id !== "string" || !/^c-[a-z0-9][a-z0-9-]{2,90}$/.test(id)) throw new Error("identifiant invalide : " + String(id).slice(0, 40));
  if (!str(it.title, 200) || !it.title.trim()) throw new Error(id + " : titre manquant ou trop long");
  if (!str(it.url, 600) || !/^https?:\/\/[^\s]+$/i.test(it.url)) throw new Error(id + " : adresse web invalide");
  if (!str(it.summary, 2000) || !it.summary.trim()) throw new Error(id + " : résumé manquant ou trop long");
  if (it.source != null && !str(it.source, 150)) throw new Error(id + " : source trop longue");
  if (it.date != null && it.date !== "" && !(typeof it.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.date))) throw new Error(id + " : date invalide");
  const kind = KINDS.includes(it.kind) ? it.kind : "web";
  const at = Number.isFinite(it.at) && it.at > 1.7e12 && it.at < Date.now() + 864e5 ? Math.round(it.at) : Date.now();
  return { id, data: { title: it.title.trim(), url: it.url, source: (it.source || "").trim(), kind, summary: it.summary.trim(), date: it.date || "", state: "new", by: "claude", at } };
}

export function parseFile(text) {
  const arr = JSON.parse(text);
  if (!Array.isArray(arr)) throw new Error("le fichier doit contenir une liste");
  if (arr.length > 60) throw new Error("trop d'actus dans un seul fichier (60 max)");
  return arr.map(clean);
}
