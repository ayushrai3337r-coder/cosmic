const KEY = 'cosmic_token', ME = 'cosmic_me', DEV = 'cosmic_device';
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
export const token = () => ls.get(KEY);
const CACHED = ['/api/me', '/api/notes'];
const wipe = () => { ls.del(ME); CACHED.forEach(p => ls.del('cosmic_c_' + p)); };
export const setToken = t => { ls.set(KEY, t); wipe(); };
export const clearToken = () => { ls.del(KEY); wipe(); try { indexedDB.deleteDatabase('cosmic-offline'); } catch (e) {} };
export const lsGet = ls.get, lsSet = ls.set, lsDel = ls.del;
export const isApp = () => /CosmicApp/.test(navigator.userAgent);

/* one id per device, sent with every request so one email works on one device only */
export function deviceId() {
  let d = ls.get(DEV);
  if (!d || !/^[\w-]{16,64}$/.test(d)) {
    d = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    ls.set(DEV, d);
  }
  return d;
}

export const BOARD = { msbte: 'MSBTE Diploma', ssc: 'SSC Maharashtra' };
export const BRANCH = { cs: 'Computer Engineering (CO)', it: 'Information Technology (IF)', ai: 'AI & Machine Learning (AIML)', cy: 'Cyber Security (CY)', mech: 'Mechanical Engineering (ME)', civil: 'Civil Engineering (CE)', electrical: 'Electrical Engineering (EE)', elect: 'Electronics & Telecom (EJ)', en: 'Electronics Engineering (EN)', ch: 'Chemical Engineering (CH)', ae: 'Automobile Engineering (AE)', mt: 'Mechatronics (MT)', ie: 'Instrumentation (IE)', 'ssc-general': 'SSC General', all: 'All Branches' };
export const BRANCH_PICK = ['cs', 'it', 'ai', 'cy', 'mech', 'civil', 'electrical', 'elect', 'en', 'ch', 'ae', 'mt', 'ie'];
export const MEDIUM = { en: 'English Medium', mr: 'Marathi Medium', hi: 'Hindi Medium' };
export const MEDIUM_NATIVE = { en: 'English', mr: 'मराठी', hi: 'हिन्दी' };
export const brand = '<img class="mk" src="/icons/icon.svg" alt="" width="34" height="34"><span>AR <em>Academy</em></span>';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
export const tag = s => `<span class="tag ${s === 'approved' ? 'ok' : s === 'rejected' ? 'no' : ''}">${esc(s || 'pending')}</span>`;

const P = {
  logo: '<circle cx="12" cy="12" r="4.2" style="fill:currentColor;stroke:none"/><ellipse cx="12" cy="12" rx="10.5" ry="4" transform="rotate(-28 12 12)" style="fill:none;stroke:currentColor;stroke-width:1.5"/>',
  grid: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9 2h6"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z"/>',
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

/* the background is now a still picture set in CSS; kept so older pages that import it keep working */
export function mountBg() {}

export async function api(path, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json', 'x-device': deviceId() };
  const t = token();
  if (t) headers.Authorization = 'Bearer ' + t;
  if (opts.admin) headers['x-admin-token'] = sessionStorage.getItem('at') || '';
  const cacheKey = body === undefined && !opts.method && CACHED.includes(path) ? 'cosmic_c_' + path : null;
  let r;
  try {
    r = await fetch(path, {
      method: opts.method || (body === undefined ? 'GET' : 'POST'),
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout ? AbortSignal.timeout(cacheKey ? 8000 : 30000) : undefined
    });
  } catch (e) {
    if (cacheKey) { try { const c = JSON.parse(ls.get(cacheKey)); if (c) { c.cached = true; return c; } } catch (e2) {} }
    const err = new Error('No internet connection. Please try again.');
    err.offline = true;
    throw err;
  }
  const j = await r.json().catch(() => ({}));
  if (cacheKey && r.ok) ls.set(cacheKey, JSON.stringify(j));
  if (r.status === 401 && j.code === 'SESSION') {
    clearToken();
    try { sessionStorage.setItem('msg', j.error || ''); } catch (e) {}
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
  if (s.allowed_formats) fd.append('allowed_formats', s.allowed_formats);
  let r;
  try { r = await fetch(`https://api.cloudinary.com/v1_1/${s.cloudName}/${s.resource}/upload`, { method: 'POST', body: fd }); }
  catch (e) { throw new Error('Upload failed. Check your internet and try again.'); }
  const j = await r.json().catch(() => ({}));
  if (!j.public_id) throw new Error((j.error && j.error.message) || 'Upload failed');
  return j.public_id;
}

/* shrink big phone screenshots before upload to save data and time */
export async function shrink(file, max = 1280) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    return blob && blob.size < file.size ? new File([blob], 'shot.jpg', { type: 'image/jpeg' }) : file;
  } catch (e) { return file; }
}

