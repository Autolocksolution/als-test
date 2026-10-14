import sys
src=open("new_base.html",encoding="utf-8").read()
s=src
fails=[]
def sub(old,new,count=1,name=""):
    global s
    n=s.count(old)
    if n!=count:
        fails.append(f"{name or old[:60]!r}: {n} occurrence(s), attendu {count}");return
    s=s.replace(old,new)

# 1. restauration rapide
sub('''  $("bConfirm").disabled=true;let done=0;
  try{
    for(const c of BK_COLS)for(const x of b.plan[c]){await db.doc(c+"/"+x.id).set(x.data);done++;if(done%10===0)$("bRestore").textContent="Restauration… "+done+" / "+b.n}''',
'''  $("bConfirm").disabled=true;let done=0;migrating=true;
  try{
    for(const c of BK_COLS){const L=b.plan[c];for(let i=0;i<L.length;i+=20){const part=L.slice(i,i+20);await Promise.all(part.map(x=>db.doc(c+"/"+x.id).set(x.data)));done+=part.length;$("bRestore").textContent="Restauration… "+done+" / "+b.n}}''',name="restore1")
sub('''  $("bConfirm").disabled=false;
});
function backupDue(){''','''  migrating=false;clearTimeout(mgT);$("bConfirm").disabled=false;render();offBar();saveCache();
});
function backupDue(){''',name="restore2")

# 2. notify helper
sub('function toast(t){','''let myName="";
/* Notification à envoyer par le robot (collection outbox). to:"others" = l'associé, "all" = tout le monde. Ne bloque jamais l'appli. */
function notify(kind,title,body,to){
  try{if(!db||!uid||OFFLINE)return;db.collection("outbox").add({kind,title:String(title).slice(0,80),body:String(body||"").slice(0,200),to:to||"others",by:uid,byName:myName,sent:false,at:Date.now()}).catch(()=>{})}catch(e){}
}
function toast(t){''',name="notify")
sub('  try{uid=user?await user.id():null}catch(e){}\n','  try{uid=user?await user.id():null}catch(e){}\n  try{const m=user&&user.me?await user.me():null;if(m&&m.name)myName=m.name}catch(e){}\n',name="myName")
sub('  user=u;db=d?guardDb(d):null;\n','  user=u;db=d?guardDb(d):null;\n  try{pushApi=await c.use("push");if(pushApi)$("stPushBox").hidden=false}catch(e){}\n',name="pushboot")

# 3. stock bas
sub('''    p.dirty=false;
    try{const ex=items.some(x=>x.id===id);if(ex||!p.doc)await db.doc("items/"+id).update({qty:p.qty,by:uid,at:Date.now()});else await db.doc("items/"+id).set({...p.doc,qty:p.qty,by:uid,at:Date.now()})}''',
'''    p.dirty=false;
    try{const cur=items.find(x=>x.id===id),ex=!!cur,wasLow=cur?isLow(cur):true,sent=p.qty;
      if(ex||!p.doc)await db.doc("items/"+id).update({qty:p.qty,by:uid,at:Date.now()});else await db.doc("items/"+id).set({...p.doc,qty:p.qty,by:uid,at:Date.now()});
      const ref=cur||p.doc;if(ref&&!wasLow&&isLow({...ref,qty:sent}))notify("stock","Stock bas : "+(ref.name||"pièce"),"Il en reste "+sent+" (seuil "+thrOf(ref)+")"+(myName?" · "+myName:""),"all")}''',name="stock")

# 4. RDV
sub('''    if(rvEditing)await db.doc("rdv/"+rvEditing.id).update(data);else await db.collection("rdv").add({...data,done:false});
    pDay=date;''','''    const fresh=!rvEditing,moved=rvEditing&&(rvEditing.date!==date||(rvEditing.time||"")!==data.time);
    if(rvEditing)await db.doc("rdv/"+rvEditing.id).update(data);else await db.collection("rdv").add({...data,done:false});
    if(fresh||moved)notify("rdv",(fresh?"Nouveau RDV":"RDV modifié")+" · "+fmtDate(date)+(data.time?" "+data.time:""),title+(data.address?" · "+data.address:"")+(myName?" ("+myName+")":""));
    pDay=date;''',name="rdv")
