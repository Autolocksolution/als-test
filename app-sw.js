/* AutoLockSolution : service worker. Appli utilisable hors ligne + notifications. */
const V="als-20261015-2231";
const APP="app.html";
const SHELL=[APP,"app.webmanifest","als-192.png","als-512.png","als-180.png"];
self.addEventListener("install",e=>{
  e.waitUntil(caches.open(V).then(c=>Promise.all(SHELL.map(u=>c.add(u).catch(()=>{})))).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith("als-")&&k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
const lib=u=>(u.hostname==="www.gstatic.com"&&u.pathname.startsWith("/firebasejs/"))||u.hostname==="fonts.googleapis.com"||u.hostname==="fonts.gstatic.com";
self.addEventListener("fetch",e=>{
  const r=e.request;if(r.method!=="GET")return;
  const u=new URL(r.url);
  if(lib(u)){
    e.respondWith(caches.open(V).then(async c=>{
      const hit=await c.match(r);
      const net=fetch(r).then(x=>{if(x&&(x.ok||x.type==="opaque"))c.put(r,x.clone());return x}).catch(()=>null);
      return hit||(await net)||Response.error();
    }));
    return;
  }
  if(u.origin===location.origin){
    /* page et fichiers de l'appli : réseau d'abord (nouveautés immédiates), copie locale si le réseau est lent ou absent */
    e.respondWith(caches.open(V).then(async c=>{
      const net=fetch(r,{cache:"no-cache"}).then(x=>{if(x&&x.ok)c.put(r,x.clone());return x});
      const slow=new Promise((res,rej)=>setTimeout(()=>rej(new Error("lent")),r.mode==="navigate"?4000:8000));
      try{return await Promise.race([net,slow])}
      catch(err){
        const hit=await c.match(r,{ignoreSearch:true})||(r.mode==="navigate"?await c.match(APP):null);
        if(hit)return hit;
        return net.catch(()=>Response.error());
      }
    }));
  }
});
self.addEventListener("push",e=>{let d={};try{d=e.data?e.data.json():{}}catch(x){}
  const n=d.data||d.notification||d;
  e.waitUntil(self.registration.showNotification(n.title||"AutoLockSolution",{body:n.body||"Nouvelle notification",icon:"als-192.png",badge:"als-192.png",tag:n.tag||undefined,data:{url:n.url||"./app.html"}}))});
self.addEventListener("notificationclick",e=>{e.notification.close();
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(l=>{for(const c of l){if("focus" in c)return c.focus()}return self.clients.openWindow(e.notification.data&&e.notification.data.url||"./app.html")}))});
