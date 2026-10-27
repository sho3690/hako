// 箱 HAKO — 画面。データは「保存済みのスナップショット」＋「中継に届いた変更」を合わせて表示する（土日 DONICHI と同じしくみ）。
import * as L from './logic.js';
import { keysFrom, deriveMaster, seal, open, openDrop, dropOpen, b64u, PREFIX } from './crypto.js';
import { publish, poll, MAX_BODY } from './relay.js';

const $ = (s, el = document) => el.querySelector(s);
const K = { cache: 'hako.cache', outbox: 'hako.outbox', sent: 'hako.sent', draft: 'hako.draft' };
const ls = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 保存できなくても動く */ } },
  del: k => { try { localStorage.removeItem(k); } catch { /* 同上 */ } },
  json: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
};

// 鍵は「取り出せない形（non-extractable）」で IndexedDB に置き、親鍵そのものは保存しない。
// sho3690.github.io は他のアプリと同じ置き場なので、万一そちらに不正なスクリプトが入っても鍵を持ち出せないように。
const keyStore = {
  db: null,
  async open() {
    if (!this.db) this.db = await new Promise((res, rej) => { const r = indexedDB.open('hako', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return this.db;
  },
  async req(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => { const tx = db.transaction('kv', mode); const q = fn(tx.objectStore('kv')); tx.oncomplete = () => res(q?.result); tx.onerror = () => rej(tx.error); });
  },
  get: k => keyStore.req('readonly', st => st.get(k)).catch(() => undefined),
  set: (k, v) => keyStore.req('readwrite', st => st.put(v, k)).then(() => true, () => false),
  del: k => keyStore.req('readwrite', st => st.delete(k)).catch(() => {}),
};

// ---- 小さな道具 ----
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false && c !== '' && c !== 0) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function icon(name, cls = 'ic') {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVGNS, 'use'); u.setAttribute('href', `#i-${name}`);
  s.append(u); return s;
}
// 日本語入力の変換を確定する Enter でフォームが送られないようにする（Safari は確定の Enter を keyCode 229 で送る）
const imeGuard = e => { if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) e.preventDefault(); };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : b64u.enc(crypto.getRandomValues(new Uint8Array(16))));
const hm = ts => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
const typing = el => !!el?.closest?.('input, textarea, select, [contenteditable="true"]');

function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'ブラウザ';
}
const DEVICE = deviceLabel();

// ---- アプリの状態 ----
const app = {
  cfg: null, keys: null, snap: null, relay: new Map(), outbox: [], sent: [], st: null, drop: null, dropSeen: new Set(),
  sheet: null, lastSnap: 0, relayOk: true, snapOk: true, trigger: null, es: null, pendingAdd: null, sig: '',
};

// ================= 起動 =================
async function boot() {
  // 他のサイトの枠（iframe）の中では開かない（偽の画面を重ねて操作させる手口を防ぐ）
  if (window.top !== window.self) { document.body.textContent = ''; return; }
  // 開くためのリンク（#k=…）・追加のリンク（#/add?t=…）・共有メニュー（?text=…）は、何よりも先に URL から消す
  const raw = location.hash.slice(1);
  const linkKey = raw.startsWith('k=') ? new URLSearchParams(raw).get('k') : null;
  app.pendingAdd = addRequestFrom(location.hash) || shareRequest();
  if (linkKey || app.pendingAdd || location.search) history.replaceState(null, '', location.pathname);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  try { app.cfg = await (await fetch('./config.json', { cache: 'no-store' })).json(); }
  catch { return fatal('設定を読み込めませんでした。電波の良い所で開き直してください。'); }

  if (linkKey) {
    if (!(await useKey(linkKey))) return showLock({ error: 'このリンクは使えなくなっています（合言葉が変わったようです）。合言葉を入れてください。' });
  } else {
    const saved = await keyStore.get('keys');
    if (saved && saved.check === app.cfg.check && saved.aes) app.keys = saved;
    else if (saved) { await keyStore.del('keys'); return showLock({ error: '合言葉が変わりました。新しい合言葉を入れてください。' }); }
  }
  if (!app.keys) return showLock();
  start();
}

// 「#/add?t=やること&n=メモ」— スマホの Claude などが作るリンク。押すと入れる前の確認が開く（勝手には入れない）
function addRequestFrom(hash) {
  const m = /^#\/add(?:\?(.*))?$/s.exec(hash || '');
  if (!m) return null;
  const q = new URLSearchParams(m[1] || '');
  return { text: (q.get('t') || '').slice(0, 4000), note: (q.get('n') || '').slice(0, 3000), via: 'link' };
}
// Android の「共有」→ 箱
function shareRequest() {
  const q = new URLSearchParams(location.search);
  if (!q.has('text') && !q.has('url') && !q.has('title')) return null;
  const parts = [...new Set([q.get('title'), q.get('text'), q.get('url')].map(s => (s || '').trim()).filter(Boolean))];
  return { text: parts.join(' ').slice(0, 4000), note: '', via: 'share' };
}

async function useKey(master) {
  try {
    const keys = await keysFrom(typeof master === 'string' ? b64u.dec(master) : master);   // 壊れたリンクでもここで止まらない
    if (keys.check !== app.cfg.check) return false;
    app.keys = keys;
    await keyStore.set('keys', { aes: keys.aes, topic: keys.topic, check: keys.check });   // 保存できない環境では、この画面を開いている間だけ使う
    return true;
  } catch { return false; }
}

