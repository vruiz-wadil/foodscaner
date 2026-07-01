const CACHE_NAME = 'yomi-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/scan.html',
  '/home.css',
  '/styles.css',
  '/app.js',
  '/home.js',
  '/manifest.json',
  '/assets/icons/favicon.svg',
  '/assets/icons/icon-192x192.png',
  '/assets/icons/icon-512x512.png',
  '/assets/redesign/logo.svg',
  '/assets/redesign/icon-camera.svg',
  '/assets/redesign/icon-home.svg',
  '/assets/redesign/icon-scan.svg',
  '/assets/redesign/icon-analysis.svg',
  '/assets/redesign/icon-profile.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // API calls: network-first
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && request.method === 'GET') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // App shell (HTML/JS/CSS): network-first so deploys show up immediately.
  // Falls back to cache only when offline.
  if (/\.(html|js|css)$/.test(url.pathname) || url.pathname === '/') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Other static assets (icons, etc.): cache-first, rarely change.
  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
        }
        return res;
      });
    })
  );
});
