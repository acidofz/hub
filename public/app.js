'use strict';
{
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const COLORS = ['accent', 'blue', 'gray', 'purple', 'green', 'pink', 'gold'];
const sum = (n) => Math.round(n || 0).toLocaleString('ru-RU') + ' сум';
const short = (n) => { const a = Math.abs(n); const s = a >= 1e9 ? (a / 1e9).toFixed(1).replace('.0', '') + ' млрд' : a >= 1e6 ? (a / 1e6).toFixed(1).replace('.0', '') + ' млн' : a >= 1e3 ? Math.round(a / 1e3) + ' тыс' : String(Math.round(a)); return (n < 0 ? '−' : '') + s; };
function ago(ts) {
  if (!ts) return 'никогда';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return m + ' мин назад';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' ч назад';
  return Math.round(h / 24) + ' дн. назад';
}
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 1800); }

async function api(method, url, body) {
  const r = await fetch(url, {
    method, credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json', 'X-Hub': '1' } : { 'X-Hub': '1' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await r.json(); } catch { /* пусто */ }
  if (r.status === 401 && url !== '/api/login') { showLogin(); throw new Error('Нужно войти'); }
  if (!r.ok) throw new Error((data && data.error) || 'Ошибка ' + r.status);
  return data;
}

/* ---------------- вход ---------------- */
function showLogin(msg) { $('app').hidden = true; $('login').hidden = false; if (msg) $('loginMsg').textContent = msg; setTimeout(() => $('lp').focus(), 50); }
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('lbtn').disabled = true;
  try {
    await api('POST', '/api/login', { password: $('lp').value, code: $('lc').value.trim() });
    $('lp').value = ''; $('lc').value = '';
    $('login').hidden = true; boot();
  } catch (err) { $('loginMsg').textContent = err.message; $('lc').value = ''; }
  $('lbtn').disabled = false;
});
$('logout').addEventListener('click', async () => { try { await api('POST', '/api/logout'); } catch { /* всё равно выходим */ } showLogin('Вы вышли'); });

/* ---------------- данные и отрисовка ---------------- */
let S = null, editSvc = false, query = '';

async function load() { S = await api('GET', '/api/dashboard'); render(); }

function render() {
  const d = new Date();
  $('today').textContent = `WAREE Software · ${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`;
  renderMandala(); renderMoney(); renderHosts(); renderServices(); renderNotes(); renderCommands();
}

function renderMandala() {
  const m = S.mandala, el = $('cMandala');
  if (!m) { el.innerHTML = `<span class="lbl">Сегодня · мандала</span><p class="empty">Нет данных. Открой мандалу на телефоне → Настройки → Синхронизация и вставь ключ устройства.</p>`; return; }
  el.innerHTML = `<div class="lh"><span class="lbl">Сегодня · мандала</span><span class="sm mut">${m.done} из ${m.items.length || 3}</span></div>` +
    (m.items.length ? m.items.map((t) => `<div class="task${t.done ? ' done' : ''}"><i></i><span>${esc(t.text)}<em>${esc(t.block)}</em></span></div>`).join('')
      : `<p class="empty">На сегодня задачи не выбраны</p>`) +
    `<div class="foot"><span class="mut">Серия: ${m.streak} дн.</span><span class="mut">обновлено ${ago(m.updated)}</span></div>`;
}

function renderMoney() {
  const r = S.rasxodnik, el = $('cMoney');
  if (!r) { el.innerHTML = `<span class="lbl">Расходник</span><p class="empty">Нет данных. Открой Расходник → Настройки → Синхронизация и вставь ключ устройства.</p>`; return; }
  const rc = r.recurring;
  let warn = '';
  if (rc.count) {
    if (!rc.unpaid) warn = `<div class="warn ok"><span class="dot ok"></span><span>Все обязательные оплачены</span></div>`;
    else {
      const n = rc.next, when = n.left < 0 ? `просрочен на ${-n.left} дн.` : n.left === 0 ? 'сегодня' : n.left === 1 ? 'завтра' : `через ${n.left} дн.`;
      warn = `<div class="warn${rc.late ? ' bad' : ''}"><span class="dot ${rc.late ? 'bad' : 'dw'}"></span><span>Обязательные: осталось ${rc.unpaid} · ${short(rc.left)}. Ближайший «${esc(n.name)}» ${when}</span></div>`;
    }
  }
  el.innerHTML = `<span class="lbl">Расходник</span><div class="big num">${sum(r.total)}</div><div class="sm mut">всего на счетах · за месяц +${short(r.month.income)} / −${short(r.month.expense)}</div>${warn}<div class="foot"><span class="mut">обновлено ${ago(r.updated)}</span></div>`;
}