function fatal(msg) {
  const root = $('#lock'); root.hidden = false; $('#shell').hidden = true;
  root.replaceChildren(h('div', { class: 'lock-card' }, brand(), h('h1', {}, '開けませんでした'), h('p', { class: 'lead' }, msg),
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload() }, '開き直す')));
}
const brand = () => h('div', { class: 'brand' }, h('span', { class: 'brand-ja' }, '箱'), h('span', { class: 'brand-en' }, 'HAKO'));

// ---- 合言葉の画面 ----
function showLock({ error = '' } = {}) {
  const root = $('#lock');
  root.hidden = false; $('#shell').hidden = true;
  const errPw = h('p', { class: 'err', id: 'pw-err', hidden: !error }, error);
  const pw = h('input', { class: 'input', id: 'pw', name: 'password', type: 'password', autocomplete: 'current-password', autocapitalize: 'off', spellcheck: 'false', required: true, 'aria-describedby': 'pw-help pw-err', 'aria-invalid': error ? 'true' : null });
  const eye = h('button', { type: 'button', class: 'icon-btn', 'aria-label': '合言葉を表示', 'aria-pressed': 'false', onclick: () => {
    const show = pw.type === 'password'; pw.type = show ? 'text' : 'password';
    eye.setAttribute('aria-pressed', String(show)); eye.setAttribute('aria-label', show ? '合言葉を隠す' : '合言葉を表示');
  } }, icon('eye'));
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, '開く');
  const form = h('form', { novalidate: true, onsubmit: async e => {
    e.preventDefault();
    if (!pw.value.trim()) { errPw.hidden = false; errPw.textContent = '合言葉を入れてください'; pw.setAttribute('aria-invalid', 'true'); pw.focus(); return; }
    submit.classList.add('loading'); submit.disabled = true;
    const ok = await useKey(await deriveMaster(pw.value, app.cfg.salt, app.cfg.iterations));
    submit.classList.remove('loading'); submit.disabled = false;
    if (!ok) { errPw.hidden = false; errPw.textContent = '合言葉が違います。大文字・小文字やハイフンは気にしなくて大丈夫です。'; pw.setAttribute('aria-invalid', 'true'); pw.focus(); return; }
    start();
  } },
  h('input', { type: 'text', name: 'username', autocomplete: 'username', value: 'hako', hidden: true, readonly: true }),
  h('div', { class: 'field' },
    h('label', { for: 'pw' }, '合言葉', h('span', { class: 'req', 'aria-hidden': 'true' }, '*')),
    h('div', { class: 'pw' }, pw, eye),
    h('p', { class: 'help', id: 'pw-help' }, '箱を作ったときの合言葉です（例: abcde-fghjk-…）。開くためのリンクから開けば入力はいりません。'),
    errPw),
  submit);
  root.replaceChildren(h('div', { class: 'lock-card' }, brand(),
    h('h1', {}, '箱を開く'),
    h('p', { class: 'lead' }, 'やること・頼まれごと・思いついたことを、全部ひとつに集めておく場所です。Claude に「〇〇を『箱』に入れておいて」と言えば、ここに届きます。'),
    app.pendingAdd?.text && h('p', { class: 'help note mt' }, `開いたあと「${L.clip(app.pendingAdd.text.split('\n')[0], 40)}」を入れる確認に進みます。`),
    form,
    h('p', { class: 'note' }, 'データは合言葉で暗号化して保存しています。合言葉を知らない人には中身が見えません。')));
  pw.focus();
}

// ================= 起動後 =================
function start() {
  $('#lock').hidden = true; $('#shell').hidden = false;
  app.outbox = [];
  app.sent = ls.json(K.sent, []);

  wire();
  loadOutbox().then(() => { if (app.outbox.length) { recompute(); flushOutbox(); } });
  render();
  const cached = ls.json(K.cache, null);
  if (cached?.sealed) open(app.keys, cached.sealed).then(s => { if (!app.snap) { app.snap = s; recompute(); } }).catch(() => {});
  refresh();
  listen();
  setInterval(tick, 30000);
  if (app.pendingAdd) { const p = app.pendingAdd; app.pendingAdd = null; openSheet('add', p); }
}

let wired = false;
function wire() {
  if (wired) return; wired = true;
  document.addEventListener('click', onAction);
  window.addEventListener('hashchange', onHash);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(true); });
  window.addEventListener('online', () => { flushOutbox(); tick(true); });
  wireComposer();
  // n か / で入力欄へ（入力中・シート表示中は何もしない）
  document.addEventListener('keydown', e => {
    if ((e.key !== 'n' && e.key !== '/') || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || app.sheet || typing(e.target)) return;
    e.preventDefault(); $('#put').focus();
  });
  // 入力欄が上に貼りついたら、下との境目に薄い影を出す（中身と重なって見えないように）
  const bar = $('#composer-bar');
  const stuck = () => bar.classList.toggle('stuck', window.scrollY > 0 && bar.getBoundingClientRect().top <= 0.5);
  window.addEventListener('scroll', stuck, { passive: true });
  stuck();
  const d = $('#sheet');
  // 「閉じた」の知らせは少し遅れて届く。そのあいだに次のシートを開いていたら、そちらを消さない
  d.addEventListener('close', () => { if (d.open) return; app.sheet = null; d.replaceChildren(); app.trigger?.focus?.({ preventScroll: true }); app.trigger = null; });
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
}

