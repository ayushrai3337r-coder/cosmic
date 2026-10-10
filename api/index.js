import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { neon } from '@neondatabase/serverless';
import { v2 as cloudinary } from 'cloudinary';

const E = process.env;
cloudinary.config({ cloud_name: E.CLOUDINARY_CLOUD_NAME, api_key: E.CLOUDINARY_API_KEY, api_secret: E.CLOUDINARY_API_SECRET, secure: true });
const sql = neon(E.DATABASE_URL);
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(err => { console.error(err); res.status(500).json({ error: 'Server error' }); });
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const bearer = req => (req.headers.authorization || '').replace(/^Bearer /, '');
const clean = (v, n) => String(v || '').trim().slice(0, n);
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const pubUser = u => ({ id: u.id, firstName: u.first_name, lastName: u.last_name, email: u.email, phone: u.phone, board: u.board, branch: u.branch, createdAt: u.created_at });
const signedUrl = (pid, resource) => cloudinary.url(pid, { resource_type: resource, type: 'authenticated', sign_url: true, secure: true });

function signUpload(publicId, resource) {
  const params = { public_id: publicId, timestamp: Math.round(Date.now() / 1000), type: 'authenticated' };
  const signature = cloudinary.utils.api_sign_request(params, E.CLOUDINARY_API_SECRET);
  return { ...params, signature, apiKey: E.CLOUDINARY_API_KEY, cloudName: E.CLOUDINARY_CLOUD_NAME, resource };
}

async function googleUser(idToken) {
  const { payload } = await jwtVerify(idToken, JWKS, { issuer: 'https://securetoken.google.com/' + E.FIREBASE_PROJECT_ID, audience: E.FIREBASE_PROJECT_ID });
  if (!payload.sub || !payload.email || payload.email_verified === false) throw new Error('bad token');
  if (payload.firebase && payload.firebase.sign_in_provider !== 'google.com') throw new Error('bad provider');
  return { uid: payload.sub, email: String(payload.email).toLowerCase(), name: String(payload.name || '') };
}

const auth = wrap(async (req, res, next) => {
  const t = bearer(req);
  if (!t) return res.status(401).json({ error: 'Please sign in', code: 'SESSION' });
  const rows = await sql`select * from users where session_hash = ${sha(t)}`;
  if (!rows[0]) return res.status(401).json({ error: 'You were signed out because this account was opened on another device.', code: 'SESSION' });
  req.user = rows[0];
  next();
});

const adminSig = exp => crypto.createHmac('sha256', 'admin|' + E.TOKEN_SECRET).update(exp).digest('hex');
const makeAdmin = () => { const exp = String(Date.now() + 8 * 3600 * 1000); return exp + '.' + adminSig(exp); };
const okAdmin = t => { const [exp, sig] = String(t || '').split('.'); return !!exp && !!sig && Number(exp) > Date.now() && same(sig, adminSig(exp)); };
const adminOnly = (req, res, next) => okAdmin(req.headers['x-admin-token']) ? next() : res.status(401).json({ error: 'Admin sign in required' });

app.get('/api/config', (req, res) => res.json({
  apiKey: E.FIREBASE_API_KEY, authDomain: E.FIREBASE_AUTH_DOMAIN, projectId: E.FIREBASE_PROJECT_ID, appId: E.FIREBASE_APP_ID
}));

