/* Faux SDK Firebase pour les tests : même API que les modules officiels, données en mémoire + localStorage. */
(()=>{
  const LS=k=>{try{return JSON.parse(localStorage.getItem(k)||"null")}catch(e){return null}};
  const DB=LS("__fbdb")||{items:{
    a1:{section:"lame_m",group:"hu",name:"HU101",ref:"SILCA HU101",compat:"Ford",qty:3,note:"",series:""},
    a2:{section:"lame_m",group:"toy",name:"TOY48",ref:"SILCA TOY48",compat:"Toyota",qty:5,note:"",series:""},
    a3:{section:"lame_after",group:"hu",name:"Ebauche HU66",ref:"HU66",compat:"",qty:2,note:"Fixe",series:""}}};
  const LOG=window.__fblog=[];
  let _pt=null;const persist=()=>{clearTimeout(_pt);_pt=setTimeout(()=>{try{localStorage.setItem("__fbdb",JSON.stringify(DB))}catch(e){}},400)};
  const AUTH={user:LS("__fbuser"),cbs:[]};
  const perm=()=>{const e=new Error("Missing or insufficient permissions.");e.code="permission-denied";return e};
  const need=()=>{if(!AUTH.user)throw perm()};
  const subs=[];
  const mkDoc=(col,id)=>{const d=(DB[col]||{})[id];return{id,exists:()=>d!==undefined,data:()=>d,metadata:{fromCache:false}}};
  const mkCol=col=>{const docs=Object.keys(DB[col]||{}).map(id=>mkDoc(col,id));return{docs,size:docs.length,metadata:{fromCache:false}}};
  const split=p=>{const a=p.split("/");return{col:a[0],id:a[1]}};
  const ack=()=>new Promise(r=>setTimeout(r,90));
  let _ft=null;const fire=()=>{if(_ft)return;_ft=setTimeout(()=>{_ft=null;subs.forEach(s=>s.fn())},40)};
  const bad=v=>{const s=JSON.stringify(v,(k,x)=>x===undefined?"__UNDEF__":x);if(s.includes("__UNDEF__"))throw new Error("undefined interdit par Firestore")};
  /* versions par document : une transaction dont un document lu a changé avant la validation est rejouée (comme Firestore) */
  const VER={};const bump=p=>{VER[p]=(VER[p]||0)+1};
  const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
  /* window.__fbOffline : true = transaction refusée (hors ligne), "hang" = pas de réponse tant que le mode reste actif
     (puis échec, comme Firestore qui finit par abandonner). window.__fbSlowCommit = n ms : la prochaine validation
     n'aboutit qu'au bout de n ms (validation partie avant la coupure, qui arrive en retard). */
  const offErr=()=>Object.assign(new Error("Failed to get document because the client is offline."),{code:"unavailable"});
  async function runTx(fs,fn){
    need();
    if(window.__fbOffline==="hang"){while(window.__fbOffline==="hang")await new Promise(x=>setTimeout(x,100));throw offErr()}
    if(window.__fbOffline){await ack();throw offErr()}
    for(let a=0;a<5;a++){
      const reads={},writes=[];
      const t={
        get:async r=>{need();if(writes.length)throw new Error("Firestore transactions require all reads to be executed before all writes.");
          reads[r.path]=VER[r.path]||0;const d=clone((DB[r.col]||{})[r.id]);LOG.push("txget:"+r.path);
          await new Promise(x=>setTimeout(x,15));
          return{id:r.id,exists:()=>d!==undefined,data:()=>d,metadata:{fromCache:false}}},
        set:(r,data)=>{bad(data);writes.push(["set",r,clone(data)]);return t},
        update:(r,data)=>{bad(data);writes.push(["update",r,clone(data)]);return t}
      };
      const res=await fn(t);
      if(window.__fbSlowCommit){const ms=window.__fbSlowCommit;window.__fbSlowCommit=0;LOG.push("txslow");await new Promise(x=>setTimeout(x,ms))}
      if(Object.keys(reads).some(p=>(VER[p]||0)!==reads[p])){LOG.push("txretry");continue}
      for(const [op,r,data] of writes){
        DB[r.col]=DB[r.col]||{};
        if(op==="update"){if(!DB[r.col][r.id])throw Object.assign(new Error("not-found"),{code:"not-found"});Object.assign(DB[r.col][r.id],data)}
        else DB[r.col][r.id]=data;
        bump(r.path);LOG.push("tx"+op+":"+r.path);
      }
      persist();fire();await ack();return res;
    }
    throw Object.assign(new Error("Transaction failed all retries."),{code:"aborted"});
  }
  const A={initializeApp:c=>({c})};
  const Au={
    getAuth:()=>({}),
    onAuthStateChanged:(a,cb)=>{AUTH.cbs.push(cb);setTimeout(()=>cb(AUTH.user),30);return()=>{}},
    signInWithEmailAndPassword:async(a,e,p)=>{
      if(e==="a@x.fr"&&p==="good"){AUTH.user={uid:"U1",email:e,displayName:null};localStorage.setItem("__fbuser",JSON.stringify(AUTH.user));AUTH.cbs.forEach(cb=>cb(AUTH.user));return{user:AUTH.user}}
      const err=new Error("bad");err.code="auth/invalid-credential";throw err},
    signOut:async()=>{AUTH.user=null;localStorage.removeItem("__fbuser");AUTH.cbs.forEach(cb=>cb(null))},
    sendPasswordResetEmail:async(a,e)=>{LOG.push("reset:"+e)}
  };
  const F={
    initializeFirestore:()=>({}),getFirestore:()=>({}),persistentLocalCache:()=>({}),persistentMultipleTabManager:()=>({}),
    collection:(fs,p)=>({kind:"col",path:p}),
    doc:(a,p)=>{if(a&&a.kind==="col"){const id="n"+Math.random().toString(36).slice(2,8);return{kind:"doc",path:a.path+"/"+id,col:a.path,id}}const s=split(p);return{kind:"doc",path:p,col:s.col,id:s.id}},
    getDoc:async r=>{need();return mkDoc(r.col,r.id)},
    getDocs:async r=>{need();return mkCol(r.path)},
    setDoc:async(r,data,opts)=>{need();bad(data);DB[r.col]=DB[r.col]||{};DB[r.col][r.id]=opts&&opts.merge?Object.assign(DB[r.col][r.id]||{},data):JSON.parse(JSON.stringify(data));bump(r.path);persist();LOG.push("set:"+r.path);fire();await ack()},
    updateDoc:async(r,data)=>{need();bad(data);if(!(DB[r.col]||{})[r.id])throw Object.assign(new Error("not-found"),{code:"not-found"});Object.assign(DB[r.col][r.id],JSON.parse(JSON.stringify(data)));bump(r.path);persist();LOG.push("update:"+r.path);fire();await ack()},
    deleteDoc:async r=>{need();if(DB[r.col])delete DB[r.col][r.id];bump(r.path);persist();LOG.push("delete:"+r.path);fire();await ack()},
    runTransaction:runTx,
    onSnapshot:(r,...a)=>{
      const fn=typeof a[0]==="function"?a[0]:a[1],err=typeof a[0]==="function"?a[1]:a[2];
      const run=()=>{try{need()}catch(e){if(err)err(e);return}fn(r.kind==="col"?mkCol(r.path):mkDoc(r.col,r.id))};
      const s={fn:run};subs.push(s);setTimeout(run,20);return()=>{const i=subs.indexOf(s);if(i>=0)subs.splice(i,1)}}
  };
  const M={getMessaging:()=>({}),getToken:async(m,o)=>{if(!o||!o.vapidKey)throw Object.assign(new Error("novapid"),{code:"messaging/missing-vapid-key"});LOG.push("token:"+o.vapidKey);return"TOK_"+(localStorage.getItem("__tokn")||(localStorage.setItem("__tokn",Math.random().toString(36).slice(2,8)),localStorage.getItem("__tokn")))},deleteToken:async()=>{LOG.push("deltoken");return true}};
  window.__ALS_SDK={A,Au,F,M};
  window.__fbdb=DB;
})();
