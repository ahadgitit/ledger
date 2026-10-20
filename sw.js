/* Network first, cache as a fallback so the workspace shell opens offline.
   Only same-origin GETs are touched; Google APIs pass straight through. */
var CACHE='ledger-shell-v1';
self.addEventListener('install',function(){self.skipWaiting();});
self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));
  }).then(function(){return self.clients.claim();}));
});
self.addEventListener('fetch',function(e){
  var u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==self.location.origin) return;
  e.respondWith(fetch(e.request).then(function(r){
    if(r.ok){var c=r.clone();caches.open(CACHE).then(function(ca){ca.put(e.request,c);});}
    return r;
  }).catch(function(){
    return caches.match(e.request).then(function(r){return r||caches.match('./',{ignoreSearch:true});});
  }));
});
