// Разбор распознанного скрина заказа (order-parse.ts): проверка без телефона и без распознавания.
// Запуск: npm run test:ocr-parse
import assert from 'node:assert/strict';

import {
  findExisting, OUT_NOTE, groupWordsToLines, nameKey, parseOrderLines, planConfirm, QTY_CONF_MIN, rowQty, toRows, TRAIL_NOTE, COL_NOTE, orphanNumbers,
} from '../src/features/jobs/order-parse.ts';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('PASS', name); };

// строка распознавания: слова с уверенностью; conf — общая, можно задать уверенность отдельных слов
const L = (text, conf = 95, per = {}) => ({
  text, confidence: conf, words: text.split(/\s+/).filter(Boolean).map(t => ({ text: t, confidence: per[t] ?? conf })),
});
const one = (text, conf, per) => parseOrderLines([L(text, conf, per)]).items;

test('«Qty 6» в конце строки; размер 10x6 — не количество', () => {
  const [it] = one('Bar type supply registers 10x6 Qty 6');
  assert.equal(it.name, 'Bar type supply registers 10x6');
  assert.equal(it.qty, 6);
  assert.equal(it.unit, 'шт.');
  assert.deepEqual(it.flags, []);
});

test('«Qty: 6», «Qty:6», «Quantity 6», «Кол-во: 6»', () => {
  for (const s of ['Return grille 20x20 Qty: 6', 'Return grille 20x20 Qty:6', 'Return grille 20x20 Quantity 6', 'Return grille 20x20 Кол-во: 6']) {
    const [it] = one(s);
    assert.equal(it?.qty, 6, s);
    assert.equal(it.name, 'Return grille 20x20', s);
  }
});

test('«x6», «x 6», «6 x …», «6x …», «… 6 x»', () => {
  assert.equal(one('Flex duct 6in x6')[0].qty, 6);
  assert.equal(one('Flex duct 6in x 6')[0].qty, 6);
  const [a] = one('6 x Flex duct 6in');
  assert.equal(a.qty, 6); assert.equal(a.name, 'Flex duct 6in');
  assert.equal(one('4x Disconnect box 60A')[0].qty, 4);
  assert.equal(one('Disconnect box 60A 2 x')[0].qty, 2);
});

test('«6 ea», «6 pcs», «6pcs», «25 ft» в конце', () => {
  const [a] = one('Copper fitting 3/4 6 ea');
  assert.equal(a.qty, 6); assert.equal(a.unit, 'шт.'); assert.equal(a.name, 'Copper fitting 3/4');
  assert.equal(one('Wire nuts 10 pcs')[0].qty, 10);
  assert.equal(one('Wire nuts 10pcs')[0].qty, 10);
  // ИЗМЕНЕНО (break-отчёт T5): длина в конце бывает частью названия («Line set 3/8 x 3/4 25 ft») — без колонки «Qty» флаг
  const [f] = one('Copper pipe 3/8 25 ft');
  assert.equal(f.qty, null); assert.deepEqual(f.flags, ['qty']); assert.equal(f.name, 'Copper pipe 3/8 25 ft');
  const [g] = one('Copper pipe 3/8 Qty 25 ft');
  assert.equal(g.qty, 25); assert.equal(g.unit, 'фут');
});

// ИЗМЕНЕНО (правка dot «Filter MERV 13»): раньше одиночное число в конце строки считалось количеством всегда.
// Теперь без «Qty/x/ea» и без колонки «Qty» это не доказано: число остаётся в названии, пусто и флаг.
test('число в конце строки без «Qty» и без заголовка колонки — не количество; под заголовком «Items Qty» — количество', () => {
  const [a] = one('Thermostat T-01 2');
  assert.equal(a.qty, null); assert.equal(a.name, 'Thermostat T-01 2'); assert.deepEqual(a.flags, ['qty']); assert.equal(a.note, TRAIL_NOTE);
  const [b] = one('3. Condensate pump 1');
  assert.equal(b.qty, null); assert.equal(b.name, 'Condensate pump 1'); assert.deepEqual(b.flags, ['qty']);
  const r = parseOrderLines([L('Items Qty'), L('Thermostat T-01 2'), L('3. Condensate pump 1')]).items;
  assert.deepEqual(r.map(i => [i.name, i.qty, i.flags.join()]), [['Thermostat T-01', 2, ''], ['Condensate pump', 1, '']]);
});

test('явное «Qty» важнее длины в названии («25 ft … Qty 3»)', () => {
  const [it] = one('Flex duct 6 in, 25 ft Qty 3');
  assert.equal(it.qty, 3);
  assert.equal(it.name, 'Flex duct 6 in, 25 ft');
});

