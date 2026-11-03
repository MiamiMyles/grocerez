// Offline cache for the app shell. Bump VERSION whenever app files change
// so installed copies pick up the update on next launch.
//
// Strategy: the app opens from the cache first (instant, and never waits on a
// missing or flaky connection); a fresh copy is fetched in the background so
// the next launch has any updates.
var VERSION = 'grocerez-v5';

// Must all cache for the install to succeed (otherwise it retries later).
var CORE = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest'
];
// Nice to have; one failing download must not block offline support.
var EXTRA = [
  'fonts/figtree-latin.woff2',
  'fonts/figtree-latin-ext.woff2',
  'fonts/comic-neue-700.woff2',
  'fonts/fraunces-600.woff2',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

// Safari refuses to use a redirected response for a page navigation, which
// shows up as a blank screen. Re-wrap such responses so they are safe to serve.
function clean(res) {
  if (!res.redirected) return Promise.resolve(res);
  return res.blob().then(function (body) {
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  });
}

function fetchAndStore(cache, url) {
  return fetch(new Request(url, { cache: 'reload' })).then(function (res) {
    if (!res.ok) throw new Error('Bad response for ' + url);
    return clean(res).then(function (copy) { return cache.put(url, copy); });
  });
}

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (cache) {
    var core = Promise.all(CORE.map(function (u) { return fetchAndStore(cache, u); }));
    var extra = Promise.all(EXTRA.map(function (u) { return fetchAndStore(cache, u).catch(function () {}); }));
    return Promise.all([core, extra]);
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url = new URL(req.url);
  // Only handle the app's own files; the recipe API and anything else goes straight to the network.
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.indexOf('/api/') !== -1) return;

  e.respondWith(caches.open(VERSION).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (hit) {
      // Refresh the cached copy in the background (silently ignored when offline).
      var refresh = fetch(req).then(function (res) {
        if (!res.ok) return res;
        return clean(res.clone()).then(function (copy) {
          return cache.put(req, copy).then(function () { return res; });
        });
      });
      if (hit) {
        e.waitUntil(refresh.catch(function () {}));
        return hit;
      }
      // Not cached yet: use the network, and fall back to the app page if we're offline.
      return refresh.catch(function () {
        if (req.mode === 'navigate') {
          return cache.match('index.html').then(function (page) { return page || cache.match('./'); })
            .then(function (page) { return page || Response.error(); });
        }
        return Response.error();
      });
    });
  }));
});
