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
const VERSION = '6e9fc0d510f7';
const PRECACHE = [
 "./",
 "_expo/static/js/web/__common-b65296048eb7149ad552fe1d6526bbdb.js",
 "_expo/static/js/web/__expo-metro-runtime-ed4c1cfa6193d76fc294130e42bd1916.js",
 "_expo/static/js/web/_layout-3dd2c0f325da0646270feea063d770f4.js",
 "_expo/static/js/web/_layout-fc74ab761cd2a9f958fcfc5a1ca95f18.js",
 "_expo/static/js/web/entry-68e86171c39a4de985514e0ceb4f810e.js",
 "_expo/static/js/web/index-d747ed23870ab9b348dd94b26f13d38c.js",
 "_expo/static/js/web/laws-8683de76c73da57ba1c538537af4c7c1.js",
 "_expo/static/js/web/library-c037736d3fbcdb3d8564d325a91b9b06.js",
 "_expo/static/js/web/more-80c139257706a11e4ad8c3c20245a0a3.js",
 "_expo/static/js/web/sklad-0a2c66791c802236f7b31607e4e56e9b.js",
 "apple-touch-icon.png",
 "assets/node_modules/@expo-google-fonts/material-symbols/400Regular/MaterialSymbols_400Regular.24d675e00675c1fa5b599e35b6ca17f8.ttf",
 "assets/node_modules/expo-router/assets/arrow_down.017bc6ba3fc25503e5eb5e53826d48a8.png",
 "assets/node_modules/expo-router/assets/error.d1ea1496f9057eb392d5bbf3732a61b7.png",
 "assets/node_modules/expo-router/assets/file.19eeb73b9593a38f8e9f418337fc7d10.png",
 "assets/node_modules/expo-router/assets/forward.d8b800c443b8972542883e0b9de2bdc6.png",
 "assets/node_modules/expo-router/assets/pkg.ab19f4cbc543357183a20571f68380a3.png",
 "assets/node_modules/expo-router/assets/react-navigation/elements/back-icon-mask.0a328cd9c1afd0afe8e3b1ec5165b1b4.png",
 "assets/node_modules/expo-router/assets/react-navigation/elements/back-icon.35ba0eaec5a4f5ed12ca16fabeae451d.png",
 "assets/node_modules/expo-router/assets/react-navigation/elements/clear-icon.c94f6478e7ae0cdd9f15de1fcb9e5e55.png",
 "assets/node_modules/expo-router/assets/react-navigation/elements/clear-icon.c94f6478e7ae0cdd9f15de1fcb9e5e55@2x.png",
 "assets/node_modules/expo-router/assets/react-navigation/elements/clear-icon.c94f6478e7ae0cdd9f15de1fcb9e5e55@3x.png",
 "assets/node_modules/expo-router/assets/react-navigation/elements/clear-icon.c94f6478e7ae0cdd9f15de1fcb9e5e55@4x.png",
 "assets/node_modules/expo-router/assets/react-navigation/elements/close-icon.808e1b1b9b53114ec2838071a7e6daa7.png",
 "assets/node_modules/expo-router/assets/react-navigation/elements/close-icon.808e1b1b9b53114ec2838071a7e6daa7@2x.png",
 "assets/node_modules/expo-router/assets/react-navigation/elements/close-icon.808e1b1b9b53114ec2838071a7e6daa7@3x.png",
 "assets/node_modules/expo-router/assets/react-navigation/elements/close-icon.808e1b1b9b53114ec2838071a7e6daa7@4x.png",
 "assets/node_modules/expo-router/assets/react-navigation/elements/search-icon.286d67d3f74808a60a78d3ebf1a5fb57.png",
 "assets/node_modules/expo-router/assets/sitemap.412dd9275b6b48ad28f5e3d81bb1f626.png",
 "assets/node_modules/expo-router/assets/unmatched.20e71bdf79e3a97bf55fd9e164041578.png",
 "favicon.ico",
 "icon-192.png",
 "icon-512.png",
 "laws.html",
 "library.html",
 "manifest.webmanifest",
 "more.html",
 "sklad.html"
];

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
