'use strict';
if (!process.env.TZ) process.env.TZ = 'Asia/Tashkent';

const path = require('path');
const express = require('express');
const { db, getSetting } = require('./db');
const auth = require('./auth');
const summary = require('./summary');
const { checkAll, startStatusLoop } = require('./status');

const PORT = Number(process.env.HUB_PORT || 3100);
const HOST = process.env.HUB_HOST || '127.0.0.1';
const SYNC_APPS = new Set(['rasxodnik', 'mandala']);
const HISTORY_KEEP = 30;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  next();
});

/* =====================================================================
   Синхронизация приложений (ключ устройства, без cookie, CORS открыт:
   приложения работают из file:// внутри WebView)
   ===================================================================== */
const sync = express.Router();
sync.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  const dev = auth.deviceFromReq(req);
  if (!dev) return res.status(401).json({ error: 'Неверный или отозванный ключ' });
  req.device = dev;
  next();
});
sync.get('/ping', (req, res) => res.json({ ok: true, device: req.device.name }));
sync.get('/:app', (req, res) => {
  if (!SYNC_APPS.has(req.params.app)) return res.status(404).json({ error: 'Неизвестное приложение' });
  const r = db.prepare('SELECT data, updated FROM sync WHERE app = ?').get(req.params.app);
  if (!r) return res.status(404).json({ error: 'На сервере ещё нет данных' });
  res.json({ updated: r.updated, data: JSON.parse(r.data) });
});
sync.put('/:app', express.json({ limit: '8mb' }), (req, res) => {
  const name = req.params.app;
  if (!SYNC_APPS.has(name)) return res.status(404).json({ error: 'Неизвестное приложение' });
  if (!req.body || typeof req.body.data !== 'object') return res.status(400).json({ error: 'Нет данных' });
  const data = JSON.stringify(req.body.data);
  const now = Date.now();
  const tx = db.transaction(() => {
    const prev = db.prepare('SELECT data, updated FROM sync WHERE app = ?').get(name);
    if (prev && prev.data !== data) {
      // копия прошлой версии раз в 6 часов — история для отката
      const last = db.prepare('SELECT updated FROM sync_history WHERE app = ? ORDER BY updated DESC LIMIT 1').get(name);
      // а также всегда, если новые данные заметно меньше старых (защита от затирания пустым телефоном)
      if (!last || now - last.updated > 6 * 3600e3 || data.length < prev.data.length * 0.6) {
        db.prepare('INSERT INTO sync_history (app, data, updated) VALUES (?, ?, ?)').run(name, prev.data, prev.updated);
        db.prepare(`DELETE FROM sync_history WHERE app = ? AND id NOT IN
          (SELECT id FROM sync_history WHERE app = ? ORDER BY updated DESC LIMIT ?)`).run(name, name, HISTORY_KEEP);
      }
    }
    db.prepare(`INSERT INTO sync (app, data, updated, device) VALUES (?, ?, ?, ?)
      ON CONFLICT(app) DO UPDATE SET data = excluded.data, updated = excluded.updated, device = excluded.device`)
      .run(name, data, now, req.device.id);
  });
  tx();
  res.json({ ok: true, updated: now });
});
app.use('/api/sync', sync);

/* =====================================================================
   Вход
   ===================================================================== */
app.use('/api', express.json({ limit: '256kb' }));

app.get('/api/me', (req, res) => {
  if (!auth.isConfigured()) return res.status(503).json({ error: 'Центр не настроен: запусти npm run setup на сервере' });
  const s = auth.sessionFromReq(req);
  if (!s) return res.status(401).json({ error: 'Нужно войти' });
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (!auth.isConfigured()) return res.status(503).json({ error: 'Центр не настроен' });
  if (auth.loginBlocked(ip)) return res.status(429).json({ error: 'Слишком много попыток. Подожди и попробуй снова' });
  const { password, code } = req.body || {};
  const okPass = typeof password === 'string' && auth.verifyPassword(password, getSetting('password'));
  const okCode = okPass && auth.verifyTotp(getSetting('totp'), code);
  if (!okPass || !okCode) {
    auth.loginFailed(ip);
    return res.status(401).json({ error: 'Неверный пароль или код' });
  }
  auth.loginOk(ip);
  auth.setSessionCookie(res, auth.createSession(req.get('User-Agent')));
  res.json({ ok: true });
});

