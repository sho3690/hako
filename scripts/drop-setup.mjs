// 入れるだけのリンク（drop.html）の受け口を作る（最初の1回と、リンクを作り直すとき）。
// 使い方: node scripts/drop-setup.mjs [--rotate]
//   drop.json（公開鍵と、合言葉で封をした秘密鍵・受け口の宛先）を書く。コミットして push すると使えるようになる。
//   --rotate  宛先と鍵を作り直す。古いリンクは使えなくなる（リンクが知らない人に渡ったときに）。
// 宛先（リンクに入る文字）は画面に出さない。リンクは箱の画面の「設定」からコピーする。

import { readFile, writeFile } from 'node:fs/promises';
import { keysFrom, seal, b64u, dropKeyPair, dropTag, randomBytes } from '../crypto.js';

const ROOT = new URL('..', import.meta.url);
const FILE = new URL('drop.json', ROOT);
const rotate = process.argv.includes('--rotate');

if (!rotate && await readFile(FILE).then(() => true, () => false)) {
  console.log('drop.json はもうあります（作り直すときは --rotate）');
  process.exit(0);
}
const cfg = JSON.parse(await readFile(new URL('config.json', ROOT), 'utf8'));
const keys = await keysFrom(b64u.dec((await readFile(new URL('.secrets/master.b64', ROOT), 'utf8')).trim()));
if (keys.check !== cfg.check) { console.error('鍵が config.json の合言葉と合いません'); process.exit(1); }

const { pub, priv } = await dropKeyPair();
const topic = `hakod${b64u.enc(randomBytes(18))}`;   // 推測できない宛先。これを知っている人だけが入れられる
await writeFile(FILE, JSON.stringify({ v: 1, pub, tag: await dropTag(topic), sealed: await seal(keys, { topic, priv }) }, null, 1) + '\n');
console.log(`drop.json を${rotate ? '作り直しました（古いリンクはもう使えません）' : '作りました'}。コミットして push すると使えるようになります。`);