export function mountShell(active, eyebrow, title, sub) {
  const links = [['dashboard', '/dashboard', 'grid', 'Home'], ['notes', '/notes', 'book', 'Notes'], ['exams', '/exams', 'cal', 'Exams'], ['focus', '/focus', 'timer', 'Focus'], ['account', '/account', 'user', 'Account']];
  const nav = links.map(([k, h, i, t]) => `<a class="nav-item ${k === active ? 'active' : ''}" href="${h}">${icon(i)}${t}</a>`).join('');
  const dock = links.map(([k, h, i, t]) => `<a class="${k === active ? 'active' : ''}" href="${h}" aria-label="${t}">${icon(i)}<small>${t}</small></a>`).join('');
  document.body.insertAdjacentHTML('beforeend', `
    <div class="app">
      <aside class="side liquid-glass-strong">
        <a href="/dashboard" class="brand">${brand}</a>
        ${nav}
        <div class="side-foot liquid-glass"><div class="avatar" id="sf-av">S</div><div><strong id="sf-name">Student</strong><span id="sf-phone"></span></div></div>
      </aside>
      <main class="content">
        <a href="/dashboard" class="brand mbar">${brand}</a>
        <div class="page-head reveal"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>
        <div id="view"></div>
      </main>
    </div>
    <nav class="dock liquid-glass-strong">${dock}</nav>
    ${active === 'chat' || active === 'viewer' ? '' : `<a class="chat-fab" href="/chat" aria-label="Message us">${icon('chat')}<i id="chat-dot" hidden></i></a>`}`);
  if (active !== 'chat' && active !== 'viewer') api('/api/chat/unread').then(r => { const d = document.getElementById('chat-dot'); if (d && r.unread) d.hidden = false; }).catch(() => {});
  const net = document.createElement('div');
  net.className = 'toast liquid-glass-strong';
  net.textContent = 'You are offline. Saved notes still open.';
  net.hidden = navigator.onLine;
  document.body.appendChild(net);
  addEventListener('online', () => { net.hidden = true; });
  addEventListener('offline', () => { net.hidden = false; });
  return document.getElementById('view');
}

function paint(u) {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('sf-av', (u.firstName || 'S')[0].toUpperCase());
  set('sf-name', (u.firstName + ' ' + u.lastName).trim());
  set('sf-phone', u.email || u.phone || '');
}

/* uses the saved profile instantly and refreshes it in the background (saves one wait per page) */
export async function requireUser(fresh) {
  if (!token()) { location.href = '/login'; return new Promise(() => {}); }
  let u = null;
  if (!fresh) { try { u = JSON.parse(ls.get(ME)); } catch (e) {} }
  const load = api('/api/me').then(m => { ls.set(ME, JSON.stringify(m)); return m; });
  if (u) load.catch(() => {}); else u = await load;
  paint(u);
  if (u.onboarded === false && !/^\/welcome/.test(location.pathname)) { location.replace('/welcome'); return new Promise(() => {}); }
  return u;
}

/* study log kept on this phone: minutes per day, streak, last note opened */
export const study = {
  all() { try { return JSON.parse(ls.get('ara_study')) || {}; } catch (e) { return {}; } },
  key(d = new Date()) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  add(min) { const a = study.all(), k = study.key(); a[k] = Math.round(((a[k] || 0) + min) * 10) / 10; ls.set('ara_study', JSON.stringify(a)); },
  today() { return Math.round(study.all()[study.key()] || 0); },
  week() { const a = study.all(), out = []; for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push({ day: d.toLocaleDateString('en-IN', { weekday: 'short' }).slice(0, 2), min: Math.round(a[study.key(d)] || 0) }); } return out; },
  streak() { const a = study.all(); let n = 0; const d = new Date(); if (!a[study.key(d)]) d.setDate(d.getDate() - 1); while (a[study.key(d)] >= 1) { n++; d.setDate(d.getDate() - 1); } return n; }
};
export const lastNote = { get() { try { return JSON.parse(ls.get('ara_last')); } catch (e) { return null; } }, set(v) { ls.set('ara_last', JSON.stringify(v)); } };
export const pref = { get(k, d) { const v = ls.get('ara_p_' + k); return v === null ? d : JSON.parse(v); }, set(k, v) { ls.set('ara_p_' + k, JSON.stringify(v)); } };

if (matchMedia('(hover:hover)').matches) {
  document.addEventListener('pointermove', e => {
    const el = e.target.closest && e.target.closest('.liquid-glass, .liquid-glass-strong');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    el.style.setProperty('--my', (e.clientY - r.top) + 'px');
  });
}

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

export async function uploadShot(orderId, file) {
  const sign = await api('/api/orders/' + orderId + '/shot-sign', {});
  const pid = await cloudUpload(await shrink(file), sign);
  return api('/api/orders/' + orderId + '/shot', { publicId: pid });
}

