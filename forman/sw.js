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
 *  - распознавание скрина заказа (папка ocr/, до 7 МБ) в общий кэш НЕ входит: файлы скачиваются при первом
 *    «Разобрать» и кладутся в отдельный кэш forman-ocr-files — он переживает обновления «Формана», так что
 *    второй и следующие разборы работают и без сети. У каждого файла в sw.js записан хэш содержимого (OCR_FILES,
 *    подставляет sw-stamp): в кэш кладётся только файл с этим хэшем; файл поменялся на сайте (новый пример,
 *    исправленный tesseract.js) — новая сборка, новый sw.js, и при её включении устаревший файл из кэша удаляется
 *    (остальные остаются — 7 МБ заново не качаются);
 *  - если первый разбор прошёл, пока service worker ещё не управлял страницей (первое открытие по медленной сети),
 *    страница после удачного разбора просит его сохранить файлы распознавания (сообщение OCR_KEEP).
 *
 * Аварийно выключить (если с service worker что-то не так): выложить вместо dist/sw.js такой файл —
 *   self.addEventListener('install', () => self.skipWaiting());
 *   self.addEventListener('activate', e => e.waitUntil((async () => {
 *     for (const k of await caches.keys()) if (k.startsWith('forman-sw-') || k.startsWith('forman-ocr-')) await caches.delete(k);
 *     await self.registration.unregister();
 *     for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
 *   })()));
 * Браузер проверяет sw.js мимо кэша (updateViaCache: 'none') при каждом открытии с сетью — выключится сразу.
 */
const VERSION = 'f83c4959d3c5';
const PRECACHE = [
 "./",
 "_expo/static/js/web/__common-70fc31875a9f96331df1ccc59a058747.js",
 "_expo/static/js/web/__expo-metro-runtime-ed4c1cfa6193d76fc294130e42bd1916.js",
 "_expo/static/js/web/_layout-8dc4e99c503f41e6ef596fc1330b8f50.js",
 "_expo/static/js/web/_layout-e4b3e3f1d5e33297d71b0e3417c10bd3.js",
 "_expo/static/js/web/entry-8c78f6b79d8847a34cd14226cdcb37b5.js",
 "_expo/static/js/web/index-16d04db84ed7d46185bf16cfb0d2a49b.js",
 "_expo/static/js/web/laws-7e2cfc427e663f1751f4de831a5001d3.js",
 "_expo/static/js/web/library-877a6175fbb5cd1001afc7253c161a38.js",
 "_expo/static/js/web/more-172f8fe94b1c17efcf1a391142ec63dd.js",
 "_expo/static/js/web/sklad-c90614c244c7692c001de792e5e61c40.js",
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
const OCR_FILES = {
 "ocr/primer-zakaza.png": "024fecc741c9",
 "ocr/t7/LICENSE-tesseract.js-core.txt": "c6596eb7be85",
 "ocr/t7/LICENSE-tesseract.js.txt": "b40930bbcf80",
 "ocr/t7/eng.traineddata.gz": "45b4cb346724",
 "ocr/t7/tesseract-core-lstm.wasm.js": "eef5f8b2f8e2",
 "ocr/t7/tesseract-core-simd-lstm.wasm.js": "c58b46a4c796",
 "ocr/t7/tesseract.min.js": "000c27d9cd0d",
 "ocr/t7/worker.min.js": "576b7df7e339"
}; // 'ocr/t7/worker.min.js': первые 12 знаков sha256 содержимого

const STAMPED = !VERSION.startsWith('__');
const PREFIX = 'forman-sw-';
const CACHE = PREFIX + VERSION;
const OCR_PREFIX = 'forman-ocr-';
const OCR_CACHE = OCR_PREFIX + 'files';
const OCR_HASH = 'X-Forman-Hash'; // хэш файла у ответа в кэше распознавания
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
    for (const key of await caches.keys()) {
      if ((key.startsWith(PREFIX) && key !== CACHE) || (key.startsWith(OCR_PREFIX) && key !== OCR_CACHE)) await caches.delete(key);
    }
    if (STAMPED) await pruneOcr();
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const d = event.data;
  if (d && d.type === 'SKIP_WAITING') self.skipWaiting();
  else if (d && d.type === 'OCR_KEEP' && Array.isArray(d.urls)) {
    const port = event.ports && event.ports[0];
    event.waitUntil(keepOcr(d.urls).then(r => port && port.postMessage(r), () => port && port.postMessage({ kept: 0, total: 0 })));
  }
});

