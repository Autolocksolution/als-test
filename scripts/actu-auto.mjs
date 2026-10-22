// Robot « Actu » quotidien, 100 % GitHub : lit les flux RSS de sites spécialisés, fait trier et
// résumer en français par GitHub Models (jeton GITHUB_TOKEN, aucune clé à gérer), puis ajoute les
// actus retenues directement dans Firestore (collection news, création seule, jamais d'écrasement).
// Aucune donnée client n'est lue ni envoyée : seulement des articles publics.
import fs from "node:fs";
import crypto from "node:crypto";
import { clean } from "./actu-lib.mjs";

const MAX = 10, JOURS = 21;
// Ces blogs ont un certificat https expiré : lecture en http (articles publics uniquement, rien n'est envoyé).
const FLUX = [
  "http://blog.obdii365.com/feed/",
  "http://www.key-programmer.org/feed/",
  "http://blog.xhorsevvdi.com/feed/",
  "http://blog.vvdishop.com/feed/",
  "http://blog.keydiy.eu/feed/",
  "http://blog.xhorsetool.com/feed/",
];
const MOTS = /(key|cl[ée]|akl|all keys lost|immo|transponder|transpondeur|remote|t[ée]l[ée]commande|smart|proximity|pin|bcm|bsi|uch|esl|elv|xhorse|keydiy|autel|obdstar|lonsdor|abrites|yanhua|acdp|launch|silca|cgdi|vvdi|im508|im608|x300|lishi|blade|lame)/i;
const MARQUES = /(renault|dacia|peugeot|citro[eë]n|\bds\b|opel|vauxhall|vw|volkswagen|seat|skoda|audi|toyota|lexus|fiat|ford|nissan|hyundai|kia|mercedes|benz|bmw|mini|psa|stellantis|mqb|mlb)/i;

const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, " ");
const texte = html => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i")); return m ? decode(m[1]).trim() : ""; };

async function get(url, ms = 15000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal, headers: { "user-agent": "Mozilla/5.0 (AutoLockSolution actu)" } }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.text(); }
  finally { clearTimeout(t); }
}

