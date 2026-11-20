// Для каждой картинки: заголовок «Qty» в одной строке с «Description» или отдельно? и есть ли неверные количества без флага
import fs from 'node:fs';
const [IMG, PARSER] = process.argv.slice(2);
const { groupWordsToLines, parseOrderLines } = await import(PARSER);
const cache = JSON.parse(fs.readFileSync(IMG + '/words.json', 'utf8'));
const truth = JSON.parse(fs.readFileSync(IMG + '/truth.json', 'utf8'));
const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
let tab = { split: { wrong: 0, imgs: 0 }, joined: { wrong: 0, imgs: 0 }, none: { wrong: 0, imgs: 0 } };
for (const [n, { words }] of Object.entries(cache)) {
  if (!truth[n]) continue;
  const lines = groupWordsToLines(words);
  const hl = lines.find(l => /\bqty\b/i.test(l.text) && !/\d/.test(l.text));
  const kind = !hl ? 'none' : hl.words.length === 1 ? 'split' : 'joined';
  const { items } = parseOrderLines(lines);
  let wrong = 0;
  for (const i of items) {
    if (i.qty === null || i.flags.includes('qty')) continue;
    const t = truth[n].find(([tn]) => norm(i.name).startsWith(norm(tn).slice(0, 8)));
    if (!t || t[1] !== i.qty) wrong++;
  }
  tab[kind].imgs++; tab[kind].wrong += wrong;
  if (wrong) console.log(n, kind, 'wrong', wrong);
}
console.log(JSON.stringify(tab));
