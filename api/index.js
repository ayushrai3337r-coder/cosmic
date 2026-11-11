import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { neon } from '@neondatabase/serverless';
import { v2 as cloudinary } from 'cloudinary';

const E = process.env;
['DATABASE_URL', 'TOKEN_SECRET', 'FIREBASE_PROJECT_ID', 'CLOUDINARY_API_SECRET'].forEach(k => { if (!E[k]) console.error('Missing environment variable: ' + k); });
cloudinary.config({ cloud_name: E.CLOUDINARY_CLOUD_NAME, api_key: E.CLOUDINARY_API_KEY, api_secret: E.CLOUDINARY_API_SECRET, secure: true });
const sql = neon(E.DATABASE_URL);
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const SECRET = E.TOKEN_SECRET || '';
const SESSION_MS = 180 * 24 * 3600 * 1000;
const DEV_RE = /^[\w-]{16,64}$/;
const DEVICE_MSG = 'This account is already used on another device. Contact support to switch devices.';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(err => { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); });
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const bearer = req => (req.headers.authorization || '').replace(/^Bearer /, '');
const clean = (v, n) => String(v || '').trim().slice(0, n);
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const pubUser = u => ({ id: u.id, firstName: u.first_name, lastName: u.last_name, email: u.email, phone: u.phone, board: u.board, branch: u.branch, createdAt: u.created_at });
const signedUrl = (pid, resource) => cloudinary.url(pid, { resource_type: resource, type: 'authenticated', sign_url: true, secure: true });
const pageUrl = (pid, n, w) => cloudinary.url(pid, { resource_type: 'image', type: 'authenticated', sign_url: true, secure: true, page: n, format: 'jpg', width: w, crop: 'limit', quality: 'auto' });

/* best-effort rate limit (per server instance) */
const hits = new Map();
const limit = (name, max, ms) => (req, res, next) => {
  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const k = name + '|' + ip, now = Date.now();
  let h = hits.get(k);
  if (!h || h.t < now) { h = { n: 0, t: now + ms }; hits.set(k, h); }
  if (hits.size > 5000) for (const [kk, v] of hits) if (v.t < now) hits.delete(kk);
  if (++h.n > max) return res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.' });
  next();
};

function signUpload(publicId, formats) {
  const params = { allowed_formats: formats, public_id: publicId, timestamp: Math.round(Date.now() / 1000), type: 'authenticated' };
  const signature = cloudinary.utils.api_sign_request(params, E.CLOUDINARY_API_SECRET);
  return { ...params, signature, apiKey: E.CLOUDINARY_API_KEY, cloudName: E.CLOUDINARY_CLOUD_NAME, resource: 'image' };
}

async function googleUser(idToken) {
  const { payload } = await jwtVerify(idToken, JWKS, { issuer: 'https://securetoken.google.com/' + E.FIREBASE_PROJECT_ID, audience: E.FIREBASE_PROJECT_ID });
  if (!payload.sub || !payload.email || payload.email_verified !== true) throw new Error('bad token');
  if (payload.firebase && payload.firebase.sign_in_provider !== 'google.com') throw new Error('bad provider');
  return { uid: payload.sub, email: String(payload.email).toLowerCase(), name: String(payload.name || '') };
}

/* finds the user for a Google account, or creates one when a profile is given */
async function findOrCreate(g, p) {
  let u = (await sql`select * from users where firebase_uid = ${g.uid}`)[0];
  if (!u) u = (await sql`update users set firebase_uid = ${g.uid} where email = ${g.email} returning *`)[0];
  if (u) return { u };
  if (!p) return { needs: { needsSignup: true, name: g.name, email: g.email } };
  const first = clean(p.firstName, 40);
  if (!first) return { err: [400, 'Enter your first name'] };
  const board = p.board === 'ssc' ? 'ssc' : 'msbte';
  const branch = board === 'ssc' ? 'ssc-general' : clean(p.branch, 30);
  u = (await sql`insert into users (firebase_uid, email, first_name, last_name, board, branch)
    values (${g.uid}, ${g.email}, ${first}, ${clean(p.lastName, 40)}, ${board}, ${branch})
    on conflict (firebase_uid) do update set email = excluded.email returning *`)[0];
  return { u };
}

/* one email = one device. The first device that signs in is the only one allowed until an admin resets it */
async function startSession(u, dev, res) {
  const token = crypto.randomBytes(32).toString('hex');
  const r = await sql`update users set session_hash = ${sha(token)}, session_at = now(), device_id = ${dev}
    where id = ${u.id} and (device_id is null or device_id = ${dev}) returning id`;
  if (!r[0]) return res.status(403).json({ error: DEVICE_MSG, code: 'DEVICE' });
  res.json({ token, user: pubUser(u) });
}

