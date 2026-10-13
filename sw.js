self.addEventListener("install",e=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("push",e=>{let d={};try{d=e.data?e.data.json():{}}catch(x){}
  e.waitUntil(self.registration.showNotification(d.title||"AutoLockSolution",{body:d.body||"Notification reçue",icon:"icon-192.png"}))});
self.addEventListener("notificationclick",e=>{e.notification.close();e.waitUntil(self.clients.openWindow("./"))});