// ---- データの取得と合成 ----
async function fetchSnapshot() {
  const res = await fetch(`./data/state.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('snapshot');
  const file = await res.json();
  app.snap = file.sealed ? await open(app.keys, file.sealed) : L.emptyState();
  app.lastSnap = Date.now(); app.snapOk = true;
  ls.set(K.cache, JSON.stringify({ sealed: file.sealed, at: Date.now() }));
}

async function pollRelay() {
  const last = app.snap?.log?.lastTime || 0;
  const msgs = await poll(app.cfg.relay, app.keys.topic, last ? Math.max(0, last - 900) : 'all');
  for (const m of msgs) await addRelayMessage(m);
  app.relayOk = true;
  await pollDrop().catch(() => {});
}
// 入れるだけのリンク（Mac を通さずに ChatGPT などが入れたもの）も、保存を待たずに見せる
async function loadDrop() {
  if (app.drop) return;
  try {
    const res = await fetch('./drop.json', { cache: 'no-store' });
    if (res.ok) app.drop = await openDrop(app.keys, await res.json());
  } catch { /* 無ければ15分ごとの保存で届く */ }
}
async function pollDrop() {
  if (!app.drop) return;
  const dt = app.snap?.log?.dropTime || 0;
  for (const m of await poll(app.cfg.relay, app.drop.topic, dt ? Math.max(0, dt - 900) : 'all')) {
    if (app.dropSeen.has(m.id)) continue;
    app.dropSeen.add(m.id);
    try { for (const ev of L.fromDrop(await dropOpen(app.drop.key, m.message), m.time)) if (!app.relay.has(ev.id)) app.relay.set(ev.id, ev); }
    catch { /* 読めないものは無視 */ }
  }
}
async function addRelayMessage(m) {
  try {
    const ev = await open(app.keys, m.message);
    if (typeof ev?.id !== 'string') return false;
    ev.time = m.time;
    if (!app.relay.has(ev.id)) { app.relay.set(ev.id, ev); return true; }
  } catch { /* 他の鍵のメッセージや壊れたものは無視 */ }
  return false;
}

async function refresh() {
  try { await fetchSnapshot(); } catch { app.snapOk = false; }
  await loadDrop();
  try { await pollRelay(); } catch { app.relayOk = false; }
  if (!app.snap) { render(); return; }
  // 保存済みに入った変更は中継の控えから外す
  const applied = new Set([...app.snap.log.applied, ...(app.snap.log.pending || []).map(p => p.id)]);
  for (const id of [...app.relay.keys()]) if (applied.has(id)) app.relay.delete(id);
  resendLost(applied);
  recompute();
  flushOutbox();
}

// 中継に送ったのに、保存にも中継にも見当たらないもの（中継の預かり期限切れなど）を送り直す
function resendLost(applied) {
  const now = Date.now();
  app.sent = app.sent.filter(s => !applied.has(s.id) && now - s.first < 3 * 86400000);
  for (const s of app.sent) {
    if (app.relay.has(s.id) || now - s.at < 30 * 60000) continue;
    s.at = now;
    publish(app.cfg.relay, app.keys.topic, s.body).catch(() => {});
  }
  ls.set(K.sent, JSON.stringify(app.sent));
}

let lastTick = 0;
async function tick(force = false) {
  if (document.hidden || !app.keys) return;
  const now = Date.now();
  if (!force && now - lastTick < 25000) return;
  lastTick = now;
  if (now - app.lastSnap > 180000) return refresh();
  try { await pollRelay(); recompute(); } catch { app.relayOk = false; renderBanner(); }
  if (app.outbox.length) flushOutbox();
}

// 他の端末・Claude からの変更をすぐ受け取る（つながらなければ定期の確認だけで動く）
function listen() {
  try {
    app.es?.close();
    const es = new EventSource(`${app.cfg.relay}/${app.keys.topic}/sse`);
    es.addEventListener('message', async e => {
      try { if (await addRelayMessage(JSON.parse(e.data))) scheduleRecompute(); } catch { /* 無視 */ }
    });
    app.es = es;
  } catch { /* 定期の確認で補う */ }
}
let rcTimer = 0;
function scheduleRecompute() { clearTimeout(rcTimer); rcTimer = setTimeout(recompute, 150); }

function recompute() {
  if (!app.snap) return;
  const st = structuredClone(app.snap);
  const evs = [...app.relay.values()].sort(L.byTime);
  for (const ev of [...evs, ...app.outbox]) { try { L.applyEvent(st, ev); } catch { /* おかしなイベントは飛ばす */ } }
  // 中身が変わったときだけ描き直す（開いた折りたたみ・入力中のフォーカス・削除の確認を消さない）
  const sig = JSON.stringify(st);
  if (sig === app.sig) return;
  app.sig = sig; app.st = st;
  render();
}

// ---- 変更を送る ----
function send(t, payload = {}) {
  const ev = { id: uid(), t, at: Date.now(), ...payload };
  app.outbox.push(ev);
  saveOutbox();
  recompute();
  flushOutbox();
  return ev;
}
// 未送信の変更も、端末の中では封をして置く
let outboxSaving = Promise.resolve();
function saveOutbox() {
  const snapshot = [...app.outbox];
  outboxSaving = outboxSaving.then(async () => { try { ls.set(K.outbox, snapshot.length ? await seal(app.keys, snapshot) : ''); } catch { /* 保存できなくても送信は続ける */ } });
}
async function loadOutbox() {
  const raw = ls.get(K.outbox);
  if (!raw) return;
  try { const list = raw.startsWith(PREFIX) ? await open(app.keys, raw) : []; if (Array.isArray(list)) app.outbox = [...list, ...app.outbox]; } catch { /* 読めなければ捨てる */ }
}
function shrink(ev, step) {
  const e = structuredClone(ev);
  const cut = (o, k, n) => { if (o && typeof o[k] === 'string' && o[k].length > n) o[k] = o[k].slice(0, n); };
  const n = [1500, 900, 500, 250, 100][step] ?? 50;
  cut(e.task, 'note', n); cut(e.edits, 'note', n);
  if (step >= 5) { cut(e.task, 'title', 80); cut(e.edits, 'title', 80); }
  return e;
}

let flushing = false;
async function flushOutbox() {
  if (flushing || !app.outbox.length) return;
  flushing = true;
  try {
    while (app.outbox.length) {
      const ev = app.outbox[0];
      let body = await seal(app.keys, ev);
      for (let step = 0; body.length > MAX_BODY && step < 7; step++) body = await seal(app.keys, shrink(ev, step));
      if (body.length > MAX_BODY) {   // 縮めても送れないものは取り消す（後ろの変更を止めない）
        app.outbox.shift(); saveOutbox(); recompute();
        toast('長すぎて送れない変更を1件取り消しました');
        continue;
      }
      const res = await publish(app.cfg.relay, app.keys.topic, body);
      app.outbox.shift();
      ev.time = res.time;
      app.relay.set(ev.id, ev);
      app.sent.push({ id: ev.id, body, at: Date.now(), first: Date.now() });
      if (app.sent.length > 120) app.sent.splice(0, app.sent.length - 120);
      saveOutbox(); ls.set(K.sent, JSON.stringify(app.sent));
      app.relayOk = true;
    }
  } catch { app.relayOk = false; }
  finally { flushing = false; renderBanner(); }
}

// ================= 入れる（いつも上にある入力欄）=================
function wireComposer() {
  const form = $('#composer'), put = $('#put');
  const grow = () => { put.style.height = 'auto'; put.style.height = `${Math.min(put.scrollHeight, 168)}px`; };
  put.value = ls.get(K.draft) || '';   // 書きかけは端末に残す（閉じても消えない）
  grow();
  put.addEventListener('input', () => { grow(); ls.set(K.draft, put.value); });
  // Enter で入れる。Shift+Enter で改行。日本語の変換を確定する Enter では入れない（Safari は keyCode 229）
  put.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    e.preventDefault(); form.requestSubmit();
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const list = L.parseInput(put.value);
    if (!list.length) { put.focus(); return; }
    const ids = putIn(list, '', 'app');
    put.value = ''; ls.del(K.draft); grow(); put.focus();
    toast(ids.length > 1 ? `${ids.length}件を入れました` : '入れました', { label: '取り消す', fn: () => ids.forEach(id => send('task.delete', { taskId: id })) });
  });
}
function putIn(list, note, via) {
  const ids = [];
  for (const p of list) {
    const id = uid();
    ids.push(id);
    send('task.add', { task: { id, title: p.title, url: p.url, note, from: { via, device: DEVICE } } });
  }
  return ids;
}

// 「#/add?t=…」のリンクを、開いている最中に押したとき
function onHash() {
  const req = addRequestFrom(location.hash);
  if (!req) return;
  history.replaceState(null, '', location.pathname);
  if (!app.keys) { app.pendingAdd = req; return; }
  openSheet('add', req);
}

// ================= 箱の中 =================
function render() {
  renderBanner();
  const view = $('#view');
  const st = app.st;
  const focusKey = document.activeElement?.closest?.('#view [data-key]')?.dataset.key;
  if (!st) {
    view.replaceChildren(app.snapOk ? loadingView() : h('section', { class: 'empty', role: 'alert' }, h('h2', {}, '読み込めませんでした'),
      h('p', {}, '電波の良い所で、もう一度お試しください。'), h('button', { class: 'btn btn-primary', type: 'button', 'data-action': 'reload' }, '読み込み直す')));
    return;
  }
  const list = L.inBox(st);
  view.replaceChildren(...(list.length
    ? [h('h1', { class: 'box-head' }, '箱の中', h('span', { class: 'count' }, `${list.length}件`)),
      h('ul', { class: 'tasks', 'aria-label': '箱の中' }, list.map(taskRow))]
    : [h('h1', { class: 'visually-hidden' }, '箱の中'),
      h('section', { class: 'empty', 'aria-labelledby': 'empty-title' },
        h('span', { class: 'ic-wrap' }, icon('box')),
        h('h2', { id: 'empty-title' }, '箱は空っぽです'),
        h('p', {}, '思いついたこと・頼まれたことを、上の欄から入れてください。'),
        h('p', { class: 'hint' }, 'このMacの Claude に「〇〇を『箱』に入れておいて」と言っても届きます。'))]));
  if (focusKey) view.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  // 開いている詳細: 入力中は書き換えない。その項目が変わったときだけ描き直す（フォーカスを消さない）
  const sh = app.sheet;
  if (sh?.kind === 'detail' && !sh.draft && JSON.stringify(st.tasks[sh.id] ?? null) !== sh.sig) renderSheet();
}

function renderBanner() {
  const el = $('#banner');
  if (!el) return;
  let msg = null, action = null;
  if (app.outbox.length && !app.relayOk) { msg = `送れていないものが${app.outbox.length}件あります。つながったら自動で送り直します。`; action = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', 'data-action': 'retry' }, '今すぐ送る'); }
  else if (!app.snapOk && !app.snap) { msg = 'データを読み込めませんでした。電波の良い所でもう一度お試しください。'; action = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', 'data-action': 'reload' }, '読み込み直す'); }
  el.hidden = !msg;
  if (msg) el.replaceChildren(h('span', {}, msg), action);
}

function loadingView() {
  const row = () => h('li', { class: 'task', 'aria-hidden': 'true' }, h('span', { class: 'check' }, h('span', { class: 'box' })),
    h('span', { class: 'task-main' }, h('span', { class: 'skeleton sk-line' }), h('span', { class: 'skeleton sk-line short' })));
  return h('section', { 'aria-busy': 'true', 'aria-label': '読み込み中' }, h('ul', { class: 'tasks' }, row(), row(), row()));
}

function taskRow(t) {
  const meta = [];
  if (t.url && !t.title.includes(L.shortUrl(t.url))) meta.push(h('span', {}, icon('link'), L.shortUrl(t.url)));
  if (['claude', 'link', 'drop'].includes(t.from?.via)) meta.push(h('span', { class: 'via' }, t.from.via === 'claude' && icon('spark'), L.sourceLabel(t.from)));
  return h('li', { class: 'task' },
    h('button', { class: 'check', type: 'button', 'aria-label': `「${t.title}」を取り出す`, 'data-action': 'done', 'data-id': t.id, 'data-key': `c-${t.id}` }, h('span', { class: 'box' }, icon('check'))),
    h('button', { class: 'task-main', type: 'button', 'data-action': 'open', 'data-id': t.id, 'data-key': `o-${t.id}` },
      h('span', { class: 'task-title' }, t.title),
      t.note ? h('span', { class: 'task-note' }, t.note.split('\n').find(Boolean)) : null,
      meta.length ? h('span', { class: 'meta' }, meta) : null));
}

// ================= シート =================
function openSheet(kind, opts = {}) {
  if (!app.sheet) app.trigger = document.activeElement;
  app.sheet = { kind, ...opts };
  renderSheet();
  const d = $('#sheet');
  if (!d.open) d.showModal();
  const first = d.querySelector('[autofocus]');
  if (first) { first.focus(); if (first.setSelectionRange && first.value) first.setSelectionRange(first.value.length, first.value.length); }
  else d.querySelector('.sheet-head .icon-btn')?.focus();
}
const closeSheet = () => $('#sheet').open && $('#sheet').close();

function renderSheet() {
  const s = app.sheet;
  if (!s) return;
  const d = $('#sheet');
  const parts = s.kind === 'add' ? sheetAdd(s) : s.kind === 'detail' ? sheetDetail(s) : s.kind === 'settings' ? sheetSettings() : null;
  if (!parts) { closeSheet(); return; }
  const scroll = d.querySelector('.sheet-body')?.scrollTop || 0;
  const had = d.contains(document.activeElement) ? document.activeElement : null;
  const focusSel = had?.id ? `#${CSS.escape(had.id)}` : had?.dataset?.action ? `[data-action="${CSS.escape(had.dataset.action)}"]${had.dataset.id ? `[data-id="${CSS.escape(had.dataset.id)}"]` : ''}` : null;
  d.replaceChildren(...parts.filter(Boolean));
  const body = d.querySelector('.sheet-body');
  if (body) body.scrollTop = scroll;
  // 描き直してもフォーカスをシートの中に保つ（キーボードで操作していても迷子にならない）
  if (had) (focusSel && d.querySelector(focusSel) || d.querySelector('.sheet-head .icon-btn'))?.focus({ preventScroll: true });
}

function sheetHead(title, kicker) {
  return h('div', { class: 'sheet-head' }, h('span', { class: 'grab', 'aria-hidden': 'true' }),
    h('h2', { id: 'sheet-title' }, kicker && h('span', { class: 'kicker' }, kicker), title),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '閉じる', 'data-action': 'close' }, icon('x')));
}

