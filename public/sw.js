/* «Форман» — service worker: приложение открывается без сети.
 *
 * ШАБЛОН. После `expo export -p web` скрипт scripts/sw-stamp.mjs (он в `npm run web:export`) подставляет
 * в dist/sw.js версию сборки и список файлов. Новая сборка = новый sw.js = браузер видит обновление.
 *
 * Правила (предупреждение Expo: «агрессивный» SW мешает обновлять сайт):
 *  - страницы (HTML) — сначала сеть, кэш только если сети нет или она «висит» дольше 4 с
 *    (в кэше — страницы той же сборки, что и код в кэше: новая сборка приходит целиком с новым sw.js);
 *  - /_expo/static/ и /assets/ (имена с хэшем) и иконки — сначала кэш;
 *  - только папка /fixpro-sklad-app/forman/ этого сайта: «Склад», Supabase и другие сайты не трогаем;
 *  - кэш с версией в имени, старые кэши «Формана» удаляются при активации (чужие кэши сайта — нет);
 *  - новая версия ждёт, пока бригадир нажмёт «Есть обновление» (сообщение SKIP_WAITING);
 *  - аварийно выключить: выложить вместо sw.js файл, который в 'activate' вызывает self.registration.unregister().
 */
const VERSION = '__FORMAN_SW_VERSION__';
const PRECACHE = [/*__FORMAN_SW_PRECACHE__*/];

const PREFIX = 'forman-sw-';
const CACHE = PREFIX + VERSION;
const SCOPE = new URL(self.registration.scope); // https://<сайт>/fixpro-sklad-app/forman/
const BASE = SCOPE.pathname;
const NAV_TIMEOUT_MS = 4000;

const isHashed = path => path.startsWith(BASE + '_expo/static/') || path.startsWith(BASE + 'assets/');
const isIcon = path => /\.(png|ico|svg|webmanifest)$/.test(path) && !path.slice(BASE.length).includes('/');

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const list = PRECACHE.filter(u => u !== './' && u !== 'index.html');
    // главная и код — обязательно (иначе установка не удалась и браузер попробует позже)
    const must = ['./', ...list.filter(u => /\.js$/.test(u))];
    const rest = list.filter(u => !must.includes(u));
    // файлы с хэшем можно брать из обычного кэша браузера, остальное — сверить с сервером
    const req = u => new Request(new URL(u, SCOPE), { cache: isHashed(new URL(u, SCOPE).pathname) ? 'default' : 'no-cache' });
    await cache.addAll(must.map(req));
    await Promise.all(rest.map(u => cache.add(req(u)).catch(() => undefined)));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // *.supabase.co, шрифты Google и т.п. — мимо
  if (!url.pathname.startsWith(BASE)) return;      // «Склад» и всё вне папки «Формана» — мимо
  if (url.pathname === BASE + 'sw.js') return;
  if (req.mode === 'navigate') return onNavigate(event, url);
  if (isHashed(url.pathname) || isIcon(url.pathname)) event.respondWith(cacheFirst(event));
});

const pageKey = url => url.origin + url.pathname; // без ?query и #hash

// Где в кэше может лежать эта страница: /forman/ → ./ или index.html; /forman/laws → laws.html
function pageKeys(url) {
  const key = pageKey(url);
  if (key.endsWith('/')) return [key, key + 'index.html'];
  if (!/\.[a-z0-9]+$/i.test(url.pathname)) return [key, key + '.html', key + '/'];
  return [key];
}

async function findPage(cache, url) {
  for (const k of pageKeys(url)) {
    const hit = await cache.match(k);
    if (hit) return hit;
  }
  return null;
}

async function cachedPage(url) {
  const cache = await caches.open(CACHE);
  // неизвестная страница без сети — лучше главная, чем ошибка браузера
  return (await findPage(cache, url)) || (await cache.match(SCOPE.href)) || null;
}

function offlinePage() {
  const html = '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Форман — нет сети</title><body style="font:20px/1.5 -apple-system,system-ui,sans-serif;padding:24px;color:#0B0F0E">' +
    '<h1 style="font-size:28px">Нет сети</h1><p>«Форман» ещё не успел сохраниться на этом телефоне для работы без сети. ' +
    'Откройте его один раз, когда появится связь.</p><p><button style="font-size:20px;min-height:56px;padding:0 24px" onclick="location.reload()">Попробовать снова</button></p></body></html>';
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// Страница: сначала сеть. Страницы этой сборки уже лежат в кэше (install) и НЕ перезаписываются свежими
// с сервера: в кэше всегда HTML той же сборки, что и код в кэше (иначе после выкладки без сети не найдётся
// код новой страницы). Новая сборка приходит целиком вместе с новым sw.js. Сохраняем только страницы,
// которых в кэше ещё нет (например, если sw.js не прошёл через sw-stamp).
function onNavigate(event, url) {
  let saved = Promise.resolve();
  const network = fetch(event.request).then(res => {
    if (res.ok && res.type === 'basic' && !res.redirected) {
      const copy = res.clone(); // сразу, пока тело ответа не ушло на страницу
      saved = caches.open(CACHE).then(async c => { if (!(await findPage(c, url))) await c.put(pageKey(url), copy); });
    }
    return res;
  });
  event.waitUntil(network.then(() => saved).catch(() => undefined));
  event.respondWith((async () => {
    let timer;
    const slow = new Promise(resolve => { timer = setTimeout(resolve, NAV_TIMEOUT_MS); }).then(async () => (await cachedPage(url)) || network);
    try {
      return await Promise.race([network, slow]);
    } catch {
      return (await cachedPage(url)) || offlinePage();
    } finally {
      clearTimeout(timer);
    }
  })());
}

async function cacheFirst(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.status === 200 && res.type === 'basic') {
    const copy = res.clone();
    event.waitUntil(cache.put(req, copy).catch(() => undefined));
  }
  return res;
}
