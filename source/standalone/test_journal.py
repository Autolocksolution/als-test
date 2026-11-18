# Journal (traces) : ajout, modification et suppression notés avec l'auteur ; copie de ce qui est supprimé.
import asyncio, subprocess, sys, os, time, types
HERE=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(HERE,"test_boost.py"),encoding="utf-8").read().split("# ---------------------------------------------------------------- (a)")[0]
T=types.ModuleType("T");T.__file__=os.path.join(HERE,"test_boost.py");exec(src,T.__dict__)
from playwright.async_api import async_playwright
ok=T.ok
async def main():
    srv=subprocess.Popen([sys.executable,"-m","http.server",str(T.PORT),"--bind","127.0.0.1"],cwd=os.path.join(HERE,"dist"),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(1)
    try:
        async with async_playwright() as pw:
            b=await pw.chromium.launch();ctx,page,errs,csp=await T.open_app(b)
            await page.evaluate("""(async()=>{const r=await db.collection('entries').add({kind:'recette',date:TODAY,amount:80,pay:'especes',model:'Twingo',by:uid,at:Date.now(),status:'reussi'});
              window.__jid=r.id;await db.doc('entries/'+r.id).update({amount:90});await db.doc('entries/'+r.id).delete();})()""")
            await page.wait_for_timeout(600)
            j=await page.evaluate("(async()=>(await db.collection('journal').get()).docs.map(d=>d.data()).filter(x=>x.id===window.__jid))()")
            ops=sorted(x["op"] for x in j)
            ok(ops==["ajout","modif","suppr"],"ajout, modification et suppression tracés "+str(ops))
            ok(all(x.get("by") and x.get("at") and x.get("col")=="entries" for x in j),"chaque trace a son auteur, l'heure et la rubrique")
            sup=[x for x in j if x["op"]=="suppr"][0]
            ok(sup.get("avant",{}).get("model")=="Twingo" and sup["avant"].get("amount")==90,"copie complète de la ligne supprimée gardée")
            await page.evaluate("db.doc('meta/x').set({a:1})");await page.wait_for_timeout(300)
            ok(await page.evaluate("(async()=>(await db.collection('journal').get()).docs.every(d=>d.data().col!=='meta'))()"),"les réglages techniques ne remplissent pas le journal")
            ok(not errs and not csp,"aucune erreur ni blocage CSP "+str(errs)+" "+str(csp))
    finally: srv.kill()
asyncio.run(main())
