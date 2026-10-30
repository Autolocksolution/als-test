// Base véhicules pré-remplie (marque, modèle, génération/phase, années, photo Wikimedia Commons, infos clé indicatives).
//   MODE=apercu : cherche 3 photos candidates par fiche sur Wikimedia Commons et produit des planches
//                 de contrôle (apercu/planche-XX.jpg) + apercu/candidats.json. Aucun accès à la base.
//   MODE=import : lit apercu/candidats.json + choix.json, télécharge la photo choisie, l'enregistre dans
//                 Firestore (photos) et crée la fiche (vehicles). N'écrase jamais une fiche faite à la main :
//                 si une fiche manuelle existe déjà pour la même marque/modèle sur des années qui se recouvrent,
//                 la fiche automatique est sautée.
import fs from "node:fs";
import crypto from "node:crypto";
import { FR } from "./base-vehicules/fr.mjs";
import { EU } from "./base-vehicules/eu.mjs";
import { ASIE } from "./base-vehicules/asie.mjs";
import { US, AUTRES } from "./base-vehicules/autres.mjs";

export const LOTS = { fr: FR, eu: EU, monde: { ...ASIE, ...US, ...AUTRES } };
const LOT = process.env.LOT || "fr";
const DIR = new URL(`./base-vehicules/apercu-${LOT}/`, import.meta.url);
const UA = "AutoLockSolution-base/1.0 (https://github.com/Autolocksolution/als-test)";

export const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const slug = s => norm(s).replace(/ /g, "-");

export function entrees(lot = LOTS[LOT]) {
  const out = [];
  for (const [brand, rows] of Object.entries(lot))
    for (const [model, gen, yFrom, yTo, q, s] of rows)
      out.push({ id: "auto-" + slug(brand + " " + gen), brand, model, gen, yFrom, yTo, q, s: s || {} });
  if (new Set(out.map(e => e.id)).size !== out.length) throw new Error("identifiants en double");
  return out;
}

const MAUVAIS = /interior|innen|innenraum|cockpit|dashboard|armaturen|engine|motor\b|heck|\brear\b|\bback\b|arri[eè]re|int[eé]rieur|badge|logo|emblem|detail|\bwheel|felge|\btrunk|kofferraum|\btail|crash|wreck|unfall|rally|rallye|\brace\b|racing|tuning|police|polizei|polizia|gendarmerie|\btaxi|model ?car|miniature|\btoys?\b|\bscale\b|diecast|sketch|drawing|\bkeys?\b|schl[uü]ssel|\blights?\b|\blamp|scheinwerfer|steering|lenkrad|concept|prototype/i;
const DEVANT = /front|vorne|frontansicht|avant|vorderansicht|\bvl\b/i;
const txt = h => String(h || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();

async function api(params) {
  const u = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({ format: "json", formatversion: "2", ...params });
  for (let i = 0; i < 4; i++) {
    const r = await fetch(u, { headers: { "User-Agent": UA } });
    if (r.ok) return r.json();
    await new Promise(s => setTimeout(s, 1500 * (i + 1)));
  }
  throw new Error("Commons injoignable");
}

export function trie(pages) {
  return pages
    .filter(p => p.imageinfo && p.imageinfo[0] && /\.(jpe?g|png)$/i.test(p.title) && !MAUVAIS.test(p.title))
    .filter(p => p.imageinfo[0].width >= 800 && p.imageinfo[0].width >= p.imageinfo[0].height)
    .sort((a, b) => (DEVANT.test(b.title) - DEVANT.test(a.title)) || (a.index - b.index));
}

async function cherche(q) {
  const j = await api({ action: "query", generator: "search", gsrsearch: q + " filetype:bitmap", gsrnamespace: "6", gsrlimit: "25",
    prop: "imageinfo", iiprop: "url|size|extmetadata", iiurlwidth: "1000", iiextmetadatafilter: "Artist|LicenseShortName" });
  return trie((j.query && j.query.pages) || []).slice(0, 3).map(p => {
    const ii = p.imageinfo[0], m = ii.extmetadata || {};
    return { title: p.title, thumb: ii.thumburl, page: ii.descriptionurl, artist: txt(m.Artist && m.Artist.value).slice(0, 80), license: txt(m.LicenseShortName && m.LicenseShortName.value).slice(0, 40) };
  });
}

async function telecharge(url) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    await new Promise(s => setTimeout(s, 2000 * (i + 1)));
  }
  throw new Error("téléchargement impossible");
}

