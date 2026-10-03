
const CACHE_NAME = 'dochelper-v3';

const APP_BASE_URL = self.registration.scope;

const STATIC_ASSETS = [
  'index.html',
  'manifest.json',
  'icon.svg',
].map((file) => new URL(file, APP_BASE_URL).toString());

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );

  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith('dochelper-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );

  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Never cache API requests.
  if (url.pathname.includes('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({
            error: 'You are currently offline. Please reconnect to use AI services.'
          }),
          {
            status: 503,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
      })
    );

    return;
  }

  // Only handle this app's own files. Google Sign-In, fonts and other
  // third-party requests go straight to the network.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Pages that must always be fresh and never cached.
  if (url.pathname.endsWith('/reset-password')) {
    return;
  }

  // Pages (index.html): network first so a new release is picked up
  // immediately; fall back to the cached copy when offline.
  if (request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }

          return networkResponse;
        })
        .catch(() => {
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;

            const fallbackUrl = new URL('index.html', APP_BASE_URL).toString();
            return caches.match(fallbackUrl).then((fallback) => {
              return fallback || new Response('Offline', {
                status: 503,
                statusText: 'Service Unavailable'
              });
            });
          });
        })
    );

    return;
  }

  // Build assets have content hashes in their names, so cache-first is safe.
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((networkResponse) => {
          if (
            !networkResponse ||
            networkResponse.status !== 200 ||
            networkResponse.type !== 'basic'
          ) {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });

          return networkResponse;
        })
        .catch(() => {
          return new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
    })
  );
});
