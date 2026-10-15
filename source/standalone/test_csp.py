# Vérifie que la politique de sécurité n'empêche aucune fonction de l'appli et bloque bien un script injecté.
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright
HERE=os.path.dirname(os.path.abspath(__file__)); SDK=open(os.path.join(HERE,"fake_sdk.js"),encoding="utf-8").read()
async def main():
    srv=subprocess.Popen([sys.executable,"-m","http.server","8772","--bind","127.0.0.1"],cwd=os.path.join(HERE,"dist"),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(1)
    fails=[]
    async with async_playwright() as pw:
        b=await pw.chromium.launch();page=await (await b.new_context(viewport={"width":390,"height":780})).new_page();msgs=[]
        page.on("console",lambda m:msgs.append(m.text) if "Content Security Policy" in m.text or "Refused" in m.text else None)
        await page.add_init_script(SDK);await page.goto("http://localhost:8772/app.html")
        await page.wait_for_selector("#lgForm:not([hidden])");await page.fill("#lgMail","a@x.fr");await page.fill("#lgPass","good");await page.click("#lgGo")
        await page.wait_for_selector("#syncT:has-text('Synchronisé')",timeout=8000)
        for n in ["navStock","navCpt","navDvs","navBase","navHome"]:
            await page.click("#"+n);await page.wait_for_timeout(250)
        await page.click("#navCpt");await page.click("#fab");await page.wait_for_timeout(300);await page.click("#cCancel")
        r=await page.evaluate("()=>{window.__x=0;const s=document.createElement('script');s.textContent='window.__x=1';document.head.append(s);return window.__x}")
        if r==1: fails.append("un script injecté s'est exécuté")
        await page.wait_for_timeout(300)
        bad=[m for m in msgs if "window.__x" not in m and "inline script" not in m.lower()]
        if bad: fails.append("violations inattendues: "+str(bad[:3]))
        print("script injecté bloqué :",r!=1,"| violations inattendues :",len(bad))
        await b.close()
    srv.terminate(); print("RÉSULTAT :","TOUT PASSE" if not fails else fails); sys.exit(1 if fails else 0)
asyncio.run(main())
