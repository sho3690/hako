import { test } from 'node:test';
import assert from 'node:assert/strict';
import { b64u, deriveMaster, keysFrom, seal, open, randomPassphrase, normalizePassphrase } from '../crypto.js';

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
