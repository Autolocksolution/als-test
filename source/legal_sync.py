#!/usr/bin/env python3
"""Recopie MOT POUR MOT les textes légaux (export Markdown du document « CGU, CGV et politique de confidentialité »,
enregistré dans legal/textes.md) dans l'appli. Aucun mot n'est ajouté ni changé : on découpe seulement les sections.
Usage : python3 legal_sync.py   puis reconstruire l'appli (standalone/build.py)."""
import json, hashlib, pathlib, re
HERE = pathlib.Path(__file__).resolve().parent
md = (HERE / "legal" / "textes.md").read_text(encoding="utf-8")
SECTIONS = {"Mentions légales": "mentions", "Conditions Générales d'Utilisation (CGU)": "cgu",
            "Conditions Générales de Vente (CGV)": "cgv", "Politique de confidentialité (RGPD)": "rgpd"}
parts = re.split(r"^## ", md, flags=re.M)
out = {}
for p in parts[1:]:
    title, _, body = p.partition("\n")
    key = SECTIONS.get(title.strip())
    if not key: continue
    body = body.strip("\n")
    if key == "mentions":   # seulement le tableau (les lignes autour sont des notes de travail, pas le texte légal)
        body = "\n".join(l for l in body.split("\n") if l.startswith("|"))
    out[key] = {"t": title.strip(), "md": body}
missing = [t for t, k in SECTIONS.items() if k not in out]
assert not missing, f"sections absentes du document : {missing}"
v = hashlib.sha256(json.dumps(out, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:10]
js = "/*LEGAL-START*/const LEGAL=" + json.dumps({"v": v, "s": out}, ensure_ascii=False).replace("</", "<\\/") + ";/*LEGAL-END*/"
app = HERE / "autolocksolution.html"
src = app.read_text(encoding="utf-8")
new, n = re.subn(r"/\*LEGAL-START\*/.*?/\*LEGAL-END\*/", lambda m: js, src, flags=re.S)
assert n == 1, f"marqueur LEGAL trouvé {n} fois"
app.write_text(new, encoding="utf-8")
print("textes légaux recopiés, version", v)
