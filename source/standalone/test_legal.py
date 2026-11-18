# Textes légaux mot pour mot, acceptation obligatoire, export des données, un seul téléphone par compte.
import asyncio, subprocess, sys, os, time, types, json, re
HERE=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(HERE,"test_boost.py"),encoding="utf-8").read().split("# ---------------------------------------------------------------- (a)")[0]
T=types.ModuleType("T");T.__file__=os.path.join(HERE,"test_boost.py");exec(src,T.__dict__)
from playwright.async_api import async_playwright
ok=T.ok
MD=open(os.path.join(HERE,"..","legal","textes.md"),encoding="utf-8").read()
def plain(t):  # texte attendu : markdown sans balises, échappements retirés
    t=t.replace("&#32;"," ");t=re.sub(r"\\([\[\]_*\\])",r"\1",t);return t.replace("**","")
async def main():
    srv=subprocess.Popen([sys.executable,"-m","http.server",str(T.PORT),"--bind","127.0.0.1"],cwd=os.path.join(HERE,"dist"),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(1)
    try:
        async with async_playwright() as pw:
            b=await pw.chromium.launch()
            # liens sur l'écran de connexion (avant d'être connecté)
            ctx0=await b.new_context(viewport={"width":390,"height":780});p0=await ctx0.new_page()
            await p0.add_init_script(T.SDK);await p0.goto(T.URL);await p0.wait_for_selector("#lgForm:not([hidden])")
            await p0.click("#lgForm [data-legal='cgu']")
            ok(await p0.locator(".sheet.legal h2",has_text="CGU").count()==1,"écran de connexion : la page CGU s'ouvre sans être connecté")
            await ctx0.close()
            ctx,page,errs,csp=await T.open_app(b)
            # chaque phrase du document se retrouve telle quelle dans l'appli
            for key,head in [("cgu","Conditions Générales d'Utilisation (CGU)"),("cgv","Conditions Générales de Vente (CGV)"),("rgpd","Politique de confidentialité (RGPD)")]:
                body=MD.split("## "+head+"\n",1)[1].split("\n## ",1)[0]
                await page.evaluate(f"legalOpen('{key}')")
                txt=await page.locator(".sheet.legal").last.inner_text()
                norm=lambda s:re.sub(r"\s+"," ",s).strip()
                lines=[plain(l[2:] if l.startswith("- ") else l) for l in body.split("\n") if l.strip() and not l.startswith("|")]
                cells=[plain(c.strip()) for l in body.split("\n") if l.startswith("|") and not l.startswith("| ---") for c in l.strip("|").split("|") if c.strip()]
                miss=[x for x in lines+cells if norm(x) not in norm(txt)]
                ok(not miss,f"{key} : tout le texte du document, mot pour mot ({len(lines)} paragraphes, {len(cells)} cases) {miss[:2]}")
                await page.locator(".sheet.legal .btn.pri").last.click()
            await page.evaluate("legalOpen('mentions')")
            t=await page.locator(".sheet.legal").last.inner_text()
            ok("93023051100022" in t and "ABLA Salman" in t and "Page obligatoire" not in t,"mentions légales : le tableau seul (sans les notes de travail)")
            await page.locator(".sheet.legal .btn.pri").last.click()
            # acceptation obligatoire
            await page.evaluate("window.__ALS_SDK.legal=true;legalGateOn=false;legalGate()")
            await page.wait_for_selector(".lg-gate")
            ok(await page.locator(".lg-gate .btn.pri").is_disabled(),"acceptation : « Continuer » bloqué tant que la case n'est pas cochée")
            await page.click(".lg-gate [data-legal='rgpd']");ok(await page.locator(".sheet.legal h2",has_text="RGPD").count()==1,"acceptation : les textes s'ouvrent depuis la fenêtre")
            await page.locator(".sheet.legal .btn.pri").last.click()
            await page.check("#lgAccept");await page.click(".lg-gate .btn.pri")
            await page.wait_for_function("!document.querySelector('.lg-gate')")
            lg=await page.evaluate("(async()=>(await db.doc('team/'+uid).get()).data().legal)()")
            ok(lg and lg["v"]==await page.evaluate("LEGAL.v") and lg["at"]>0,"acceptation enregistrée avec la version et la date")
            await page.evaluate("legalGate()");await page.wait_for_timeout(400)
            ok(await page.locator(".lg-gate").count()==0,"déjà acceptée : la fenêtre ne revient pas")
            # export
            await page.evaluate("""(async()=>{await db.collection('clients').add({name:'Client Test',phone:'0600'});window.__saved=null;
               const o=window.claude.use;window.claude.use=async n=>n==='downloads'?{save:async x=>{window.__saved=x}}:o(n);})()""")
            await page.click("#stExport",force=True) if await page.is_visible("#stExport") else await page.evaluate("exportAll()")
            await page.wait_for_function("window.__saved")
            sv=await page.evaluate("window.__saved")
            d=json.loads(sv["data"])
            ok(sv["filename"].endswith(".json") and any(c.get("name")=="Client Test" for c in d["donnees"]["clients"]) and "entries" in d["donnees"],"export : fichier complet avec clients, interventions, etc.")
            # un seul téléphone : un autre appareil se connecte -> celui-ci est déconnecté
            ok(await page.evaluate("(async()=>{const d=(await db.doc('team/'+uid).get()).data();return !!d.sid&&d.sid===localStorage.getItem('als-sid')})()"),"connexion : numéro de session inscrit")
            await page.wait_for_timeout(300)
            ok(await page.is_hidden("#lgScrim"),"sa propre connexion ne le déconnecte pas")
            try: await page.evaluate("db.doc('team/'+uid).set({sid:'autre-telephone',sidAt:Date.now()+5000},{merge:true})")
            except Exception: pass  # la page se recharge pendant l'appel : c'est l'éjection attendue
            await page.wait_for_selector("#lgForm:not([hidden])",timeout=8000)
            ok("autre téléphone" in await page.inner_text("#lgBad"),"connexion sur un autre téléphone : celui-ci est déconnecté avec un message")
            ok(not errs,"aucune erreur "+str(errs))
    finally: srv.kill()
asyncio.run(main())
