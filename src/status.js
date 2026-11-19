'use strict';
const tls = require('tls');
const { db } = require('./db');

function tlsExpiry(hostname, port = 443) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host: hostname, port, servername: hostname, timeout: 8000, rejectUnauthorized: false }, () => {
      const cert = sock.getPeerCertificate();
      sock.end();
      resolve(cert && cert.valid_to ? Date.parse(cert.valid_to) : null);
    });
    sock.on('error', () => resolve(null));
    sock.on('timeout', () => { sock.destroy(); resolve(null); });
  });
}

async function checkHost(h) {
  const started = Date.now();
  let ok = 0, code = null, error = null, tlsExp = null;
  try {
    const u = new URL(h.url);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(u, { method: 'GET', redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': 'waree-hub-status' } });
    clearTimeout(t);
    code = r.status;
    ok = r.status < 500 ? 1 : 0;
    if (u.protocol === 'https:') tlsExp = await tlsExpiry(u.hostname, Number(u.port) || 443);
  } catch (e) {
    const c = e.cause?.code || '';
    const map = { ENOTFOUND: 'домен не найден', ECONNREFUSED: 'порт закрыт', ECONNRESET: 'соединение сброшено', ETIMEDOUT: 'нет ответа', CERT_HAS_EXPIRED: 'SSL истёк', UND_ERR_CONNECT_TIMEOUT: 'нет ответа' };
    error = e.name === 'AbortError' ? 'нет ответа за 10 с' : (map[c] || String(c || e.message)).slice(0, 120);
  }
  db.prepare('UPDATE hosts SET ok = ?, code = ?, ms = ?, tls_expires = ?, error = ?, checked = ? WHERE id = ?')
    .run(ok, code, Date.now() - started, tlsExp, error, Date.now(), h.id);
}

async function checkAll() {
  const hosts = db.prepare('SELECT * FROM hosts').all();
  await Promise.all(hosts.map(checkHost));
}

function startStatusLoop() {
  const every = Number(process.env.HUB_CHECK_MIN || 5) * 60e3;
  setTimeout(() => checkAll().catch(() => {}), 3000);
  setInterval(() => checkAll().catch(() => {}), every).unref();
}

module.exports = { checkAll, checkHost, startStatusLoop };
