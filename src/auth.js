'use strict';
const crypto = require('crypto');
const { db, getSetting } = require('./db');

const SESSION_DAYS = 30;
const COOKIE = 'hub_sid';

/* ---------- пароль (scrypt) ---------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, s, k] = stored.split('$');
  const key = crypto.scryptSync(password, Buffer.from(s, 'base64'), 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const want = Buffer.from(k, 'base64');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}

/* ---------- TOTP (RFC 6238, SHA-1, 30 с, 6 цифр) ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = str.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch); if (i < 0) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpAt(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1e6).toString().padStart(6, '0');
  return code;
}
let lastTotpCounter = 0; // защита от повторного использования кода
function verifyTotp(secret, code) {
  if (!/^\d{6}$/.test(String(code || ''))) return false;
  const now = Math.floor(Date.now() / 30000);
  for (const c of [now - 1, now, now + 1]) {
    if (c <= lastTotpCounter) continue;
    const want = totpAt(secret, c);
    if (crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(code)))) { lastTotpCounter = c; return true; }
  }
  return false;
}
function newTotpSecret() { return base32Encode(crypto.randomBytes(20)); }

/* ---------- ограничение попыток входа ---------- */
const attempts = new Map(); // ip -> {n, until}
function loginBlocked(ip) {
  const a = attempts.get(ip);
  return a && a.until > Date.now();
}
function loginFailed(ip) {
  const a = attempts.get(ip) || { n: 0, until: 0 };
  a.n += 1;
  if (a.n >= 5) { a.until = Date.now() + Math.min(60 * 60e3, 60e3 * 2 ** (a.n - 5)); }
  attempts.set(ip, a);
}
function loginOk(ip) { attempts.delete(ip); }

/* ---------- сессии ---------- */
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
function createSession(ua) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id, created, expires, ua) VALUES (?, ?, ?, ?)').run(sha256(token), now, now + SESSION_DAYS * 864e5, (ua || '').slice(0, 200));
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(now);
  return token;
}
function readCookie(req, name) {
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
function sessionFromReq(req) {
  const t = readCookie(req, COOKIE);
  if (!t) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sha256(t));
  if (!s || s.expires < Date.now()) return null;
  return { ...s, token: t };
}
function setSessionCookie(res, token) {
  const secure = process.env.HUB_INSECURE_COOKIE ? '' : ' Secure;';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}
function destroySession(token) { db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token)); }

/** Для всех изменяющих запросов из браузера: своя сессия + заголовок X-Hub (защита от CSRF). */
function requireUser(req, res, next) {
  const s = sessionFromReq(req);
  if (!s) return res.status(401).json({ error: 'Нужно войти' });
  if (req.method !== 'GET' && req.get('X-Hub') !== '1') return res.status(403).json({ error: 'Запрос отклонён' });
  req.session = s;
  next();
}

/* ---------- ключи устройств для синхронизации ---------- */
function createDeviceToken(name) {
  const token = 'hub_' + crypto.randomBytes(24).toString('base64url');
  const r = db.prepare('INSERT INTO devices (name, token_hash, created) VALUES (?, ?, ?)').run(name, sha256(token), Date.now());
  return { id: r.lastInsertRowid, token };
}
function deviceFromReq(req) {
  const h = req.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(hub_[A-Za-z0-9_-]{20,})$/);
  if (!m) return null;
  const d = db.prepare('SELECT * FROM devices WHERE token_hash = ? AND revoked = 0').get(sha256(m[1]));
  if (d) db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(Date.now(), d.id);
  return d || null;
}

function isConfigured() { return !!(getSetting('password') && getSetting('totp')); }

module.exports = {
  hashPassword, verifyPassword, newTotpSecret, verifyTotp, totpAt,
  loginBlocked, loginFailed, loginOk,
  createSession, sessionFromReq, setSessionCookie, clearSessionCookie, destroySession, requireUser,
  createDeviceToken, deviceFromReq, isConfigured,
};
