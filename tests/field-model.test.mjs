// Рабочая версия (5 функций): трак одной кнопкой, фото по шагам, «Сюрприз», отчёт офису на двух языках.
// Запуск: npm run test:field
import assert from 'node:assert/strict';

import {
  addPhotos, addSurprise, buildFieldReport, jobProgress, makeJob, markSurpriseSent, normalizeJobs, normalizeSurprises, PHOTO_STEPS,
  removeSurprise, setPhotoStep, stepsSummary, surpriseMessage,
} from '../src/features/jobs/jobs-model.ts';
import { addItem, markAllLoaded, setLoaded, shortages, summarize, truckForReport, verdict } from '../src/features/work/work-model.ts';
import { seedWork } from '../src/features/work/work-model.ts';
import { parseBackup, buildBackup, backupParts } from '../src/features/jobs/backup-model.ts';
import { isStepId } from '../src/features/jobs/jobs-model.ts';
import { sanitizeWork } from '../src/features/work/work-model.ts';

const t0 = new Date('2026-11-23T15:00:00Z');
const ph = (id, extra = {}) => ({ id, kind: 'photo', addedAt: t0.toISOString(), w: 10, h: 10, bytes: 2048, name: `${id}.jpg`, ...extra });

// 1. Трак: «Всё загружено» — всё неотмеченное «есть», «в траке» = нужно; «Нет» и ручные числа не трогаются
let d = { ...seedWork(), job: 'job-1', items: [], questions: [] };
d = addItem(d, 'Furnace', 1, 'шт.', 'a');
d = addItem(d, 'Flex 8"', 4, 'шт.', 'b');
d = addItem(d, 'Тейп', null, 'шт.', 'c');
d = addItem(d, 'Disconnect', 1, 'шт.', 'e');
d = setLoaded(d, 'e', false);
d = { ...d, items: d.items.map(i => (i.id === 'b' ? { ...i, actual: 2 } : i)) };
const all = markAllLoaded(d);
assert.deepEqual(all.items.map(i => i.status), ['present', 'present', 'present', 'missing']);
assert.equal(all.items[0].actual, 1);
assert.equal(all.items[1].actual, 2, 'вписанное руками «в траке» не перезаписывается');
assert.equal(verdict(all.items[0]).kind, 'ok');
assert.equal(verdict(all.items[1]).kind, 'bad', '2 из 4 — недостача');
assert.equal(shortages(all).length, 2);
assert.equal(markAllLoaded(all), all, 'второе нажатие ничего не меняет');
assert.equal(d.items[0].status, 'unknown', 'исходник не меняется');
// «Есть» после «Нет»
const back = setLoaded(all, 'e', true);
assert.equal(back.items[3].status, 'present');
assert.equal(verdict(back.items[3]).kind, 'ok');
assert.equal(summarize(back).bad, 1);
// для отчёта
const tr = truckForReport(all, 'en');
assert.equal(tr.items, 4);
assert.equal(tr.unchecked, 0);
assert.ok(tr.missing.some(x => x.includes('Disconnect') && x.includes('not on the truck')));
assert.ok(tr.missing.some(x => x.includes('Flex 8"') && x.includes('short 2')));
assert.ok(truckForReport(all, 'ru').missing.some(x => x.includes('не хватает 2')));

// 2. Фото по шагам
let j = makeJob({ title: 'Замена печи' }, t0, 'job-1');
assert.equal(stepsSummary(j).done, 0);
assert.equal(stepsSummary(j).total, PHOTO_STEPS.length);
j = addPhotos(j, [ph('p1', { step: 'before' }), ph('p2', { step: 'nameplate' }), ph('p3'), ph('o1', { kind: 'order' })], t0);
assert.equal(stepsSummary(j).done, 2);
assert.ok(!stepsSummary(j).missing.some(x => x.id === 'before'));
j = setPhotoStep(j, 'p3', 'vacuum', t0);
assert.equal(stepsSummary(j).done, 3);
assert.equal(setPhotoStep(j, 'p3', 'нет-такого', t0), j, 'неизвестный шаг не ставится');
assert.equal(setPhotoStep(j, 'o1', 'before', t0), j, 'скрин заказа в шаг не переносится');
assert.equal(setPhotoStep(j, 'p3', null, t0).photos.find(p => p.id === 'p3').step, undefined);
assert.equal(jobProgress(j, null).steps.find(s => s.key === 'shots').done, false);
const full = addPhotos(makeJob({ title: 'x' }, t0, 'job-2'), PHOTO_STEPS.map((s, k) => ph('s' + k, { step: s.id })), t0);
assert.equal(jobProgress(full, null).steps.find(s => s.key === 'shots').done, true);
// битый шаг из хранилища — снимается, фото остаётся
const nj = normalizeJobs([{ ...j, photos: [...j.photos, ph('bad', { step: '<script>' })] }])[0];
assert.equal(nj.photos.find(p => p.id === 'bad').step, undefined);
assert.equal(nj.photos.find(p => p.id === 'p1').step, 'before');

