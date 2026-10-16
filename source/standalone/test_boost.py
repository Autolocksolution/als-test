# Numéros de facture uniques (transaction, validation tardive, double appui), RDV terminé -> intervention,
# immatriculation connue (et corrigée), sauvegardes chiffrées .alsbk (meta filtrées), rappel sauvegarde auto, changement de date.
import asyncio, subprocess, sys, os, time, json, base64, tempfile
from datetime import datetime
from zoneinfo import ZoneInfo
from playwright.async_api import async_playwright
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
HERE=os.path.dirname(os.path.abspath(__file__))
SDK=open(os.path.join(HERE,"fake_sdk.js"),encoding="utf-8").read()
PORT=8774; URL=f"http://localhost:{PORT}/app.html"
FAILS=[]
def ok(c,m):
    print(("OK   " if c else "FAIL ")+m,flush=True)
    if not c: FAILS.append(m)
def info(m): print("INFO "+m,flush=True)
PUT="async([p,d])=>{const F=window.__ALS_SDK.F;await F.setDoc(F.doc(null,p),d)}"
DEL="async p=>{const F=window.__ALS_SDK.F;await F.deleteDoc(F.doc(null,p))}"
VALS="()=>({date:$('cDate').value,time:$('cTime').value,client:$('cClient').value,addr:$('cAddr').value,city:$('cCity').value,note:$('cNote').value,amt:$('cAmt').value,st:cSt,title:$('cTitle').textContent,model:$('cModel').value,year:$('cYear').value,brand:$('cBrand').value,pin:$('cPin').value,key:$('cKeyCode').value,hint:$('cPlateHint').hidden?'':$('cPlateHint').textContent})"

async def open_app(b,csp_bypass=True,perms=None,tz=None,clock=None):
    ctx=await b.new_context(viewport={"width":390,"height":780},bypass_csp=csp_bypass,permissions=perms or [],**({"timezone_id":tz} if tz else {}))
    await ctx.route("**/fonts.g*/**",lambda r:r.abort())
    page=await ctx.new_page(); errs=[]; csp=[]
    if clock: await page.clock.install(time=clock)
    page.on("pageerror",lambda e:errs.append(str(e)))
    page.on("console",lambda m:csp.append(m.text) if ("Content Security Policy" in m.text or "Refused" in m.text) else None)
    await page.add_init_script(SDK); await page.goto(URL)
    await page.wait_for_selector("#lgForm:not([hidden])")
    await page.fill("#lgMail","a@x.fr"); await page.fill("#lgPass","good"); await page.click("#lgGo")
    await page.wait_for_selector("#syncT:has-text('Synchronisé')",timeout=8000)
    return ctx,page,errs,csp

async def toast(page,txt,timeout=5000):
    await page.wait_for_selector(f"#toast:not([hidden]):has-text(\"{txt}\")",timeout=timeout)
NDOCS="Object.keys(window.__fbdb.docs||{}).length"
async def new_invoice(page,label,price="10",kind="facture"):
    await page.click("#fab"); await page.wait_for_selector("#dcScrim:not([hidden])")
    await page.click(f"#dcTypeSeg button[data-v='{kind}']"); await page.select_option("#dcClient","c1")
    ln=page.locator("#dcLines .lnrow input"); await ln.nth(0).fill(label); await ln.nth(2).fill(price)

CLIENT={"name":"Garage Martin","phone":"0600000001","address":"3 rue des Lilas\n69003 Lyon"}

