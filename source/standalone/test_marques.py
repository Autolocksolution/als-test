# Marques qui ont les mêmes clés (Renault / Dacia…) : même fiche, même quantité.
import asyncio,os,sys,types,subprocess,time
_h=os.path.dirname(os.path.abspath(__file__))
_src=open(os.path.join(_h,"test_boost.py"),encoding="utf-8").read().split("# ---------------------------------------------------------------- (a)")[0]
T=types.ModuleType("T");T.__file__=os.path.join(_h,"test_boost.py");exec(_src,T.__dict__)
from playwright.async_api import async_playwright
ok,PUT=T.ok,T.PUT
async def run(b):
    print("\n== marques liées ==")
    ctx,page,errs,_=await T.open_app(b)
    await page.evaluate(PUT,["items/k1",{"section":"aftermarket","group":"renault","name":"Clé 3 boutons Clio 3","qty":4}])
    await page.evaluate(PUT,["items/k2",{"section":"aftermarket","group":"bmw","name":"Clé BMW E90","qty":2}])
    await page.evaluate(PUT,["items/k3",{"section":"aftermarket","group":"peugeot","name":"Clé 207","qty":3}])
    await page.wait_for_timeout(300)
    await page.evaluate("sCat='aftermarket';sGroup='dacia';q='';goMode('stock')"); await page.wait_for_timeout(300)
    names=await page.locator("#list .crow").all_text_contents()
    ok(len(names)==1 and "Clio 3" in names[0],f"Dacia montre la clé Renault ({len(names)})")
    st=await page.locator("#stats").text_content(); ok("Stock commun avec Renault" in st,"mention « Stock commun avec Renault »")
    await page.locator("#list .crow button[aria-label^='Retirer une pièce']").first.click(); await page.wait_for_timeout(1200)
    q=await page.evaluate("window.__fbdb.items.k1.qty"); ok(q==3,f"retirée dans Dacia → quantité Renault = 3 ({q})")
    await page.evaluate("sGroup='renault';render()"); await page.wait_for_timeout(200)
    t=await page.locator("#list .crow").first.text_content(); ok("3" in t,"Renault affiche 3")
    await page.evaluate("sGroup='psa';render()"); await page.wait_for_timeout(200)
    ok(await page.locator("#list .crow").count()==1,"PSA montre la clé Peugeot")
    await page.evaluate("sGroup='bmw';render()"); await page.wait_for_timeout(200)
    ok(await page.locator("#list .crow").count()==1,"BMW : pas touché")
    await page.evaluate("sGroup='mini';render()"); await page.wait_for_timeout(200)
    ok(await page.locator("#list .crow").count()==0,"marque non liée : rien en plus")
    await page.evaluate("sCat='coque';sGroup='renault';render()"); await page.wait_for_timeout(200)
    ok(await page.locator("#list .crow").count()==0,"coques Renault : pas mélangées avec les clés")
    ok(not errs,"aucune erreur JS "+str(errs[:2]))
    await ctx.close()
async def main():
    srv=subprocess.Popen([sys.executable,"-m","http.server",str(T.PORT),"--bind","127.0.0.1"],cwd=os.path.join(_h,"dist"),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(1)
    try:
        async with async_playwright() as pw:
            b=await pw.chromium.launch()
            try: await run(b)
            except Exception as e: ok(False,"interrompu : "+str(e).splitlines()[0])
            await b.close()
    finally: srv.terminate()
    print("\nRÉSULTAT :","TOUT PASSE" if not T.FAILS else "ÉCHEC "+str(T.FAILS)); sys.exit(1 if T.FAILS else 0)
asyncio.run(main())
