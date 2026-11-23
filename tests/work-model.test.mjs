// Рабочий режим смены: логика перенесена из веб-пилота dot v0.3 без изменений.
// 1) verdict() совпадает с verdict() пилота на наборе случаев (если задан PILOT_APP_JS — с оригиналом).
// 2) Шаблон смены проходит проверку пилота validV03 (то есть экспорт «Формана» пилот примет обратно).
// 3) Отчёт содержит все разделы в порядке пилота; правки не мутируют исходный документ.
// Запуск: npm run test:work
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { validV03 } from '../src/features/work/import-v03.ts';
import {
  addTeam, buildWorkReport, normalizeWork, quantity, removeTeam, seedWork, setCheck, setItem, setQuestion, setTeam,
  summarize, TEAM_MAX, verdict,
} from '../src/features/work/work-model.ts';

// --- 1. verdict как в пилоте
const cases = [
  { required: 1, ordered: '', actual: '', status: 'unknown', unit: 'шт.' },
  { required: 1, ordered: '1', actual: '1', status: 'present', unit: 'шт.' },
  { required: 6, ordered: '6', actual: '4', status: 'present', unit: 'шт.' },
  { required: 6, ordered: '5', actual: '', status: 'unknown', unit: 'шт.' },
  { required: null, ordered: '', actual: '2', status: 'present', unit: 'комплект' },
  { required: 1, ordered: '1', actual: '', status: 'present', unit: 'шт.' },
  { required: 1, ordered: '1', actual: '1', status: 'missing', unit: 'шт.' },
  { required: '2', ordered: 'abc', actual: '-1', status: 'present', unit: 'шт.' },
  { required: 0, ordered: '0', actual: '0', status: 'present', unit: 'шт.' },
];
const ourTexts = cases.map(c => verdict({ id: 'x', name: 'x', source: '', hint: '', location: '', note: '', ...c }).text);

const pilotPath = process.env.PILOT_APP_JS;
if (pilotPath) {
  const src = readFileSync(pilotPath, 'utf8');
  const start = src.indexOf('function quantity');
  const end = src.indexOf('\n', src.indexOf('function verdict'));
  const ctx = {};
  vm.runInNewContext(src.slice(start, end) + '\nthis.verdict=verdict;', ctx);
  cases.forEach((c, k) => assert.equal(ourTexts[k], ctx.verdict({ ...c })[1], `verdict случай ${k + 1}`));
  console.log('verdict совпадает с пилотом:', cases.length, 'случаев');
} else {
  assert.deepEqual(ourTexts, [
    'Не проверено / неполные данные',
    'Сверено вручную · по твоим отметкам',
    'Не хватает: 2 шт.',
    'В заказе меньше требуемого',
    'Есть · необходимое количество ещё неизвестно',
    'Указано «есть», но количество не записано',
    'Не хватает · отмечено вручную',
    'Указано «есть», но количество не записано',
    'Сверено вручную · по твоим отметкам',
  ]);
  console.log('verdict: ожидаемые ответы на', cases.length, 'случаев (PILOT_APP_JS не задан)');
}
assert.equal(quantity(''), null);
assert.equal(quantity(null), null);
assert.equal(quantity('-1'), null);
assert.equal(quantity('3'), 3);

// --- 2. шаблон совместим с пилотом
const seed = seedWork();
assert.ok(validV03(seed), 'шаблон «Формана» проходит valid() пилота');
assert.equal(seed.items.length, 7);
assert.equal(seed.questions.length, 5);
assert.deepEqual(summarize(seed), { items: 7, ok: 0, bad: 0, unchecked: 7, questionsOpen: 5, checksDone: 0, checksTotal: 8, teamBlocked: 0 });

// --- 3. правки и отчёт
let d = setItem(seed, 'registers', { ordered: '6', actual: '4', status: 'present', location: 'полка 2' });
assert.equal(seed.items[6].actual, '', 'исходный документ не меняется');
assert.equal(verdict(d.items[6]).text, 'Не хватает: 2 шт.');
d = setQuestion(d, 'q1', { answer: 'Замер у клиента: 4 supply, 2 return', resolved: true });
assert.equal(d.questions[0].resolved, true);
d = setQuestion(d, 'q1', { answer: '   ' });
assert.equal(d.questions[0].resolved, false, 'без ответа «уточнено» снимается');
d = setCheck(d, 'scope', true);
for (let k = 0; k < TEAM_MAX + 3; k++) d = addTeam(d);
assert.equal(d.team.length, TEAM_MAX, 'не больше 8 назначений');
d = setTeam(d, 0, { role: 'Монтажник', task: 'Повесить решётки', status: 'blocked', next: 'Ждём размеры' });
d = removeTeam(d, 7);
assert.equal(d.team.length, TEAM_MAX - 1);
assert.ok(validV03(d), 'после правок документ по-прежнему проходит valid() пилота');

