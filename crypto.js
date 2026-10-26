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
