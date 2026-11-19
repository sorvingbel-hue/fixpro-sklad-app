// «Перекуп»: офлайн-кэш. Версию проставляет build.mjs по содержимому файлов —
// новая версия = новый кэш, старый удаляется. Сеть нужна только для обновления самих файлов программы;
// данные пользователя здесь не проходят (они в localStorage телефона).
const VERSION = '8a1be74b844f';
const CACHE = 'perekup-' + VERSION;
const ASSETS = ["./", "./index.html", "./app.css", "./app.js", "./logic.js", "./ledger.js", "./core/calc.js", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('perekup-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Сначала кэш (быстро и без сети на гаражной распродаже), сеть — запасной путь.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html', { cacheName: CACHE }).then((hit) => hit || fetch(req))
    );
    return;
  }
  event.respondWith(
    caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || fetch(req))
  );
});
