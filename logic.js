// 箱 HAKO — 計算部分。画面にも通信にも触らない純粋関数だけを置く（test/ で検証）。
// 画面（ブラウザ）・同期（GitHub Actions）・手元の CLI（scripts/hako.mjs）の3か所から読み込む。
// 日付はすべて 'YYYY-MM-DD'（日本時間・朝7時区切り）で扱う。

export const DAY_START_HOUR = 7;            // 日替わりは朝7時（夜更かしで0時過ぎにも見るため）
const DAY_MS = 86400000;
const pad = n => String(n).padStart(2, '0');

// ---- 日付 ----
export const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const parseYmd = s => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
export const addDays = (s, n) => ymd(new Date(parseYmd(s).getTime() + n * DAY_MS));
export const dow = s => parseYmd(s).getUTCDay();
export const diffDays = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / DAY_MS);   // b − a
export const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];
export const md = s => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;
export const mdw = s => `${md(s)}(${DOW_JA[dow(s)]})`;
export const validYmd = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parseYmd(s)) === s;
// 届いた値で辞書を引くときは、必ず自前のキーだけを見る（__proto__ などを踏まない）
export const has = (o, k) => typeof k === 'string' && o != null && Object.hasOwn(o, k);
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
export const safeId = k => typeof k === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(k) && !RESERVED.has(k);

// 朝7時区切りの「今日」（日本時間）
export function jstToday(now = Date.now()) {
  return ymd(new Date(now + (9 - DAY_START_HOUR) * 3600000));
}