test('неуверенные цифры количества → qty=null и «проверь количество» (не угадываем)', () => {
  for (const s of ['Filter base Qty O', 'Filter base Qty S', 'Filter base Qty B', 'Filter base Qty l2', 'Filter base Qty I', 'Filter base x S', 'Filter base Qty ~']) {
    const [it] = one(s);
    assert.ok(it, s);
    assert.equal(it.qty, null, s);
    assert.deepEqual(it.flags, ['qty'], s);
    assert.equal(it.name, 'Filter base', s);
  }
  const [low] = one('Gas valve Qty 8', 95, { 8: QTY_CONF_MIN - 1 });
  assert.equal(low.qty, null); assert.deepEqual(low.flags, ['qty']);
  const [ok] = one('Gas valve Qty 8', 95, { 8: QTY_CONF_MIN + 5 });
  assert.equal(ok.qty, 8);
  const [mixed] = one('Return grille 2O');
  assert.equal(mixed.qty, null); assert.deepEqual(mixed.flags, ['qty']);
  assert.deepEqual(one('Copper fitting S ea')[0].flags, ['qty']);
});

test('«Qty» без цифры (цифра размазана) → позиция с пустым количеством и флагом', () => {
  const [it] = one('Condensate pump Qty');
  assert.equal(it.name, 'Condensate pump');
  assert.equal(it.qty, null);
  assert.deepEqual(it.flags, ['qty']);
});

test('0 и огромные числа — не количество (флаг)', () => {
  assert.deepEqual(one('Gas valve Qty 0')[0].flags, ['qty']);
  assert.equal(one('Gas valve Qty 5000')[0].qty, null);
});

test('итоги, цены, телефоны, адреса, шапка — отбрасываются', () => {
  const r = parseOrderLines([
    '9:41', 'ORDER #DEMO-OCR (sample)', 'Customer: Sample Customer', 'Phone: (555) 010-0199', '(619) 555-0100',
    '100 Sample Way, San Diego, CA 92101', 'Subtotal $1,240.00', 'Tax $96.10', 'Total $1,336.10', 'Balance due 0.00',
    'Email: test@example.com', 'Items Qty', 'Technician: Demo Tech', 'Date: 11/19/2026', 'Labor 2 $150.00',
  ].map(t => L(t)));
  assert.deepEqual(r.items, []);
  assert.equal(r.dropped.length, 15);
  assert.ok(r.dropped.some(d => d.why === 'итог или оплата'));
  assert.ok(r.dropped.some(d => d.why === 'телефон' || d.why === 'контакты'));
  assert.ok(r.dropped.some(d => d.why === 'адрес'));
});

test('строка с ценой: явное количество берём, цену — нет', () => {
  const [it] = one('Bar type registers x6 $40.00');
  assert.equal(it.qty, 6); assert.equal(it.name, 'Bar type registers');
  const [b] = one('Return grille Qty 2 $35.00');
  assert.equal(b.qty, 2);
});

test('мусор распознавания и строки без количества — не позиции', () => {
  const r = parseOrderLines(['~~ ,. ;', '|||', 'Return air grille 20x20', '— — —', 'aa', '12'].map(t => L(t)));
  assert.deepEqual(r.items, []);
  assert.ok(r.dropped.some(d => d.raw === 'Return air grille 20x20' && d.why === 'нет количества'));
});

test('количество отдельной строкой под названием', () => {
  const r = parseOrderLines([L('Bar type supply registers 10x6'), L('Qty: 6'), L('Return grille 20x20'), L('Total $10.00')]);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].name, 'Bar type supply registers 10x6');
  assert.equal(r.items[0].qty, 6);
  assert.ok(r.dropped.some(d => d.raw === 'Return grille 20x20'));
});

test('неуверенное название → «проверь название»', () => {
  const [it] = one('Cndnsat pmp Qty 2', 95, { Cndnsat: 30, pmp: 40 });
  assert.equal(it.qty, 2);
  assert.deepEqual(it.flags, ['name']);
});

test('строки из распознанного примера (как их выдаёт телефон)', () => {
  const r = parseOrderLines([
    L('9:41'), L('ORDER #DEMO-OCR (sample)'), L('Fictional example for testing, not a real order'), L('Customer: Sample Customer'),
    L('Phone: (555) 010-0199'), L('100 Sample Way, San Diego, CA 92101'), L('Items Qty'),
    L('Furnace 80% 60k BTU (sample) Qty 1'), L('Bar type supply registers 10x6 Qty 6'), L('Return air grille 20x20 Qty 2'),
    L('Flex duct 6 in, 25 ft Qty 3'), L('Thermostat T-01 (sample) Qty 1'), L('Condensate pump Qty'),
    L('Subtotal $1,240.00'), L('Tax $96.10'), L('Total $1,336.10'), L('Technician: Demo Tech'), L('Sample image for Forman OCR test'),
  ]);
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.flags.join()]), [
    ['Furnace 80% 60k BTU (sample)', 1, ''],
    ['Bar type supply registers 10x6', 6, ''],
    ['Return air grille 20x20', 2, ''],
    ['Flex duct 6 in, 25 ft', 3, ''],
    ['Thermostat T-01 (sample)', 1, ''],
    ['Condensate pump', null, 'qty'],
  ]);
});

