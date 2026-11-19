// Разбор распознанного скрина заказа (order-parse.ts): проверка без телефона и без распознавания.
// Запуск: npm run test:ocr-parse
import assert from 'node:assert/strict';

import {
  groupWordsToLines, nameKey, parseOrderLines, planConfirm, QTY_CONF_MIN, rowQty, toRows,
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
  const [f] = one('Copper pipe 3/8 25 ft');
  assert.equal(f.qty, 25); assert.equal(f.unit, 'фут'); assert.equal(f.name, 'Copper pipe 3/8');
});

test('число в конце строки после названия; с нумерацией списка', () => {
  const [a] = one('Thermostat T-01 2');
  assert.equal(a.qty, 2); assert.equal(a.name, 'Thermostat T-01');
  const [b] = one('3. Condensate pump 1');
  assert.equal(b.qty, 1); assert.equal(b.name, 'Condensate pump');
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
  const w = (text, x0, y0, conf = 95) => ({ text, confidence: conf, bbox: { x0, y0, x1: x0 + 50, y1: y0 + 40 } });
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

console.log(`order-parse: ${n} проверок пройдено`);
