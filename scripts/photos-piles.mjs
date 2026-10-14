// Cherche les photos de piles chez Neoriv. MODE=dry : liste les candidats ; MODE=apply : pose les photos choisies (CHOIX json id->url).
import fs from "node:fs";
import admin from "firebase-admin";
const MODE = process.env.MODE || "dry";
const CODES = ["1632", "1225", "2032", "2025", "1616", "2450", "1620", "1220", "2430"];
const report = {};
const seen = new Map();
for (const cat of ["247-piles-lithium-oxyde-alcaline", "466-piles-lithium-camelion"]) {
  for (let p = 1; p <= 6; p++) {
    const r = await fetch(`https://neoriv.com/fr/${cat}?page=${p}&resultsPerPage=100`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) break;
    const html = await r.text();
    let n = 0;
    for (const blk of html.split(/<article[^>]+product-miniature/).slice(1)) {
      const a = /href="(https:\/\/neoriv\.com\/fr\/[^"#]+?\/(\d+)-([^"#]+?)\.html)/.exec(blk);
      const im = /<img[^>]+src="([^"]+\.jpg)"/.exec(blk);
      if (!a || !im) continue;
      n++;
      if (!seen.has(a[2])) seen.set(a[2], { url: a[1], slug: a[3], img: im[1].replace("home_default", "superlarge_default") });
    }
    if (!n) break;
  }
}
report.products = seen.size;
report.cand = {};
for (const c of CODES) report.cand[c] = [...seen.values()].filter(x => new RegExp("cr" + c + "(?!\\d)", "i").test(x.slug)).map(x => ({ slug: x.slug, img: x.img, url: x.url }));
fs.writeFileSync("../photos-piles.json", JSON.stringify(report, null, 1));
if (MODE === "apply") {
  const sharp = (await import("sharp")).default;
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"))) });
  const db = admin.firestore();
  const choix = JSON.parse(process.env.CHOIX); // { itemId: imageUrl }
  const done = {};
  for (const [id, url] of Object.entries(choix)) {
    const snap = await db.collection("items").doc(id).get();
    if (!snap.exists) { done[id] = "absent"; continue; }
    if (snap.data().photoId || snap.data().photo) { done[id] = "a déjà une photo, ignorée"; continue; }
    const buf = Buffer.from(await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).arrayBuffer());
    const jpg = await sharp(buf).resize(520, 520, { fit: "inside", background: "#fff" }).flatten({ background: "#fff" }).jpeg({ quality: 78 }).toBuffer();
    const d = "data:image/jpeg;base64," + jpg.toString("base64");
    const pid = "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await db.collection("photos").doc(pid).set({ d, by: "robot", at: Date.now() });
    await db.collection("items").doc(id).update({ photoId: pid, photo: null });
    done[id] = "ok " + jpg.length + " octets";
  }
  fs.writeFileSync("../photos-piles-result.json", JSON.stringify(done, null, 1));
}