# ---------------------------------------------------------------- (a) numéros de facture
async def t_invoices(b):
    print("\n== (a) numéros de devis / facture ==")
    ctx,page,errs,_=await open_app(b)
    yr=await page.evaluate("now.getFullYear()"); F=lambda n:f"F-{yr}-{n:04d}"
    await page.evaluate(PUT,["clients/c1",CLIENT])
    await page.evaluate("goMode('devis')"); await page.click("#fab")
    await page.wait_for_selector("#dcScrim:not([hidden])")
    await page.click("#dcTypeSeg button[data-v='facture']")
    await page.wait_for_selector("#dcClient option[value='c1']",state="attached")
    await page.select_option("#dcClient","c1")
    ln=page.locator("#dcLines .lnrow input"); await ln.nth(0).fill("Clé Clio 4"); await ln.nth(2).fill("150")
    ok(await page.evaluate("typeof db.runTransaction")=="function","db.runTransaction exposé (shim -> guardDb)")
    # (2) sur un même téléphone, un 2e enregistrement pendant le 1er est refusé (verrou dcBusy)
    g=await page.evaluate("""async()=>{const p1=dcPersist();const busy=[dcBusy,$('dcSave').disabled,$('dcPdf').disabled];const r2=await dcPersist();const t=$('toast').textContent;const r1=await p1;return [busy,r2,t,r1&&r1.num,dcBusy,$('dcSave').disabled,$('dcPdf').disabled]}""")
    ok(g[0]==[True,True,True] and g[1] is None and g[2]=="Enregistrement en cours…" and g[3]==F(1),f"même téléphone : 2e enregistrement simultané refusé (« Enregistrement en cours… »), boutons grisés pendant l'écriture {g[:4]}")
    ok(g[4:]==[False,False,False],"après l'écriture : verrou levé, boutons réactivés")
    await page.evaluate(DEL,"docs/"+F(1)); await page.evaluate(DEL,f"meta/seq-facture-{yr}"); await page.wait_for_timeout(200)
    # deux TÉLÉPHONES qui enregistrent en même temps, avec le même état local (même numéro proposé par nextNum) :
    # dcWrite = l'écriture sans le verrou d'écran (chaque téléphone a le sien)
    res=await page.evaluate("""async()=>{$('dcSubj').value='Facture A';const p1=dcWrite();$('dcSubj').value='Facture B';const p2=dcWrite();return (await Promise.all([p1,p2])).map(r=>r&&r.num)}""")
    ok(res[0] and res[1] and res[0]!=res[1],f"deux factures simultanées : numéros différents {res}")
    ok(sorted(res)==[F(1),F(2)],"numéros consécutifs sans trou "+str(sorted(res)))
    dd=await page.evaluate("window.__fbdb.docs")
    ok(dd.get(res[0],{}).get("subject")=="Facture A" and dd.get(res[1],{}).get("subject")=="Facture B","aucune des deux n'a écrasé l'autre (sujets A et B présents)")
    ok(dd.get(res[0],{}).get("num")==res[0] and dd.get(res[1],{}).get("num")==res[1],"champ num = identifiant du document")
    retries=await page.evaluate("window.__fblog.filter(x=>x==='txretry').length")
    ok(retries>=1,f"conflit réel détecté et transaction rejouée ({retries} relance(s))")
    seq=await page.evaluate(f"()=>(window.__fbdb.meta||{{}})['seq-facture-{yr}']")
    ok(bool(seq) and seq.get("n")==2,f"compteur meta/seq-facture-{yr} = 2 ({seq})")
    # chemin normal de l'interface
    await page.click("#dcSave"); await toast(page,"Enregistré : "+F(3))
    ok(await page.locator("#dcScrim").is_hidden(),"bouton Enregistrer : facture "+F(3)+" créée, fenêtre fermée")
    # cache local en retard : un autre téléphone a créé 4..6, le compteur est à 6, ce téléphone ne les voit pas encore
    await page.wait_for_timeout(300)
    await page.evaluate(f"""()=>{{for(const n of [4,5,6]){{const id='F-{yr}-'+String(n).padStart(4,'0');window.__fbdb.docs[id]={{type:'facture',num:id,subject:'Autre téléphone',date:TODAY,lines:[],clientId:'c1'}}}}window.__fbdb.meta['seq-facture-{yr}']={{n:6}};window.__fblog.length=0}}""")
    ok(await page.evaluate("docs.length")==3,"le téléphone ne voit que 3 factures (cache en retard)")
    await page.click("#fab"); await page.wait_for_selector("#dcScrim:not([hidden])")
    await page.click("#dcTypeSeg button[data-v='facture']"); await page.select_option("#dcClient","c1")
    ln=page.locator("#dcLines .lnrow input"); await ln.nth(0).fill("Pile"); await ln.nth(2).fill("5")
    await page.click("#dcSave"); await toast(page,"Enregistré : "+F(7))
    reads=await page.evaluate("window.__fblog.filter(x=>x.startsWith('txget:'))")
    ok(F(7) in await page.evaluate("Object.keys(window.__fbdb.docs)"),"cache en retard : nouvelle facture = "+F(7))
    ok(not any(F(4) in r or F(5) in r for r in reads),"la recherche part du compteur (lectures : "+", ".join(r[6:] for r in reads)+")")
    ok(all(dd2.get("subject")=="Autre téléphone" for k,dd2 in (await page.evaluate("window.__fbdb.docs")).items() if k in (F(4),F(5),F(6))),"factures de l'autre téléphone intactes")
    # hors ligne : transaction refusée -> message, rien d'écrit, la fenêtre reste ouverte
    n0=await page.evaluate("Object.keys(window.__fbdb.docs).length")
    await page.click("#fab"); await page.wait_for_selector("#dcScrim:not([hidden])")
    await page.click("#dcTypeSeg button[data-v='facture']"); await page.select_option("#dcClient","c1")
    ln=page.locator("#dcLines .lnrow input"); await ln.nth(0).fill("Hors ligne"); await ln.nth(2).fill("10")
    await page.evaluate("window.__fbOffline=true"); await page.click("#dcSave")
    await toast(page,"Pas de réseau : impossible d'attribuer un numéro de facture. Réessayez avec du réseau.")
    ok(await page.evaluate("Object.keys(window.__fbdb.docs).length")==n0 and await page.locator("#dcScrim").is_visible(),"hors ligne (refus) : message clair, rien d'enregistré, saisie conservée")
    await page.wait_for_selector("#toast",state="hidden")
    await page.evaluate("window.__fbOffline='hang'"); t=time.time(); await page.click("#dcSave")
    await toast(page,"Pas de réseau : impossible d'attribuer",timeout=16000)
    dt=time.time()-t
    ok(dt>=11 and await page.evaluate("Object.keys(window.__fbdb.docs).length")==n0,f"réseau muet : abandon au bout de {dt:.1f} s (délai de 12 s), rien d'enregistré")
    await page.click("#dcSave"); await toast(page,"Enregistrement en cours…")
    ok(await page.evaluate(NDOCS)==n0,"(1) transaction encore en suspens : nouvel appui sur la même fiche refusé (« Enregistrement en cours… »)")
    await page.evaluate("window.__fbOffline=false")
    for _ in range(60):
        if await page.evaluate("dcLate===null"): break
        await page.wait_for_timeout(50)
    ok(await page.evaluate("dcLate===null"),"(1) la transaction suivie finit en échec : fiche débloquée")
    await page.wait_for_selector("#toast",state="hidden")
    await page.evaluate("OFFLINE=true"); await page.click("#dcSave")
    await toast(page,"Pas de réseau : impossible d'attribuer")
    ok(await page.evaluate("Object.keys(window.__fbdb.docs).length")==n0,"appli hors ligne (OFFLINE) : refus immédiat, rien d'enregistré")
    await page.evaluate("OFFLINE=false"); await page.click("#dcSave"); await toast(page,"Enregistré : "+F(8))
    ok(True,"retour du réseau : la même saisie s'enregistre en "+F(8))
    # (1) validation partie avant les 12 s mais qui n'aboutit qu'après : pas de doublon
    n1=await page.evaluate(NDOCS)
    await new_invoice(page,"Arrivée tardive","20")
    await page.evaluate("window.__fbSlowCommit=17000"); t=time.time(); await page.click("#dcSave")
    await toast(page,"Pas de réseau : impossible d'attribuer un numéro de facture",timeout=16000)
    ok(await page.evaluate(NDOCS)==n1,f"(1) {time.time()-t:.1f} s : message réseau, la facture n'est pas encore arrivée")
    await page.fill("#dcSubj","Retouchée pendant l'attente"); await page.click("#dcSave"); await toast(page,"Enregistrement en cours…")
    ok(await page.evaluate(NDOCS)==n1 and await page.locator("#dcScrim").is_visible(),"(1) nouvel appui pendant l'attente : « Enregistrement en cours… », pas de 2e facture")
    await toast(page,"Facture "+F(9)+" enregistrée",timeout=10000)
    ok(await page.evaluate(NDOCS)==n1+1 and F(9) in await page.evaluate("Object.keys(window.__fbdb.docs)"),f"(1) validation arrivée après {time.time()-t:.1f} s : « Facture {F(9)} enregistrée »")
    ok(await page.inner_text("#dcTitle")=="Facture "+F(9) and await page.locator("#dcTypeWrap").is_hidden(),"(1) la fiche ouverte devient la facture "+F(9))
    await page.click("#dcSave"); await toast(page,"Enregistré : "+F(9))
    dd=await page.evaluate("window.__fbdb.docs")
    ok(await page.evaluate(NDOCS)==n1+1 and dd[F(9)].get("subject")=="Retouchée pendant l'attente" and F(10) not in dd,"(1) nouvel appui : "+F(9)+" est modifiée, aucun doublon")
    # (1) même chose, mais la validation arrive juste après les 12 s et l'utilisateur réappuie ensuite (le doublon d'avant)
    await new_invoice(page,"Arrivée juste après","25")
    await page.evaluate("window.__fbSlowCommit=12600"); await page.click("#dcSave")
    await toast(page,"Pas de réseau : impossible d'attribuer un numéro de facture",timeout=16000)
    await toast(page,"Facture "+F(10)+" enregistrée",timeout=5000)
    await page.click("#dcSave"); await toast(page,"Enregistré : "+F(10)); await page.wait_for_timeout(300)
    dd=await page.evaluate("window.__fbdb.docs")
    ok(await page.evaluate(NDOCS)==n1+2 and F(11) not in dd,"(1) validation arrivée juste après le délai puis nouvel appui : "+F(10)+" modifiée, pas de "+F(11))
    # (2) « Enregistrer » et « PDF » touchés ensemble : un seul numéro
    await page.evaluate(PUT,["meta/company",{"name":"ALS Serrurerie","tvaMode":"franchise","address":"1 rue X, 69000 Lyon","siret":"12345678900011"}])
    await page.wait_for_timeout(200)
    for order,js,end in (("Enregistrer puis PDF","a.click();b.click()","Enregistré : "+F(11)),("PDF puis Enregistrer","b.click();a.click()","PDF")):
        n2=await page.evaluate(NDOCS)
        await new_invoice(page,"Double appui","30")
        st=await page.evaluate("()=>{const a=$('dcSave'),b=$('dcPdf');"+js+";return [a.disabled,b.disabled,dcBusy]}")
        await toast(page,end,timeout=8000); await page.wait_for_timeout(700)
        ok(st==[True,True,True] and await page.evaluate(NDOCS)==n2+1,f"(2) {order} au même instant : un seul document créé, les deux boutons grisés pendant l'écriture {st}")
        if await page.locator("#dcScrim").is_visible(): await page.click("#dcCancel")
    # témoin : sans runTransaction (appli ouverte dans Claude) on garde l'ancien code, qui a la course d'origine
    await page.evaluate("()=>{window.__rt=db.runTransaction;delete db.runTransaction}")
    await page.click("#fab"); await page.wait_for_selector("#dcScrim:not([hidden])")
    await page.click("#dcTypeSeg button[data-v='devis']"); await page.select_option("#dcClient","c1")
    ln=page.locator("#dcLines .lnrow input"); await ln.nth(0).fill("Devis"); await ln.nth(2).fill("10")
    old=await page.evaluate("""async()=>{$('dcSubj').value='A';const p1=dcWrite();$('dcSubj').value='B';const p2=dcWrite();return (await Promise.all([p1,p2])).map(r=>r&&r.num)}""")
    nd=await page.evaluate("Object.keys(window.__fbdb.docs).filter(k=>k.startsWith('D-')).length")
    ok(await page.evaluate("Object.keys(window.__fbdb.meta).some(k=>k.startsWith('seq-devis'))")==False,"sans runTransaction : ancien chemin utilisé (pas de compteur écrit)")
    info(f"témoin ancien chemin, 2 devis simultanés -> numéros {old}, {nd} document(s) en base (1 = écrasement : c'est le bug d'origine, reproduit par ce test)")
    await page.evaluate("()=>{db.runTransaction=window.__rt}")
    ok(not errs,"aucune erreur JS "+str(errs[:2]))
    await ctx.close()

