// Infos pré-remplies (à vérifier) pour les fiches automatiques : prise OBD, fréquence, calculateur moteur
// (emplacement + familles de références selon l'époque), autres boîtiers, outil de crochetage.
// Règles générales par marque / époque : indicatives, chaque fiche porte la mention « à vérifier ».

const ELEC = /zoe|5 e-tech|4 e-tech|e-tech electric|megane e-tech|scenic e-tech|spring|\bion\b|c-zero|id\.3|id\.4|\bborn\b|leaf|model [s3y]|atto|dolphin|mg4/i;
const PSA = ["Peugeot", "Citroën", "DS"], VAG = ["Volkswagen", "Audi", "Seat", "Skoda", "Cupra"], FIAT = ["Fiat", "Alfa Romeo", "Lancia"];
const opelPSA = e => e.brand === "Opel" && e.yFrom >= 2017 && /corsa f|astra l|mokka b|crossland|grandland|combo e|vivaro c/i.test(e.gen);
const per = (y, steps) => { for (const [max, v] of steps) if (y < max) return v; return steps[steps.length - 1][1]; };

function ecuRefs(e) {
  const y = e.yFrom, g = e.gen;
  if (ELEC.test(g) || ELEC.test(e.model)) return ["Électrique : pas de calculateur moteur thermique"];
  if (e.brand === "Renault" || e.brand === "Dacia" || e.brand === "Alpine" || (e.brand === "Nissan" && /primastar|interstar|micra k14/i.test(g)) || (e.brand === "Mercedes-Benz" && /citan/i.test(g)) || (e.brand === "Opel" && /vivaro a|vivaro b|movano/i.test(g)) || (e.brand === "Smart" && /453/.test(g)))
    return per(y, [
      [2001, ["Siemens Fenix 5 / Sagem Safir (essence)", "Bosch EDC15C3 / Lucas DCN (diesel)"]],
      [2005, ["Siemens Sirius 32 / Sagem S2000 (essence)", "Delphi DDCR / Bosch EDC15C3 / EDC16C3 (dCi)"]],
      [2012, ["Continental EMS3120 / EMS3132 / Sagem S3000 (essence)", "Continental SID301 / SID305 / Delphi DCM1.2 / Bosch EDC16C36 / EDC17C42 (dCi)"]],
      [2019, ["Continental EMS3150 / EMS3155 / Bosch MED17.9 (TCe)", "Continental SID310 / SID320 / Bosch EDC17C84 (dCi)"]],
      [9999, ["Continental EMS3155 / Bosch MG1CS (TCe)", "Bosch EDC17C84 / MD1CS (Blue dCi)"]]]);
  if (PSA.includes(e.brand) || opelPSA(e) || (e.brand === "Toyota" && /proace/i.test(g)) || (e.brand === "Fiat" && /scudo/i.test(g)))
    return per(y, [
      [2002, ["Magneti Marelli 1AP / Bosch ME7.4.4 / Sagem S2000 (essence)", "Bosch EDC15C2 / Siemens SID801 (HDi)"]],
      [2010, ["Bosch ME7.4.4 / ME7.4.5 / Magneti Marelli 6LP / Sagem S2000PM (essence)", "Bosch EDC16C34 / Siemens SID802 / SID804 / Delphi (HDi)"]],
      [2016, ["Bosch MEV17.4 / MED17.4 (VTi / THP)", "Bosch EDC17C10 / Siemens SID807 / Delphi DCM3.4 (e-HDi)"]],
      [9999, ["Bosch MEVD17.4.2 / MG1CS / Valeo VD46 (PureTech)", "Bosch EDC17C60 / MD1CS003 / Delphi DCM7.1 (BlueHDi)"]]]);
  if (VAG.includes(e.brand) && /MQB/.test(e.s.chip || "")) return ["Bosch MED17.1.27 / MG1CS011 / Continental Simos 18 (TSI)", "Bosch EDC17C64 / EDC17C74 / MD1CS004 / Delphi DCM6.2 (TDI)"];
  if (VAG.includes(e.brand))
    return per(y, [
      [2004, ["Bosch ME7.5 / Magneti Marelli 4LV / Siemens Simos 3 (essence)", "Bosch EDC15P / EDC15VM (TDI)"]],
      [2009, ["Bosch MED9.5.10 / Siemens Simos 7 / Magneti Marelli 4HV (essence)", "Bosch EDC16U1 / EDC16U34 / EDC16CP34 (TDI PD)"]],
      [2013, ["Bosch MED17.5 / Continental Simos 10 (TSI)", "Bosch EDC17C46 / EDC17CP14 / Continental SID803A (TDI CR)"]],
      [9999, ["Bosch MED17.1.27 / MG1CS011 / Continental Simos 18 (TSI)", "Bosch EDC17C64 / EDC17C74 / MD1CS004 / Delphi DCM6.2 (TDI)"]]]);
  if (e.brand === "Opel" || e.brand === "Chevrolet")
    return per(y, [
      [2004, ["Siemens Simtec 70 / 71 / Bosch Motronic (essence)", "Bosch EDC15M / Denso (diesel)"]],
      [2010, ["Siemens Simtec 75 / Bosch ME7.6 (essence)", "Bosch EDC16C9 / EDC16C39 / Magneti Marelli MJD6JO (CDTI)"]],
      [9999, ["Continental E78 / E83 / Bosch ME17 (essence)", "Bosch EDC17C18 / C19 / C59 / Delphi (CDTI)"]]]);
  if (e.brand === "Ford")
    return per(y, [
      [2002, ["Ford EEC-V (essence)", "Delphi / Lucas EPIC (TDDi)"]],
      [2010, ["Siemens / Visteon (essence)", "Siemens SID802 / SID803 / Bosch EDC16C34 / Delphi (TDCi)"]],
      [2018, ["Bosch MED17.0 (EcoBoost) / Continental EMS2204", "Siemens SID206 / SID208 / Bosch EDC17C10 / C70 / Delphi DCM3.5 (TDCi)"]],
      [9999, ["Bosch MG1CS019 / Continental (EcoBoost)", "Bosch MD1CS / Delphi DCM7.1 (EcoBlue)"]]]);
  if (FIAT.includes(e.brand) || (e.brand === "Jeep" && /renegade|compass/i.test(g)) || (e.brand === "Opel" && /combo d/i.test(g)) || (e.brand === "Ford" && /ka 2/i.test(g)))
    return per(y, [
      [2003, ["Magneti Marelli IAW 59F / Bosch ME7.3 (essence)", "Bosch EDC15C7 (JTD)"]],
      [2010, ["Magneti Marelli IAW 5SF / 4AF / Bosch ME7.9.10 (essence)", "Magneti Marelli MJD6F3 / Bosch EDC16C39 (Multijet)"]],
      [9999, ["Magneti Marelli IAW 8GMF / 9GF / Bosch ME17.3 (essence)", "Magneti Marelli MJD8F2 / 8F3 / 8DF / Bosch EDC17C49 (Multijet)"]]]);
  if (e.brand === "BMW" || e.brand === "Mini")
    return per(y, [
      [2004, ["Siemens MS42 / MS43 / Bosch ME7.2 / Siemens EMS2000 (Mini)", "Bosch EDC15C / EDC16C1 (diesel)"]],
      [2011, ["Siemens MSV70 / MSV80 / Bosch MEVD17.2 / MED17.2 (essence)", "Bosch EDC16C31 / C35 / EDC17C06 / EDC17C41 (diesel)"]],
      [9999, ["Bosch MEVD17.2.x / MG1CS003 (essence)", "Bosch EDC17C41 / C50 / C56 / MD1CS001 (diesel)"]]]);
  if (e.brand === "Mercedes-Benz" || e.brand === "Smart")
    return per(y, [
      [2000, ["Bosch ME2.x / HFM (essence)", "Bosch EDC15C (CDI)"]],
      [2009, ["Bosch ME9.7 / Siemens SIM4LE (essence)", "Bosch EDC16C2 / C31 / Delphi CRD2 (CDI)"]],
      [9999, ["Continental SIM271 / Bosch MED17.7 (essence)", "Delphi CRD3 / Bosch EDC17C43 / C66 (CDI)"]]]);
  if (e.brand === "Volvo") return ["Bosch ME7 / ME9 / Denso (essence)", "Bosch EDC16 / EDC17 / Denso (diesel ; D2 = moteur PSA/Ford)"];
  if (e.brand === "Land Rover") return y < 2006 ? ["Siemens / Bosch Motronic (essence)", "Bosch EDC15 / EDC16 (Td4)"] : ["Bosch / Denso (essence)", "Bosch EDC17CP11 / Denso (TD4 / SD4)"];
  if (e.brand === "Toyota" || e.brand === "Lexus") return ["Denso (essence et hybride)", "Denso (D-4D) ; Bosch sur certains diesels d'origine BMW/PSA"];
  if (e.brand === "Nissan") return ["Hitachi / Mitsubishi Electric / Denso (essence)", "Bosch EDC16 / EDC17 / Continental SID (dCi d'origine Renault)"];
  if (e.brand === "Honda") return ["Keihin (essence)", "Bosch EDC16C7 / EDC17C58 (i-CTDi / i-DTEC)"];
  if (e.brand === "Mazda") return ["Denso / Mitsubishi Electric (essence)", "Denso / Bosch (diesel)"];
  if (e.brand === "Mitsubishi") return ["Mitsubishi Electric / Denso (essence)", "Bosch / Denso (diesel)"];
  if (e.brand === "Suzuki") return ["Denso / Mitsubishi Electric (essence)", "Bosch / Magneti Marelli (1.3 DDiS d'origine Fiat)"];
  if (e.brand === "Subaru") return ["Denso / Hitachi"];
  if (e.brand === "Hyundai" || e.brand === "Kia") return ["Continental SIMK / Kefico / Bosch ME17.9 (essence)", "Bosch EDC16C39 / EDC17C08 / C57 / Delphi (CRDi)"];
  if (e.brand === "SsangYong") return ["Delphi / Continental / Bosch"];
  if (e.brand === "Jeep" || e.brand === "Chrysler" || e.brand === "Dodge") return ["Chrysler NGC / Continental (essence)", "Bosch EDC16 / EDC17 (CRD)"];
  if (e.brand === "MG") return ["Continental / Delphi / UAES (essence)"];
  if (e.brand === "Lynk & Co") return ["Bosch (moteurs Volvo/Geely)"];
  return [];
}

