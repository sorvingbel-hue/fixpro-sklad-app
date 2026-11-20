// Синтетические строки распознавания (с рамками слов, как в приложении, и без) → parseOrderLines.
// Ищем НЕВЕРНОЕ количество БЕЗ флага. Модуль берётся из копии проекта (argv[2]) — по умолчанию qa_point/app.
const APP = process.argv[2] || '/tmp/claude-0/-home-user/8feac192-9784-5733-9e7d-ce58c4f28f5b/scratchpad/qa_point/app';
const { parseOrderLines, groupWordsToLines } = await import(APP + '/src/features/jobs/order-parse.ts');

// --- рамки слов: строка = ячейки {t, x, align:'l'|'r'} на высоте y; ширина знака 0.55*h
const H = 46, CW = 0.55 * H;
function cellWords(t, x, y, align = 'l', conf = 95) {
  const parts = t.split(/\s+/).filter(Boolean);
  const widths = parts.map(p => p.length * CW);
  const total = widths.reduce((a, b) => a + b, 0) + (parts.length - 1) * CW;
  let cx = align === 'r' ? x - total : x;
  return parts.map((p, k) => { const w = { text: p, confidence: conf, bbox: { x0: Math.round(cx), y0: y, x1: Math.round(cx + widths[k]), y1: y + H } }; cx += widths[k] + CW; return w; });
}
function screen(rows) { // rows: [[{t,x,align}], ...] — каждая строка на своей высоте
  const words = []; let y = 100;
  for (const r of rows) { for (const c of r) words.push(...cellWords(c.t, c.x, y + (c.dy || 0), c.align, c.conf)); y += c0(r); }
  return groupWordsToLines(words);
}
const c0 = r => (r.pitch || 110);
const L = (text, conf = 95) => ({ text, confidence: conf, words: text.split(/\s+/).filter(Boolean).map(t => ({ text: t, confidence: conf })) });

const cases = [];
const add = (id, what, lines, truth) => cases.push({ id, what, lines, truth });

// ===== A. Только текст (без рамок) — путь без рамок (в приложении не используется, для справки) + общий парсинг
add('T1', 'размер с пробелами «20 x 20» (карточка без колонки)', [L('Return grille 20 x 20'), L('Qty 6')], { 'Return grille 20 x 20': 6 });
add('T2', 'фильтр 16 x 25 x 1 (карточка, Qty ниже)', [L('Filter 16 x 25 x 1'), L('Qty 4')], { 'Filter 16 x 25 x 1': 4 });
add('T3', 'фильтр 20 x 25 x 4 одной строкой без количества', [L('Pleated filter 20 x 25 x 4')], { 'Pleated filter 20 x 25 x 4': null });
add('T4', 'flex duct 8in x 25ft (длина в названии)', [L('Insulated flex duct 8in x 25ft')], { 'Insulated flex duct 8in x 25ft': null });
add('T5', 'line set 3/8 x 3/4 25 ft (длина в названии)', [L('Line set 3/8 x 3/4 25 ft')], { 'Line set 3/8 x 3/4 25 ft': null });
add('T6', 'упаковка «100 pcs» в названии и Qty ниже', [L('Wire connectors yellow 100 pcs'), L('Qty 2')], { 'Wire connectors yellow 100 pcs': 2 });
add('T7', '«Filter MERV 13» один', [L('Filter MERV 13')], { 'Filter MERV 13': null });
add('T8', 'R-410A 25', [L('Refrigerant R-410A 25')], { 'Refrigerant R-410A 25': null });
add('T9', '2 pole 30 + Qty: 1 ниже', [L('Breaker 2 pole 30'), L('Qty: 1')], { 'Breaker 2 pole 30': 1 });
add('T10', 'модель 25HCB636A003 1 (без заголовка)', [L('Condenser 25HCB636A003 1')], { 'Condenser 25HCB636A003': 1 });
add('T11', '3/4" , 6-ft, 24V, 1/2 HP', [L('Copper elbow 3/4"'), L('Whip 6-ft'), L('Transformer 24V'), L('Blower motor 1/2 HP')], {});
add('T12', '«6 x 20 x 20 return grille»?', [L('20 x 20 Return grille')], { '20 x 20 Return grille': null });

// ===== B. С рамками (как в приложении: groupWordsToLines по рамкам)
const N = 60, Q = 1100; // колонка названий слева, «Qty» прижато вправо (как у pt-a)
const head = (x = Q) => [{ t: 'Description', x: N }, { t: 'Qty', x, align: 'r' }];
const row = (nm, q, x = Q) => [{ t: nm, x: N }, ...(q === null ? [] : [{ t: String(q), x, align: 'r' }])];
add('B1', 'колонка Qty справа, у MERV 11 пустая клетка', [
  ...screen([head(), row('Return grille 20x20', 6), row('Filter MERV 11', null), row('Breaker 2 pole 30', 1)]),
], { 'Return grille 20x20': 6, 'Filter MERV 11': null, 'Breaker 2 pole 30': 1 });

