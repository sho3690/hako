// Actions 用: 鍵の確認と、暗号化した data/state.json の読み書き。
import { readFile, writeFile } from 'node:fs/promises';
import { keysFrom, seal, open, openDrop, b64u, viewSeal, viewOpen, viewTag } from '../crypto.js';
import { emptyState, viewSnapshot } from '../logic.js';

export const ROOT = new URL('..', import.meta.url);
const STATE = new URL('data/state.json', ROOT);
const VIEW = new URL('data/view.json', ROOT);
export const fail = s => { console.log(`::error::${s}`); process.exit(1); };

export async function loadKeys() {
  const KEY = process.env.HAKO_KEY;
  if (!KEY) fail('HAKO_KEY が Secrets にありません');
  const cfg = JSON.parse(await readFile(new URL('config.json', ROOT), 'utf8'));
  const keys = await keysFrom(b64u.dec(KEY.trim()));
  if (keys.check !== cfg.check) fail('HAKO_KEY が config.json の合言葉と合いません');
  return { cfg, keys };
}
export async function loadState(keys) {
  const file = JSON.parse(await readFile(STATE, 'utf8').catch(() => '{}'));
  return file.sealed ? open(keys, file.sealed) : emptyState();
}
export async function saveState(keys, state) {
  await writeFile(STATE, JSON.stringify({ v: 1, sealed: await seal(keys, state) }) + '\n');
}
// 入れるだけのリンクの受け口（drop.json）。まだ作っていなければ null
export async function loadDrop(keys) {
  const text = await readFile(new URL('drop.json', ROOT), 'utf8').catch(() => null);
  return text ? openDrop(keys, JSON.parse(text)) : null;
}
// 見るためのリンク用の写し（data/view.json）。中身が変わったとき・鍵を作り直したときだけ書く（同じなら書かない＝コミットが増えない）
export async function saveView(view, state) {
  const snap = viewSnapshot(state);
  const vtag = await viewTag(view);
  const file = JSON.parse(await readFile(VIEW, 'utf8').catch(() => '{}'));
  if (file.vtag === vtag) {
    try { if (JSON.stringify((await viewOpen(view, file.sealed)).items) === JSON.stringify(snap.items)) return false; } catch { /* 開けなければ書き直す */ }
  }
  await writeFile(VIEW, JSON.stringify({ v: 1, vtag, sealed: await viewSeal(view, snap) }) + '\n');
  return true;
}