// ---- リンク・共有から届いたものを入れる前の確認（勝手には入れない）----
function sheetAdd(s) {
  const err = h('p', { class: 'err', id: 'add-err', hidden: true });
  const ta = h('textarea', { class: 'textarea', id: 'add-text', rows: '3', autofocus: true, 'aria-describedby': 'add-help add-err', oninput: () => { if (app.sheet) app.sheet.draft = true; } });
  ta.value = s.text || '';
  const note = h('textarea', { class: 'textarea', id: 'add-note', rows: '2' });
  note.value = s.note || '';
  const form = h('form', { id: 'add-form', novalidate: true, onsubmit: e => {
    e.preventDefault();
    const list = L.parseInput(ta.value);
    if (!list.length) { err.hidden = false; err.textContent = '入れるものを書いてください'; ta.setAttribute('aria-invalid', 'true'); ta.focus(); return; }
    const ids = putIn(list, note.value.trim(), s.via || 'link');
    closeSheet();
    toast(ids.length > 1 ? `${ids.length}件を入れました` : '入れました', { label: '取り消す', fn: () => ids.forEach(id => send('task.delete', { taskId: id })) });
  } },
  h('div', { class: 'field' }, h('label', { for: 'add-text' }, '入れるもの'), ta,
    h('p', { class: 'help', id: 'add-help' }, '1行に1つ。直してから入れられます。'), err),
  h('div', { class: 'field' }, h('label', { for: 'add-note' }, 'メモ', h('span', { class: 'opt' }, '任意')), note));
  return [sheetHead('箱に入れる', s.via === 'share' ? '共有から届きました' : 'リンクから届きました。確かめてから入れてください'),
    h('div', { class: 'sheet-body' }, form),
    h('div', { class: 'sheet-foot' },
      h('button', { class: 'btn btn-tertiary', type: 'button', 'data-action': 'close' }, 'やめる'),
      h('button', { class: 'btn btn-primary', type: 'submit', form: 'add-form' }, '箱に入れる'))];
}

