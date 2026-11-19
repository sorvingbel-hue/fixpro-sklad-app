// Копия файлом (М7): собрать файл *.forman.json со всеми объектами и фото, отдать «Поделиться» или
// скачать; загрузить такой файл на этом или другом телефоне. Только веб-версия (фото есть только там).
// Чистая логика (формат, проверка, слияние) — в backup-model.ts, здесь — хранилище, файлы и браузер.
import { Platform } from 'react-native';

import { getItem, setItem } from '@/lib/storage';

import type { WorkV03Doc } from '../work/import-v03';
import { normalizeWork } from '../work/work-model';
import {
  BACKUP_LAST_KEY, BACKUP_MAX_BYTES, BACKUP_MESSAGES, backupFileName, backupParts, buildBackup, parseBackup, planMerge, realJobs,
  restoreSummary,
} from './backup-model';
import { normalizeJobs } from './jobs-model';
import { loadJobs, loadWork, saveJobs, saveWork } from './jobs-store';
import { canShareFiles, photoDataUrls, PHOTOS_SUPPORTED, restorePhoto, shareFiles } from './photo-store';

export const BACKUP_SUPPORTED = Platform.OS === 'web' && PHOTOS_SUPPORTED;

export const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);

export async function lastBackup(): Promise<string | null> {
  return getItem(BACKUP_LAST_KEY);
}

export async function markBackup(now: Date = new Date()): Promise<string> {
  const iso = now.toISOString();
  await setItem(BACKUP_LAST_KEY, iso);
  return iso;
}

export type PreparedBackup = { file: File; name: string; jobs: number; photos: number; missing: number; bytes: number };

// Шаг 1: собрать файл (читает все фото — может занять несколько секунд). Отправка — отдельным нажатием:
// Safari открывает «Поделиться» только сразу после нажатия.
export async function prepareBackup(): Promise<PreparedBackup | { error: string }> {
  if (!BACKUP_SUPPORTED) return { error: 'Копия файлом работает в веб-версии «Формана» (Safari или Chrome).' };
  try {
    const jobs = realJobs(await loadJobs());
    if (!jobs.length) return { error: 'Пока нечего сохранять: нет ни одного объекта (пример ДЕМО в копию не входит).' };
    const works: Record<string, WorkV03Doc> = {};
    for (const j of jobs) works[j.id] = await loadWork(j.id);
    const ids = jobs.flatMap(j => j.photos.map(p => p.id));
    const { urls, missing } = await photoDataUrls(ids);
    const now = new Date();
    const backup = buildBackup(jobs, works, urls, now);
    const name = backupFileName(now);
    const file = new File(backupParts(backup), name, { type: 'application/json' });
    return { file, name, jobs: jobs.length, photos: Object.keys(backup.photos).length, missing, bytes: file.size };
  } catch {
    return { error: 'Не удалось собрать копию. Закройте лишние вкладки и попробуйте ещё раз.' };
  }
}

export function canShareBackup(p: PreparedBackup): boolean {
  return canShareFiles([p.file]);
}

export async function shareBackup(p: PreparedBackup): Promise<'ok' | 'cancel' | 'fail'> {
  return shareFiles([p.file], 'Копия «Формана»', `Копия «Формана»: ${p.jobs} объект., ${p.photos} фото. Откройте «Форман» → «Загрузить копию».`);
}

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

export async function restoreBackup(file: File): Promise<RestoreResult> {
  if (!BACKUP_SUPPORTED) return { ok: false, text: 'Загрузка копии работает в веб-версии «Формана» (Safari или Chrome).' };
  if (!file.size) return { ok: false, text: BACKUP_MESSAGES.empty };
  if (file.size > BACKUP_MAX_BYTES) return { ok: false, text: BACKUP_MESSAGES.too_big };
  let text: string;
  try { text = await file.text(); } catch { return { ok: false, text: 'Не удалось прочитать файл. Сохраните его в «Файлы» и выберите оттуда.' }; }
  const parsed = parseBackup(text, { jobs: normalizeJobs, work: normalizeWork });
  if (!parsed.ok) return { ok: false, text: parsed.message };
  const inc = parsed.backup;

  try {
    const local = await loadJobs();
    const localIds = new Set(local.map(j => j.id));
    const localWorks: Record<string, WorkV03Doc> = {};
    for (const j of inc.jobs) if (localIds.has(j.id)) localWorks[j.id] = await loadWork(j.id);
    const plan = planMerge(local, localWorks, inc);

    // порядок: фото → «Работа» → список. Если запись оборвётся, в списке не будет ссылок на пустоту.
    let written = 0, failed = 0;
    for (const id of plan.photoIds) {
      const r = await restorePhoto(id, inc.photos[id]);
      if (r === 'written') written++;
      else if (r === 'fail') failed++;
    }
    for (const a of plan.actions) if (a.work && !(await saveWork(a.work))) throw new Error('save');
    if (plan.actions.length && !(await saveJobs(plan.jobs))) throw new Error('save');

    const notes: string[] = [];
    const replaced = plan.actions.filter(a => a.kind === 'replace').length;
    if (replaced) notes.push(`Из них заменены более свежими из файла: ${replaced}.`);
    if (plan.skipped.length) notes.push('Пропущены объекты, которые на этом телефоне такие же или новее.');
    const took = new Set(plan.actions.map(a => a.job.id));
    const notInFile = inc.jobs.filter(j => took.has(j.id)).flatMap(j => j.photos).filter(p => !inc.photos[p.id]).length;
    if (notInFile) notes.push(`Фото без файла в копии: ${notInFile} (их не было и на первом телефоне).`);
    if (failed || inc.brokenPhotos) notes.push(`Не удалось загрузить фото: ${failed + inc.brokenPhotos} (фото в файле повреждено или на телефоне мало места).`);
    if (inc.broken) notes.push(`Повреждённых записей в файле: ${inc.broken} — пропущены.`);
    return {
      ok: true, text: restoreSummary(plan.actions.length, written, plan.skipped.length), notes,
      added: plan.actions.length, photos: written, skipped: plan.skipped.length,
      wasEmpty: !realJobs(local).length, createdAt: inc.createdAt,
    };
  } catch {
    return { ok: false, text: 'Не удалось записать копию на этом телефоне: мало места или браузер в приватном режиме. Откройте обычную вкладку Safari.' };
  }
}