test('слова из двух колонок (название слева, «Qty 6» справа) собираются в одну строку', () => {
  const w = (text, x0, y0, conf = 95) => ({ text, confidence: conf, bbox: { x0, y0, x1: x0 + 24 * text.length, y1: y0 + 40 } });
  const lines = groupWordsToLines([
    w('Qty', 980, 752), w('6', 1060, 750), w('Bar', 60, 750), w('type', 130, 751), w('registers', 230, 749),
    w('Return', 60, 860), w('Qty', 980, 861), w('2', 1060, 860),
  ]);
  assert.deepEqual(lines.map(l => l.text), ['Bar type registers Qty 6', 'Return Qty 2']);
  assert.equal(parseOrderLines(lines).items[0].qty, 6);
});

test('черновик → подтверждение: повторы и пустые строки видны, не задваиваются молча', () => {
  const rows = toRows(parseOrderLines([L('Bar type registers 10x6 Qty 6'), L('Condensate pump Qty'), L('bar  type registers 10x6 x2')]).items, k => 'r' + k);
  assert.equal(rows[1].qty, '');
  rows.push({ key: 'm', name: '  ', qty: '', unit: 'шт.', flags: [], raw: '', confidence: 100 });
  const plan = planConfirm(rows, ['Condensate Pump']);
  assert.deepEqual(plan.add.map(r => r.key), ['r0']);
  assert.deepEqual(plan.dupExisting.map(r => r.key), ['r1']);
  assert.deepEqual(plan.dupInDraft.map(r => r.key), ['r2']);
  assert.deepEqual(plan.empty.map(r => r.key), ['m']);
  assert.equal(nameKey('Bar  Type, registers!'), 'bar type registers');
  assert.equal(rowQty(' 6 '), 6);
  assert.equal(rowQty('2,5'), 2.5);
  assert.equal(rowQty(''), null);
  assert.equal(rowQty('шесть'), null);
});

test('уверенность цифр по знакам: «x4» (слово не из словаря) берём, размытую цифру — нет', () => {
  const W = (text, confidence, sym) => ({ text, confidence, symbols: [...text].map((ch, k) => ({ text: ch, confidence: sym[k] ?? 99 })) });
  const line = (...words) => ({ text: words.map(w => w.text).join(' '), confidence: 90, words });
  const [a] = parseOrderLines([line(W('Disconnect', 96, []), W('box', 93, []), W('60A', 91, []), W('x4', 42, [95, 91]))]).items;
  assert.equal(a.qty, 4); assert.deepEqual(a.flags, []);
  const [b] = parseOrderLines([line(W('Gas', 96, []), W('valve', 96, []), W('Qty', 95, []), W('6', 95, [50]))]).items;
  assert.equal(b.qty, null); assert.deepEqual(b.flags, ['qty']);
  const [c] = parseOrderLines([line(W('Wire', 96, []), W('nuts', 96, []), W('Qty:6', 40, [99, 99, 99, 99, 97]))]).items;
  assert.equal(c.qty, 6);
});

// ---------- Исправления после проверки (дефекты 1, 2 и риски формата) ----------

test('«Qty N» строкой ниже, а название кончается числом: количество — из «Qty», число остаётся в названии', () => {
  for (const [a, b, name, qty] of [
    ['Flex duct 8', 'Qty 12', 'Flex duct 8', 12], ['Disconnect 60', 'Qty 1', 'Disconnect 60', 1],
    ['Filter MERV 13', 'Qty 2', 'Filter MERV 13', 2], ['Breaker 2 pole 30', 'Qty: 4', 'Breaker 2 pole 30', 4],
  ]) {
    const r = parseOrderLines([L(a), L(b)]);
    assert.deepEqual(r.items.map(i => [i.name, i.qty, i.flags.join()]), [[name, qty, '']], `${a} / ${b}`);
    assert.equal(r.items[0].raw, `${a} / ${b}`);
    assert.deepEqual(r.dropped, [], 'строка «Qty N» не уходит в пропущенные');
  }
  // подряд несколько таких пар и обычные строки между ними
  const r = parseOrderLines(['Flex duct 8', 'Qty 12', 'Supply boot Qty 6', 'Disconnect 60', 'Qty 1', 'Total $10.00'].map(t => L(t)));
  assert.deepEqual(r.items.map(i => [i.name, i.qty]), [['Flex duct 8', 12], ['Supply boot', 6], ['Disconnect 60', 1]]);
  // «Qty N» далеко от строки с числом (между ними другая строка) — не склеиваем.
  // ИЗМЕНЕНО: раньше «Thermostat T-01 2» давал 2; теперь число без доказательства — пусто и флаг, «2» в названии
  const far = parseOrderLines(['Thermostat T-01 2', 'Notes text here', 'Qty 5'].map(t => L(t)));
  const th = far.items.find(i => i.name.startsWith('Thermostat'));
  assert.equal(th?.qty, null); assert.equal(th.name, 'Thermostat T-01 2'); assert.deepEqual(th.flags, ['qty']);
});

