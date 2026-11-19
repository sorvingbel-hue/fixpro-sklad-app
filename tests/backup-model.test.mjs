// Копия файлом (М7): сборка, проверка и слияние файла *.forman.json — без React Native и браузера.
// Запуск: npm run test:backup
import assert from 'node:assert/strict';

import {
  BACKUP_KIND, BACKUP_MESSAGES, BACKUP_V, backupAgeDays, backupAgeText, backupFileName, backupParts, buildBackup, freshness,
  isPhotoDataUrl, needsBackup, parseBackup, planMerge, plural, realJobs, restoreSummary,
} from '../src/features/jobs/backup-model.ts';
import { addPhotos, makeJob, normalizeJobs, patchJob, workForJob } from '../src/features/jobs/jobs-model.ts';
import { addItem, normalizeWork, seedWork } from '../src/features/work/work-model.ts';

const N = { jobs: normalizeJobs, work: normalizeWork };
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
const ok = parseBackup(text, N);
assert.equal(ok.ok, true);
assert.equal(ok.backup.jobs.length, 2);
assert.equal(ok.backup.works['job-a'].items.at(-1).name, 'Медная труба 3/8');
assert.deepEqual(Object.keys(ok.backup.photos).sort(), ['ph-a1', 'ph-a2']);
assert.equal(ok.backup.broken, 0);
assert.equal(parseBackup('﻿' + text, N).ok, true, 'BOM в начале не мешает');

// 5. Понятные ошибки на русском
const reason = s => { const r = parseBackup(s, N); return r.ok ? 'ok' : r.reason; };
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
}), N);
assert.equal(messy.ok, true);
assert.equal(messy.backup.broken, 2);
assert.deepEqual(Object.keys(messy.backup.works), [], 'чужая и битая «Работа» не берутся');
assert.deepEqual(Object.keys(messy.backup.photos), ['ph-a2'], 'только фото объектов и только картинки');
assert.equal(messy.backup.brokenPhotos, 1);
assert.equal(isPhotoDataUrl(JPG), true);
assert.equal(isPhotoDataUrl('data:text/html;base64,PHNjcmlwdD4='), false);
assert.equal(isPhotoDataUrl('data:image/svg+xml;base64,PHN2Zz4='), false);
// один id дважды — берётся более свежая запись
const dup = parseBackup(JSON.stringify({ ...bk, jobs: [a, patchJob(a, { title: 'Новее' }, t2), b] }), N);
assert.equal(dup.backup.jobs.find(j => j.id === 'job-a').title, 'Новее');

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

// 9. Тот же id: остаётся более свежий (по объекту и по «Работе»)
const localNewer = patchJob(a, { title: 'Правлено здесь' }, t2);
const m2 = planMerge([localNewer, demo], { 'job-a': wa }, inc);
assert.equal(m2.jobs.find(j => j.id === 'job-a').title, 'Правлено здесь', 'на телефоне новее — не трогаем');
assert.ok(m2.jobs.some(j => j.id === 'job-demo'), 'пример на телефоне остаётся');
assert.deepEqual(m2.actions.map(x => x.job.id), ['job-b']);
// на телефоне объект старее, но «Работа» правилась позже файла → тоже новее
const localOldJob = { ...a, updatedAt: '2026-11-19T14:00:00.000Z' };
const m3 = planMerge([localOldJob], { 'job-a': { ...wa, updated: t2.toISOString() } }, inc);
assert.equal(m3.actions.filter(x => x.job.id === 'job-a').length, 0);
assert.equal(freshness(localOldJob, { ...wa, updated: t2.toISOString() }), t2.toISOString());
assert.equal(freshness(localOldJob, null), '2026-11-19T14:00:00.000Z');
// в файле новее → заменяем; фото, которых в файле нет, но есть на телефоне, не теряются
const fileNewer = parseBackup(JSON.stringify({ ...bk, jobs: [patchJob(a, { title: 'Из файла' }, t2)] }), N).backup;
const localWithExtra = addPhotos({ ...a, updatedAt: t0.toISOString() }, [ph('ph-local')], t0);
const m4 = planMerge([localWithExtra], { 'job-a': wa }, fileNewer);
const got = m4.jobs.find(j => j.id === 'job-a');
assert.equal(m4.actions[0].kind, 'replace');
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

console.log('backup-model: все проверки пройдены');
