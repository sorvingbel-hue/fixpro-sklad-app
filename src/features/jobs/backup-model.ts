// Резервная копия файлом (М7): сборка, проверка и слияние файла *.forman.json — без React Native
// и без браузера (логику проверяет tests/backup-model.test.mjs в Node).
// Файл: { kind:'forman-backup', v:1, createdAt, app:'forman', jobs:[…], works:{[jobId]:WorkV03Doc}, photos:{[photoId]:dataURL} }.
// Фото — полный JPEG как data:URL; миниатюру после загрузки пересчитывает телефон.
// Только типы: файл должен грузиться в Node без сборщика, поэтому normalizeJobs/normalizeWork приходят параметром.
import type { WorkV03Doc } from '../work/import-v03';
import type { Job } from './jobs-model';

export const BACKUP_KIND = 'forman-backup';
export const BACKUP_V = 1;
export const BACKUP_LAST_KEY = 'fm.backup.last'; // ISO-время последней сохранённой копии (localStorage)
export const BACKUP_STALE_DAYS = 3;
export const BACKUP_MAX_BYTES = 300 * 1024 * 1024; // больше — телефон не осилит прочитать

export type BackupFile = {
  kind: typeof BACKUP_KIND;
  v: typeof BACKUP_V;
  createdAt: string;
  app: 'forman';
  jobs: Job[];
  works: Record<string, WorkV03Doc>;
  photos: Record<string, string>;
};

export type Normalizers = {
  jobs: (raw: unknown) => Job[];
  work: (raw: unknown) => WorkV03Doc | null;
};

// В копию идут только настоящие объекты: пример (ДЕМО) — вымышленный, его можно открыть заново
export const realJobs = (jobs: Job[]): Job[] => jobs.filter(j => !j.example);

// Свежесть объекта: правки «Работы» (сверка, этапы) не трогают job.updatedAt, поэтому берём большее
export function freshness(j: Job, w?: WorkV03Doc | null): string {
  const a = j.updatedAt || j.createdAt || '';
  const b = (w && typeof w.updated === 'string' && w.updated) || '';
  return a > b ? a : b;
}

export function buildBackup(
  jobs: Job[],
  works: Record<string, WorkV03Doc>,
  photos: Record<string, string>,
  now: Date = new Date(),
): BackupFile {
  const list = realJobs(jobs);
  const w: Record<string, WorkV03Doc> = {};
  const ph: Record<string, string> = {};
  for (const j of list) {
    if (works[j.id]) w[j.id] = works[j.id];
    for (const p of j.photos) if (photos[p.id]) ph[p.id] = photos[p.id];
  }
  return { kind: BACKUP_KIND, v: BACKUP_V, createdAt: now.toISOString(), app: 'forman', jobs: list, works: w, photos: ph };
}

// Текст файла кусками: фото не склеиваются в одну огромную строку (телефону легче), Blob соберёт сам.
// parts.join('') — обычный JSON того же объекта.
export function backupParts(b: BackupFile): string[] {
  const head = JSON.stringify({ kind: b.kind, v: b.v, createdAt: b.createdAt, app: b.app, jobs: b.jobs, works: b.works });
  const parts = [head.slice(0, -1), ',"photos":{'];
  let first = true;
  for (const [id, url] of Object.entries(b.photos)) {
    parts.push(`${first ? '' : ','}${JSON.stringify(id)}:${JSON.stringify(url)}`);
    first = false;
  }
  parts.push('}}');
  return parts;
}

const p2 = (n: number) => String(n).padStart(2, '0');

// Имя файла — латиницей (с кириллицей Chromium сохранял как «download»), по часам телефона
export function backupFileName(now: Date = new Date()): string {
  return `forman-kopiya-${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}.forman.json`;
}

// ---------- Проверка файла ----------

export type BackupReason = 'empty' | 'too_big' | 'not_json' | 'not_backup' | 'newer' | 'invalid' | 'no_jobs';