function renderHosts() {
  const el = $('cHosts');
  const rows = S.hosts.map((h) => {
    const st = h.checked == null ? '' : h.ok ? 'ok' : 'bad';
    const days = h.tls_expires ? Math.floor((h.tls_expires - Date.now()) / 864e5) : null;
    const right = !h.ok && h.checked ? `<span class="sm bad">${esc(h.error || 'код ' + h.code)}</span>` : days != null ? `<span class="sm ${days < 14 ? 'gold' : 'mut'}">SSL ${days} дн.</span>` : `<span class="sm mut">${h.checked ? h.ms + ' мс' : 'проверка…'}</span>`;
    return `<div class="hrow"><span class="dot ${st}"></span><span>${esc(h.label)} <span class="mut">${esc(new URL(h.url).host)}</span></span>${right}</div>`;
  });
  const doms = S.domains.map((d) => `<div class="hrow"><span class="dot ${d.days < 30 ? (d.days < 7 ? 'bad' : 'dw') : 'ok'}"></span><span>Домен ${esc(d.name)}</span><span class="sm ${d.days < 30 ? 'gold' : 'mut'}">${d.days < 0 ? 'истёк' : d.days + ' дн.'}</span></div>`);
  const last = Math.max(0, ...S.hosts.map((h) => h.checked || 0));
  el.innerHTML = `<div class="lh"><span class="lbl">Серверы</span><button class="btn" id="checkNow">Проверить</button></div>${rows.join('') || '<p class="empty">Добавь адреса в настройках</p>'}${doms.join('')}<div class="foot"><span class="mut">проверено ${ago(last)}</span></div>`;
  $('checkNow').addEventListener('click', async (e) => { e.target.disabled = true; try { await api('POST', '/api/hosts/check'); await load(); toast('Проверено'); } catch (err) { toast(err.message); } });
}

const match = (...xs) => !query || xs.join(' ').toLowerCase().includes(query);

function renderServices() {
  const groups = {};
  S.services.filter((s) => match(s.name, s.sub, s.grp, s.url)).forEach((s) => (groups[s.grp] = groups[s.grp] || []).push(s));
  const el = $('services');
  el.classList.toggle('editing', editSvc);
  $('editSvc').classList.toggle('on', editSvc); $('editSvc').textContent = editSvc ? 'Готово' : 'Править';
  el.innerHTML = Object.keys(groups).map((g) => `<div class="group"><span class="lbl">${esc(g)}</span>${groups[g].map((s) =>
    `<a class="tile" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" data-svc="${s.id}"><span class="mono c-${esc(s.color)}">${esc((s.name[0] || '?').toUpperCase())}</span><span class="t"><b>${esc(s.name)}</b><small>${esc(s.sub || new URL(s.url).host)}</small></span><span class="ib ed" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></span></a>`).join('')}</div>`).join('') ||
    `<p class="empty">${query ? 'Ничего не найдено' : 'Пока пусто'}</p>`;
}
$('services').addEventListener('click', (e) => {
  const t = e.target.closest('[data-svc]'); if (!t || !editSvc) return;
  e.preventDefault(); svcForm(S.services.find((s) => s.id === +t.dataset.svc));
});
$('editSvc').addEventListener('click', () => { editSvc = !editSvc; renderServices(); });
$('addSvc').addEventListener('click', () => svcForm());

function renderNotes() {
  const list = S.notes.filter((n) => match(n.title, n.body));
  $('notes').innerHTML = list.map((n) => {
    const d = new Date(n.updated), when = new Date().toDateString() === d.toDateString() ? 'сегодня' : `${d.getDate()} ${MON[d.getMonth()]}`;
    return `<button class="note" data-note="${n.id}"><span class="lh"><b>${esc(n.title || 'Без названия')}</b><span class="pin">${n.pinned ? 'закреплено' : `<span class="mut">${when}</span>`}</span></span><p>${esc(n.body)}</p></button>`;
  }).join('') || `<p class="empty">${query ? 'Ничего не найдено' : 'Заметок пока нет'}</p>`;
}
$('notes').addEventListener('click', (e) => { const t = e.target.closest('[data-note]'); if (t) noteForm(S.notes.find((n) => n.id === +t.dataset.note)); });
$('addNote').addEventListener('click', () => noteForm());

function renderCommands() {
  const list = S.commands.filter((c) => match(c.title, c.cmd, c.hint));
  $('commands').innerHTML = list.map((c) => `<div class="cmd"><div class="ct"><span>${esc(c.title)}</span><button data-ce="${c.id}">изменить</button></div><div class="cl"><code>${esc(c.cmd)}</code><button class="ib" data-copy="${c.id}" aria-label="Копировать: ${esc(c.title)}"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button></div>${c.hint ? `<div class="hint">${esc(c.hint)}</div>` : ''}</div>`).join('') ||
    `<p class="empty">${query ? 'Ничего не найдено' : 'Команд пока нет'}</p>`;
}
$('commands').addEventListener('click', async (e) => {
  const cp = e.target.closest('[data-copy]'), ed = e.target.closest('[data-ce]');
  if (cp) {
    const c = S.commands.find((x) => x.id === +cp.dataset.copy);
    try { await navigator.clipboard.writeText(c.cmd); toast('Скопировано'); } catch { toast('Не удалось скопировать'); }
  }
  if (ed) cmdForm(S.commands.find((x) => x.id === +ed.dataset.ce));
});
$('addCmd').addEventListener('click', () => cmdForm());

/* ---------------- поиск ---------------- */
$('q').addEventListener('input', (e) => {
  query = e.target.value.trim().toLowerCase();
  document.body.classList.toggle('searching', !!query);
  renderServices(); renderNotes(); renderCommands();
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('q').focus(); $('q').select(); }
  if (e.key === 'Escape' && !$('modal').hidden) closeModal();
});

