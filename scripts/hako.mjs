#!/usr/bin/env node
// 箱 HAKO — このMacから箱に入れる・見る・済みにする道具。Claude Code のスキル（~/.claude/skills/hako）が使う。
// 鍵は .secrets/master.b64（コミットしない）から読み、画面には出さない。送るものはすべて封をしてから中継へ。
//
//   node ~/hako/scripts/hako.mjs add "やること" ["やること2" …] [--due 明日] [--note "…"] [--tag 仕事] [--url https://…] [--where 名前]
//   node ~/hako/scripts/hako.mjs add --json -      … 標準入力から [{"title","due","note","tags","url"}]（Claude が文脈から決めた形）
//   node ~/hako/scripts/hako.mjs list [--done] [--tags] [--json]
//   node ~/hako/scripts/hako.mjs done|reopen|delete <番号 か 題名の一部>
//   node ~/hako/scripts/hako.mjs edit <番号 か 題名の一部> [--title …] [--due …] [--note …] [--tag …] [--url …]
//   node ~/hako/scripts/hako.mjs today             … 今日の日付（朝7時区切り）

import { readFile, writeFile, readdir, rename, unlink, mkdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { keysFrom, seal, open, b64u } from '../crypto.js';
import { publish, poll, MAX_BODY } from '../relay.js';
import * as L from '../logic.js';

const ROOT = new URL('..', import.meta.url);
const SITE = process.env.HAKO_SITE || 'https://sho3690.github.io/hako/';
const SENT_DIR = new URL('.secrets/sent/', ROOT);   // 送ったものの控え（1件1ファイル。同時に動いても上書きし合わない）
const VALUE_OPTS = new Set(['due', 'note', 'tag', 'tags', 'url', 'where', 'title', 'json']);

class Stop extends Error {}
const stop = msg => { throw new Stop(msg); };

function parseArgs(argv) {
  const [cmd = 'help', ...rest] = argv;
  const pos = [], opt = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    const takesValue = VALUE_OPTS.has(k) && cmd !== 'list';   // list の --json / --tags / --done は印だけ
    if (!takesValue) { opt[k] = true; continue; }
    const v = inline ?? rest[++i];
    if (v === undefined) stop(`--${k} のあとに値がありません`);
    opt[k] = v;
  }
  return { cmd, pos, opt };
}

async function loadKeys() {
  let master;
  try { master = (await readFile(new URL('.secrets/master.b64', ROOT), 'utf8')).trim(); }
  catch { stop(`鍵が見つかりません（${new URL('.secrets/master.b64', ROOT).pathname}）。箱 HAKO の準備ができていないようです。`); }
  const cfg = JSON.parse(await readFile(new URL('config.json', ROOT), 'utf8'));
  const keys = await keysFrom(b64u.dec(master));
  if (keys.check !== cfg.check) stop('鍵が config.json の合言葉と合いません（合言葉を変えたあとなら .secrets を作り直してください）');
  return { cfg, keys };
}

async function readSealedState(keys, text) {
  const f = JSON.parse(text);
  return f.sealed ? open(keys, f.sealed) : L.emptyState();
}
// 保存済みのデータ: 公開ページ → GitHub の生ファイル → 手元の控え の順に試す
async function fetchState(keys) {
  for (const u of [`${SITE}data/state.json?t=${Date.now()}`, 'https://raw.githubusercontent.com/sho3690/hako/main/data/state.json']) {
    try {
      const res = await fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (res.ok) return await readSealedState(keys, await res.text());
    } catch { /* 次を試す */ }
  }
  try { return await readSealedState(keys, await readFile(new URL('data/state.json', ROOT), 'utf8')); } catch { return null; }
}

