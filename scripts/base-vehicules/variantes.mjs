// Modèles / phases vendus avec deux types de clé : une fiche par type.
// Clé à lame (télécommande classique, repliable ou non) d'un côté, main libre (keyless / Kessy / Advanced Key /
// Comfort Access / Keyless-Go / Smart Key / Intelligent Key / carte mains-libres) de l'autre.
// Liste indicative établie par marque et par époque : chaque fiche créée porte « à vérifier ».
// Le nom de génération doit être exactement celui des listes (le test le vérifie).

export const VARIANTES = {
  Renault: ["Clio 3 phase 1", "Clio 3 phase 2", "Clio 4 phase 1", "Clio 4 phase 2", "Clio 5 phase 1", "Clio 5 phase 2",
    "Megane 2 phase 1", "Megane 2 phase 2", "Megane 3 phase 1", "Megane 3 phase 2", "Megane 3 phase 3", "Megane 4 phase 1", "Megane 4 phase 2",
    "Scenic 2 phase 1", "Scenic 2 phase 2", "Scenic 3 phase 1", "Scenic 3 phase 2", "Scenic 3 phase 3",
    "Laguna 2 phase 1", "Laguna 2 phase 2", "Laguna 3 phase 1", "Laguna 3 phase 2",
    "Captur 1 phase 1", "Captur 1 phase 2", "Captur 2 phase 1", "Captur 2 phase 2", "Kadjar phase 1", "Kadjar phase 2",
    "Koleos 1", "Koleos 2", "Espace 4 phase 1", "Espace 4 phase 2", "Espace 4 phase 3 et 4",
    "Modus phase 1", "Modus phase 2 / Grand Modus", "Fluence", "Zoe phase 1", "Zoe phase 2"],
  Peugeot: ["208 1 phase 1", "208 1 phase 2", "208 2 phase 1", "208 2 phase 2", "308 1 phase 2", "308 2 phase 1", "308 2 phase 2",
    "308 3 phase 1", "308 3 phase 2", "408 phase 1", "408 phase 2", "508 1 phase 1", "508 1 phase 2", "508 2 phase 1", "508 2 phase 2",
    "2008 1 phase 1", "2008 1 phase 2", "2008 2 phase 1", "2008 2 phase 2", "3008 1 phase 2", "3008 2 phase 1", "3008 2 phase 2",
    "5008 1 phase 2", "5008 2 phase 1", "5008 2 phase 2", "RCZ", "Rifter / Partner 3 phase 1", "Rifter / Partner 3 phase 2",
    "Expert 3 phase 1", "Expert 3 phase 2"],
  "Citroën": ["C3 Aircross 1 phase 1", "C3 Aircross 1 phase 2", "C4 2 phase 1", "C4 2 phase 2", "C4 3 phase 1", "C4 3 phase 2",
    "C4 Picasso 2 / SpaceTourer", "C4 Cactus phase 1", "C4 Cactus phase 2", "C5 2", "C5 Aircross phase 1", "C5 Aircross phase 2",
    "C5 Aircross 2", "C5 X", "DS4 (Citroën)", "DS5 (Citroën)", "Berlingo 3 phase 1", "Berlingo 3 phase 2", "Jumpy 3 phase 1", "Jumpy 3 phase 2"],
  DS: ["DS 4 (2015)", "DS 5 (2015)"],
  Volkswagen: ["Polo 6 (AW) phase 1", "Polo 6 (AW) phase 2", "Golf 6", "Golf 7 phase 1", "Golf 7 phase 2", "Golf 8 phase 1", "Golf 8 phase 2",
    "Golf Sportsvan", "Jetta 6", "Passat B6", "Passat B7", "Passat CC / CC", "Passat B8 phase 1", "Passat B8 phase 2", "Arteon",
    "Beetle", "Scirocco 3", "Eos", "Touran 2 phase 1", "Touran 2 phase 2", "Sharan 2", "Tiguan 1 phase 2", "Tiguan 2 phase 1", "Tiguan 2 phase 2",
    "Touareg 1", "T-Roc 1", "T-Roc 2", "T-Cross phase 1", "T-Cross phase 2", "Taigo", "Caddy 5"],
  Audi: ["A1 (8X)", "A1 (GB)", "A3 (8P)", "A3 (8V)", "A3 (8Y) phase 1", "A3 (8Y) phase 2", "A4 (B8)", "A4 (B9) phase 1", "A4 (B9) phase 2",
    "A5 (8T)", "A5 (F5)", "A6 (C6)", "A6 (C7)", "A6 (C8)", "Q2 phase 1", "Q2 phase 2", "Q3 (8U)", "Q3 (F3)", "Q5 (8R)", "Q5 (FY) phase 1",
    "Q5 (FY) phase 2", "Q7 (4L)", "TT (8J)"],
  Seat: ["Ibiza 5 phase 1", "Ibiza 5 phase 2", "Leon 3", "Leon 4 phase 1", "Leon 4 phase 2", "Arona phase 1", "Arona phase 2",
    "Ateca phase 1", "Ateca phase 2", "Tarraco", "Alhambra 2"],
  Cupra: ["Formentor phase 1", "Formentor phase 2"],
  Skoda: ["Fabia 4", "Octavia 3", "Octavia 4 phase 1", "Octavia 4 phase 2", "Superb 2", "Superb 3", "Yeti", "Kamiq phase 1", "Kamiq phase 2",
    "Karoq phase 1", "Karoq phase 2", "Kodiaq 1", "Scala phase 1", "Scala phase 2"],
  Opel: ["Corsa F phase 1", "Corsa F phase 2", "Astra J", "Astra K", "Astra L phase 1", "Astra L phase 2", "Insignia A", "Insignia B phase 1",
    "Insignia B phase 2", "Zafira C (Tourer)", "Mokka B phase 1", "Mokka B phase 2", "Crossland X phase 1", "Crossland phase 2",
    "Grandland X phase 1", "Grandland phase 2", "Combo E phase 1", "Combo E phase 2", "Vivaro C phase 1", "Vivaro C phase 2"],
  Ford: ["Fiesta 7 (Mk8) phase 1", "Fiesta 7 (Mk8) phase 2", "Focus 3 phase 1", "Focus 3 phase 2", "Focus 4 phase 1", "Focus 4 phase 2",
    "C-Max 2", "S-Max 1", "S-Max 2", "Galaxy 2", "Mondeo 4", "Mondeo 5", "Kuga 1", "Kuga 2", "Kuga 3 phase 1", "Kuga 3 phase 2",
    "Puma phase 1", "Puma phase 2", "Transit Custom 2", "Ranger 4"],
  Fiat: ["500X phase 1", "500X phase 2", "Tipo phase 1", "Tipo phase 2"],
  Jeep: ["Renegade phase 1", "Renegade phase 2", "Compass 2 phase 1", "Compass 2 phase 2", "Cherokee (KL)"],
  BMW: ["Série 1 (F20)", "Série 1 (F40)", "Série 2 Active Tourer (F45)", "Série 3 (E90)", "Série 3 (F30)", "Série 3 (G20) phase 1",
    "Série 3 (G20) phase 2", "Série 4 (F32)", "Série 5 (E60)", "Série 5 (F10)", "Série 5 (G30) phase 1", "Série 5 (G30) phase 2",
    "X1 (F48) phase 1", "X1 (F48) phase 2", "X3 (F25)", "X3 (G01) phase 1", "X3 (G01) phase 2", "X5 (E70)"],
  Mini: ["Mini (R56)", "Mini (F56) phase 1", "Mini (F56) phase 2", "Mini (F56) phase 3", "Countryman (R60)", "Countryman (F60) phase 1",
    "Countryman (F60) phase 2"],
  "Mercedes-Benz": ["Classe A (W176)", "Classe A (W177) phase 1", "Classe A (W177) phase 2", "Classe B (W246)", "Classe B (W247) phase 1",
    "Classe B (W247) phase 2", "Classe C (W204)", "Classe C (W205)", "Classe C (W206)", "Classe E (W211)", "Classe E (W212)",
    "Classe E (W213) phase 1", "Classe E (W213) phase 2", "CLA (C117)", "CLA (C118)", "GLA (X156)", "GLA (H247) phase 1", "GLA (H247) phase 2",
    "GLC (X253) phase 1", "GLC (X253) phase 2", "ML (W164)"],
  Volvo: ["S40 / V50 (2)", "C30", "V40 (2012)", "S60 / V60 (2)", "V70 / XC70 (3)", "XC60 (1)", "XC60 (2) phase 1", "XC60 (2) phase 2",
    "XC40 phase 1", "XC40 phase 2", "XC90 (2) phase 1", "V60 (2)"],
  Toyota: ["Yaris 3 phase 1", "Yaris 3 phase 2 et 3", "Yaris 4 phase 1", "Yaris 4 phase 2", "Yaris Cross phase 1", "Yaris Cross phase 2",
    "Auris 1", "Auris 2", "Corolla (E21) phase 1", "Corolla (E21) phase 2", "Avensis 3", "RAV4 3", "RAV4 4", "Land Cruiser (J120)",
    "Hilux 8 phase 1", "Hilux 8 phase 2"],
  Nissan: ["Micra K12", "Micra K13", "Micra K14", "Note E11", "Note E12", "Primera P12", "Juke 1", "Juke 2 phase 1", "Juke 2 phase 2",
    "Qashqai 1", "Qashqai 2", "Qashqai 3 phase 1", "Qashqai 3 phase 2", "X-Trail T31", "X-Trail T32", "Leaf 1", "Pulsar"],
  Honda: ["Civic 9", "Civic 10", "CR-V 4", "HR-V 2"],
  Mazda: ["Mazda2 (DJ)", "Mazda3 (BM)", "Mazda6 (GH)", "Mazda6 (GJ)", "CX-5 1", "CX-5 2 (KF) phase 1", "CX-5 2 (KF) phase 2", "CX-3", "MX-5 (ND)"],
  Mitsubishi: ["ASX 1", "Outlander 2", "Outlander 3", "Pajero 4"],
  Suzuki: ["Swift 4", "Swift 5", "SX4 1", "SX4 S-Cross", "Vitara (2015) phase 1", "Vitara (2015) phase 2", "Ignis 3 phase 1", "Ignis 3 phase 2",
    "Grand Vitara 2"],
  Subaru: ["XV 1", "Outback 4", "Forester 4"],
  Hyundai: ["i20 2", "i20 3 phase 1", "i20 3 phase 2", "i30 2", "i30 3 phase 1", "i30 3 phase 2", "ix35", "Tucson 3", "Tucson 4 phase 1",
    "Tucson 4 phase 2", "Kona 1 phase 1", "Kona 1 phase 2", "Kona 2", "Bayon phase 1", "Bayon phase 2"],
  Kia: ["Picanto 3 phase 1", "Picanto 3 phase 2", "Rio 4 phase 1", "Rio 4 phase 2", "Cee'd 2", "Ceed 3 phase 1", "Ceed 3 phase 2",
    "XCeed phase 1", "XCeed phase 2", "Stonic phase 1", "Stonic phase 2", "Sportage 3", "Sportage 4", "Sportage 5 phase 1",
    "Sportage 5 phase 2", "Niro 1", "Sorento 2"]
};