# ---------------------------------------------------------------- (b) RDV terminé
async def t_rdv(b):
    print("\n== (b) RDV terminé -> intervention pré-remplie ==")
    ctx,page,errs,_=await open_app(b)
    today=await page.evaluate("TODAY")
    await page.evaluate(PUT,["clients/c1",CLIENT])
    await page.evaluate(PUT,["rdv/r1",{"date":today,"time":"10:30","title":"Clio 4 clé perdue","clientId":"c1","address":"5 avenue Foch, 69006 Lyon","phone":"0611223344","note":"Portail bleu","done":False,"by":"U1","at":1}])
    await page.evaluate("goMode('planning')")
    await page.click(".pl-card:has-text('Clio 4 clé perdue') button:has-text('Terminé')")
    await page.wait_for_selector("#cScrim:not([hidden])"); await page.wait_for_selector("#cModel:focus")  # cOpen() place le curseur sur Modèle 50 ms après l'ouverture : attendre avant de taper
    v=await page.evaluate(VALS); print("   ",json.dumps(v,ensure_ascii=False))
    ok(await page.evaluate("window.__fbdb.rdv.r1.done")==True,"RDV marqué terminé en base")
    ok(v["title"]=="Véhicule" and await page.locator("#cgR").is_visible(),"formulaire d'intervention véhicule (recette) ouvert")
    ok(v["date"]==today and v["time"]=="10:30","date et heure reprises")
    ok(v["client"]=="c1","client repris")
    ok(v["addr"]=="5 avenue Foch, 69006 Lyon" and v["city"]=="Lyon","adresse reprise, ville tirée du code postal")
    ok(v["note"]=="Clio 4 clé perdue\nPortail bleu","intitulé + note du RDV dans les notes")
    ok(v["st"]=="reussi" and v["amt"]=="","statut « Réussi » proposé, tarif laissé à saisir")
    await page.fill("#cAmt","120"); await page.click("#cSave")
    await page.wait_for_selector("#kScrim:not([hidden])"); await page.evaluate("kClose()")
    ent=await page.evaluate("Object.entries(window.__fbdb.entries||{}).filter(([k,e])=>e.rdvId==='r1').map(([k,e])=>({id:k,...e}))")
    ok(len(ent)==1,"une ligne créée avec rdvId = r1")
    e=ent[0] if ent else {}
    ok(e.get("kind")=="recette" and e.get("amount")==120 and e.get("date")==today and e.get("time")=="10:30" and e.get("clientId")=="c1" and e.get("clientName")=="Garage Martin" and e.get("addr")=="5 avenue Foch, 69006 Lyon","ligne enregistrée : "+json.dumps({k:e.get(k) for k in ("kind","amount","time","clientName","addr","city","status")},ensure_ascii=False))
    # Rouvrir : comportement inchangé (pas de formulaire)
    await page.click(".pl-card:has-text('Clio 4 clé perdue') button:has-text('Rouvrir')")
    await page.wait_for_selector(".pl-card:has-text('Clio 4 clé perdue') button:has-text('Terminé')")
    await page.wait_for_timeout(400)
    ok(await page.evaluate("window.__fbdb.rdv.r1.done")==False and await page.locator("#cScrim").is_hidden(),"« Rouvrir » : RDV rouvert, aucun formulaire")
    # Terminé à nouveau : on rouvre la ligne existante au lieu d'en créer une
    await page.click(".pl-card:has-text('Clio 4 clé perdue') button:has-text('Terminé')")
    await page.wait_for_selector("#cScrim:not([hidden])")
    v=await page.evaluate(VALS)
    ok(v["title"].startswith("Modifier") and v["amt"]=="120","2e « Terminé » : la ligne existante est rouverte (tarif 120)")
    await page.fill("#cNote","Clio 4 clé perdue, faite au PIN"); await page.click("#cSave")
    await page.wait_for_selector("#kScrim:not([hidden])"); await page.evaluate("kClose()")
    ent2=await page.evaluate("Object.entries(window.__fbdb.entries||{}).filter(([k,e])=>e.kind==='recette').map(([k,e])=>({id:k,...e}))")
    ok(len(ent2)==1 and ent2[0].get("rdvId")=="r1" and ent2[0]["id"]==e.get("id") and ent2[0].get("note")=="Clio 4 clé perdue, faite au PIN","modification : toujours une seule ligne, lien rdvId conservé")
    ok(not errs,"aucune erreur JS "+str(errs[:2]))
    await ctx.close()

