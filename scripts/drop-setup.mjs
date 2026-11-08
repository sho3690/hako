// 入れる・見るためのリンク（drop.html）の受け口と鍵を作る（最初の1回と、リンクを作り直すとき）。
// 使い方: node scripts/drop-setup.mjs [--rotate | --rotate-view]
//   drop.json（公開鍵と、合言葉で封をした秘密鍵・受け口の宛先・見るための鍵）を書く。コミットして push すると使えるようになる。
//   引数なし      まだ無ければ作る。見るための鍵が無い古い drop.json なら、入れる側はそのままで見るための鍵だけ足す。
//   --rotate      全部作り直す。古いリンクは入れることも見ることもできなくなる（リンクが知らない人に渡ったときに）。
//   --rotate-view 見るための鍵だけ作り直す。古いリンクは入れることはできるが、箱の中は見えなくなる。
// 宛先と鍵（リンクに入る文字）は画面に出さない。リンクは箱の画面の「設定」からコピーする。

import { readFile, writeFile } from 'node:fs/promises';
import { keysFrom, seal, open, b64u, dropKeyPair, dropTag, randomBytes, newViewKey, viewTag } from '../crypto.js';

const ROOT = new URL('..', import.meta.url);
const FILE = new URL('drop.json', ROOT);
const rotate = process.argv.includes('--rotate');
const rotateView = process.argv.includes('--rotate-view');

const cfg = JSON.parse(await readFile(new URL('config.json', ROOT), 'utf8'));
const keys = await keysFrom(b64u.dec((await readFile(new URL('.secrets/master.b64', ROOT), 'utf8')).trim()));
if (keys.check !== cfg.check) { console.error('鍵が config.json の合言葉と合いません'); process.exit(1); }

const old = await readFile(FILE, 'utf8').then(t => JSON.parse(t), () => null);
let pub, topic, priv, view, msg;
if (old && !rotate) {
  const s = await open(keys, old.sealed);
  if (s.view && !rotateView) { console.log('drop.json はもうあります（作り直すときは --rotate か --rotate-view）'); process.exit(0); }
  ({ topic, priv } = s); pub = old.pub; view = newViewKey();
  msg = rotateView ? '見るための鍵を作り直しました（古いリンクでは箱の中が見えなくなります。入れることはできます）' : '見るための鍵を足しました（入れるためのリンクはそのまま使えます）';
} else {
  ({ pub, priv } = await dropKeyPair());
  topic = `hakod${b64u.enc(randomBytes(18))}`;   // 推測できない宛先。これを知っている人だけが入れられる
  view = newViewKey();                            // 箱の中の写しを開ける鍵。これを知っている人だけが見られる
  msg = old ? '全部作り直しました（古いリンクはもう使えません）' : '作りました';
}
await writeFile(FILE, JSON.stringify({ v: 1, pub, tag: await dropTag(topic), vtag: await viewTag(view), sealed: await seal(keys, { topic, priv, view }) }, null, 1) + '\n');
console.log(`drop.json を${msg}。コミットして push すると使えるようになります（箱の中の写しは次の同期で作られます）。`);