test('скрин с явным «Qty»: строка с числом в конце без «Qty» — пусто и флаг, число остаётся в названии', () => {
  const r = parseOrderLines(['Supply boot Qty 6', 'Wire nuts x10', 'Filter MERV 13', 'Breaker 2 pole 30', 'Copper elbow 4 ea'].map(t => L(t)));
  const merv = r.items.find(i => i.name === 'Filter MERV 13');
  // ИЗМЕНЕНО: текст причины — «число в конце может быть частью названия — проверь» (было «…без «Qty»…»)
  assert.ok(merv); assert.equal(merv.qty, null); assert.deepEqual(merv.flags, ['qty']); assert.equal(merv.note, TRAIL_NOTE);
  const br = r.items.find(i => i.name === 'Breaker 2 pole 30');
  assert.equal(br.qty, null);
  assert.equal(r.items.find(i => i.name === 'Supply boot').qty, 6);
  // скрин, где у всех строк число в конце (колонка «Qty» справа), — берём как есть
  const col = parseOrderLines(['Items Qty', 'Supply boot 6', 'Filter MERV 13 2', 'Thermostat T-01 1'].map(t => L(t)));
  assert.deepEqual(col.items.map(i => [i.name, i.qty, i.flags.join()]), [['Supply boot', 6, ''], ['Filter MERV 13', 2, ''], ['Thermostat T-01', 1, '']]);
});

// слово с рамками знаков: ширина рамки знака w при высоте 30 (у обычной «1» в шрифте Inter ~10, у слитой «11» ~27)
const SW = (text, x0, widths, conf = 96, h = 30) => {
  let x = x0;
  const symbols = [...text].map((ch, k) => { const w = widths[k] ?? 18; const b = { x0: x, y0: 100, x1: x + w, y1: 100 + h }; x += w + 4; return { text: ch, confidence: 99, bbox: b }; });
  return { text, confidence: conf, bbox: { x0, y0: 100, x1: x, y1: 100 + h }, symbols };
};
const SL = (...words) => ({ text: words.map(w => w.text).join(' '), confidence: 95, words });
const nameW = (t, x) => ({ text: t, confidence: 96, bbox: { x0: x, y0: 100, x1: x + 20 * t.length, y1: 130 } });

test('«11», прочитанное как «1» (одна цифра вдвое шире обычной «1»), — пусто и флаг, хотя уверенность 98', () => {
  const lines = [
    SL(nameW('Damper', 0), nameW('motor', 200), nameW('Qty', 900), SW('12', 1000, [10, 18])),
    SL(nameW('Filter', 0), nameW('rack', 200), nameW('Qty', 900), SW('10', 1000, [10, 20])),
    SL(nameW('Leak', 0), nameW('sealer', 200), nameW('Qty', 900), SW('15', 1000, [10, 18])),
    SL(nameW('Copper', 0), nameW('elbow', 200), nameW('Qty', 900), SW('1', 1000, [27], 89)),
    SL(nameW('Fan', 0), nameW('relay', 200), nameW('Qty', 900), SW('1', 1000, [10], 89)),
  ];
  const r = parseOrderLines(lines);
  const el = r.items.find(i => i.name === 'Copper elbow');
  assert.equal(el.qty, null); assert.deepEqual(el.flags, ['qty']); assert.match(el.note, /слились две цифры/);
  assert.equal(r.items.find(i => i.name === 'Fan relay').qty, 1, 'обычная узкая «1» — это 1');
  assert.equal(r.items.find(i => i.name === 'Damper motor').qty, 12);
});

