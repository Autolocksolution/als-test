/* AutoLockSolution : service worker. Appli utilisable hors ligne + notifications.
   Ouverture instantanée : la page et les fichiers de l'appli sont servis depuis la copie locale,
   puis rafraîchis en arrière-plan ; une nouvelle version s'affiche donc à l'ouverture suivante. */
const V="als-20261030-2144";
/* cache durable, gardé d'une version à l'autre : Firebase et polices (adresses versionnées) + moteur OCR (4,7 Mo, revalidé).
   Son nom ne commence pas par « als- » : aucune activation ne le supprime, même celle d'une ancienne version.
   Changer ce nom (alslib-2…) le vide à la prochaine mise à jour. */
const LIB="alslib-1";
const APP="app.html";
const SHELL=[APP,"app.webmanifest","als-192.png","als-512.png","als-180.png","ticket.js"];
const OCR=new URL("ocr/",location.href).href;
self.addEventListener("install",e=>{
  /* app.html obligatoire : s'il ne se télécharge pas, l'installation échoue et l'ancienne version reste en place (avec sa copie).
     Le reste est facultatif. cache:"no-cache" : revalidé auprès du serveur (sinon cache HTTP de 10 min sur GitHub Pages). */
  const get=u=>fetch(new Request(u,{cache:"no-cache"})).then(x=>{if(!good(x))throw new Error(u+" "+x.status);return x});
  e.waitUntil(caches.open(V).then(c=>Promise.all(SHELL.map(u=>{const p=get(u).then(x=>c.put(u,x));return u===APP?p:p.catch(()=>{})}))).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",e=>{
  e.waitUntil((async()=>{
    const ks=await caches.keys(),old=ks.filter(k=>k.startsWith("als-")&&k!==V),keep=await caches.open(LIB);
    /* avant de supprimer les anciennes versions, on recopie Firebase et polices (sinon, au prochain démarrage hors ligne :
       « Impossible de charger la synchronisation », la page ouverte ne les redemandant pas), puis l'OCR */
    for(const want of [lib,u=>u.href.startsWith(OCR)])for(const k of old){
      try{const c=await caches.open(k);
        for(const q of await c.keys()){
          try{if(want(new URL(q.url))&&!await keep.match(q)){const x=await c.match(q);if(x)await keep.put(q,x)}}catch(err){}
        }}catch(err){}
    }
    await Promise.all(ks.filter(k=>old.includes(k)||(k.startsWith("alslib-")&&k!==LIB)).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
const lib=u=>(u.hostname==="www.gstatic.com"&&u.pathname.startsWith("/firebasejs/"))||u.hostname==="fonts.googleapis.com"||u.hostname==="fonts.gstatic.com";
const OPT={ignoreSearch:true,ignoreVary:true};
/* copie locale acceptable : réponse complète (200, jamais 206), du même site (jamais opaque), sans redirection */
const good=x=>!!x&&x.status===200&&x.type==="basic"&&!x.redirected;
/* même fichier côté serveur ? (ETag, sinon date + taille) : évite de réécrire les gros fichiers OCR à chaque usage */
const same=(a,b)=>{if(!a)return false;const ea=a.get("etag"),eb=b.get("etag");if(ea||eb)return ea===eb;const m=a.get("last-modified");return!!m&&m===b.get("last-modified")&&a.get("content-length")===b.get("content-length")};
const tell=()=>self.clients.matchAll({type:"window",includeUncontrolled:true}).then(l=>l.forEach(w=>w.postMessage({type:"als-update"})));
/* rafraîchit la copie locale en arrière-plan (une seule fois à la fois par fichier) ; old = en-têtes de la copie servie */
const busy=new Map();
function refresh(c,key,r,old){
  if(!busy.has(key))busy.set(key,fetch(r,{cache:"no-cache"}).then(async x=>{
    if(!good(x)||same(old,x.headers))return;
    let changed=false;
    if(key.endsWith("/"+APP)){const prev=await c.match(key,OPT);changed=!!prev&&await prev.text()!==await x.clone().text()}
    await c.put(key,x);
    if(changed)await tell();
  }).catch(()=>{}).finally(()=>busy.delete(key)));
  return busy.get(key);
}
self.addEventListener("fetch",e=>{
  const r=e.request;if(r.method!=="GET")return;
  const u=new URL(r.url);
  if(lib(u)){
    e.respondWith(caches.open(LIB).then(async c=>{
      const hit=await c.match(r);
      const net=fetch(r).then(x=>{if(x&&(x.ok||x.type==="opaque"))c.put(r,x.clone());return x}).catch(()=>null);
      return hit||(await net)||Response.error();
    }));
    return;
  }
  /* demandes partielles (Range) : laissées au navigateur, une copie complète n'y répond pas correctement */
  if(u.origin!==location.origin||r.headers.has("range"))return;
  /* page et fichiers de l'appli : copie locale tout de suite (même réseau faible ou absent), mise à jour en arrière-plan ;
     sans copie locale : réseau comme avant (page : 4 s au plus, puis copie de l'appli). Fichiers OCR : cache durable. */
  const key=u.origin+u.pathname,nav=r.mode==="navigate";
  let bg;e.waitUntil(new Promise(f=>bg=f));
  e.respondWith((async()=>{
    try{
      let c=null,hit=null;
      try{c=await caches.open(key.startsWith(OCR)?LIB:V);hit=await c.match(key,OPT)}catch(x){}
      if(!c)return await fetch(r);
      if(hit){bg(refresh(c,key,r,hit.headers));return hit}
      const net=fetch(r,{cache:"no-cache"});
      bg(net.then(x=>good(x)&&c.put(key,x.clone())).catch(()=>{}));
      if(!nav)return await net.catch(()=>Response.error());
      try{return await Promise.race([net,new Promise((_,j)=>setTimeout(()=>j(new Error("lent")),4000))])}
      catch(err){return await(await caches.open(V)).match(APP,OPT)||await net.catch(()=>Response.error())}
    }finally{bg()}
  })());
});
self.addEventListener("push",e=>{let d={};try{d=e.data?e.data.json():{}}catch(x){}
  const n=d.data||d.notification||d;
  e.waitUntil(self.registration.showNotification(n.title||"AutoLockSolution",{body:n.body||"Nouvelle notification",icon:"als-192.png",badge:"als-192.png",tag:n.tag||undefined,data:{url:n.url||"./app.html"}}))});
self.addEventListener("notificationclick",e=>{e.notification.close();
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(l=>{for(const c of l){if("focus" in c)return c.focus()}return self.clients.openWindow(e.notification.data&&e.notification.data.url||"./app.html")}))});
