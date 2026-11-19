// Настоящее распознавание встроенного примера (tesseract.js 7 в Node, та же модель public/ocr/t7/eng.traineddata.gz,
// что скачивает телефон) → строки → разбор → черновик. Без сети и без телефона. Запуск: npm run test:ocr
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { groupWordsToLines, parseOrderLines } from '../src/features/jobs/order-parse.ts';

const require = createRequire(import.meta.url);
const { createWorker } = require('tesseract.js');

const t0 = Date.now();
const worker = await createWorker('eng', 1, { langPath: 'public/ocr/t7', cacheMethod: 'none' });
await worker.setParameters({ preserve_interword_spaces: '1' });
const t1 = Date.now();
const r = await worker.recognize('public/ocr/primer-zakaza.png', {}, { text: true, blocks: true });
const t2 = Date.now();
await worker.terminate();

const words = [];
for (const b of r.data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) words.push({ text: w.text, confidence: w.confidence, bbox: w.bbox, symbols: w.symbols.map(x => ({ text: x.text, confidence: x.confidence, bbox: x.bbox })) });
const lines = groupWordsToLines(words);
const { items, dropped } = parseOrderLines(lines);
console.log(`распознано слов: ${words.length}, строк: ${lines.length}; загрузка ${t1 - t0} мс, распознавание ${t2 - t1} мс`);
for (const i of items) console.log(`  ${i.qty ?? '—'} ${i.unit}  ${i.name}${i.flags.length ? '  [' + i.flags.join(',') + ']' : ''}  (${i.confidence})`);

const reg = items.find(i => i.name.startsWith('Bar type supply registers'));
assert.ok(reg, 'в черновике есть «Bar type supply registers…»');
assert.equal(reg.qty, 6, 'количество 6 прочитано распознаванием');
assert.deepEqual(reg.flags, []);
const pump = items.find(i => i.name === 'Condensate pump');
assert.ok(pump, 'размазанная строка в черновике есть');
assert.equal(pump.qty, null, 'размазанная цифра не угадана');
assert.deepEqual(pump.flags, ['qty']);
assert.equal(items.length, 6, 'шесть позиций, без итогов/телефона/адреса');
assert.ok(!items.some(i => /total|tax|phone|sample way|customer/i.test(i.name)), 'итоги, телефон, адрес — не позиции');
assert.ok(dropped.some(d => /Total/.test(d.raw)) && dropped.some(d => /Phone/.test(d.raw)));
console.log('order-ocr: настоящее распознавание примера — пройдено');