test('шрифт с широкой «1» (с засечкой, DejaVu/Liberation): обычная «1» не флагуется; без эталона — общие пороги', () => {
  const wideFont = [
    SL(nameW('Damper', 0), nameW('motor', 200), nameW('Qty', 900), SW('11', 1000, [18, 18])),
    SL(nameW('Filter', 0), nameW('rack', 200), nameW('Qty', 900), SW('10', 1000, [18, 20])),
    SL(nameW('Leak', 0), nameW('sealer', 200), nameW('Qty', 900), SW('21', 1000, [18, 18])),
    SL(nameW('Fan', 0), nameW('relay', 200), nameW('Qty', 900), SW('1', 1000, [19])),
  ];
  assert.equal(parseOrderLines(wideFont).items.find(i => i.name === 'Fan relay').qty, 1);
  // одна строка, эталона нет: «1» шириной 27 при высоте 30 (0,9) — флаг; «4» шириной 21 — нет; «2» шириной 40 (две слились) — флаг
  assert.equal(parseOrderLines([SL(nameW('Copper', 0), nameW('elbow', 200), nameW('Qty', 900), SW('1', 1000, [27]))]).items[0].qty, null);
  assert.equal(parseOrderLines([SL(nameW('Copper', 0), nameW('elbow', 200), nameW('Qty', 900), SW('4', 1000, [21]))]).items[0].qty, 4);
  assert.equal(parseOrderLines([SL(nameW('Copper', 0), nameW('elbow', 200), nameW('Qty', 900), SW('2', 1000, [40]))]).items[0].qty, null);
  // число в названии с широкой цифрой не мешает количеству
  assert.equal(parseOrderLines([SL(nameW('Duct', 0), SW('1', 100, [27]), nameW('Qty', 900), SW('4', 1000, [21]))]).items[0].qty, 4);
});

test('«Qty 2.00», «Qty 1.00» — количество (не цена); «2.00 x $35.00» — 2', () => {
  const [a] = one('Return grille 20x20 Qty 2.00 $35.00');
  assert.equal(a.qty, 2); assert.deepEqual(a.flags, []); assert.equal(a.name, 'Return grille 20x20');
  assert.equal(one('Gas valve Qty 1.00')[0].qty, 1);
  const [b] = one('Gas valve 2.00 x $35.00');
  assert.equal(b.qty, 2); assert.equal(b.name, 'Gas valve');
  assert.deepEqual(one('Labor 2 $150.00'), [], 'цена без явного количества — не позиция');
});

test('«aty 4», «Qty» распознанное с ошибкой, — тоже «Qty»; название без мусора', () => {
  const [a] = one('Register boot elbow aty 4');
  assert.equal(a.qty, 4); assert.equal(a.name, 'Register boot elbow');
});

// ---------- Правка dot: число в конце строки — количество только при доказательстве ----------

test('dot: «Filter MERV 13» одной строкой → название целиком, qty=null, флаг и причина', () => {
  const r = parseOrderLines([L('Filter MERV 13')]);
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.flags.join(), i.note]), [['Filter MERV 13', null, 'qty', TRAIL_NOTE]]);
  assert.equal(TRAIL_NOTE, 'число в конце может быть частью названия — проверь');
});

test('dot: «Filter MERV 13 Qty 2» → 2; «Filter MERV 13 2» под «Description Qty» → 2 (явные количества не сломаны)', () => {
  assert.deepEqual(one('Filter MERV 13 Qty 2').map(i => [i.name, i.qty, i.flags.join()]), [['Filter MERV 13', 2, '']]);
  const r = parseOrderLines([L('Description Qty'), L('Filter MERV 13 2')]);
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.flags.join()]), [['Filter MERV 13', 2, '']]);
  assert.ok(r.dropped.some(d => d.raw === 'Description Qty' && d.why === 'заголовок'));
});

test('dot: «Breaker 2 pole 30» без заголовка → флаг, число в названии; явные маркеры на строке ниже — количество', () => {
  assert.deepEqual(one('Breaker 2 pole 30').map(i => [i.name, i.qty, i.flags.join()]), [['Breaker 2 pole 30', null, 'qty']]);
  for (const [a, b, q] of [['Filter MERV 13', 'x2', 2], ['Breaker 2 pole 30', '2 ea', 2], ['Filter MERV 13', 'Qty: 3', 3], ['Disconnect 60', '4 pcs', 4]]) {
    const r = parseOrderLines([L(a), L(b)]);
    assert.deepEqual(r.items.map(i => [i.name, i.qty, i.flags.join()]), [[a, q, '']], `${a} / ${b}`);
  }
  // явные маркеры в строке — как раньше
  for (const [s, q] of [['Filter MERV 13 x2', 2], ['Filter MERV 13 2 ea', 2], ['Filter MERV 13 Qty: 2', 2], ['Breaker 2 pole 30 2 pcs', 2]]) {
    const [it] = one(s);
    assert.equal(it.qty, q, s); assert.deepEqual(it.flags, [], s);
  }
});