# ---------------------------------------------------------------- (c) immatriculation connue
async def t_plate(b):
    print("\n== (c) immatriculation connue ==")
    ctx,page,errs,_=await open_app(b)
    await page.evaluate(PUT,["clients/c1",CLIENT])
    base={"kind":"recette","status":"reussi","pay":"carte","by":"U1"}
    await page.evaluate(PUT,["entries/eOld",{**base,"date":"2026-03-02","plate":"AB-123-CD","brand":"renault","model":"Clio IV","year":"2016","clientId":"c1","pin":"1234","keycode":"K-77","addr":"1 rue A","city":"Villeurbanne","amount":100,"at":1000}])
    await page.evaluate(PUT,["entries/eOlder",{**base,"date":"2025-01-10","plate":"AB 123 CD","brand":"renault","model":"Clio III","year":"2008","pin":"9999","keycode":"OLD","addr":"9 rue Z","city":"Lyon","amount":80,"at":500}])
    await page.evaluate(PUT,["entries/eLast",{**base,"date":"2026-05-01","plate":"ZZ-999-ZZ","model":"Golf","city":"Bron","amount":50,"at":5000}])
    await page.evaluate("goMode('comptes');cTab='recette';render()"); await page.click("#fab")
    await page.wait_for_selector("#cScrim:not([hidden])"); await page.wait_for_selector("#cModel:focus")  # cOpen() place le curseur sur Modèle 50 ms après l'ouverture : attendre avant de taper
    ok(await page.input_value("#cCity")=="Bron","ville proposée d'office (dernière ville) : Bron")
    await page.fill("#cPin","0000")
    await page.click("#cPlate"); await page.keyboard.type("ab 12"); await page.wait_for_timeout(450)
    ok(await page.locator("#cPlateHint").is_hidden() and await page.input_value("#cModel")=="","moins de 6 caractères : rien n'est rempli")
    await page.keyboard.type("3 cd")
    ok(await page.input_value("#cModel")=="","attente avant remplissage (anti-rebond)")
    await page.wait_for_selector("#cPlateHint:not([hidden])",timeout=3000)
    v=await page.evaluate(VALS); print("   ",json.dumps(v,ensure_ascii=False))
    ok(v["hint"]=="Repris de l'intervention du 02/03/2026","indication « Repris de l'intervention du 02/03/2026 » (la plus récente)")
    ok(v["model"]=="Clio IV" and v["year"]=="2016" and v["brand"]=="renault","marque, modèle, année repris")
    ok(v["client"]=="c1" and v["key"]=="K-77" and v["addr"]=="1 rue A","client, code de clé, adresse repris")
    ok(v["pin"]=="0000","PIN déjà tapé : non écrasé")
    ok(v["city"]=="Villeurbanne","ville proposée d'office remplacée par celle du véhicule")
    # (3) la plaque était fausse : ce qui venait de l'autre véhicule et n'a pas été retouché disparaît
    await page.fill("#cKeyCode","K-USER")
    await page.fill("#cPlate","AB-123-CE"); await page.wait_for_selector("#cPlateHint",state="hidden",timeout=3000)
    v=await page.evaluate(VALS); print("   ",json.dumps(v,ensure_ascii=False))
    ok(v["model"]==v["year"]==v["brand"]==v["client"]==v["addr"]=="" and v["city"]=="Bron","(3) plaque corrigée (inconnue) : modèle, année, marque, client, adresse repris retirés, ville d'office remise")
    ok(v["key"]=="K-USER" and v["pin"]=="0000","(3) champs retouchés ou tapés par l'utilisateur conservés (code de clé, PIN)")
    await page.fill("#cPlate","ZZ-999-ZZ"); await page.wait_for_selector("#cPlateHint:has-text('01/05/2026')",timeout=3000)
    ok(await page.input_value("#cModel")=="Golf","(3) autre plaque connue : ses informations sont reprises")
    await page.fill("#cPlate","AB-123-CD"); await page.wait_for_selector("#cPlateHint:has-text('02/03/2026')",timeout=3000)
    v=await page.evaluate(VALS)
    ok(v["model"]=="Clio IV" and v["year"]=="2016" and v["city"]=="Villeurbanne" and v["brand"]=="renault" and v["client"]=="c1","(3) retour à la 1re plaque : « Golf » (rempli automatiquement) remplacé par « Clio IV »")
    ok(v["key"]=="K-USER" and v["pin"]=="0000","(3) toujours sans toucher au code de clé ni au PIN de l'utilisateur")
    await page.click("#cCancel")
    # champs tapés par l'utilisateur : jamais écrasés ; déclenchement aussi sur « change »
    await page.click("#fab"); await page.wait_for_selector("#cScrim:not([hidden])"); await page.wait_for_selector("#cModel:focus")  # cOpen() place le curseur sur Modèle 50 ms après l'ouverture : attendre avant de taper
    await page.fill("#cCity","Paris"); await page.fill("#cModel","Megane"); await page.fill("#cAddr","")
    await page.evaluate("()=>{$('cPlate').value='ab123cd';$('cPlate').dispatchEvent(new Event('change'))}")
    v=await page.evaluate(VALS)
    ok(v["city"]=="Paris" and v["model"]=="Megane","ville et modèle tapés : conservés")
    ok(v["year"]=="2016" and v["addr"]=="1 rue A" and v["hint"]!="","événement change : remplissage immédiat des cases vides (année, adresse)")
    await page.fill("#cPlate","XY-555-ZZ"); await page.wait_for_timeout(450)
    ok(await page.locator("#cPlateHint").is_hidden(),"immatriculation inconnue : indication masquée")
    await page.click("#cCancel")
    # la ligne en cours de modification n'est pas sa propre source
    await page.evaluate("cOpen(entries.find(e=>e.id==='eOld'))"); await page.wait_for_selector("#cScrim:not([hidden])")
    await page.fill("#cPin",""); await page.fill("#cPlate","AB-123-CD ")
    await page.wait_for_selector("#cPlateHint:not([hidden])",timeout=3000)
    v=await page.evaluate(VALS)
    ok(v["pin"]=="9999" and v["hint"]=="Repris de l'intervention du 10/01/2025" and v["model"]=="Clio IV","en modification : la ligne elle-même est exclue (source = intervention de 2025)")
    await page.click("#cCancel")
    ok(not errs,"aucune erreur JS "+str(errs[:2]))
    await ctx.close()