// B2: после таблицы — раздел «Equipment» с ключ-значение справа (значения стоят под колонкой Qty)
add('B2', 'после таблицы и итога — справочные строки с числом справа (под колонкой Qty)', [
  ...screen([head(), row('Return grille 20x20', 6), row('Filter MERV 13', 2),
    [{ t: 'Subtotal', x: N }, { t: '$412.00', x: Q, align: 'r' }],
    [{ t: 'Equipment on site', x: N }],
    [{ t: 'Breaker 2 pole', x: N }, { t: '30', x: Q, align: 'r' }],
    [{ t: 'Tonnage', x: N }, { t: '3', x: Q, align: 'r' }],
    [{ t: 'Filter MERV', x: N }, { t: '13', x: Q, align: 'r' }],
  ]),
], { 'Return grille 20x20': 6, 'Filter MERV 13': 2, 'Breaker 2 pole 30': null, 'Tonnage 3': null, 'Filter MERV 13#2': null });

// B3: колонка «Unit» после Qty: у строки пустое кол-во (или «1» не распознана) — число из названия + «ea»
add('B3', '«Description Qty Unit»: клетка Qty пустая/не распознана → «Filter MERV 13 ea»', [
  ...screen([[{ t: 'Description', x: N }, { t: 'Qty', x: 900, align: 'r' }, { t: 'Unit', x: 1100, align: 'r' }],
    [{ t: 'Return grille 20x20', x: N }, { t: '6', x: 900, align: 'r' }, { t: 'ea', x: 1100, align: 'r' }],
    [{ t: 'Filter MERV 13', x: N }, { t: 'ea', x: 1100, align: 'r' }],
    [{ t: 'Breaker 2 pole 30', x: N }, { t: 'ea', x: 1100, align: 'r' }],
  ]),
], { 'Return grille 20x20': 6, 'Filter MERV 13': null, 'Breaker 2 pole 30': null });

// B4: тесные колонки «Description Qty Price» — цена целым числом без $ рядом с Qty (в пределах высоты строки)
add('B4', 'тесные колонки Qty | Price (цена без $ и копеек)', [
  ...screen([[{ t: 'Description', x: N }, { t: 'Qty', x: 760 }, { t: 'Price', x: 880 }],
    [{ t: 'Return grille 20x20', x: N }, { t: '6', x: 760 }, { t: '45', x: 880 }],
    [{ t: 'Filter MERV 13', x: N }, { t: '2', x: 760 }, { t: '35', x: 880 }],
  ]),
], { 'Return grille 20x20': 6, 'Filter MERV 13': 2 });
// B4b: то же, но Price левее края на 1 высоту строки — ближе
add('B4b', 'тесные колонки Qty | Price — 805 px', [
  ...screen([[{ t: 'Description', x: N }, { t: 'Qty', x: 760 }, { t: 'Price', x: 830 }],
    [{ t: 'Return grille 20x20', x: N }, { t: '6', x: 760 }, { t: '45', x: 830 }],
    [{ t: 'Filter MERV 13', x: N }, { t: '2', x: 760 }, { t: '35', x: 830 }],
  ]),
], { 'Return grille 20x20': 6, 'Filter MERV 13': 2 });

// B5: колонка Qty слева
add('B5', 'колонка Qty слева: «Qty Description»', [
  ...screen([[{ t: 'Qty', x: 60 }, { t: 'Description', x: 200 }],
    [{ t: '6', x: 60 }, { t: 'Return grille 20x20', x: 200 }],
    [{ t: '2', x: 60 }, { t: 'Filter MERV 13', x: 200 }],
    [{ t: '1', x: 60 }, { t: 'Breaker 2 pole 30', x: 200 }],
  ]),
], { 'Return grille 20x20': 6, 'Filter MERV 13': 2, 'Breaker 2 pole 30': 1 });

// B6: «20 x 20» с пробелами в таблице, у которой кол-во — в карточке «Qty 6» ниже
add('B6', 'карточки: «Return grille 20 x 20» / «Qty 6» (с рамками)', [
  ...screen([[{ t: 'Return grille 20 x 20', x: N }], [{ t: 'Qty 6', x: N }], [{ t: 'Filter 16 x 25 x 1', x: N }], [{ t: 'Qty 4', x: N }]]),
], { 'Return grille 20 x 20': 6, 'Filter 16 x 25 x 1': 4 });