/* ---------- payment window: UPI app button + QR code ---------- */
let cfg;
const getCfg = () => cfg || (cfg = fetch('/api/config').then(r => r.json()).catch(() => ({})));

const QR_URLS = ['https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js', 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'];
function loadQr() {
  if (window.qrcode) return Promise.resolve(true);
  const attempt = i => i >= QR_URLS.length ? Promise.resolve(false) : new Promise(ok => {
    const s = document.createElement('script');
    s.src = QR_URLS[i];
    s.onload = () => ok(!!window.qrcode);
    s.onerror = () => { s.remove(); ok(false); };
    document.head.appendChild(s);
  }).then(r => r || attempt(i + 1));
  return attempt(0);
}

export function payModal(onDone) {
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal" id="pm"><div class="box liquid-glass-strong" style="max-height:92vh;overflow:auto">
      <div class="eyebrow">Complete payment</div>
      <h3 id="pm-t"></h3>
      <div class="price" id="pm-a"></div>
      <div class="chips" style="margin:16px 0 14px" id="pm-tabs">
        <button class="chip liquid-glass hoverable on" data-m="app" id="pm-tab-app">Pay with UPI app</button>
        <button class="chip liquid-glass hoverable" data-m="qr">Scan QR</button>
      </div>
      <div id="pm-app">
        <div id="pm-apps" class="upi-apps"></div>
        <a class="btn white hoverable block" id="pm-u">Pay with any UPI app</a>
        <p class="muted" id="pm-ah" style="margin-top:10px"></p>
      </div>
      <div id="pm-qr" hidden>
        <div id="pm-code" style="width:200px;height:200px;margin:0 auto;border-radius:1rem;background:#fff;padding:10px;display:flex;align-items:center;justify-content:center;color:#000;font-size:.75rem;text-align:center"></div>
        <p class="muted" style="margin-top:10px;text-align:center" id="pm-hint">Scan with any UPI app on another phone.</p>
      </div>
      <p class="muted" style="margin-top:14px">After paying, upload the payment screenshot. Your notes unlock once we confirm it.</p>
      <label class="field" style="margin-top:12px"><span>Payment screenshot</span><input class="input" type="file" accept="image/*" id="pm-f"></label>
      <div class="acts"><button class="btn white hoverable" id="pm-s">Submit screenshot</button><button class="btn liquid-glass hoverable" id="pm-x">Pay later</button></div>
    </div></div>`);
  const $ = id => document.getElementById(id);
  let cur = null, conf = {};
  const upiLink = o => 'upi://pay?pa=' + encodeURIComponent(conf.upiId) + '&pn=' + encodeURIComponent(conf.payeeName || 'AR Academy') + '&am=' + Number(o.amount).toFixed(2) + '&cu=INR&tn=' + encodeURIComponent('AR Academy ' + o.id);

  function tab(m) {
    $('pm-app').hidden = m !== 'app';
    $('pm-qr').hidden = m !== 'qr';
    $('pm-tabs').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.m === m));
    if (m === 'qr') drawQr();
  }
  async function drawQr() {
    const box = $('pm-code'), o = cur;
    box.textContent = '';
    if (conf.payQr && /^upi:/i.test(conf.payQr)) {
      box.textContent = 'Loading...';
      if (await loadQr() && cur === o) {
        const q = window.qrcode(0, 'M');
        q.addData(conf.payQr);
        q.make();
        const im = new Image();
        im.alt = 'UPI QR code';
        im.style.cssText = 'width:100%;height:100%;image-rendering:pixelated';
        im.src = q.createDataURL(6, 0);
        box.textContent = '';
        box.appendChild(im);
        $('pm-hint').textContent = 'Scan with any UPI app and enter the amount shown above.';
      } else box.textContent = 'Could not load the QR. Use the UPI app option.';
      return;
    }
    if (conf.payQr) {
      const img = new Image();
      img.alt = 'UPI QR code';
      img.style.cssText = 'width:100%;height:100%;object-fit:contain';
      img.src = conf.payQr;
      box.appendChild(img);
      $('pm-hint').textContent = 'Scan with any UPI app and enter the amount shown above.';
      return;
    }
    if (!conf.upiId) { box.textContent = 'Payment is not set up yet.'; return; }
    box.textContent = 'Loading...';
    if (await loadQr() && cur === o) {
      const q = window.qrcode(0, 'M');
      q.addData(upiLink(o));
      q.make();
      const img = new Image();
      img.alt = 'UPI QR code';
      img.style.cssText = 'width:100%;height:100%;image-rendering:pixelated';
      img.src = q.createDataURL(6, 0);
      box.textContent = '';
      box.appendChild(img);
      $('pm-hint').textContent = 'Scan with any UPI app on another phone. The amount is filled in for you.';
    } else if (cur === o) box.textContent = 'QR could not load. Use the UPI app button.';
  }

  $('pm-tabs').addEventListener('click', e => { const c = e.target.closest('[data-m]'); if (c) tab(c.dataset.m); });
  $('pm-x').onclick = () => $('pm').classList.remove('open');
  $('pm').addEventListener('click', e => { if (e.target.id === 'pm') $('pm').classList.remove('open'); });
  $('pm-s').onclick = async () => {
    const file = $('pm-f').files[0];
    if (!file) return toast('Choose your payment screenshot first');
    if (file.size > 15 * 1024 * 1024) return toast('Image is too large');
    const b = $('pm-s');
    b.disabled = true;
    b.textContent = 'Uploading...';
    try {
      b.textContent = 'Checking payment...';
      const r = await uploadShot(cur.id, file);
      toast(r.result === 'approved' ? 'Payment confirmed. Your notes are unlocked!' : r.result === 'rejected' ? 'We could not verify this payment. Check the amount and upload the right screenshot, or try again.' : 'Screenshot received. We will confirm your payment soon.');
      $('pm').classList.remove('open');
      if (onDone) await onDone();
    } catch (e) { toast(e.message); }
    b.disabled = false;
    b.textContent = 'Submit screenshot';
  };
  return {
    async open(o) {
      cur = o;
      $('pm-t').textContent = o.title;
      $('pm-a').textContent = 'Rs ' + o.amount;
      $('pm-f').value = '';
      $('pm').classList.add('open');
      conf = await getCfg();
      if (cur !== o) return;
      const touch = matchMedia('(pointer:coarse)').matches;
      const hasApp = !!conf.upiId;
      $('pm-tab-app').hidden = !hasApp;
      if (hasApp) $('pm-u').href = upiLink(o);
      $('pm-ah').textContent = 'Your phone will show the UPI apps you have installed. Pick one and pay.';
      $('pm-apps').innerHTML = '';
      $('pm-u').hidden = false;
      let found = 0;
      const U = hasApp && isApp() && window.Capacitor && window.Capacitor.registerPlugin ? window.Capacitor.registerPlugin('Upi') : null;
      if (U) {
        try {
          const { apps } = await U.apps();
          found = apps.length;
          const box = $('pm-apps');
          apps.forEach(a => {
            const b = document.createElement('button');
            b.className = 'upi-app liquid-glass hoverable';
            b.innerHTML = '<i></i><span></span>';
            b.querySelector('i').textContent = (a.name || '?')[0].toUpperCase();
            b.querySelector('span').textContent = a.name;
            b.onclick = () => U.pay({ url: upiLink(cur), package: a.package }).catch(() => toast('Could not open ' + a.name));
            box.appendChild(b);
          });
          $('pm-u').hidden = found > 0;
          $('pm-ah').textContent = found ? 'We found ' + found + ' UPI app' + (found > 1 ? 's' : '') + ' on your phone. Tap one to pay Rs ' + o.amount + '.' : 'No UPI app was found on this phone. Use Scan QR from another phone.';
        } catch (e) { $('pm-u').hidden = false; }
      }
      tab(hasApp && touch && (!U || found) ? 'app' : 'qr');
    }
  };
}

/* small banner: the next big paper (English Communication Skills, Sem 1). Tapping it opens the PDF straight away. */
export async function promoBanner(notes) {
  const n = notes.find(x => x.board === 'msbte' && /communication skills|english communication/i.test(x.title) && (!x.semester || x.semester === '1' || x.semester === 'all'));
  if (!n) return '';
  let when = '';
  try {
    const { TT, startOf } = await import('/js/timetable.js');
    const p = TT.filter(r => ['311303', '22101'].includes(r.c)).sort((a, b) => startOf(a) - startOf(b))[0];
    if (p) {
      const d = Math.ceil((new Date(startOf(p).toDateString()) - new Date(new Date().toDateString())) / 864e5);
      if (d < 0) return '';
      when = d === 0 ? 'Exam today' : d === 1 ? 'Exam tomorrow' : 'Exam in ' + d + ' days';
    }
  } catch (e) {}
  const open = n.status === 'approved';
  return `<a class="promo reveal" style="--d:.05s" href="${open ? '/viewer?id=' + n.id : '/notes?buy=' + n.id}">
    <div class="pm-l"><span class="pm-tag">Sem 1 &middot; ${esc(when || 'Exam soon')}</span><b>English Communication Skills</b><span class="pm-s">${open ? 'Your notes are ready. Tap to read now.' : 'Important questions and quick revision' + (n.price ? ' for Rs ' + n.price : '')}</span></div>
    <span class="pm-go">${open ? 'Open PDF' : 'Get it'}<svg class="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span></a>`;
}
