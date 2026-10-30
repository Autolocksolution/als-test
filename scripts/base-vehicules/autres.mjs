// Base véhicules pré-remplie : marques américaines puis autres (chinoises…), depuis 1995.
const T = "Clé à télécommande", F = "Clé repliable à télécommande", P = "Clé mains-libres (keyless)", C = "Carte / téléphone";
const k = (type, blade, chip) => Object.fromEntries(Object.entries({ type, blade, chip }).filter(([, v]) => v));

export const US = {
  Chevrolet: [
    ["Spark", "Spark", 2010, 2015, "Chevrolet Spark 2010", k(F, "DW05")],
    ["Aveo", "Aveo 1", 2006, 2011, "Chevrolet Aveo 2008 hatchback", k(F, "DW05")],
    ["Aveo", "Aveo 2", 2011, 2015, "Chevrolet Aveo 2011", k(F, "HU100", "ID46")],
    ["Cruze", "Cruze", 2009, 2015, "Chevrolet Cruze 2009", k(F, "HU100", "ID46")],
    ["Captiva", "Captiva", 2006, 2015, "Chevrolet Captiva", k(F, "DW05")],
    ["Matiz", "Matiz", 2005, 2010, "Chevrolet Matiz 2005", k(T, "DW05")],
    ["Orlando", "Orlando", 2011, 2015, "Chevrolet Orlando", k(F, "HU100", "ID46")],
  ],
  Jeep: [
    ["Renegade", "Renegade", 2014, null, "Jeep Renegade", k(F, "SIP22")],
    ["Compass", "Compass 2", 2017, null, "Jeep Compass 2017", k(F, "SIP22")],
    ["Cherokee", "Cherokee (KL)", 2014, 2023, "Jeep Cherokee KL", k(P)],
    ["Grand Cherokee", "Grand Cherokee (WK)", 2005, 2010, "Jeep Grand Cherokee WK", k(T, "Y170")],
    ["Wrangler", "Wrangler (JK)", 2007, 2018, "Jeep Wrangler JK", k(T, "Y170")],
  ],
  Chrysler: [
    ["PT Cruiser", "PT Cruiser", 2000, 2010, "Chrysler PT Cruiser", k(T, "Y160")],
    ["Voyager", "Voyager (RG)", 2001, 2007, "Chrysler Voyager 2001", k(T, "Y160")],
  ],
  Dodge: [
    ["Caliber", "Caliber", 2006, 2012, "Dodge Caliber", k(T, "Y170")],
    ["Journey", "Journey", 2008, 2020, "Dodge Journey", k(P)],
  ],
  Tesla: [
    ["Model S", "Model S", 2012, null, "Tesla Model S", k(P)],
    ["Model 3", "Model 3", 2017, null, "Tesla Model 3", k(C)],
    ["Model Y", "Model Y", 2020, null, "Tesla Model Y", k(C)],
  ],
};

export const AUTRES = {
  MG: [
    ["ZS", "ZS", 2017, null, "MG ZS", k(F)],
    ["MG4", "MG4", 2022, null, "MG4 EV", k(P)],
    ["HS", "HS", 2018, null, "MG HS", k(P)],
  ],
  BYD: [
    ["Atto 3", "Atto 3", 2022, null, "BYD Atto 3", k(C)],
    ["Dolphin", "Dolphin", 2021, null, "BYD Dolphin", k(C)],
  ],
  "Lynk & Co": [
    ["01", "01", 2017, null, "Lynk & Co 01", k(C)],
  ],
};