/* ---------------- вкладки на телефоне ---------------- */
function tab(t) {
  document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('show', x.dataset.tab === t));
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
  scrollTo(0, 0);
}
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) tab(b.dataset.t); });
tab('home');

/* ---------------- модальные формы ---------------- */
let lastFocus = null;
function openModal(title, html, onReady) {
  lastFocus = document.activeElement;
  $('mTitle').textContent = title; $('mBody').innerHTML = html; $('modal').hidden = false;
  onReady && onReady();
  const f = $('mBody').querySelector('input,textarea,button'); f && f.focus();
}
function closeModal() { $('modal').hidden = true; $('mBody').innerHTML = ''; lastFocus && lastFocus.focus && lastFocus.focus(); }
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
function armDel(btn, fn) {
  if (btn.dataset.arm) { fn(); return; }
  btn.dataset.arm = 1; btn.textContent = 'Точно удалить?';
  setTimeout(() => { delete btn.dataset.arm; btn.textContent = 'Удалить'; }, 3000);
}
async function save(fn, msg) { try { await fn(); closeModal(); await load(); toast(msg); } catch (err) { toast(err.message); } }

function svcForm(s) {
  const groups = [...new Set(S.services.map((x) => x.grp))];
  let color = s ? s.color : 'blue';
  openModal(s ? 'Сервис' : 'Новый сервис', `<form class="form" id="f">
    <label>Название<input id="fn" maxlength="60" required value="${esc(s?.name)}"></label>
    <label>Ссылка<input id="fu" type="url" required placeholder="https://" value="${esc(s?.url)}"></label>
    <label>Подпись<input id="fs" maxlength="80" placeholder="например, роадмап WAREE" value="${esc(s?.sub)}"></label>
    <label>Группа<input id="fg" list="grps" maxlength="40" value="${esc(s?.grp || groups[0] || 'WAREE')}"><datalist id="grps">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist></label>
    <label>Цвет<div class="swatches" id="sw">${COLORS.map((c) => `<button type="button" class="c-${c}${c === color ? ' on' : ''}" data-c="${c}" aria-label="${c}"></button>`).join('')}</div></label>
    <div class="acts">${s ? '<button type="button" class="btn del" id="fd">Удалить</button><span class="sp"></span>' : ''}<button type="button" class="btn" id="fx">Отмена</button><button class="btn pri">Сохранить</button></div></form>`, () => {
    $('sw').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (!b) return; color = b.dataset.c; document.querySelectorAll('#sw button').forEach((x) => x.classList.toggle('on', x === b)); });
    $('fx').addEventListener('click', closeModal);
    if (s) $('fd').addEventListener('click', (e) => armDel(e.target, () => save(() => api('DELETE', '/api/services/' + s.id), 'Удалено')));
    $('f').addEventListener('submit', (e) => { e.preventDefault(); const body = { name: $('fn').value, url: $('fu').value, sub: $('fs').value, grp: $('fg').value, color }; save(() => s ? api('PUT', '/api/services/' + s.id, body) : api('POST', '/api/services', body), 'Сохранено'); });
  });
}