self.addEventListener('fetch', event => {
  if (!STAMPED) return;
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // *.supabase.co, шрифты Google и т.п. — мимо
  if (!url.pathname.startsWith(BASE)) return;      // «Склад» и всё вне папки «Формана» — мимо
  if (url.pathname === BASE + 'sw.js') return;
  if (url.pathname.startsWith(BASE + 'ocr/')) event.respondWith(ocrFile(event, url));
  else if (req.mode === 'navigate') event.respondWith(onNavigate(req, url));
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

// ---------- Файлы распознавания (ocr/) ----------
const ocrPath = url => url.pathname.slice(BASE.length); // 'ocr/t7/worker.min.js'

async function sha12(buf) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(h.slice(0, 6), b => b.toString(16).padStart(2, '0')).join('');
}

// Свежая копия с сайта (мимо HTTP-кэша браузера: он мог сохранить прежний файл на 10 минут). В кэш — только
// если содержимое совпало с хэшем из этой сборки; иначе файл отдаётся как есть, но не запоминается.
async function fetchOcr(url, want) {
  const res = await fetch(url.href, { cache: 'no-cache' });
  if (res.status !== 200 || (res.type !== 'basic' && res.type !== 'default')) return { res, keep: null };
  const body = await res.arrayBuffer();
  const type = res.headers.get('Content-Type') || 'application/octet-stream';
  const make = () => new Response(body, { status: 200, headers: { 'Content-Type': type, [OCR_HASH]: want } });
  const same = (await sha12(body)) === want;
  return { res: make(), keep: same ? make() : null };
}

// По требованию — из своего кэша (если хэш тот же, что в этой сборке), иначе с сайта и в кэш.
// Запросы потока распознавания (Web Worker с адреса сайта) тоже приходят сюда.
async function ocrFile(event, url) {
  const want = OCR_FILES[ocrPath(url)];
  if (!want) return fetch(event.request); // файла нет в сборке — просто с сайта, без кэша
  const cache = await caches.open(OCR_CACHE);
  const hit = await cache.match(keyOf(url));
  if (hit && hit.headers.get(OCR_HASH) === want) return hit;
  const { res, keep } = await fetchOcr(url, want);
  if (keep) event.waitUntil(cache.put(keyOf(url), keep).catch(() => undefined));
  return res;
}

// Страница после удачного разбора: «сохрани эти файлы» (на случай, если разбор шёл мимо service worker)
async function keepOcr(urls) {
  if (!STAMPED) return { kept: 0, total: 0 };
  const cache = await caches.open(OCR_CACHE);
  let kept = 0, total = 0;
  for (const u of urls.slice(0, 12)) {
    let url;
    try { url = new URL(u); } catch { continue; }
    if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE + 'ocr/')) continue;
    const want = OCR_FILES[ocrPath(url)];
    if (!want) continue;
    total++;
    const hit = await cache.match(keyOf(url));
    if (hit && hit.headers.get(OCR_HASH) === want) { kept++; continue; }
    try {
      const { keep } = await fetchOcr(url, want);
      if (keep) { await cache.put(keyOf(url), keep); kept++; }
    } catch { /* нет сети — сохранится в следующий раз */ }
  }
  return { kept, total };
}

// При включении новой сборки: убрать из кэша распознавания файлы, которых в ней нет или которые поменялись
async function pruneOcr() {
  try {
    const cache = await caches.open(OCR_CACHE);
    for (const req of await cache.keys()) {
      const want = OCR_FILES[ocrPath(new URL(req.url))];
      const res = await cache.match(req);
      if (!want || !res || res.headers.get(OCR_HASH) !== want) await cache.delete(req);
    }
  } catch { /* не вышло — устаревшие файлы просто не будут отдаваться (хэш не совпадёт) */ }
}
