/* ===== AutoLockSolution : mode autonome (Firebase) =====
   Remplace window.claude quand la page est ouverte hors de Claude.
   Fournit : db (Firestore), user (Firebase Auth), downloads (partage iOS / téléchargement). sample = absent. */
const ALS_BUILD="__BUILD__";
const SDK_V="10.14.1",SDK_BASE="https://www.gstatic.com/firebasejs/"+SDK_V+"/";
const CFG={
  apiKey:"AIzaSyCAnJg9b_5_eRs8F3Li36FX7kevmiUZbq4",
  authDomain:"autlocksolution.firebaseapp.com",
  projectId:"autlocksolution",
  storageBucket:"autlocksolution.firebasestorage.app",
  messagingSenderId:"180980896952",
  appId:"1:180980896952:web:fab35ad253cf69fd2f504d"
};
const G=id=>document.getElementById(id);
const wait=G("lgWait"),form=G("lgForm"),scrim=G("lgScrim"),msg=G("lgMsg");
function showWait(t,retry){scrim.hidden=false;form.hidden=true;wait.hidden=false;G("lgWaitT").textContent=t;G("lgRetry").hidden=!retry}
function showForm(){try{if(!G("lgMail").value)G("lgMail").value=localStorage.getItem("als-last-mail")||""}catch(e){}scrim.hidden=false;wait.hidden=true;form.hidden=false;G("lgBad").textContent="";try{window.__lkPaint&&window.__lkPaint()}catch(e){}setTimeout(()=>{try{(G("lgMail").value?G("lgPass"):G("lgMail")).focus()}catch(e){}},50)}
function hideAll(){scrim.hidden=true}
G("lgRetry").addEventListener("click",()=>location.reload());
/* Déjà connecté sur ce téléphone : on n'affiche pas « Connexion en cours… » par-dessus l'appli.
   Elle s'ouvre tout de suite sur la copie locale ; si la synchronisation ne répond pas en 12 s (réseau faible),
   elle continue en mode hors ligne et se resynchronise à la prochaine ouverture ou au retour du réseau. */
const signed=(()=>{try{return localStorage.getItem("als-signed")==="1"}catch(e){return false}})();
let started=false,fellBack=false;
function fallBack(){
  if(started||fellBack||!signed)return false;
  fellBack=true;window.claude={use:async()=>null};
  window.__alsResolve&&window.__alsResolve(window.claude);
  /* resynchronisation discrète : rechargement quand l'appli passe en arrière-plan */
  document.addEventListener("visibilitychange",()=>{if(document.hidden)location.reload()});
  return true;
}
const fbTimer=signed?setTimeout(fallBack,12000):0;
if(signed)hideAll();else showWait("Connexion en cours…");

