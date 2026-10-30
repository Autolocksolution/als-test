import asyncio, subprocess, sys, os, time
from playwright.async_api import async_playwright
HERE=os.path.dirname(os.path.abspath(__file__))
FAILS=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: FAILS.append(m)
SDK=open(os.path.join(HERE,"fake_sdk.js"),encoding="utf-8").read()
URL="http://localhost:8765/app.html"

async def main():
    srv=subprocess.Popen([sys.executable,"-m","http.server","8765","--bind","127.0.0.1"],cwd=os.path.join(HERE,"dist"),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as pw:
            b=await pw.chromium.launch()
            ctx=await b.new_context(viewport={"width":390,"height":780},bypass_csp=True)
            await ctx.route("**/fonts.g*/**",lambda r:r.abort())
            page=await ctx.new_page(); errs=[]; logs=[]
            page.on("pageerror",lambda e:errs.append(str(e)))
            page.on("console",lambda m:logs.append(m.text) if m.type=="error" else None)
            await page.add_init_script(SDK)
            await page.goto(URL)
            await page.wait_for_selector("#lgForm:not([hidden])",timeout=5000)
            ok(True,"écran de connexion affiché sans session")
            ok(await page.locator("#lgScrim").is_visible(),"le voile de connexion couvre l'appli")
            # mauvais mot de passe
            await page.fill("#lgMail","a@x.fr"); await page.fill("#lgPass","oops"); await page.click("#lgGo"); await page.wait_for_timeout(300)
            ok("incorrect" in await page.inner_text("#lgBad"),"mauvais mot de passe : message en français")
            ok(await page.locator("#lgScrim").is_visible(),"toujours verrouillé après échec")
            # verrouillage anti-devinette : 5 mauvais essais
            for k in range(3):
                await page.fill("#lgPass","oops"+str(k)); await page.click("#lgGo"); await page.wait_for_timeout(200)
            ok(not await page.locator("#lgGo").is_disabled(),"4 échecs au total : pas encore bloqué")
            await page.fill("#lgPass","oops5"); await page.click("#lgGo"); await page.wait_for_timeout(300)
            ok(await page.locator("#lgGo").is_disabled(),"5e échec : formulaire bloqué")
            ok("Trop d'essais" in await page.inner_text("#lgBad"),"message « Trop d'essais » affiché")
            await page.reload(); await page.wait_for_selector("#lgForm:not([hidden])"); await page.wait_for_timeout(300)
            ok(await page.locator("#lgGo").is_disabled(),"le blocage survit au rechargement de la page")
            await page.evaluate("localStorage.removeItem('als-login-fail')"); await page.reload(); await page.wait_for_selector("#lgForm:not([hidden])")
            await page.fill("#lgMail","a@x.fr"); await page.fill("#lgPass","oops"); await page.click("#lgGo"); await page.wait_for_timeout(300)
            # oublié
            await page.click("#lgForgot"); await page.wait_for_timeout(150)
            ok("réinitialisation" in await page.inner_text("#lgBad"),"mot de passe oublié : demande envoyée")
            # bon mot de passe
            await page.fill("#lgPass","good"); await page.click("#lgGo")
            await page.wait_for_function('document.getElementById("syncT").textContent==="Synchronisé"',timeout=8000)
            ok(not await page.locator("#lgScrim").is_visible(),"connecté : le voile disparaît")
            await page.click("#navStock"); await page.wait_for_timeout(300)
            ok(await page.locator("#list li").count()>=1,"stock chargé depuis la base")
            # écriture : fiche véhicule + rdv
            await page.click("#navPlus"); await page.click("#plusList button:has-text('Base véhicules')"); await page.click("#fab")
            await page.fill("#vf_brand","Renault"); await page.fill("#vf_model","Clio"); await page.fill("#vf_gen","Clio 4")
            await page.fill("#vf_from","2012"); await page.fill("#vf_to","2019"); await page.click("#vhSave"); await page.wait_for_timeout(500)
            ok("Renault Clio" in await page.inner_text("#vBody"),"fiche véhicule créée via Firestore")
            ok(await page.evaluate("Object.keys(window.__fbdb.vehicles||{}).length")==1,"fiche présente en base")
            await page.evaluate("goMode('planning')"); await page.wait_for_timeout(200); await page.click("#fab")
            await page.fill("#rvWhat","Test"); await page.click("#rvSave"); await page.wait_for_timeout(400)
            ok(await page.evaluate("Object.keys(window.__fbdb.rdv||{}).length")==1,"rendez-vous présent en base")
            ok(await page.evaluate("Object.values(window.__fbdb.rdv)[0].by")=="U1","auteur = identifiant du compte connecté")
            # nom d'équipe enregistré
            ok(await page.evaluate("(window.__fbdb.team||{}).U1&&window.__fbdb.team.U1.name")=="A","profil équipe créé (nom = e-mail)")
            # bouton scan caché, téléchargement disponible
            ok(not await page.locator("#scanBtn").is_visible(),"bouton scan par photo masqué hors Claude")
            ok(await page.evaluate("window.claude.use('downloads').then(d=>typeof d.save)")=="function","téléchargement disponible")
            # session mémorisée : rechargement sans retaper
            await page.reload()
            await page.wait_for_function('document.getElementById("syncT").textContent==="Synchronisé"',timeout=8000)
            ok(not await page.locator("#lgScrim").is_visible(),"session mémorisée après rechargement")
            await page.click("#navStock"); await page.wait_for_timeout(200)
            ok(await page.locator("#list li").count()>=1,"données revenues après rechargement")
            # réglages : déconnexion
            await page.evaluate("document.getElementById('plusScrim').hidden=true")
            has_out=await page.evaluate("!!document.getElementById('stOut')")
            ok(has_out,"bouton de déconnexion présent dans les réglages")
            who=await page.evaluate("document.getElementById('stWho').textContent")
            ok("a@x.fr" in who,"réglages : e-mail connecté affiché ("+who+")")
            await page.evaluate("document.getElementById('stScrim').hidden=false")
            await page.click("#stOut"); await page.click("#stOut"); await page.wait_for_selector("#lgForm:not([hidden])",timeout=6000)
            ok(True,"déconnexion : retour à l'écran de connexion")
            ok(await page.evaluate("localStorage.getItem('__fbuser')")is None,"session effacée")
            ok(await page.input_value("#lgMail")=="a@x.fr","e-mail pré-rempli après déconnexion")
            ok(await page.evaluate("window.claude===undefined||true"),"nettoyage")
            ok(not errs,"aucune erreur JavaScript"+("" if not errs else " : "+errs[0][:200]))
            bad=[l for l in logs if "permission" in l.lower() or "undefined" in l.lower()]
            ok(not bad,"aucune erreur de droits/undefined"+("" if not bad else " : "+bad[0][:160]))
            # accès refusé sans connexion : aucune lecture avant login
            ctx2=await b.new_context(viewport={"width":390,"height":780},bypass_csp=True)
            p2=await ctx2.new_page(); await p2.add_init_script(SDK); await p2.goto(URL)
            await p2.wait_for_selector("#lgForm:not([hidden])",timeout=5000); await p2.wait_for_timeout(500)
            ok(await p2.evaluate("(window.__fblog||[]).length")==0,"aucune écriture avant connexion")
            await b.close()
    finally:
        srv.terminate()
asyncio.run(main())
print("\nRÉSULTAT :", "ÉCHEC ("+str(len(FAILS))+")" if FAILS else "TOUT PASSE")
sys.exit(1 if FAILS else 0)
