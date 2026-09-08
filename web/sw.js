/**
 * 앱 셸만 캐시합니다. 데이터는 항상 네트워크에서 가져옵니다
 * (Apps Script 응답을 캐시하면 오래된 잔액이 보일 수 있습니다).
 */
const CACHE = 'expense-shell-v1';
const SHELL = [
  './', './index.html', './styles.css', './api.js', './ui.js', './app.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;                              // 데이터 POST 는 건드리지 않습니다
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;               // CDN·Apps Script 는 통과

  ev.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
