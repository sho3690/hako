// 箱 HAKO — 計算部分。画面にも通信にも触らない純粋関数だけを置く（test/ で検証）。
// 画面（ブラウザ）・同期（GitHub Actions）・手元の CLI（scripts/hako.mjs）の3か所から読み込む。
// 箱は「入れる」「取り出す」だけ。日付や分類は持たない（書いた言葉はそのまま残す）。

// 届いた値で辞書を引くときは、必ず自前のキーだけを見る（__proto__ などを踏まない）
export const has = (o, k) => typeof k === 'string' && o != null && Object.hasOwn(o, k);
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
export const safeId = k => typeof k === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(k) && !RESERVED.has(k);

const str = (v, n) => (typeof v === 'string' ? v : '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, n);
const oneLine = (v, n) => str(v, n * 2).replace(/\s+/g, ' ').trim().slice(0, n);
export function clip(s, n) { s = String(s ?? '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// ---- リンク ----
const URL_RE = /https?:\/\/[^\s<>"'「」（）()、。]+/g;
export function findUrls(text) {
  return [...new Set((String(text).match(URL_RE) || []).map(u => u.replace(/[.,!?)\]]+$/, '')))];
}
export function safeUrl(u) {
  try { const x = new URL(String(u).trim()); return /^https?:$/.test(x.protocol) && x.href.length <= 2000 ? x.href : ''; } catch { return ''; }
}
export function shortUrl(u) {
  try { const x = new URL(u); return clip(`${x.hostname.replace(/^www\./, '')}${x.pathname === '/' ? '' : x.pathname}`, 40); } catch { return ''; }
}

// 1行を1つとして読む → { title, url }。書いた言葉はそのまま。リンクだけは取り出して、押せるようにする
export function parseLine(line) {
  let text = oneLine(line, 1000);
  const url = findUrls(text).map(safeUrl).find(Boolean) || '';
  if (url) {
    text = text.replace(URL_RE, ' ').replace(/\s+/g, ' ').trim();
    // 「https://… を読む」のように、リンクが文の頭だったときは名前を残す（「を読む」だけにしない）
    if (!text || /^[をにがはのでともへや、。]/.test(text)) text = `${shortUrl(url)}${text ? ` ${text}` : ''}`;
  }
  return { title: clip(text, 200), url };
}
// 改行で区切れば、まとめて入れられる（貼り付けた箇条書きの「・」「- 」「1.」は外す）
export function parseInput(text) {
  return String(text ?? '').split('\n').map(l => l.trim().replace(/^(?:[-・*●○□☐]|\d{1,2}[.)．](?!\d))\s*/, '')).filter(Boolean).slice(0, 50)
    .map(parseLine).filter(t => t.title);
}

// ---- データ ----
export const VIAS = ['app', 'claude', 'link', 'share', 'drop'];
const DAY_MS = 86400000;
const MAX_APPLIED = 1500, MAX_PENDING = 300, MAX_GONE = 1000;
const FIELDS = ['title', 'note', 'url', 'status'];

export function emptyState() {
  return { v: 1, tasks: {}, log: { lastTime: 0, dropTime: 0, applied: [], pending: [], gone: [] }, updatedAt: 0, syncedAt: 0 };
}

function sanitizeFrom(f) {
  const o = f && typeof f === 'object' ? f : {};
  return { via: VIAS.includes(o.via) ? o.via : 'app', where: oneLine(o.where, 60), device: oneLine(o.device, 24) };
}
export function sanitizeTask(x) {
  const o = x && typeof x === 'object' ? x : {};
  return { title: oneLine(o.title, 200), note: str(o.note, 3000).trim(), url: safeUrl(o.url || ''), from: sanitizeFrom(o.from) };
}
function sanitizeEdits(e) {
  const o = e && typeof e === 'object' ? e : {};
  const out = {};
  if (has(o, 'title')) out.title = oneLine(o.title, 200);
  if (has(o, 'note')) out.note = str(o.note, 3000).trim();
  if (has(o, 'url')) out.url = safeUrl(o.url || '');
  return out;
}

// 項目ごとに「いつの変更か」を持ち、新しいほうだけを残す。
// 届く順番が前後しても、送り直したものが遅れて届いても、同じ結果になる。
const newer = (t, k, at) => at >= (t.ts?.[k] || 0);
const stamp = (t, k, at) => { t.ts = { ...(t.ts || {}), [k]: at }; };
function change(t, kind, edits, at) {
  if (kind === 'task.edit') {
    for (const [k, v] of Object.entries(edits || {})) {
      if (!FIELDS.includes(k) || k === 'status' || !newer(t, k, at) || (k === 'title' && !v)) continue;
      t[k] = v; stamp(t, k, at);
    }
  } else if (kind === 'task.done' && newer(t, 'status', at)) {
    if (t.status !== 'done') t.doneAt = at;
    t.status = 'done'; stamp(t, 'status', at);
  } else if (kind === 'task.reopen' && newer(t, 'status', at)) {
    t.status = 'open'; t.doneAt = 0; stamp(t, 'status', at);
  }
  t.updatedAt = Math.max(t.updatedAt || 0, at);
}
function markApplied(state, id) {
  state.log.applied.push(id);
  if (state.log.applied.length > MAX_APPLIED) state.log.applied.splice(0, state.log.applied.length - MAX_APPLIED);
}
function markGone(state, id) {
  if (!state.log.gone.includes(id)) state.log.gone.push(id);
  if (state.log.gone.length > MAX_GONE) state.log.gone.splice(0, state.log.gone.length - MAX_GONE);
}

export function applyEvent(state, ev) {
  if (!ev || typeof ev !== 'object' || typeof ev.id !== 'string' || ev.id.length > 64) return false;
  state.log.pending ||= []; state.log.gone ||= [];
  if (state.log.applied.includes(ev.id)) return false;
  const at = Number(ev.at) > 0 ? Number(ev.at) : Date.now();
  const id = safeId(ev.taskId) ? ev.taskId : null;
  const touch = () => {
    if (Number(ev.time) > state.log.lastTime) state.log.lastTime = Number(ev.time);
    state.updatedAt = Math.max(state.updatedAt || 0, at);
  };
  switch (ev.t) {
    case 'task.add': {
      const x = ev.task || {};
      if (!safeId(x.id) || has(state.tasks, x.id) || state.log.gone.includes(x.id)) break;
      const v = sanitizeTask(x);
      if (!v.title) break;
      const t = { id: x.id, ...v, status: 'open', addedAt: Number(x.addedAt) > 0 ? Number(x.addedAt) : at, doneAt: 0, updatedAt: at, ts: Object.fromEntries(FIELDS.map(k => [k, at])) };
      state.tasks[x.id] = t;
      // 先に届いて預かっていた、この項目への変更を当てる
      const waiting = state.log.pending.filter(p => p.taskId === x.id).sort((a, b) => a.at - b.at);
      if (waiting.length) state.log.pending = state.log.pending.filter(p => p.taskId !== x.id);
      for (const p of waiting) {
        if (p.t === 'task.delete') { delete state.tasks[x.id]; markGone(state, x.id); }
        else if (has(state.tasks, x.id)) change(t, p.t, p.edits, p.at);
        markApplied(state, p.id);
      }
      break;
    }
    case 'task.edit': case 'task.done': case 'task.reopen': case 'task.delete': {
      if (!id || state.log.gone.includes(id)) break;
      if (!has(state.tasks, id)) {
        // まだ届いていない項目への変更（中継の預かり切れで追加だけ送り直しになった など）→ 項目が届くまで預かる
        if (!state.log.pending.some(p => p.id === ev.id)) {
          state.log.pending.push({ id: ev.id, t: ev.t, taskId: id, at, ...(ev.t === 'task.edit' ? { edits: sanitizeEdits(ev.edits) } : {}) });
          if (state.log.pending.length > MAX_PENDING) state.log.pending.splice(0, state.log.pending.length - MAX_PENDING);
          touch();
          return true;
        }
        return false;
      }
      if (ev.t === 'task.delete') { delete state.tasks[id]; markGone(state, id); }
      else change(state.tasks[id], ev.t, sanitizeEdits(ev.edits), at);
      break;
    }
    default: break;
  }
  markApplied(state, ev.id);
  touch();
  return true;
}
// 入れるだけのリンク（drop.html）から届いたもの → 追加のイベント。入れることしかできない（直す・取り出す・消すは作らない）。
// 時刻は中継が受け取った時刻を使う（送り手の言う時刻は信じない）。同じものが二度届いても、同じ番号なので二重に入らない。
export const DROP_MAX_ITEMS = 20;
export function fromDrop(d, timeSec) {
  if (!d || typeof d !== 'object' || !safeId(d.id) || d.id.length > 40 || !Array.isArray(d.items)) return [];
  const at = Number(timeSec) > 0 ? Number(timeSec) * 1000 : Date.now();
  return d.items.slice(0, DROP_MAX_ITEMS).map((x, i) => {
    const p = typeof x === 'string' ? parseLine(x) : x && typeof x === 'object' ? x : {};
    const id = `${d.id.slice(0, 4)}${i.toString(36)}${d.id.slice(4)}`;   // 頭の5文字で見分けがつくように（Mac の道具は頭だけを番号として出す）
    return { id: `drop-${id}`, t: 'task.add', at, task: { id, title: p.title, url: p.url, note: d.note, from: { via: 'drop', where: d.by } } };
  });
}

// 届いた変更を当てる順番: 変更した時刻 → 中継に届いた時刻
export const byTime = (a, b) => ((Number(a.at) || 0) - (Number(b.at) || 0)) || ((Number(a.time) || 0) - (Number(b.time) || 0));

// 片づけ: 取り出してから半年たったものは消す（多すぎるときは古い順に1000件まで）。1週間たっても項目が届かない変更は捨てる
export function maintain(state, now = Date.now()) {
  let changed = false;
  state.log.pending ||= []; state.log.gone ||= [];
  const done = Object.values(state.tasks).filter(t => t.status === 'done').sort((a, b) => b.doneAt - a.doneAt);
  done.forEach((t, i) => {
    if (i >= 1000 || now - t.doneAt > 183 * DAY_MS) { delete state.tasks[t.id]; markGone(state, t.id); changed = true; }
  });
  const keep = state.log.pending.filter(p => now - p.at < 7 * DAY_MS);
  if (keep.length !== state.log.pending.length) { state.log.pending = keep; changed = true; }
  return changed;
}

// ---- 表示用 ----
export const inBox = state => Object.values(state.tasks).filter(t => t.status === 'open').sort((a, b) => b.addedAt - a.addedAt);   // 新しく入れたものが上
export function sourceLabel(from) {
  if (!from) return '';
  if (from.via === 'claude') return from.where ? `Claude · ${from.where}` : 'Claude';
  if (from.via === 'link') return 'リンクから';
  if (from.via === 'drop') return from.where || 'リンクから';
  if (from.via === 'share') return '共有から';
  return from.device || '';
}
