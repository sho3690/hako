import { test } from 'node:test';
import assert from 'node:assert/strict';
import { b64u, deriveMaster, keysFrom, seal, open, randomPassphrase, normalizePassphrase, dropKeyPair, dropSeal, dropOpen, dropTag, openDrop } from '../crypto.js';

test('合言葉は読み違えにくい文字で約100ビット', () => {
  const p = randomPassphrase();
  assert.match(p, /^[2-9a-hjkmnp-z]{5}(-[2-9a-hjkmnp-z]{5}){3}$/);
  assert.notEqual(p, randomPassphrase());
  assert.equal(normalizePassphrase(' ABCDE-fghjk '), 'abcdefghjk');
});

test('封をして開ける（日本語・大きめのデータ）', async () => {
  const salt = b64u.enc(new Uint8Array(16).fill(7));
  const m = await deriveMaster('k7m2q-x9p4t-aaaaa-bbbbb', salt, 1000);
  const keys = await keysFrom(m);
  assert.match(keys.topic, /^[0-9a-f]{32}$/);
  const obj = { text: '歯医者に電話する📞'.repeat(200), n: 1 };
  const sealed = await seal(keys, obj);
  assert.ok(sealed.startsWith('hk1.'));
  assert.ok(sealed.length < JSON.stringify(obj).length, '圧縮される');
  assert.deepEqual(await open(keys, sealed), obj);
  // 大文字・空白違いでも同じ鍵
  const m2 = await deriveMaster('K7M2Q X9P4T AAAAA BBBBB', salt, 1000);
  assert.equal(b64u.enc(m2), b64u.enc(m));
});

test('違う鍵では開かない', async () => {
  const salt = b64u.enc(new Uint8Array(16));
  const a = await keysFrom(await deriveMaster('aaaaa', salt, 1000));
  const b = await keysFrom(await deriveMaster('bbbbb', salt, 1000));
  const sealed = await seal(a, { x: 1 });
  await assert.rejects(open(b, sealed));
  assert.notEqual(a.topic, b.topic);
});

test('入れるだけのリンク: 公開鍵で封をして、箱の鍵を持つ側だけが開ける', async () => {
  const keys = await keysFrom(await deriveMaster('aaaaa', b64u.enc(new Uint8Array(16)), 1000));
  const { pub, priv } = await dropKeyPair();
  assert.equal(pub.d, undefined, '公開する鍵に秘密の部分が入っていない');
  const topic = 'hakodTESTtopic0123456789';
  const file = { v: 1, pub, tag: await dropTag(topic), sealed: await seal(keys, { topic, priv }) };
  assert.ok(!JSON.stringify({ pub: file.pub, tag: file.tag }).includes(topic), '宛先は公開部分に出ない');
  const drop = await openDrop(keys, file);
  assert.equal(drop.topic, topic);

  const msg = { v: 1, id: 'abc', items: [{ title: '歯医者に電話📞', url: '' }], note: 'メモ', by: 'ChatGPT' };
  const a = await dropSeal(pub, msg), b = await dropSeal(pub, msg);
  assert.ok(a.startsWith('hd1.'));
  assert.notEqual(a, b, '毎回ちがう使い捨ての鍵で封をする');
  assert.deepEqual(await dropOpen(drop.key, a), msg);

  const other = await keysFrom(await deriveMaster('bbbbb', b64u.enc(new Uint8Array(16)), 1000));
  await assert.rejects(openDrop(other, file), '合言葉の違う箱では受け口を開けない');
  const stranger = await dropKeyPair();
  const strangerKey = await openDrop(keys, { sealed: await seal(keys, { topic, priv: stranger.priv }) });
  await assert.rejects(dropOpen(strangerKey.key, a), '別の鍵では開かない');
  const raw = b64u.dec(a.slice(4)); raw[raw.length - 1] ^= 1;
  await assert.rejects(dropOpen(drop.key, 'hd1.' + b64u.enc(raw)), '書き換えられたものは開かない');
  await assert.rejects(dropOpen(drop.key, 'hk1.xxxx'));
  assert.notEqual(await dropTag(topic), await dropTag(topic.slice(0, -1)), '途中で切れたリンクは見分けられる');
});