// 保存済み＋中継に届いている変更を合わせた「いまの箱」
async function current({ cfg, keys }) {
  const state = await fetchState(keys);
  if (!state) stop('箱のデータを読み込めませんでした。ネットにつながっているか確かめてください。');
  const evs = [];
  try {
    const last = state.log.lastTime;
    for (const m of await poll(cfg.relay, keys.topic, last ? Math.max(0, last - 900) : 'all')) {
      try { const ev = await open(keys, m.message); if (typeof ev?.id === 'string') { ev.time = m.time; evs.push(ev); } } catch { /* 読めないものは飛ばす */ }
    }
  } catch { /* 中継に届かなければ保存済みだけで見る */ }
  // 自分が送ったばかりのもの（中継の読み出しに出てくるまで少しかかる）も入れて見る
  const seen = new Set(evs.map(e => e.id));
  for (const s of await loadSent()) {
    if (seen.has(s.id)) continue;
    try { const ev = await open(keys, s.body); if (typeof ev?.id === 'string') evs.push(ev); } catch { /* 飛ばす */ }
  }
  evs.sort(L.byTime);
  // 保存済みに入ったもの（項目待ちで預かっているものも含む）
  const applied = new Set([...state.log.applied, ...(state.log.pending || []).map(p => p.id)]);
  for (const ev of evs) { try { L.applyEvent(state, ev); } catch { /* 飛ばす */ } }
  return { state, applied, relayIds: seen };
}

// ---- 送る（届かなかったものは次に使ったときに送り直す）----
async function keep(rec) {
  await mkdir(SENT_DIR, { recursive: true, mode: 0o700 });
  const tmp = new URL(`${rec.id}.tmp`, SENT_DIR);
  await writeFile(tmp, JSON.stringify(rec), { mode: 0o600 });
  await rename(tmp, new URL(`${rec.id}.json`, SENT_DIR));
}
async function loadSent() {
  let names = [];
  try { names = (await readdir(SENT_DIR)).filter(n => /^[A-Za-z0-9-]+\.json$/.test(n)); } catch { return []; }
  const list = await Promise.all(names.map(n => readFile(new URL(n, SENT_DIR), 'utf8').then(JSON.parse).catch(() => null)));
  return list.filter(r => r && typeof r.id === 'string' && typeof r.body === 'string');
}
const forget = id => unlink(new URL(`${id}.json`, SENT_DIR)).catch(() => {});

async function sealFit(keys, ev) {
  let body = await seal(keys, ev);
  for (const n of [1500, 800, 300, 100]) {
    if (body.length <= MAX_BODY) break;
    const e = structuredClone(ev);
    if (e.task?.note) e.task.note = e.task.note.slice(0, n);
    if (e.edits?.note) e.edits.note = e.edits.note.slice(0, n);
    body = await seal(keys, e);
  }
  if (body.length > MAX_BODY) stop('長すぎて送れませんでした。メモを短くしてください。');
  return body;
}

// 先に全部を封をして控えに置いてから送る（途中で失敗しても、残りが消えない）
async function send(ctx, list) {
  const recs = [];
  for (const ev of list) {
    const rec = { id: ev.id, body: await sealFit(ctx.keys, ev), at: 0, first: Date.now() };
    await keep(rec);
    recs.push(rec);
  }
  let failed = 0;
  for (const rec of recs) {
    let ok = false;
    for (const wait of [0, 1000, 3000]) {
      if (wait) await new Promise(r => setTimeout(r, wait));
      try { await publish(ctx.cfg.relay, ctx.keys.topic, rec.body); ok = true; break; } catch { /* もう一度 */ }
    }
    if (ok) { rec.at = Date.now(); await keep(rec); } else failed++;
  }
  if (failed) stop(`${recs.length}件のうち${failed}件が中継（ntfy.sh）に届きませんでした。控えてあるので、次に箱を使ったときに自動で送り直します。`);
}

// 送ったのに保存にも中継にも見当たらないもの（中継の預かり期限切れ・送信失敗）を送り直す
async function resendLost(ctx, cur) {
  const now = Date.now();
  for (const s of await loadSent()) {
    if (cur.applied.has(s.id) || now - s.first > 3 * 86400000) { await forget(s.id); continue; }
    if (cur.relayIds.has(s.id) || now - s.at < 60000) continue;
    try {
      await publish(ctx.cfg.relay, ctx.keys.topic, s.body);
      s.at = now; await keep(s);
      L.applyEvent(cur.state, await open(ctx.keys, s.body));   // 送り直したものも、この回の表示に入れる
    } catch { /* 次の機会に */ }
  }
}

