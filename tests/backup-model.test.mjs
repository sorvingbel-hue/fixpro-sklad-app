// Копия файлом (М7): сборка, проверка и слияние файла *.forman.json — без React Native и браузера.
// Запуск: npm run test:backup
import assert from 'node:assert/strict';

import {
  BACKUP_KIND, BACKUP_MESSAGES, BACKUP_V, backupAgeDays, backupAgeText, backupFileName, backupParts, buildBackup,
  isPhotoDataUrl, mergeWork, needsBackup, parseBackup, PHOTOS_MAX as B_PHOTOS_MAX, planMerge, plural, realJobs, REMOVED_MAX as B_REMOVED_MAX,
  restoreNotes, restoreSummary,
} from '../src/features/jobs/backup-model.ts';
import {
  addPhotos, jobEditedAt, makeJob, normalizeJobs, patchJob, PHOTOS_MAX, REMOVED_MAX, removePhoto, workForJob,
} from '../src/features/jobs/jobs-model.ts';
import { addItem, sanitizeWork, seedWork, setCheck, setItem, summarize } from '../src/features/work/work-model.ts';

const N = { work: sanitizeWork };
assert.equal(B_PHOTOS_MAX, PHOTOS_MAX, 'предел фото в backup-model = в jobs-model');
assert.equal(B_REMOVED_MAX, REMOVED_MAX);
const t0 = new Date('2026-11-19T15:00:00Z');
const t1 = new Date('2026-11-19T16:00:00Z');
const t2 = new Date('2026-11-19T17:00:00Z');
// крошечный «JPEG» как data:URL (для модели важен только формат строки)
const JPG = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes-1234567890').toString('base64');
const PNG = 'data:image/png;base64,' + Buffer.from('fake-png-bytes-1234567890').toString('base64');
const ph = (id, kind = 'photo', at = t0) => ({ id, kind, addedAt: at.toISOString(), w: 10, h: 10, bytes: 100, name: `${id}.jpg` });

// --- исходные данные «первого телефона»
const a = addPhotos(makeJob({ title: 'Печь, Клермонт', orderNo: 'OT-1' }, t0, 'job-a'), [ph('ph-a1'), ph('ph-a2', 'order')], t0);
const b = makeJob({ title: 'Сплит, Ла-Хойя' }, t1, 'job-b');
const demo = { ...makeJob({ title: 'Пример' }, t0, 'job-demo'), example: true };
const wa = { ...addItem(workForJob(seedWork(), 'job-a'), 'Медная труба 3/8', 25, 'фт', 'it-1'), updated: t0.toISOString() };
const wb = workForJob(seedWork(), 'job-b');

// 1. Сборка: только настоящие объекты, их «Работа» и их фото; чужие фото не попадают
const bk = buildBackup([a, b, demo], { 'job-a': wa, 'job-b': wb, 'job-demo': wb }, { 'ph-a1': JPG, 'ph-a2': PNG, 'ph-zzz': JPG }, t2);
assert.equal(bk.kind, BACKUP_KIND);
assert.equal(bk.v, BACKUP_V);
assert.equal(bk.app, 'forman');
assert.equal(bk.createdAt, t2.toISOString());
assert.deepEqual(bk.jobs.map(j => j.id), ['job-a', 'job-b']);
assert.deepEqual(Object.keys(bk.works).sort(), ['job-a', 'job-b']);
assert.deepEqual(Object.keys(bk.photos).sort(), ['ph-a1', 'ph-a2']);
assert.deepEqual(realJobs([a, demo]).map(j => j.id), ['job-a']);

// 2. Текст кусками = обычный JSON того же объекта (и без фото тоже)
const text = backupParts(bk).join('');
assert.deepEqual(JSON.parse(text), bk);
const bare = buildBackup([b], {}, {}, t2);
assert.deepEqual(JSON.parse(backupParts(bare).join('')), bare);

// 3. Имя файла — латиницей, по часам телефона, *.forman.json
assert.match(backupFileName(new Date(2026, 10, 19, 17, 30)), /^forman-kopiya-2026-11-19-1730\.forman\.json$/);

