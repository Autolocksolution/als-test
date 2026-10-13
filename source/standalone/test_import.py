import asyncio,subprocess,sys,os,time
from playwright.async_api import async_playwright
HERE=os.path.dirname(os.path.abspath(__file__))
SDK=open(os.path.join(HERE,"fake_sdk.js"),encoding="utf-8").read()
async def main():
    srv=subprocess.Popen([sys.executable,"-m","http.server","8767","--bind","127.0.0.1"],cwd=os.path.join(HERE,"dist"),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(1)
    try:
        async with async_playwright() as pw:
            b=await pw.chromium.launch();ctx=await b.new_context(viewport={"width":390,"height":780})
            await ctx.route("**/fonts.g*/**",lambda r:r.abort())
            page=await ctx.new_page();errs=[];page.on("pageerror",lambda e:errs.append(str(e)))
            await page.add_init_script(SDK);await page.goto("http://localhost:8767/app.html")
            await page.wait_for_selector("#lgForm:not([hidden])");await page.fill("#lgMail","a@x.fr");await page.fill("#lgPass","good");await page.click("#lgGo")
            await page.wait_for_function('document.getElementById("syncT").textContent==="Synchronisé"')
            await page.evaluate("document.getElementById('bkBtn').click()")
            await page.click("#stBk")
            await page.set_input_files("#bFile",os.path.join(HERE,"stock-a-importer.json"))
            await page.wait_for_function("!document.getElementById('bConfirm').hidden",timeout=20000)
            print(await page.inner_text("#bRestore"))
            t=time.time();await page.click("#bConfirm")
            for i in range(24):
                await page.wait_for_timeout(3000)
                tx=await page.inner_text("#bRestore");n0=await page.evaluate("Object.keys(window.__fbdb.items).length")
                print(i,tx[:60],n0,flush=True)
                if tx.startswith("Restauration terminée") or tx.startswith("Arrêt"):break
            print("durée",round(time.time()-t,1),"s ;",await page.inner_text("#bRestore"))
            n=await page.evaluate("Object.keys(window.__fbdb.items).length");print("items en base:",n,"; meta:",await page.evaluate("Object.keys(window.__fbdb.meta||{})"))
            await page.click("#bClose");await page.click("#navStock");await page.wait_for_timeout(500)
            print("lignes visibles:",await page.locator("#list li").count(),"erreurs JS:",errs[:2])
            await b.close()
    finally: srv.terminate()
asyncio.run(main())
