# Deux entreprises sur les devis/factures : AutoLockSolution et Clé Auto 11.
# Numérotation séparée, choix mémorisé, informations séparées, PDF bloqué tant que Clé Auto 11 n'est pas renseignée.
import asyncio, subprocess, sys, os, time
from playwright.async_api import async_playwright
import types
_h=os.path.dirname(os.path.abspath(__file__))
_src=open(os.path.join(_h,"test_boost.py"),encoding="utf-8").read().split("# ---------------------------------------------------------------- (a)")[0]
T=types.ModuleType("T");T.__file__=os.path.join(_h,"test_boost.py");exec(_src,T.__dict__)
ok,PUT,open_app,toast,CLIENT=T.ok,T.PUT,T.open_app,T.toast,T.CLIENT

async def t_ca11(b):
    print("\n== Clé Auto 11 ==")
    ctx,page,errs,_=await open_app(b)
    yr=await page.evaluate("now.getFullYear()")
    await page.evaluate(PUT,["clients/c1",CLIENT])
    await page.evaluate(PUT,["meta/company",{"name":"AutoLockSolution","tvaMode":"franchise"}])
    await page.evaluate("goMode('devis')")
    async def new(kind,ent,label):
        await page.click("#fab"); await page.wait_for_selector("#dcScrim:not([hidden])")
        ok(await page.locator("#dcEntWrap").is_visible(),"choix « Au nom de » visible sur un nouveau document")
        await page.click(f"#dcEntSeg button[data-v='{ent}']")
        await page.click(f"#dcTypeSeg button[data-v='{kind}']")
        await page.wait_for_selector("#dcClient option[value='c1']",state="attached"); await page.select_option("#dcClient","c1")
        ln=page.locator("#dcLines .lnrow input"); await ln.nth(0).fill(label); await ln.nth(2).fill("80")
    await new("facture","ca11","Clé Megane")
    info=await page.locator("#dcEntInfo").text_content()
    ok("Clé Auto 11" in info and await page.locator("#dcEntInfo").is_visible(),"avertissement : infos Clé Auto 11 à remplir ("+info+")")
    await page.click("#dcSave"); await toast(page,f"Enregistré : F-CA11-{yr}-0001")
    await new("facture","als","Clé Clio")
    await page.click("#dcSave"); await toast(page,f"Enregistré : F-{yr}-0001")
    ok(await page.evaluate("load('als-ent')")=="als","dernier choix mémorisé sur le téléphone")
    await new("devis","ca11","Devis 208")
    await page.click("#dcSave"); await toast(page,f"Enregistré : D-CA11-{yr}-0001")
    await new("facture","ca11","Clé 308")
    await page.click("#dcSave"); await toast(page,f"Enregistré : F-CA11-{yr}-0002")
    d=await page.evaluate("window.__fbdb.docs")
    ok(d[f"F-CA11-{yr}-0001"]["ent"]=="ca11" and d[f"F-{yr}-0001"]["ent"]=="als","champ ent enregistré")
    m=await page.evaluate("window.__fbdb.meta")
    ok(m.get(f"seq-ca11-facture-{yr}",{}).get("n")==2 and m.get(f"seq-facture-{yr}",{}).get("n")==1,"compteurs séparés")
    # nouveau doc : pré-sélection = dernier choix (ca11)
    await page.click("#fab"); await page.wait_for_selector("#dcScrim:not([hidden])")
    ok(await page.locator("#dcEntSeg button[data-v='ca11']").get_attribute("aria-pressed")=="true","nouveau document : Clé Auto 11 présélectionnée (dernier choix)")
    await page.click("#dcCancel")
    # ouvrir la facture CA11 : entreprise figée, PDF -> ouvre les infos Clé Auto 11
    await page.evaluate(f"dcOpen(docs.find(x=>x.num==='F-CA11-{yr}-0001'))")
    ok(await page.locator("#dcEntSeg button[data-v='ca11']").is_disabled(),"document existant : entreprise non modifiable")
    await page.click("#dcPdf"); await page.wait_for_selector("#coScrim:not([hidden])")
    ok((await page.locator("#coTitle").text_content())=="Informations Clé Auto 11","PDF sans infos : ouvre « Informations Clé Auto 11 »")
    ok(await page.input_value("#coName")=="","fiche Clé Auto 11 vide (rien pré-rempli)")
    await page.fill("#coName","Clé Auto 11"); await page.click("#coTvaSeg button[data-v='franchise']"); await page.click("#coSave")
    await toast(page,"Informations Clé Auto 11 enregistrées")
    m=await page.evaluate("window.__fbdb.meta")
    ok(m.get("company2",{}).get("name")=="Clé Auto 11" and m.get("company",{}).get("name")=="AutoLockSolution","meta/company2 écrit, meta/company intact")
    # « Mes informations » : bascule d'une entreprise à l'autre
    await page.evaluate("coOpen('als')"); ok(await page.input_value("#coName")=="AutoLockSolution","Mes informations : AutoLockSolution")
    await page.click("#coEntSeg button[data-v='ca11']"); ok(await page.input_value("#coName")=="Clé Auto 11","bascule vers Clé Auto 11")
    await page.click("#coCancel")
    # PDF : le nom de l'entreprise imprimé est le bon
    txt=await page.evaluate(f"new TextDecoder('latin1').decode(pdfBuild(docs.find(x=>x.num==='F-CA11-{yr}-0001'),coOf('ca11')))")
    hx=await page.evaluate("[pdfHex('Clé Auto 11'),pdfHex('AutoLockSolution')]")
    ok(txt.startswith("%PDF") and hx[0] in txt and hx[1] not in txt,"PDF de la facture Clé Auto 11 : en-tête Clé Auto 11, pas AutoLockSolution")
    # liste : filtre Clé Auto 11
    await page.evaluate("dvFilter='ca11';render()")
    rows=await page.locator("#dvBody .dvrow").count()
    ok(rows==3,f"filtre « Clé Auto 11 » : 3 documents ({rows})")
    # devis -> facture garde l'entreprise
    await page.evaluate(f"dcOpen(docs.find(x=>x.num==='D-CA11-{yr}-0001'))"); await page.click("#dcToFact")
    ok(await page.evaluate("dcEnt")=="ca11","devis Clé Auto 11 -> facture Clé Auto 11")
    await page.click("#dcCancel")
    # intervention encaissée par Fayss -> Clé Auto 11 proposé
    ok(await page.evaluate("docFromEntry({id:'e1',fay:true,amount:90},'facture').ent")=="ca11","intervention « Fayss » -> Clé Auto 11")
    ok(not errs,"aucune erreur JS "+str(errs[:3]))
    await ctx.close()

async def main():
    srv=subprocess.Popen([sys.executable,"-m","http.server",str(T.PORT),"--bind","127.0.0.1"],cwd=os.path.join(T.HERE,"dist"),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
    try:
        async with async_playwright() as pw:
            b=await pw.chromium.launch()
            try: await t_ca11(b)
            except Exception as e: ok(False,"t_ca11 interrompu : "+str(e).splitlines()[0])
            await b.close()
    finally: srv.terminate()
    print("\nRÉSULTAT :","TOUT PASSE" if not T.FAILS else "ÉCHEC "+str(T.FAILS)); sys.exit(1 if T.FAILS else 0)
asyncio.run(main())