# ---------------------------------------------------------------- (d) sauvegardes chiffrées
def make_alsbk(obj,key,path,corrupt=False):
    iv=os.urandom(12); ct=AESGCM(key).encrypt(iv,json.dumps(obj,ensure_ascii=False).encode("utf-8"),None)
    data=bytearray(b"ALSBK1"+iv+ct)
    if corrupt: data[40]^=0x01
    open(path,"wb").write(bytes(data)); return path

async def t_backup(b,tmp,csp_bypass=True):
    print("\n== (d) restauration .alsbk "+("" if csp_bypass else "(SANS contournement CSP)")+" ==")
    key=os.urandom(32); k64=base64.b64encode(key).decode(); other=base64.b64encode(os.urandom(32)).decode()
    plain={"app":"AutoLockSolution","format":1,"at":"2026-10-14T01:00:00.000Z","auto":True,"collections":{
        "items":[{"id":"bk1","section":"lame_m","group":"hu","name":"HU-SAUVEGARDE","ref":"X","compat":"","qty":7,"note":"","series":""}],
        "entries":[{"id":"bke1","kind":"recette","date":"2026-09-01","amount":90,"pay":"carte","status":"reussi","model":"Twingo","by":"U1","at":1}],
        "ideas":[],"codes":[],"photos":[{"id":"ph1","d":"data:image/jpeg;base64,AAAA"}],"clients":[{"id":"bkc1","name":"Client Sauvegardé é€"}],
        "docs":[],"orders":[],"vehicles":[],"rdv":[],"news":[],"meta":[{"id":"backup","at":1,"by":"auto","n":3},{"id":"seq-facture-2026","n":999},{"id":"company","name":"Sauvegarde SARL","tvaMode":"franchise"},{"id":"pirate","x":1}]}}
    good=make_alsbk(plain,key,os.path.join(tmp,"sauvegarde-auto-2026-10-14.alsbk"))
    bad=make_alsbk(plain,key,os.path.join(tmp,"sauvegarde-auto-abimee.alsbk"),corrupt=True)
    js=os.path.join(tmp,"sauvegarde-manuelle.json")
    open(js,"w",encoding="utf-8").write(json.dumps({"app":"AutoLockSolution","format":1,"at":"2026-10-01T10:00:00.000Z","auto":True,"collections":{"items":[{"id":"js1","section":"lame_m","group":"hu","name":"JSON","qty":1}]}}))
    ctx,page,errs,csp=await open_app(b,csp_bypass,["clipboard-read","clipboard-write"])
    at=await page.evaluate("new Date(2026,9,14,3,7).getTime()")
    await page.evaluate(PUT,["meta/backup",{"at":at,"by":"auto","n":6}])
    await page.evaluate(PUT,["bkey/main",{"k":k64,"at":at}])
    await page.evaluate("document.getElementById('bkBtn').click()"); await page.click("#stBk")
    await page.wait_for_selector("#bScrim:not([hidden])")
    ok("Sauvegarde automatique : dernière le 14/10/2026 à 03:07" in await page.inner_text("#bStat"),"état : « Sauvegarde automatique : dernière le 14/10/2026 à 03:07 »")
    acc=await page.get_attribute("#bFile","accept"); ok(".alsbk" in acc and ".json" in acc,"sélecteur de fichier : .alsbk et .json acceptés ("+acc+")")
    # clé de secours
    await page.click("#bKeyBtn"); await page.wait_for_selector("#bKeyBox:not([hidden])")
    ok(await page.input_value("#bKey")==k64 and await page.get_attribute("#bKey","readonly") is not None,"clé de secours affichée en lecture seule")
    ok("Sans elle, les sauvegardes automatiques ne peuvent pas être ouvertes" in await page.inner_text("#bKeyBox"),"conseil de conservation affiché")
    await page.click("#bKeyCopy"); await toast(page,"Clé copiée")
    ok(await page.evaluate("navigator.clipboard.readText()")==k64,"« Copier » : clé dans le presse-papiers")
    # restauration avec la clé de bkey/main
    await page.set_input_files("#bFile",good); await page.wait_for_selector("#bConfirm:not([hidden])")
    txt=await page.inner_text("#bRestore"); print("   ",txt)
    ok(txt.startswith("Prêt à restaurer 5 éléments (1 stock, 1 comptes et planning, 0 achats, 0 codes, 1 clients, 0 devis/factures)"),"aperçu du contenu déchiffré (5 éléments)")
    ok("sauvegarde automatique du 14/10/2026" in txt,"aperçu : « sauvegarde automatique du 14/10/2026 »")
    ok("Vos informations d'entreprise (« Mes informations ») seront remplacées par celles du fichier." in txt,"(6) aperçu : remplacement de « Mes informations » annoncé")
    await page.evaluate(PUT,[f"meta/seq-facture-2026",{"n":4}])
    await page.click("#bConfirm"); await page.wait_for_selector("#bRestore:has-text('Restauration terminée')",timeout=10000)
    d=await page.evaluate("window.__fbdb")
    ok(d["items"].get("bk1",{}).get("name")=="HU-SAUVEGARDE" and d["clients"].get("bkc1",{}).get("name")=="Client Sauvegardé é€" and "ph1" in d.get("photos",{}) and "bke1" in d["entries"],"données restaurées en base (accents UTF-8 intacts)")
    ok(d["meta"].get("company",{}).get("name")=="Sauvegarde SARL","(6) meta/company restauré")
    ok(d["meta"].get("seq-facture-2026")=={"n":4} and d["meta"].get("backup",{}).get("at")==at and "pirate" not in d["meta"],"(6) meta/seq-*, meta/backup et meta inconnus du fichier : ignorés")
    # mauvaise clé en ligne -> message + saisie manuelle
    await page.evaluate(PUT,["bkey/main",{"k":other}])
    await page.set_input_files("#bFile",good); await toast(page,"Clé incorrecte ou fichier abîmé")
    await page.wait_for_selector("#bKeyIn:not([hidden])")
    ok("clé incorrecte ou fichier abîmé" in await page.inner_text("#bKeyInMsg") and await page.locator("#bConfirm").is_hidden(),"mauvaise clé : erreur claire, rien à confirmer, champ de saisie de la clé affiché")
    await page.fill("#bKeyMan","abc"); await page.click("#bKeyGo"); await toast(page,"Clé de secours invalide")
    ok(await page.locator("#bConfirm").is_hidden(),"clé saisie invalide : refusée")
    await page.fill("#bKeyMan","  "+k64[:20]+"\n"+k64[20:]+" "); await page.click("#bKeyGo")
    await page.wait_for_selector("#bConfirm:not([hidden])")
    ok(await page.locator("#bKeyIn").is_hidden() and "Prêt à restaurer 5" in await page.inner_text("#bRestore"),"bonne clé collée à la main (avec espaces/retour ligne) : fichier ouvert")
    # pas de clé en ligne
    await page.evaluate(DEL,"bkey/main")
    await page.set_input_files("#bFile",good); await page.wait_for_selector("#bKeyIn:not([hidden])")
    ok("Aucune clé de secours" in await page.inner_text("#bKeyInMsg") and await page.locator("#bConfirm").is_hidden(),"pas de bkey/main : message + saisie manuelle")
    await page.click("#bKeyBtn"); await page.wait_for_selector("#bKeyMsg:not([hidden])")
    ok(await page.inner_text("#bKeyMsg")=="La première sauvegarde automatique n'a pas encore eu lieu.","« Afficher la clé » sans clé : « La première sauvegarde automatique n'a pas encore eu lieu. »")
    # fichier abîmé, bonne clé
    await page.evaluate(PUT,["bkey/main",{"k":k64}])
    await page.set_input_files("#bFile",bad); await toast(page,"Clé incorrecte ou fichier abîmé")
    ok(await page.locator("#bConfirm").is_hidden(),"fichier abîmé (1 octet modifié) : refusé")
    # .json toujours accepté
    await page.set_input_files("#bFile",js); await page.wait_for_selector("#bConfirm:not([hidden])")
    t2=await page.inner_text("#bRestore")
    ok(t2.startswith("Prêt à restaurer 1 éléments") and "sauvegarde du 01/10/2026" in t2 and await page.locator("#bKeyIn").is_hidden(),"sauvegarde .json manuelle : toujours acceptée")
    ok("automatique" not in t2 and "Mes informations" not in t2,"(6) .json marqué « auto »: true : pas de libellé « automatique » (réservé aux .alsbk déchiffrés), pas d'annonce « Mes informations »")
    if csp_bypass:
        big=await page.evaluate("()=>{const L=n=>Array.from({length:n},(_,i)=>({id:'x'+i,name:'n'}));const a=bkPrepare(JSON.stringify({app:'AutoLockSolution',collections:{items:L(15000)}}));const b=bkPrepare(JSON.stringify({app:'AutoLockSolution',collections:{items:L(20001)}}));return [a&&a.n,b]}")
        ok(big[0]==15000 and big[1] is None,f"limite relevée : 15 000 éléments acceptés, 20 001 refusés ({big})")
    ok(not errs,"aucune erreur JS "+str(errs[:2]))
    if not csp_bypass: ok(not csp,"aucune violation CSP "+str(csp[:2]))
    await page.click("#bClose")
    ok(await page.evaluate("$('bKey').value")=="","clé effacée de la page à la fermeture")
    await ctx.close()

