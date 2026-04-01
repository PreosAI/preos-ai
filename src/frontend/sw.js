const CACHE_NAME = 'preos-v1';
const CACHE_NAME_STATIC = 'preos-static-v1';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/buscar.html',
  '/vender.html',
  '/agentes.html',
  '/por-que-preos.html',
  '/ingresar.html',
  '/manifest.json',
  '/favicon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/Images/logo.png',
  '/js/lang.js',
  '/js/auth-nav.js',
  '/js/properties.js',
  '/data/properties.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME_STATIC)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== CACHE_NAME_STATIC)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (
    url.origin !== self.location.origin &&
    !url.href.includes('fonts.googleapis.com') &&
    !url.href.includes('fonts.gstatic.com')
  ) return;

  const isHTML = event.request.headers.get('accept')?.includes('text/html');
  const isStaticAsset = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|json)$/i.test(url.pathname);

  if (isHTML) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(r => r || caches.match('/index.html'))
        )
    );
  } else if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const networkFetch = fetch(event.request).then(response => {
          caches.open(CACHE_NAME_STATIC).then(cache =>
            cache.put(event.request, response.clone())
          );
          return response;
        });
        return cached || networkFetch;
      })
    );
  }
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
