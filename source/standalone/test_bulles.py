# Comptes : jours du mois en bulles ; aujourd'hui et demain en affichage complet ; bulle vide = ajout, bulle remplie = détail.
import asyncio, subprocess, sys, os, time, types
HERE=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(HERE,"test_boost.py"),encoding="utf-8").read().split("# ---------------------------------------------------------------- (a)")[0]
T=types.ModuleType("T");T.__file__=os.path.join(HERE,"test_boost.py");exec(src,T.__dict__)
from playwright.async_api import async_playwright
ok=T.ok
SHOT=os.environ.get("BUL_SHOT","")
async def main():
    srv=subprocess.Popen([sys.executable,"-m","http.server",str(T.PORT),"--bind","127.0.0.1"],cwd=os.path.join(HERE,"dist"),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(1)
    try:
        async with async_playwright() as pw:
            b=await pw.chromium.launch();ctx,page,errs,csp=await T.open_app(b)
            await page.set_viewport_size({"width":400,"height":1100})
            await page.evaluate("""(async()=>{const d=new Date();const k=n=>key(d.getFullYear(),d.getMonth(),n);
              const add=o=>db.collection('entries').add({kind:'recette',pay:'especes',by:uid,at:Date.now(),status:'reussi',city:'Narbonne',...o});
              await add({date:k(3),amount:120,model:'Clio IV'});await add({date:k(5),amount:90,model:'208',pay:'carte'});
              await add({date:TODAY,amount:150,model:'Mégane 3',status:'prevu',time:'14:00'});
              await db.collection('entries').add({kind:'depense',cat:'essence',date:k(4),amount:60,pay:'carte',by:uid,at:Date.now()});})()""")
            await page.wait_for_function("entries.length>=4")
            await page.evaluate("goMode('comptes');cTab='recette';Y=now.getFullYear();M=now.getMonth();cSel='';render()")
            nd=await page.evaluate("new Date(Y,M+1,0).getDate()")
            ok(await page.locator(".cal-d").count()==nd,"une bulle par jour du mois ("+str(nd)+")")
            full=await page.locator("#cBody .days .day").count()
            exp=await page.evaluate("(()=>{const t=new Date(now);t.setDate(t.getDate()+1);return t.getMonth()===M?2:1})()")
            ok(full==exp,"affichage complet seulement pour aujourd'hui"+(" et demain" if exp==2 else "")+" ("+str(full)+")")
            ok(await page.locator("#cBody .day.today .ent",has_text="Mégane 3").count()==1,"l'intervention du jour reste visible en entier")
            if SHOT: await page.screenshot(path=SHOT+"mois.png",full_page=True)
            # bulle remplie (le 3) -> détail
            await page.locator(".cal-d",has=page.locator("b",has_text="3")).filter(has_text="120").first.click()
            ok(await page.locator("#cBody .days .ent",has_text="Clio IV").count()==1,"bulle remplie : le détail du jour s'affiche")
            if SHOT: await page.screenshot(path=SHOT+"detail.png",full_page=True)
            # bulle vide -> ajout à cette date
            empty=await page.evaluate("(()=>{for(let d=1;d<=new Date(Y,M+1,0).getDate();d++){const k=key(Y,M,d);if(!entries.some(e=>e.date===k)&&k!==TODAY)return d}})()")
            await page.locator(".cal-d:not(.has)").filter(has=page.locator("b",has_text=str(empty))).first.click()
            ok(await page.is_visible("#cScrim") and await page.input_value("#cDate")==await page.evaluate(f"key(Y,M,{empty})"),"bulle vide : fiche d'intervention ouverte au bon jour")
            if SHOT: await page.screenshot(path=SHOT+"ajout.png")
            await page.click("#cCancel")
            await page.evaluate("cTab='depense';render()")
            ok(await page.locator(".cal-d.has").count()>=1,"dépenses : même affichage en bulles")
            ok(not errs and not csp,"aucune erreur ni blocage CSP "+str(errs)+" "+str(csp))
    finally: srv.kill()
asyncio.run(main())