# ---------------------------------------------------------------- (4) rappel : sauvegarde automatique arrêtée
async def t_remind(b):
    print("\n== (4) rappel sauvegarde automatique ==")
    ctx,page,errs,_=await open_app(b)
    await page.evaluate("goMode('accueil');remOpen=true;remindRender()")
    D=86400000; nowms=await page.evaluate("Date.now()")
    async def setbk(days,by):
        await page.evaluate(PUT,["meta/backup",{"at":nowms-days*D,"by":by,"n":10}]); await page.wait_for_timeout(300)
        return await page.inner_text("#remind") if await page.locator("#remind").is_visible() else ""
    t=await setbk(5.2,"auto")
    ok("Sauvegarde automatique arrêtée depuis 5 jours" in t,"(4) auto, dernière il y a 5 jours : « Sauvegarde automatique arrêtée depuis 5 jours »")
    t=await setbk(1,"auto"); ok("Sauvegarde" not in t,"(4) auto, dernière hier : pas de rappel")
    t=await setbk(3.5,"auto"); ok("arrêtée depuis 3 jours" in t,"(4) auto, plus de 3 jours : rappel")
    t=await setbk(10,"U1"); ok("Sauvegarde" not in t,"(4) manuelle il y a 10 jours : pas de rappel (règle des 30 jours inchangée)")
    t=await setbk(40,"U1"); ok("Dernière sauvegarde il y a 40 jours" in t and "automatique" not in t,"(4) manuelle il y a 40 jours : rappel habituel")
    ok(not errs,"aucune erreur JS "+str(errs[:2]))
    await ctx.close()

