#!/usr/bin/env python3
"""Construit la version autonome (hors Claude) à partir de autolocksolution.html.
Usage : python3 build.py [dossier_sortie]   -> index.html, sw.js, manifest.webmanifest, icônes"""
import sys, shutil, datetime, pathlib

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE.parent / "autolocksolution.html"
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "dist"
ICONS = HERE
BUILD = datetime.datetime.now().strftime("%Y%m%d-%H%M")

src = SRC.read_text(encoding="utf-8")

def sub(s, old, new, count=1):
    n = s.count(old)
    assert n == count, f"motif trouvé {n} fois (attendu {count}) : {old[:70]!r}"
    return s.replace(old, new)

# 1. en-tête de page complète + PWA
head = ('<!doctype html><html lang="fr"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">'
        '<meta name="apple-mobile-web-app-title" content="AutoLock"><meta name="apple-mobile-web-app-status-bar-style" content="default">'
        '<meta name="theme-color" content="#2F7F7A">'
        '<style>html{-webkit-text-size-adjust:100%}body{margin:0}[hidden]{display:none!important}</style>'
        '<link rel="manifest" href="app.webmanifest"><link rel="apple-touch-icon" href="als-180.png">'
        '<script>window.ALS_OCR="ocr/"</script>'
        '<script>if(!window.claude){window.__alsReady=new Promise(function(r){window.__alsResolve=r})}</script>\n')
assert src.lstrip().startswith("<title>")
src = head + src

# 2. écran de connexion : premier élément du body, juste après la feuille de style
login = (HERE / "login.html").read_text(encoding="utf-8")
src = sub(src, "</style>\n", "</style>\n</head><body>\n" + login, 1)

# 3. attendre la connexion avant de démarrer
src = sub(src, "  const c=window.claude;\n  if(!c||!c.use){",
          "  if(!window.claude&&window.__alsReady)await window.__alsReady;\n  const c=window.claude;\n  if(!c||!c.use){")

# 4. bouton « Se déconnecter » dans les réglages
src = sub(src, '    <h3 class="h3">Données</h3>\n',
          '    <div class="acts" id="stOutBox" hidden><button type="button" class="btn" id="stOut">Se déconnecter</button></div>\n'
          '    <p class="hint" id="stWho"></p>\n    <h3 class="h3">Données</h3>\n')

# 5. module Firebase en fin de page
shim = (HERE / "shim.js").read_text(encoding="utf-8").replace("__BUILD__", BUILD)
_vf = HERE / "vapid.txt"
import os
_v = os.environ.get("ALS_VAPID") or (_vf.read_text().strip() if _vf.exists() else "")
if _v == "-":
    _v = ""
if _v:
    shim = shim.replace("__VAPID__", _v)
src = src.rstrip() + '\n<script type="module">\n' + shim + '</script>\n</body></html>\n'

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "app.html").write_text(src, encoding="utf-8")
(OUT / "app-sw.js").write_text((HERE / "sw.js").read_text(encoding="utf-8").replace("__BUILD__", BUILD), encoding="utf-8")
shutil.copy(HERE / "manifest.webmanifest", OUT / "app.webmanifest")
for f in ("als-192.png", "als-512.png", "als-180.png"):
    shutil.copy(ICONS / f, OUT / f)
print("OK", OUT, "build", BUILD, len(src), "octets")
