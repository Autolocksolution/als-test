# Téléphone dans la fiche d'intervention et le planning : saisie, enregistrement, affichage, reprise depuis le RDV.
import asyncio, subprocess, sys, os, time, types
HERE=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(HERE,"test_boost.py"),encoding="utf-8").read().split("# ---------------------------------------------------------------- (a)")[0]
T=types.ModuleType("T");T.__file__=os.path.join(HERE,"test_boost.py");exec(src,T.__dict__)
from playwright.async_api import async_playwright
ok=T.ok
SHOT=os.environ.get("TEL_SHOT","")
async def main():
    srv=subprocess.Popen([sys.executable,"-m","http.server",str(T.PORT),"--bind","127.0.0.1"],cwd=os.path.join(HERE,"dist"),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(1)
    try:
        async with async_playwright() as pw:
            b=await pw.chromium.launch();ctx,page,errs,csp=await T.open_app(b)
            await page.evaluate("goMode('comptes');cTab='recette';render();cOpen(null,TODAY)")
            ok(await page.is_visible("#cPhone") and await page.is_hidden("#cCall"),"fiche d'intervention : champ Téléphone présent, lien Appeler masqué tant que vide")
            await page.fill("#cModel","Clio IV");await page.fill("#cAmt","120");await page.fill("#cPhone","06 12 34 56 78")
            ok(await page.get_attribute("#cCall","href")=="tel:0612345678" and await page.is_visible("#cCall"),"lien Appeler actif dès qu'un numéro est saisi")
            if SHOT: await page.screenshot(path=SHOT+"fiche.png")
            await page.click("#cSave");await page.wait_for_function("entries.some(e=>e.phone==='06 12 34 56 78')&&document.getElementById('cScrim').hidden")
            ok(True,"numéro enregistré avec l'intervention")
            await page.evaluate("cClose&&0;render()")
            ok(await page.locator(".ent-m",has_text="06 12 34 56 78").count()>=1,"numéro affiché dans la liste des interventions")
            ok(await page.locator(".quick a.qcall[href='tel:0612345678']").count()>=1,"bouton Appeler sur l'intervention à faire")
            await page.evaluate("cOpen(entries.find(e=>e.phone))")
            ok(await page.input_value("#cPhone")=="06 12 34 56 78","numéro repris à la réouverture de la fiche")
            await page.click("#cCancel")
            # planning : numéro visible + repris dans la fiche
            await page.evaluate("goMode('plan');rvOpen(null)")
            await page.fill("#rvWhat","Mégane clé perdue");await page.fill("#rvPhone","07 00 11 22 33");await page.click("#rvSave")
            await page.wait_for_function("rdv.some(r=>r.phone==='07 00 11 22 33')");await page.evaluate("pRender()")
            ok(await page.locator(".pl-main p",has_text="07 00 11 22 33").count()==1,"planning : numéro affiché sur le rendez-vous")
            if SHOT: await page.screenshot(path=SHOT+"plan.png")
            await page.evaluate("rvToEntry(rdv.find(r=>r.phone))")
            ok(await page.input_value("#cPhone")=="07 00 11 22 33","RDV terminé : numéro repris dans la fiche d'intervention")
            ok(not errs and not csp,f"aucune erreur ni blocage CSP {errs[:2]} {csp[:2]}")
            await b.close()
    finally: srv.terminate()
    sys.exit(1 if T.FAILS else 0)
asyncio.run(main())