// ---- 1つを開く（その場で直せる）----
function sheetDetail(s) {
  const st = app.st;
  const t = L.has(st?.tasks, s.id) ? st.tasks[s.id] : null;
  if (!t || t.status !== 'open') return null;
  s.sig = JSON.stringify(t);
  const err = h('p', { class: 'err', id: 'd-err', hidden: true });
  const draft = () => { if (app.sheet) app.sheet.draft = true; };
  const title = h('textarea', { class: 'textarea title-input', id: 'd-title', rows: '2', maxlength: '200', onkeydown: imeGuard, oninput: draft, 'aria-describedby': 'd-err' });
  title.value = t.title;
  const note = h('textarea', { class: 'textarea', id: 'd-note', rows: '4', oninput: draft });
  note.value = t.note;
  const urlErr = h('p', { class: 'err', id: 'd-url-err', hidden: true });
  const url = h('input', { class: 'input', id: 'd-url', type: 'url', inputmode: 'url', value: t.url, autocapitalize: 'off', spellcheck: 'false', placeholder: 'https://', onkeydown: imeGuard, oninput: draft, 'aria-describedby': 'd-url-err' });
  const form = h('form', { id: 'detail-form', novalidate: true, onsubmit: e => {
    e.preventDefault();
    err.hidden = true; urlErr.hidden = true;
    const nt = title.value.replace(/\s+/g, ' ').trim();
    if (!nt) { err.hidden = false; err.textContent = '中身を書いてください'; title.setAttribute('aria-invalid', 'true'); title.focus(); return; }
    const nu = url.value.trim();
    if (nu && !L.safeUrl(nu)) { urlErr.hidden = false; urlErr.textContent = 'https:// から始まるリンクを入れてください'; url.setAttribute('aria-invalid', 'true'); url.focus(); return; }
    const edits = {};
    if (nt !== t.title) edits.title = nt;
    if (note.value.trim() !== t.note) edits.note = note.value.trim();
    if ((L.safeUrl(nu) || '') !== t.url) edits.url = nu;
    closeSheet();
    if (!L.has(app.st?.tasks, t.id)) { toast('別の端末で消されていたため、保存できませんでした'); return; }
    if (Object.keys(edits).length) { send('task.edit', { taskId: t.id, edits }); toast('保存しました'); }
  } },
  h('div', { class: 'field' }, h('label', { for: 'd-title' }, '中身'), title, err),
  h('div', { class: 'field' }, h('label', { for: 'd-note' }, 'メモ', h('span', { class: 'opt' }, '任意')), note),
  h('div', { class: 'field' }, h('label', { for: 'd-url' }, 'リンク', h('span', { class: 'opt' }, '任意')), url, urlErr,
    t.url && h('a', { class: 'link-out', href: t.url, target: '_blank', rel: 'noopener noreferrer' }, icon('out'), `${L.shortUrl(t.url)} を開く`)));
  const src = L.sourceLabel(t.from);
  return [sheetHead(t.title),
    h('div', { class: 'sheet-body' }, form, h('p', { class: 'byline' }, `${hm(t.addedAt)} に${src ? `${src}から` : ''}入れました`)),
    h('div', { class: 'sheet-foot' },
      h('button', { class: 'btn btn-secondary', type: 'button', 'data-action': 'done', 'data-id': t.id }, icon('check'), '取り出す'),
      h('button', { class: 'btn btn-primary', type: 'submit', form: 'detail-form' }, '変更を保存'))];
}