export type ParsedBackup = {
  createdAt: string;
  jobs: Job[];
  works: Record<string, WorkV03Doc>;
  photos: Record<string, string>;
  broken: number;        // битые записи объектов, которые отброшены
  brokenPhotos: number;  // фото в файле, которые не похожи на картинку
};

export type ParseResult = { ok: true; backup: ParsedBackup } | { ok: false; reason: BackupReason; message: string };

export const BACKUP_MESSAGES: Record<BackupReason, string> = {
  empty: 'Файл пустой. Выберите файл копии «Формана» — его имя кончается на .forman.json.',
  too_big: 'Файл слишком большой для телефона (больше 300 МБ). Сделайте копию заново или удалите лишние фото.',
  not_json: 'Файл повреждён или это не копия «Формана». Нужен файл, который сохранила кнопка «Сохранить копию» (имя кончается на .forman.json).',
  not_backup: 'Это не копия «Формана». Нужен файл, который сохранила кнопка «Сохранить копию» (имя кончается на .forman.json).',
  newer: 'Копия сделана более новой версией «Формана». Обновите страницу и попробуйте ещё раз.',
  invalid: 'Файл копии повреждён: внутри нет списка объектов. Сделайте копию заново на первом телефоне.',
  no_jobs: 'В файле копии нет ни одного объекта.',
};

const fail = (reason: BackupReason): ParseResult => ({ ok: false, reason, message: BACKUP_MESSAGES[reason] });

// Фото в копии — только JPEG/PNG/WebP как data:URL base64 (ничего исполняемого)
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
export const isPhotoDataUrl = (s: unknown): s is string => typeof s === 'string' && s.length > 30 && DATA_URL.test(s);

