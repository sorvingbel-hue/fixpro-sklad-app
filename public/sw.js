/* «Форман» — service worker: приложение открывается без сети.
 *
 * ШАБЛОН. После `expo export -p web` скрипт scripts/sw-stamp.mjs (он в `npm run web:export`) подставляет
 * в dist/sw.js версию сборки и список файлов. Новая сборка = новый sw.js = браузер видит обновление.
 * Без подстановки (метка версии осталась как в шаблоне) service worker ничего не кэширует и не перехватывает.
 *
 * Главное правило: на телефоне всегда ОДНА версия «Формана» целиком — страницы и код из одного кэша.
 *  - страницы и код — из кэша этой версии (сначала кэш); новую сборку браузер скачивает сам, проверяя sw.js
 *    (при каждом открытии и раз в 30 минут, см. src/lib/sw-update.ts), и кладёт её в новый кэш целиком;
 *  - новая версия включается, только когда бригадир нажмёт «Есть обновление» (SKIP_WAITING), или когда
 *    «Форман» полностью закрыт и открыт заново (все вкладки закрыты — так браузер включает её сам);
 *  - поэтому не бывает «страница от новой сборки, а код от старой» (белый экран без сети при переходе
 *    на вкладку) и «то новая, то старая версия» (старый код мог бы переписать данные новой);
 *  - только папка /fixpro-sklad-app/forman/ этого сайта: «Склад», Supabase и другие сайты не трогаем;
 *  - кэш с версией в имени; при включении новой версии удаляются старые кэши «Формана» (чужие кэши — нет).
 *
 * Аварийно выключить (если с service worker что-то не так): выложить вместо dist/sw.js такой файл —
 *   self.addEventListener('install', () => self.skipWaiting());
 *   self.addEventListener('activate', e => e.waitUntil((async () => {
 *     for (const k of await caches.keys()) if (k.startsWith('forman-sw-')) await caches.delete(k);
 *     await self.registration.unregister();
 *     for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
 *   })()));
 * Браузер проверяет sw.js мимо кэша (updateViaCache: 'none') при каждом открытии с сетью — выключится сразу.
 */
const VERSION = '__FORMAN_SW_VERSION__';
const PRECACHE = [/*__FORMAN_SW_PRECACHE__*/];

const STAMPED = !VERSION.startsWith('__');
const PREFIX = 'forman-sw-';
const CACHE = PREFIX + VERSION;
const SCOPE = new URL(self.registration.scope); // https://<сайт>/fixpro-sklad-app/forman/
const BASE = SCOPE.pathname;
const NAV_TIMEOUT_MS = 8000;

const isHashed = path => path.startsWith(BASE + '_expo/static/') || path.startsWith(BASE + 'assets/');
const isIcon = path => /\.(png|ico|svg|webmanifest)$/.test(path) && !path.slice(BASE.length).includes('/');
const keyOf = url => url.origin + url.pathname; // без ?query и #hash: icon.png?v=1 и ?v=2 — один файл

// Ответ после перенаправления нельзя отдавать на переход по странице — пересобираем без пометки
async function plain(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

// Вся сборка — в новый кэш. Любой файл не скачался — установка не удалась целиком (браузер попробует позже),
// а неполный кэш удаляется: полу-версии на телефоне не бывает.
async function precache() {
  const cache = await caches.open(CACHE);
  try {
    await Promise.all(PRECACHE.map(async u => {
      const url = new URL(u, SCOPE);
      // файлы с хэшем можно брать из обычного кэша браузера, остальное — сверить с сервером
      const res = await fetch(new Request(url, { cache: isHashed(url.pathname) ? 'default' : 'no-cache' }));
      if (!res.ok) throw new Error(`precache ${u}: ${res.status}`);
      await cache.put(keyOf(url), await plain(res));
    }));
  } catch (e) {
    await caches.delete(CACHE);
    throw e;
  }
}

self.addEventListener('install', event => {
  if (STAMPED) event.waitUntil(precache());
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
  if (!STAMPED) return;
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // *.supabase.co, шрифты Google и т.п. — мимо
  if (!url.pathname.startsWith(BASE)) return;      // «Склад» и всё вне папки «Формана» — мимо
  if (url.pathname === BASE + 'sw.js') return;
  if (req.mode === 'navigate') event.respondWith(onNavigate(req, url));
  else if (isHashed(url.pathname) || isIcon(url.pathname)) event.respondWith(cacheFirst(event, url));
});

// Где в кэше может лежать эта страница: /forman/ → ./ или index.html; /forman/laws → laws.html
function pageKeys(url) {
  const key = keyOf(url);
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

function offlinePage() {
  const html = '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Форман — нет сети</title><body style="font:20px/1.5 -apple-system,system-ui,sans-serif;padding:24px;color:#0B0F0E">' +
    '<h1 style="font-size:28px">Нет сети</h1><p>Эта страница «Формана» не сохранена на телефоне для работы без сети. ' +
    'Откройте главную страницу или попробуйте, когда появится связь.</p><p><button style="font-size:20px;min-height:56px;padding:0 24px" onclick="location.reload()">Попробовать снова</button></p></body></html>';
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then(r => { clearTimeout(timer); resolve(r); }, e => { clearTimeout(timer); reject(e); });
  });
}

// Страница: из кэша этой версии — та же сборка, что и код в кэше. Страницы, которой нет в сборке
// (незнакомый адрес), — из сети, в кэш не кладём (она может быть от другой сборки); без сети — главная.
async function onNavigate(req, url) {
  const cache = await caches.open(CACHE);
  const hit = await findPage(cache, url);
  if (hit) return hit;
  try {
    return await fetchWithTimeout(req, NAV_TIMEOUT_MS);
  } catch {
    return (await cache.match(SCOPE.href)) || offlinePage();
  }
}

// Код, шрифты, картинки, иконки: сначала кэш этой версии (потом — любой кэш «Формана»), потом сеть
async function cacheFirst(event, url) {
  const key = keyOf(url);
  const cache = await caches.open(CACHE);
  const hit = (await cache.match(key)) || (await caches.match(key));
  if (hit) return hit;
  const res = await fetch(event.request);
  if (res.status === 200 && res.type === 'basic') {
    const copy = res.clone();
    event.waitUntil(cache.put(key, copy).catch(() => undefined));
  }
  return res;
}
