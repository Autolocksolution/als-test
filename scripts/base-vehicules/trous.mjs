// Générations manquantes repérées le 07/11/2026 (modèles qui s'arrêtaient avant 2026 alors qu'une
// génération suivante a été vendue en France). Infos clé indicatives, à vérifier.
const T = "Clé à télécommande", F = "Clé repliable à télécommande", P = "Clé mains-libres (keyless)", IR = "Clé électronique (sans lame de contact)";
const k = (type, blade, chip) => Object.fromEntries(Object.entries({ type, blade, chip }).filter(([, v]) => v));
export const TROUS = {
  Toyota: [
    ["Prius", "Prius 4", 2016, 2022, "Toyota Prius XW50", k(P, "TOY48")],
    ["Prius", "Prius 5", 2023, null, "Toyota Prius XW60", k(P, "TOY48")],
    ["Land Cruiser", "Land Cruiser (J150)", 2009, 2023, "Toyota Land Cruiser Prado J150", k(P, "TOY48")],
  ],
  "Mercedes-Benz": [
    ["ML", "ML (W166)", 2011, 2015, "Mercedes-Benz W166 ML", k(IR, "HU64")],
    ["GLE", "GLE (W166)", 2015, 2019, "Mercedes-Benz GLE W166", k(IR, "HU64")],
  ],
  Ford: [["Galaxy", "Galaxy 3", 2015, 2023, "Ford Galaxy 2015", k(F, "HU101")]],
  Audi: [["TT", "TT (8S)", 2014, 2023, "Audi TT 8S", k(F, "HU66")]],
  Honda: [["Accord", "Accord 8", 2008, 2015, "Honda Accord 2008 Europe", k(T, "HON66")]],
  Mitsubishi: [
    ["L200", "L200 5", 2015, 2024, "Mitsubishi L200 2015", k(T, "MIT11R")],
    ["L200", "L200 6", 2024, null, "Mitsubishi L200 2024", k(T)],
  ],
  Subaru: [
    ["Forester", "Forester 5", 2019, 2024, "Subaru Forester SK", k(P)],
    ["Forester", "Forester 6", 2025, null, "Subaru Forester 2025", k(P)],
    ["XV", "XV 2", 2017, 2023, "Subaru XV 2018", k(T, "DAT17")],
    ["Crosstrek", "Crosstrek", 2023, null, "Subaru Crosstrek 2023", k(P)],
    ["Outback", "Outback 5", 2015, 2021, "Subaru Outback BS", k(T, "DAT17")],
    ["Outback", "Outback 6", 2021, 2025, "Subaru Outback BT", k(P)],
  ],
  Kia: [
    ["Carens", "Carens 4", 2013, 2019, "Kia Carens 2013", k(F, "HYN14R")],
    ["Soul", "Soul 2", 2014, 2019, "Kia Soul 2014", k(F, "HYN14R")],
    ["Soul", "e-Soul", 2019, 2022, "Kia e-Soul", k(P)],
  ],
  Jeep: [
    ["Grand Cherokee", "Grand Cherokee (WK2)", 2011, 2021, "Jeep Grand Cherokee WK2", k(P)],
    ["Grand Cherokee", "Grand Cherokee (WL)", 2022, null, "Jeep Grand Cherokee WL", k(P)],
    ["Wrangler", "Wrangler (JL)", 2018, null, "Jeep Wrangler JL", k(T)],
  ],
  Hyundai: [["Staria", "Staria", 2021, null, "Hyundai Staria", k(P)]],
  Volvo: [
    ["S90 / V90", "S90 / V90 (2)", 2016, null, "Volvo V90 2016", k(P)],
    ["S60", "S60 (3)", 2019, 2024, "Volvo S60 2019", k(P)],
  ],
  BMW: [["i3", "i3 (I01)", 2013, 2022, "BMW i3", k(T)]],
};
