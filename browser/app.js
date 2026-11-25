// ⬛ BLACK — лёгкий чёрный браузер. Чистый JS, ноль зависимостей.
// Вес всего приложения ~40 КБ. По умолчанию — ноль внешних запросов,
// кроме самой страницы, которую открывает пользователь.

import { createAssistant } from './ai.js';

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LS = {
  get(k, d){ try { const v = localStorage.getItem('black.' + k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem('black.' + k, JSON.stringify(v)); } catch(e){} },
};

const ENGINES = {
  yandex: { name: 'Яндекс',       url: q => 'https://yandex.ru/search/?text=' + encodeURIComponent(q) },
  ddg:    { name: 'DuckDuckGo',   url: q => 'https://duckduckgo.com/?q=' + encodeURIComponent(q) },
  bing:   { name: 'Bing',         url: q => 'https://www.bing.com/search?q=' + encodeURIComponent(q) },
  google: { name: 'Google',       url: q => 'https://www.google.com/search?q=' + encodeURIComponent(q) },
  wiki:   { name: 'Википедия RU', url: q => 'https://ru.wikipedia.org/w/index.php?search=' + encodeURIComponent(q) },
};
const QUICK = [
  { n:'Википедия', u:'https://ru.wikipedia.org', d:'статьи на русском' },
  { n:'MDN', u:'https://developer.mozilla.org', d:'документация по вебу' },
  { n:'Hacker News', u:'https://news.ycombinator.com', d:'новости IT' },
  { n:'OpenStreetMap', u:'https://openstreetmap.org', d:'карты мира' },
  { n:'Яндекс', u:'https://yandex.ru', d:'поиск и сервисы' },
  { n:'Example', u:'https://example.com', d:'тестовая страница' },
];

let settings = Object.assign(
  { engine:'yandex', aiKey:'', aiEndpoint:'https://api.openai.com/v1/chat/completions', aiModel:'gpt-4o-mini' },
  LS.get('settings', {}));
let bookmarks = LS.get('bookmarks', []);
let historyLog = LS.get('history', []);

// ---------- вкладки ----------
let seq = 0;
const tabs = [];
let activeId = null;
const activeTab = () => tabs.find(t => t.id === activeId) || tabs[0];

function hostname(u){ try { return new URL(u).hostname.replace(/^www\./,''); } catch(e){ return u; } }

function createTab(url){
  const id = ++seq;
  const tab = { id, url:'', title:'Новая вкладка', kind:'internal', hist:[], hi:-1, hintOff:false };
  const page = document.createElement('div');
  page.className = 'page'; page.dataset.id = id;
  const iframe = document.createElement('iframe');
  iframe.title = 'Страница';
  iframe.setAttribute('allow', 'fullscreen; clipboard-write; autoplay');
  const internal = document.createElement('div');
  internal.className = 'internal';
  page.append(iframe, internal);
  $('#pages').appendChild(page);
  Object.assign(tab, { page, iframe, internal });
  iframe.addEventListener('load', () => onLoad(tab));
  tabs.push(tab);
  activate(id);
  navigate(tab, url || 'browser://start');
  return tab;
}

function closeTab(id){
  const i = tabs.findIndex(t => t.id === id);
  if(i < 0) return;
  const [tab] = tabs.splice(i, 1);
  tab.page.remove();
  if(activeId === id){
    if(tabs.length) activate(tabs[Math.min(i, tabs.length-1)].id);
    else createTab('browser://start');
  } else renderTabs();
}

function activate(id){
  activeId = id;
  for(const t of tabs) t.page.classList.toggle('active', t.id === id);
  renderTabs(); syncChrome();
}

function renderTabs(){
  const bar = $('#tabs');
  bar.textContent = '';
  for(const t of tabs){
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === activeId ? ' active' : '');
    el.setAttribute('role','tab');
    const fav = document.createElement('span'); fav.className = 'fav';
    fav.textContent = favLetter(t);
    const title = document.createElement('span'); title.className = 't'; title.textContent = t.title;
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.title = 'Закрыть вкладку';
    x.addEventListener('click', e => { e.stopPropagation(); closeTab(t.id); });
    el.append(fav, title, x);
    el.addEventListener('click', () => activate(t.id));
    bar.appendChild(el);
  }
}

