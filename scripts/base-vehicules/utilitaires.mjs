// Utilitaires, camionnettes et pick-up qui utilisent des clés de voiture.
const T = "Clé à télécommande", F = "Clé repliable à télécommande";
const k = (type, blade, chip) => Object.fromEntries(Object.entries({ type, blade, chip }).filter(([, v]) => v));
export const UTILITAIRES = {
  Renault: [
    ["Maxity", "Maxity", 2007, 2013, "Renault Maxity", k(T, "NSN14", "ID46")],
    ["Mascott", "Mascott", 1999, 2010, "Renault Mascott", k(T, "VAC102")],
    ["Alaskan", "Alaskan", 2017, 2021, "Renault Alaskan", k(T, "NSN14")],
    ["Express Van", "Express Van", 2021, null, "Renault Express Van 2021", k(F)],
  ],
  Nissan: [
    ["Cabstar", "Cabstar", 2006, 2013, "Nissan Cabstar 2007", k(T, "NSN14", "ID46")],
    ["NT400", "NT400 Cabstar", 2014, 2021, "Nissan NT400 Cabstar", k(T, "NSN14")],
    ["NV300", "NV300", 2016, 2021, "Nissan NV300", k(F)],
    ["NV400", "NV400", 2011, 2021, "Nissan NV400", k(F)],
    ["Townstar", "Townstar", 2022, null, "Nissan Townstar", k(F)],
    ["Primastar", "Primastar 2", 2021, null, "Nissan Primastar 2022", k(F)],
    ["Interstar", "Interstar 2", 2022, null, "Nissan Interstar 2022", k(F)],
  ],
  Opel: [["Movano", "Movano C", 2021, null, "Opel Movano 2021", k(F, "SIP22")]],
  Fiat: [
    ["Talento", "Talento", 2016, 2021, "Fiat Talento", k(F)],
    ["Fullback", "Fullback", 2016, 2019, "Fiat Fullback", k(T, "MIT11R")],
  ],
  "Mercedes-Benz": [["Classe X", "Classe X", 2017, 2020, "Mercedes-Benz X-Klasse", k(T, "NSN14")]],
  Iveco: [
    ["Daily", "Daily 4", 2006, 2011, "Iveco Daily 2006", k(T)],
    ["Daily", "Daily 5", 2011, 2014, "Iveco Daily 2011", k(T)],
    ["Daily", "Daily 6", 2014, 2019, "Iveco Daily 2014", k(T)],
    ["Daily", "Daily 7", 2019, null, "Iveco Daily 2019", k(F)],
  ],
  MAN: [["TGE", "TGE", 2017, null, "MAN TGE", k(F, "HU66")]],
  Toyota: [["Proace Max", "Proace Max", 2024, null, "Toyota Proace Max", k(F)]],
  Isuzu: [
    ["D-Max", "D-Max 2", 2012, 2020, "Isuzu D-Max 2012", k(T)],
    ["D-Max", "D-Max 3", 2020, null, "Isuzu D-Max 2020", k(T)],
  ],
  Mitsubishi: [["Fuso Canter", "Fuso Canter", 2012, null, "Mitsubishi Fuso Canter", k(T)]],
};
