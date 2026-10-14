// Neoriv : coques de clé. MODE=dry : découvre les catégories/produits ; MODE=apply : crée les lignes de stock (qty 0) avec photo.
import fs from "node:fs";
const MODE = process.env.MODE || "dry";
const UA = { headers: { "User-Agent": "Mozilla/5.0" } };
const get = async u => { const r = await fetch(u, UA); return r.ok ? await r.text() : ""; };
const out = { cats: [], products: [] };
const home = await get("https://neoriv.com/fr/");
const links = new Map();
for (const m of home.matchAll(/<a[^>]+href="(https:\/\/neoriv\.com\/fr\/(\d+)-[^"#]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
  const t = m[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!links.has(m[2])) links.set(m[2], { url: m[1], id: m[2], t });
}
out.allLinks = [...links.values()].filter(x => /coque|accessoire/i.test(x.t + x.url));
fs.writeFileSync("../coques.json", JSON.stringify(out, null, 1));
