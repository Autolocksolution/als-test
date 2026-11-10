// Clés aftermarket partagées entre marques.
// MODE=apercu : LECTURE SEULE. Liste les clés aftermarket (nom, réf., compatibilités, quantité, marque, « aussi visible chez »),
//   chiffrée avec controle/stock.pem (RSA-OAEP-SHA256 + AES-256-GCM) : le journal public n'affiche que le rapport chiffré.
// MODE=applique : ajoute des marques à « aussi visible chez » selon PLAN = {"<id>":["kia",...]} (identifiants et marques seulement).
//   N'ajoute que des marques, ne retire rien, ne touche pas aux quantités.
import fs from "node:fs";
import crypto from "node:crypto";
import admin from "firebase-admin";
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"))) });
const db = admin.firestore();
const MODE = process.env.MODE || "apercu";
const MARQUES = ["alfa","asiat","audi","bmw","chevrolet","chrysler","citroen","dacia","daewoo","dodge","fiat","ford","honda","hyundai","isuzu","iveco","jaguar","jeep","kia","lancia","landrover","lexus","mazda","mercedes","mg","mini","mitsubishi","nissan","opel","peugeot","porsche","psa","renault","saab","seat","skoda","smart","ssangyong","subaru","suzuki","tesla","toyota","vag","volkswagen","volvo"];
const snap = await db.collection("items").where("section", "==", "aftermarket").get();
if (MODE === "apercu") {
  const L = snap.docs.map(d => { const v = d.data(); return { id: d.id, group: v.group, also: v.also || [], name: v.name || "", ref: v.ref || "", compat: v.compat || "", note: v.note || "", qty: v.qty, series: v.series || "" }; });
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(JSON.stringify({ at: Date.now(), items: L }), "utf8"), c.final()]);
  const pub = fs.readFileSync(new URL("../controle/stock.pem", import.meta.url), "utf8");
  const k = crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key);
  console.log("RAPPORT " + Buffer.from(JSON.stringify({ k: k.toString("base64"), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), d: data.toString("base64") })).toString("hex"));
  console.log("OK " + L.length + " clés aftermarket");
} else if (MODE === "applique") {
  const plan = JSON.parse(process.env.PLAN || "{}"), ids = new Set(snap.docs.map(d => d.id));
  let n = 0;
  for (const [id, add] of Object.entries(plan)) {
    if (!ids.has(id) || !Array.isArray(add) || !add.every(g => MARQUES.includes(g))) { console.log("ignoré " + id.slice(0, 6)); continue; }
    await db.doc("items/" + id).update({ also: admin.firestore.FieldValue.arrayUnion(...add) });
    n++;
  }
  console.log("OK " + n + " clés mises à jour");
}