function ecuLoc(e) {
  if (ELEC.test(e.gen) || ELEC.test(e.model)) return "";
  if (["Renault", "Dacia", "Alpine"].includes(e.brand)) return "Compartiment moteur, en général près de la batterie ou de la boîte à air.";
  if (PSA.includes(e.brand) || opelPSA(e)) return "Compartiment moteur, en général côté gauche près de la batterie.";
  if (VAG.includes(e.brand)) return "Sous la grille d'auvent (baie d'essuie-glace) ou dans le compartiment moteur près de la batterie, selon la motorisation.";
  if (e.brand === "Ford") return "Compartiment moteur, près de la batterie ou contre le tablier côté gauche.";
  if (FIAT.includes(e.brand)) return "Compartiment moteur, côté gauche près de la batterie / du filtre à air.";
  if (e.brand === "BMW" || e.brand === "Mini") return "Compartiment moteur, dans le boîtier électronique contre le tablier ou sur le moteur côté admission.";
  if (e.brand === "Mercedes-Benz") return "Compartiment moteur, sur le moteur ou côté droit contre le tablier.";
  return "Compartiment moteur, le plus souvent près de la batterie ou contre le tablier.";
}

function boxes(e) {
  const y = e.yFrom, g = e.gen, t = e.s.type || "";
  if (e.brand === "Renault" || e.brand === "Alpine") {
    const L = ["UCH : sous le volant, côté gauche (près de la boîte à fusibles)"];
    if (/carte/i.test(t)) L.push("Lecteur de carte : planche de bord / console centrale");
    if (y >= 2015 && !/kadjar|koleos|twingo|zoe|trafic|master|kangoo/i.test(g)) L.push("HFM (mains libres) : derrière la boîte à gants", "Gateway : derrière la boîte à gants, à côté du HFM");
    return L;
  }
  if (e.brand === "Dacia") return ["UCH : sous le volant, côté gauche"];
  if (PSA.includes(e.brand) || opelPSA(e)) return y >= 2000 ? ["BSI : sous la planche de bord côté conducteur, derrière la boîte à fusibles"] : ["Antidémarrage : calculateur moteur + boîtier de transpondeur au contacteur"];
  if (VAG.includes(e.brand)) {
    const L = ["BCM (boîtier confort) : sous la planche de bord, côté gauche"];
    if (/MQB/.test(e.s.chip || "")) L.push("Antidémarrage : combiné d'instruments / BCM (MQB)", "Gateway : sous la planche de bord");
    else if (/B6|B7|CC/.test(g)) L.push("Boîtier de démarrage (Kessy / ELV) : colonne de direction");
    else if (/BCM2/.test(e.s.chip || "")) L.push("BCM2 (antidémarrage Audi) : sous la planche de bord");
    else L.push("Antidémarrage : intégré au combiné d'instruments");
    return L;
  }
  if (e.brand === "Opel") return y < 2004 ? ["Antidémarrage : calculateur moteur (antenne au contacteur)"] : ["BCM : sous le volant, côté gauche", "CIM : sur la colonne de direction"];
  if (e.brand === "Ford") return y < 2010 ? ["GEM / BCM : sous la planche de bord, côté gauche", "Antidémarrage (PATS) : combiné d'instruments"] : ["BCM : derrière la boîte à fusibles, côté passager ou conducteur selon modèle"];
  if (FIAT.includes(e.brand)) return ["Body Computer (BSM) : sous le volant, côté gauche"];
  if (e.brand === "BMW" || e.brand === "Mini") {
    if (/EWS/.test(e.s.chip || "")) return ["EWS : sous le volant, au-dessus du pédalier"];
    if (/CAS/.test(e.s.chip || "") && !/CAS4/.test(e.s.chip)) return ["CAS : au-dessus du pédalier, côté gauche"];
    return ["FEM / BDC : derrière le cache côté conducteur (bas de caisse gauche)"];
  }
  if (e.brand === "Mercedes-Benz") return /infrarouge|électronique/i.test((e.s.chip || "") + t) ? ["EIS / EZS (contacteur électronique) : derrière le contacteur dans la planche de bord", "ESL / ELV (verrou de colonne) : sur la colonne de direction"] : ["Antidémarrage : contacteur / calculateur moteur"];
  if (e.brand === "Toyota" || e.brand === "Lexus") return ["Calculateur antidémarrage / Smart key : derrière la planche de bord côté conducteur"];
  if (e.brand === "Nissan") return ["BCM : sous la planche de bord, côté gauche"].concat(/carte/i.test(t) ? ["Intelligent Key (mains libres) : derrière la boîte à gants"] : []);
  if (e.brand === "Hyundai" || e.brand === "Kia") return ["Calculateur antidémarrage / Smart key (SMK) : sous la planche de bord côté conducteur"];
  return [];
}

