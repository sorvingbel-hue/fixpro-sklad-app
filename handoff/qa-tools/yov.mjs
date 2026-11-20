// Вертикальное совпадение числа в конце строки с названием этой строки (для подсказки по правке)
import fs from 'node:fs';
const APP = '/tmp/claude-0/-home-user/8feac192-9784-5733-9e7d-ce58c4f28f5b/scratchpad/qa_point/app';
const { groupWordsToLines } = await import(APP + '/src/features/jobs/order-parse.ts');
const [dir, ...names] = process.argv.slice(2);
const cache = JSON.parse(fs.readFileSync(dir + '/words.json', 'utf8'));
for (const n of names) {
  console.log('==', n);
  for (const l of groupWordsToLines(cache[n].words)) {
    const ws = l.words; if (ws.length < 2) continue;
    const last = ws[ws.length - 1]; if (!/^\d+$/.test(last.text)) continue;
    const nm = ws.slice(0, -1); const y0 = Math.min(...nm.map(w => w.bbox.y0)), y1 = Math.max(...nm.map(w => w.bbox.y1));
    // центр по вертикали: у названия — медиана центров слов, у числа — центр рамки; сдвиг в долях высоты
    const cy = (last.bbox.y0 + last.bbox.y1) / 2, ny = nm.map(w => (w.bbox.y0 + w.bbox.y1) / 2).sort((a, b) => a - b)[Math.floor(nm.length / 2)];
    const h = Math.max(...nm.map(w => w.bbox.y1 - w.bbox.y0));
    // дрейф внутри названия: наклон центров слов по x (пикселей на 1000 px)
    const drift = nm.length >= 2 ? ((nm[nm.length - 1].bbox.y0 + nm[nm.length - 1].bbox.y1) / 2 - (nm[0].bbox.y0 + nm[0].bbox.y1) / 2) / Math.max(1, nm[nm.length - 1].bbox.x0 - nm[0].bbox.x0) * 1000 : 0;
    const ov = (Math.min(y1, last.bbox.y1) - Math.max(y0, last.bbox.y0)) / (last.bbox.y1 - last.bbox.y0);
    console.log(`  ${l.text.padEnd(32)} сдвиг центра=${((cy - ny) / h).toFixed(2)} h  перекрытие=${ov.toFixed(2)} наклон=${drift.toFixed(0)}‰`);
  }
}
