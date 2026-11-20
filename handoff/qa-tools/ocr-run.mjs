// Шаг 1 (OCR=1): распознать картинки как приложение (tesseract.js 7, модель сайта, те же параметры) → words.json
// Шаг 2: parseOrderLines(groupWordsToLines(words)) указанным парсером → сравнить с truth.json.
// Неверное количество БЕЗ флага — главная ошибка.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const APP = '/tmp/claude-0/-home-user/8feac192-9784-5733-9e7d-ce58c4f28f5b/scratchpad/qa_point/app';
const [IMG, PARSER, ...only] = process.argv.slice(2);
const require = createRequire(APP + '/package.json');
const cacheF = path.join(IMG, 'words.json');
const cache = fs.existsSync(cacheF) ? JSON.parse(fs.readFileSync(cacheF, 'utf8')) : {};
const truth = JSON.parse(fs.readFileSync(path.join(IMG, 'truth.json'), 'utf8'));
const names = Object.keys(truth).filter(n => !only.length || only.some(o => n.startsWith(o)));
const need = names.filter(n => !cache[n]);
if (need.length) {
  const { createWorker } = require('tesseract.js');
  const worker = await createWorker('eng', 1, { langPath: APP + '/public/ocr/t7', cacheMethod: 'none' });
  await worker.setParameters({ preserve_interword_spaces: '1' });
  for (const n of need) {
    const t0 = Date.now();
    const r = await worker.recognize(path.join(IMG, n + '.ocr.jpg'), {}, { text: true, blocks: true });
    const words = [];
    for (const b of r.data.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) for (const w of l.words ?? [])
      if (w && typeof w.text === 'string' && w.text.trim()) words.push({ text: w.text, confidence: w.confidence, bbox: w.bbox, symbols: (w.symbols ?? []).map(x => ({ text: x.text, confidence: x.confidence, bbox: x.bbox })) });
    cache[n] = { words, ms: Date.now() - t0 };
    fs.writeFileSync(cacheF, JSON.stringify(cache));
    process.stderr.write(`ocr ${n} ${Date.now() - t0} ms\n`);
  }
  await worker.terminate();
}
const { groupWordsToLines, parseOrderLines } = await import(PARSER);
const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function lev(a, b) { const m = a.length, n = b.length; const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; }
const sim = (a, b) => { a = norm(a); b = norm(b); return a && b ? 1 - lev(a, b) / Math.max(a.length, b.length) : 0; };
function match(name, tr) {
  let best = null, bs = 0;
  for (const [tn, tq] of tr) {
    const cands = [tn, tn.replace(/\s*\S*\d\S*$/, '')]; // название без числа в конце («Filter MERV»)
    for (const c of cands) { const s = sim(name, c); if (s > bs) { bs = s; best = { tn, tq }; } }
  }
  return bs >= 0.6 ? { ...best, s: bs } : null;
}
let totWrong = 0, totOk = 0, totFlag = 0, totMiss = 0, totUnknown = 0;
const summary = [];
for (const n of names) {
  const { words } = cache[n];
  const lines = groupWordsToLines(words);
  const { items, dropped } = parseOrderLines(lines);
  const tr = truth[n];
  let wrong = 0, ok = 0, flag = 0, unknown = 0; const found = new Set(); const notes = [];
  for (const i of items) {
    const m = match(i.name, tr);
    if (m) found.add(m.tn);
    const has = i.qty !== null && !i.flags.includes('qty');
    if (!has) { flag++; notes.push(`   ⚑ ${i.name} [${i.flags}]`); continue; }
    if (!m) { unknown++; notes.push(`   ?? «${i.name}» = ${i.qty} без флага — нет такой позиции на скрине`); continue; }
    if (m.tq === i.qty) { ok++; notes.push(`   ✓ ${i.name} = ${i.qty}`); }
    else { wrong++; notes.push(`   ✗✗ «${i.name}» = ${i.qty} без флага, правда «${m.tn}» = ${m.tq ?? 'пусто'}`); }
  }
  const miss = tr.filter(([tn]) => !found.has(tn)).length;
  totWrong += wrong; totOk += ok; totFlag += flag; totMiss += miss; totUnknown += unknown;
  summary.push({ n, ok, wrong, unknown, flag, miss, of: tr.length });
  console.log(`== ${n}: верно ${ok}, НЕВЕРНО без флага ${wrong}, лишние с кол-вом ${unknown}, с флагом ${flag}, не найдено ${miss} из ${tr.length}`);
  if (process.env.V) for (const l of lines) console.log('     L|', l.text);
  for (const x of notes) console.log(x);
}
console.log(`\nИТОГО: верно ${totOk}, НЕВЕРНО без флага ${totWrong}, лишние позиции с кол-вом без флага ${totUnknown}, с флагом ${totFlag}, не найдено ${totMiss}`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(summary, null, 1));