const auth = wrap(async (req, res, next) => {
  const t = bearer(req);
  if (!t) return res.status(401).json({ error: 'Please sign in', code: 'SESSION' });
  const u = (await sql`select id, email, phone, first_name, last_name, board, branch, created_at, session_at, device_id from users where session_hash = ${sha(t)}`)[0];
  if (!u) return res.status(401).json({ error: 'Your session ended. Please sign in again.', code: 'SESSION' });
  if (u.session_at && Date.now() - new Date(u.session_at).getTime() > SESSION_MS) return res.status(401).json({ error: 'Your session expired. Please sign in again.', code: 'SESSION' });
  if (u.device_id && String(req.headers['x-device'] || '') !== u.device_id) return res.status(401).json({ error: DEVICE_MSG, code: 'SESSION' });
  req.user = u;
  next();
});

const adminSig = exp => crypto.createHmac('sha256', 'admin|' + SECRET).update(exp).digest('hex');
const makeAdmin = () => { const exp = String(Date.now() + 8 * 3600 * 1000); return exp + '.' + adminSig(exp); };
const okAdmin = t => { if (SECRET.length < 16) return false; const [exp, sig] = String(t || '').split('.'); return !!exp && !!sig && Number(exp) > Date.now() && same(sig, adminSig(exp)); };
const adminOnly = (req, res, next) => okAdmin(req.headers['x-admin-token']) ? next() : res.status(401).json({ error: 'Admin sign in required' });

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/config', (req, res) => res.json({
  apiKey: E.FIREBASE_API_KEY, authDomain: E.FIREBASE_AUTH_DOMAIN, projectId: E.FIREBASE_PROJECT_ID, appId: E.FIREBASE_APP_ID,
  upiId: E.UPI_ID || '', payQr: E.PAY_QR || ''
}));

/* ---------- auth ---------- */
app.post('/api/auth/login', limit('login', 20, 60000), wrap(async (req, res) => {
  const dev = String(req.body.deviceId || '');
  if (!DEV_RE.test(dev)) return res.status(400).json({ error: 'Bad request' });
  let g;
  try { g = await googleUser(String(req.body.idToken || '')); }
  catch (e) { return res.status(401).json({ error: 'Could not verify your Google account. Try again.' }); }
  const r = await findOrCreate(g, req.body.profile);
  if (r.needs) return res.json(r.needs);
  if (r.err) return res.status(r.err[0]).json({ error: r.err[1] });
  await startSession(r.u, dev, res);
}));

/* the app signs in through the phone browser, then trades a short one-time code for a session */
app.post('/api/auth/app-code', limit('login', 20, 60000), wrap(async (req, res) => {
  const ch = String(req.body.challenge || '');
  if (!/^[a-f0-9]{64}$/.test(ch)) return res.status(400).json({ error: 'Bad request' });
  let g;
  try { g = await googleUser(String(req.body.idToken || '')); }
  catch (e) { return res.status(401).json({ error: 'Could not verify your Google account. Try again.' }); }
  const r = await findOrCreate(g, req.body.profile);
  if (r.needs) return res.json(r.needs);
  if (r.err) return res.status(r.err[0]).json({ error: r.err[1] });
  const code = crypto.randomBytes(24).toString('hex');
  await sql`delete from app_codes where expires_at < now()`;
  await sql`insert into app_codes (code_hash, user_id, challenge, expires_at) values (${sha(code)}, ${r.u.id}, ${ch}, now() + interval '2 minutes')`;
  res.json({ code });
}));

app.post('/api/auth/exchange', limit('login', 20, 60000), wrap(async (req, res) => {
  const code = String(req.body.code || ''), v = String(req.body.verifier || ''), dev = String(req.body.deviceId || '');
  if (!/^[a-f0-9]{48}$/.test(code) || !v || !DEV_RE.test(dev)) return res.status(400).json({ error: 'Bad request' });
  const row = (await sql`delete from app_codes where code_hash = ${sha(code)} and expires_at > now() returning user_id, challenge`)[0];
  if (!row || !same(sha(v), row.challenge)) return res.status(401).json({ error: 'The sign in link expired. Please try again.' });
  const u = (await sql`select * from users where id = ${row.user_id}`)[0];
  if (!u) return res.status(401).json({ error: 'Account not found' });
  await startSession(u, dev, res);
}));

app.post('/api/auth/logout', auth, wrap(async (req, res) => {
  await sql`update users set session_hash = null where id = ${req.user.id}`;
  res.json({ ok: true });
}));

app.get('/api/me', auth, (req, res) => res.json(pubUser(req.user)));

