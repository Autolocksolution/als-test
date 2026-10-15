#!/usr/bin/env node
// Déchiffre une sauvegarde automatique AutoLockSolution (.alsbk) sur un ordinateur, en cas de perte de données.
// Autonome : n'a besoin que de Node.js (aucune installation npm). Ne contacte aucun service.
//
//   node dechiffrer.mjs sauvegarde-auto-AAAA-MM-JJ.alsbk CLE_BASE64 > sauvegarde.json
//   ALS_BACKUP_KEY=CLE_BASE64 node dechiffrer.mjs fichier.alsbk > sauvegarde.json   (clé hors historique du terminal)
//   node dechiffrer.mjs fichier.alsbk CLE_BASE64 -o sauvegarde.json                  (recommandé sous Windows PowerShell)
//
// Format : "ALSBK1" + IV (12 octets) + données chiffrées AES-256-GCM + tag (16 octets). Clé : 32 octets en base64.
import crypto from "node:crypto";
import fs from "node:fs";

const USAGE = `Utilisation :
  node dechiffrer.mjs FICHIER.alsbk CLE_BASE64 > sauvegarde.json
  node dechiffrer.mjs FICHIER.alsbk CLE_BASE64 -o sauvegarde.json
  (ou la clé dans la variable d'environnement ALS_BACKUP_KEY à la place de CLE_BASE64)
La clé (44 caractères) se trouve dans l'appli / dans votre gestionnaire de mots de passe.
Sous Windows PowerShell 5, utilisez -o : la redirection « > » y abîme le fichier (encodage UTF-16).`;

function fail(msg, code = 1) {
  process.stderr.write("ERREUR : " + msg + "\n");
  process.exit(code);
}

const args = process.argv.slice(2);
let out = null;
const pos = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "-h" || a === "--help" || a === "--aide") { process.stdout.write(USAGE + "\n"); process.exit(0); }
  else if (a === "-o" || a === "--sortie") { out = args[++i]; if (!out) fail("-o doit être suivi d'un nom de fichier\n\n" + USAGE, 2); }
  else pos.push(a);
}
if (!pos.length || pos.length > 2) fail((pos.length ? "trop d'arguments" : "fichier .alsbk manquant") + "\n\n" + USAGE, 2);
const [file, keyArg] = pos;
const keyText = keyArg ?? process.env.ALS_BACKUP_KEY;
if (!keyText) fail("clé manquante : donnez-la après le nom du fichier, ou dans ALS_BACKUP_KEY\n\n" + USAGE, 2);

// Clé : tolère espaces et retours à la ligne d'un copier-coller.
const ks = String(keyText).replace(/\s+/g, "");
if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(ks)) fail("clé invalide : elle ne doit contenir que des caractères base64 (lettres, chiffres, + / =)");
const key = Buffer.from(ks, "base64");
if (key.length !== 32) fail(`clé invalide : elle fait ${key.length} octets au lieu de 32 (une clé correcte fait 44 caractères et finit par « = »)`);

let buf;
try { buf = fs.readFileSync(file); }
catch (e) {
  if (e.code === "ENOENT") fail(`fichier introuvable : ${file}`);
  if (e.code === "EISDIR") fail(`${file} est un dossier, pas un fichier`);
  fail(`lecture impossible de ${file} (${e.code || e.message})`);
}
const MAGIC = Buffer.from("ALSBK1", "ascii");
if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) fail("ce fichier est un .zip : décompressez d'abord l'archive téléchargée depuis GitHub, puis donnez le fichier .alsbk qu'elle contient");
if (buf.length < MAGIC.length || !buf.subarray(0, MAGIC.length).equals(MAGIC)) fail("ce fichier n'est pas une sauvegarde chiffrée AutoLockSolution (en-tête ALSBK1 absent)");
if (buf.length < MAGIC.length + 12 + 16) fail("fichier tronqué : la sauvegarde est incomplète");

const iv = buf.subarray(6, 18), tag = buf.subarray(buf.length - 16), ct = buf.subarray(18, buf.length - 16);
let plain;
try {
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  d.setAuthTag(tag);
  plain = Buffer.concat([d.update(ct), d.final()]);
} catch (e) {
  fail("déchiffrement impossible : la clé ne correspond pas à ce fichier, ou le fichier est abîmé / modifié");
}

let j;
try { j = JSON.parse(plain.toString("utf8")); } catch (e) { fail("le contenu déchiffré n'est pas un JSON valide (fichier corrompu ?)"); }
if (!j || j.app !== "AutoLockSolution" || !j.collections) fail("le contenu déchiffré n'est pas une sauvegarde AutoLockSolution");

if (out) {
  try { fs.writeFileSync(out, plain, { flag: "wx" }); }
  catch (e) {
    if (e.code === "EEXIST") fail(`${out} existe déjà : choisissez un autre nom (rien n'a été écrasé)`);
    fail(`écriture impossible dans ${out} (${e.code || e.message})`);
  }
} else {
  if (process.stdout.isTTY) process.stderr.write("Astuce : ajoutez « > sauvegarde.json » ou « -o sauvegarde.json » pour enregistrer le résultat.\n");
  process.stdout.write(plain);
}
const parts = Object.entries(j.collections).map(([c, l]) => `${c} ${Array.isArray(l) ? l.length : 0}`);
const total = Object.values(j.collections).reduce((s, l) => s + (Array.isArray(l) ? l.length : 0), 0);
process.stderr.write(`OK : sauvegarde du ${j.at || "?"} déchiffrée, ${total} documents (${parts.join(", ")})${out ? " -> " + out : ""}\n`);