# ---------------------------------------------------------------- (5) appli reprise après minuit / changement d'année
async def t_date(b):
    print("\n== (5) date du jour après reprise de l'appli ==")
    P=ZoneInfo("Europe/Paris")
    ctx,page,errs,_=await open_app(b,tz="Europe/Paris",clock=datetime(2025,12,31,23,58,tzinfo=P))
    ok(await page.evaluate("TODAY")=="2025-12-31","appli ouverte le 31/12/2025 à 23 h 58")
    await page.evaluate(PUT,["clients/c1",CLIENT])
    await page.clock.set_system_time(datetime(2026,1,2,8,0,tzinfo=P))
    ok(await page.evaluate("TODAY")=="2025-12-31" and await page.evaluate("new Date().getDate()")==2,"reprise le 02/01/2026 à 8 h sans rechargement : date interne encore périmée")
    await page.evaluate("goMode('devis')"); await new_invoice(page,"Ouverture porte","90")
    ok(await page.input_value("#dcDate")=="2026-01-02","(5) nouvelle facture datée du 02/01/2026 (pas du 31/12/2025)")
    await page.click("#dcSave"); await toast(page,"Enregistré : F-2026-0001")
    ok("F-2026-0001" in await page.evaluate("Object.keys(window.__fbdb.docs)"),"(5) numérotée F-2026-0001 (année 2026)")
    await page.clock.set_system_time(datetime(2026,1,3,9,0,tzinfo=P))
    await page.evaluate("goMode('comptes');cTab='recette';render()")
    ok(await page.evaluate("TODAY")=="2026-01-02","nouvelle reprise le 03/01/2026 : date interne encore celle de la veille")
    await page.click("#fab"); await page.wait_for_selector("#cScrim:not([hidden])")
    ok(await page.input_value("#cDate")=="2026-01-03" and await page.evaluate("[Y,M,pDay]")==[2026,0,"2026-01-03"],"(5) nouvelle intervention datée du 03/01/2026, mois affiché et jour du planning suivent")
    await page.click("#cCancel")
    ok(not errs,"aucune erreur JS "+str(errs[:2]))
    await ctx.close()

async def main():
    srv=subprocess.Popen([sys.executable,"-m","http.server",str(PORT),"--bind","127.0.0.1"],cwd=os.path.join(HERE,"dist"),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
    tmp=tempfile.mkdtemp()
    try:
        async with async_playwright() as pw:
            b=await pw.chromium.launch()
            for t in (t_invoices,t_rdv,t_plate,t_remind,t_date):
                try: await t(b)
                except Exception as e: ok(False,t.__name__+" interrompu : "+str(e).splitlines()[0])
            for bypass in (True,False):
                try: await t_backup(b,tmp,bypass)
                except Exception as e: ok(False,"t_backup interrompu : "+str(e).splitlines()[0])
            await b.close()
    finally: srv.terminate()
    print("\nRÉSULTAT :","TOUT PASSE" if not FAILS else "ÉCHEC ("+str(len(FAILS))+") "+str(FAILS)); sys.exit(1 if FAILS else 0)
asyncio.run(main())
