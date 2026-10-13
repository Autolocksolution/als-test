# AutoLockSolution : sources

- `autolocksolution.html` : le code de l'appli (fichier principal, c'est lui qu'on modifie).
- `standalone/` : ce qui la transforme en appli autonome (Firebase, connexion, notifications).
  - `python3 standalone/build.py ../dist` produit `app.html`, `app-sw.js`, `app.webmanifest` et les icônes.
  - ces fichiers sont ensuite copiés à la racine du dépôt (c'est ce que GitHub Pages publie).
  - `fake_sdk.js` + `test_*.py` : tests avec un faux Firebase (Playwright). `test_import.py` demande le fichier de stock, non versionné.
  - `vapid.txt` : clé publique des notifications (publique, pas un secret).
- `scripts/` (à la racine) : le robot d'envoi des notifications, lancé par GitHub Actions.

Données : tout est dans Firestore (projet `autlocksolution`). Les sauvegardes se font depuis Réglages > Sauvegarde. Le secret `FIREBASE_SERVICE_ACCOUNT` est dans GitHub > Settings > Secrets.
