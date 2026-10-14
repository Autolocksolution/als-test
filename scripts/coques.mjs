// Neoriv : coques de clé. MODE=dry : découvre catégories/produits (rapport) ; MODE=apply : crée les lignes de stock (qty 0) avec photo.
import fs from "node:fs";
const MODE = process.env.MODE || "dry";
const UA = { headers: { "User-Agent": "Mozilla/5.0" } };
const get = async u => { for (let k = 0; k < 3; k++) { try { const r = await fetch(u, UA); if (r.ok) return await r.text(); if (r.status === 404) return ""; } catch (e) {} await new Promise(r => setTimeout(r, 800)); } return ""; };
const EXCL = new Set(["267", "163", "2146"]); // accessoires, boutons, accessoires : exclus
const strip = t => t.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const RX = /\/fr\/(\d+)-[^"#?]*coques?-(?:de-)?cles?[^"#?]*/i;

const cats = new Map(); // id -> {id,url,name,parent}
const products = new Map(); // id -> {id,url,name,img,cat,brand}
const queue = [{ id: "3", url: "https://neoriv.com/fr/3-coque-de-cles", name: "Coque de clés", parent: null, brand: null }];
cats.set("3", queue[0]);
while (queue.length) {
  const c = queue.shift();
  for (let p = 1; p <= 30; p++) {
    const html = await get(`${c.url}?page=${p}&resultsPerPage=100`);
    if (!html) break;
    if (p === 1) {
      const sub = html.split(/id="subcategories"/)[1];
      const zone = sub ? sub.split(/<\/section>|id="products"|class="products/)[0] : "";
      for (const m of zone.matchAll(/<a[^>]+href="(https:\/\/neoriv\.com\/fr\/(\d+)-[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
        const id = m[2]; if (EXCL.has(id) || cats.has(id)) continue;
        const n = { id, url: m[1], name: strip(m[3]) || m[1].split("/").pop(), parent: c.id, brand: c.id === "3" ? null : c.brand };
        n.brand = c.id === "3" ? n.name : c.brand; cats.set(id, n); queue.push(n);
      }
    }
    let n = 0;
    for (const blk of html.split(/<article[^>]+product-miniature/).slice(1)) {
      const a = /href="(https:\/\/neoriv\.com\/fr\/[^"#]+?\/(\d+)-([^"#]+?)\.html)/.exec(blk);
      const im = /<img[^>]+(?:data-full-size-image-url|src)="([^"]+\.jpg)"/.exec(blk);
      const nm = /class="[^"]*product-title[^"]*"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/.exec(blk);
      if (!a) continue;
      n++;
      if (!products.has(a[2])) products.set(a[2], { id: a[2], url: a[1], name: nm ? strip(nm[1]) : a[3], img: im ? im[1].replace(/home_default|medium_default|large_default/, "superlarge_default") : "", cat: c.name, brand: c.brand || c.name });
    }
    if (!n) break;
    if (n < 100 && !/rel="next"/.test(html)) break;
  }
}
// références
const list = [...products.values()].filter(p => !/^MER/i.test(p.ref || ""));
let idx = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (idx < list.length) {
    const p = list[idx++];
    const html = await get(p.url);
    const m = /"sku"\s*:\s*"([^"]+)"/.exec(html) || /itemprop="sku"[^>]*content="([^"]+)"/.exec(html) || /(?:Référence|Reference)[^<]*<\/[^>]+>\s*<span[^>]*>([^<]+)</i.exec(html) || /product-reference[^>]*>\s*<span[^>]*>([^<]+)</.exec(html);
    p.ref = m ? strip(m[1]) : "";
    const t = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html); if (t) p.name = strip(t[1]);
    const big = /property="og:image"\s+content="([^"]+)"/.exec(html); if (big && !p.img) p.img = big[1];
  }
}));
const report = { cats: [...cats.values()].map(c => ({ id: c.id, name: c.name, parent: c.parent, brand: c.brand })), n: list.length, brands: {}, products: list };
for (const p of list) report.brands[p.brand] = (report.brands[p.brand] || 0) + 1;
fs.writeFileSync("../coques.json", JSON.stringify(report, null, 1));
if (MODE !== "apply") process.exit(0);

import admin from "firebase-admin";
const sharp = (await import("sharp")).default;
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"))) });
const db = admin.firestore();
const exist = new Set((await db.collection("items").where("section", "==", "coque").get()).docs.map(d => d.data().nid));
const MAP = { TY: "toyota", CP: "citroen-peugeot", DS: "citroen-peugeot", CI: "citroen-peugeot", RE: "renault", FD: "ford", HK: "hyundai-kia", BM: "bmw", HD: "honda", NI: "nissan", FI: "fiat", OP: "opel", VL: "volvo", MZ: "mazda", MC: "mercedes", MB: "mercedes", SU: "suzuki", VK: "volkswagen", MI: "mitsubishi", CV: "chevrolet", PS: "porsche", AU: "audi", MN: "mini", LR: "land-rover", JA: "land-rover", SM: "smart", CH: "chrysler", AR: "alfa-romeo", LE: "lexus" };
const grpOf = ref => MAP[(/^[A-Za-z]+/.exec(ref || "") || [""])[0].toUpperCase()] || "autres";
const slug = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const res = { created: 0, skipped: 0, nophoto: 0, errors: [] };
let k = 0;
await Promise.all(Array.from({ length: 5 }, async () => {
  while (k < list.length) {
    const p = list[k++];
    if (exist.has(p.id)) { res.skipped++; continue; }
    try {
      let pid = null;
      if (p.img) {
        const buf = Buffer.from(await (await fetch(p.img, UA)).arrayBuffer());
        const jpg = await sharp(buf).resize(520, 520, { fit: "inside", background: "#fff" }).flatten({ background: "#fff" }).jpeg({ quality: 78 }).toBuffer();
        pid = "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        await db.collection("photos").doc(pid).set({ d: "data:image/jpeg;base64," + jpg.toString("base64"), by: "robot", at: Date.now() });
      } else res.nophoto++;
      await db.collection("items").add({ section: "coque", group: grpOf(p.ref), series: "", name: p.ref || p.name, ref: p.ref || "", compat: p.name, note: "", qty: 0, photoId: pid, nid: p.id, src: "neoriv", at: Date.now(), by: "robot" });
      res.created++;
    } catch (e) { res.errors.push(p.id + " " + String(e).slice(0, 80)); }
  }
}));
fs.writeFileSync("../coques-result.json", JSON.stringify(res, null, 1));
