/**
 * 앱 셸만 캐시합니다. 데이터는 항상 네트워크에서 가져옵니다
 * (Apps Script 응답을 캐시하면 오래된 잔액이 보일 수 있습니다).
 *
 * GitHub Pages 는 `cache-control: max-age=600` 을 보냅니다. 그대로 두면
 * 브라우저 HTTP 캐시가 배포 후 10분 동안 옛 파일을 재검증 없이 내주어,
 * 새 app.js 가 올라가 있어도 옛 코드가 실행됩니다. 그래서 이 워커는
 * 설치할 때도 실행 중에도 HTTP 캐시를 건너뛰고 원본에 직접 물어봅니다.
 */
const CACHE = 'expense-shell-v10';
const SHELL = [
  './', './index.html', './styles.css', './api.js', './ui.js', './app.js',
  './manifest.webmanifest', './icons/icon.svg',
  './icons/icon-192.png', './icons/icon-512.png'
];

/** HTTP 캐시를 무시하고 원본에서 받아옵니다. */
function fromNetwork(url, mode) {
  return fetch(url, { cache: mode, credentials: 'same-origin' });
}

self.addEventListener('install', ev => {
  ev.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(SHELL.map(url =>
        fromNetwork(url, 'reload')
          .then(res => (res.ok ? cache.put(url, res) : null))
          .catch(() => null)          // 한 파일이 실패해도 설치는 계속합니다
      )))
      .then(() => self.skipWaiting())
  );
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

  ev.respondWith(serveShell(ev, req));
});

/**
 * 캐시에 있으면 곧바로 내주고, 갱신은 뒤에서 합니다.
 *
 * 예전에는 매번 원본에 먼저 확인했는데, 파일 하나하나가 왕복을 기다리느라
 * 앱을 열 때마다 시작이 느렸습니다. 이제는 즉시 뜨고, 새 파일이 확인되면
 * 다음 실행부터 반영되며 열려 있는 화면에는 알림을 보냅니다.
 */
async function serveShell(ev, req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);

  if (cached) {
    ev.waitUntil(revalidate(cache, req, cached));
    return cached;
  }

  try {
    const res = await fromNetwork(req.url, 'no-cache');
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return (await cache.match('./index.html')) || Response.error();
  }
}

async function revalidate(cache, req, cached) {
  try {
    const fresh = await fromNetwork(req.url, 'no-cache');
    if (!fresh.ok) return;
    const before = cached.headers.get('etag') || cached.headers.get('last-modified');
    const after = fresh.headers.get('etag') || fresh.headers.get('last-modified');
    await cache.put(req, fresh.clone());
    if (before && after && before !== after) await notifyUpdate();
  } catch (e) {
    // 오프라인이면 캐시에 있던 것을 계속 씁니다.
  }
}

async function notifyUpdate() {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(c => c.postMessage({ type: 'shell-updated' }));
}

/** 앱에서 즉시 갱신을 요청할 때 씁니다. */
self.addEventListener('message', ev => {
  if (ev.data === 'skipWaiting') self.skipWaiting();
});