app.patch('/api/me', auth, wrap(async (req, res) => {
  const b = req.body, first = clean(b.firstName, 40);
  if (!first) return res.status(400).json({ error: 'First name is required' });
  const board = b.board === 'ssc' ? 'ssc' : 'msbte';
  const branch = board === 'ssc' ? 'ssc-general' : clean(b.branch, 30);
  await sql`update users set first_name = ${first}, last_name = ${clean(b.lastName, 40)}, board = ${board}, branch = ${branch} where id = ${req.user.id}`;
  res.json({ ok: true });
}));

/* ---------- notes and orders ---------- */
app.get('/api/notes', auth, wrap(async (req, res) => {
  res.json(await sql`
    select n.id, n.title, n.description, n.board, n.branch, n.semester, n.subject_code as "subjectCode", n.price,
      o.status, coalesce(o.has_shot, false) as "hasShot"
    from notes n
    left join lateral (
      select status, (shot_public_id is not null) as has_shot from orders where user_id = ${req.user.id} and note_id = n.id
      order by case status when 'approved' then 1 when 'pending' then 2 else 3 end limit 1
    ) o on true
    where n.active order by n.created_at desc limit 500`);
}));

app.post('/api/orders', auth, limit('order', 30, 60000), wrap(async (req, res) => {
  const n = (await sql`select * from notes where id = ${parseInt(req.body.noteId) || 0} and active`)[0];
  if (!n) return res.status(404).json({ error: 'Notes not found' });
  const live = () => sql`select * from orders where user_id = ${req.user.id} and note_id = ${n.id} and status in ('pending','approved')`;
  let o = (await live())[0];
  if (!o) {
    const open = (await sql`select count(*)::int as c from orders where user_id = ${req.user.id} and status = 'pending'`)[0].c;
    if (open >= 10) return res.status(429).json({ error: 'You have too many unpaid items. Finish those first.' });
    const status = n.price === 0 ? 'approved' : 'pending';
    o = (await sql`insert into orders (user_id, note_id, amount, status) values (${req.user.id}, ${n.id}, ${n.price}, ${status})
      on conflict (user_id, note_id) where status in ('pending','approved') do nothing returning *`)[0] || (await live())[0];
  }
  res.json({ id: o.id, status: o.status, amount: o.amount, title: n.title });
}));

async function myPendingOrder(req) {
  return (await sql`select * from orders where id = ${parseInt(req.params.id) || 0} and user_id = ${req.user.id} and status = 'pending'`)[0];
}

app.post('/api/orders/:id/shot-sign', auth, limit('sign', 20, 60000), wrap(async (req, res) => {
  const o = await myPendingOrder(req);
  if (!o) return res.status(404).json({ error: 'Payment not found' });
  res.json(signUpload('cosmic/shots/' + o.id + '_' + crypto.randomBytes(6).toString('hex'), 'jpg,jpeg,png,webp'));
}));

app.post('/api/orders/:id/shot', auth, wrap(async (req, res) => {
  const o = await myPendingOrder(req), pid = String(req.body.publicId || '');
  if (!o || !pid.startsWith('cosmic/shots/' + o.id + '_') || !/^[\w\/-]+$/.test(pid)) return res.status(400).json({ error: 'Invalid upload' });
  await sql`update orders set shot_public_id = ${pid} where id = ${o.id}`;
  res.json({ ok: true });
}));

app.get('/api/notes/:id/file', auth, limit('file', 40, 60000), wrap(async (req, res) => {
  if (E.APP_ONLY === '1' && !/CosmicApp/.test(req.headers['user-agent'] || '')) {
    return res.status(403).json({ error: 'Please open your notes in the Cosmic app. You can download it from the home page.', code: 'APP' });
  }
  const id = parseInt(req.params.id) || 0;
  const paid = await sql`select 1 from orders where user_id = ${req.user.id} and note_id = ${id} and status = 'approved'`;
  if (!paid[0]) return res.status(403).json({ error: 'Not unlocked yet' });
  const n = (await sql`select title, pdf_public_id, pages from notes where id = ${id}`)[0];
  if (!n) return res.status(404).json({ error: 'Notes not found' });
  if (!n.pages) return res.status(409).json({ error: 'These notes are being updated. Please try again later.' });
  const w = Math.min(1400, Math.max(480, parseInt(req.query.w) || 1000));
  const pages = [];
  for (let i = 1; i <= n.pages; i++) pages.push(pageUrl(n.pdf_public_id, i, w));
  res.json({ title: n.title, pages });
}));