// ---- 表示 ----
function shortIds(tasks) {
  const ids = Object.keys(tasks);
  const out = new Map();
  for (const id of ids) {
    let n = 4;
    while (n < id.length && ids.some(o => o !== id && o.startsWith(id.slice(0, n)))) n++;
    out.set(id, id.slice(0, n));
  }
  return out;
}
function line(t, today, short) {
  const bits = [];
  if (t.due) bits.push(L.dueLabel(t.due, today) === L.mdw(t.due) ? L.mdw(t.due) : `${L.dueLabel(t.due, today)} ${L.mdw(t.due)}`);
  const late = t.status === 'open' ? L.overdueDays(t.due, today) : 0;
  if (late) bits.push(`${late}日過ぎ`);
  const src = L.sourceLabel(t.from);
  return `  [${short}] ${t.title}${bits.length ? `（${bits.join('・')}）` : ''}${t.tags.map(g => ` #${g}`).join('')}${src ? `  — ${src}` : ''}`;
}
function resolve(state, ref, status) {
  const r = String(ref ?? '').trim().replace(/^\[|\]$/g, '').replace(/^#/, '');
  if (!r) stop('どれのことか（番号か題名の一部）を指定してください');
  const pool = Object.values(state.tasks).filter(t => !status || t.status === status);
  let hits = /^[A-Za-z0-9_-]{3,}$/.test(r) ? pool.filter(t => t.id.toLowerCase().startsWith(r.toLowerCase())) : [];
  if (!hits.length) hits = pool.filter(t => t.title.includes(r));
  if (hits.length === 1) return hits[0];
  if (!hits.length) stop(`「${r}」に当たるものが箱にありません`);
  const sid = shortIds(state.tasks);
  stop(`「${r}」に当たるものが${hits.length}件あります。番号で指定してください:\n${hits.slice(0, 10).map(t => line(t, L.jstToday(), sid.get(t.id))).join('\n')}`);
}
const ev = (t, payload) => ({ id: randomUUID(), t, at: Date.now(), ...payload });
function dueOpt(v, today) {
  const d = L.resolveWhen(v, today);
  if (d === null) stop(`日付の言葉「${v}」が読めません（例: 今日・明日・金曜・来週・月末・10/30・2026-10-30・なし）`);
  return d;
}
async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

// ---- コマンド ----
async function main() {
  const { cmd, pos, opt } = parseArgs(process.argv.slice(2));
  const today = L.jstToday();

  if (cmd === 'today') { console.log(`${today}（${L.DOW_JA[L.dow(today)]}）※朝7時区切り`); return; }
  if (cmd === 'help' || cmd === '--help') { console.log((await readFile(new URL(import.meta.url), 'utf8')).split('\n').slice(1, 10).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); return; }

  const ctx = await loadKeys();

  if (cmd === 'add') {
    let items;
    if (opt.json != null) {
      let parsed;
      try { parsed = JSON.parse(opt.json === '-' ? await readStdin() : opt.json); } catch { stop('--json の中身が JSON として読めません'); }
      items = (Array.isArray(parsed) ? parsed : [parsed]).map(x => (typeof x === 'string' ? L.parseLine(x, today) : { ...x, due: x?.due ? dueOpt(x.due, today) : '' }));
    } else items = pos.flatMap(p => L.parseInput(p, today));
    const cwd = process.cwd();
    const where = opt.where ?? (cwd === homedir() ? '' : basename(cwd));
    const common = {};
    if (opt.due != null) common.due = dueOpt(opt.due, today);
    if (opt.note != null) common.note = opt.note;
    if (opt.tag != null || opt.tags != null) common.tags = String(opt.tag ?? opt.tags);
    if (opt.url != null) common.url = opt.url;
    const tasks = items.map(x => {
      const merged = { ...x, ...Object.fromEntries(Object.entries(common).filter(([k]) => k !== 'tags' && !(k === 'due' && x.due))) };
      if (common.tags) merged.tags = [...L.sanitizeTags(x.tags), ...L.sanitizeTags(common.tags)];
      return { id: randomUUID(), ...L.sanitizeTask({ ...merged, from: { via: 'claude', where, device: 'Mac' } }) };
    }).filter(t => t.title);
    if (!tasks.length) stop('入れるものがありません（やることの文を渡してください）');
    await send(ctx, tasks.map(task => ev('task.add', { task })));
    console.log(`「箱」に入れました（${tasks.length}件）`);
    for (const t of tasks) console.log(`・${t.title}${t.due ? `（${L.dueLabel(t.due, today)}${L.dueLabel(t.due, today) === L.mdw(t.due) ? '' : ` ${L.mdw(t.due)}`}）` : ''}${t.tags.map(g => ` #${g}`).join('')}`);
    console.log(`画面: ${SITE}`);
    const sent = await loadSent();
    if (sent.some(s => Date.now() - s.at > 1800000)) {   // 前に届かなかったもの・古いものがあるときだけ確かめる
      try { await resendLost(ctx, await current(ctx)); } catch { /* 次の機会に */ }
    }
    return;
  }

  const cur = await current(ctx);
  const { state } = cur;
  await resendLost(ctx, cur).catch(() => {});
  const sid = shortIds(state.tasks);
  const open_ = Object.values(state.tasks).filter(t => t.status === 'open');

  if (cmd === 'list') {
    if (opt.tags) {
      const tc = L.tagCounts(open_);
      console.log(tc.length ? tc.map(([g, n]) => `#${g}（${n}）`).join('  ') : 'タグはまだありません');
      return;
    }
    if (opt.json) {
      const pick = opt.done ? Object.values(state.tasks).filter(t => t.status === 'done') : open_;
      console.log(JSON.stringify(L.sortTasks(pick).map(t => ({ id: t.id, short: sid.get(t.id), title: t.title, due: t.due, bucket: L.bucketOf(t, today), tags: t.tags, note: t.note, url: t.url, status: t.status, source: L.sourceLabel(t.from), addedAt: t.addedAt, doneAt: t.doneAt })), null, 1));
      return;
    }
    if (opt.done) {
      const done = Object.values(state.tasks).filter(t => t.status === 'done').sort((a, b) => b.doneAt - a.doneAt).slice(0, 20);
      console.log(`箱 HAKO — 済み（新しい順に${done.length}件）`);
      for (const t of done) console.log(line(t, today, sid.get(t.id)));
      return;
    }
    console.log(`箱 HAKO — 残り ${open_.length}件（${L.mdw(today)} 時点）`);
    for (const g of L.groupTasks(open_, today)) {
      console.log(`■ ${g.label}`);
      for (const t of g.tasks) console.log(line(t, today, sid.get(t.id)));
    }
    if (!open_.length) console.log('  （空っぽです）');
    return;
  }

  if (cmd === 'done' || cmd === 'reopen' || cmd === 'delete') {
    const t = resolve(state, pos.join(' '), cmd === 'reopen' ? 'done' : cmd === 'done' ? 'open' : null);
    await send(ctx, [ev(cmd === 'done' ? 'task.done' : cmd === 'reopen' ? 'task.reopen' : 'task.delete', { taskId: t.id })]);
    console.log(`${cmd === 'done' ? '済みにしました' : cmd === 'reopen' ? '未完了に戻しました' : '削除しました'}: ${t.title}`);
    return;
  }

  if (cmd === 'edit') {
    const t = resolve(state, pos.join(' '), null);
    const edits = {};
    if (opt.title != null) edits.title = opt.title;
    if (opt.due != null) edits.due = dueOpt(opt.due, today);
    if (opt.note != null) edits.note = opt.note;
    if (opt.tag != null || opt.tags != null) edits.tags = String(opt.tag ?? opt.tags);
    if (opt.url != null) edits.url = opt.url;
    if (!Object.keys(edits).length) stop('変える項目（--title / --due / --note / --tag / --url）を指定してください');
    await send(ctx, [ev('task.edit', { taskId: t.id, edits })]);
    console.log(`直しました: ${edits.title || t.title}${has(edits, 'due') ? `（${edits.due ? L.mdw(edits.due) : '日付なし'}）` : ''}`);
    return;
  }

  stop(`知らないコマンドです: ${cmd}（add / list / done / reopen / edit / delete / today）`);
}
const has = (o, k) => Object.hasOwn(o, k);

try { await main(); }
catch (e) {
  if (e instanceof Stop) { console.error(e.message); process.exitCode = 1; }
  else { console.error(`うまく動きませんでした: ${e?.name || 'Error'}`); process.exitCode = 2; }
}
