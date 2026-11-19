// Копия файлом (М7): собрать файл *.forman.json со всеми объектами и фото, отдать «Поделиться» или
// скачать; загрузить такой файл на этом или другом телефоне. Только веб-версия (фото есть только там).
// Чистая логика (формат, проверка, слияние) — в backup-model.ts, здесь — хранилище, файлы и браузер.
import { Platform } from 'react-native';

import { getItem, removeItem, setItem } from '@/lib/storage';

import type { WorkV03Doc } from '../work/import-v03';
import { sanitizeWork } from '../work/work-model';
import {
  BACKUP_LAST_KEY, BACKUP_MAX_BYTES, BACKUP_MESSAGES, backupFileName, backupParts, buildBackup, objects, parseBackup, planMerge,
  realJobs, restoreNotes, restoreSummary, type MergePlan, type ParsedBackup,
} from './backup-model';
import { JOBS_KEY, loadJobs, loadWork, saveJobs, saveWork, workKey } from './jobs-store';
import { canShareFiles, deletePhotos, photoDataUrls, PHOTOS_SUPPORTED, restorePhoto, shareFiles } from './photo-store';

export const BACKUP_SUPPORTED = Platform.OS === 'web' && PHOTOS_SUPPORTED;

export const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);

export type Progress = (text: string) => void;

export async function lastBackup(): Promise<string | null> {
  return getItem(BACKUP_LAST_KEY);
}

export async function markBackup(now: Date = new Date()): Promise<string> {
  const iso = now.toISOString();
  await setItem(BACKUP_LAST_KEY, iso);
  return iso;
}

export type PreparedBackup = { file: File; name: string; jobs: number; photos: number; missing: number; bytes: number; tooBig: boolean };

// Шаг 1: собрать файл (читает все фото — может занять несколько секунд). Отправка — отдельным нажатием:
// Safari открывает «Поделиться» только сразу после нажатия.
export async function prepareBackup(onProgress?: Progress): Promise<PreparedBackup | { error: string }> {
  if (!BACKUP_SUPPORTED) return { error: 'Копия файлом работает в веб-версии «Формана» (Safari или Chrome).' };
  try {
    const jobs = realJobs(await loadJobs());
    if (!jobs.length) return { error: 'Пока нечего сохранять: нет ни одного объекта (пример ДЕМО в копию не входит).' };
    const works: Record<string, WorkV03Doc> = {};
    for (const j of jobs) works[j.id] = await loadWork(j.id);
    const ids = jobs.flatMap(j => j.photos.map(p => p.id));
    const { urls, missing } = await photoDataUrls(ids, (k, n) => onProgress?.(`Собираю копию: фото ${k + 1} из ${n}…`));
    const now = new Date();
    const backup = buildBackup(jobs, works, urls, now);
    const name = backupFileName(now);
    const file = new File(backupParts(backup), name, { type: 'application/json' });
    return { file, name, jobs: jobs.length, photos: Object.keys(backup.photos).length, missing, bytes: file.size, tooBig: file.size > BACKUP_MAX_BYTES };
  } catch {
    return { error: 'Не удалось собрать копию. Закройте лишние вкладки и попробуйте ещё раз.' };
  }
}

export function canShareBackup(p: PreparedBackup): boolean {
  return canShareFiles([p.file]);
}

export async function shareBackup(p: PreparedBackup): Promise<'ok' | 'cancel' | 'fail'> {
  return shareFiles([p.file], 'Копия «Формана»', `Копия «Формана»: ${objects(p.jobs)}, ${p.photos} фото. Откройте «Форман» → «Загрузить копию».`);
}

// Скачивание. Узнать, сохранил ли человек файл, браузер не даёт (в Safari можно нажать «Отмена»),
// поэтому дата копии записывается только после «Файл сохранён» (backup-card.tsx).
export function downloadBackup(p: PreparedBackup): boolean {
  try {
    const url = URL.createObjectURL(p.file);
    const a = document.createElement('a');
    a.href = url;
    a.download = p.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000); // большой файл: телефону нужно время его сохранить
    return true;
  } catch {
    return false;
  }
}

// Выбор файла копии: input создаётся и «нажимается» сразу в обработчике нажатия (иначе Safari не откроет окно)
export function chooseBackupFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.position = 'fixed';
    input.style.left = '-1000px';
    input.setAttribute('data-testid', 'backup-input');
    let done = false;
    const finish = (f: File | null) => { if (done) return; done = true; input.remove(); resolve(f); };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