// 4. Проверка: свой файл принимается целиком
const ok = parseBackup(text, N, t2);
assert.equal(ok.ok, true);
assert.equal(ok.backup.jobs.length, 2);
assert.equal(ok.backup.works['job-a'].items.at(-1).name, 'Медная труба 3/8');
assert.deepEqual(Object.keys(ok.backup.photos).sort(), ['ph-a1', 'ph-a2']);
assert.equal(ok.backup.broken, 0);
assert.equal(parseBackup('﻿' + text, N).ok, true, 'BOM в начале не мешает');

// 5. Понятные ошибки на русском
const reason = s => { const r = parseBackup(s, N, t2); return r.ok ? 'ok' : r.reason; };
assert.equal(reason(''), 'empty');
assert.equal(reason('   '), 'empty');
assert.equal(reason('не json {{{'), 'not_json');
assert.equal(reason('[1,2]'), 'not_backup');
assert.equal(reason('null'), 'not_backup');
assert.equal(reason(JSON.stringify({ kind: 'forman-work-v03', schema: 1 })), 'not_backup');
assert.equal(reason(JSON.stringify({ ...bk, v: 2 })), 'newer');
assert.equal(reason(JSON.stringify({ ...bk, v: '1' })), 'not_backup');
assert.equal(reason(JSON.stringify({ ...bk, v: 0 })), 'not_backup');
assert.equal(reason(JSON.stringify({ ...bk, jobs: 'x' })), 'invalid');
assert.equal(reason(JSON.stringify({ ...bk, jobs: [{ id: 5 }] })), 'invalid');
assert.equal(reason(JSON.stringify({ ...bk, jobs: [] })), 'no_jobs');
for (const m of Object.values(BACKUP_MESSAGES)) assert.match(m, /[а-яё]/i, 'сообщение по-русски');
const bad = parseBackup('{oops', N);
assert.equal(bad.ok, false);
assert.match(bad.message, /не копия «Формана»|повреждён/);

// 6. Битые части файла отбрасываются, остальное принимается
const messy = parseBackup(JSON.stringify({
  ...bk,
  jobs: [...bk.jobs, null, { id: 'x' }],
  works: { 'job-a': { kind: 'чужое' }, 'job-b': { ...wb, job: 'job-другой' } },
  photos: { 'ph-a1': 'javascript:alert(1)', 'ph-a2': PNG, 'ph-лишнее': JPG },
}), N, t2);
assert.equal(messy.ok, true);
assert.equal(messy.backup.broken, 2);
assert.deepEqual(Object.keys(messy.backup.works), [], 'чужая и битая «Работа» не берутся');
assert.equal(messy.backup.brokenWorks, 2);
assert.deepEqual(Object.keys(messy.backup.photos), ['ph-a2'], 'только фото объектов и только картинки');
assert.equal(messy.backup.brokenPhotos, 1);
assert.equal(isPhotoDataUrl(JPG), true);
assert.equal(isPhotoDataUrl('data:text/html;base64,PHNjcmlwdD4='), false);
assert.equal(isPhotoDataUrl('data:image/svg+xml;base64,PHN2Zz4='), false);
// один id дважды — берётся более свежая запись; это «повтор», а не «повреждённая запись»
const dup = parseBackup(JSON.stringify({ ...bk, jobs: [a, patchJob(a, { title: 'Новее' }, t2), b] }), N, t2);
assert.equal(dup.backup.jobs.find(j => j.id === 'job-a').title, 'Новее');
assert.equal(dup.backup.dupes, 1);
assert.equal(dup.backup.broken, 0);

// 7. Слияние в пустой телефон: всё добавляется, фото нужны все
const inc = ok.backup;
const m0 = planMerge([], {}, inc);
assert.equal(m0.actions.length, 2);
assert.ok(m0.actions.every(x => x.kind === 'add'));
assert.equal(m0.skipped.length, 0);
assert.deepEqual(m0.photoIds.sort(), ['ph-a1', 'ph-a2']);
assert.equal(m0.actions.find(x => x.job.id === 'job-a').work.job, 'job-a');
assert.deepEqual(m0.jobs.map(j => j.id), ['job-b', 'job-a'], 'свежие сверху');