function obd(e) {
  if (PSA.includes(e.brand) || opelPSA(e)) return "Boîte à fusibles sous le volant, derrière le cache";
  if (e.brand === "Renault" || e.brand === "Dacia") return "Sous la planche de bord, côté conducteur ou console centrale";
  if (e.brand === "Opel" && e.yFrom < 2004) return "Console centrale, sous le cendrier";
  if (e.brand === "Tesla") return "Derrière la console centrale (connecteur spécifique)";
  return "Sous le volant, côté gauche";
}

const LISHI = new Set(["VAC102", "NE72", "NE73", "VA2", "HU83", "HU66", "HU100", "HU100R", "HU101", "HU92", "HU64", "HU46", "HU56", "SIP22", "GT15R", "FO21", "TOY43", "TOY48", "NSN14", "NSN11", "NSN19", "HY22", "HYN14R", "HYN11", "HON66", "MAZ24R", "MIT11R", "HU133R", "DW05", "Y160", "Y170", "SX9", "SZ12"]);

export const NOTE = "⚠️ Infos pré-remplies automatiquement (clé, OBD, calculateur, boîtiers, crochetage) : à vérifier avant intervention.";

export function infos(e) {
  const s = {}, t = {};
  if (e.s.type && !/carte \/ téléphone/i.test(e.s.type)) s.freq = "433 MHz (Europe)";
  s.obd = obd(e);
  const loc = ecuLoc(e); if (loc) t.ecuLoc = loc;
  const refs = ecuRefs(e); if (refs.length) t.ecuRefs = refs.join("\n");
  const bx = boxes(e); if (bx.length) t.boxes = bx.join("\n");
  if (e.s.blade && LISHI.has(e.s.blade)) t.lock = `Outil Lishi ${e.s.blade} (2-en-1) pour l'ouverture et la lecture.`;
  t.notes = NOTE;
  return { s, t };
}
