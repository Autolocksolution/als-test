/* AutoLockSolution : lecture des tickets (carburant, péage) directement dans le téléphone.
   Aucune photo ne quitte l'appareil pour être lue. Chargé à la demande par l'appli.
   Expose window.ALSTicket = { parse(texte), scan(fichier, onEtat) } (et module.exports pour les tests). */
(function (root) {
  "use strict";

  /* ======================= ANALYSE DU TEXTE ======================= */
  const strip = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const low = s => strip(s).toLowerCase();
  const DIG = { "]": "1", "!": "1", O: "0", o: "0", D: "0", Q: "0", l: "1", I: "1", "|": "1", i: "1", S: "5", s: "5", B: "8", Z: "2", z: "2", G: "6" };
  const deconf = t => t.replace(/[OoDQlI|iSsBZzG]/g, c => DIG[c] || c);

  /* montants au format 12,34 / 12.34 / 12 , 34 (2 décimales exactement) */
  function amountsIn(line, colon) {
    const out = [];
    // jetons candidats, avec confusions de chiffres tolérées (O→0, l→1, S→5…)
    const C = "[\\dOoDlI|SsBZ\\]!]";
    const re = new RegExp("(?<![\\dA-Za-z.,:])(" + C + "{1,4})\\s?([.," + (colon ? ":" : "") + "])\\s?(" + C + "{2})(?!" + C + ")", "g");
    let m;
    while ((m = re.exec(line))) {
      const a = deconf(m[1]), b = deconf(m[3]);
      if (!/^\d+$/.test(a) || !/^\d{2}$/.test(b)) continue;
      out.push({ v: parseInt(a, 10) + parseInt(b, 10) / 100, idx: m.index, raw: m[0] });
    }
    return out;
  }

  const TVAW = /\b[tiljf1]\.?v\.?a\b|\bt\.?v\.?a|taxe/;
const FUELS = [
    ["Gazole", /gazole|diesel|gasoil|\bgo\b|b7|b10/],
    ["SP95-E10", /sp\s?95[\s-]?e\s?10|e\s?10\b|sans\s*plomb\s*95[\s-]*e10/],
    ["SP98", /sp\s?98|sans\s*plomb\s*98|\b98\b.*ron/],
    ["SP95", /sp\s?95|sans\s*plomb|\b95\b.*ron|unleaded/],
    ["E85", /\be\s?85\b|superethanol/],
    ["GPL", /\bgpl\b|\blpg\b/],
  ];
  const STATIONS = [
    ["TotalEnergies", /t[o0]tal\s?energies|\bt[o0]tal\s+(?:access|relais|station|express)/], ["Esso", /\besso\b/], ["Shell", /\bshell\b/], ["BP", /\bbp\b/],
    ["Avia", /\bavia\b/], ["Intermarché", /intermarche/], ["E.Leclerc", /leclerc/], ["Carrefour", /carrefour/],
    ["Auchan", /auchan/], ["Casino", /\bcasino\b/], ["Système U", /systeme\s?u|super\s?u|hyper\s?u|\bu\s?express\b/],
    ["Cora", /\bcora\b/], ["Netto", /\bnetto\b/], ["Dyneff", /dyneff/], ["Elan", /\belan\b/], ["Eni", /\beni\b|\bagip\b/],
    ["Access", /\baccess\b/], ["Géant", /geant\s*casino/], ["Bricomarché", /bricomarche/], ["Leader Price", /leader\s*price/],
  ];
  const PEAGES = [
    ["VINCI Autoroutes", /vinci/], ["ASF", /\basf\b|autoroutes\s*du\s*sud/], ["Cofiroute", /cofiroute/], ["Escota", /escota/],
    ["APRR", /\baprr\b/], ["AREA", /\barea\b/], ["Sanef", /sanef/], ["SAPN", /\bsapn\b/], ["ATMB", /atmb/],
    ["ALIS", /\balis\b/], ["ALIAE", /aliae/], ["Tunnel du Fréjus", /frejus/], ["Tunnel du Mont-Blanc", /mont[\s-]*blanc/],
    ["Viaduc de Millau", /millau/], ["Pont de Normandie", /pont\s*de\s*normandie/], ["SANEF Tunnel", /tunnel/],
  ];
  const PEAGE_WORDS = /pe\s?age|autoroute|barriere|telepeage|classe\s*[1-5]\b|\bvoie\s*\d|gare\s*de|entree|sortie|liber[\s-]*t|tunnel|viaduc|vinci|aprr|sanef|cofiroute|escota|\basf\b|\batmb\b|\bsapn\b/;
  const FUEL_WORDS = /gazole|diesel|sp\s?9[58]|e\s?10\b|e\s?85\b|gpl\b|carburant|litre|pompe|station|\bvolume\b|\bqte\b|quantite|\bprix\s*\/?\s*l\b|excellium|v-?power|ultimate|total\s?energies|\bpu\b/;

  /* dates : jj/mm/aaaa, jj-mm-aa, jj.mm.aa, aaaa-mm-jj ; tolère les O/l lus à la place de 0/1 */
  function datesIn(text, today) {
    const found = [];
    const add = (d, m, y, idx, kw) => {
      d = +d; m = +m; y = +y; if (y < 100) y += 2000;
      if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2015)) return;
      const dt = new Date(Date.UTC(y, m - 1, d)); if (dt.getUTCMonth() !== m - 1) return;
      const iso = dt.toISOString().slice(0, 10);
      const maxIso = new Date(today.getTime() + 36 * 3600e3).toISOString().slice(0, 10);
      if (iso > maxIso) return;
      found.push({ iso, idx, kw });
    };
    const tok = "[\\dOoIl|]";
    const re1 = new RegExp("(?<![\\d])(" + tok + "{1,2})\\s?[\\/\\-.]\\s?(" + tok + "{1,2})\\s?[\\/\\-.]\\s?((?:20|2O)?" + tok + "{2})(?![\\d])", "g");
    let m;
    while ((m = re1.exec(text))) add(deconf(m[1]), deconf(m[2]), deconf(m[3]), m.index, /date|le\s*$/i.test(text.slice(Math.max(0, m.index - 12), m.index)));
    const re2 = /(?<!\d)(20\d{2})[\/\-.](\d{2})[\/\-.](\d{2})(?!\d)/g;
    while ((m = re2.exec(text))) add(m[3], m[2], m[1], m.index, false);
    return found;
  }

  const digs = v => String(v).replace(/\D/g, "").replace(/^0+/, "");
  function lev(a, b) { const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i]); for (let j = 1; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; }
  const RATES = [0.2, 0.1, 0.055, 0.021];
  /* paires (HT, TVA) dont la somme donne un TTC présent sur le ticket */
  function vatPairs(vals) {
    const out = [];
    for (const a of vals) for (const b of vals) {
      if (!(b > 0 && b < a)) continue;
      const r = b / a; if (!RATES.some(x => Math.abs(r - x) <= x * 0.02 + 0.002)) continue;
      out.push({ ht: a, vat: b, ttc: Math.round((a + b) * 100) / 100 });
    }
    return out;
  }
  function parse(text, opts) {
    opts = opts || {};
    const today = opts.today || new Date();
    const raw = String(text || "").replace(/\r/g, "");
    const lines = raw.split("\n").map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
    const L = lines.map(low);
    const whole = L.join("\n");
    const res = { kind: null, date: null, total: null, vat: null, litres: null, ppl: null, vendor: "", fuel: "", label: "", flags: [], notes: [] };

    /* ---- type ---- */
    let fs = 0, ps = 0;
    for (const l of L) { if (FUEL_WORDS.test(l)) fs += 1; if (PEAGE_WORDS.test(l)) ps += 1; }
    FUELS.forEach(([, re]) => { if (re.test(whole)) fs += 2; });
    PEAGES.forEach(([, re]) => { if (re.test(whole)) ps += 2; });
    if (/\bl\b\s*x|\d\s*l\b/.test(whole)) fs += 1;
    const peageStrong = /pe\s?age|telepeage|barriere\s*de\s*pe/.test(whole);
    if (peageStrong) ps += 3;
    res.kind = fs === 0 && ps === 0 ? null : (ps > fs ? "peage" : "essence");
    if (res.kind === null) res.flags.push("kind");
    else if (Math.abs(fs - ps) < 2) res.flags.push("kind");

    /* ---- carburant, litres, prix au litre ---- */
    for (const [name, re] of FUELS) if (re.test(whole)) { res.fuel = name; break; }
    const pplCands = [];
    L.forEach((l, i) => {
      const re = /(?<![\d.,])([12])\s?[.,]\s?(\d{3})(?!\d)/g; let m;
      while ((m = re.exec(l))) { const v = +(m[1] + "." + m[2]); if (v >= 1.0 && v <= 3.2) pplCands.push({ v, i, kw: /prix|\/\s?l|pu\b|eur\s?\/|litre/.test(l) }); }
    });
    const litCands = [];
    L.forEach((l, i) => {
      const re = /(?<![\d.,])(\d{1,3})\s?[.,]\s?(\d{2,3})\s?(?:l\b|ltr|litres?|lt\b)/g; let m;
      while ((m = re.exec(deconf2(l)))) { const v = +(m[1] + "." + m[2]); if (v >= 2 && v <= 250) litCands.push({ v: Math.round(v * 100) / 100, i, kw: 2 }); }
      if (/volume|quantit|\bqte\b|\bqty\b/.test(l)) {
        for (const a of amountsIn(l)) if (a.v >= 2 && a.v <= 250) litCands.push({ v: a.v, i, kw: 1 });
        const re3 = /(?<![\d.,])(\d{1,3})\s?[.,]\s?(\d{3})(?!\d)/g; let m3;
        while ((m3 = re3.exec(l))) { const v = +(m3[1] + "." + m3[2]); if (v >= 2 && v <= 250) { litCands.push({ v, i, kw: 1, src3: true }); litCands.push({ v: +(m3[1] + "." + m3[2].slice(0, 2)), i, kw: 1.5, src3: true }); } }
      }
    });
    function deconf2(l) { return l.replace(/(\d)\s*o(?=[\d.,])/g, "$10"); }

    /* ---- montant total ---- */
    const cands = [];
    const bad = /(?:^|\s)(ht|h\.t\.)(?:\s|$)|hors\s*tax|sous[\s-]*total|rendu|monnaie|espece[s]?\s*rendu|remise|reduction|fidelite|cumul|points?\b|prix\s*(?:au\s*)?(?:litre|\/\s*l)|\/\s?l\b|eur\s?\/\s?l/;
    L.forEach((l, i) => {
      let am = amountsIn(lines[i], /total|ttc|payer|montant/.test(l));
      if (!am.length) return;
      for (const a of am) {
        let s = 0;
        if (/total\s*(ttc|a\s*payer|eur|€|general|carte)?|net\s*a\s*payer|\ba\s*payer\b|somme\s*due|montant\s*(ttc|total|a\s*payer|du|regle|debite|carte|cb)/.test(l)) s += 10;
        if (/\bttc\b|t\.t\.c/.test(l)) s += 5;
        if (/montant|prix\b|tarif/.test(l) && s < 10) s += 3;
        if (/\bcb\b|carte|visa|mastercard|paiement|reglement|debit|contactless|emv|telepeage|badge/.test(l)) s += 4;
        if (TVAW.test(l) && !/ttc|total|payer/.test(l)) s -= 12;
        if (bad.test(l)) s -= 9;
        // montant sur la ligne suivante d'un libellé « TOTAL » sans chiffre
        cands.push({ v: a.v, i, s, line: l });
      }
    });
    // libellé de total sans montant : regarder la ligne suivante
    L.forEach((l, i) => {
      if (/total|a\s*payer|montant/.test(l) && !amountsIn(lines[i]).length && i + 1 < L.length) {
        for (const a of amountsIn(lines[i + 1])) cands.push({ v: a.v, i: i + 1, s: 6, line: L[i + 1] });
      }
    });
    const allVals = []; L.forEach((l, i) => amountsIn(lines[i], true).forEach(a => allVals.push(a.v)));
    const pairs = vatPairs([...new Set(allVals)]);
    // cohérence litres × prix
    const best = (arr, f) => arr.slice().sort((a, b) => f(b) - f(a))[0];
    const counts = new Map(); cands.forEach(c => counts.set(c.v, (counts.get(c.v) || 0) + 1));
    for (const c of cands) {
      if (counts.get(c.v) > 1) c.s += Math.min(4, 2 * (counts.get(c.v) - 1));
      if (pairs.some(q => Math.abs(q.ttc - c.v) <= 0.011)) c.s += 7;
      for (const p of pplCands) for (const li of litCands) {
        if (Math.abs(li.v * p.v - c.v) <= 0.011) c.s += 8;
      }
      const maxAllowed = res.kind === "peage" ? 150 : 400;
      if (c.v <= 0 || c.v > maxAllowed) c.s -= 20;
      if (res.kind === "essence" && c.v < 4) c.s -= 6;
    }
    if (cands.length) {
      const mx = Math.max(...cands.map(c => c.v));
      cands.forEach(c => { if (c.v === mx) c.s += 1; });
      const sorted = cands.slice().sort((a, b) => b.s - a.s || b.v - a.v);
      const top = sorted[0];
      res.total = Math.round(top.v * 100) / 100;
      const second = sorted.find(c => c.v !== top.v);
      if (top.s < 6 || (second && top.s - second.s < 3)) res.flags.push("total");
    } else res.flags.push("total");

    /* ---- litres / prix au litre cohérents avec le total ---- */
    if (res.kind === "essence") {
      let pick = null;
      if (res.total != null) {
        for (const li of litCands) for (const p of pplCands) {
          const d = Math.abs(li.v * p.v - res.total), dd = d + (Math.round(li.v * 1000) % 10 ? 0.004 : 0);
          if (!pick || dd < pick.dd) pick = { li, p, d, dd };
        }
        if (pick && pick.d <= 0.011) { res.litres = pick.li.v; res.ppl = pick.p.v; }
        else if (pick && pick.d <= 0.30) {
          const li = pick.li.v, pp = pick.p.v, T = res.total;
          const hypL = Math.round(T / pp * 100) / 100, hypP = Math.round(T / li * 1000) / 1000, hypT = Math.round(li * pp * 100) / 100;
          const okL = lev(digs(hypL.toFixed(2)), digs(li.toFixed(li * 1000 % 10 ? 3 : 2))) <= 1;
          const okP = lev(digs(hypP.toFixed(3)), digs(pp.toFixed(3))) <= 1;
          const okT = lev(digs(hypT.toFixed(2)), digs(T.toFixed(2))) <= 1;
          const confirmed = (counts.get(T) || 0) > 1 || pairs.some(q => Math.abs(q.ttc - T) <= 0.011);
          const n = (okL ? 1 : 0) + (okP ? 1 : 0) + (okT ? 1 : 0);
          const li3 = !!pick.li.src3;
          if (okL && (n === 1 || li3)) { res.litres = hypL; res.ppl = pp; res.notes.push("litres corrigés d'après le total"); }
          else if (okP && n === 1) { res.litres = li; res.ppl = hypP; res.notes.push("prix au litre corrigé d'après le total"); }
          else if (okT && n === 1 && !confirmed) { res.total = hypT; res.litres = li; res.ppl = pp; res.notes.push("total recalculé : litres × prix (lu " + T.toFixed(2) + ")"); if (!res.flags.includes("total")) res.flags.push("total"); }
          else { res.litres = li; res.ppl = pp; res.notes.push("litres × prix ne tombent pas juste : vérifier"); if (!res.flags.includes("total")) res.flags.push("total"); }
        }
        else {
          // un seul des deux lu : on déduit l'autre et on vérifie la plausibilité
          const l1 = best(litCands, c => c.kw);
          if (l1 && !pplCands.length) { const p = res.total / l1.v; if (p >= 1.1 && p <= 3.0) { res.litres = l1.v; res.ppl = Math.round(p * 1000) / 1000; } }
          const p1 = best(pplCands, c => c.kw ? 2 : 1);
          if (!res.litres && p1 && !litCands.length) { const l = res.total / p1.v; if (l >= 2 && l <= 250) { res.litres = Math.round(l * 100) / 100; res.ppl = p1.v; res.notes.push("litres déduits du total"); } }
          if (!res.litres && l1) { res.litres = l1.v; res.flags.push("litres"); }
        }
      } else {
        const l1 = best(litCands, c => c.kw), p1 = best(pplCands, c => c.kw ? 2 : 1);
        if (l1) res.litres = l1.v;
        if (l1 && p1) { const prod = Math.round(l1.v * p1.v * 100) / 100; if (prod >= 4 && prod <= 400) { res.total = prod; res.ppl = p1.v; res.notes.push("total calculé : litres × prix"); const k = res.flags.indexOf("total"); if (k < 0) res.flags.push("total"); } }
      }
      if (res.litres == null) res.flags.push("litres");
    }

    /* ---- TVA ---- */
    if (res.total != null) {
      const pp = pairs.filter(q => Math.abs(q.ttc - res.total) <= 0.011).sort((x, y) => Math.abs(x.vat / x.ht - 0.2) - Math.abs(y.vat / y.ht - 0.2));
      if (pp.length) res.vat = pp[0].vat;
      else {
        // TTC − HT : on cherche un HT lu dont la différence avec le total est une TVA plausible
        const h = [...new Set(allVals)].map(a => ({ a, b: Math.round((res.total - a) * 100) / 100 })).filter(q => q.b > 0 && q.a > q.b && RATES.some(x => Math.abs(q.b / q.a - x) <= x * 0.02 + 0.002));
        if (h.length) res.vat = h.sort((x, y) => Math.abs(x.b / x.a - 0.2) - Math.abs(y.b / y.a - 0.2))[0].b;
      }
      const allRows = res.vat != null ? [] : L.map((l, i) => ({ i, am: amountsIn(lines[i]) })).filter(r => r.am.length >= 2);
      for (const r of allRows) {
        const v = r.am.map(a => a.v);
        for (let a = 0; a < v.length && res.vat == null; a++) for (let b = 0; b < v.length && res.vat == null; b++) for (let c = 0; c < v.length; c++) {
          if (a === b || b === c || a === c) continue;
          if (Math.abs(v[a] + v[b] - v[c]) <= 0.02 && Math.abs(v[c] - res.total) <= 0.02 && v[b] < v[a]) { res.vat = v[b]; break; }
        }
        if (res.vat != null) break;
      }
      if (res.vat == null) {
        const vs = [];
        L.forEach((l, i) => {
          if (!TVAW.test(l)) return;
          let am = amountsIn(lines[i]).map(a => a.v);
          if (!am.length && i + 1 < L.length) am = amountsIn(lines[i + 1]).map(a => a.v);
          am.filter(v => v > 0 && v < res.total * 0.21 && Math.abs(v - res.total) > 0.01).forEach(v => vs.push(v));
        });
        if (vs.length) {
          const exp = res.total / 6; // 20 % de TVA sur un TTC
          vs.sort((a, b) => Math.abs(a - exp) - Math.abs(b - exp));
          res.vat = vs[0];
        }
      }
    }
    if (res.vat == null && res.total != null) {
      const vs = [];
      L.forEach((l, i) => {
        if (!/\b(20|10|5[.,]5|2[.,]1)\s?(?:[.,]0+)?\s?%/.test(l)) return;
        amountsIn(lines[i]).forEach(a => { if (a.v > 0 && a.v < res.total * 0.21 && Math.abs(a.v - res.total / 6) < res.total * 0.04 + 0.02) vs.push(a.v); });
      });
      if (vs.length) res.vat = vs[0];
    }
    if (res.vat != null) res.vat = Math.round(res.vat * 100) / 100;

    /* ---- date ---- */
    const ds = datesIn(raw, today);
    if (ds.length) {
      ds.sort((a, b) => (b.kw - a.kw) || (a.idx - b.idx));
      res.date = ds[0].iso;
      if (new Set(ds.map(d => d.iso)).size > 1) res.flags.push("date");
    } else res.flags.push("date");

    res.pay = /esp[eè]ces|especes|\bcash\b|liquide/.test(whole) && !/carte|\bcb\b|visa|mastercard|contactless/.test(whole) ? "especes" : "carte";

    /* ---- libellé ---- */
    let vendor = "";
    if (res.kind === "peage") {
      for (const [name, re] of PEAGES) if (re.test(whole)) { vendor = name; break; }
      const ent = /entr[ée]e\s*:?\s*([a-z0-9' .\-]{3,28})/i.exec(strip(raw)), sor = /sortie\s*:?\s*([a-z0-9' .\-]{3,28})/i.exec(strip(raw));
      const tidy = s => s.replace(/\s+/g, " ").replace(/\b(classe|heure|date)\b.*$/i, "").trim().replace(/\b(\w)(\w*)/g, (m0, a, b) => a.toUpperCase() + b.toLowerCase());
      let trip = "";
      if (ent && sor) trip = tidy(ent[1]) + " → " + tidy(sor[1]);
      res.vendor = vendor;
      res.label = ("Péage" + (vendor ? " " + vendor : "") + (trip ? " · " + trip : "")).slice(0, 120);
    } else if (res.kind === "essence") {
      let bi = 1e9;
      for (const [name, re] of STATIONS) { const m = re.exec(whole); if (m && m.index < bi) { bi = m.index; vendor = name; } }
      if (!vendor && L.slice(0, 4).some(l => /^t[o0]tal$/.test(l))) vendor = "TotalEnergies";
      res.vendor = vendor;
      res.label = ((vendor ? vendor : "Carburant") + (res.fuel ? " · " + res.fuel : "")).slice(0, 120);
    } else {
      res.label = lines[0] ? lines[0].slice(0, 60) : "";
    }
    return res;
  }

  /* ======================= IMAGE : pré-traitement ======================= */
  const isBrowser = typeof document !== "undefined";
  function cv(w, h) { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }

  async function loadBitmap(file) {
    if (typeof createImageBitmap === "function") {
      try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) { /* on retombe sur <img> */ }
    }
    return await new Promise((res, rej) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); res(im); };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("image illisible")); };
      im.src = url;
    });
  }
  const bw = b => b.width || b.naturalWidth, bh = b => b.height || b.naturalHeight;

  /* image grise réduite pour analyser (ticket, inclinaison) */
  function smallGray(src, maxSide) {
    const r = Math.min(1, maxSide / Math.max(bw(src), bh(src)));
    const c = cv(bw(src) * r, bh(src) * r), x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(src, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data, g = new Uint8Array(c.width * c.height);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    return { g, w: c.width, h: c.height, r };
  }
  function otsu(g) {
    const h = new Uint32Array(256); for (let i = 0; i < g.length; i++) h[g[i]]++;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * h[i];
    let sB = 0, wB = 0, mx = 0, t = 127; const tot = g.length;
    for (let i = 0; i < 256; i++) { wB += h[i]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sB += i * h[i]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > mx) { mx = v; t = i; } }
    return t;
  }
  /* rectangle du papier : plus grande zone claire, centrée. Renvoie null si on ne trouve rien de sûr. */
  function findPaper(src) {
    const s = smallGray(src, 360), t = otsu(s.g);
    const lab = new Int32Array(s.w * s.h), stack = [];
    let bestN = 0, bestBox = null, id = 0;
    for (let i = 0; i < s.g.length; i++) {
      if (lab[i] || s.g[i] <= t) continue;
      id++; let n = 0, x0 = s.w, y0 = s.h, x1 = 0, y1 = 0; stack.push(i); lab[i] = id;
      while (stack.length) {
        const p = stack.pop(), x = p % s.w, y = (p / s.w) | 0; n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && !lab[p - 1] && s.g[p - 1] > t) { lab[p - 1] = id; stack.push(p - 1); }
        if (x < s.w - 1 && !lab[p + 1] && s.g[p + 1] > t) { lab[p + 1] = id; stack.push(p + 1); }
        if (y > 0 && !lab[p - s.w] && s.g[p - s.w] > t) { lab[p - s.w] = id; stack.push(p - s.w); }
        if (y < s.h - 1 && !lab[p + s.w] && s.g[p + s.w] > t) { lab[p + s.w] = id; stack.push(p + s.w); }
      }
      if (n > bestN) { bestN = n; bestBox = { x0, y0, x1, y1 }; }
    }
    if (!bestBox) return null;
    const area = (bestBox.x1 - bestBox.x0 + 1) * (bestBox.y1 - bestBox.y0 + 1);
    if (area < 0.12 * s.w * s.h || area > 0.97 * s.w * s.h) return null;
    const m = 0.02;
    const k = 1 / s.r;
    const x0 = Math.max(0, (bestBox.x0 - m * s.w) * k), y0 = Math.max(0, (bestBox.y0 - m * s.h) * k);
    const x1 = Math.min(bw(src), (bestBox.x1 + m * s.w) * k), y1 = Math.min(bh(src), (bestBox.y1 + m * s.h) * k);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  /* inclinaison du texte (degrés) par maximisation du contraste des profils de lignes */
  function estimateSkew(c) {
    const s = smallGray(c, 520), t = otsu(s.g), pts = [];
    for (let y = 0; y < s.h; y += 1) for (let x = 0; x < s.w; x += 1) if (s.g[y * s.w + x] < t * 0.85) pts.push(x, y);
    if (pts.length < 600) return 0;
    const score = a => {
      const sn = Math.sin(a), cs = Math.cos(a), bins = new Float32Array(s.h * 2 + 8);
      for (let i = 0; i < pts.length; i += 2) { const yy = (pts[i + 1] * cs - pts[i] * sn) + s.h * 0.5 + 4; if (yy >= 0 && yy < bins.length) bins[yy | 0]++; }
      let sum = 0, sq = 0, n = bins.length; for (let i = 0; i < n; i++) { sum += bins[i]; sq += bins[i] * bins[i]; }
      return sq / n - (sum / n) * (sum / n);
    };
    let bestA = 0, bestS = -1;
    for (let d = -10; d <= 10; d += 1) { const sc = score(d * Math.PI / 180); if (sc > bestS) { bestS = sc; bestA = d; } }
    for (let d = bestA - 0.9; d <= bestA + 0.9; d += 0.3) { const sc = score(d * Math.PI / 180); if (sc > bestS) { bestS = sc; bestA = d; } }
    return bestA;
  }
  function rotated(c, deg, fill) {
    const a = deg * Math.PI / 180, w = c.width, h = c.height;
    const W = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)), H = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
    const o = cv(W, H), x = o.getContext("2d"); x.fillStyle = fill || "#fff"; x.fillRect(0, 0, o.width, o.height);
    x.translate(o.width / 2, o.height / 2); x.rotate(a); x.drawImage(c, -w / 2, -h / 2); return o;
  }
  /* gris + suppression des ombres + étirement du contraste */
  function normalize(c) {
    const w = c.width, h = c.height, x = c.getContext("2d", { willReadFrequently: true }), im = x.getImageData(0, 0, w, h), d = im.data;
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    // fond estimé par flou très large (réduction puis agrandissement lissé)
    const sw = Math.max(8, Math.round(w / 24)), sh = Math.max(8, Math.round(h / 24));
    const sm = cv(sw, sh), sx = sm.getContext("2d", { willReadFrequently: true });
    const gc = cv(w, h), gx = gc.getContext("2d"); gx.drawImage(c, 0, 0);
    sx.imageSmoothingQuality = "high"; sx.drawImage(gc, 0, 0, sw, sh);
    const bg = cv(w, h), bx = bg.getContext("2d", { willReadFrequently: true }); bx.imageSmoothingQuality = "high"; bx.drawImage(sm, 0, 0, w, h);
    const bd = bx.getImageData(0, 0, w, h).data;
    // un fond « clair » : on prend le max local pour ne pas effacer les gros caractères
    const out = new Float32Array(w * h); let lo = 255, hi = 0;
    for (let i = 0, j = 0; j < out.length; i += 4, j++) {
      const b = Math.max(40, bd[i] * 0.299 + bd[i + 1] * 0.587 + bd[i + 2] * 0.114);
      const v = Math.min(255, g[j] / b * 235); out[j] = v;
    }
    const hist = new Uint32Array(256); for (let j = 0; j < out.length; j++) hist[out[j] | 0]++;
    let acc = 0, p1 = 0, p99 = 255; for (let i = 0; i < 256; i++) { acc += hist[i]; if (!p1 && acc > out.length * 0.01) p1 = i; if (acc > out.length * 0.985) { p99 = i; break; } }
    const span = Math.max(40, p99 - p1);
    for (let i = 0, j = 0; j < out.length; i += 4, j++) { const v = Math.max(0, Math.min(255, (out[j] - p1) / span * 255)); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    x.putImageData(im, 0, 0); return c;
  }
  /* variante « noir et blanc » : seuil local (utile pour les tickets pâles ou flous) */
  function binarized(c) {
    const w = c.width, h = c.height, x = c.getContext("2d", { willReadFrequently: true }), im = x.getImageData(0, 0, w, h), d = im.data;
    const I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let xx = 0; xx < w; xx++) { row += d[(y * w + xx) * 4]; I[(y + 1) * (w + 1) + xx + 1] = I[y * (w + 1) + xx + 1] + row; } }
    const r = Math.max(10, Math.round(w / 45));
    const o = cv(w, h), ox = o.getContext("2d"), od = ox.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let xx = 0; xx < w; xx++) {
        const x0 = Math.max(0, xx - r), x1 = Math.min(w, xx + r + 1);
        const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
        const mean = sum / ((x1 - x0) * (y1 - y0)), v = d[(y * w + xx) * 4] < mean * 0.86 ? 0 : 255, k = (y * w + xx) * 4;
        od.data[k] = od.data[k + 1] = od.data[k + 2] = v; od.data[k + 3] = 255;
      }
    }
    ox.putImageData(od, 0, 0); return o;
  }
  async function prepare(file, opt) {
    opt = opt || {};
    const bmp = await loadBitmap(file);
    let sx = 0, sy = 0, sw = bw(bmp), sh = bh(bmp);
    const box = opt.noCrop ? null : findPaper(bmp);
    if (box) { sx = box.x; sy = box.y; sw = box.w; sh = box.h; }
    // largeur cible : environ 1500 px, sans dépasser 3× l'original ni 3400 px de côté
    let sc = Math.max(0.5, Math.min(1500 / sw, 3));
    const maxSide = 3400; if (Math.max(sw, sh) * sc > maxSide) sc = maxSide / Math.max(sw, sh);
    let c = cv(sw * sc, sh * sc), x = c.getContext("2d", { willReadFrequently: true }); x.imageSmoothingQuality = "high"; x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    c = normalize(c);
    const sk = opt.noDeskew ? 0 : estimateSkew(c);
    if (Math.abs(sk) >= 0.4) c = rotated(c, sk, "#fff");
    return { canvas: c, skew: sk, cropped: !!box };
  }

  /* ======================= OCR ======================= */
  let workerP = null, workerPsm = null;
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("moteur de lecture introuvable")); document.head.appendChild(s); });
  }
  async function getWorker(base, onEtat) {
    if (workerP) return workerP;
    workerP = (async () => {
      if (!root.Tesseract) await loadScript(new URL("tesseract.min.js", base).href);
      const w = await root.Tesseract.createWorker("fra", 1, {
        workerPath: new URL("worker.min.js", base).href,
        corePath: new URL(".", base).href,
        langPath: new URL(".", base).href,
        gzip: true,
        logger: m => { if (onEtat && m && m.status === "recognizing text") onEtat("Lecture du ticket… " + Math.round((m.progress || 0) * 100) + " %"); },
      });
      await w.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: "300" });
      return w;
    })();
    workerP.catch(() => { workerP = null; });
    return workerP;
  }
  async function recog(worker, canvas, psm) {
    if (workerPsm !== psm) { await worker.setParameters({ tessedit_pageseg_mode: String(psm) }); workerPsm = psm; }
    const r = await worker.recognize(canvas);
    return { text: r.data.text || "", conf: r.data.confidence || 0 };
  }
  const quality = p => (p.total != null ? 4 : 0) + (p.date ? 2 : 0) + (p.kind ? 1 : 0) + (p.kind === "essence" && p.litres ? 1 : 0) + (p.vat != null ? 1 : 0) - p.flags.length * 0.3;

  /* lit un ticket (File) et renvoie { parsed, text, conf } ; onEtat(texte) pour afficher l'avancement */
  /* image propre du ticket (recadrée, ombres retirées) pour le justificatif : JPEG léger */
  function proof(canvas) {
    let c = canvas; const maxSide = 2000, r = Math.min(1, maxSide / Math.max(c.width, c.height));
    if (r < 1) { const o = cv(c.width * r, c.height * r); const x = o.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, o.width, o.height); c = o; }
    let q = 0.72, d = c.toDataURL("image/jpeg", q);
    while (d.length > 620000 && q > 0.35) { q -= 0.08; d = c.toDataURL("image/jpeg", q); }
    return d;
  }
  async function scan(file, onEtat, opt) {
    opt = opt || {};
    const base = new URL(opt.base || (root.ALS_OCR || "ocr/"), root.document ? root.document.baseURI : "http://localhost/");
    onEtat && onEtat("Préparation de la photo…");
    const prep = await prepare(file, opt);
    const worker = await getWorker(base, onEtat);
    let best = null;
    const tryOne = async (canvas, psm, tag) => {
      const r = await recog(worker, canvas, psm);
      const p = parse(r.text, { today: new Date() });
      const q = quality(p) + r.conf / 100;
      if (!best || q > best.q) best = { q, parsed: p, text: r.text, conf: r.conf, tag };
      return p;
    };
    let p = await tryOne(prep.canvas, 6, "psm6");
    const good = x => x.total != null && x.date && x.kind && !x.flags.includes("total");
    if (!good(p)) { onEtat && onEtat("Deuxième lecture…"); p = await tryOne(prep.canvas, 4, "psm4"); }
    if (!good(p)) { onEtat && onEtat("Troisième lecture…"); p = await tryOne(prep.canvas, 11, "psm11"); }
    if (!good(best.parsed)) {
      onEtat && onEtat("Lecture renforcée…");
      const bn = binarized(prep.canvas);
      await tryOne(bn, 6, "bin6");
      if (!good(best.parsed)) await tryOne(bn, 4, "bin4");
    }
    if (!good(best.parsed) && best.conf < 70) {
      for (const deg of [90, 270, 180]) {
        onEtat && onEtat("Photo tournée ? Nouvel essai…");
        const rc = rotated(prep.canvas, deg, "#fff");
        await tryOne(rc, 6, "rot" + deg);
        if (good(best.parsed)) break;
      }
    }
    return { image: proof(prep.canvas), parsed: best.parsed, text: best.text, conf: best.conf, skew: prep.skew, cropped: prep.cropped, pass: best.tag };
  }

  const api = { parse, scan, prepare, proof, _amountsIn: amountsIn, _datesIn: datesIn };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ALSTicket = api;
})(typeof window !== "undefined" ? window : globalThis);
