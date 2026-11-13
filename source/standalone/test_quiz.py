# Menu Quiz : entrée dans « Plus », chargement de quiz.js, partie complète, correction, score, tirage différent d'une partie à l'autre.
import asyncio, subprocess, sys, os, time, types
HERE=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(HERE,"test_boost.py"),encoding="utf-8").read().split("# ---------------------------------------------------------------- (a)")[0]
T=types.ModuleType("T");T.__file__=os.path.join(HERE,"test_boost.py");exec(src,T.__dict__)
from playwright.async_api import async_playwright
ok=T.ok
SHOT=os.environ.get("QZ_SHOT","")
async def main():
    srv=subprocess.Popen([sys.executable,"-m","http.server",str(T.PORT),"--bind","127.0.0.1"],cwd=os.path.join(HERE,"dist"),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(1)
    try:
        async with async_playwright() as pw:
            b=await pw.chromium.launch();ctx,page,errs,csp=await T.open_app(b,csp_bypass=False)
            ok(await page.evaluate("typeof window.ALS_QUIZ")=="undefined","quiz.js n'est pas chargé au démarrage")
            await page.click("#navPlus");await page.click("#plusList button:has-text('Quiz')")
            await page.wait_for_selector("#qzGo")
            ok(await page.text_content("#ttl")=="Quiz" and await page.is_hidden("#fab"),"écran Quiz ouvert depuis « Plus », sans bouton flottant")
            n=await page.evaluate("ALS_QUIZ.q.length");ok(n>=200,f"{n} questions chargées")
            bad=await page.evaluate("ALS_QUIZ.q.filter(x=>x.length!==4||x[2].length!==4||new Set(x[2]).size!==4||!ALS_QUIZ.cats.some(c=>c[0]===x[0])).length")
            ok(bad==0,"chaque question a un thème connu et 4 réponses différentes")
            if SHOT: await page.screenshot(path=SHOT+"home.png")
            await page.click("#qzGo");await page.wait_for_selector(".qz-ans button")
            first=await page.evaluate("qz.list.map(x=>x.q)");ok(len(first)==10 and len(set(first))==10,"10 questions différentes tirées")
            # 1re question : mauvaise réponse -> correction affichée
            good=await page.evaluate("qz.list[0].good")
            await page.locator(".qz-ans button").filter(has_not_text=good).first.click()
            ok(await page.locator(".qz-ans button.ok").text_content()==good and await page.locator(".qz-ans button.ko").count()==1 and await page.is_visible(".qz-exp"),"mauvaise réponse : la bonne est montrée en vert, avec l'explication")
            if SHOT: await page.screenshot(path=SHOT+"run.png")
            await page.click("#qzNext")
            for i in range(1,10):
                good=await page.evaluate("qz.list[qz.i].good")
                await page.locator(".qz-ans button",has_text=good).first.evaluate("(e,g)=>[...document.querySelectorAll('.qz-ans button')].find(x=>x.textContent===g).click()",good)
                await page.click("#qzNext")
            await page.wait_for_selector(".qz-score")
            ok((await page.text_content(".qz-score")).strip()=="9 / 10" and await page.locator(".qz-rev").count()==1,"score 9 / 10 et 1 erreur à revoir")
            if SHOT: await page.screenshot(path=SHOT+"end.png",full_page=True)
            await page.click("button:has-text('Nouvelle partie')");await page.wait_for_selector(".qz-ans button")
            second=await page.evaluate("qz.list.map(x=>x.q)");ok(not set(first)&set(second),"la partie suivante ne reprend aucune question déjà vue")
            await page.click("button:has-text('Arrêter')");await page.wait_for_selector("#qzGo")
            ok("90 %" in await page.text_content("#qzBody"),"dernier score rappelé sur l'écran du quiz")
            ok(not errs and not csp,f"aucune erreur ni blocage CSP {errs[:2]} {csp[:2]}")
            await b.close()
    finally: srv.terminate()
    sys.exit(1 if T.FAILS else 0)
asyncio.run(main())