const ML = /mains-libres|keyless/i;
const CARTE = /^carte/i;
// version complémentaire d'une fiche : type de clé, libellés des deux fiches
export function jumelle(e) {
  const t = e.s.type || "";
  if (CARTE.test(t) && e.brand !== "Nissan") { // Renault : carte simple ↔ carte mains-libres
    const ml = ML.test(t);
    return { suffixe: ml ? "carte mains-libres" : "carte", jSuffixe: ml ? "carte simple" : "carte mains-libres", jType: ml ? "Carte" : "Carte mains-libres", jId: e.id + (ml ? "-carte" : "-ml") };
  }
  if (ML.test(t)) // fiche main libre (dont Intelligent Key Nissan) → version à lame
    return { suffixe: "main libre", jSuffixe: "clé à lame", jType: "Clé repliable à télécommande", jId: e.id + "-lame" };
  const sansLame = /sans lame/i.test(t); // Mercedes / Mini / VW Passat : clé électronique classique ↔ keyless
  return { suffixe: sansLame ? "clé classique" : "clé à lame", jSuffixe: "main libre", jType: "Clé mains-libres (keyless)", jId: e.id + "-ml" };
}

// applique la liste : fiche d'origine renommée (même identifiant) + fiche jumelle (nouvel identifiant)
export function avecVariantes(liste) {
  const out = [];
  for (const e of liste) {
    out.push(e);
    if (!(VARIANTES[e.brand] || []).includes(e.gen)) continue;
    const j = jumelle(e);
    const base = e.gen;
    e.gen = base + " · " + j.suffixe; e.pair = j.jId;
    const s = { ...e.s, type: j.jType };
    if (j.jSuffixe === "main libre" && s.blade) s.blade += " (lame de secours)";
    if (s.chip) s.chip += " (à vérifier sur cette version)";
    out.push({ ...e, id: j.jId, gen: base + " · " + j.jSuffixe, s, pair: e.id, jumelle: true });
  }
  return out;
}
