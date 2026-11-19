'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.HUB_DATA || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

const db = new Database(path.join(DATA_DIR, 'hub.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, created INTEGER NOT NULL, expires INTEGER NOT NULL, ua TEXT);
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL, last_seen INTEGER, revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY, grp TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL,
  sub TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'blue', pos INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS commands (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, cmd TEXT NOT NULL, hint TEXT NOT NULL DEFAULT '', pos INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS hosts (
  id INTEGER PRIMARY KEY, label TEXT NOT NULL, url TEXT NOT NULL, pos INTEGER NOT NULL DEFAULT 0,
  ok INTEGER, code INTEGER, ms INTEGER, tls_expires INTEGER, error TEXT, checked INTEGER);
CREATE TABLE IF NOT EXISTS domains (id INTEGER PRIMARY KEY, name TEXT NOT NULL, expires TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync (app TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL, device INTEGER);
CREATE TABLE IF NOT EXISTS sync_history (id INTEGER PRIMARY KEY, app TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL);
`);

function getSetting(key) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : null;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** Стартовое наполнение — один раз, при пустой базе. Всё правится в интерфейсе. */
function seed() {
  if (getSetting('seeded')) return;
  const svc = db.prepare('INSERT INTO services (grp, name, url, sub, color, pos) VALUES (?, ?, ?, ?, ?, ?)');
  [
    ['WAREE', 'Прод CRM', 'https://app.waree.uz', 'app.waree.uz', 'accent'],
    ['WAREE', 'Демо CRM', 'https://waree-crm.uz', 'waree-crm.uz', 'blue'],
    ['WAREE', 'Сайт компании', 'https://waree.uz', 'waree.uz', 'blue'],
    ['Разработка', 'GitHub', 'https://github.com/acidofz', 'acidofz', 'gray'],
    ['Разработка', 'Vercel', 'https://vercel.com/dashboard', 'лендинги и демо', 'gray'],
    ['Разработка', 'Make', 'https://www.make.com', 'лиды Instagram → WAREE', 'purple'],
    ['Работа', 'Notion', 'https://www.notion.so', 'роадмап WAREE', 'gray'],
    ['Работа', 'OnlinePBX', 'https://onlinepbx.ru', 'телефония ANXOR', 'green'],
    ['Работа', 'Instagram', 'https://www.instagram.com/s1lkr00t', '@s1lkr00t', 'pink'],
    ['Работа', 'IT Park', 'https://it-park.uz', 'резидентство', 'green'],
    ['Инфраструктура', 'Airnet', 'https://airnet.uz', 'VPS в Ташкенте', 'blue'],
    ['Инфраструктура', 'aHOST', 'https://ahost.uz', 'домены .uz', 'blue'],
    ['Инфраструктура', 'Пароли', 'https://vault.bitwarden.com', 'Bitwarden', 'accent'],
  ].forEach((s, i) => svc.run(s[0], s[1], s[2], s[3], s[4], i));

  const cmd = db.prepare('INSERT INTO commands (title, cmd, hint, pos) VALUES (?, ?, ?, ?)');
  cmd.run('Туннель в панель владельца', 'ssh -N -L 3000:127.0.0.1:3000 -L 3001:127.0.0.1:3001 ubuntu@IP_СЕРВЕРА',
    'потом открыть localhost:3000/owner.html (прод) или :3001 (демо)', 0);
  cmd.run('Зайти на сервер', 'ssh ubuntu@IP_СЕРВЕРА', '', 1);
  cmd.run('Логи Caddy', 'sudo journalctl -u caddy -f', '', 2);
  cmd.run('Логи центра', 'sudo journalctl -u waree-hub -f', '', 3);

  const host = db.prepare('INSERT INTO hosts (label, url, pos) VALUES (?, ?, ?)');
  host.run('Прод CRM', 'https://app.waree.uz', 0);
  host.run('Демо CRM', 'https://waree-crm.uz', 1);
  host.run('Сайт', 'https://waree.uz', 2);

  setSetting('seeded', '1');
}
seed();

module.exports = { db, getSetting, setSetting, DATA_DIR };