// 8. Повторная загрузка того же файла: ничего не добавляется, дублей нет
const m1 = planMerge(m0.jobs, { 'job-a': wa, 'job-b': wb }, inc);
assert.equal(m1.actions.length, 0);
assert.equal(m1.skipped.length, 2);
assert.equal(m1.jobs.length, 2);
assert.deepEqual(m1.photoIds.sort(), ['ph-a1', 'ph-a2'], 'фото «долечиваются», запись пропустит уже имеющиеся');

// 9. Тот же id: поля — более свежие по editedAt; фото объединяются; «Работа» — своя, если новее
const localNewer = patchJob(a, { title: 'Правлено здесь' }, t2);
const m2 = planMerge([localNewer, demo], { 'job-a': wa }, inc);
assert.equal(m2.jobs.find(j => j.id === 'job-a').title, 'Правлено здесь', 'на телефоне новее — не трогаем');
assert.ok(m2.jobs.some(j => j.id === 'job-demo'), 'пример на телефоне остаётся');
assert.deepEqual(m2.actions.map(x => x.job.id), ['job-b']);
// на телефоне «Работа» правилась позже файла → своя остаётся
const m3 = planMerge([a], { 'job-a': { ...wa, updated: t2.toISOString() } }, inc);
assert.equal(m3.actions.filter(x => x.job.id === 'job-a').length, 0);
assert.equal(jobEditedAt({ ...a, editedAt: undefined, updatedAt: '2026-11-19T14:00:00.000Z' }), '2026-11-19T14:00:00.000Z', 'старые записи без editedAt');
// в файле поля новее → берутся из файла; фото, которых в файле нет, но есть на телефоне, не теряются
const fileNewer = parseBackup(JSON.stringify({ ...bk, jobs: [patchJob(a, { title: 'Из файла' }, t2)] }), N, t2).backup;
const localWithExtra = addPhotos(a, [ph('ph-local', 'photo', t1)], t1);
const m4 = planMerge([localWithExtra], { 'job-a': wa }, fileNewer);
const got = m4.jobs.find(j => j.id === 'job-a');
assert.equal(m4.actions[0].kind, 'update');
assert.equal(m4.actions[0].cardFromFile, true);
assert.equal(got.title, 'Из файла');
assert.deepEqual(got.photos.map(p => p.id), ['ph-a1', 'ph-a2', 'ph-local']);
assert.equal(m4.jobs.length, 1);

// 10. Слова и итог
assert.equal(plural(1, ['объект', 'объекта', 'объектов']), 'объект');
assert.equal(plural(3, ['объект', 'объекта', 'объектов']), 'объекта');
assert.equal(plural(11, ['объект', 'объекта', 'объектов']), 'объектов');
assert.equal(plural(21, ['объект', 'объекта', 'объектов']), 'объект');
assert.equal(plural(0, ['объект', 'объекта', 'объектов']), 'объектов');
assert.equal(restoreSummary(1, 2, 0), 'Загружено: 1 объект, 2 фото; пропущено: 0.');
assert.equal(restoreSummary(0, 0, 1), 'Загружено: 0 объектов, 0 фото; пропущено: 1.');

// 11. Напоминание «Сделайте копию»: есть объекты и копии нет или она старше 3 дней
const now = new Date(2026, 10, 19, 12, 0);
const ago = days => new Date(now.getTime() - days * 24 * 3600 * 1000).toISOString();
assert.equal(needsBackup([], null, now), false, 'нет объектов — не напоминаем');
assert.equal(needsBackup([demo], null, now), false, 'только пример — не напоминаем');
assert.equal(needsBackup([a], null, now), true);
assert.equal(needsBackup([a], 'мусор', now), true);
assert.equal(needsBackup([a], ago(2.9), now), false);
assert.equal(needsBackup([a], ago(3.1), now), true);
assert.equal(backupAgeDays(null, now), null);
assert.equal(backupAgeDays(new Date(2026, 10, 19, 7, 0).toISOString(), now), 0);
assert.equal(backupAgeDays(new Date(2026, 10, 18, 23, 0).toISOString(), now), 1, 'вчера вечером — это «вчера», а не «сегодня»');
assert.equal(backupAgeText(null, now), 'Копии ещё нет.');
assert.equal(backupAgeText(new Date(2026, 10, 19, 7, 0).toISOString(), now), 'Последняя копия: сегодня.');
assert.equal(backupAgeText(new Date(2026, 10, 14, 7, 0).toISOString(), now), 'Последняя копия: 5 дней назад.');