async function planche(sharp, liste, cand, nom, num) {
  const RW = 1000, RH = 150, TW = 220, esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const comps = [];
  for (let i = 0; i < liste.length; i++) {
    const e = liste[i], y = i * RH;
    comps.push({ input: Buffer.from(`<svg width="330" height="${RH}" xmlns="http://www.w3.org/2000/svg"><rect width="330" height="${RH}" fill="${i % 2 ? "#eee" : "#fff"}"/><text x="8" y="40" font-family="DejaVu Sans" font-size="26" font-weight="bold">#${num(e, i)}</text><text x="8" y="80" font-family="DejaVu Sans" font-size="20">${esc(e.brand)}</text><text x="8" y="108" font-family="DejaVu Sans" font-size="20" font-weight="bold">${esc(e.gen)}</text><text x="8" y="134" font-family="DejaVu Sans" font-size="18">${e.yFrom}–${e.yTo || "…"}</text></svg>`), left: 0, top: y });
    for (let j = 0; j < (cand[e.id] || []).length; j++) {
      try {
        const b = await telecharge(cand[e.id][j].thumb);
        const t = await sharp(b).resize(TW - 6, RH - 26, { fit: "cover" }).jpeg({ quality: 70 }).toBuffer();
        comps.push({ input: t, left: 330 + j * TW, top: y + 2 });
        comps.push({ input: Buffer.from(`<svg width="${TW}" height="22" xmlns="http://www.w3.org/2000/svg"><text x="4" y="17" font-family="DejaVu Sans" font-size="16" font-weight="bold">${j + 1}</text></svg>`), left: 330 + j * TW, top: y + RH - 24 });
      } catch (err) { /* vignette manquante */ }
    }
  }
  await sharp({ create: { width: RW, height: liste.length * RH, channels: 3, background: "#ffffff" } }).composite(comps).jpeg({ quality: 72 }).toFile(new URL(nom, DIR).pathname);
}

const choixFile = new URL(`./base-vehicules/choix-${LOT}.json`, import.meta.url);

async function apercu() {
  const sharp = (await import("sharp")).default;
  fs.mkdirSync(DIR, { recursive: true });
  const E = entrees(), PAR = 20;
  if (process.env.RETRY) { // nouvelles recherches pour les fiches marquées {"q": "..."} dans choix
    const cand = JSON.parse(fs.readFileSync(new URL("candidats.json", DIR), "utf8")), choix = JSON.parse(fs.readFileSync(choixFile, "utf8"));
    const R = E.filter(e => choix[e.id] && choix[e.id].q);
    for (const e of R) cand[e.id] = await cherche(choix[e.id].q);
    fs.writeFileSync(new URL("candidats.json", DIR), JSON.stringify(cand, null, 1));
    for (let p = 0; p * PAR < R.length; p++) await planche(sharp, R.slice(p * PAR, p * PAR + PAR), cand, `reprise-${p + 1}.jpg`, e => E.indexOf(e) + 1);
    console.log(`Reprise : ${R.length} fiches, ${R.filter(e => cand[e.id].length).length} avec photo.`);
    return;
  }
  const cand = {};
  for (const e of E) {
    let c = await cherche(e.q);
    if (!c.length) c = await cherche(e.q.replace(/ (phase \d|facelift|\d{4})$/i, ""));
    cand[e.id] = c;
  }
  fs.writeFileSync(new URL("candidats.json", DIR), JSON.stringify(cand, null, 1));
  for (let p = 0; p * PAR < E.length; p++)
    await planche(sharp, E.slice(p * PAR, p * PAR + PAR), cand, `planche-${String(p + 1).padStart(2, "0")}.jpg`, (e, i) => p * PAR + i + 1);
  console.log(`Aperçu : ${E.length} fiches, ${Object.values(cand).filter(c => c.length).length} avec au moins une photo.`);
}