const str = (v, n) => (typeof v === 'string' ? v : '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, n);
const oneLine = (v, n) => str(v, n * 2).replace(/\s+/g, ' ').trim().slice(0, n);
export function clip(s, n) { s = String(s ?? '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

export function findUrls(text) {
  return [...new Set((String(text).match(/https?:\/\/[^\s<>"'「」（）()、。]+/g) || []).map(u => u.replace(/[.,!?)\]]+$/, '')))];
}
export function safeUrl(u) {
  try { const x = new URL(String(u).trim()); return /^https?:$/.test(x.protocol) && x.href.length <= 2000 ? x.href : ''; } catch { return ''; }
}
export function shortUrl(u) {
  try { const x = new URL(u); return clip(`${x.hostname.replace(/^www\./, '')}${x.pathname === '/' ? '' : x.pathname}`, 40); } catch { return ''; }
}

// ---- 日付の言葉（「明日」「金曜」「10/30」「月末」など）----
const DOWS = '日月火水木金土';
const mondayOf = s => addDays(s, -((dow(s) + 6) % 7));
const weekdayIn = (monday, d) => addDays(monday, (d + 6) % 7);   // その週（月曜はじまり）の d 曜日
function nextWeekday(today, d) { return addDays(today, (d - dow(today) + 7) % 7); }   // 今日を含めて次の d 曜日
function lastOfMonth(s, plus = 0) { const d = parseYmd(s); return ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1 + plus, 0))); }
function fullDate(y, m, d) { const s = `${y}-${pad(m)}-${pad(d)}`; return validYmd(s) ? s : ''; }
function nearDate(today, m, d) {   // 年の無い日付: 今年。2か月以上前なら来年のこと
  const y = +today.slice(0, 4);
  const s = fullDate(y, m, d);
  if (!s) return '';
  return diffDays(today, s) < -60 ? fullDate(y + 1, m, d) : s;
}

// 人の名前（明日香・今日子 など）や「先週の金曜」は日付にしない
const WHEN_RULES = [
  [/(\d{4})[/\-年.](\d{1,2})[/\-月.](\d{1,2})日?(?:\s*[(（][日月火水木金土][)）])?/, (m) => fullDate(+m[1], +m[2], +m[3])],
  [/(?<![\d/.])(\d{1,2})[/月](\d{1,2})日?(?![\d/])(?:\s*[(（][日月火水木金土][)）])?/, (m, t) => nearDate(t, +m[1], +m[2])],
  [/来月の?(\d{1,2})日/, (m, t) => { const n = addDays(lastOfMonth(t), 1); return fullDate(+n.slice(0, 4), +n.slice(5, 7), +m[1]); }],
  [/今月の?(\d{1,2})日/, (m, t) => fullDate(+t.slice(0, 4), +t.slice(5, 7), +m[1])],
  [/明後日|あさって/, (m, t) => addDays(t, 2)],
  [/今日(?![子香])|本日|今夜|今晩/, (m, t) => t],
  [/明日(?![香葉美奈])|あした/, (m, t) => addDays(t, 1)],
  [/再来週の?([日月火水木金土])曜日?/, (m, t) => weekdayIn(addDays(mondayOf(t), 14), DOWS.indexOf(m[1]))],
  [/来週の?([日月火水木金土])曜日?/, (m, t) => weekdayIn(addDays(mondayOf(t), 7), DOWS.indexOf(m[1]))],
  [/今週の?([日月火水木金土])曜日?/, (m, t) => weekdayIn(mondayOf(t), DOWS.indexOf(m[1]))],
  [/(?<!先週の?|先々週の?|前の)(?:([日月火水木金土])曜日?|[(（]([日月火水木金土])[)）])/, (m, t) => nextWeekday(t, DOWS.indexOf(m[1] || m[2]))],
  [/来週末/, (m, t) => weekdayIn(addDays(mondayOf(t), 7), 6)],
  [/今週末|(?<![先来])週末|土日/, (m, t) => (dow(t) === 6 || dow(t) === 0 ? t : weekdayIn(mondayOf(t), 6))],
  [/来週中/, (m, t) => weekdayIn(addDays(mondayOf(t), 7), 5)],
  [/今週中|今週/, (m, t) => ([5, 6, 0].includes(dow(t)) ? t : weekdayIn(mondayOf(t), 5))],
  [/再来週/, (m, t) => addDays(mondayOf(t), 14)],
  [/来週/, (m, t) => addDays(mondayOf(t), 7)],
  [/来月末/, (m, t) => lastOfMonth(t, 1)],
  [/(?<![先前])月末/, (m, t) => lastOfMonth(t)],
  [/来月/, (m, t) => addDays(lastOfMonth(t), 1)],
  [/(\d{1,3})日後/, (m, t) => (+m[1] <= 366 ? addDays(t, +m[1]) : '')],
  [/(\d{1,2})週間後/, (m, t) => addDays(t, 7 * +m[1])],
];

// 文から最初の日付の言葉を探す → { due, index, length }
export function findWhen(text, today) {
  let best = null;
  for (const [re, fn] of WHEN_RULES) {
    const m = re.exec(text);
    if (!m) continue;
    const due = fn(m, today);
    if (due && (!best || m.index < best.index)) best = { due, index: m.index, length: m[0].length };
  }
  return best;
}
// 「明日」「金曜」「2026-10-30」などの言葉だけを日付にする（CLI の --due 用）
export function resolveWhen(word, today) {
  const w = String(word ?? '').trim();
  if (!w || /^(なし|無し|none|-)$/i.test(w)) return '';
  if (validYmd(w)) return w;
  // 言葉の全体が日付のときだけ（「来週の打ち合わせ前」のように一部だけ読めるものは、あいまいなので読まない）
  const hit = findWhen(w.normalize('NFKC'), today);
  if (!hit) return null;
  const rest = w.normalize('NFKC').slice(0, hit.index) + w.normalize('NFKC').slice(hit.index + hit.length);
  return /^\s*(?:までに|まで|中に|中|に|ごろ|頃)?\s*$/.test(rest) ? hit.due : null;
}

// 先頭・末尾にある日付の言葉は題名から外す（「明日 歯医者に電話」→「歯医者に電話」）。途中にあるものは文の一部なので残す
const AFTER_HEAD = /^(?:(?:までに|まで|中に)[\s、,，:：]*|[\s、,，:：]+|$)/;
function stripWhen(text, w) {
  const before = text.slice(0, w.index), after = text.slice(w.index + w.length);
  if (!before.trim()) {
    const m = AFTER_HEAD.exec(after);
    const rest = m ? after.slice(m[0].length).trim() : '';
    if (rest) return rest;
  }
  if (/^(?:までに|まで|中に|中)?\s*$/.test(after) && /[\s、,，]$/.test(before)) {
    const rest = before.replace(/[\s、,，]+$/, '').trim();
    if (rest) return rest;
  }
  return text;
}

// 1行を1件のタスクとして読む → { title, due, tags, url }
export function parseLine(line, today) {
  let text = oneLine(String(line ?? '').normalize('NFKC'), 1000);   // 全角の数字・記号（１０／３０、＃）もそろえて読む
  const url = findUrls(text).map(safeUrl).find(Boolean) || '';
  text = text.replace(/https?:\/\/[^\s<>"'「」（）()、。]+/g, ' ').replace(/\s+/g, ' ').trim();
  const tags = [];
  text = text.replace(/(^|\s)[#＃]([^\s#＃]{1,20})/g, (_, sp, tag) => { if (tags.length < 5 && !tags.includes(tag)) tags.push(tag); return sp; }).replace(/\s+/g, ' ').trim();
  const w = findWhen(text, today);
  if (w) text = stripWhen(text, w);
  if (!text && url) text = shortUrl(url);
  return { title: clip(text, 200), due: w?.due || '', tags, url };
}
export function parseInput(text, today) {
  return String(text ?? '').split('\n').map(l => l.trim().replace(/^(?:[-・*●○□☐]|\d{1,2}[.)．](?!\d))\s*/, '')).filter(Boolean).slice(0, 50)
    .map(l => parseLine(l, today)).filter(t => t.title);
}

// 入れるときの日付の選択肢
export function quickDates(today) {
  return [
    ['', 'なし'],
    [today, '今日'],
    [addDays(today, 1), '明日'],
    [dow(today) === 6 || dow(today) === 0 ? today : weekdayIn(mondayOf(today), 6), '今週末'],
    [addDays(mondayOf(today), 7), '来週'],
  ];
}

// ---- データ ----
export const VIAS = ['app', 'claude', 'link', 'share'];
const MAX_APPLIED = 1500, MAX_PENDING = 300, MAX_GONE = 1000;
const FIELDS = ['title', 'note', 'due', 'tags', 'url', 'status'];

export function emptyState() {
  return { v: 1, tasks: {}, log: { lastTime: 0, applied: [], pending: [], gone: [] }, updatedAt: 0, syncedAt: 0 };
}

export function sanitizeTags(v) {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,、，#＃]+/) : [];
  const out = [];
  for (const t of list) {
    const s = oneLine(t, 20).replace(/^[#＃]+/, '');
    if (s && !RESERVED.has(s) && !out.includes(s) && out.length < 5) out.push(s);
  }
  return out;
}
const sanitizeDue = v => (validYmd(v) ? v : '');
function sanitizeFrom(f) {
  const o = f && typeof f === 'object' ? f : {};
  return { via: VIAS.includes(o.via) ? o.via : 'app', where: oneLine(o.where, 60), device: oneLine(o.device, 24) };
}
export function sanitizeTask(x) {
  const o = x && typeof x === 'object' ? x : {};
  return {
    title: oneLine(o.title, 200),
    note: str(o.note, 3000).trim(),
    due: sanitizeDue(o.due),
    tags: sanitizeTags(o.tags),
    url: safeUrl(o.url || ''),
    from: sanitizeFrom(o.from),
  };
}
function sanitizeEdits(e) {
  const o = e && typeof e === 'object' ? e : {};
  const out = {};
  if (has(o, 'title')) out.title = oneLine(o.title, 200);
  if (has(o, 'note')) out.note = str(o.note, 3000).trim();
  if (has(o, 'due')) out.due = sanitizeDue(o.due);
  if (has(o, 'tags')) out.tags = sanitizeTags(o.tags);
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
// 届いた変更を当てる順番: 変更した時刻 → 中継に届いた時刻
export const byTime = (a, b) => ((Number(a.at) || 0) - (Number(b.at) || 0)) || ((Number(a.time) || 0) - (Number(b.time) || 0));

// 片づけ: 済んでから半年たったものは消す（多すぎるときは古い順に1000件まで）。1週間たっても項目が届かない変更は捨てる
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
export const BUCKETS = [
  ['overdue', '過ぎています'],
  ['today', '今日'],
  ['tomorrow', '明日'],
  ['week', '7日以内'],
  ['later', 'それより先'],
  ['none', '日付なし'],
];
export function bucketOf(task, today) {
  if (!task.due) return 'none';
  const d = diffDays(today, task.due);
  return d < 0 ? 'overdue' : d === 0 ? 'today' : d === 1 ? 'tomorrow' : d <= 7 ? 'week' : 'later';
}
export function sortTasks(list) {
  return [...list].sort((a, b) => (a.due && b.due ? a.due.localeCompare(b.due) : a.due ? -1 : b.due ? 1 : 0) || b.addedAt - a.addedAt);
}
export function groupTasks(list, today) {
  const g = new Map(BUCKETS.map(([k]) => [k, []]));
  for (const t of sortTasks(list)) g.get(bucketOf(t, today)).push(t);
  return BUCKETS.map(([key, label]) => ({ key, label, tasks: g.get(key) })).filter(x => x.tasks.length);
}
export function dueLabel(due, today) {
  if (!due) return '';
  const d = diffDays(today, due);
  if (d === 0) return '今日';
  if (d === 1) return '明日';
  if (d === -1) return '昨日';
  return due.slice(0, 4) === today.slice(0, 4) ? mdw(due) : `${due.slice(0, 4)}/${mdw(due)}`;
}
export function overdueDays(due, today) {
  return due ? Math.max(0, -diffDays(today, due)) : 0;
}
export function sourceLabel(from) {
  if (!from) return '';
  if (from.via === 'claude') return from.where ? `Claude · ${from.where}` : 'Claude';
  if (from.via === 'link') return 'リンクから';
  if (from.via === 'share') return '共有から';
  return from.device || '';
}
export function tagCounts(tasks) {
  const m = new Map();
  for (const t of tasks) for (const g of t.tags || []) m.set(g, (m.get(g) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
}