function noteForm(n) {
  openModal(n ? 'Заметка' : 'Новая заметка', `<form class="form" id="f">
    <input id="nt" maxlength="120" placeholder="Заголовок" value="${esc(n?.title)}" aria-label="Заголовок">
    <textarea id="nb" placeholder="Текст заметки" aria-label="Текст">${esc(n?.body)}</textarea>
    <label class="chk"><input type="checkbox" id="np"${n?.pinned ? ' checked' : ''}>Закрепить сверху</label>
    <div class="acts">${n ? '<button type="button" class="btn del" id="fd">Удалить</button><span class="sp"></span>' : ''}<button type="button" class="btn" id="fx">Отмена</button><button class="btn pri">Сохранить</button></div></form>`, () => {
    $('fx').addEventListener('click', closeModal);
    if (n) $('fd').addEventListener('click', (e) => armDel(e.target, () => save(() => api('DELETE', '/api/notes/' + n.id), 'Удалено')));
    $('f').addEventListener('submit', (e) => {
      e.preventDefault();
      const body = { title: $('nt').value, body: $('nb').value, pinned: $('np').checked };
      if (!body.title.trim() && !body.body.trim()) { toast('Пустая заметка'); return; }
      save(() => n ? api('PUT', '/api/notes/' + n.id, body) : api('POST', '/api/notes', body), 'Сохранено');
    });
  });
}

function cmdForm(c) {
  openModal(c ? 'Команда' : 'Новая команда', `<form class="form" id="f">
    <label>Название<input id="ct" maxlength="80" required value="${esc(c?.title)}"></label>
    <label>Команда<textarea id="cc" required spellcheck="false">${esc(c?.cmd)}</textarea></label>
    <label>Подсказка<input id="ch" maxlength="200" value="${esc(c?.hint)}"></label>
    <div class="acts">${c ? '<button type="button" class="btn del" id="fd">Удалить</button><span class="sp"></span>' : ''}<button type="button" class="btn" id="fx">Отмена</button><button class="btn pri">Сохранить</button></div></form>`, () => {
    $('cc').style.minHeight = '90px';
    $('fx').addEventListener('click', closeModal);
    if (c) $('fd').addEventListener('click', (e) => armDel(e.target, () => save(() => api('DELETE', '/api/commands/' + c.id), 'Удалено')));
    $('f').addEventListener('submit', (e) => { e.preventDefault(); const body = { title: $('ct').value, cmd: $('cc').value, hint: $('ch').value }; save(() => c ? api('PUT', '/api/commands/' + c.id, body) : api('POST', '/api/commands', body), 'Сохранено'); });
  });
}

