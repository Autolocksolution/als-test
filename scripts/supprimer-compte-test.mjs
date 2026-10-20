// Ponctuel : supprime UNIQUEMENT le compte de test oublié par un ancien contrôle de sécurité.
// Garde-fous : identifiant exact, nom « inconnu-<chiffres> », aucun e-mail ni moyen de connexion, hors équipe.
import fs from "node:fs";
import admin from "firebase-admin";
const CIBLE = "inconnu-1792097467079";
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"))) });
let u;
try { u = await admin.auth().getUser(CIBLE); } catch (e) { if (e.code === "auth/user-not-found") { console.log("Déjà absent"); process.exit(0); } throw e; }
const team = await admin.firestore().doc("team/" + CIBLE).get();
if (!/^inconnu-\d+$/.test(u.uid) || u.email || u.phoneNumber || u.providerData.length || team.exists) { console.error("Garde-fou : compte non conforme, rien supprimé"); process.exit(1); }
await admin.auth().deleteUser(CIBLE);
const n = (await admin.auth().listUsers(1000)).users.filter(x => !x.disabled).length;
console.log("Compte de test supprimé ; comptes actifs restants : " + n);
if (n !== 2) process.exit(1);
