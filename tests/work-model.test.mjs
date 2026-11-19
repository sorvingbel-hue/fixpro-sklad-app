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
assert.deepEqual(summarize(seed), { items: 7, ok: 0, bad: 0, questionsOpen: 5, checksDone: 0, checksTotal: 8, teamBlocked: 0 });

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
