// 箱 HAKO — 入れるだけのページ（drop.html）。合言葉なしで、箱に入れることだけができる（中は見えない）。
// Mac がオフラインでも、ChatGPT の dots などが自分のブラウザで開いて入れられるように。
// リンク: drop.html#w=<受け口>&by=<だれから（例: ChatGPT）>&t=<入れるもの>&n=<メモ>（t と n は省いて、開いてから書いてもよい）
import { parseInput, clip, DROP_MAX_ITEMS } from './logic.js';
import { dropSeal, dropTag, b64u } from './crypto.js';
import { publish, MAX_BODY } from './relay.js';

const $ = s => document.querySelector(s);
const form = $('#drop-form'), ta = $('#t'), note = $('#n'), go = $('#go'), err = $('#t-err'), result = $('#result'), problem = $('#problem');

function showProblem(title, text, retry = false) {
  form.hidden = true;
  problem.hidden = false;
  problem.replaceChildren(Object.assign(document.createElement('h2'), { textContent: title }), Object.assign(document.createElement('p'), { textContent: text }));
  if (retry) problem.append(Object.assign(document.createElement('button'), { className: 'btn btn-secondary', type: 'button', textContent: '開き直す', onclick: () => location.reload() }));
}
function fieldError(msg) {
  err.hidden = !msg; err.textContent = msg;
  if (msg) { ta.setAttribute('aria-invalid', 'true'); ta.focus(); } else ta.removeAttribute('aria-invalid');
}

// 同じ中身を同じ1時間のうちに二度送っても、箱には1つだけ入る（押し直し・開き直しで二重にならない）
async function dropId(w, by, noteText, text) {
  const src = new TextEncoder().encode([w, Math.floor(Date.now() / 3600000), by, noteText, text].join('\n'));
  return b64u.enc(new Uint8Array(await crypto.subtle.digest('SHA-256', src))).slice(0, 22);
}

async function main() {
  // 他のサイトの枠（iframe）の中では開かない
  if (window.top !== window.self) { document.body.textContent = ''; return; }
  const q = new URLSearchParams(location.hash.slice(1));
  const w = q.get('w') || '';
  const by = (q.get('by') || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(w)) return showProblem('このリンクでは入れられません', 'リンクが途中で切れているようです。箱の「設定」にある「入れるだけのリンク」を、そのまま使ってください。');

  let cfg, drop;
  try {
    [cfg, drop] = await Promise.all(['./config.json', './drop.json'].map(u => fetch(u, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })));
  } catch { return showProblem('読み込めませんでした', '電波の良い所で、開き直してください。', true); }
  if (!drop?.pub || drop.tag !== await dropTag(w)) return showProblem('このリンクは使えなくなっています', 'リンクが作り直されたか、途中で切れています。箱の「設定」から新しい「入れるだけのリンク」をもらってください。');

  ta.value = (q.get('t') || '').slice(0, 4000);
  note.value = (q.get('n') || '').slice(0, 1500);
  form.hidden = false;
  ta.addEventListener('input', () => { fieldError(''); result.hidden = true; });
  if (!ta.value) ta.focus();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (go.disabled) return;
    const items = parseInput(ta.value);
    if (!items.length) return fieldError('入れるものを書いてください');
    if (items.length > DROP_MAX_ITEMS) return fieldError(`一度に入れられるのは${DROP_MAX_ITEMS}件までです。分けて入れてください`);
    fieldError('');
    const memo = note.value.trim();
    go.disabled = true; go.classList.add('loading');
    try {
      const body = await dropSeal(drop.pub, { v: 1, id: await dropId(w, by, memo, ta.value.trim()), items, note: memo, by });
      if (body.length > MAX_BODY) { fieldError('長すぎて送れません。メモを短くするか、分けて入れてください'); return; }
      let sent = false;
      for (const wait of [0, 1500, 4000]) {
        if (wait) await new Promise(r => setTimeout(r, wait));
        try { await publish(cfg.relay, w, body); sent = true; break; } catch { /* もう一度 */ }
      }
      if (!sent) { fieldError('送れませんでした。電波を確かめて、もう一度「箱に入れる」を押してください'); return; }
      ta.value = ''; note.value = '';
      result.hidden = false;
      result.replaceChildren(
        Object.assign(document.createElement('p'), { className: 'drop-done', textContent: `箱に入れました（${items.length}件）` }),
        Object.assign(document.createElement('ul'), {}),
        Object.assign(document.createElement('p'), { className: 'help', textContent: '続けて入れるときは、また書いて押してください。' }));
      result.querySelector('ul').append(...items.map(i => Object.assign(document.createElement('li'), { textContent: clip(i.title, 60) })));
      result.scrollIntoView({ block: 'nearest' });
    } finally { go.disabled = false; go.classList.remove('loading'); }
  });
}

main();