// 3. Сюрприз: добавить, отметить «отправлено», снять отметку, удалить
const t1 = new Date('2026-11-23T16:00:00Z');
let k = addSurprise(j, '  Гнилая площадка  ', ['p9'], t1, 'sp-1');
assert.equal(k.surprises.length, 1);
assert.equal(k.surprises[0].text, 'Гнилая площадка');
assert.equal(addSurprise(k, '   ', [], t1), k, 'пустой не добавляется');
k = markSurpriseSent(k, 'sp-1', true, t1);
assert.equal(k.surprises[0].sentAt, t1.toISOString());
assert.equal(markSurpriseSent(k, 'sp-1', false, t1).surprises[0].sentAt, undefined);
assert.equal(removeSurprise(k, 'sp-1', t1).surprises.length, 0);
assert.ok(k.editedAt === t1.toISOString(), 'правка сюрпризов — правка карточки (для слияния копий)');
assert.deepEqual(normalizeSurprises([null, { id: 'x' }, { id: 'ok', text: 5, createdAt: t1.toISOString(), photoIds: ['a', '<b>'] }]),
  [{ id: 'ok', text: '', photoIds: ['a'], createdAt: t1.toISOString() }]);
assert.match(surpriseMessage({ ...k, address: '1 Main St' }, k.surprises[0], 'en'), /SURPRISE on job: Замена печи \(1 Main St\)/);
assert.match(surpriseMessage(k, k.surprises[0], 'ru'), /СЮРПРИЗ/);

// 4. Отчёт офису: английский по умолчанию в приложении, русский по выбору
const rep = buildFieldReport({ ...k, address: '1 Main St', orderNo: 'OT-7' }, { truck: tr, openQuestions: ['Размер решёток'], notes: 'чердак узкий' }, 'en', t1);
assert.match(rep, /^JOB: Замена печи/);
assert.match(rep, /Order #: OT-7/);
assert.match(rep, /Address: 1 Main St/);
assert.match(rep, /TRUCK\nMissing on the truck:/);
assert.match(rep, /✓ Before: 1 photo/);
assert.match(rep, /✗ Pad \/ outdoor unit: no photo/);
assert.match(rep, /SURPRISES \(not in the order\)\n• Гнилая площадка \(1 photo\) — sent/);
assert.match(rep, /OPEN QUESTIONS\n• Размер решёток/);
assert.match(rep, /NOTES\nчердак узкий/);
assert.ok(!/[А-Яа-я]/.test(rep.replace(/Замена печи|Гнилая площадка|Размер решёток|чердак узкий/g, '')), 'английский отчёт без русских служебных слов');
const ru = buildFieldReport(j, { truck: { items: 0, missing: [], unchecked: 0 }, openQuestions: [], notes: '' }, 'ru', t1);
assert.match(ru, /ОБЪЕКТ: Замена печи/);
assert.match(ru, /Сверка трака не заполнена/);
assert.ok(!/Address|TRUCK/.test(ru));
const allOk = buildFieldReport(full, { truck: { items: 2, missing: [], unchecked: 0 }, openQuestions: [], notes: '' }, 'en', t1);
assert.match(allOk, /Everything on the order is on the truck\./);
assert.match(allOk, /PHOTOS BY STEP \(8\/8\)/);

// 5. Копия файлом: шаг фото и сюрпризы переживают сохранение и загрузку
const withAll = { ...addSurprise(addPhotos(makeJob({ title: 'Копия' }, t0, 'job-9'), [ph('q1', { step: 'drain' })], t0), 'нет disconnect', ['q1'], t1, 'sp-9'), address: '5 Oak' };
const N = { work: sanitizeWork, isStep: isStepId, surprises: normalizeSurprises };
const text = backupParts(buildBackup([withAll], {}, { q1: 'data:image/jpeg;base64,' + 'A'.repeat(40) }, t1)).join('');
const parsed = parseBackup(text, N, new Date('2026-11-23T17:00:00Z'));
assert.equal(parsed.ok, true);
const back9 = parsed.backup.jobs[0];
assert.equal(back9.photos[0].step, 'drain');
assert.equal(back9.surprises[0].text, 'нет disconnect');
assert.equal(back9.address, '5 Oak');
const noNorm = parseBackup(text, { work: sanitizeWork }, new Date('2026-11-23T17:00:00Z')).backup.jobs[0];
assert.equal(noNorm.photos[0].step, undefined, 'без проверки шагов шаг из файла не берём');

console.log('field-model: все проверки пройдены');
