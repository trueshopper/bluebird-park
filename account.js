// account.js — client-side account system with a swappable storage layer.
// Passwords are never stored in plaintext: salted SHA-256 via WebCrypto.
// The API is shaped like an async backend client so a real server can replace
// the localStorage layer later without touching any UI code.

const DB_KEY = 'bp_accounts';
const SESSION_KEY = 'bp_session';

function loadDB() {
  try { return JSON.parse(localStorage.getItem(DB_KEY) || '{}'); } catch (e) { return {}; }
}
function saveDB(db) {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) {}
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function currentEmail() {
  try { return localStorage.getItem(SESSION_KEY) || null; } catch (e) { return null; }
}

export function currentAccount() {
  const email = currentEmail();
  if (!email) return null;
  const db = loadDB();
  return db[email] ? { email, ...db[email] } : null;
}

export async function createAccount(email, password) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter a valid email address' };
  if (!password || password.length < 6) return { ok: false, error: 'Password must be at least 6 characters' };
  const db = loadDB();
  if (db[email]) return { ok: false, error: 'An account with that email already exists' };
  const salt = randomSalt();
  const hash = await sha256(salt + password);
  db[email] = { salt, hash, profile: { username: null, gender: null, skin: null, wardrobe: null, xp: 0 } };
  saveDB(db);
  try { localStorage.setItem(SESSION_KEY, email); } catch (e) {}
  return { ok: true };
}

export async function login(email, password) {
  email = String(email || '').trim().toLowerCase();
  const db = loadDB();
  const acc = db[email];
  if (!acc) return { ok: false, error: 'No account found for that email' };
  const hash = await sha256(acc.salt + password);
  if (hash !== acc.hash) return { ok: false, error: 'Wrong password' };
  try { localStorage.setItem(SESSION_KEY, email); } catch (e) {}
  return { ok: true };
}

export function logout() {
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
}

export function getProfile() {
  const acc = currentAccount();
  return acc ? acc.profile : null;
}

export function patchProfile(patch) {
  const email = currentEmail();
  if (!email) return;
  const db = loadDB();
  if (!db[email]) return;
  db[email].profile = { ...db[email].profile, ...patch };
  saveDB(db);
}
