import { api } from '/js/app.js';

const DB = 'cosmic-offline', LICENSE_MS = 14 * 24 * 3600 * 1000;

const open = () => new Promise((ok, no) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('pages'); r.result.createObjectStore('meta'); };
  r.onsuccess = () => ok(r.result);
  r.onerror = () => no(r.error);
});

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((ok, no) => {
    const t = db.transaction(store, mode);
    let out;
    const req = fn(t.objectStore(store));
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => { db.close(); ok(out); };
    t.onerror = t.onabort = () => { db.close(); no(t.error || new Error('Storage error')); };
  });
}

/* dense watermark with the reader's email */
export function watermark(ctx, w, h, text, dpr) {
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#000';
  ctx.font = (13 * dpr) + 'px Poppins, sans-serif';
  ctx.textAlign = 'center';
  ctx.rotate(-0.45);
  const sx = 250 * dpr, sy = 95 * dpr;
  for (let y = -h, r = 0; y < h * 2; y += sy, r++) {
    for (let x = -w; x < w * 2; x += sx) ctx.fillText(text, x + (r % 2 ? sx / 2 : 0), y);
  }
  ctx.restore();
}

export const offlineValid = m => !!m && Date.now() - m.checkedAt < LICENSE_MS;

export async function offlineMeta(userId, noteId) {
  try {
    const m = await tx('meta', 'readonly', s => s.get(String(noteId)));
    return m && m.userId === userId ? m : null;
  } catch (e) { return null; }
}

export async function offlineSaved(userId) {
  try { return ((await tx('meta', 'readonly', s => s.getAll())) || []).filter(m => m.userId === userId); }
  catch (e) { return []; }
}

export async function offlinePage(noteId, i) {
  try { return await tx('pages', 'readonly', s => s.get(noteId + ':' + i)); } catch (e) { return null; }
}

export async function offlineRemove(noteId) {
  try {
    await tx('pages', 'readwrite', s => s.delete(IDBKeyRange.bound(noteId + ':', noteId + ':\uffff')));
    await tx('meta', 'readwrite', s => s.delete(String(noteId)));
  } catch (e) {}
}

/* page is drawn with the watermark baked in, then kept only as a small image in the app's private storage */
async function bake(url, mark) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('A page could not be saved. Check your internet and try again.');
  const bmp = await createImageBitmap(await r.blob());
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  if (bmp.close) bmp.close();
  watermark(ctx, c.width, c.height, mark, c.width / 360);
  return new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('Could not save this page.')), 'image/jpeg', 0.82));
}

export async function offlineSave(me, noteId, onProgress) {
  const f = await api('/api/notes/' + noteId + '/file?w=900');
  const mark = (me.email || 'cosmic') + '  #' + me.id;
  await offlineRemove(noteId);
  try {
    for (let i = 0; i < f.pages.length; i++) {
      const blob = await bake(f.pages[i], mark);
      await tx('pages', 'readwrite', s => s.put(blob, noteId + ':' + i));
      if (onProgress) onProgress(i + 1, f.pages.length);
    }
    await tx('meta', 'readwrite', s => s.put({ noteId, userId: me.id, title: f.title, count: f.pages.length, savedAt: Date.now(), checkedAt: Date.now() }, String(noteId)));
  } catch (e) {
    await offlineRemove(noteId);
    throw new Error(e && e.name === 'QuotaExceededError' ? 'Not enough free space on this phone.' : (e.message || 'Could not save'));
  }
}

/* when online: delete saved notes that were removed or are no longer unlocked, and renew the rest */
export async function offlineSync(userId, notes) {
  if (!notes || notes.cached) return;
  try {
    const ok = new Set(notes.filter(n => n.status === 'approved').map(n => n.id));
    for (const m of (await tx('meta', 'readonly', s => s.getAll())) || []) {
      if (m.userId !== userId || !ok.has(m.noteId)) await offlineRemove(m.noteId);
      else await tx('meta', 'readwrite', s => s.put({ ...m, checkedAt: Date.now() }, String(m.noteId)));
    }
  } catch (e) {}
}
