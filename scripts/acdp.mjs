// Neoriv : Yanhua ACDP 2 + modules. MODE=dry : liste les produits trouvés ; MODE=apply : crée les lignes (qty 0) avec photo (IDS = ids Neoriv retenus, séparés par des virgules).
import fs from "node:fs";
const MODE = process.env.MODE || "dry";
const UA = { headers: { "User-Agent": "Mozilla/5.0" } };
const get = async u => { for (let k = 0; k < 3; k++) { try { const r = await fetch(u, UA); if (r.ok) return await r.text(); if (r.status === 404) return ""; } catch (e) {} await new Promise(r => setTimeout(r, 800)); } return ""; };
const strip = t => t.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const products = new Map();
const scan = async base => {
  for (let p = 1; p <= 10; p++) {
    const html = await get(`${base}${base.includes("?") ? "&" : "?"}page=${p}&resultsPerPage=100`);
    if (!html) break; let n = 0;
    for (const blk of html.split(/<article[^>]+product-miniature/).slice(1)) {
      const a = /href="(https:\/\/neoriv\.com\/fr\/[^"#]+?\/(\d+)-([^"#]+?)\.html)/.exec(blk);
      const im = /<img[^>]+(?:data-full-size-image-url|src)="([^"]+\.jpg)"/.exec(blk);
      const nm = /class="[^"]*product-title[^"]*"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/.exec(blk);
      if (!a) continue; n++;
      if (!products.has(a[2])) products.set(a[2], { id: a[2], url: a[1], name: nm ? strip(nm[1]) : a[3], img: im ? im[1].replace(/home_default|medium_default|large_default/, "superlarge_default") : "" });
    }
    if (!n || n < 100) break;
  }
};
const home = await get("https://neoriv.com/fr/");
const cats = new Map();
for (const m of home.matchAll(/<a[^>]+href="(https:\/\/neoriv\.com\/fr\/(\d+)-[^"#?]*(?:acdp|yanhua)[^"#?]*)"[^>]*>([\s\S]*?)<\/a>/gi)) cats.set(m[2], { url: m[1], t: strip(m[3]) });
for (const [id, c] of [...cats]) { const html = await get(c.url); for (const m of html.matchAll(/<a[^>]+href="(https:\/\/neoriv\.com\/fr\/(\d+)-[^"#?]*(?:acdp|yanhua)[^"#?]*)"[^>]*>([\s\S]*?)<\/a>/gi)) if (!cats.has(m[2])) cats.set(m[2], { url: m[1], t: strip(m[3]) }); }
for (const c of cats.values()) await scan(c.url);
for (const q of ["acdp", "acdp 2", "yanhua acdp"]) await scan(`https://neoriv.com/fr/recherche?controller=search&s=${encodeURIComponent(q)}`);
const list = [...products.values()];
let idx = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (idx < list.length) {
    const p = list[idx++]; const html = await get(p.url);
    const m = /"sku"\s*:\s*"([^"]+)"/.exec(html) || /itemprop="sku"[^>]*content="([^"]+)"/.exec(html);
    p.ref = m ? strip(m[1]) : "";
    const t = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html); if (t) p.name = strip(t[1]);
    const bc = [...html.matchAll(/<li[^>]*itemprop="itemListElement"[\s\S]*?<span itemprop="name">([^<]+)<\/span>/g)].map(x => strip(x[1])); p.crumbs = bc.join(" > ");
  }
}));
fs.writeFileSync("../acdp.json", JSON.stringify({ n: list.length, cats: [...cats.entries()], products: list }, null, 1));
if (MODE !== "apply") process.exit(0);

import admin from "firebase-admin";
const sharp = (await import("sharp")).default;
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"))) });
const db = admin.firestore();
const keep = new Set((process.env.IDS || "").split(",").map(x => x.trim()).filter(Boolean));
const exist = new Set((await db.collection("items").where("section", "==", "acdp").get()).docs.map(d => d.data().nid));
const grp = n => /^Pack/i.test(n) ? "packs" : /Mini ACDP 2 - programmeur/i.test(n) ? "programmeur" : /Module/i.test(n) ? "modules" : /Adaptateur/i.test(n) ? "adaptateurs" : "kits";
const res = { created: 0, skipped: 0, errors: [] };
for (const p of list.filter(p => keep.has(p.id))) {
  if (exist.has(p.id)) { res.skipped++; continue; }
  try {
    let pid = null;
    if (p.img) {
      const buf = Buffer.from(await (await fetch(p.img, UA)).arrayBuffer());
      const jpg = await sharp(buf).resize(520, 520, { fit: "inside", background: "#fff" }).flatten({ background: "#fff" }).jpeg({ quality: 78 }).toBuffer();
      pid = "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      await db.collection("photos").doc(pid).set({ d: "data:image/jpeg;base64," + jpg.toString("base64"), by: "robot", at: Date.now() });
    }
    await db.collection("items").add({ section: "acdp", group: grp(p.name), series: "", name: p.name.replace(/\s*[-–]\s*Yanhua(?: ACDP ?2)?\s*$/i, ""), ref: p.ref || "", compat: "", note: "", qty: 0, photoId: pid, nid: p.id, src: "neoriv", at: Date.now(), by: "robot" });
    res.created++;
  } catch (e) { res.errors.push(p.id + " " + String(e).slice(0, 80)); }
}
fs.writeFileSync("../acdp-result.json", JSON.stringify(res, null, 1));