function favLetter(t){
  if(t.kind === 'internal'){
    const p = t.url.replace('browser://','');
    return ({ start:'⌂', history:'🕘', bookmarks:'★', settings:'⚙', help:'?' })[p] || '●';
  }
  const h = hostname(t.url);
  return (h[0] || '●').toUpperCase();
}

// ---------- навигация ----------
function resolve(raw){
  raw = (raw || '').trim();
  if(!raw) return 'browser://start';
  if(/^browser:\/\//i.test(raw)) return raw.toLowerCase();
  if(/^https?:\/\//i.test(raw)) return raw;
  if(/^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(raw)) return 'http://' + raw;
  if(/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw) && !/\s/.test(raw)) return 'https://' + raw;
  return ENGINES[settings.engine].url(raw);
}

function navigate(tab, raw){
  const url = resolve(raw);
  tab.url = url;
  if(url.startsWith('browser://')){
    tab.kind = 'internal';
    tab.iframe.style.display = 'none';
    tab.internal.style.display = '';
    renderInternal(tab, url);
    tab.title = (INTERNAL[url] && INTERNAL[url].title) || url;
    pushHist(tab, url);
  } else {
    tab.kind = 'web';
    tab.internal.style.display = 'none';
    tab.iframe.style.display = '';
    tab.title = hostname(url);
    showProgress(true);
    tab.iframe.src = url;
  }
  renderTabs();
  if(tab.id === activeId) syncChrome();
}

function onLoad(tab){
  showProgress(false);
  let u = tab.url;
  try { u = tab.iframe.contentWindow.location.href || u; } catch(e){ /* cross-origin */ }
  try { const t = tab.iframe.contentDocument && tab.iframe.contentDocument.title; if(t) tab.title = t; } catch(e){}
  if(u && u !== 'about:blank'){
    tab.url = u;
    pushHist(tab, u);
    logHistory(u, tab.title);
  }
  renderTabs();
  if(tab.id === activeId) syncChrome();
}

function pushHist(tab, url){
  if(tab.hist[tab.hi] === url) return;
  tab.hist.length = tab.hi + 1;
  tab.hist.push(url);
  tab.hi = tab.hist.length - 1;
}

function go(tab, d){
  const ni = tab.hi + d;
  if(ni < 0 || ni >= tab.hist.length) return;
  tab.hi = ni;
  navigate(tab, tab.hist[ni]);
}

function logHistory(url, title){
  if(url.startsWith('browser://')) return;
  historyLog = historyLog.filter(h => h.url !== url);
  historyLog.unshift({ url, title: title || hostname(url), ts: Date.now() });
  if(historyLog.length > 300) historyLog.length = 300;
  LS.set('history', historyLog);
}

// ---------- хром (адресная строка и т.д.) ----------
function syncChrome(){
  const tab = activeTab();
  if(!tab) return;
  const input = $('#url');
  if(document.activeElement !== input) input.value = tab.url;
  $('#back').disabled = tab.hi <= 0;
  $('#fwd').disabled = tab.hi >= tab.hist.length - 1;
  const sch = $('#scheme');
  if(tab.kind === 'internal'){ sch.textContent = '◐'; sch.className = ''; }
  else if(tab.url.startsWith('https://')){ sch.textContent = '●'; sch.className = 'ok'; }
  else { sch.textContent = '●'; sch.className = 'warn'; }
  $('#star').textContent = bookmarks.some(b => b.url === tab.url) ? '★' : '☆';
  $('#hint').hidden = !(tab.kind === 'web' && !tab.hintOff);
  document.title = tab.title + ' — BLACK';
}

let progTimer = null;
function showProgress(on){
  $('#progress').hidden = !on;
  clearTimeout(progTimer);
  if(on) progTimer = setTimeout(() => { $('#progress').hidden = true; }, 20000);
}

// ---------- внутренние страницы ----------
const INTERNAL = {
  'browser://start':     { title:'Стартовая',  render: renderStart },
  'browser://history':   { title:'История',    render: renderHistory },
  'browser://bookmarks': { title:'Закладки',   render: renderBookmarks },
  'browser://settings':  { title:'Настройки',  render: renderSettings },
  'browser://help':      { title:'Справка',    render: renderHelp },
};

function renderInternal(tab, url){
  const page = INTERNAL[url];
  tab.internal.innerHTML = page ? page.render(tab) : `<div class="wrap"><h1>Не найдено</h1><p class="sub">Такой внутренней страницы нет. Доступны: start, history, bookmarks, settings, help.</p></div>`;
  wireInternal(tab, url);
}

function rowHTML(title, url, time, del){
  return `<div class="row"><div class="main"><b>${esc(title)}</b><small>${esc(url)}</small></div>` +
    (time ? `<span class="time">${time}</span>` : '') +
    `<button class="del" data-del="${esc(url)}" title="Удалить">✕</button></div>`;
}

function renderStart(){
  const now = new Date();
  const recent = historyLog.slice(0, 8);
  const bms = bookmarks.slice(0, 8);
  return `<div class="wrap">
    <div class="clock" id="clock">${now.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</div>
    <div class="date">${now.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'})}</div>
    <form class="searchbox" id="startSearch">
      <input id="startQ" placeholder="Поиск или адрес…" autocomplete="off">
      <button type="submit">Найти</button>
    </form>
    <h2>Быстрый доступ</h2>
    <div class="grid">${QUICK.map(q => `<button class="card" data-open="${q.u}"><b>${q.n}</b><small>${q.d}</small></button>`).join('')}</div>
    ${bms.length ? `<h2>Закладки</h2><div>${bms.map(b => rowHTML(b.title, b.url, '', 1)).join('')}</div>` : ''}
    ${recent.length ? `<h2>Недавнее</h2><div>${recent.map(h => rowHTML(h.title, h.url, new Date(h.ts).toLocaleDateString('ru-RU'), 1)).join('')}</div>` : ''}
  </div>`;
}

function renderHistory(){
  const items = historyLog.slice(0, 100);
  return `<div class="wrap"><h1>История</h1><p class="sub">Последние ${historyLog.length} посещений. Хранится только в этом браузере.</p>
    <p><button class="btn danger" id="clearHist">Очистить историю</button></p>
    ${items.length ? items.map(h => rowHTML(h.title, h.url, new Date(h.ts).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}), 1)).join('')
      : '<div class="empty">Пока пусто. Посети любой сайт — он появится здесь.</div>'}
  </div>`;
}

function renderBookmarks(){
  return `<div class="wrap"><h1>Закладки</h1><p class="sub">Добавляй кнопкой ☆ в адресной строке.</p>
    ${bookmarks.length ? bookmarks.map(b => rowHTML(b.title, b.url, '', 1)).join('')
      : '<div class="empty">Закладок пока нет.</div>'}
  </div>`;
}

function renderSettings(){
  const opts = Object.entries(ENGINES).map(([k,v]) =>
    `<option value="${k}"${settings.engine===k?' selected':''}>${v.name}</option>`).join('');
  return `<div class="wrap"><h1>Настройки</h1><p class="sub">Всё хранится локально (localStorage), никуда не отправляется.</p>
    <div class="field"><label>Поисковая система</label><select id="setEngine">${opts}</select></div>
    <h2>✦ ИИ-помощник НОЧЬ</h2>
    <p class="note">По умолчанию помощник работает полностью офлайн (правила + мини-база знаний) и не ест трафик.
    Чтобы подключить настоящий нейросетевой ИИ, вставь API-ключ OpenAI-совместимого сервиса:</p>
    <div class="field"><label>API-ключ (пусто = офлайн-режим)</label><input id="setKey" type="password" value="${esc(settings.aiKey)}" placeholder="sk-…"></div>
    <div class="field"><label>Эндпоинт API</label><input id="setEndpoint" value="${esc(settings.aiEndpoint)}"></div>
    <div class="field"><label>Модель</label><input id="setModel" value="${esc(settings.aiModel)}"></div>
    <h2>Данные</h2>
    <p><button class="btn danger" id="wipeHist">Очистить историю</button>
       <button class="btn danger" id="wipeBm">Очистить закладки</button>
       <button class="btn danger" id="wipeAll">Сбросить всё</button></p>
    <p class="note">⬛ BLACK · версия 1.0 · весь код ~40 КБ · ноль зависимостей · работает офлайн (кроме самих сайтов).</p>
  </div>`;
}

function renderHelp(){
  return `<div class="wrap"><h1>Справка</h1>
    <h2>Горячие клавиши</h2>
    <table class="keys">
      <tr><td><kbd>Ctrl</kbd>+<kbd>T</kbd></td><td>Новая вкладка</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>W</kbd></td><td>Закрыть вкладку</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>L</kbd></td><td>Фокус на адресную строку</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>K</kbd></td><td>ИИ-помощник НОЧЬ</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>R</kbd></td><td>Обновить страницу</td></tr>
      <tr><td><kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd></td><td>Назад / вперёд</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>Перейти по адресу или выполнить поиск</td></tr>
    </table>
    <h2>Про сайты, которые не открываются</h2>
    <p class="note">Многие сайты (Google, GitHub, соцсети) запрещают встраивание в чужие страницы —
    это защита от фишинга. Для них BLACK показывает кнопку «↗ Открыть внешне» — страница откроется
    в обычной новой вкладке браузера. Сайты без такой защиты (Википедия, MDN, Hacker News и др.)
    открываются прямо внутри BLACK.</p>
    <h2>Про ИИ-помощника</h2>
    <p class="note">НОЧЬ — локальный помощник: калькулятор, поиск, объяснение простых понятий,
    мини-переводчик, резюме страниц и память заметок. Ноль сети и ноль веса.
    Для полноценного нейросетевого чата вставь API-ключ на странице browser://settings.</p>
  </div>`;
}

function wireInternal(tab, url){
  const root = tab.internal;
  const open = u => navigate(tab, u);
  $$('[data-open]', root).forEach(b => b.addEventListener('click', () => open(b.dataset.open)));
  $$('.row', root).forEach(r => {
    const del = $('[data-del]', r);
    r.addEventListener('click', e => { if(e.target !== del) open(del.dataset.del); });
    del.addEventListener('click', e => {
      e.stopPropagation();
      const u = del.dataset.del;
      bookmarks = bookmarks.filter(b => b.url !== u);
      historyLog = historyLog.filter(h => h.url !== u);
      LS.set('bookmarks', bookmarks); LS.set('history', historyLog);
      renderBookmarksBar(); renderInternal(tab, url); syncChrome();
    });
  });
  const form = $('#startSearch', root);
  if(form) form.addEventListener('submit', e => { e.preventDefault(); open($('#startQ', root).value); });
  const ch = $('#clearHist', root);
  if(ch) ch.addEventListener('click', () => { historyLog = []; LS.set('history', historyLog); renderInternal(tab, url); });
  const sel = $('#setEngine', root);
  if(sel) sel.addEventListener('change', () => { settings.engine = sel.value; LS.set('settings', settings); });
  for(const [id, key] of [['#setKey','aiKey'], ['#setEndpoint','aiEndpoint'], ['#setModel','aiModel']]){
    const el = $(id, root);
    if(el) el.addEventListener('change', () => { settings[key] = el.value.trim(); LS.set('settings', settings); });
  }
  const wh = $('#wipeHist', root);
  if(wh) wh.addEventListener('click', () => { historyLog = []; LS.set('history', historyLog); });
  const wb = $('#wipeBm', root);
  if(wb) wb.addEventListener('click', () => { bookmarks = []; LS.set('bookmarks', bookmarks); renderBookmarksBar(); syncChrome(); });
  const wa = $('#wipeAll', root);
  if(wa) wa.addEventListener('click', () => {
    historyLog = []; bookmarks = []; LS.set('history', historyLog); LS.set('bookmarks', bookmarks);
    renderBookmarksBar(); renderInternal(tab, url); syncChrome();
  });
}

// ---------- панель закладок ----------
function renderBookmarksBar(){
  const bar = $('#bmarks');
  bar.textContent = '';
  bar.hidden = !bookmarks.length;
  for(const b of bookmarks){
    const el = document.createElement('span'); el.className = 'bm';
    const name = document.createElement('span'); name.textContent = b.title || hostname(b.url);
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.title = 'Убрать из закладок';
    el.append(name, x);
    el.addEventListener('click', () => navigate(activeTab(), b.url));
    x.addEventListener('click', e => {
      e.stopPropagation();
      bookmarks = bookmarks.filter(v => v.url !== b.url);
      LS.set('bookmarks', bookmarks); renderBookmarksBar(); syncChrome();
    });
    bar.appendChild(el);
  }
}

// ---------- подсказки адресной строки ----------
let sugTimer = null;
function updateSuggest(){
  const q = $('#url').value.trim().toLowerCase();
  const dl = $('#suggest');
  dl.textContent = '';
  if(!q) return;
  const seen = new Set();
  const add = (url, title) => {
    if(seen.has(url) || seen.size >= 30) return;
    seen.add(url);
    const o = document.createElement('option');
    o.value = url; o.label = title || '';
    dl.appendChild(o);
  };
  for(const b of bookmarks) if(b.url.toLowerCase().includes(q) || (b.title||'').toLowerCase().includes(q)) add(b.url, b.title);
  for(const h of historyLog) if(h.url.toLowerCase().includes(q) || (h.title||'').toLowerCase().includes(q)) add(h.url, h.title);
}

// ---------- ИИ-помощник ----------
const assistant = createAssistant();
let aiOpened = false;

function toggleAI(force){
  const panel = $('#ai');
  const show = force !== undefined ? force : panel.hidden;
  panel.hidden = !show;
  $('#aiBtn').classList.toggle('on', show);
  if(show){
    $('#aiInput').focus();
    if(!aiOpened){
      aiOpened = true;
      typeMsg('ai', 'Привет! Я НОЧЬ — помощник BLACK. Работаю локально и не ем трафик. Напиши «что ты умеешь», и я покажу.');
    }
  }
}

function addMsg(role, text){
  const log = $('#aiLog');
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  const who = document.createElement('span'); who.className = 'who';
  who.textContent = role === 'user' ? 'ТЫ' : '✦ НОЧЬ';
  const body = document.createElement('span');
  el.append(who, body);
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return body;
}

function typeMsg(role, text){
  const body = addMsg(role, text);
  if(role !== 'ai'){ body.textContent = text; return; }
  let i = 0;
  const step = () => {
    i = Math.min(text.length, i + 3);
    body.textContent = text.slice(0, i);
    $('#aiLog').scrollTop = $('#aiLog').scrollHeight;
    if(i < text.length) setTimeout(step, 10);
  };
  step();
}

function getPageText(){
  const tab = activeTab();
  if(!tab) return null;
  if(tab.kind === 'internal') return tab.internal.innerText || '';
  try { return tab.iframe.contentDocument.body.innerText || ''; }
  catch(e){ return null; } // cross-origin: браузер не даёт читать чужую страницу
}

async function aiSend(text){
  text = (text || '').trim();
  if(!text) return;
  typeMsg('user', text);
  const ctx = { url: activeTab().url, title: activeTab().title, pageText: getPageText };
  const res = await assistant.reply(text, ctx, settings);
  if(res.action){
    const a = res.action;
    if(a.type === 'open') navigate(activeTab(), a.url);
    else if(a.type === 'search') navigate(activeTab(), ENGINES[settings.engine].url(a.q));
  }
  typeMsg('ai', res.text);
}

// ---------- события хрома ----------
function bind(){
  $('#newTab').addEventListener('click', () => createTab('browser://start'));
  $('#back').addEventListener('click', () => go(activeTab(), -1));
  $('#fwd').addEventListener('click', () => go(activeTab(), 1));
  $('#home').addEventListener('click', () => navigate(activeTab(), 'browser://start'));
  $('#reload').addEventListener('click', reloadActive);
  $('#go').addEventListener('click', () => navigate(activeTab(), $('#url').value));
  $('#url').addEventListener('keydown', e => {
    if(e.key === 'Enter'){ navigate(activeTab(), $('#url').value); $('#url').blur(); }
  });
  $('#url').addEventListener('input', () => { clearTimeout(sugTimer); sugTimer = setTimeout(updateSuggest, 150); });
  $('#url').addEventListener('focus', updateSuggest);
  $('#star').addEventListener('click', () => {
    const tab = activeTab();
    if(tab.kind === 'internal') return;
    const i = bookmarks.findIndex(b => b.url === tab.url);
    if(i >= 0) bookmarks.splice(i, 1);
    else bookmarks.unshift({ url: tab.url, title: tab.title });
    LS.set('bookmarks', bookmarks);
    renderBookmarksBar(); syncChrome();
  });
  $('#aiBtn').addEventListener('click', () => toggleAI());
  $('#aiClose').addEventListener('click', () => toggleAI(false));
  $('#aiForm').addEventListener('submit', e => {
    e.preventDefault();
    const inp = $('#aiInput');
    aiSend(inp.value); inp.value = '';
  });
  for(const c of ['Что ты умеешь?', 'Посчитай 15% от 240', 'Открой Википедию', 'Резюме страницы', 'Брось кубик']){
    const b = document.createElement('button');
    b.textContent = c;
    b.addEventListener('click', () => aiSend(c));
    $('#aiChips').appendChild(b);
  }
  $('#menuBtn').addEventListener('click', e => { e.stopPropagation(); $('#menu').hidden = !$('#menu').hidden; });
  document.addEventListener('click', e => { if(!e.target.closest('#menuWrap')) $('#menu').hidden = true; });
  $$('#menu [data-go]').forEach(b => b.addEventListener('click', () => {
    navigate(activeTab(), b.dataset.go); $('#menu').hidden = true;
  }));
  $('#openExternal').addEventListener('click', () => {
    const t = activeTab();
    if(t.kind === 'web') window.open(t.url, '_blank', 'noopener');
    $('#menu').hidden = true;
  });
  $('#hintOpen').addEventListener('click', () => window.open(activeTab().url, '_blank', 'noopener'));
  $('#hintHide').addEventListener('click', () => { activeTab().hintOff = true; syncChrome(); });

  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't'){ e.preventDefault(); createTab('browser://start'); }
    else if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w'){ e.preventDefault(); closeTab(activeId); }
    else if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l'){ e.preventDefault(); $('#url').focus(); $('#url').select(); }
    else if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'){ e.preventDefault(); toggleAI(); }
    else if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r'){ e.preventDefault(); reloadActive(); }
    else if(e.altKey && e.key === 'ArrowLeft'){ e.preventDefault(); go(activeTab(), -1); }
    else if(e.altKey && e.key === 'ArrowRight'){ e.preventDefault(); go(activeTab(), 1); }
    else if(e.key === '/' && !typing){ e.preventDefault(); $('#url').focus(); }
  });

  // живые часы на стартовой странице (обновление раз в 20 сек — почти не ест)
  setInterval(() => {
    const c = $('#clock');
    if(c) c.textContent = new Date().toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
  }, 20000);
}

function reloadActive(){
  const tab = activeTab();
  if(tab.kind === 'web'){
    showProgress(true);
    try { tab.iframe.contentWindow.location.reload(); }
    catch(e){ tab.iframe.src = tab.url; }
  } else {
    renderInternal(tab, tab.url);
  }
}

// ---------- старт ----------
bind();
renderBookmarksBar();
const deep = new URLSearchParams(location.search).get('u');
createTab(deep || 'browser://start');