// photo retenue : n° de candidat, {from: autre fiche, n}, ou 0 / {q} non résolu = sans photo
export function retenue(choix, cand, id) {
  const ch = choix[id] ?? 1;
  if (typeof ch === "number") return ch > 0 ? (cand[id] || [])[ch - 1] || null : null;
  if (ch && ch.from) return (cand[ch.from] || [])[(ch.n || 1) - 1] || null;
  return null;
}

// numéro de génération : « Clio 4 phase 1 » → 4 ; « Megane 3 » → 3
export const genNum = (gen, model) => { const m = norm(gen).replace(norm(model), " ").replace(/phase \d+( et \d+)?/g, " ").match(/(?:^|\s)(\d{1,2})(?:\s|$)/); return m ? m[1] : null; };
// une fiche faite à la main couvre-t-elle déjà cette fiche automatique ?
export function memeFiche(v, e) {
  if (norm(v.brand) !== norm(e.brand) || norm(v.model) !== norm(e.model) || !chevauche(v, e)) return false;
  const a = genNum(v.gen, v.model), b = genNum(e.gen, e.model);
  return a && b ? a === b : true;
}
const chevauche = (a, b) => (a.yFrom || 0) <= (b.yTo || 9999) && (b.yFrom || 0) <= (a.yTo || 9999);

async function importe() {
  const sharp = (await import("sharp")).default;
  const admin = (await import("firebase-admin")).default;
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"))) });
  const db = admin.firestore();
  const cand = JSON.parse(fs.readFileSync(new URL("candidats.json", DIR), "utf8"));
  const choix = JSON.parse(fs.readFileSync(choixFile, "utf8"));
  const exist = (await db.collection("vehicles").get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const manuelles = exist.filter(v => !v.auto);
  let crees = 0, deja = 0, sautees = 0, sansPhoto = 0;
  for (const e of entrees()) {
    if (manuelles.some(v => memeFiche(v, e))) { sautees++; continue; }
    if (exist.some(v => v.id === e.id)) { deja++; continue; } // déjà importée : on n'y touche plus (photos et notes ajoutées)
    const c = retenue(choix, cand, e.id);
    let photoId = null, credit = "";
    if (c) {
      try {
        const b = await telecharge(c.thumb);
        const jpg = await sharp(b).resize(1000, 700, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 74, mozjpeg: true }).toBuffer();
        const d = "data:image/jpeg;base64," + jpg.toString("base64");
        if (d.length < 900000) {
          photoId = crypto.createHash("sha1").update(d).digest("hex").slice(0, 24);
          await db.doc("photos/" + photoId).set({ d, by: "auto", at: Date.now() });
          credit = "Photo : " + (c.artist || "Wikimedia Commons") + (c.license ? " · " + c.license : "") + " · Wikimedia Commons";
        }
      } catch (err) { /* sans photo */ }
    }
    if (!photoId) sansPhoto++;
    const key = Object.keys(e.s).length > 0;
    const data = { brand: e.brand, model: e.model, gen: e.gen, yFrom: e.yFrom, yTo: e.yTo, s: e.s,
      t: key ? { notes: "⚠️ Infos clé pré-remplies automatiquement : à vérifier avant intervention." } : {},
      links: "", diffs: [], photoId, credit, creditUrl: c ? c.page : "", auto: true, by: "auto", at: Date.now() };
    await db.doc("vehicles/" + e.id).set(data);
    crees++;
  }
  console.log(`::notice::Import ${LOT} : ${crees} créées, ${deja} déjà présentes, ${sautees} sautées (fiche manuelle existante), ${sansPhoto} sans photo.`);
}

const MODE = process.env.MODE;
if (MODE === "apercu") await apercu();
else if (MODE === "import") await importe();
else if (MODE) { console.error("MODE inconnu"); process.exit(2); }