export type RestoreResult =
  | { ok: true; text: string; notes: string[]; added: number; photos: number; skipped: number; wasEmpty: boolean; createdAt: string }
  | { ok: false; text: string };

const WRITE_FAIL = 'Не удалось записать копию на этом телефоне — ничего не изменено. Возможно, мало места (оно общее со «Складом») или браузер в приватном режиме: откройте обычную вкладку Safari.';

// План слияния по тому, что лежит на телефоне прямо сейчас
async function planNow(inc: ParsedBackup): Promise<{ plan: MergePlan; wasEmpty: boolean }> {
  const local = await loadJobs();
  const ids = new Set(local.map(j => j.id));
  const localWorks: Record<string, WorkV03Doc> = {};
  for (const j of inc.jobs) if (ids.has(j.id)) localWorks[j.id] = await loadWork(j.id);
  return { plan: planMerge(local, localWorks, inc), wasEmpty: !realJobs(local).length };
}

export async function restoreBackup(file: File, onProgress?: Progress): Promise<RestoreResult> {
  if (!BACKUP_SUPPORTED) return { ok: false, text: 'Загрузка копии работает в веб-версии «Формана» (Safari или Chrome).' };
  if (!file.size) return { ok: false, text: BACKUP_MESSAGES.empty };
  if (file.size > BACKUP_MAX_BYTES) return { ok: false, text: BACKUP_MESSAGES.too_big };
  onProgress?.('Читаю файл копии…');
  let text: string;
  try { text = await file.text(); } catch { return { ok: false, text: 'Не удалось прочитать файл. Сохраните его в «Файлы» и выберите оттуда.' }; }
  const parsed = parseBackup(text, { work: sanitizeWork });
  if (!parsed.ok) return { ok: false, text: parsed.message };
  const inc = parsed.backup;

  // 1. Фото — долго (минуты на большой копии). План здесь — только чтобы знать, какие фото нужны.
  const first = await planNow(inc);
  const written: string[] = [];
  let failed = 0;
  for (const [k, id] of first.plan.photoIds.entries()) {
    onProgress?.(`Загружаю фото: ${k + 1} из ${first.plan.photoIds.length}…`);
    const r = await restorePhoto(id, inc.photos[id]);
    if (r === 'written') written.push(id);
    else if (r === 'fail') failed++;
  }

  // 2. Пока писались фото, на телефоне могли что-то поменять: план — заново, по свежим данным, и сразу запись.
  onProgress?.('Записываю объекты…');
  let plan: MergePlan;
  let wasEmpty: boolean;
  try {
    ({ plan, wasEmpty } = await planNow(inc));
  } catch {
    await deletePhotos(written);
    return { ok: false, text: WRITE_FAIL };
  }
  const old: [string, string | null][] = []; // что было в хранилище до записи — чтобы вернуть при сбое
  try {
    for (const a of plan.actions) {
      if (!a.work) continue;
      old.push([workKey(a.job.id), await getItem(workKey(a.job.id))]);
      if (!(await saveWork(a.work))) throw new Error('save');
    }
    if (plan.actions.length) {
      old.push([JOBS_KEY, await getItem(JOBS_KEY)]);
      if (!(await saveJobs(plan.jobs))) throw new Error('save');
    }
  } catch {
    // откат: всё, что успели записать, возвращаем как было; записанные фото этой загрузки — стираем
    let back = true;
    for (const [key, value] of old.reverse()) back = (value === null ? await removeItem(key) : await setItem(key, value)) && back;
    await deletePhotos(written);
    return { ok: false, text: back ? WRITE_FAIL : 'Копия загрузилась не полностью: на телефоне кончилось место. Освободите место и загрузите копию ещё раз — повторная загрузка ничего не задвоит.' };
  }

  // 3. Уборка: фото, удалённые на другом телефоне, и фото этой загрузки, на которые никто не ссылается
  const used = new Set(plan.jobs.flatMap(j => j.photos.map(p => p.id)));
  await deletePhotos([...plan.dropPhotoIds, ...written.filter(id => !used.has(id))]);

  const notes = restoreNotes(plan, inc);
  if (failed || inc.brokenPhotos) notes.push(`Не удалось загрузить фото: ${failed + inc.brokenPhotos} (фото в файле повреждено или на телефоне мало места).`);
  const photos = written.filter(id => used.has(id)).length;
  return {
    ok: true, text: restoreSummary(plan.actions.length, photos, plan.skipped.length), notes,
    added: plan.actions.length, photos, skipped: plan.skipped.length, wasEmpty, createdAt: inc.createdAt,
  };
}