/* ---------------- настройки ---------------- */
$('openSettings').addEventListener('click', settings);
async function settings() {
  let dev;
  try { dev = await api('GET', '/api/devices'); } catch (err) { toast(err.message); return; }
  const syncOf = (a) => dev.sync.find((x) => x.app === a);
  const histOf = (a) => dev.history.find((x) => x.app === a);
  const appRow = (a, name) => {
    const s = syncOf(a), h = histOf(a);
    return `<div class="li"><span class="t">${name}<small>${s ? 'синхронизировано ' + ago(s.updated) : 'ещё не синхронизировано'}${h ? ' · копий в истории: ' + h.n : ''}</small></span>${s ? `<a class="btn" href="/api/backup/${a}" download>Скачать</a>` : ''}</div>`;
  };
  openModal('Настройки', `
    <div class="sec">Ключи синхронизации</div>
    <p class="sm mut">Ключ вставляется в Расходник и мандалу: Настройки → Синхронизация. Один ключ на телефон, его можно отозвать.</p>
    <div id="newKey"></div>
    <div class="inl"><input id="kn" placeholder="Название, например «Мой телефон»" maxlength="60" aria-label="Название устройства"><button class="btn pri" id="kc">Создать ключ</button></div>
    <div class="list">${dev.devices.map((d) => `<div class="li"><span class="t">${esc(d.name)}<small>${d.revoked ? 'отозван' : 'был в сети ' + ago(d.last_seen)}</small></span>${d.revoked ? '' : `<button class="btn del" data-rv="${d.id}">Отозвать</button>`}</div>`).join('')}</div>

    <div class="sec">Данные приложений</div>
    <div class="list">${appRow('rasxodnik', 'Расходник')}${appRow('mandala', 'Мандала')}</div>

    <div class="sec">Проверка серверов</div>
    <div class="list">${S.hosts.map((h) => `<div class="li"><span class="t">${esc(h.label)}<small>${esc(h.url)}</small></span><button class="btn del" data-hd="${h.id}">Убрать</button></div>`).join('')}</div>
    <div class="inl"><input id="hl" placeholder="Название" maxlength="60" aria-label="Название сервера"><input id="hu" type="url" placeholder="https://" aria-label="Адрес"><button class="btn" id="ha">Добавить</button></div>

    <div class="sec">Сроки доменов</div>
    <div class="list">${S.domains.map((d) => `<div class="li"><span class="t">${esc(d.name)}<small>до ${esc(d.expires)}</small></span><button class="btn del" data-dd="${d.id}">Убрать</button></div>`).join('')}</div>
    <div class="inl"><input id="dn" placeholder="waree.uz" aria-label="Домен"><input id="de" type="date" aria-label="Дата окончания"><button class="btn" id="da">Добавить</button></div>

    <div class="acts"><button class="btn" id="fx">Закрыть</button></div>`, () => {
    $('fx').addEventListener('click', closeModal);
    $('kc').addEventListener('click', async () => {
      try {
        const r = await api('POST', '/api/devices', { name: $('kn').value || 'Телефон' });
        $('newKey').innerHTML = `<p class="sm gold"></p>`;
        $('newKey').firstChild.textContent = 'Скопируй ключ сейчас — больше он не покажется:';
        const box = document.createElement('div'); box.className = 'keybox'; box.textContent = r.token; $('newKey').appendChild(box);
        const b = document.createElement('button'); b.className = 'btn pri'; b.textContent = 'Копировать ключ';
        b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(r.token); toast('Ключ скопирован'); } catch { toast('Выдели и скопируй вручную'); } });
        $('newKey').appendChild(b);
      } catch (err) { toast(err.message); }
    });
    $('mBody').addEventListener('click', async (e) => {
      const rv = e.target.closest('[data-rv]'), hd = e.target.closest('[data-hd]'), dd = e.target.closest('[data-dd]');
      try {
        if (rv) { await api('DELETE', '/api/devices/' + rv.dataset.rv); toast('Ключ отозван'); closeModal(); settings(); }
        if (hd) { await api('DELETE', '/api/hosts/' + hd.dataset.hd); await load(); closeModal(); settings(); }
        if (dd) { await api('DELETE', '/api/domains/' + dd.dataset.dd); await load(); closeModal(); settings(); }
      } catch (err) { toast(err.message); }
    });
    $('ha').addEventListener('click', async () => { try { await api('POST', '/api/hosts', { label: $('hl').value, url: $('hu').value }); await load(); closeModal(); settings(); } catch (err) { toast(err.message); } });
    $('da').addEventListener('click', async () => { try { await api('POST', '/api/domains', { name: $('dn').value, expires: $('de').value }); await load(); closeModal(); settings(); } catch (err) { toast(err.message); } });
  });
}

/* ---------------- старт ---------------- */
async function boot() {
  try {
    await api('GET', '/api/me');
    $('login').hidden = true; $('app').hidden = false;
    await load();
  } catch (err) {
    if (err.message !== 'Нужно войти') showLogin(err.message);
  }
}
setInterval(() => { if (!$('app').hidden && document.visibilityState === 'visible') load().catch(() => {}); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !$('app').hidden) load().catch(() => {}); });
boot();
}
