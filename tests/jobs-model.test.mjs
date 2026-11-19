// Объекты смены (раздел «Объекты»): проверка модели без React Native.
// Запуск: npm run test:jobs
import assert from 'node:assert/strict';

import {
  addPhotos, buildJobHeader, jobProgress, makeJob, newId, normalizeJobs, patchJob, PHOTOS_MAX, removePhoto, sortJobs,
  upsertJob, validateJob, workForJob,
} from '../src/features/jobs/jobs-model.ts';
import { addItem, removeItem, seedWork, summarize } from '../src/features/work/work-model.ts';

const t0 = new Date('2026-11-19T13:00:00Z');

// 1. Проверка полей: название обязательно, № заказа — нет
assert.equal(validateJob({ title: '' }).ok, false);
assert.equal(validateJob({ title: ' a ' }).ok, false);
assert.equal(validateJob({ title: 'Замена печи' }).ok, true);
assert.equal(validateJob({ title: 'Замена печи', orderNo: 'x'.repeat(41) }).ok, false);

// 2. Создание и правки не мутируют исходник
const j = makeJob({ title: '  Замена печи, Клермонт ', orderNo: ' OT-123 ' }, t0, 'job-1');
assert.equal(j.title, 'Замена печи, Клермонт');
assert.equal(j.orderNo, 'OT-123');
assert.deepEqual(j.photos, []);
const j2 = patchJob(j, { note: 'чердак' }, new Date('2026-11-19T13:01:00Z'));
assert.equal(j.note, '');
assert.equal(j2.note, 'чердак');
assert.ok(j2.updatedAt > j.updatedAt);

// 3. Фото: добавить, удалить, лимит
const ph = (id, kind = 'photo') => ({ id, kind, addedAt: t0.toISOString(), w: 10, h: 10, bytes: 2048, name: `${id}.jpg` });
const j3 = addPhotos(j, [ph('a'), ph('b', 'order')], t0);
assert.equal(j3.photos.length, 2);
assert.equal(removePhoto(j3, 'a', t0).photos.map(p => p.id).join(), 'b');
const many = addPhotos(j, Array.from({ length: PHOTOS_MAX + 5 }, (_, k) => ph('p' + k)), t0);
assert.equal(many.photos.length, PHOTOS_MAX);

// 4. Список: upsert, сортировка, битые записи отбрасываются
const other = makeJob({ title: 'Другой' }, new Date('2026-11-18T10:00:00Z'), 'job-0');
let list = upsertJob(upsertJob([], other), j3);
assert.equal(sortJobs(list)[0].id, 'job-1');
list = upsertJob(list, patchJob(j3, { title: 'Новое имя' }, t0));
assert.equal(list.length, 2);
const norm = normalizeJobs([null, 5, { id: 1 }, j3, { ...other, photos: [{ id: 'z', kind: 'bad' }] }]);
assert.equal(norm.length, 2);
assert.equal(norm[1].photos.length, 0);
assert.deepEqual(normalizeJobs('мусор'), []);

// 5. Документ «Работы» объекта — свой id, шаблон этапов; свои позиции добавляются и убираются
const w = workForJob(seedWork(), 'job-1');
assert.equal(w.job, 'job-1');
assert.equal(w.source, 'forman');
const w2 = addItem(w, 'Медная труба 3/8', 25, 'фт', 'it-1');
assert.equal(w2.items.length, w.items.length + 1);
assert.equal(w2.items.at(-1).required, 25);
assert.equal(addItem(w, '   ', 1, 'шт.', 'it-x'), w);
assert.equal(removeItem(w2, 'it-1').items.length, w.items.length);

// 6. Прогресс и шаги
const p0 = jobProgress(j, summarize(w));
assert.deepEqual(p0.steps.map(s => s.done), [true, false, false, false]);
const p1 = jobProgress(j3, summarize(w));
assert.equal(p1.photos, 1); assert.equal(p1.orders, 1);
assert.equal(p1.steps[1].done, true);

// 7. Шапка отчёта: название, заказ, фото по именам; без двойных пустых строк
const head = buildJobHeader(j3, t0);
assert.match(head, /ОБЪЕКТ: Замена печи, Клермонт/);
assert.match(head, /№ заказа: OT-123/);
assert.match(head, /Фото с объекта: 1 — a\.jpg/);
assert.match(head, /Скрины заказа: 1 — b\.jpg/);
assert.ok(!head.includes('\n\n\n'));

// 8. id уникальны
const ids = new Set(Array.from({ length: 500 }, () => newId('ph')));
assert.equal(ids.size, 500);

console.log('jobs-model: все проверки пройдены');