app.post('/api/logout', auth.requireUser, (req, res) => {
  auth.destroySession(req.session.token);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

/* =====================================================================
   Данные центра (только после входа)
   ===================================================================== */
const api = express.Router();
api.use(auth.requireUser);

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:'; } catch { return false; } };
const COLORS = new Set(['accent', 'blue', 'gray', 'purple', 'green', 'pink', 'gold']);

api.get('/dashboard', (req, res) => {
  const now = Date.now();
  res.json({
    services: db.prepare('SELECT s.* FROM services s ORDER BY (SELECT MIN(id) FROM services x WHERE x.grp = s.grp), s.pos, s.id').all(),
    notes: db.prepare('SELECT * FROM notes ORDER BY pinned DESC, updated DESC').all(),
    commands: db.prepare('SELECT * FROM commands ORDER BY pos, id').all(),
    hosts: db.prepare('SELECT * FROM hosts ORDER BY pos, id').all(),
    domains: db.prepare('SELECT * FROM domains ORDER BY expires').all().map((d) => ({ ...d, days: Math.ceil((Date.parse(d.expires) - now) / 864e5) })),
    rasxodnik: summary.rasxodnik(),
    mandala: summary.mandala(),
  });
});

// сервисы
api.post('/services', (req, res) => {
  const b = req.body || {};
  const grp = str(b.grp, 40) || 'Разное', name = str(b.name, 60), url = str(b.url, 500);
  if (!name || !isUrl(url)) return res.status(400).json({ error: 'Нужны название и ссылка http(s)://' });
  const color = COLORS.has(b.color) ? b.color : 'blue';
  const pos = (db.prepare('SELECT MAX(pos) m FROM services WHERE grp = ?').get(grp).m ?? -1) + 1;
  const r = db.prepare('INSERT INTO services (grp, name, url, sub, color, pos) VALUES (?, ?, ?, ?, ?, ?)').run(grp, name, url, str(b.sub, 80), color, pos);
  res.json({ id: r.lastInsertRowid });
});
api.put('/services/:id', (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 60), url = str(b.url, 500);
  if (!name || !isUrl(url)) return res.status(400).json({ error: 'Нужны название и ссылка http(s)://' });
  db.prepare('UPDATE services SET grp = ?, name = ?, url = ?, sub = ?, color = ? WHERE id = ?')
    .run(str(b.grp, 40) || 'Разное', name, url, str(b.sub, 80), COLORS.has(b.color) ? b.color : 'blue', Number(req.params.id));
  res.json({ ok: true });
});
api.delete('/services/:id', (req, res) => { db.prepare('DELETE FROM services WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });

// заметки
api.post('/notes', (req, res) => {
  const b = req.body || {};
  const r = db.prepare('INSERT INTO notes (title, body, pinned, updated) VALUES (?, ?, ?, ?)').run(str(b.title, 120), str(b.body, 20000), b.pinned ? 1 : 0, Date.now());
  res.json({ id: r.lastInsertRowid });
});
api.put('/notes/:id', (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE notes SET title = ?, body = ?, pinned = ?, updated = ? WHERE id = ?').run(str(b.title, 120), str(b.body, 20000), b.pinned ? 1 : 0, Date.now(), Number(req.params.id));
  res.json({ ok: true });
});
api.delete('/notes/:id', (req, res) => { db.prepare('DELETE FROM notes WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });

// команды
api.post('/commands', (req, res) => {
  const b = req.body || {};
  const title = str(b.title, 80), cmd = str(b.cmd, 2000);
  if (!title || !cmd) return res.status(400).json({ error: 'Нужны название и команда' });
  const pos = (db.prepare('SELECT MAX(pos) m FROM commands').get().m ?? -1) + 1;
  const r = db.prepare('INSERT INTO commands (title, cmd, hint, pos) VALUES (?, ?, ?, ?)').run(title, cmd, str(b.hint, 200), pos);
  res.json({ id: r.lastInsertRowid });
});
api.put('/commands/:id', (req, res) => {
  const b = req.body || {};
  const title = str(b.title, 80), cmd = str(b.cmd, 2000);
  if (!title || !cmd) return res.status(400).json({ error: 'Нужны название и команда' });
  db.prepare('UPDATE commands SET title = ?, cmd = ?, hint = ? WHERE id = ?').run(title, cmd, str(b.hint, 200), Number(req.params.id));
  res.json({ ok: true });
});
api.delete('/commands/:id', (req, res) => { db.prepare('DELETE FROM commands WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });

// серверы и домены
api.post('/hosts', (req, res) => {
  const b = req.body || {};
  const label = str(b.label, 60), url = str(b.url, 300);
  if (!label || !isUrl(url)) return res.status(400).json({ error: 'Нужны название и адрес https://' });
  const pos = (db.prepare('SELECT MAX(pos) m FROM hosts').get().m ?? -1) + 1;
  const r = db.prepare('INSERT INTO hosts (label, url, pos) VALUES (?, ?, ?)').run(label, url, pos);
  checkAll().catch(() => {});
  res.json({ id: r.lastInsertRowid });
});
api.delete('/hosts/:id', (req, res) => { db.prepare('DELETE FROM hosts WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });
api.post('/hosts/check', async (req, res) => { await checkAll(); res.json({ ok: true }); });
api.post('/domains', (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 100), expires = str(b.expires, 10);
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return res.status(400).json({ error: 'Нужны домен и дата окончания' });
  const r = db.prepare('INSERT INTO domains (name, expires) VALUES (?, ?)').run(name, expires);
  res.json({ id: r.lastInsertRowid });
});
api.delete('/domains/:id', (req, res) => { db.prepare('DELETE FROM domains WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });

// ключи устройств
api.get('/devices', (req, res) => {
  res.json({
    devices: db.prepare('SELECT id, name, created, last_seen, revoked FROM devices ORDER BY created DESC').all(),
    sync: db.prepare('SELECT app, updated FROM sync').all(),
    history: db.prepare('SELECT app, COUNT(*) n, MAX(updated) last FROM sync_history GROUP BY app').all(),
  });
});
api.post('/devices', (req, res) => {
  const name = str((req.body || {}).name, 60) || 'Телефон';
  res.json(auth.createDeviceToken(name)); // ключ показывается один раз
});
api.delete('/devices/:id', (req, res) => { db.prepare('UPDATE devices SET revoked = 1 WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });

// резервная копия данных приложения (скачать JSON)
api.get('/backup/:app', (req, res) => {
  if (!SYNC_APPS.has(req.params.app)) return res.sendStatus(404);
  const r = db.prepare('SELECT data, updated FROM sync WHERE app = ?').get(req.params.app);
  if (!r) return res.status(404).json({ error: 'Нет данных' });
  const d = new Date(r.updated);
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.app}-${d.toISOString().slice(0, 10)}.json"`);
  res.type('application/json').send(r.data);
});

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Нет такого адреса' }));

/* =====================================================================
   Статика
   ===================================================================== */
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: '1h' }));
app.use((req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой запрос' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Неверный JSON' });
  console.error(err);
  res.status(500).json({ error: 'Ошибка сервера' });
});

app.listen(PORT, HOST, () => {
  console.log(`waree-hub: http://${HOST}:${PORT}`);
  if (!auth.isConfigured()) console.log('Центр не настроен. Запусти: npm run setup');
  startStatusLoop();
});