async function ia(messages, max_tokens = 900) {
  const r = await fetch("https://models.github.ai/inference/chat/completions", {
    method: "POST",
    headers: { authorization: "Bearer " + process.env.GITHUB_TOKEN, "content-type": "application/json", accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    body: JSON.stringify({ model: process.env.MODELE || "openai/gpt-4.1-mini", messages, temperature: 0.2, max_tokens }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error("IA HTTP " + r.status + " " + t.slice(0, 120));
  let j; try { j = JSON.parse(t); } catch (e) { throw new Error("IA réponse illisible (" + r.status + ", " + (r.headers.get("content-type") || "") + ") : " + t.slice(0, 80)); }
  return j.choices?.[0]?.message?.content || "";
}
const jsonDe = s => { const m = s.match(/\[[\s\S]*\]|\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; };

export async function lance({ db, ecrire = true }) {
  const etat = { at: new Date().toISOString(), flux: {}, candidats: 0, retenus: 0, ajoutes: 0, erreurs: [] };
  // déjà connues : base + fichiers du dépôt
  const connues = new Set();
  (await db.collection("news").select("url").get()).forEach(d => { connues.add(d.id); const u = d.get("url"); if (u) connues.add(u.replace(/\/+$/, "")); });
  for (const f of fs.readdirSync(new URL("../actu/", import.meta.url))) {
    const t = fs.readFileSync(new URL("../actu/" + f, import.meta.url), "utf8");
    for (const m of t.matchAll(/https?:\/\/[^\s"\t]+/g)) connues.add(m[0].replace(/\/+$/, ""));
  }
  const limite = Date.now() - JOURS * 864e5, cands = [];
  for (const u of FLUX) {
    try {
      const xml = await get(u); let n = 0;
      for (const it of xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []) {
        const titre = texte(tag(it, "title")), lien = tag(it, "link").replace(/\/+$/, ""), d = Date.parse(tag(it, "pubDate")) || 0;
        const extrait = texte(tag(it, "description")).slice(0, 300);
        if (!lien || connues.has(lien) || d < limite) continue;
        if (!MOTS.test(titre + " " + extrait) || !MARQUES.test(titre + " " + extrait)) continue;
        cands.push({ n: cands.length, titre, lien, date: d ? new Date(d).toISOString().slice(0, 10) : "", source: new URL(lien).hostname.replace(/^www\./, ""), extrait }); n++;
      }
      etat.flux[new URL(u).hostname] = n + " / " + ((xml.match(/<item[\s>]/gi) || []).length) + " articles";
    } catch (e) { etat.flux[new URL(u).hostname] = "indisponible : " + String(e.cause?.code || e.message).slice(0, 60); }
  }
  etat.candidats = cands.length;
  if (!cands.length) return etat;
  const liste = cands.slice(0, 60).map(c => `${c.n}. [${c.source}, ${c.date}] ${c.titre} — ${c.extrait.slice(0, 160)}`).join("\n");
  etat.exemples = cands.slice(0, 3).map(c => c.titre.slice(0, 80));
  const choix = jsonDe(await ia([
    { role: "system", content: "Tu tries des articles pour deux serruriers automobiles en France (clés, programmation, toutes clés perdues, cartes Renault, BSI PSA). Tu rejettes la publicité pure, les doublons de sujet, les sujets sans intérêt en France. Réponds uniquement par un tableau JSON de numéros, du plus utile au moins utile." },
    { role: "user", content: `Choisis au maximum ${MAX} articles vraiment utiles parmi :\n${liste}` },
  ], 200)) || [];
  const retenus = choix.filter(n => Number.isInteger(n) && cands[n]).slice(0, MAX).map(n => cands[n]);
  etat.retenus = retenus.length;
  const out = [];
  for (const c of retenus) {
    try {
      const page = texte(await get(c.lien)).slice(0, 5000);
      if (page.length < 300) continue;
      const r = jsonDe(await ia([
        { role: "system", content: "Tu écris en français simple pour un serrurier automobile. N'invente rien : uniquement ce que dit l'article. Réponds par un objet JSON {\"titre\": titre court en français qui cite le véhicule ou l'outil, \"resume\": 2 à 4 phrases : véhicule, outil, méthode qui marche, piège à éviter, \"kind\": \"forum\" si retour d'expérience d'un utilisateur sinon \"web\", \"utile\": true/false}." },
        { role: "user", content: `Titre : ${c.titre}\nSource : ${c.source}\nTexte :\n${page}` },
      ], 500));
      if (!r || r.utile === false) continue;
      const id = "c-auto-" + crypto.createHash("sha1").update(c.lien).digest("hex").slice(0, 12);
      out.push(clean({ id, title: String(r.titre || c.titre).slice(0, 190), url: c.lien, source: c.source + (r.kind === "forum" ? " · retour d'utilisateur" : ""), kind: r.kind === "forum" ? "forum" : "web", summary: String(r.resume || "").slice(0, 1900), date: c.date, at: Date.now() }));
    } catch (e) { etat.erreurs.push(c.source + " : " + String(e.message).slice(0, 80)); }
  }
  for (const { id, data } of out) {
    if (!ecrire) continue;
    try { await db.collection("news").doc(id).create(data); etat.ajoutes++; }
    catch (e) { if (!(e && (e.code === 6 || /ALREADY_EXISTS/.test(e.message || "")))) throw e; }
  }
  etat.actus = out.map(o => ({ id: o.id, ...o.data }));
  return etat;
}

if (process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.GITHUB_TOKEN) {
  const admin = (await import("firebase-admin")).default;
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"))) });
  let etat;
  try { etat = await lance({ db: admin.firestore() }); }
  catch (e) { etat = { at: new Date().toISOString(), echec: String(e.cause?.code || e.message).slice(0, 200) }; }
  const jour = etat.at.slice(0, 10);
  if (etat.actus && etat.actus.length) fs.writeFileSync(new URL(`../actu/${jour}-auto.json`, import.meta.url), JSON.stringify(etat.actus, null, 1));
  delete etat.actus;
  fs.writeFileSync(new URL("../actu/robot-etat.txt", import.meta.url), JSON.stringify(etat, null, 1));
  console.log(`Actu auto : ${etat.ajoutes} ajoutée(s)`);
}