(async()=>{
  let A,Au,F;
  try{
    if(window.__ALS_SDK){({A,Au,F}=window.__ALS_SDK)}
    else{[A,Au,F]=await Promise.all([import(SDK_BASE+"firebase-app.js"),import(SDK_BASE+"firebase-auth.js"),import(SDK_BASE+"firebase-firestore.js")])}
  }catch(e){if(fallBack())return;showWait("Impossible de charger la synchronisation. Vérifiez votre connexion internet, puis réessayez.",true);return}

  const app=A.initializeApp(CFG);
  const auth=Au.getAuth(app);
  let fs;
  try{fs=F.initializeFirestore(app,{localCache:F.persistentLocalCache({tabManager:F.persistentMultipleTabManager()})})}
  catch(e){fs=F.getFirestore(app)}

  /* ---------- données ---------- */
  const strip=v=>{
    if(Array.isArray(v))return v.map(strip);
    if(v&&typeof v==="object"&&Object.getPrototypeOf(v)===Object.prototype){const o={};for(const k of Object.keys(v)){if(v[k]!==undefined)o[k]=strip(v[k])}return o}
    return v;
  };
  /* Une écriture hors ligne reste en file d'attente côté Firebase : on rend la main au bout de 5 s
     sans bloquer l'écran, mais une vraie erreur (droits refusés…) remonte tout de suite. */
  const soon=p=>Promise.race([p,new Promise(r=>setTimeout(r,5000))]);
  const docSnap=s=>({id:s.id,exists:s.exists(),data:()=>s.data(),fromCache:!!(s.metadata&&s.metadata.fromCache)});
  const colSnap=q=>({docs:q.docs.map(d=>({id:d.id,data:()=>d.data()})),size:q.size,fromCache:!!(q.metadata&&q.metadata.fromCache)});
  function docApi(path){
    const ref=F.doc(fs,path);
    return{
      id:ref.id,
      get:async()=>docSnap(await F.getDoc(ref)),
      set:(data,opts)=>soon(opts?F.setDoc(ref,strip(data),opts):F.setDoc(ref,strip(data))),
      update:data=>soon(F.updateDoc(ref,strip(data))),
      delete:()=>soon(F.deleteDoc(ref)),
      onSnapshot:(cb,err)=>F.onSnapshot(ref,s=>cb(docSnap(s)),e=>{if(err)err(e)})
    };
  }
  function colApi(path){
    const ref=F.collection(fs,path);
    return{
      add:async data=>{const r=F.doc(ref);await soon(F.setDoc(r,strip(data)));return{id:r.id}},
      get:async()=>colSnap(await F.getDocs(ref)),
      onSnapshot:(cb,err)=>F.onSnapshot(ref,q=>cb(colSnap(q)),e=>{if(err)err(e)}),
      doc:id=>docApi(path+"/"+id)
    };
  }
  /* Transaction (numéros de devis / facture) : toutes les lectures avant les écritures.
     Firestore refuse les transactions hors ligne ; on rend la main au bout de 12 s pour ne pas bloquer l'écran,
     et une tentative relancée après ce délai n'écrit plus rien. Mais une validation déjà partie peut encore
     aboutir : l'erreur de délai porte alors la transaction en cours (err.pending) pour que l'appli la suive. */
  function runTransaction(fn){
    let gaveUp=false,timer;
    const late=()=>Object.assign(new Error("Délai dépassé"),{code:"deadline-exceeded"});
    const run=F.runTransaction(fs,t=>{
      if(gaveUp)throw late();
      return fn({
        get:async path=>docSnap(await t.get(F.doc(fs,path))),
        set:(path,data)=>{if(gaveUp)throw late();t.set(F.doc(fs,path),strip(data))},
        update:(path,data)=>{if(gaveUp)throw late();t.update(F.doc(fs,path),strip(data))}
      });
    });
    const stop=new Promise((_,j)=>{timer=setTimeout(()=>{gaveUp=true;j(Object.assign(late(),{pending:run}))},12000)});
    return Promise.race([run,stop]).finally(()=>clearTimeout(timer));
  }
  const dbApi={collection:colApi,doc:docApi,runTransaction};

  /* ---------- utilisateur ---------- */
  const names=new Map();
  async function profiles(ids){
    const out={};
    await Promise.all(ids.map(async id=>{
      if(!names.get(id)){try{const s=await F.getDoc(F.doc(fs,"team/"+id));if(s.exists()&&s.data().name)names.set(id,s.data().name)}catch(e){}}
      out[id]={name:names.get(id)||""};
    }));
    return out;
  }
  function userApi(u){
    const nm=()=>names.get(u.uid)||(u.displayName||(u.email||"").split("@")[0]);
    return{
      id:async()=>u.uid,
      me:async()=>({id:u.uid,name:nm(),email:u.email}),
      can:async()=>true,canEdit:()=>true,isOwner:()=>true,
      profiles
    };
  }

  /* ---------- téléchargements ---------- */
  async function save({filename,data}){
    const ext=(filename.split(".").pop()||"").toLowerCase();
    const mime={pdf:"application/pdf",json:"application/json",csv:"text/csv;charset=utf-8"}[ext]||"application/octet-stream";
    const blob=new Blob([data],{type:mime});
    try{
      const file=new File([blob],filename,{type:mime});
      if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:filename});return}
    }catch(e){if(e&&e.name==="AbortError")return}
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }

  /* ---------- notifications (FCM) ---------- */
  const VAPID="__VAPID__";
  const PUSH_KEY="als-push-token";
  const lsGet=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
  const lsSet=(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}};
  async function msgLib(){return window.__ALS_SDK&&window.__ALS_SDK.M?window.__ALS_SDK.M:await import(SDK_BASE+"firebase-messaging.js")}
  function pushApi(u){
    const reg=async()=>{
      if(!("serviceWorker" in navigator))throw new Error("Service worker indisponible");
      const r=await Promise.race([navigator.serviceWorker.ready,new Promise((_,j)=>setTimeout(()=>j(new Error("Appli pas encore prête, réessayez dans un instant")),8000))]);
      return r;
    };
    return{
      status:async()=>{
        if(!("Notification" in window)||!("serviceWorker" in navigator))return{state:"install"};
        if(!("PushManager" in window))return{state:/iPhone|iPad|iPod/.test(navigator.userAgent)?"install":"unsupported"};
        if(!VAPID||VAPID.startsWith("__"))return{state:"nokey"};
        if(Notification.permission==="denied")return{state:"blocked"};
        return{state:Notification.permission==="granted"&&lsGet(PUSH_KEY)?"on":"off"};
      },
      enable:async()=>{
        const perm=await Notification.requestPermission();
        if(perm!=="granted")throw new Error("Autorisation refusée");
        const [M,r]=await Promise.all([msgLib(),reg()]);
        let token;
        try{token=await M.getToken(M.getMessaging(app),{vapidKey:VAPID,serviceWorkerRegistration:r})}
        catch(e){throw new Error("Activation impossible ("+((e&&e.code)||"erreur")+")")}
        if(!token)throw new Error("Aucun jeton reçu");
        await soon(F.setDoc(F.doc(fs,"devices/"+token),{token,uid:u.uid,email:u.email||"",at:Date.now(),ua:(navigator.userAgent||"").slice(0,160)}));
        lsSet(PUSH_KEY,token);
      },
      disable:async()=>{
        const t=lsGet(PUSH_KEY);
        try{const M=await msgLib();await M.deleteToken(M.getMessaging(app))}catch(e){}
        if(t){try{await soon(F.deleteDoc(F.doc(fs,"devices/"+t)))}catch(e){}}
        lsSet(PUSH_KEY,null);
      },
      test:async()=>{const r=await reg();await r.showNotification("AutoLockSolution",{body:"Les notifications fonctionnent sur cet appareil.",icon:"als-192.png",badge:"als-192.png",tag:"als-test"})}
    };
  }

  /* ---------- connexion ---------- */
  const FR={
    "auth/invalid-credential":"E-mail ou mot de passe incorrect.","auth/wrong-password":"E-mail ou mot de passe incorrect.",
    "auth/user-not-found":"E-mail ou mot de passe incorrect.","auth/invalid-email":"Adresse e-mail invalide.",
    "auth/too-many-requests":"Trop d'essais. Patientez quelques minutes puis réessayez.",
    "auth/network-request-failed":"Pas de réseau. Vérifiez votre connexion.","auth/user-disabled":"Ce compte est désactivé."
  };
  /* Anti-devinette : après 5 échecs, le formulaire se bloque (30 s, puis le double à chaque nouvel échec, jusqu'à 15 min).
     Le compteur est mémorisé sur l'appareil. La vraie barrière est celle de Firebase (blocage côté serveur) : voir plus bas. */
  const LK="als-login-fail";
  const lkRead=()=>{try{return JSON.parse(localStorage.getItem(LK)||"{}")}catch(e){return{}}};
  const lkWrite=o=>{try{localStorage.setItem(LK,JSON.stringify(o))}catch(e){}};
  const fmtWait=ms=>{const s=Math.ceil(ms/1000);return s>=60?Math.ceil(s/60)+" min":s+" s"};
  let lkTimer=null;
  function lkPaint(){
    clearInterval(lkTimer);
    const st=lkRead(),left=(st.until||0)-Date.now(),b=G("lgGo");
    if(left>0){
      b.disabled=true;G("lgBad").textContent="Trop d'essais. Réessayez dans "+fmtWait(left)+".";
      lkTimer=setInterval(()=>{const l=(lkRead().until||0)-Date.now();if(l<=0){clearInterval(lkTimer);b.disabled=false;G("lgBad").textContent=""}else G("lgBad").textContent="Trop d'essais. Réessayez dans "+fmtWait(l)+"."},1000);
      return true;
    }
    b.disabled=false;return false;
  }
  function lkFail(){
    const st=lkRead();st.n=(st.n||0)+1;
    if(st.n>=5){const k=st.n-5;st.until=Date.now()+Math.min(30000*Math.pow(2,k),900000)}
    lkWrite(st);
  }
  function lkOk(){lkWrite({})}
  window.__lkPaint=lkPaint;
  form.addEventListener("submit",async e=>{
    e.preventDefault();
    if(lkPaint())return;
    const b=G("lgGo");b.disabled=true;G("lgBad").textContent="";
    try{await Au.signInWithEmailAndPassword(auth,G("lgMail").value.trim(),G("lgPass").value);lkOk();try{localStorage.setItem("als-last-mail",G("lgMail").value.trim())}catch(e){}}
    catch(err){
      const c=err&&err.code;
      if(c==="auth/invalid-credential"||c==="auth/wrong-password"||c==="auth/user-not-found"||c==="auth/too-many-requests")lkFail();
      if(!lkPaint())G("lgBad").textContent=FR[c]||"Connexion impossible ("+(c||"erreur")+").";
      G("lgPass").value="";
    }
    finally{if(!(((lkRead().until)||0)>Date.now()))b.disabled=false}
  });
  G("lgForgot").addEventListener("click",async()=>{
    const m=G("lgMail").value.trim();
    if(!m){G("lgBad").textContent="Entrez d'abord votre e-mail ci-dessus.";return}
    const last=+(localStorage.getItem("als-reset-at")||0);
    if(Date.now()-last<60000){G("lgBad").textContent="Un e-mail vient d'être demandé. Patientez une minute.";return}
    try{localStorage.setItem("als-reset-at",String(Date.now()));await Au.sendPasswordResetEmail(auth,m);G("lgBad").textContent="Si ce compte existe, un e-mail de réinitialisation vient d'être envoyé."}
    catch(err){G("lgBad").textContent=FR[err&&err.code]||"Envoi impossible."}
  });

  async function start(u){
    started=true;clearTimeout(fbTimer);
    try{localStorage.setItem("als-signed","1")}catch(e){}
    window.claude={use:async name=>{
      if(name==="db")return dbApi;
      if(name==="user")return userApi(u);
      if(name==="downloads")return{save};
      if(name==="push")return pushApi(u);
      return null;
    }};
    /* enregistre le prénom affiché pour les autres utilisateurs (une seule fois) */
    /* en arrière-plan : ne retarde jamais l'ouverture (réseau faible) */
    (async()=>{try{
      const r=F.doc(fs,"team/"+u.uid),s=await F.getDoc(r);
      if(!s.exists()){const n=u.displayName||(u.email||"").split("@")[0];F.setDoc(r,{name:n.charAt(0).toUpperCase()+n.slice(1),email:u.email||""})}
      else if(s.data().name)names.set(u.uid,s.data().name);
    }catch(e){}})();
    const who=G("stWho"),box=G("stOutBox");
    if(who)who.textContent="Connecté : "+(u.email||"")+" · version "+ALS_BUILD;
    if(box)box.hidden=false;
    window.__alsResolve&&window.__alsResolve(window.claude);
    if("serviceWorker" in navigator&&!window.__ALS_SDK){navigator.serviceWorker.register("app-sw.js").catch(()=>{})}
  }
  let outArmed=false;
  G("stOut")&&G("stOut").addEventListener("click",async()=>{
    const b=G("stOut");
    if(!outArmed){outArmed=true;b.textContent="Confirmer la déconnexion";b.classList.add("sure");setTimeout(()=>{outArmed=false;b.textContent="Se déconnecter";b.classList.remove("sure")},4000);return}
    try{await Au.signOut(auth)}catch(e){}
    try{indexedDB.deleteDatabase("als-cache")}catch(e){}
    try{const m=localStorage.getItem("als-last-mail");localStorage.clear();if(m)localStorage.setItem("als-last-mail",m)}catch(e){}
    location.reload();
  });
  Au.onAuthStateChanged(auth,u=>{
    if(u){hideAll();if(fellBack){try{window.toast&&window.toast("Réseau faible : appli ouverte hors ligne, synchronisation à la prochaine ouverture")}catch(e){}return}if(!started)start(u)}
    else{clearTimeout(fbTimer);try{localStorage.removeItem("als-signed")}catch(e){}if(started||fellBack){location.reload();return}showForm()}
  });
})();