// ---------- Р2, замечания тестировщика ----------
const T = h => new Date(`2026-11-19T${String(h).padStart(2, '0')}:00:00Z`);
const NOW = T(20);
const trip = (jobs, works, photos, t) => parseBackup(backupParts(buildBackup(jobs, works, photos, t)).join(''), N, NOW).backup;
const re = (plan, jobId) => plan.jobs.find(j => j.id === jobId);

// 12. Два телефона правят разные части: сверка на A и фото на B не затирают друг друга (Case1)
{
  let xA = makeJob({ title: 'Печь' }, T(8), 'job-x');
  let wA = workForJob(seedWork(), 'job-x');
  const b1 = trip([xA], { 'job-x': wA }, {}, T(9));
  let xB = b1.jobs[0];
  const wB = b1.works['job-x'];
  wA = { ...addItem(wA, 'Медь 3/8', 25, 'фт', 'it-A'), updated: T(10).toISOString() };
  xB = addPhotos(xB, [ph('ph-B1', 'photo', T(11))], T(11));
  const plan = planMerge([xA], { 'job-x': wA }, trip([xB], { 'job-x': wB }, { 'ph-B1': JPG }, T(12)));
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].work, null, 'сверку A не трогаем: в файле она не правилась');
  assert.deepEqual(re(plan, 'job-x').photos.map(p => p.id), ['ph-B1'], 'фото B добавлено');
  assert.deepEqual(plan.photoIds, ['ph-B1']);
  // и наоборот: копия A на телефоне B — сверка A приходит, фото B остаётся
  const back = planMerge([xB], { 'job-x': wB }, trip([xA], { 'job-x': wA }, {}, T(13)));
  assert.deepEqual(back.actions[0].work.items.map(i => i.name), ['Медь 3/8']);
  assert.deepEqual(re(back, 'job-x').photos.map(p => p.id), ['ph-B1']);
}

// 13. Название поменяли на A, фото добавили позже на B: название A не откатывается
{
  const base = makeJob({ title: 'Дом' }, T(8), 'job-t');
  const onB = trip([base], {}, {}, T(9)).jobs[0];
  const A = patchJob(base, { title: 'Дом, Клермонт' }, T(10));
  const B = addPhotos(onB, [ph('ph-t1', 'photo', T(11))], T(11));
  const plan = planMerge([A], {}, trip([B], {}, { 'ph-t1': JPG }, T(12)));
  assert.equal(re(plan, 'job-t').title, 'Дом, Клермонт');
  assert.equal(re(plan, 'job-t').photos.length, 1);
  assert.equal(plan.actions[0].cardFromFile, false);
}

// 14. Сверку вели на обоих телефонах: позиции объединяются, пустые поля дополняются, отметки — обе
{
  const w0 = workForJob(seedWork(), 'job-w');
  const wA = { ...setCheck(setItem(addItem(w0, 'Печь', 1, 'шт.', 'it-1'), 'it-1', { actual: 1, status: 'present' }), 'scope', true), updated: T(10).toISOString() };
  const wB = { ...setCheck(addItem(addItem(w0, 'Печь', 1, 'шт.', 'it-1'), 'Фильтр', 2, 'шт.', 'it-2'), 'stock', true), notes: 'Заметка B', updated: T(11).toISOString() };
  const r = mergeWork(wA, wB);
  assert.equal(r.changed, true);
  assert.equal(r.merged, true);
  assert.deepEqual(r.doc.items.map(i => i.id), ['it-1', 'it-2']);
  assert.equal(r.doc.items[0].actual, 1, 'количество с A не потерялось');
  assert.equal(r.doc.items[0].status, 'present');
  assert.deepEqual(r.doc.checks, { scope: true, stock: true });
  assert.equal(r.doc.notes, 'Заметка B');
  assert.equal(r.doc.updated, T(11).toISOString());
  // повтор: то же содержимое → без изменений
  assert.equal(mergeWork(r.doc, wB).changed, false);
  assert.equal(mergeWork(r.doc, r.doc).changed, false);
  // в файле документ ни разу не правили — свой не трогаем
  assert.equal(mergeWork(wA, w0).changed, false);
  // заметки с двух телефонов — обе
  assert.equal(mergeWork({ ...wA, notes: 'A' }, { ...wA, notes: 'B', updated: T(12).toISOString() }).doc.notes, 'B\n\nA');
}