sub('''  try{await db.doc("rdv/"+rvEditing.id).delete();rvClose();''','''  try{const gone=rvEditing;await db.doc("rdv/"+gone.id).delete();notify("rdv","RDV supprimé · "+fmtDate(gone.date)+(gone.time?" "+gone.time:""),(gone.title||"")+(myName?" ("+myName+")":""));rvClose();''',name="rdvdel")
# 5. commande
sub('''  try{await db.collection("orders").add({date:TODAY,status:"passee",lines,by:uid,at:Date.now()});''','''  try{await db.collection("orders").add({date:TODAY,status:"passee",lines,by:uid,at:Date.now()});notify("commande","Nouvelle commande de pièces",lines.length+" ligne"+(lines.length>1?"s":"")+(myName?" ("+myName+")":""));''',name="order")
# 6. doc + actu
sub('data.num=num;await db.doc("docs/"+num).set(data);\n','data.num=num;await db.doc("docs/"+num).set(data);\n  notify("doc",(data.type==="facture"?"Nouvelle facture ":"Nouveau devis ")+num,(data.clientName||"")+(myName?" ("+myName+")":""));\n',name="doc")
sub('''state:"saved",date:TODAY,by:uid,at:Date.now()});
    $("adScrim").hidden=true;''','''state:"saved",date:TODAY,by:uid,at:Date.now()});
    notify("actu","Nouveau lien gardé",$("adTitle").value.trim()+(myName?" ("+myName+")":""));
    $("adScrim").hidden=true;''',name="actu")

# 7. UI notifications dans Réglages
sub('    <h3 class="h3">Sécurité</h3>\n','''    <div id="stPushBox" hidden><h3 class="h3">Notifications</h3>
    <div class="acts"><button type="button" class="btn" id="stPush">Activer les notifications</button><button type="button" class="btn" id="stPushTest" hidden>Tester</button></div>
    <p class="hint" id="stPushT"></p></div>
    <h3 class="h3">Sécurité</h3>
''',name="pushUI")
sub('$("stLock").addEventListener("click"','''let pushApi=null;
async function pushPaint(){
  if(!pushApi)return;
  const st=await pushApi.status().catch(()=>({state:"unsupported"}));
  const T={on:"Activées sur cet appareil : rappel 1 h avant chaque rendez-vous et récapitulatif du planning chaque matin.",
    off:"Rappel 1 h avant chaque rendez-vous et récapitulatif du planning chaque matin.",
    blocked:"Notifications refusées. Réglages de l'iPhone > Notifications > AutoLock pour les autoriser.",
    install:"Pour recevoir les notifications sur iPhone : ouvrir l'appli depuis son icône sur l'écran d'accueil (pas depuis Safari).",
    unsupported:"Ce navigateur ne gère pas les notifications.",
    nokey:"Notifications pas encore configurées côté serveur."};
  $("stPushT").textContent=T[st.state]||"";
  const b=$("stPush");b.disabled=!(st.state==="on"||st.state==="off");
  b.textContent=st.state==="on"?"Désactiver les notifications":"Activer les notifications";
  $("stPushTest").hidden=st.state!=="on";
}
$("stPush").addEventListener("click",async()=>{
  const b=$("stPush");b.disabled=true;
  try{const st=await pushApi.status();
    if(st.state==="on"){await pushApi.disable();toast("Notifications désactivées")}
    else{await pushApi.enable();toast("Notifications activées")}}
  catch(e){toast(e&&e.message?e.message:"Activation impossible")}
  pushPaint();
});
$("stPushTest").addEventListener("click",async()=>{try{await pushApi.test();toast("Notification envoyée")}catch(e){toast("Test impossible")}});
$("stLock").addEventListener("click"''',name="pushJS")
sub('$("bkBtn").addEventListener("click",()=>{stPaint();','$("bkBtn").addEventListener("click",()=>{stPaint();pushPaint();',name="bkBtn")

if fails:
    print("ÉCHECS:");[print(" -",f) for f in fails];sys.exit(1)
open("autolocksolution.html","w",encoding="utf-8").write(s)
print("OK, patches appliqués",len(s),"octets")