/* ===== Service worker : enregistrement et mises à jour (bloc autonome) =====
   L'appli s'ouvre depuis la copie locale (instantané, même sans réseau) ; la nouvelle version est téléchargée
   en arrière-plan et s'affiche à l'ouverture suivante. On enregistre le service worker dès le chargement
   (même avant connexion) et on demande une vérification à chaque ouverture et retour au premier plan
   (sur iPhone, l'appli est souvent reprise sans être rechargée). */
(()=>{
  if(!("serviceWorker" in navigator))return;
  const sw=navigator.serviceWorker;
  sw.addEventListener("message",e=>{
    if(!e.data||e.data.type!=="als-update")return;
    try{if(typeof window.toast==="function")window.toast("Nouvelle version prête — elle s'affichera à la prochaine ouverture")}catch(x){}
  });
  if(window.__ALS_SDK&&!window.__ALS_SDK.sw)return; /* tests avec le faux Firebase : pas de service worker, sauf demande */
  /* première installation : cette page a chargé Firebase sans le service worker ; on le redemande une fois par lui
     pour qu'il soit en copie locale (sinon le prochain démarrage hors ligne échoue). Normalement servi par le cache HTTP. */
  if(!sw.controller)sw.addEventListener("controllerchange",()=>{["firebase-app.js","firebase-auth.js","firebase-firestore.js"].forEach(f=>fetch(SDK_BASE+f).catch(()=>{}))},{once:true});
  let last=0;
  const check=()=>{const t=Date.now();if(t-last<60000)return;last=t;sw.register("app-sw.js").then(r=>r.update()).catch(()=>{})};
  if(document.readyState==="complete")setTimeout(check,1000);else window.addEventListener("load",()=>setTimeout(check,1000),{once:true});
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")check()});
})();
