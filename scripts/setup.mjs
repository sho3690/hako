// 合言葉と鍵を作り、config.json と空の data/state.json を書く（最初の1回と、合言葉を変えるとき）。
// 使い方: node scripts/setup.mjs [--keep-state]
//   --keep-state  いまの .secrets/master.b64 で開けるデータを、新しい鍵で封し直す（合言葉の変更）
// 生成した合言葉・鍵は .secrets/ に置く（.gitignore 済み。コミットしない）。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomPassphrase, randomBytes, b64u, deriveMaster, keysFrom, seal, open } from '../crypto.js';
import { emptyState } from '../logic.js';

const ROOT = new URL('..', import.meta.url);
const SITE = process.env.HAKO_SITE || 'https://sho3690.github.io/hako/';
const ITER = 210000;
const keep = process.argv.includes('--keep-state');

let state = emptyState();
if (keep) {
  const oldKeys = await keysFrom(b64u.dec((await readFile(new URL('.secrets/master.b64', ROOT), 'utf8')).trim()));
  const file = JSON.parse(await readFile(new URL('data/state.json', ROOT), 'utf8'));
  state = await open(oldKeys, file.sealed);
  state.log.lastTime = 0; state.log.applied = [];   // 新しい宛先の中継は空から始まる
}

const passphrase = randomPassphrase();
const salt = b64u.enc(randomBytes(16));
const master = await deriveMaster(passphrase, salt, ITER);
const keys = await keysFrom(master);

await mkdir(new URL('.secrets/', ROOT), { recursive: true });
await mkdir(new URL('data/', ROOT), { recursive: true });
await writeFile(new URL('config.json', ROOT), JSON.stringify({ v: 1, salt, iterations: ITER, check: keys.check, relay: 'https://ntfy.sh' }, null, 2) + '\n');
await writeFile(new URL('data/state.json', ROOT), JSON.stringify({ v: 1, sealed: await seal(keys, state) }) + '\n');
await writeFile(new URL('.secrets/master.b64', ROOT), b64u.enc(master) + '\n', { mode: 0o600 });
await writeFile(new URL('.secrets/owner.txt', ROOT), [
  '箱 HAKO の合言葉と、この端末で開くリンク（他の人に見せない）',
  '',
  `合言葉: ${passphrase}`,
  `開くだけで入れるリンク: ${SITE}#k=${b64u.enc(master)}`,
  '',
  'スマホで使うときは、上のリンクを自分のスマホにだけ送って開く（AirDrop など）か、アプリの画面で合言葉を入れる。',
  'GitHub の Secrets「HAKO_KEY」に .secrets/master.b64 の中身を登録すること:',
  '  gh secret set HAKO_KEY -R sho3690/hako < .secrets/master.b64',
].join('\n') + '\n', { mode: 0o600 });
console.log('config.json と data/state.json を作りました。合言葉と開くためのリンクは .secrets/owner.txt にあります。');