test('заголовок с «Total»/«Price» — это заголовок (не итог); «Qty» первым словом без рамок — число в конце не в колонке', () => {
  const r = parseOrderLines([L('Description Qty Price Total'), L('Filter MERV 13 2')]);
  assert.deepEqual(r.items.map(i => [i.name, i.qty]), [['Filter MERV 13 2', null]], 'Qty не последнее слово, а цены в строке нет — не доказано: число остаётся в названии');
  assert.ok(r.dropped.some(d => d.raw === 'Description Qty Price Total' && d.why === 'заголовок'));
  const q = parseOrderLines([L('Qty Description'), L('Filter MERV 13 2')]);
  assert.equal(q.items[0].qty, null);
  // скрин, где преобладают явные «Qty», — голое число в конце подозрительно и под заголовком (без рамок)
  const m = parseOrderLines(['Items Qty', 'Supply boot Qty 6', 'Wire nuts x10', 'Filter MERV 13'].map(t => L(t)));
  assert.deepEqual(m.items.map(i => [i.name, i.qty]), [['Supply boot', 6], ['Wire nuts', 10], ['Filter MERV 13', null]]);
  // «Qty» отдельной строкой сразу под названием — размазанное количество этой строки, а не заголовок
  const p = parseOrderLines([L('Condensate pump'), L('Qty')]);
  assert.deepEqual(p.items.map(i => [i.name, i.qty, i.flags.join()]), [['Condensate pump', null, 'qty']]);
});

// Слова с рамками, как их отдаёт распознавание (groupWordsToLines): x — левый край, ширина ~22 px на знак, высота 40
const BW = (text, x0, y0, conf = 95) => ({ text, confidence: conf, bbox: { x0, y0, x1: x0 + 22 * text.length, y1: y0 + 40 } });
const row = (y, name, num, numX) => {
  const ws = []; let x = 60;
  for (const t of name.split(' ')) { ws.push(BW(t, x, y)); x += 22 * t.length + 14; }
  if (num !== undefined) ws.push(BW(String(num), numX ?? x, y));
  return ws;
};

test('по рамкам слов: число в колонке «Qty» — количество; «13» сразу после «MERV» (не в колонке) — флаг', () => {
  const lines = groupWordsToLines([
    BW('Description', 60, 100), BW('Qty', 1000, 100),
    ...row(200, 'Filter MERV 13', 2, 1010),
    ...row(300, 'Filter MERV 13'),             // количество в колонке не указано: «13» стоит у названия
    ...row(400, 'Breaker 2 pole 30', 1, 1021),
    ...row(500, 'Return grille 20x20', 12, 1000),
  ]);
  const r = parseOrderLines(lines);
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.flags.join()]), [
    ['Filter MERV 13', 2, ''], ['Filter MERV 13', null, 'qty'], ['Breaker 2 pole 30', 1, ''], ['Return grille 20x20', 12, ''],
  ]);
  assert.equal(r.items[1].note, TRAIL_NOTE);
});

test('по рамкам слов: заголовка нет — число в конце не доказано, даже если все строки «как колонка»', () => {
  const r = parseOrderLines(groupWordsToLines([...row(200, 'Supply boot', 6, 1000), ...row(300, 'Filter MERV 13', 2, 1000), ...row(400, 'Flex duct', 3, 1000)]));
  assert.deepEqual(r.items.map(i => [i.qty, i.flags.join()]), [[null, 'qty'], [null, 'qty'], [null, 'qty']]);
  assert.deepEqual(r.items.map(i => i.name), ['Supply boot 6', 'Filter MERV 13 2', 'Flex duct 3']);
});

test('по рамкам слов: (в) колонка «уезжает» вбок (фото экрана с перекосом) — цепочка выровненных чисел под заголовком', () => {
  const ws = [BW('Items', 60, 100), BW('Qty', 1000, 100)];
  const names = ['Supply boot', 'Filter MERV 13', 'Flex duct', 'Wire nuts', 'Duct tape roll', 'Fan relay'];
  names.forEach((nm, k) => ws.push(...row(200 + k * 100, nm, k + 2, 990 - k * 30))); // каждая строка на 30 px левее
  const r = parseOrderLines(groupWordsToLines(ws));
  assert.deepEqual(r.items.map(i => [i.name, i.qty]), names.map((nm, k) => [nm, k + 2]));
  // число далеко от колонки и ни с чем не выровнено — не количество
  const far = parseOrderLines(groupWordsToLines([BW('Items', 60, 100), BW('Qty', 1000, 100), ...row(200, 'Supply boot', 6, 600)]));
  assert.deepEqual(far.items.map(i => [i.name, i.qty]), [['Supply boot 6', null]]);
});

