# « Ranger avec Claude » : dépôt de la note, affichage du résultat écrit par le robot, annulation.
import asyncio, subprocess, sys, os, time, types
HERE=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(HERE,"test_boost.py"),encoding="utf-8").read().split("# ---------------------------------------------------------------- (a)")[0]
T=types.ModuleType("T");T.__file__=os.path.join(HERE,"test_boost.py");exec(src,T.__dict__)
from playwright.async_api import async_playwright
ok=T.ok
SHOT=os.environ.get("IA_SHOT","")
async def main():
    srv=subprocess.Popen([sys.executable,"-m","http.server",str(T.PORT),"--bind","127.0.0.1"],cwd=os.path.join(HERE,"dist"),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(1)
    try:
        async with async_playwright() as pw:
            b=await pw.chromium.launch();ctx,page,errs,csp=await T.open_app(b)
            await page.set_viewport_size({"width":390,"height":844})
            await page.evaluate("""(async()=>{await db.doc('vehicles/v1').set({brand:'Renault',model:'Clio',gen:'Clio IV',yFrom:2012,yTo:2019,s:{chip:'PCF7961M'},t:{proc2:'Lire le PIN par OBD.'}})})()""")
            await page.wait_for_function("vehicles.some(v=>v.id==='v1')")
            await page.evaluate("goMode('base')")
            ok(await page.is_visible("#iaBtn"),"Base de données : bouton « Ranger une note avec Claude »")
            await page.click("#iaBtn");await page.wait_for_selector("#iaScrim:not([hidden])")
            await page.wait_for_selector("#iaOff:not([hidden])")
            ok("retrouve la fiche" in await page.text_content("#iaFor"),"sans fiche ouverte : Claude cherche le véhicule ; avertissement tant que la clé manque")
            await page.click("#iaWake");await page.wait_for_function("window.__w=1");
            ok(await page.evaluate("(async()=>{const s=await db.doc('meta/robotCmd').get();return s.exists&&s.data().restart>0})()"),"« J'ai ajouté la clé » : demande de redémarrage du robot déposée")
            await page.click("#iaSend")
            ok(await page.evaluate("ias.length")==0,"note vide : rien n'est envoyé")
            await page.fill("#iaText","clio 4 2016 : attendre 15 min si antidémarrage affiché")
            await page.click("#iaSend");await page.wait_for_function("ias.length===1")
            r=await page.evaluate("ias[0]")
            ok(r["state"]=="new" and r["vehicleId"]=="" and r["by"] and "clio 4" in r["text"] and r["photoIds"]==[],"demande déposée : état new, à mon nom, sans fiche imposée")
            ok(await page.locator("#iaList .ia-wait").count()==1,"la note apparaît « en cours de rangement »")
            # le robot répond : fiche complétée
            await page.evaluate("""(async()=>{const r=ias[0];await db.doc('vehicles/v1').update({'t.notes':'Attendre 15 min si antidémarrage affiché.','s.freq':'433 MHz'});
              await db.doc('ia/'+r.id).update({state:'done',doneAt:Date.now(),vehicleId:'v1',label:'Renault Clio Clio IV (2012-2019)',changes:['Fréquence : 433 MHz','À savoir, pièges : + 1 ligne'],skipped:[],resume:'ok',prev:{s:{freq:''},t:{notes:''},ph:{}}})})()""")
            await page.wait_for_selector("#iaList .ia-it:has-text('Rangé')")
            ok(await page.locator("#iaList li").count()==2 and await page.locator("#iaList button:has-text('Voir la fiche')").count()==1,"résultat affiché : fiche, liste des ajouts, accès à la fiche")
            if SHOT: await page.screenshot(path=SHOT+"resultat.png")
            await page.click("#iaList button:has-text(\"Annuler l'ajout\")")
            await page.wait_for_function("ias[0].undone===true")
            v=await page.evaluate("vehicles.find(v=>v.id==='v1')")
            ok(v["t"]["notes"]=="" and v["s"]["freq"]=="" and v["t"]["proc2"]=="Lire le PIN par OBD." and v["s"]["chip"]=="PCF7961M","Annuler l'ajout : seuls les champs ajoutés sont remis comme avant")
            # depuis une fiche : la fiche est imposée
            await page.click("#iaCancel");await page.evaluate("vSelect(vehicles.find(v=>v.id==='v1'))")
            await page.click("button:has-text('Compléter cette fiche avec Claude')");await page.wait_for_selector("#iaScrim:not([hidden])")
            ok("Clio" in await page.text_content("#iaFor"),"depuis une fiche : la fiche visée est rappelée")
            if SHOT: await page.screenshot(path=SHOT+"feuille.png")
            await page.fill("#iaText","lishi VA2T");await page.click("#iaSend");await page.wait_for_function("ias.length===2")
            ok(await page.evaluate("ias.some(r=>r.vehicleId==='v1'&&r.state==='new')"),"demande liée à la fiche ouverte")
            await page.evaluate("""(async()=>{const r=ias.find(r=>r.state==='new');await db.doc('ia/'+r.id).update({state:'err',doneAt:Date.now(),msg:"Claude n'est pas encore activé : il manque la clé."})})()""")
            await page.wait_for_selector("#iaList .ia-it.err")
            ok("pas encore activé" in await page.text_content("#iaList .ia-it.err"),"échec : message du robot affiché, note récupérable")
            ok(not errs,f"aucune erreur JS {errs[:2]}")
            await b.close()
    finally: srv.terminate()
    sys.exit(1 if T.FAILS else 0)
asyncio.run(main())
