// После `expo export -p web`: подставляет в dist/sw.js версию сборки (хэш файлов) и список файлов,
// которые service worker заранее кладёт в кэш, чтобы «Форман» открывался без сети, а также хэши файлов
// распознавания (dist/ocr/**): они в общий кэш не входят, но по хэшу service worker узнаёт, что файл поменялся.
// Запуск: node scripts/sw-stamp.mjs [папка сборки=dist]  (входит в `npm run web:export`).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DIST = process.argv[2] ?? 'dist';
const SW = join(DIST, 'sw.js');
if (!existsSync(SW)) {
  console.error(`sw-stamp: нет ${SW} — public/sw.js должен копироваться в сборку`);
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(relative(DIST, p).split(sep).join('/'));
  }
  return out;
}

const ICONS = new Set(['favicon.ico', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'manifest.webmanifest']);
// Страницы вкладок верхнего уровня (index.html кладётся как './'); служебные _sitemap, +not-found и (tabs)/ — не нужны
const isPage = f => /^[a-z0-9-]+\.html$/.test(f) && f !== 'index.html';
const isCode = f => f.startsWith('_expo/static/') && /\.(js|css)$/.test(f);
const isAsset = f => f.startsWith('assets/');

const files = walk(DIST).filter(f => isCode(f) || isAsset(f) || isPage(f) || ICONS.has(f)).sort();
if (!files.some(isCode)) {
  console.error('sw-stamp: в сборке нет файлов _expo/static/*.js — это точно папка expo export?');
  process.exit(1);
}

// Файлы распознавания: путь → первые 12 знаков sha256 содержимого (так же считает service worker)
const sha12 = buf => createHash('sha256').update(buf).digest('hex').slice(0, 12);
const ocrFiles = {};
if (existsSync(join(DIST, 'ocr'))) for (const f of walk(join(DIST, 'ocr')).sort()) ocrFiles[f] = sha12(readFileSync(join(DIST, f)));

const hash = createHash('sha256');
hash.update(readFileSync(SW)); // правка самого шаблона sw.js — тоже новая версия
for (const f of ['index.html', ...files]) {
  hash.update(f + '\0');
  hash.update(readFileSync(join(DIST, f)));
}
hash.update(JSON.stringify(ocrFiles)); // поменялся файл распознавания — тоже новая версия
const version = hash.digest('hex').slice(0, 12);
const precache = ['./', ...files.map(f => encodeURI(f))];

let src = readFileSync(SW, 'utf8');
const V = "'__FORMAN_SW_VERSION__'";
const P = '[/*__FORMAN_SW_PRECACHE__*/]';
const O = '{/*__FORMAN_OCR_FILES__*/}';
const count = (s, sub) => s.split(sub).length - 1;
if (count(src, V) !== 1 || count(src, P) !== 1 || count(src, O) !== 1) {
  console.error('sw-stamp: в sw.js метки версии, списка и файлов распознавания должны встречаться ровно по одному разу (уже подставлено или шаблон изменён)');
  process.exit(1);
}
src = src.replace(V, `'${version}'`).replace(P, JSON.stringify(precache, null, 1)).replace(O, JSON.stringify(ocrFiles, null, 1));
writeFileSync(SW, src);

const bytes = files.reduce((n, f) => n + statSync(join(DIST, f)).size, statSync(join(DIST, 'index.html')).size);
const ocrBytes = Object.keys(ocrFiles).reduce((n, f) => n + statSync(join(DIST, f)).size, 0);
console.log(`sw-stamp: версия ${version}, файлов для офлайна ${precache.length}, ${(bytes / 1048576).toFixed(1)} МБ; ` +
  `распознавание (по требованию): ${Object.keys(ocrFiles).length} файлов, ${(ocrBytes / 1048576).toFixed(1)} МБ`);