export function parseBackup(text: string, n: Normalizers): ParseResult {
  if (typeof text !== 'string' || !text.trim()) return fail('empty');
  if (text.length > BACKUP_MAX_BYTES) return fail('too_big');
  let raw: unknown;
  try { raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch { return fail('not_json'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('not_backup');
  const x = raw as Record<string, unknown>;
  if (x.kind !== BACKUP_KIND) return fail('not_backup');
  if (typeof x.v !== 'number') return fail('not_backup');
  if (x.v > BACKUP_V) return fail('newer');
  if (x.v !== BACKUP_V) return fail('not_backup');
  if (!Array.isArray(x.jobs)) return fail('invalid');

  // одинаковый id дважды — берём более свежую запись
  const byId = new Map<string, Job>();
  for (const j of n.jobs(x.jobs)) {
    const have = byId.get(j.id);
    if (!have || j.updatedAt > have.updatedAt) byId.set(j.id, j);
  }
  const jobs = [...byId.values()];
  const broken = x.jobs.length - jobs.length;
  if (!jobs.length) return fail(x.jobs.length ? 'invalid' : 'no_jobs');

  const worksRaw = x.works && typeof x.works === 'object' && !Array.isArray(x.works) ? (x.works as Record<string, unknown>) : {};
  const works: Record<string, WorkV03Doc> = {};
  for (const j of jobs) {
    const w = n.work(worksRaw[j.id]);
    if (w && w.job === j.id) works[j.id] = w; // чужой или битый документ не берём — останется свой/пустой
  }

  const photosRaw = x.photos && typeof x.photos === 'object' && !Array.isArray(x.photos) ? (x.photos as Record<string, unknown>) : {};
  const wanted = new Set(jobs.flatMap(j => j.photos.map(p => p.id)));
  const photos: Record<string, string> = {};
  let brokenPhotos = 0;
  for (const id of wanted) {
    const v = photosRaw[id];
    if (v === undefined) continue;
    if (isPhotoDataUrl(v)) photos[id] = v;
    else brokenPhotos++;
  }

  return {
    ok: true,
    backup: { createdAt: typeof x.createdAt === 'string' ? x.createdAt : '', jobs, works, photos, broken, brokenPhotos },
  };
}

// ---------- Слияние с тем, что уже есть на телефоне ----------

export type MergeAction = { job: Job; kind: 'add' | 'replace'; work: WorkV03Doc | null };

export type MergePlan = {
  jobs: Job[];             // итоговый список объектов
  actions: MergeAction[];  // что записать (новые и более свежие объекты)
  skipped: Job[];          // на телефоне такой же или новее — не трогаем
  photoIds: string[];      // фото из файла, которые нужны итоговому списку (запишутся, если их ещё нет)
};

// Новые объекты — добавить; объект с тем же id — остаётся более свежий (по updatedAt объекта и «Работы»).
// Если файл свежее, фото, которых в нём нет, но есть на этом телефоне, не выбрасываем — ничего не теряется.
// Повторная загрузка того же файла ничего не меняет: всё «такое же» и пропускается.
export function planMerge(
  local: Job[],
  localWorks: Record<string, WorkV03Doc | null | undefined>,
  incoming: ParsedBackup,
): MergePlan {
  const byId = new Map(local.map(j => [j.id, j]));
  const actions: MergeAction[] = [];
  const skipped: Job[] = [];
  for (const inc of incoming.jobs) {
    const have = byId.get(inc.id);
    const work = incoming.works[inc.id] ?? null;
    if (!have) {
      actions.push({ job: inc, kind: 'add', work });
      byId.set(inc.id, inc);
      continue;
    }
    if (freshness(inc, work) > freshness(have, localWorks[inc.id])) {
      const ids = new Set(inc.photos.map(p => p.id));
      const job = { ...inc, photos: [...inc.photos, ...have.photos.filter(p => !ids.has(p.id))] };
      actions.push({ job, kind: 'replace', work });
      byId.set(inc.id, job);
    } else {
      skipped.push(inc);
    }
  }
  const jobs = [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // нужны фото всех объектов итогового списка, которые есть в файле: так загрузка «долечивает»
  // фото, которых на телефоне не хватало, а уже имеющиеся просто пропускаются
  const need = new Set(jobs.flatMap(j => j.photos.map(p => p.id)));
  const photoIds = Object.keys(incoming.photos).filter(id => need.has(id));
  return { jobs, actions, skipped, photoIds };
}

// ---------- Слова и напоминание ----------

export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}

export function restoreSummary(added: number, photos: number, skipped: number): string {
  return `Загружено: ${added} ${plural(added, ['объект', 'объекта', 'объектов'])}, ${photos} фото; пропущено: ${skipped}.`;
}

const DAY = 24 * 60 * 60 * 1000;

// Сколько календарных дней (по часам телефона) прошло с последней копии; null — копии не было или дата битая
export function backupAgeDays(lastIso: string | null | undefined, now: Date = new Date()): number | null {
  if (!lastIso) return null;
  const t = new Date(lastIso);
  if (Number.isNaN(t.getTime())) return null;
  const day0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.max(0, Math.round((day0(now) - day0(t)) / DAY));
}

// Напоминание «Сделайте копию»: есть настоящие объекты, а копии нет или она старше 3 дней
export function needsBackup(jobs: Job[], lastIso: string | null | undefined, now: Date = new Date()): boolean {
  if (!realJobs(jobs).length) return false;
  const t = lastIso ? Date.parse(lastIso) : NaN;
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > BACKUP_STALE_DAYS * DAY;
}

export function backupAgeText(lastIso: string | null | undefined, now: Date = new Date()): string {
  const d = backupAgeDays(lastIso, now);
  if (d === null) return 'Копии ещё нет.';
  if (d === 0) return 'Последняя копия: сегодня.';
  if (d === 1) return 'Последняя копия: вчера.';
  return `Последняя копия: ${d} ${plural(d, ['день', 'дня', 'дней'])} назад.`;
}
