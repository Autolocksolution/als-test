import asyncio, subprocess, sys, os, time, shutil, tempfile, json
from playwright.async_api import async_playwright
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.abspath(os.path.join(HERE,"..",".."))
SDK=open(os.path.join(HERE,"fake_sdk.js"),encoding="utf-8").read()
FAILS=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m)
    if not c: FAILS.append(m)
TICKETS=sys.argv[1:] or ["/tmp/ocrt/t1.jpg"]
async def main():
    tmp=tempfile.mkdtemp(); shutil.copytree(os.path.join(HERE,"dist"),tmp,dirs_exist_ok=True)
    shutil.copy(os.path.join(ROOT,"ticket.js"),tmp); shutil.copytree(os.path.join(ROOT,"ocr"),os.path.join(tmp,"ocr"))
    srv=subprocess.Popen([sys.executable,"-m","http.server","8766","--bind","127.0.0.1"],cwd=tmp,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
    try:
        async with async_playwright() as pw:
            b=await pw.chromium.launch(); ctx=await b.new_context(viewport={"width":390,"height":780})
            await ctx.route("**/fonts.g*/**",lambda r:r.abort())
            page=await ctx.new_page(); errs=[]; page.on("pageerror",lambda e:errs.append(str(e)))
            await page.add_init_script(SDK); await page.goto("http://localhost:8766/app.html")
            await page.wait_for_selector("#lgForm:not([hidden])"); await page.fill("#lgMail","a@x.fr"); await page.fill("#lgPass","good"); await page.click("#lgGo")
            await page.wait_for_function('document.getElementById("syncT").textContent==="Synchronisé"',timeout=8000)
            await page.click("#navCpt"); await page.wait_for_timeout(300)
            await page.evaluate("cTab='depense';cScroll=true;render()"); await page.wait_for_timeout(300)
            ok(await page.locator(".tkbtn").count()==1,"bouton « Scanner un ticket » présent")
            for i,t in enumerate(TICKETS):
                await page.set_input_files("#tkFile",t)
                await page.wait_for_selector("#cScrim:not([hidden])",timeout=120000)
                r=await page.evaluate("({cat:cCat,label:$('cLabel').value,lit:$('cLit').value,amt:$('cAmt').value,vat:$('cVat').value,date:$('cDate').value,pay:cPay,hint:$('cTkHint').textContent,photo:!!tkData,chk:[...document.querySelectorAll('.chk')].map(e=>e.id)})")
                print("   ",t,json.dumps(r,ensure_ascii=False))
                ok(r["photo"],"photo du ticket jointe"); ok(bool(r["amt"]),"montant prérempli")
                await page.click("#cSave"); await page.wait_for_timeout(600)
            n=await page.evaluate("Object.values(window.__fbdb.entries||{}).filter(e=>e.photoId).length")
            ok(n==len(TICKETS),f"{n} dépense(s) enregistrée(s) avec justificatif")
            ok(await page.evaluate("Object.keys(window.__fbdb.photos||{}).length")>=1,"image stockée dans photos")
            e=await page.evaluate("Object.values(window.__fbdb.entries).pop()"); print("   ",json.dumps(e,ensure_ascii=False)[:300])
            ok(not errs,"aucune erreur JS "+str(errs[:2]))
            await b.close()
    finally: srv.terminate()
    print("RÉSULTAT :","TOUT PASSE" if not FAILS else FAILS)
asyncio.run(main())
