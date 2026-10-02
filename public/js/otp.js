import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { api } from '/js/app.js';

let auth, verifier, confirmation;

async function init() {
  if (auth) return;
  const cfg = await (await fetch('/api/config')).json();
  auth = getAuth(initializeApp(cfg));
}

export function phoneNumber(raw) {
  const d = raw.replace(/\D/g, '');
  if (d.length === 10) return '+91' + d;
  if (d.length === 12 && d.startsWith('91')) return '+' + d;
  return null;
}

export async function sendCode(phone) {
  await init();
  if (verifier) { try { verifier.clear(); } catch (e) {} }
  document.getElementById('rc').innerHTML = '';
  verifier = new RecaptchaVerifier(auth, 'rc', { size: 'invisible' });
  confirmation = await signInWithPhoneNumber(auth, phone, verifier);
}

export async function verifyCode(code, profile) {
  const cred = await confirmation.confirm(code);
  const idToken = await cred.user.getIdToken();
  return api('/api/auth/login', { idToken, profile });
}
