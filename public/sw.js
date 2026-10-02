const C = 'cosmic-v1';
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(C).then(c => c.addAll(['/', '/css/glass.css', '/js/app.js'])));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(r).then(res => {
    const copy = res.clone();
    caches.open(C).then(c => c.put(r, copy));
    return res;
  }).catch(() => caches.match(r).then(m => m || caches.match('/'))));
});
