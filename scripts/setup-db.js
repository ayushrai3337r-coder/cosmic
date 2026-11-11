import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const statements = [
  `create table if not exists users (
    id serial primary key,
    firebase_uid text unique not null,
    email text,
    phone text,
    first_name text not null,
    last_name text not null default '',
    board text not null default 'msbte',
    branch text not null default '',
    session_hash text,
    session_at timestamptz,
    device_id text,
    created_at timestamptz not null default now()
  )`,
  `alter table users add column if not exists email text`,
  `alter table users add column if not exists device_id text`,
  `alter table users alter column phone drop not null`,
  `create unique index if not exists users_email on users (email)`,
  `create index if not exists users_session on users (session_hash)`,
  `create table if not exists notes (
    id serial primary key,
    title text not null,
    description text not null default '',
    board text not null,
    branch text not null default '',
    semester text not null default '',
    subject_code text not null default '',
    price int not null,
    pdf_public_id text not null,
    pages int not null default 0,
    active boolean not null default true,
    created_at timestamptz not null default now()
  )`,
  `alter table notes add column if not exists pages int not null default 0`,
  `create index if not exists notes_active on notes (active, created_at desc)`,
  `create table if not exists orders (
    id serial primary key,
    user_id int not null references users(id) on delete cascade,
    note_id int not null references notes(id) on delete cascade,
    amount int not null,
    status text not null default 'pending',
    shot_public_id text,
    created_at timestamptz not null default now()
  )`,
  `create unique index if not exists orders_live on orders (user_id, note_id) where status in ('pending','approved')`,
  `create index if not exists orders_user on orders (user_id, created_at desc)`,
  `create index if not exists orders_note on orders (note_id)`,
  `create index if not exists orders_status on orders (status, created_at desc)`,
  `create table if not exists app_codes (
    code_hash text primary key,
    user_id int not null references users(id) on delete cascade,
    challenge text not null,
    expires_at timestamptz not null
  )`
];
for (const s of statements) await sql.query(s);
console.log('Database ready');