test('по рамкам слов: в колонке «Qty» не цифра («3» прочитано как «a») — позиция с пустым количеством и флагом, не потеряна', () => {
  const r = parseOrderLines(groupWordsToLines([BW('Description', 60, 100), BW('Qty', 1000, 100), ...row(200, 'Flex duct 8 in', 'a', 1030), ...row(300, 'Supply boot', 4, 1030)]));
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.flags.join(), i.note ?? '']), [['Flex duct 8 in', null, 'qty', COL_NOTE], ['Supply boot', 4, '', '']]);
  // то же слово не в колонке (обычное слово названия) — строка без количества, как раньше
  const no = parseOrderLines(groupWordsToLines([BW('Description', 60, 100), BW('Qty', 1000, 100), ...row(200, 'Flex duct 8 in a')]));
  assert.deepEqual(no.items, []);
});

test('строки распались (фото под углом): числа отдельно от названий — не количества, но посчитаны для предупреждения', () => {
  const r = parseOrderLines(['Description', 'Qty', 'Return grille 20x20', '6', 'Filter MERV 13', '2', 'Breaker 2 pole 30', '> 1'].map(t => L(t)));
  assert.deepEqual(r.items.map(i => [i.name, i.qty]), [['Filter MERV 13', null], ['Breaker 2 pole 30', null]], 'ни одного количества без доказательства');
  assert.equal(orphanNumbers(r.dropped), 3);
  assert.equal(orphanNumbers(parseOrderLines(['Fictional example text', 'Items Qty', 'Gas valve Qty 2'].map(t => L(t))).dropped), 0);
});

test('повторы: «уже есть в сверке» — по умолчанию «оставить»; «заменить количество» и «добавить отдельно» — только выбором', () => {
  const ex = [{ id: 'i1', name: 'Return grille 20x20', qty: 8, actual: 4 }, { id: 'i2', name: 'Flex duct 8 in', qty: 3 }, { id: 'i3', name: 'Condensate pump', qty: 1 }];
  const R = (key, name, qty) => ({ key, name, qty, unit: 'шт.', flags: [], raw: name, confidence: 95 });
  const rows = [R('a', 'Return grille 20x20', '6'), R('b', 'FLEX duct 8 in', '5'), R('c', 'condensate pump', '1'), R('d', 'Wire nuts', '10'), R('e', 'Wire nuts', '10'), R('f', 'Supply boot', '')];
  const def = planConfirm(rows, ex);
  assert.deepEqual(def.keep.map(r => r.key), ['a', 'b', 'c'], 'по умолчанию совпавшие с позицией сверки — оставить как есть');
  assert.deepEqual(def.add.map(r => r.key), ['d', 'f']);
  assert.deepEqual(def.dupInDraft.map(r => r.key), ['e']);
  assert.deepEqual(def.replace, []);
  assert.deepEqual(def.noQty.map(r => r.key), ['f']);
  const ch = planConfirm(rows, ex, { b: 'replace', c: 'add', e: 'add', a: 'keep' });
  assert.deepEqual(ch.replace.map(x => [x.row.key, x.id, x.qty]), [['b', 'i2', 5]]);
  assert.deepEqual(ch.add.map(r => r.key), ['c', 'd', 'e', 'f']);
  assert.deepEqual(ch.keep.map(r => r.key), ['a']);
  assert.deepEqual(ch.dupExisting.map(r => r.key), ['a', 'b', 'c']);
  // «заменить» без количества в черновике — нечем заменять: остаётся как есть
  assert.deepEqual(planConfirm([R('x', 'Flex duct 8 in', '')], ex, { x: 'replace' }).keep.map(r => r.key), ['x']);
});

// ---------- Дефекты независимой проверки (break-отчёт): неверное количество без флага ----------
const tri = r => r.items.map(i => [i.name, i.qty, i.flags.join()]);

test('КРИТ: фото под углом — «Qty» отдельной строкой от «Description» (шапка расколота) — числа не количества', () => {
  const lines = groupWordsToLines([
    BW('Description', 60, 100), BW('Qty', 1000, 160),
    ...row(260, 'Filter MERV 13', 6, 1010), ...row(360, 'Breaker 2 pole 30', 2, 1010), ...row(460, 'Supply boot 6x10', 1, 1010),
  ]);
  assert.deepEqual(tri(parseOrderLines(lines)), [['Filter MERV 13 6', null, 'qty'], ['Breaker 2 pole 30 2', null, 'qty'], ['Supply boot 6x10 1', null, 'qty']]);
});

test('КРИТ: строка перекошена — число в конце заметно выше слова перед ним — не доказано колонкой', () => {
  const ws = [BW('Description', 60, 100), BW('Qty', 1000, 100), ...row(200, 'Filter MERV 13'), BW('6', 1010, 182), ...row(300, 'Disconnect 60A', 1, 1010)];
  const r = parseOrderLines(groupWordsToLines(ws));
  assert.deepEqual(tri(r), [['Filter MERV 13 6', null, 'qty'], ['Disconnect 60A', 1, '']]);
});

