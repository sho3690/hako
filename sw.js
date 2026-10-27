// オフラインでも開けるように、画面のファイルを控えておく（常にネットを優先）。
const CACHE = 'hako-v3';
const SHELL = ['./', './index.html', './style.css', './app.js', './logic.js', './crypto.js', './relay.js', './config.json', './manifest.webmanifest', './icons/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  // 同じ sho3690.github.io の他のアプリの控えは消さない（自分の古い版だけ）
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('hako-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok && !u.search) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
