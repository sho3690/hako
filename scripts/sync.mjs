// GitHub Actions から15分ごとに実行する。
// 1) 中継に届いた追加・変更を取り込む 2) 入れるだけのリンクから届いたものを取り込む
// 3) 済んでから半年たったものを片づける 4) 暗号化して data/state.json に保存
// 公開リポジトリのログは誰でも読めるので、件数以外（題名・メモ・エラー文）は出力しない。

import { appendFile } from 'node:fs/promises';
import { poll } from '../relay.js';
import { open, dropOpen } from '../crypto.js';
import { applyEvent, maintain, byTime, fromDrop } from '../logic.js';
import { loadKeys, loadState, saveState, loadDrop } from './state-io.mjs';

const log = [];
const say = s => { log.push(s); console.log(s); };

async function main() {
  const { cfg, keys } = await loadKeys();
  const state = await loadState(keys);
  const before = JSON.stringify(state);
  const now = Date.now();

  let msgs = [];
  try {
    const since = state.log.lastTime ? Math.max(0, state.log.lastTime - 900) : 'all';
    msgs = await poll(cfg.relay, keys.topic, since);
  } catch (e) { say(`中継に届きませんでした（次の回で取り込みます）: ${e.name}`); }
  const evs = [];
  let broken = 0;
  for (const m of msgs) {
    try {
      const ev = await open(keys, m.message);
      if (!ev || typeof ev !== 'object' || Array.isArray(ev)) { broken++; continue; }
      ev.time = m.time;
      evs.push(ev);
    } catch { broken++; }   // 他の鍵のメッセージや壊れたもの1件で同期全体を止めない
  }
  evs.sort(byTime);
  let applied = 0;
  for (const ev of evs) { try { if (applyEvent(state, ev)) applied++; } catch { broken++; } }
  say(`中継: ${msgs.length}件を確認、${applied}件を反映${broken ? `、読めないもの${broken}件` : ''}`);

  // 入れるだけのリンク（Mac を通さずに ChatGPT などが入れたもの）
  let drop = null;
  try { drop = await loadDrop(keys); } catch { say('drop.json を開けませんでした（合言葉を変えたあとなら scripts/drop-setup.mjs で作り直す）'); }
  if (drop) {
    let dmsgs = [];
    try {
      const dt = state.log.dropTime;
      dmsgs = await poll(cfg.relay, drop.topic, dt ? Math.max(0, dt - 900) : 'all');
    } catch (e) { say(`受け口に届きませんでした（次の回で取り込みます）: ${e.name}`); }
    let added = 0, bad = 0;
    for (const m of dmsgs) {
      try { for (const ev of fromDrop(await dropOpen(drop.key, m.message), m.time)) if (applyEvent(state, ev)) added++; }
      catch { bad++; }
      if (m.time > (state.log.dropTime || 0)) state.log.dropTime = m.time;
    }
    say(`受け口: ${dmsgs.length}件を確認、${added}件を追加${bad ? `、読めないもの${bad}件` : ''}`);
  }

  if (maintain(state, now)) say('片づけ: 済んでから半年たったものを整理');

  if (JSON.stringify(state) !== before) {
    state.syncedAt = now;
    await saveState(keys, state);
    say('保存しました');
  } else say('変更なし');
}

try { await main(); }
catch (e) { say(`同期に失敗しました: ${e?.name || 'Error'}`); process.exitCode = 1; }   // エラー文には中身が混ざりうるので種類だけ
finally { if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, log.map(l => `- ${l}`).join('\n') + '\n'); }