// 15. Удалённое фото не возвращается (Case2), а на другом телефоне — удаляется
{
  const a0 = addPhotos(makeJob({ title: 'Сплит' }, T(8), 'job-y'), [ph('p1', 'photo', T(8)), ph('p2', 'photo', T(8))], T(8));
  const onB = trip([a0], {}, { p1: JPG, p2: JPG }, T(9)).jobs[0];
  const a1 = removePhoto(a0, 'p2', T(10));
  assert.deepEqual(a1.removedPhotos, ['p2']);
  const plan = planMerge([onB], {}, trip([a1], {}, { p1: JPG }, T(11)));
  assert.deepEqual(re(plan, 'job-y').photos.map(p => p.id), ['p1']);
  assert.deepEqual(plan.dropPhotoIds, ['p2'], 'снимок стирается и из хранилища');
  assert.equal(plan.actions[0].photosRemoved, 1);
  // старая копия B (ещё с p2) на телефоне A не возвращает p2
  const planA = planMerge([a1], {}, trip([onB], {}, { p1: JPG, p2: JPG }, T(12)));
  assert.equal(planA.actions.length, 0);
  assert.deepEqual(re(planA, 'job-y').photos.map(p => p.id), ['p1']);
  assert.deepEqual(planA.photoIds, ['p1']);
}

// 16. Часы второго телефона спешат на сутки (Case3): даты файла сдвигаются, человек видит предупреждение
{
  const z = makeJob({ title: 'Дом' }, T(8), 'job-z');
  const zB = patchJob(z, { title: 'Дом (B)' }, new Date('2026-11-20T09:00:00Z'));
  const file = buildBackup([zB], {}, {}, new Date('2026-11-20T09:05:00Z'));
  const p = parseBackup(JSON.stringify(file), N, NOW).backup;
  assert.ok(p.clockAheadMin >= 13 * 60, 'спешат минимум на 13 ч (нижняя оценка)');
  assert.ok(p.jobs[0].updatedAt <= NOW.toISOString(), 'дата из файла не позже «сейчас»');
  assert.equal(p.jobs[0].editedAt, '2026-11-19T19:55:00.000Z', 'правка B: 09:00 «завтра» по часам B → 19:55 по часам A');
  // датам такого файла верить нельзя: где правки расходятся, остаётся своё (Case3: «завтрашняя» правка B не побеждает)
  const zA = patchJob(z, { title: 'Дом (A)' }, T(15));
  const pz = planMerge([zA], {}, p);
  assert.equal(re(pz, 'job-z').title, 'Дом (A)');
  assert.deepEqual(pz.keptLocal, ['Дом (A)']);
  const notes = restoreNotes(pz, p);
  assert.ok(notes.some(t => /Часы .* спешат примерно на 13 часов/.test(t)), notes.join(' | '));
  assert.ok(notes.some(t => t.includes('оставлено то, что на этом телефоне: «Дом (A)»')), notes.join(' | '));
  // новое из такого файла всё равно добавляется
  assert.equal(planMerge([], {}, p).actions.length, 1);
}

// 17. Фото после слияния больше предела (Case4): ничего не теряется, человек предупреждён
{
  const many = (pre, n) => Array.from({ length: n }, (_, k) => ph(`${pre}${k}`, 'photo', T(8)));
  const m = { ...makeJob({ title: 'Много' }, T(8), 'job-m'), photos: many('a', 60) };
  const mB = { ...m, photos: many('b', 60), updatedAt: T(12).toISOString() };
  const plan = planMerge([m], {}, trip([mB], {}, {}, T(13)));
  assert.equal(re(plan, 'job-m').photos.length, 120);
  assert.deepEqual(plan.overLimit, [{ title: 'Много', photos: 120 }]);
  assert.ok(restoreNotes(plan, trip([mB], {}, {}, T(13))).some(t => t.includes('теперь 120 фото — больше 60')));
}

