const CACHE_VERSION = 'preos-v3';
const STATIC_CACHE = 'preos-static-v3';

const PRECACHE_URLS = [
  '/manifest.json',
  '/favicon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/Images/logo.png',
  '/js/lang.js',
  '/js/auth-nav.js',
  '/js/properties.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION && k !== STATIC_CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;

  // NEVER cache HTML pages — always fetch from network so updates are instant
  if (event.request.headers.get('accept')?.includes('text/html') ||
      url.pathname.endsWith('.html') ||
      url.pathname === '/') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match('/index.html')
      )
    );
    return;
  }

  // NEVER cache data — always fresh
  if (url.pathname.includes('/data/') ||
      url.pathname.includes('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // NEVER cache external services (Firebase, maps, images)
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache-first ONLY for true static assets (icons, logo, fonts)
  const isStaticAsset = /\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf)$/i.test(url.pathname);
  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fresh = fetch(event.request).then(response => {
          caches.open(STATIC_CACHE).then(cache =>
            cache.put(event.request, response.clone())
          );
          return response;
        });
        return cached || fresh;
      })
    );
    return;
  }

  // Everything else (JS files etc) — network first, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(STATIC_CACHE).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
