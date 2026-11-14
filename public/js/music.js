/* Study music: songs the student picks from their own phone are kept inside the app (private storage) and played from there. */
const DB = 'ara-music', ST = 'songs';
const open = () => new Promise((ok, no) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(ST, { keyPath: 'id', autoIncrement: true });
  r.onsuccess = () => ok(r.result);
  r.onerror = () => no(r.error);
});
const tx = async (mode, fn) => { const db = await open(); return new Promise((ok, no) => { const t = db.transaction(ST, mode), q = fn(t.objectStore(ST)); t.oncomplete = () => { db.close(); ok(q && q.result); }; t.onerror = () => { db.close(); no(t.error); }; }); };

export const songs = {
  list: () => tx('readonly', s => s.getAll()).then(a => (a || []).map(({ blob, ...m }) => m).sort((x, y) => x.name.localeCompare(y.name))),
  add: async files => { let n = 0; for (const f of files) { if (!/^audio\//.test(f.type) && !/\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(f.name)) continue; await tx('readwrite', s => s.add({ name: f.name.replace(/\.[^.]+$/, ''), size: f.size, type: f.type || 'audio/mpeg', blob: f })); n++; } return n; },
  remove: id => tx('readwrite', s => s.delete(id)),
  blob: id => tx('readonly', s => s.get(id)).then(r => r && r.blob)
};

const a = new Audio();
a.preload = 'auto';
let list = [], idx = -1, url = null, shuffle = false, repeat = 0;
const subs = new Set();
const emit = () => subs.forEach(f => f());
export const player = {
  audio: a,
  on: f => { subs.add(f); return () => subs.delete(f); },
  get list() { return list; }, get index() { return idx; }, get track() { return list[idx] || null; },
  get shuffle() { return shuffle; }, get repeat() { return repeat; }, get playing() { return !a.paused; },
  async load() { list = await songs.list(); if (idx >= list.length) idx = -1; emit(); return list; },
  async play(i) {
    if (!list.length) return;
    idx = ((i % list.length) + list.length) % list.length;
    const b = await songs.blob(list[idx].id);
    if (!b) { emit(); return; }
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(b);
    a.src = url;
    try { await a.play(); } catch (e) {}
    try {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: list[idx].name, artist: 'AR Academy', artwork: [{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }] });
        navigator.mediaSession.setActionHandler('play', () => player.toggle());
        navigator.mediaSession.setActionHandler('pause', () => player.toggle());
        navigator.mediaSession.setActionHandler('nexttrack', () => player.next());
        navigator.mediaSession.setActionHandler('previoustrack', () => player.prev());
      }
    } catch (e) {}
    emit();
  },
  toggle() { if (idx < 0) return player.play(0); a.paused ? a.play().catch(() => {}) : a.pause(); },
  next() { if (!list.length) return; player.play(shuffle ? Math.floor(Math.random() * list.length) : idx + 1); },
  prev() { if (a.currentTime > 4) a.currentTime = 0; else player.play(idx - 1); },
  seek(p) { if (a.duration) a.currentTime = a.duration * p; },
  toggleShuffle() { shuffle = !shuffle; emit(); },
  cycleRepeat() { repeat = (repeat + 1) % 3; emit(); }
};
a.addEventListener('ended', () => { if (repeat === 2) { a.currentTime = 0; a.play(); } else if (repeat === 1 || idx < list.length - 1 || shuffle) player.next(); else emit(); });
['play', 'pause', 'timeupdate', 'loadedmetadata'].forEach(e => a.addEventListener(e, emit));
