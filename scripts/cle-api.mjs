// Restreint la clé web Firebase aux domaines de l'appli (MODE=apply) ou la rend de nouveau libre (MODE=off). Sortie : ../cle-api.json
import fs from "node:fs";
import admin from "firebase-admin";
const KEY = "AIzaSyCAnJg9b_5_eRs8F3Li36FX7kevmiUZbq4", PROJECT = "autlocksolution", MODE = process.env.MODE || "list";
const cred = admin.credential.cert(JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8")));
admin.initializeApp({ credential: cred });
const tok = (await cred.getAccessToken()).access_token, H = { authorization: "Bearer " + tok, "content-type": "application/json" };
const out = { mode: MODE };
const call = async (url, opt = {}) => { const r = await fetch(url, { headers: H, ...opt }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = t.slice(0, 300); } return { status: r.status, j }; };
const list = await call(`https://apikeys.googleapis.com/v2/projects/${PROJECT}/locations/global/keys`);
out.list_status = list.status;
if (list.status !== 200) { out.erreur = JSON.stringify(list.j).slice(0, 400); }
else {
  out.keys = [];
  for (const k of list.j.keys || []) {
    const ks = await call(`https://apikeys.googleapis.com/v2/${k.name}/keyString`);
    const mine = ks.j && ks.j.keyString === KEY;
    out.keys.push({ name: k.name.split("/").pop(), display: k.displayName, mine, restrictions: k.restrictions || null });
    if (mine && (MODE === "apply" || MODE === "off")) {
      const restrictions = { ...(k.restrictions || {}) };
      if (MODE === "apply") restrictions.browserKeyRestrictions = { allowedReferrers: ["https://autolocksolution.github.io/*", "https://autlocksolution.firebaseapp.com/*", "https://autlocksolution.web.app/*"] };
      else delete restrictions.browserKeyRestrictions;
      const p = await call(`https://apikeys.googleapis.com/v2/${k.name}?updateMask=restrictions`, { method: "PATCH", body: JSON.stringify({ restrictions }) });
      out.patch = { status: p.status, resp: JSON.stringify(p.j).slice(0, 300) };
    }
  }
}
fs.writeFileSync("../cle-api.json", JSON.stringify(out, null, 1));
