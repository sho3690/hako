// 中継（ntfy.sh）。端末や Claude から入れたもの・変更は、封をしたメッセージとしてここに置く。
// GitHub Actions が15分ごとに取り込んで data/state.json に保存する。ntfy.sh は約12時間だけ預かる。

export const MAX_BODY = 3900;   // ntfy.sh の上限 4096 バイトより少し小さく

export async function publish(relay, topic, body, { timeout = 10000 } = {}) {
  if (body.length > MAX_BODY) throw new Error('too large');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(`${relay}/${topic}`, { method: 'POST', body, headers: { Firebase: 'no' }, signal: ctl.signal });
    if (!res.ok) throw new Error(`relay ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

// since: UNIX 秒、または 'all'
export async function poll(relay, topic, since, { timeout = 15000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(`${relay}/${topic}/json?poll=1&since=${since}`, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`relay ${res.status}`);
    const text = await res.text();
    return text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(m => m && m.event === 'message' && typeof m.message === 'string');
  } finally { clearTimeout(t); }
}