// 18. Мусор в датах (Case5): 'zzzz' → дата создания; дата из будущего → не позже «сейчас»; без даты создания — битая запись
{
  const g = parseBackup(JSON.stringify(buildBackup([{ ...makeJob({ title: 'Подделка' }, T(8), 'job-g'), updatedAt: 'zzzz', editedAt: 'zzzz' }], {}, {}, T(9))), N, NOW).backup;
  assert.equal(g.jobs[0].updatedAt, T(8).toISOString());
  assert.equal(g.jobs[0].editedAt, undefined);
  const mine = patchJob(makeJob({ title: 'Своя' }, T(8), 'job-g'), {}, T(15));
  assert.equal(re(planMerge([mine], {}, g), 'job-g').title, 'Своя', 'мусорная дата не побеждает');
  const f = parseBackup(JSON.stringify(buildBackup([patchJob(makeJob({ title: 'Будущее' }, T(8), 'job-f'), {}, new Date('2030-01-01'))], {}, {}, T(9))), N, NOW).backup;
  assert.equal(f.jobs[0].editedAt, NOW.toISOString());
  const noDate = parseBackup(JSON.stringify({ ...buildBackup([b], {}, {}, T(9)), jobs: [{ ...b, createdAt: 'вчера' }, b] }), N, NOW).backup;
  assert.equal(noDate.jobs.length, 1);
  assert.equal(noDate.dupes, 0);
  assert.equal(noDate.broken, 1);
}

// 19. Испорченная «Работа» в файле (Case7, T2): null в позициях и вопросах отбрасывается, экран и итоги не падают
{
  const badWork = { ...workForJob(seedWork(), 'jn'), items: [null, { id: 'ok-1', name: 'Норм', actual: {}, status: 'зло' }, { name: 'без id' }], questions: [null, 7], team: [null, { role: 1 }], checks: { a: true, b: 'x' }, notes: 5 };
  const file = { kind: 'forman-backup', v: 1, createdAt: T(9).toISOString(), app: 'forman', jobs: [makeJob({ title: 'Битая работа' }, T(8), 'jn')], works: { jn: badWork }, photos: {} };
  const pb = parseBackup(JSON.stringify(file), N, NOW);
  assert.equal(pb.ok, true);
  assert.equal(pb.backup.works.jn, undefined, 'notes не текст — документ не взят');
  assert.equal(pb.backup.brokenWorks, 1);
  const pb2 = parseBackup(JSON.stringify({ ...file, works: { jn: { ...badWork, notes: '' } } }), N, NOW).backup;
  const w = pb2.works.jn;
  assert.deepEqual(w.items.map(i => [i.id, i.actual, i.status, i.unit]), [['ok-1', '', 'unknown', '']]);
  assert.deepEqual(w.questions, []);
  assert.deepEqual(w.team, [{ role: '', task: '', next: '', status: 'open' }]);
  assert.deepEqual(w.checks, { a: true });
  assert.equal(summarize(w).items, 1, 'итоги считаются');
  assert.equal(sanitizeWork({ ...w, job: 'другой' }, 'jn'), null);
}

// 20. Незнакомые поля: хранилище их сохраняет (старый код не стирает данные новой версии); из файла — только короткие
{
  const withAddr = { ...makeJob({ title: 'С адресом' }, T(8), 'job-addr'), address: '123 Main St', meta: { deep: 1 } };
  const n1 = normalizeJobs([withAddr])[0];
  assert.equal(n1.address, '123 Main St');
  assert.deepEqual(n1.meta, { deep: 1 });
  const p = parseBackup(JSON.stringify(buildBackup([{ ...withAddr, huge: 'x'.repeat(5000) }], {}, {}, T(9))), N, NOW).backup;
  assert.equal(p.jobs[0].address, '123 Main St');
  assert.equal(p.jobs[0].meta, undefined);
  assert.equal(p.jobs[0].huge, undefined);
  // огромная заметка обрезается
  const big = parseBackup(JSON.stringify(buildBackup([{ ...b, note: 'x'.repeat(400000) }], {}, {}, T(9))), N, NOW).backup;
  assert.equal(big.jobs[0].note.length, 20000);
  assert.equal(big.trimmed, 1);
  // фото с плохими полями — поля чинятся; id со странными символами — фото пропускается
  const odd = parseBackup(JSON.stringify(buildBackup([{ ...b, photos: [{ id: 'ph-1', kind: 'photo', addedAt: 'x', w: 'x', h: null, bytes: 'many', name: 5 }, { id: 'a:full', kind: 'photo' }] }], {}, {}, T(9))), N, NOW).backup;
  assert.deepEqual(odd.jobs[0].photos.map(x => [x.id, x.w, x.h, x.bytes, x.name]), [['ph-1', 0, 0, 0, 'фото']]);
  // id объекта со странными символами — запись битая
  assert.equal(parseBackup(JSON.stringify(buildBackup([{ ...b, id: '../x' }, a], {}, {}, T(9))), N, NOW).backup.broken, 1);
  // пример из файла становится обычным объектом
  assert.equal(parseBackup(JSON.stringify({ ...buildBackup([a], {}, {}, T(9)), jobs: [{ ...a, example: true }] }), N, NOW).backup.jobs[0].example, undefined);
}

