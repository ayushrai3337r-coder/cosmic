export const VIDEO = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260315_073750_51473149-4350-4920-ae24-c8214286f323.mp4';
const KEY = 'cosmic_token';
export const token = () => localStorage.getItem(KEY);
export const setToken = t => localStorage.setItem(KEY, t);
export const clearToken = () => localStorage.removeItem(KEY);

export const BOARD = { msbte: 'MSBTE Diploma', ssc: 'SSC Maharashtra' };
export const BRANCH = { cs: 'Computer Science', mech: 'Mechanical Engineering', civil: 'Civil Engineering', elect: 'Electronics', electrical: 'Electrical Engineering', it: 'Information Technology', 'ssc-general': 'SSC General', all: 'All Branches' };
export const BRANCH_PICK = ['cs', 'mech', 'civil', 'elect', 'electrical', 'it'];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
export const tag = s => `<span class="tag ${s === 'approved' ? 'ok' : s === 'rejected' ? 'no' : ''}">${esc(s || 'pending')}</span>`;

const P = {
  logo: '<circle cx="12" cy="12" r="4.2" style="fill:currentColor;stroke:none"/><ellipse cx="12" cy="12" rx="10.5" ry="4" transform="rotate(-28 12 12)" style="fill:none;stroke:currentColor;stroke-width:1.5"/>',
  grid: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  sliders: '<path d="M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10M20 18h0"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'
};
export const icon = n => `<svg class="ic" viewBox="0 0 24 24">${P[n]}</svg>`;

export function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast liquid-glass-strong';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

export function mountBg() {
  if (document.querySelector('.bg-video')) return;
  document.body.insertAdjacentHTML('afterbegin', `<video class="bg-video" autoplay loop muted playsinline src="${VIDEO}"></video>`);
  const v = document.querySelector('.bg-video');
  v.muted = true;
  v.play().catch(() => {});
}

export async function api(path, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const t = token();
  if (t) headers.Authorization = 'Bearer ' + t;
  if (opts.admin) headers['x-admin-token'] = sessionStorage.getItem('at') || '';
  const r = await fetch(path, {
    method: opts.method || (body === undefined ? 'GET' : 'POST'),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && j.code === 'SESSION') {
    clearToken();
    sessionStorage.setItem('msg', j.error || '');
    location.href = '/login';
    throw new Error(j.error);
  }
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}

export async function cloudUpload(file, s) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('api_key', s.apiKey);
  fd.append('timestamp', s.timestamp);
  fd.append('signature', s.signature);
  fd.append('public_id', s.public_id);
  fd.append('type', s.type);
  const r = await fetch(`https://api.cloudinary.com/v1_1/${s.cloudName}/${s.resource}/upload`, { method: 'POST', body: fd });
  const j = await r.json();
  if (!j.public_id) throw new Error((j.error && j.error.message) || 'Upload failed');
  return j.public_id;
}

export function mountShell(active, eyebrow, title, sub) {
  mountBg();
  const links = [['dashboard', '/dashboard', 'grid', 'Dashboard'], ['notes', '/notes', 'book', 'Browse Notes'], ['orders', '/orders', 'clock', 'Orders'], ['profile', '/profile', 'user', 'Profile'], ['settings', '/settings', 'sliders', 'Settings']];
  const nav = links.map(([k, h, i, t]) => `<a class="nav-item ${k === active ? 'active' : ''}" href="${h}">${icon(i)}${t}</a>`).join('');
  const dock = links.map(([k, h, i, t]) => `<a class="${k === active ? 'active' : ''}" href="${h}" aria-label="${t}">${icon(i)}</a>`).join('');
  document.body.insertAdjacentHTML('beforeend', `
    <div class="app">
      <aside class="side liquid-glass-strong">
        <a href="/" class="brand">${icon('logo')}cosmic</a>
        ${nav}
        <div class="side-foot liquid-glass"><div class="avatar" id="sf-av">S</div><div><strong id="sf-name">Student</strong><span id="sf-phone"></span></div></div>
      </aside>
      <main class="content">
        <div class="page-head reveal"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>
        <div id="view"></div>
      </main>
    </div>
    <nav class="dock liquid-glass-strong">${dock}</nav>`);
  return document.getElementById('view');
}

export async function requireUser() {
  if (!token()) { location.href = '/login'; return new Promise(() => {}); }
  const u = await api('/api/me');
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('sf-av', (u.firstName || 'S')[0].toUpperCase());
  set('sf-name', (u.firstName + ' ' + u.lastName).trim());
  set('sf-phone', u.phone);
  return u;
}

document.addEventListener('pointermove', e => {
  const el = e.target.closest && e.target.closest('.liquid-glass, .liquid-glass-strong');
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
  el.style.setProperty('--my', (e.clientY - r.top) + 'px');
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