const report = buildWorkReport(d, new Date('2026-11-19T18:00:00Z'));
const order = ['Личная сверка DEMO-01', 'Bar type supply/return registers: требуется 6, заказано 6, в траке 4; Не хватает: 2 шт.. Место: полка 2.', 'Вопросы:', 'ОТКРЫТО: Размеры шести решёток', 'Этапы:', 'Отмечено: Scope и вопросы просмотрены', 'Бригада / передача готовности:', 'Монтажник: Повесить решётки; СТОП. Ждём размеры', 'Заметки:'];
let pos = -1;
for (const part of order) {
  const at = report.indexOf(part);
  assert.ok(at > pos, `в отчёте есть «${part}» и порядок разделов как в пилоте`);
  pos = at;
}

// --- 4. нормализация документа из базы
assert.equal(normalizeWork(null), null);
assert.equal(normalizeWork({ kind: 'other' }), null);
const fromDb = normalizeWork({ ...d, phases: [], checks: { scope: true, bad: 'x' }, team: Array(12).fill(d.team[0]) });
assert.equal(fromDb.phases.length, 3, 'этапы всегда из шаблона');
assert.deepEqual(fromDb.checks, { scope: true });
assert.equal(fromDb.team.length, TEAM_MAX);

console.log('work-model: все проверки пройдены');

// --- 5. позиции со скрина заказа и «Недостача по заказу»
{
  const { addOrderItems, shortages, shortageText, ORDER_SOURCE, ITEMS_MAX } = await import('../src/features/work/work-model.ts');
  const base = { ...seedWork(), items: [] };
  const r = addOrderItems(base, [{ name: 'Bar type supply registers 10x6', qty: 6, unit: 'шт.' }, { name: 'Condensate pump', qty: null, unit: 'шт.' }, { name: '  ', qty: 1, unit: '' }], k => 'o' + k);
  assert.equal(r.added, 2);
  const [reg, pump] = r.doc.items;
  assert.equal(reg.required, 6); assert.equal(reg.ordered, 6); assert.equal(reg.actual, ''); assert.equal(reg.status, 'unknown');
  assert.equal(reg.source, ORDER_SOURCE);
  assert.equal(pump.required, null); assert.equal(pump.ordered, '');
  assert.equal(base.items.length, 0, 'исходный документ не меняется');
  assert.deepEqual(shortages(r.doc), [], 'пока «в траке» пусто — недостачи нет');
  const d4 = setItem(r.doc, 'o0', { actual: '4' });
  const sh = shortages(d4);
  assert.equal(sh.length, 1);
  assert.equal(sh[0].missing, 2);
  assert.equal(shortageText(sh[0]), 'Bar type supply registers 10x6: заказано 6, в траке 4 — не хватает 2 шт.');
  assert.equal(shortages(setItem(d4, 'o0', { actual: '6' })).length, 0);
  assert.equal(shortageText(shortages(setItem(r.doc, 'o1', { status: 'missing' }))[0]), 'Condensate pump — нет в траке (отмечено вручную)');
  const full = addOrderItems(base, Array.from({ length: ITEMS_MAX + 3 }, (_, k) => ({ name: 'p' + k, qty: 1, unit: 'шт.' })), k => 'f' + k);
  assert.equal(full.added, ITEMS_MAX); assert.equal(full.overLimit, 3);
  // позиции с вымышленного примера помечены отдельно — от настоящего заказа отличаются в сверке, итоге и отчёте
  const { SAMPLE_SOURCE } = await import('../src/features/work/work-model.ts');
  const smp = addOrderItems(base, [{ name: 'Bar type supply registers 10x6', qty: 6, unit: 'шт.' }], k => 's' + k, SAMPLE_SOURCE);
  assert.equal(smp.doc.items[0].source, SAMPLE_SOURCE);
  assert.equal(smp.doc.items[0].hint, `Источник: ${SAMPLE_SOURCE}.`);
  const shs = shortages(setItem(smp.doc, 's0', { actual: '4' }));
  assert.equal(shs[0].fromOrder, true); assert.equal(shs[0].sample, true);
  assert.equal(shortageText(shs[0]), 'Bar type supply registers 10x6 [ПРИМЕР]: заказано 6, в траке 4 — не хватает 2 шт.');
  // исправленное количество в черновике (6 → 8) и «в траке 4» → недостача 4; «заменить количество» при повторном разборе
  const { setOrderQty } = await import('../src/features/work/work-model.ts');
  const c8 = addOrderItems(base, [{ name: 'Return grille 20x20', qty: 8, unit: 'шт.' }], k => 'g' + k);
  const c8t = setItem(c8.doc, 'g0', { actual: '4' });
  assert.equal(shortageText(shortages(c8t)[0]), 'Return grille 20x20: заказано 8, в траке 4 — не хватает 4 шт.');
  const rep = setOrderQty(c8t, 'g0', 10);
  assert.equal(rep.items[0].required, 10); assert.equal(rep.items[0].ordered, 10); assert.equal(rep.items[0].actual, '4', '«в траке» не тронуто');
  assert.equal(shortages(rep)[0].missing, 6);
  assert.equal(setOrderQty(c8t, 'нет-такой', 10), c8t);
  assert.equal(setOrderQty(c8t, 'g0', -1), c8t);
  console.log('work-model: позиции со скрина и недостача — пройдено');
}