// ---- 設定 ----
function sheetSettings() {
  const st = app.st;
  const base = `${location.origin}${location.pathname}`;
  const template = `${base}#/add?t=`;
  const status = app.outbox.length ? ['wait', `送信待ち ${app.outbox.length}件`] : app.relayOk && app.snapOk ? ['', '最新です'] : ['off', 'つながっていません'];
  return [sheetHead('設定'), h('div', { class: 'sheet-body' },
    h('section', { class: 'settings-group' }, h('h3', {}, 'Claude から入れる'),
      h('p', {}, 'このMacの Claude Code なら、どの会話・どのフォルダからでも、こう言えば届きます。何をどう書くか・メモは Claude が会話から決めます。'),
      h('p', { class: 'say' }, '「〇〇を『箱』に入れておいて」'),
      h('p', { class: 'mt' }, '「箱に何がある？」「〇〇は済んだから出して」も伝わります。'),
      h('p', {}, 'スマホの Claude や claude.ai からは、Claude に「箱に入れるリンクを作って」と頼んでください。リンクを押すと、この画面で入れる前の確認が開きます（リンクの形）:'),
      h('code', { class: 'code-line' }, `${template}入れるもの&n=メモ`),
      h('div', { class: 'actions-row' }, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', 'data-action': 'copy', 'data-text': template, 'data-done': 'リンクの形をコピーしました' }, icon('copy'), 'リンクの形をコピー'))),
    dropSettings(),
    h('section', { class: 'settings-group' }, h('h3', {}, '別の端末で開く'),
      h('p', {}, '合言葉を入れると、合言葉なしで開けるリンクを作ります。自分のスマホなどにだけ送ってください（AirDrop など）。'),
      deviceLinkForm()),
    h('section', { class: 'settings-group' }, h('h3', {}, '同期'),
      h('p', { class: 'status' }, h('span', { class: `dot ${status[0]}`, 'aria-hidden': 'true' }), status[1], st?.syncedAt ? ` · 最終保存 ${hm(st.syncedAt)}` : ''),
      h('p', { class: 'mt' }, '入れたもの・取り出したものは、すぐ他の端末にも届きます。保存は15分ごとに自動で行います。'),
      h('div', { class: 'actions-row' }, h('button', { class: 'btn btn-secondary btn-sm', type: 'button', 'data-action': 'reload' }, icon('refresh'), '今すぐ更新'))),
    h('section', { class: 'settings-group' }, h('h3', {}, 'この端末'),
      h('p', {}, 'この端末から鍵を消します。もう一度使うときは合言葉か、開くためのリンクが必要です。'),
      h('div', { class: 'actions-row' }, h('button', { class: 'btn btn-danger btn-sm', type: 'button', 'data-action': 'logout' }, 'この端末から外す'))))];
}

// 入れるだけのリンク: 合言葉なしで入れることだけができる（中は見えない）。Mac がオフラインでも ChatGPT の dots などから入れられる
function dropSettings() {
  const head = h('h3', {}, 'Mac を通さずに入れる（ChatGPT など）');
  if (!app.drop) return h('section', { class: 'settings-group' }, head, h('p', {}, '準備中です。少したってから開き直してください。'));
  const link = `${new URL('drop.html', location.href).href.split('#')[0]}#w=${app.drop.topic}`;
  const forAi = [
    '「箱」（箱 HAKO）は、私のやることを何でも入れておく場所です。',
    '私が「〇〇を箱に入れておいて」「箱に入れて」と頼んだら、私の Mac は使わずに（Mac がオフラインでも）、あなたのブラウザで次の手順で入れてください。',
    '',
    `1. このリンクを開く: ${link}&by=ChatGPT`,
    '2. 「入れるもの」の欄に、1行に1つずつ書く。あとで見て分かる短い文にし、期限や日付は文の中に書く（例: 企画書を出す（金曜まで））。補足があれば「メモ」の欄へ。',
    '3. 「箱に入れる」ボタンを押す。「箱に入れました」と出たら完了。私には「『箱』に入れました：〇〇」とだけ伝える。',
    '',
    '・リンクの末尾に &t=入れるもの&n=メモ を付けて開くと、欄が埋まった状態で開きます（URL エンコードする。複数は %0A で改行）。',
    '・パスワードや鍵などの秘密は入れない。',
    '・このリンクでできるのは入れることだけです（箱の中は見えません）。リンクは他の人や他のサービスに教えない。',
  ].join('\n');
  return h('section', { class: 'settings-group' }, head,
    h('p', {}, '合言葉なしで「入れることだけ」ができるリンクです。このリンクからは箱の中は見えません。Mac がオフラインでも動きます。'),
    h('p', {}, 'ChatGPT の dots のように自分のブラウザを持つ AI には、下のボタンで説明文をコピーして、そのまま貼り付けて覚えてもらってください。'),
    h('div', { class: 'actions-row' },
      h('button', { class: 'btn btn-secondary btn-sm', type: 'button', 'data-action': 'copy', 'data-text': forAi, 'data-done': 'ChatGPT に渡す文をコピーしました' }, icon('copy'), 'ChatGPT に渡す文をコピー'),
      h('button', { class: 'btn btn-tertiary btn-sm', type: 'button', 'data-action': 'copy', 'data-text': link, 'data-done': 'リンクをコピーしました' }, icon('link'), 'リンクだけコピー')),
    h('p', { class: 'help mt' }, 'リンクが知らない人に渡ってしまったときは、Mac の Claude に「箱の入れるだけのリンクを作り直して」と頼んでください（古いリンクは使えなくなります）。'));
}

// 開くためのリンクを作る（合言葉から親鍵を作り直す。親鍵は端末に保存しない）
function deviceLinkForm() {
  const err = h('p', { class: 'err', id: 's-pass-err', hidden: true });
  const pass = h('input', { class: 'input', id: 's-pass', type: 'password', autocomplete: 'current-password', autocapitalize: 'off', spellcheck: 'false', placeholder: '合言葉', 'aria-describedby': 's-pass-err' });
  const btn = h('button', { class: 'btn btn-secondary', type: 'submit' }, icon('link'), 'リンクを作る');
  const linkField = h('input', { class: 'input', id: 's-link', type: 'text', readonly: true, onfocus: e => e.target.select() });
  const out = h('div', { class: 'field mt', hidden: true }, h('label', { for: 's-link' }, '開くためのリンク'), linkField, h('p', { class: 'help' }, 'このリンクを開いた端末は合言葉なしで入れます。'));
  return h('form', { class: 'mt', novalidate: true, onsubmit: async e => {
    e.preventDefault();
    err.hidden = true; pass.setAttribute('aria-invalid', 'false');
    if (!pass.value.trim()) { err.hidden = false; err.textContent = '合言葉を入れてください'; pass.setAttribute('aria-invalid', 'true'); pass.focus(); return; }
    btn.classList.add('loading'); btn.disabled = true;
    const master = await deriveMaster(pass.value, app.cfg.salt, app.cfg.iterations);
    const keys = await keysFrom(master);
    btn.classList.remove('loading'); btn.disabled = false;
    if (keys.check !== app.cfg.check) { err.hidden = false; err.textContent = '合言葉が違います'; pass.setAttribute('aria-invalid', 'true'); pass.focus(); return; }
    pass.value = '';
    const link = `${location.origin}${location.pathname}#k=${b64u.enc(master)}`;
    out.hidden = false; linkField.value = link;
    const copy = () => navigator.clipboard?.writeText(link).then(() => toast('リンクをコピーしました'), () => { linkField.focus(); linkField.select(); toast('下のリンクを長押ししてコピーしてください'); });
    if (navigator.share) navigator.share({ title: '箱 HAKO', url: link }).catch(e => { if (e?.name !== 'AbortError') copy(); });
    else if (navigator.clipboard) copy();
    else { linkField.focus(); linkField.select(); }
  } },
  h('input', { type: 'text', name: 'username', autocomplete: 'username', value: 'hako', hidden: true, readonly: true }),
  h('div', { class: 'with-btn' }, h('label', { class: 'visually-hidden', for: 's-pass' }, '合言葉'), pass, btn), err, out);
}

// ================= 操作 =================
const confirmArm = new WeakMap();
function twoStep(btn, label) {
  if (confirmArm.get(btn)) return true;
  const orig = [...btn.childNodes].map(n => n.cloneNode(true));
  btn.classList.add('confirm'); btn.textContent = label;
  confirmArm.set(btn, true);
  setTimeout(() => { if (btn.isConnected) { btn.classList.remove('confirm'); btn.replaceChildren(...orig); confirmArm.delete(btn); } }, 4000);
  return false;
}

function onAction(e) {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const a = el.dataset.action;
  const id = el.dataset.id;
  const t = id && L.has(app.st?.tasks, id) ? app.st.tasks[id] : null;
  switch (a) {
    case 'close': closeSheet(); break;
    case 'settings': openSheet('settings'); break;
    case 'open': if (t) openSheet('detail', { id }); break;
    case 'retry': flushOutbox(); break;
    case 'reload': refresh().then(() => toast('最新にしました')); break;
    case 'done': {   // 取り出す（6秒以内なら元に戻せる。Claude からは「戻して」で戻せる）
      if (!t || t.status === 'done') break;
      el.closest('.task')?.classList.add('leaving');
      if (app.sheet?.kind === 'detail') closeSheet();
      send('task.done', { taskId: id });
      toast(`「${L.clip(t.title, 16)}」を取り出しました`, { label: '元に戻す', fn: () => send('task.reopen', { taskId: id }) });
      break;
    }
    case 'copy': {   // コピーできない環境では、その場に文字を出して選んでおく
      const text = el.dataset.text, row = el.closest('.actions-row');
      const fallback = () => {
        let box = row.nextElementSibling?.classList.contains('copy-box') ? row.nextElementSibling : null;
        if (!box) { box = h('textarea', { class: 'textarea copy-box', readonly: true, 'aria-label': 'コピーする文字' }); row.after(box); }
        box.value = text; box.focus(); box.select();
        toast('コピーできませんでした。出てきた文字を選んでコピーしてください');
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast(el.dataset.done || 'コピーしました'), fallback);
      else fallback();
      break;
    }
    case 'logout': {
      if (!twoStep(el, app.outbox.length ? `送れていない${app.outbox.length}件も消えます。外す` : '本当に外す')) break;
      for (const k of Object.values(K)) ls.del(k);
      keyStore.del('keys').then(() => location.replace(location.pathname));
      break;
    }
    default: break;
  }
}

// ---- トースト ----
let toastTimer = 0;
function toast(msg, action = null) {
  const t = $('#toast');
  clearTimeout(toastTimer);
  t.replaceChildren(h('span', {}, msg), ...(action ? [h('button', { type: 'button', onclick: () => { t.hidden = true; action.fn(); } }, action.label)] : []));
  t.hidden = false;
  const hide = () => { toastTimer = setTimeout(() => { t.hidden = true; }, action ? 6000 : 3500); };
  t.onmouseenter = t.onfocusin = () => clearTimeout(toastTimer);
  t.onmouseleave = t.onfocusout = hide;
  hide();
}

boot();