// B7: две строки названия, число по центру (строка таблицы в 2 строки)
add('B7', 'название в 2 строки, кол-во по центру строки таблицы', [
  ...groupWordsToLines([
    ...cellWords('Description', N, 100), ...cellWords('Qty', Q, 100, 'r'),
    ...cellWords('Bar type supply registers', N, 210), ...cellWords('10x6 white', N, 260), ...cellWords('6', Q, 235, 'r'),
    ...cellWords('Breaker 2 pole', N, 370), ...cellWords('30 amp', N, 420), ...cellWords('1', Q, 395, 'r'),
  ]),
], { 'Bar type supply registers 10x6 white': 6, 'Breaker 2 pole 30 amp': 1 });

// B8: колонка Qty, «6.00» с копейками
add('B8', 'Qty в формате 6.00', [
  ...screen([head(), row('Return grille 20x20', '6.00'), row('Filter MERV 13', '2.00')]),
], { 'Return grille 20x20': 6, 'Filter MERV 13': 2 });

// B9: перекос: колонка Qty «съезжает» вниз — число строки N на высоте строки N+1 (сдвиг ≈ шаг строк)
const skewRows = (shift) => groupWordsToLines([
  ...cellWords('Description', N, 100), ...cellWords('Qty', Q, 100 + shift, 'r'),
  ...[['Return grille 20x20', 6], ['Filter MERV 13', 2], ['Breaker 2 pole 30', 1], ['Supply boot 6x10', 4], ['Flex duct 8 in', 3]]
    .flatMap(([nm, q], k) => [...cellWords(nm, N, 210 + k * 110), ...cellWords(String(q), Q, 210 + k * 110 + shift, 'r')]),
]);
for (const sh of [30, 60, 80, 100, 110, -20, -30, -40, -60, -80, -90, -100, -110, -130]) add('B9/' + sh, `колонка Qty сдвинута по вертикали на ${sh} px (шаг 110)`, skewRows(sh),
  { 'Return grille 20x20': 6, 'Filter MERV 13': 2, 'Breaker 2 pole 30': 1, 'Supply boot 6x10': 4, 'Flex duct 8 in': 3 });

// B10: два заголовка: вторая таблица — без колонки Qty, но с числом справа (часы работы)
add('B10', 'вторая таблица «Labor Hours» под первой (заголовок без Qty)', [
  ...screen([head(), row('Return grille 20x20', 6), [{ t: 'Labor', x: N }, { t: 'Hours', x: Q, align: 'r' }],
    [{ t: 'Install return grille', x: N }, { t: '2', x: Q, align: 'r' }], [{ t: 'Replace breaker', x: N }, { t: '1', x: Q, align: 'r' }]]),
], { 'Return grille 20x20': 6, 'Install return grille': null, 'Replace breaker': null });

// B11: заголовок «Item # Description Qty» и номер строки слева
add('B11', '«# Description Qty» и номера строк', [
  ...screen([[{ t: '#', x: 40 }, { t: 'Description', x: 120 }, { t: 'Qty', x: Q, align: 'r' }],
    [{ t: '1', x: 40 }, { t: 'Filter MERV 13', x: 120 }],
    [{ t: '2', x: 40 }, { t: 'Breaker 2 pole 30', x: 120 }, { t: '1', x: Q, align: 'r' }]]),
], { 'Filter MERV 13': null, 'Breaker 2 pole 30': 1 });

// ===== прогон
const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
let bad = 0;
for (const c of cases) {
  const { items, dropped } = parseOrderLines(c.lines);
  const out = items.map(i => `${i.qty ?? '∅'}${i.flags.length ? '[' + i.flags + ']' : ''} ${i.name}`);
  const errs = [];
  for (const i of items) {
    if (i.qty === null || i.flags.includes('qty')) continue;
    // найти правду по названию (имя из черновика ⊂ правды или наоборот)
    const tk = Object.keys(c.truth).find(k => norm(k.split('#')[0]).startsWith(norm(i.name)) || norm(i.name).startsWith(norm(k.split('#')[0])));
    const want = tk === undefined ? undefined : c.truth[tk];
    if (tk === undefined) errs.push(`НЕТ В ПРАВДЕ, но кол-во без флага: «${i.name}» = ${i.qty}`);
    else if (want !== i.qty) errs.push(`НЕВЕРНО без флага: «${i.name}» = ${i.qty} (правда ${want ?? 'пусто'})`);
  }
  if (errs.length) bad++;
  console.log(`${errs.length ? '✗' : '✓'} ${c.id} ${c.what}`);
  for (const o of out) console.log('     I|', o);
  for (const d of dropped) console.log('     D|', d.why, '|', d.raw);
  for (const e of errs) console.log('   !!', e);
}
console.log(`\nслучаев с неверным количеством без флага: ${bad} из ${cases.length}`);
