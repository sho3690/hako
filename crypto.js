// 暗号化。合言葉 → 鍵（PBKDF2）→ AES-GCM で封をする。ブラウザと Node 22 の両方で動く（Web Crypto）。
// 公開リポジトリに置くデータも、中継に流すメッセージも、すべてこの封の中に入れる（土日 DONICHI と同じしくみ・別の鍵）。

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();
export const PREFIX = 'hk1.';

export const b64u = {
  enc(bytes) {
    let s = '';
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    const s = atob(String(str).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};

// 合言葉は大文字小文字・空白・ハイフンを区別しない
export const normalizePassphrase = p => String(p ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');

const ALPHA = '23456789abcdefghjkmnpqrstuvwxyz';   // 0/1/i/l/o は読み違えるので使わない
export function randomPassphrase(groups = 4, size = 5) {
  const out = [];
  const buf = new Uint8Array(groups * size * 2);
  globalThis.crypto.getRandomValues(buf);
  let k = 0;
  for (let g = 0; g < groups; g++) {
    let s = '';
    while (s.length < size) { const v = buf[k++ % buf.length]; if (v < 248) s += ALPHA[v % ALPHA.length]; else globalThis.crypto.getRandomValues(buf); }
    out.push(s);
  }
  return out.join('-');
}
export const randomBytes = n => globalThis.crypto.getRandomValues(new Uint8Array(n));

export async function deriveMaster(passphrase, saltB64u, iterations) {
  const base = await subtle.importKey('raw', te.encode(normalizePassphrase(passphrase)), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64u.dec(saltB64u), iterations }, base, 256);
  return new Uint8Array(bits);
}

async function hmac(master, label) {
  const k = await subtle.importKey('raw', master, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, te.encode(label)));
}
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');

// 親鍵から用途ごとの鍵を作る: 封（AES）・中継の宛先（topic）・合言葉の確認用（check）
export async function keysFrom(master) {
  const m = master instanceof Uint8Array ? master : b64u.dec(master);
  const aes = await subtle.importKey('raw', await hmac(m, 'hako/enc/v1'), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { aes, topic: hex(await hmac(m, 'hako/topic/v1')).slice(0, 32), check: hex(await hmac(m, 'hako/check/v1')).slice(0, 16) };
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function seal(keys, obj) {
  const plain = await pipe(te.encode(JSON.stringify(obj)), new CompressionStream('deflate-raw'));
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, keys.aes, plain));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return PREFIX + b64u.enc(out);
}

export async function open(keys, sealed) {
  if (typeof sealed !== 'string' || !sealed.startsWith(PREFIX)) throw new Error('not sealed');
  const raw = b64u.dec(sealed.slice(PREFIX.length));
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, keys.aes, raw.subarray(12));
  return JSON.parse(td.decode(await pipe(new Uint8Array(plain), new DecompressionStream('deflate-raw'))));
}

// ---- 入れるだけのリンク（drop.html）----
// 合言葉を持たない相手（ChatGPT の dots など）が、Mac を通さずに入れるための封。公開鍵で封をする（ECDH P-256 → HKDF → AES-GCM）。
// リンクを持つ人は入れられるが、箱の中も、他の人がこのリンクで入れたものも読めない。開ける秘密鍵は drop.json の中で、合言葉の封をしてある。
export const DROP_PREFIX = 'hd1.';
const EC = { name: 'ECDH', namedCurve: 'P-256' };
const DROP_INFO = te.encode('hako/drop/v1');

export async function dropKeyPair() {
  const k = await subtle.generateKey(EC, true, ['deriveBits']);
  return { pub: await subtle.exportKey('jwk', k.publicKey), priv: await subtle.exportKey('jwk', k.privateKey) };
}
async function dropAes(shared, epk, usage) {
  const base = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: epk, info: DROP_INFO }, base, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
export async function dropSeal(pubJwk, obj) {
  const pub = await subtle.importKey('jwk', pubJwk, EC, false, []);
  const eph = await subtle.generateKey(EC, true, ['deriveBits']);
  const epk = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const aes = await dropAes(await subtle.deriveBits({ name: 'ECDH', public: pub }, eph.privateKey, 256), epk, 'encrypt');
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, aes, await pipe(te.encode(JSON.stringify(obj)), new CompressionStream('deflate-raw'))));
  const out = new Uint8Array(epk.length + iv.length + ct.length);
  out.set(epk); out.set(iv, epk.length); out.set(ct, epk.length + iv.length);
  return DROP_PREFIX + b64u.enc(out);
}
export async function dropOpen(privKey, sealed) {
  if (typeof sealed !== 'string' || !sealed.startsWith(DROP_PREFIX)) throw new Error('not a drop');
  const raw = b64u.dec(sealed.slice(DROP_PREFIX.length));
  if (raw.length < 65 + 12 + 16) throw new Error('too short');
  const epk = raw.slice(0, 65);
  const pub = await subtle.importKey('raw', epk, EC, false, []);
  const aes = await dropAes(await subtle.deriveBits({ name: 'ECDH', public: pub }, privKey, 256), epk, 'decrypt');
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(65, 77) }, aes, raw.slice(77));
  return JSON.parse(td.decode(await pipe(new Uint8Array(plain), new DecompressionStream('deflate-raw'))));
}
// 宛先の照合用の印（drop.json に公開で置く）。作り直す前の古いリンク・途中で切れたリンクを、送る前に見分ける
export async function dropTag(topic) {
  return b64u.enc(new Uint8Array(await subtle.digest('SHA-256', te.encode(`hako/drop-tag/v1:${topic}`)))).slice(0, 22);
}
// drop.json（{ pub, tag, sealed }）を、箱の鍵を持つ側（画面・同期・このMac）が開く → { topic, key }
export async function openDrop(keys, file) {
  if (!file?.sealed) return null;
  const s = await open(keys, file.sealed);
  if (typeof s?.topic !== 'string' || !s.priv) return null;
  return { topic: s.topic, key: await subtle.importKey('jwk', s.priv, EC, false, ['deriveBits']) };
}
