'use strict';
const { db } = require('./db');

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

function loadApp(app) {
  const r = db.prepare('SELECT data, updated FROM sync WHERE app = ?').get(app);
  if (!r) return null;
  try { return { payload: JSON.parse(r.data), updated: r.updated }; } catch { return null; }
}

/** Сводка Расходника: те же правила, что в приложении. */
function rasxodnik() {
  const a = loadApp('rasxodnik');
  if (!a) return null;
  const D = a.payload.data || a.payload;
  if (!Array.isArray(D.accs) || !Array.isArray(D.tx)) return null;
  const rate = Number(D.rate) || 0;
  const curOf = (id) => (D.accs.find((x) => x.id === id) || { cur: 'UZS' }).cur;
  const toUZS = (n, c) => (c === 'USD' ? n * rate : n);

  const bal = {};
  D.accs.forEach((x) => { bal[x.id] = Number(x.start) || 0; });
  for (const t of D.tx) {
    if (t.t === 'e' && bal[t.acc] != null) bal[t.acc] -= t.amt;
    else if (t.t === 'i' && bal[t.acc] != null) bal[t.acc] += t.amt;
    else if (t.t === 'x') {
      if (bal[t.acc] != null) bal[t.acc] -= t.amt;
      if (bal[t.to] != null) bal[t.to] += t.amt2 != null ? t.amt2 : t.amt;
    }
  }
  const total = D.accs.reduce((s, x) => s + toUZS(bal[x.id], x.cur), 0);

  const now = new Date();
  const month = ym(now);
  let inc = 0, exp = 0;
  for (const t of D.tx) {
    if (!t.date || t.date.slice(0, 7) !== month) continue;
    const v = toUZS(t.amt, curOf(t.acc));
    if (t.t === 'i') inc += v; else if (t.t === 'e') exp += v;
  }

  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const today = now.getDate();
  const rec = (D.rec || []).map((r) => {
    const paid = D.tx.some((t) => t.rec === r.id && t.recM === month);
    const due = Math.min(r.day || 1, dim);
    return { name: r.name, amt: toUZS(r.amt, curOf(r.acc)), day: due, paid, left: due - today };
  }).sort((x, y) => (x.paid - y.paid) || (x.left - y.left));
  const unpaid = rec.filter((r) => !r.paid);

  return {
    updated: a.updated,
    total,
    accounts: D.accs.map((x) => ({ name: x.name, cur: x.cur, balance: bal[x.id] })),
    month: { income: inc, expense: exp },
    recurring: {
      count: rec.length,
      unpaid: unpaid.length,
      late: unpaid.filter((r) => r.left < 0).length,
      left: unpaid.reduce((s, r) => s + r.amt, 0),
      next: unpaid[0] || null,
      items: rec,
    },
  };
}

/** Сводка мандалы: цель, 3 задачи на сегодня, серия дней. */
function mandala() {
  const a = loadApp('mandala');
  if (!a) return null;
  const { S, T, H } = a.payload;
  if (!S || !Array.isArray(S.D)) return null;
  const today = ymd(new Date());
  const items = (T && Array.isArray(T.items) ? T.items : []).map((x, j) => {
    const b = S.D[x[0]];
    return { text: b && b.a ? b.a[x[1]] : '?', block: b ? b.n : '', done: T.date === today ? !!(T.done || [])[j] : false };
  });
  const hist = H || {};
  let streak = 0;
  const c = new Date();
  if ((hist[ymd(c)] || 0) < 3) c.setDate(c.getDate() - 1);
  while ((hist[ymd(c)] || 0) >= 3) { streak++; c.setDate(c.getDate() - 1); }
  return { updated: a.updated, goal: S.goal, items, done: items.filter((i) => i.done).length, streak };
}

module.exports = { rasxodnik, mandala };
