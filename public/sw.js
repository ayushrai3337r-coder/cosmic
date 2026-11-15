const C = 'ara-v7';
const PRE = ['/', '/intro', '/login', '/welcome', '/dashboard', '/notes', '/exams', '/focus', '/account', '/viewer', '/css/glass.css', '/js/app.js', '/js/offline.js', '/js/timetable.js', '/js/music.js', '/icons/icon.svg', '/icons/apple-touch.png', '/bg.jpg', '/manifest.json'];
const FONT = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => Promise.allSettled(PRE.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
/* pages and scripts open instantly from the saved copy and are refreshed quietly in the background */
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  if (FONT.test(r.url)) {
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)); return res; })));
    return;
  }
  const u = new URL(r.url);
  if (u.origin !== location.origin || u.pathname.startsWith('/api/') || /^\/x-\d+/.test(u.pathname)) return;
  e.respondWith(caches.match(r, { ignoreSearch: true }).then(hit => {
    const net = fetch(r).then(res => {
      if (res.ok && res.type === 'basic') { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)); }
      return res;
    });
    if (hit) { net.catch(() => {}); return hit; }
    return net.catch(() => caches.match('/'));
  }));
});
