const CACHE_NAME = 'lemon-demo-v30-mission-add-cost-only';
const APP_SHELL = [
  '/',
  '/index.html',
  '/page1.html',
  '/page2.html',
  '/page3.html',
  '/page4.html',
  '/page5.html',
  '/page6.html',
  '/flower-data-all.js',
  '/images/branding/lemon-favicon.png',
  '/images/banners/lemon-banner-pc.png',
  '/images/banners/lemon-banner-mobile.png',
  '/images/ui/back-button.png',
  '/images/ui/guide-default.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  // 새 서비스 워커가 다운로드되면 대기하지 않고 바로 적용 후보가 됩니다.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // HTML 이동은 항상 네트워크를 먼저 확인해서 최신 배포본을 우선 사용합니다.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match('/index.html')))
    );
    return;
  }

  // 같은 도메인의 정적 파일도 온라인일 때는 새 파일을 먼저 가져옵니다.
  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