/* ---------- auth ---------- */
app.post('/api/auth/login', wrap(async (req, res) => {
  let g;
  try { g = await googleUser(String(req.body.idToken || '')); }
  catch (e) { return res.status(401).json({ error: 'Could not verify your Google account. Try again.' }); }
  let u = (await sql`select * from users where firebase_uid = ${g.uid}`)[0];
  if (!u) {
    const p = req.body.profile;
    if (!p) return res.json({ needsSignup: true, name: g.name, email: g.email });
    const first = clean(p.firstName, 40);
    if (!first) return res.status(400).json({ error: 'Enter your first name' });
    const board = p.board === 'ssc' ? 'ssc' : 'msbte';
    const branch = board === 'ssc' ? 'ssc-general' : clean(p.branch, 30);
    u = (await sql`insert into users (firebase_uid, email, first_name, last_name, board, branch)
      values (${g.uid}, ${g.email}, ${first}, ${clean(p.lastName, 40)}, ${board}, ${branch})
      on conflict (firebase_uid) do update set email = excluded.email returning *`)[0];
  }
  const token = crypto.randomBytes(32).toString('hex');
  await sql`update users set session_hash = ${sha(token)}, session_at = now() where id = ${u.id}`;
  res.json({ token, user: pubUser(u) });
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
      (select o.status from orders o where o.user_id = ${req.user.id} and o.note_id = n.id
        order by case o.status when 'approved' then 1 when 'pending' then 2 else 3 end limit 1) as status
    from notes n where n.active order by n.created_at desc`);
}));

app.post('/api/orders', auth, wrap(async (req, res) => {
  const n = (await sql`select * from notes where id = ${parseInt(req.body.noteId) || 0} and active`)[0];
  if (!n) return res.status(404).json({ error: 'Notes not found' });
  let o = (await sql`select * from orders where user_id = ${req.user.id} and note_id = ${n.id} and status in ('pending','approved')`)[0];
  if (!o) {
    const status = n.price === 0 ? 'approved' : 'pending';
    o = (await sql`insert into orders (user_id, note_id, amount, status) values (${req.user.id}, ${n.id}, ${n.price}, ${status}) returning *`)[0];
  }
  res.json({ id: o.id, status: o.status, amount: o.amount, title: n.title });
}));

app.get('/api/orders', auth, wrap(async (req, res) => {
  res.json(await sql`
    select o.id, o.amount, o.status, o.created_at as "createdAt", o.note_id as "noteId",
      (o.shot_public_id is not null) as "hasShot", n.title, n.board
    from orders o join notes n on n.id = o.note_id
    where o.user_id = ${req.user.id} order by o.created_at desc`);
}));

async function myPendingOrder(req) {
  return (await sql`select * from orders where id = ${parseInt(req.params.id) || 0} and user_id = ${req.user.id} and status = 'pending'`)[0];
}

app.post('/api/orders/:id/shot-sign', auth, wrap(async (req, res) => {
  const o = await myPendingOrder(req);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  res.json(signUpload('cosmic/shots/' + o.id + '_' + crypto.randomBytes(6).toString('hex'), 'image'));
}));

app.post('/api/orders/:id/shot', auth, wrap(async (req, res) => {
  const o = await myPendingOrder(req), pid = String(req.body.publicId || '');
  if (!o || !pid.startsWith('cosmic/shots/' + o.id + '_') || !/^[\w\/-]+$/.test(pid)) return res.status(400).json({ error: 'Invalid upload' });
  await sql`update orders set shot_public_id = ${pid} where id = ${o.id}`;
  res.json({ ok: true });
}));

app.get('/api/notes/:id/file', auth, wrap(async (req, res) => {
  const id = parseInt(req.params.id) || 0;
  const paid = await sql`select 1 from orders where user_id = ${req.user.id} and note_id = ${id} and status = 'approved'`;
  if (!paid[0]) return res.status(403).json({ error: 'Not unlocked yet' });
  const n = (await sql`select title, pdf_public_id from notes where id = ${id}`)[0];
  if (!n) return res.status(404).json({ error: 'Notes not found' });
  res.json({ url: signedUrl(n.pdf_public_id, 'raw'), title: n.title });
}));

/* ---------- admin ---------- */
app.post('/api/admin/login', wrap(async (req, res) => {
  if (!E.ADMIN_PASSWORD || !same(req.body.password || '', E.ADMIN_PASSWORD)) {
    await new Promise(r => setTimeout(r, 900));
    return res.status(401).json({ error: 'Wrong password' });
  }
  res.json({ token: makeAdmin() });
}));

app.get('/api/admin/data', adminOnly, wrap(async (req, res) => {
  const [orders, notes, users] = await Promise.all([
    sql`select o.id, o.amount, o.status, o.created_at as "createdAt", o.shot_public_id,
          u.first_name || ' ' || u.last_name as "userName", coalesce(u.email, u.phone) as phone, n.title
        from orders o join users u on u.id = o.user_id join notes n on n.id = o.note_id order by o.created_at desc`,
    sql`select id, title, board, branch, semester, subject_code as "subjectCode", price, active, created_at as "createdAt" from notes order by created_at desc`,
    sql`select u.id, u.first_name || ' ' || u.last_name as name, coalesce(u.email, u.phone) as phone, u.board, u.branch, u.created_at as "createdAt",
          (select count(*)::int from orders o where o.user_id = u.id and o.status = 'approved') as unlocked
        from users u order by u.created_at desc`
  ]);
  res.json({
    orders: orders.map(({ shot_public_id, ...o }) => ({ ...o, shotUrl: shot_public_id ? signedUrl(shot_public_id, 'image') : null })),
    notes, users
  });
}));

app.post('/api/admin/orders/:id', adminOnly, wrap(async (req, res) => {
  const s = req.body.status;
  if (!['pending', 'approved', 'rejected'].includes(s)) return res.status(400).json({ error: 'Bad status' });
  await sql`update orders set status = ${s} where id = ${parseInt(req.params.id) || 0}`;
  res.json({ ok: true });
}));

app.post('/api/admin/sign', adminOnly, (req, res) =>
  res.json(signUpload('cosmic/notes/' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + '.pdf', 'raw')));

app.post('/api/admin/notes', adminOnly, wrap(async (req, res) => {
  const b = req.body, price = Math.round(Number(b.price)), pid = String(b.pdfPublicId || '');
  if (!clean(b.title, 120) || !(price >= 0) || !pid.startsWith('cosmic/notes/')) return res.status(400).json({ error: 'Missing fields' });
  const r = await sql`insert into notes (title, description, board, branch, semester, subject_code, price, pdf_public_id)
    values (${clean(b.title, 120)}, ${clean(b.description, 400)}, ${b.board === 'ssc' ? 'ssc' : 'msbte'}, ${clean(b.branch, 30)},
      ${clean(b.semester, 10)}, ${clean(b.subjectCode, 20)}, ${price}, ${pid}) returning id`;
  res.json({ id: r[0].id });
}));

app.post('/api/admin/notes/:id/toggle', adminOnly, wrap(async (req, res) => {
  await sql`update notes set active = not active where id = ${parseInt(req.params.id) || 0}`;
  res.json({ ok: true });
}));

app.delete('/api/admin/notes/:id', adminOnly, wrap(async (req, res) => {
  const id = parseInt(req.params.id) || 0;
  const n = (await sql`select pdf_public_id from notes where id = ${id}`)[0];
  if (n) await cloudinary.uploader.destroy(n.pdf_public_id, { resource_type: 'raw', type: 'authenticated' }).catch(() => {});
  await sql`delete from notes where id = ${id}`;
  res.json({ ok: true });
}));

export default app;
