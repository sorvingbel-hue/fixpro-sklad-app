// Распознавание скрина заказа на телефоне (tesseract.js, WebAssembly): копирует файлы распознавания
// из node_modules в public/ocr/t7/ — они выкладываются вместе с сайтом «Формана» (свой сайт, без CDN)
// и скачиваются телефоном только при первом «Разобрать». Скрин никуда не отправляется.
// Запуск после обновления tesseract.js: npm run ocr:assets   (папка t7 = tesseract.js 7.x)
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'public/ocr/t7';
const FILES = [
  ['node_modules/tesseract.js/dist/tesseract.min.js', 'tesseract.min.js'],
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js/LICENSE.md', 'LICENSE-tesseract.js.txt'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'], // iPhone (Safari 16.4+), Chrome
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],           // старые браузеры без SIMD
  ['node_modules/tesseract.js-core/LICENSE', 'LICENSE-tesseract.js-core.txt'],
];
// Английская модель (LSTM, best_int) из npm-пакета @tesseract.js-data/eng@1.0.0, файл 4.0.0_best_int/eng.traineddata.gz.
// Лежит в git как есть; здесь только проверяется, что это тот самый файл.
const LANG = { file: 'eng.traineddata.gz', sha256: '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91' };

mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [from, to] of FILES) {
  const src = existsSync(from) ? from : from.replace('LICENSE.md', 'LICENSE');
  if (!existsSync(src)) { console.error(`ocr-assets: нет ${from} — сначала npm install`); process.exit(1); }
  copyFileSync(src, join(OUT, to));
  total += statSync(join(OUT, to)).size;
}
const lang = join(OUT, LANG.file);
const sum = existsSync(lang) ? createHash('sha256').update(readFileSync(lang)).digest('hex') : 'нет файла';
if (sum !== LANG.sha256) {
  console.error(`ocr-assets: ${lang} не тот (sha256 ${sum}). Возьмите 4.0.0_best_int/eng.traineddata.gz из @tesseract.js-data/eng@1.0.0`);
  process.exit(1);
}
total += statSync(lang).size;
const ver = JSON.parse(readFileSync('node_modules/tesseract.js/package.json', 'utf8')).version;
const core = JSON.parse(readFileSync('node_modules/tesseract.js-core/package.json', 'utf8')).version;
console.log(`ocr-assets: tesseract.js ${ver}, core ${core} → ${OUT}, всего ${(total / 1048576).toFixed(1)} МБ`);
