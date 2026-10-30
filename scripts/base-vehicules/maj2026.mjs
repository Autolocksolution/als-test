// Modèles et phases récents (2023–2026) ajoutés après coup.
const F = "Clé repliable à télécommande", P = "Clé mains-libres (keyless)", C = "Carte mains-libres";
const k = (type, blade, chip) => Object.fromEntries(Object.entries({ type, blade, chip }).filter(([, v]) => v));
export const MAJ = {
  Renault: [
    ["Arkana", "Arkana phase 2", 2023, null, "Renault Arkana 2023", k(C)],
    ["Clio", "Clio 6", 2025, null, "Renault Clio VI", k(C)],
    ["Renault 5", "Renault 5 E-Tech", 2024, null, "Renault 5 E-Tech", k(C)],
    ["Renault 4", "Renault 4 E-Tech", 2025, null, "Renault 4 E-Tech", k(C)],
  ],
  "Citroën": [["C3 Aircross", "C3 Aircross 2", 2024, null, "Citroën C3 Aircross 2024", k(F)]],
  Opel: [
    ["Frontera", "Frontera", 2024, null, "Opel Frontera 2024", k(F)],
    ["Grandland", "Grandland 2", 2024, null, "Opel Grandland 2024", k(P)],
  ],
  Toyota: [["C-HR", "C-HR 2", 2023, null, "Toyota C-HR 2023", k(P, "TOY48")]],
};