test('ВЫС: «100 pcs» в названии, число в колонке «Qty» — количество из колонки; без колонки — флаг', () => {
  const lines = groupWordsToLines([BW('Description', 60, 100), BW('Qty', 1000, 100), ...row(200, 'Wire connectors 100 pcs', 2, 1010), ...row(300, 'Screws #8 50 pc', 4, 1010)]);
  assert.deepEqual(tri(parseOrderLines(lines)), [['Wire connectors 100 pcs', 2, ''], ['Screws #8 50 pc', 4, '']]);
  assert.deepEqual(tri(parseOrderLines([L('Zip ties 8 in 100 pcs 3')])), [['Zip ties 8 in 100 pcs 3', null, 'qty']]);
});

test('ВЫС: колонка «Unit» при пустой клетке «Qty» — «13 ea» не количество', () => {
  const lines = groupWordsToLines([
    BW('Description', 60, 100), BW('Qty', 1000, 100), BW('Unit', 1200, 100),
    ...row(200, 'Filter MERV 13'), BW('ea', 1200, 200), ...row(300, 'Gas valve', 2, 1010), BW('ea', 1200, 300),
  ]);
  const r = parseOrderLines(lines);
  assert.deepEqual(tri(r), [['Filter MERV 13', null, 'qty'], ['Gas valve', 2, '']]);
  assert.equal(r.items[0].note, OUT_NOTE);
});

test('ВЫС: колонка «Qty» не действует после итогов и под другой шапкой («Labor Hours»)', () => {
  const lines = groupWordsToLines([
    BW('Description', 60, 100), BW('Qty', 1000, 100), ...row(200, 'Gas valve', 2, 1010),
    BW('Total', 60, 300), BW('$120.00', 1000, 300),
    ...row(400, 'Filter MERV 13', 2, 1010),
    BW('Description', 60, 500), BW('Qty', 1000, 500), ...row(600, 'Condensate pump', 1, 1010),
    BW('Labor', 60, 700), BW('Hours', 1000, 700), ...row(800, 'Install return grille', 2, 1010),
  ]);
  assert.deepEqual(tri(parseOrderLines(lines)), [['Gas valve', 2, ''], ['Filter MERV 13 2', null, 'qty'], ['Condensate pump', 1, ''], ['Install return grille 2', null, 'qty']]);
});

test('ВЫС: карточки «Название с размером» / «Qty: N» — количество из строки ниже, размер остаётся в названии', () => {
  for (const [a, b, q] of [['Return grille 20 x 20', 'Qty: 6', 6], ['Pleated filter 16 x 25 x 1', 'Qty: 4', 4], ['Flex duct 8in x 25ft', 'Qty: 3', 3],
    ['Line set 3/8 x 3/4 x 25 ft', 'Qty: 1', 1], ['Wire connectors 100 pcs', 'Qty: 2', 2]]) {
    const r = parseOrderLines([L(a), L(b)]);
    assert.deepEqual(tri(r), [[a, q, '']], `${a} / ${b}`);
  }
  // размер без строки «Qty» — не количество
  assert.equal(one('Return grille 20 x 20')[0]?.qty ?? null, null);
});

test('ВЫС: второй скрин без шапки — строки с числом в конце узнаются как уже есть в сверке, не задваиваются', () => {
  const ex = [{ id: 'a', name: 'Supply boot 6x10', qty: 4 }, { id: 'b', name: 'Breaker 2 pole 30', qty: 1 }];
  const rows = toRows(parseOrderLines([L('Supply boot 6x10 4'), L('2 Breaker 2 pole 30 1'), L('Condensate pump 1')]).items, k => 'r' + k);
  const plan = planConfirm(rows, ex);
  assert.deepEqual(plan.dupExisting.map(r => r.key), ['r0', 'r1']);
  assert.deepEqual(plan.add.map(r => r.name), ['Condensate pump 1']);
  assert.equal(findExisting('2 Breaker 2 pole 30', ex)?.id, 'b', 'номер строки слева не мешает');
  assert.equal(findExisting('Supply boot 6x10 4', ex), null, 'без флага «число в конце» название сравнивается целиком');
  const ex2 = [{ id: 'f', name: 'Flex duct 8 in', qty: 3 }, { id: 'm', name: 'Filter MERV 13', qty: 2 }];
  assert.equal(findExisting('Flex duct 8in', ex2)?.id, 'f');
  assert.equal(findExisting('Flex duct 8 jn', ex2)?.id, 'f');
  assert.equal(findExisting('Filter MERY 13', ex2)?.id, 'm');
  assert.equal(findExisting('Filter MERV 11', ex2), null, 'другая цифра — другая позиция');
});

console.log(`order-parse: ${n} проверок пройдено`);