// 21. Фото из файла с id чужого фото этого телефона — пропускается (иначе одна картинка на два объекта)
{
  const mine = addPhotos(makeJob({ title: 'Мой' }, T(8), 'job-mine'), [ph('ph-same', 'photo', T(8))], T(8));
  const other = addPhotos(makeJob({ title: 'Чужой' }, T(8), 'job-other'), [ph('ph-same', 'photo', T(8)), ph('ph-2', 'photo', T(8))], T(8));
  const plan = planMerge([mine], {}, trip([other], {}, { 'ph-same': JPG, 'ph-2': JPG }, T(9)));
  assert.deepEqual(re(plan, 'job-other').photos.map(p => p.id), ['ph-2']);
  assert.equal(plan.clashes, 1);
  assert.deepEqual(plan.photoIds, ['ph-2'], 'картинка чужого объекта не «долечивает» своё фото');
}

// 22. Слияние сходится: результат, загруженный обратно, ничего не меняет
{
  const A = addPhotos(makeJob({ title: 'Сход' }, T(8), 'job-c'), [ph('c1', 'photo', T(8))], T(8));
  const wA = { ...addItem(workForJob(seedWork(), 'job-c'), 'Труба', 3, 'шт.', 'it-c'), updated: T(9).toISOString() };
  const B = patchJob(addPhotos(A, [ph('c2', 'photo', T(10))], T(10)), { orderNo: 'OT-7' }, T(10));
  const wB = { ...addItem(workForJob(seedWork(), 'job-c'), 'Фитинг', 2, 'шт.', 'it-d'), updated: T(10).toISOString() };
  const p1 = planMerge([A], { 'job-c': wA }, trip([B], { 'job-c': wB }, { c2: JPG }, T(11)));
  const merged = re(p1, 'job-c');
  const mw = p1.actions[0].work;
  assert.equal(merged.orderNo, 'OT-7');
  assert.deepEqual(merged.photos.map(p => p.id), ['c1', 'c2']);
  assert.deepEqual(mw.items.map(i => i.id).sort(), ['it-c', 'it-d']);
  const again = planMerge([merged], { 'job-c': mw }, trip([B], { 'job-c': wB }, { c2: JPG }, T(11)));
  assert.equal(again.actions.length, 0, 'та же копия второй раз — без изменений');
  const fromA = planMerge([B], { 'job-c': wB }, trip([merged], { 'job-c': mw }, { c1: JPG, c2: JPG }, T(12)));
  const p2 = planMerge([re(fromA, 'job-c')], { 'job-c': fromA.actions[0].work }, trip([merged], { 'job-c': mw }, { c1: JPG, c2: JPG }, T(12)));
  assert.equal(p2.actions.length, 0, 'после обмена копиями телефоны одинаковые');
}

// 23. Итог и пояснения
{
  const plan = planMerge([], {}, ok.backup);
  assert.deepEqual(restoreNotes(plan, ok.backup), []);
  assert.equal(restoreSummary(plan.actions.length, 2, 0), 'Загружено: 2 объекта, 2 фото; пропущено: 0.');
}

console.log('backup-model: все проверки пройдены');