/* ---------- admin ---------- */
app.post('/api/admin/login', limit('admin', 8, 600000), wrap(async (req, res) => {
  if (!E.ADMIN_PASSWORD || SECRET.length < 16) return res.status(503).json({ error: 'Admin is not configured on the server' });
  if (!same(req.body.password || '', E.ADMIN_PASSWORD)) {
    await new Promise(r => setTimeout(r, 900));
    return res.status(401).json({ error: 'Wrong password' });
  }
  res.json({ token: makeAdmin() });
}));

app.get('/api/admin/data', adminOnly, wrap(async (req, res) => {
  const [orders, notes, users] = await Promise.all([
    sql`select o.id, o.amount, o.status, o.created_at as "createdAt", o.shot_public_id,
          u.first_name || ' ' || u.last_name as "userName", coalesce(u.email, u.phone) as phone, n.title
        from orders o join users u on u.id = o.user_id join notes n on n.id = o.note_id order by o.created_at desc limit 500`,
    sql`select id, title, board, branch, semester, subject_code as "subjectCode", price, pages, active, created_at as "createdAt" from notes order by created_at desc limit 500`,
    sql`select u.id, u.first_name || ' ' || u.last_name as name, coalesce(u.email, u.phone) as phone, u.board, u.branch, u.created_at as "createdAt",
          (u.device_id is not null) as locked,
          (select count(*)::int from orders o where o.user_id = u.id and o.status = 'approved') as unlocked
        from users u order by u.created_at desc limit 500`
  ]);
  res.json({
    orders: orders.map(({ shot_public_id, ...o }) => ({ ...o, shotUrl: shot_public_id ? signedUrl(shot_public_id, 'image') : null })),
    notes, users
  });
}));

app.post('/api/admin/users/:id/reset', adminOnly, wrap(async (req, res) => {
  await sql`update users set device_id = null, session_hash = null where id = ${parseInt(req.params.id) || 0}`;
  res.json({ ok: true });
}));

app.post('/api/admin/orders/:id', adminOnly, wrap(async (req, res) => {
  const s = req.body.status;
  if (!['pending', 'approved', 'rejected'].includes(s)) return res.status(400).json({ error: 'Bad status' });
  await sql`update orders set status = ${s} where id = ${parseInt(req.params.id) || 0}`;
  res.json({ ok: true });
}));

app.post('/api/admin/sign', adminOnly, (req, res) =>
  res.json(signUpload('cosmic/notes/' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'), 'pdf')));

app.post('/api/admin/notes', adminOnly, wrap(async (req, res) => {
  const b = req.body, price = Math.round(Number(b.price)), pid = String(b.pdfPublicId || '');
  if (!clean(b.title, 120) || !(price >= 0 && price <= 100000) || !pid.startsWith('cosmic/notes/')) return res.status(400).json({ error: 'Missing fields' });
  let info;
  try { info = await cloudinary.api.resource(pid, { resource_type: 'image', type: 'authenticated', pages: true }); }
  catch (e) { return res.status(400).json({ error: 'Cloudinary could not find the uploaded PDF' }); }
  const pages = Number(info.pages) || 0;
  if (pages < 1) return res.status(400).json({ error: 'Could not read the pages of this PDF' });
  const r = await sql`insert into notes (title, description, board, branch, semester, subject_code, price, pdf_public_id, pages)
    values (${clean(b.title, 120)}, ${clean(b.description, 400)}, ${b.board === 'ssc' ? 'ssc' : 'msbte'}, ${clean(b.branch, 30)},
      ${clean(b.semester, 10)}, ${clean(b.subjectCode, 20)}, ${price}, ${pid}, ${pages}) returning id`;
  res.json({ id: r[0].id, pages });
}));

app.post('/api/admin/notes/:id/toggle', adminOnly, wrap(async (req, res) => {
  await sql`update notes set active = not active where id = ${parseInt(req.params.id) || 0}`;
  res.json({ ok: true });
}));

app.delete('/api/admin/notes/:id', adminOnly, wrap(async (req, res) => {
  const id = parseInt(req.params.id) || 0;
  const n = (await sql`select pdf_public_id from notes where id = ${id}`)[0];
  if (n) {
    await cloudinary.uploader.destroy(n.pdf_public_id, { resource_type: 'image', type: 'authenticated' }).catch(() => {});
    await cloudinary.uploader.destroy(n.pdf_public_id, { resource_type: 'raw', type: 'authenticated' }).catch(() => {});
  }
  await sql`delete from notes where id = ${id}`;
  res.json({ ok: true });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const bad = err.status === 400 || err.type === 'entity.parse.failed';
  res.status(bad ? 400 : 500).json({ error: bad ? 'Bad request' : 'Server error. Please try again.' });
});

export default app;
