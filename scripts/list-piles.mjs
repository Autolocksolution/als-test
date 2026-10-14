// Liste les pièces de la section « piles » (nom, réf, photo ou non) dans piles.json
import fs from "node:fs";
import admin from "firebase-admin";
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"))) });
const snap = await admin.firestore().collection("items").where("section", "==", "piles").get();
const out = snap.docs.map(d => { const x = d.data(); return { id: d.id, name: x.name, group: x.group, series: x.series, ref: x.ref, compat: x.compat, qty: x.qty, photo: !!(x.photoId || x.photo) }; });
fs.writeFileSync("../piles.json", JSON.stringify(out, null, 1));
console.log(out.length + " pièces");
