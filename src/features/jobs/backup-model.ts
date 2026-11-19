// Резервная копия файлом (М7): сборка, проверка и слияние файла *.forman.json — без React Native
// и без браузера (логику проверяет tests/backup-model.test.mjs в Node).
// Файл: { kind:'forman-backup', v:1, createdAt, app:'forman', jobs:[…], works:{[jobId]:WorkV03Doc}, photos:{[photoId]:dataURL} }.
// Фото — полный JPEG как data:URL; миниатюру после загрузки пересчитывает телефон.
// Только типы: файл должен грузиться в Node без сборщика, поэтому строгая проверка «Работы» приходит параметром.
import type { V03Item, V03Question, WorkV03Doc } from '../work/import-v03';
import type { Job, JobPhoto } from './jobs-model';

export const BACKUP_KIND = 'forman-backup';
export const BACKUP_V = 1;
export const BACKUP_LAST_KEY = 'fm.backup.last'; // ISO-время последней сохранённой копии (localStorage)
export const BACKUP_STALE_DAYS = 3;
// Больше — телефон может не осилить: файл читается целиком (замер: 183 МБ → ~375 МБ памяти в Chromium)
export const BACKUP_MAX_BYTES = 150 * 1024 * 1024;
export const PHOTOS_MAX = 60; // = PHOTOS_MAX в jobs-model.ts (тест сверяет)
export const REMOVED_MAX = 200; // = REMOVED_MAX в jobs-model.ts (тест сверяет)

// Пределы для записей из файла: защита от испорченного или поддельного файла (свои данные в них укладываются)
export const FILE_LIMITS = { title: 200, orderNo: 100, note: 20_000, photosPerJob: 200, photoName: 120, extraKeys: 30, extraStr: 2000 } as const;
const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

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
  // строгая проверка «Работы» объекта jobId (work-model.ts → sanitizeWork); null — документ не берём
  work: (raw: unknown, jobId: string) => WorkV03Doc | null;
};

// В копию идут только настоящие объекты: пример (ДЕМО) — вымышленный, его можно открыть заново
export const realJobs = (jobs: Job[]): Job[] => jobs.filter(j => !j.example);

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
  dupes: number;         // один и тот же объект в файле дважды (взята более свежая запись)
  brokenWorks: number;   // «Работа» объекта повреждена — не взята (у объекта останется своя или пустая)
  brokenPhotos: number;  // фото в файле, которые не похожи на картинку
  trimmed: number;       // слишком длинные тексты, обрезанные при проверке
  clockAheadMin: number; // часы телефона, где сделана копия, спешат (минут; 0 — не заметно)
};

export type ParseResult = { ok: true; backup: ParsedBackup } | { ok: false; reason: BackupReason; message: string };

export const BACKUP_MESSAGES: Record<BackupReason, string> = {
  empty: 'Файл пустой. Выберите файл копии «Формана» — его имя кончается на .forman.json.',
  too_big: 'Файл слишком большой для телефона (больше 150 МБ). Сделайте копию заново, удалив лишние фото или законченные объекты.',
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

// id объекта — часть ключа хранилища, id фото — часть ключа IndexedDB ('<id>:full'): только простые символы
const JOB_ID = /^[A-Za-z0-9_-]{1,100}$/;
export const PHOTO_ID = /^[A-Za-z0-9_-]{1,100}$/;
const EXTRA_KEY = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
const KNOWN = new Set(['id', 'title', 'orderNo', 'note', 'createdAt', 'updatedAt', 'editedAt', 'photos', 'removedPhotos', 'example']);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// Дата из файла → ISO (UTC) или null, если это не дата
export function isoOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

type Fix = (iso: string) => string;

function sanitizeJob(raw: unknown, fix: Fix, cut: () => void): Job | null {
  if (!isObj(raw)) return null;
  const { id, title, orderNo, note, createdAt, updatedAt, editedAt, photos, removedPhotos } = raw;
  if (typeof id !== 'string' || !JOB_ID.test(id) || typeof title !== 'string') return null;
  const created = isoOrNull(createdAt);
  if (!created) return null;
  const updated = isoOrNull(updatedAt) ?? created;
  const edited = isoOrNull(editedAt);
  const text = (v: unknown, max: number) => {
    const s = typeof v === 'string' ? v : '';
    if (s.length > max) cut();
    return s.slice(0, max);
  };

  const list: JobPhoto[] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(photos) ? photos : []) {
    if (!isObj(p) || typeof p.id !== 'string' || !PHOTO_ID.test(p.id) || seen.has(p.id)) continue;
    if (p.kind !== 'photo' && p.kind !== 'order') continue;
    seen.add(p.id);
    list.push({
      id: p.id,
      kind: p.kind,
      addedAt: fix(isoOrNull(p.addedAt) ?? updated),
      w: num(p.w),
      h: num(p.h),
      bytes: num(p.bytes),
      name: typeof p.name === 'string' && p.name.trim() ? p.name.slice(0, FILE_LIMITS.photoName) : p.kind === 'order' ? 'скрин заказа' : 'фото',
    });
    if (list.length >= FILE_LIMITS.photosPerJob) break;
  }

  // незнакомые поля (их могла добавить более новая версия) — только короткие простые значения
  const extra: Record<string, string | number | boolean | null> = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (KNOWN.has(k) || !EXTRA_KEY.test(k) || n >= FILE_LIMITS.extraKeys) continue;
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= FILE_LIMITS.extraStr)) {
      extra[k] = v;
      n++;
    }
  }

  return {
    ...extra,
    id,
    title: text(title, FILE_LIMITS.title),
    orderNo: text(orderNo, FILE_LIMITS.orderNo),
    note: text(note, FILE_LIMITS.note),
    createdAt: fix(created),
    updatedAt: fix(updated),
    ...(edited ? { editedAt: fix(edited) } : {}),
    photos: list,
    ...(Array.isArray(removedPhotos)
      ? { removedPhotos: removedPhotos.filter((x): x is string => typeof x === 'string' && PHOTO_ID.test(x)).slice(-REMOVED_MAX) }
      : {}),
    // пример (ДЕМО) в копию не входит: всё, что пришло из файла, — настоящие объекты
  };
}

export function parseBackup(text: string, n: Normalizers, now: Date = new Date()): ParseResult {
  if (typeof text !== 'string' || !text.trim()) return fail('empty');
  if (text.length > BACKUP_MAX_BYTES) return fail('too_big');
  let raw: unknown;
  try { raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch { return fail('not_json'); }
  if (!isObj(raw)) return fail('not_backup');
  const x = raw;
  if (x.kind !== BACKUP_KIND) return fail('not_backup');
  if (typeof x.v !== 'number') return fail('not_backup');
  if (x.v > BACKUP_V) return fail('newer');
  if (x.v !== BACKUP_V) return fail('not_backup');
  if (!Array.isArray(x.jobs)) return fail('invalid');

  // Часы второго телефона могут спешить: копия «из будущего» → сдвигаем все её даты назад на эту разницу
  // (это нижняя оценка) и ни одна дата из файла не бывает позже, чем сейчас на этом телефоне.
  const createdAt = isoOrNull(x.createdAt) ?? '';
  const nowMs = now.getTime();
  const ahead = createdAt && Date.parse(createdAt) - nowMs > CLOCK_TOLERANCE_MS ? Date.parse(createdAt) - nowMs : 0;
  const fix: Fix = iso => new Date(Math.min(Date.parse(iso) - ahead, nowMs)).toISOString();

  let broken = 0, dupes = 0, trimmed = 0;
  const byId = new Map<string, Job>();
  for (const r of x.jobs) {
    const j = sanitizeJob(r, fix, () => { trimmed++; });
    if (!j) { broken++; continue; }
    const have = byId.get(j.id);
    if (have) dupes++;
    if (!have || j.updatedAt > have.updatedAt) byId.set(j.id, j);
  }
  const jobs = [...byId.values()];
  if (!jobs.length) return fail(x.jobs.length ? 'invalid' : 'no_jobs');

  const worksRaw = isObj(x.works) ? x.works : {};
  const works: Record<string, WorkV03Doc> = {};
  let brokenWorks = 0;
  for (const j of jobs) {
    if (!Object.prototype.hasOwnProperty.call(worksRaw, j.id)) continue;
    const w = n.work(worksRaw[j.id], j.id); // чужой или битый документ не берём — останется свой/пустой
    if (!w) { brokenWorks++; continue; }
    works[j.id] = w.updated ? { ...w, updated: fix(w.updated) } : w;
  }

  const photosRaw = isObj(x.photos) ? x.photos : {};
  const wanted = new Set(jobs.flatMap(j => j.photos.map(p => p.id)));
  const photos: Record<string, string> = {};
  let brokenPhotos = 0;
  for (const id of wanted) {
    if (!Object.prototype.hasOwnProperty.call(photosRaw, id)) continue;
    const v = photosRaw[id];
    if (isPhotoDataUrl(v)) photos[id] = v;
    else brokenPhotos++;
  }

  return {
    ok: true,
    backup: { createdAt, jobs, works, photos, broken, dupes, brokenWorks, brokenPhotos, trimmed, clockAheadMin: Math.round(ahead / 60000) },
  };
}

// ---------- Слияние с тем, что уже есть на телефоне ----------
// Объект сливается по частям, у каждой своё время правки — так правки с двух телефонов не затирают друг друга:
//  - поля (название, № заказа, заметка) — целиком более свежие по editedAt;
//  - фото — объединяются; фото, удалённые на одном из телефонов (removedPhotos), не возвращаются;
//  - «Работа» — более свежий документ (updated) главный, но позиции и вопросы, которых в нём нет, добавляются,
//    а пустые поля позиции заполняются из другого документа; отметки этапов — объединяются.
// Повторная загрузка того же файла ничего не меняет (сравнивается содержимое, а не даты).

type Card = Record<string, unknown>;
const cardOf = (j: Job): Card => {
  const c: Card = {};
  for (const [k, v] of Object.entries(j)) if (!['id', 'createdAt', 'updatedAt', 'editedAt', 'photos', 'removedPhotos', 'example'].includes(k)) c[k] = v;
  return c;
};
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sortedKeys = (o: Record<string, unknown>) => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));
const editedAt = (j: Job) => j.editedAt || j.updatedAt || j.createdAt; // = jobEditedAt в jobs-model.ts
const maxIso = (a: string, b: string) => (a > b ? a : b);

const empty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim());

function mergeItem(n: V03Item, o: V03Item): V03Item {
  const r: V03Item = { ...n };
  for (const f of ['required', 'ordered', 'actual', 'location', 'note', 'source', 'hint', 'unit'] as const) {
    if (empty(r[f]) && !empty(o[f])) (r as Record<string, unknown>)[f] = o[f];
  }
  if (r.status === 'unknown' && o.status !== 'unknown') r.status = o.status;
  return r;
}

function mergeQuestion(n: V03Question, o: V03Question): V03Question {
  return !n.answer.trim() && o.answer.trim() ? { ...n, answer: o.answer, resolved: o.resolved } : n;
}

function mergeList<T extends { id: string }>(newer: T[], older: T[], fn: (n: T, o: T) => T): T[] {
  const old = new Map(older.map(o => [o.id, o]));
  const ids = new Set(newer.map(n => n.id));
  return [...newer.map(n => (old.has(n.id) ? fn(n, old.get(n.id)!) : n)), ...older.filter(o => !ids.has(o.id))];
}

function mergeNotes(n: string, o: string): string {
  if (!o.trim() || n.includes(o.trim())) return n;
  if (!n.trim() || o.includes(n.trim())) return o;
  return `${n}\n\n${o}`;
}

const workContent = (d: WorkV03Doc) =>
  JSON.stringify([d.items, d.questions, d.team, sortedKeys(d.checks), d.notes]);

export type WorkMerge = { doc: WorkV03Doc | null; changed: boolean; merged: boolean };

// «Работа»: local — на этом телефоне (null — нет), inc — из файла (null — в файле нет).
// preferLocal — датам файла верить нельзя (часы того телефона спешат): при расхождении главный — свой документ.
export function mergeWork(local: WorkV03Doc | null, inc: WorkV03Doc | null, preferLocal = false): WorkMerge {
  if (!inc) return { doc: local, changed: false, merged: false };
  if (!local) return { doc: inc, changed: true, merged: false };
  if (workContent(local) === workContent(inc)) return { doc: local, changed: false, merged: false };
  const tl = local.updated ?? '', ti = inc.updated ?? '';
  if (!ti) return { doc: local, changed: false, merged: false }; // в файле документ ни разу не правили
  if (!tl) return { doc: inc, changed: true, merged: false };   // здесь ни разу не правили
  const [newer, older] = ti > tl && !preferLocal ? [inc, local] : [local, inc];
  const doc: WorkV03Doc = {
    ...newer,
    items: mergeList(newer.items, older.items, mergeItem),
    questions: mergeList(newer.questions, older.questions, mergeQuestion),
    team: newer.team.length ? newer.team : older.team,
    checks: { ...older.checks, ...newer.checks },
    notes: mergeNotes(newer.notes, older.notes),
    updated: maxIso(tl, ti),
  };
  const changed = workContent(doc) !== workContent(local);
  return { doc: changed ? doc : local, changed, merged: changed };
}

export type MergeAction = {
  job: Job;
  kind: 'add' | 'update';
  work: WorkV03Doc | null;  // что записать в «Работу» (null — не трогать)
  workMerged: boolean;      // «Работа» правилась на обоих телефонах — объединена
  cardFromFile: boolean;    // поля объекта взяты из файла
  photosAdded: number;
  photosRemoved: number;    // удалены здесь, потому что их удалили на другом телефоне
};

export type MergePlan = {
  jobs: Job[];              // итоговый список объектов
  actions: MergeAction[];   // что записать (новые и изменённые объекты)
  skipped: Job[];           // на телефоне то же самое или новее — не трогаем
  photoIds: string[];       // фото из файла, которые нужны итоговому списку (запишутся, если их ещё нет)
  dropPhotoIds: string[];   // фото этого телефона, которые удалили на другом, — стереть из хранилища
  clashes: number;          // фото из файла с id чужого фото этого телефона — пропущены
  overLimit: { title: string; photos: number }[]; // после слияния фото больше предела
  keptLocal: string[];      // часы того телефона спешат: где правки расходятся, оставлено своё (названия объектов)
};

export function planMerge(
  local: Job[],
  localWorks: Record<string, WorkV03Doc | null | undefined>,
  incoming: ParsedBackup,
): MergePlan {
  const byId = new Map(local.map(j => [j.id, j]));
  const owner = new Map<string, string>(); // id фото → id объекта на этом телефоне
  for (const j of local) for (const p of j.photos) owner.set(p.id, j.id);
  const actions: MergeAction[] = [];
  const skipped: Job[] = [];
  const dropPhotoIds: string[] = [];
  const keptLocal: string[] = [];
  let clashes = 0;
  // часы телефона, где сделана копия, заметно спешат — датам файла не верим: при расхождении остаётся своё
  const trust = incoming.clockAheadMin <= 5;

  for (const inc of incoming.jobs) {
    const have = byId.get(inc.id);
    // фото из файла с id, которое уже занято другим объектом этого телефона, не берём (иначе общий снимок)
    const own = inc.photos.filter(p => {
      const o = owner.get(p.id);
      if (o && o !== inc.id) { clashes++; return false; }
      return true;
    });
    if (!have) {
      const job = { ...inc, photos: own };
      for (const p of own) owner.set(p.id, inc.id);
      actions.push({ job, kind: 'add', work: incoming.works[inc.id] ?? null, workMerged: false, cardFromFile: true, photosAdded: own.length, photosRemoved: 0 });
      byId.set(inc.id, job);
      continue;
    }

    // поля объекта: из файла, если там правили позже и от этого что-то меняется
    const fileCard = { ...cardOf(have), ...cardOf(inc) };
    const cardDiffers = !sameJson(sortedKeys(fileCard), sortedKeys(cardOf(have)));
    const cardFromFile = trust && cardDiffers && editedAt(inc) > editedAt(have);
    if (!trust && cardDiffers) keptLocal.push(have.title);
    // фото: объединить, без удалённых на любом из телефонов
    const removed = [...new Set([...(have.removedPhotos ?? []), ...(inc.removedPhotos ?? [])])].slice(-REMOVED_MAX);
    const gone = new Set(removed);
    const keep = have.photos.filter(p => !gone.has(p.id));
    const ids = new Set(keep.map(p => p.id));
    const extra = own.filter(p => !gone.has(p.id) && !ids.has(p.id));
    const photos = [...keep, ...extra].sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id));
    const dropped = have.photos.filter(p => gone.has(p.id)).map(p => p.id);
    // «Работа»
    const w = mergeWork(localWorks[inc.id] ?? null, incoming.works[inc.id] ?? null, !trust);
    if (!trust && w.merged && !keptLocal.includes(have.title)) keptLocal.push(have.title);

    if (!cardFromFile && !extra.length && !dropped.length && !w.changed) {
      skipped.push(inc);
      continue;
    }
    const card = cardFromFile ? fileCard : cardOf(have);
    const job: Job = {
      ...(card as Partial<Job>),
      id: have.id,
      title: String(card.title ?? have.title),
      orderNo: String(card.orderNo ?? have.orderNo),
      note: String(card.note ?? have.note),
      createdAt: have.createdAt < inc.createdAt ? have.createdAt : inc.createdAt,
      updatedAt: maxIso(have.updatedAt, inc.updatedAt),
      editedAt: cardFromFile ? editedAt(inc) : editedAt(have),
      photos,
      ...(removed.length ? { removedPhotos: removed } : {}),
      ...(have.example ? { example: true } : {}),
    };
    for (const p of extra) owner.set(p.id, inc.id);
    dropPhotoIds.push(...dropped);
    actions.push({ job, kind: 'update', work: w.changed ? w.doc : null, workMerged: w.merged, cardFromFile, photosAdded: extra.length, photosRemoved: dropped.length });
    byId.set(inc.id, job);
  }

  const jobs = [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // нужны фото всех объектов итогового списка, которые есть в файле (у того же объекта): так загрузка
  // «долечивает» фото, которых на телефоне не хватало, а уже имеющиеся просто пропускаются
  const fileOwner = new Map<string, string>();
  for (const j of incoming.jobs) for (const p of j.photos) if (!fileOwner.has(p.id)) fileOwner.set(p.id, j.id);
  const finalOwner = new Map<string, string>();
  for (const j of jobs) for (const p of j.photos) finalOwner.set(p.id, j.id);
  const photoIds = Object.keys(incoming.photos).filter(id => finalOwner.has(id) && finalOwner.get(id) === fileOwner.get(id));
  const overLimit = actions.filter(a => a.job.photos.length > PHOTOS_MAX).map(a => ({ title: a.job.title, photos: a.job.photos.length }));
  return { jobs, actions, skipped, photoIds, dropPhotoIds, clashes, overLimit, keptLocal };
}

// ---------- Слова и напоминание ----------

export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}

export const objects = (n: number) => `${n} ${plural(n, ['объект', 'объекта', 'объектов'])}`;

export function restoreSummary(changed: number, photos: number, skipped: number): string {
  return `Загружено: ${objects(changed)}, ${photos} фото; пропущено: ${skipped}.`;
}

const quote = (titles: string[]) => titles.slice(0, 3).map(t => `«${t.length > 40 ? t.slice(0, 40) + '…' : t}»`).join(', ') + (titles.length > 3 ? ` и ещё ${titles.length - 3}` : '');

// Пояснения к итогу загрузки (без сбоев записи — их добавляет backup-store)
export function restoreNotes(plan: MergePlan, inc: ParsedBackup): string[] {
  const notes: string[] = [];
  const added = plan.actions.filter(a => a.kind === 'add').length;
  const updated = plan.actions.filter(a => a.kind === 'update');
  if (updated.length) notes.push(`Из них новых: ${added}, дополнено данными из файла: ${updated.length}.`);
  const merged = updated.filter(a => a.workMerged).map(a => a.job.title);
  if (merged.length) notes.push(`Сверка и этапы менялись на обоих телефонах — объединены: ${quote(merged)}. Проверьте их.`);
  const removed = updated.reduce((s, a) => s + a.photosRemoved, 0);
  if (removed) notes.push(`Убрано фото, которые удалили на другом телефоне: ${removed}.`);
  if (plan.skipped.length) notes.push('Пропущены объекты, которые на этом телефоне такие же или новее.');
  const took = new Set(plan.actions.map(a => a.job.id));
  const notInFile = inc.jobs.filter(j => took.has(j.id)).flatMap(j => j.photos).filter(p => !inc.photos[p.id]).length;
  if (notInFile) notes.push(`Фото без файла в копии: ${notInFile} (их не было и на первом телефоне).`);
  for (const o of plan.overLimit) notes.push(`У объекта «${o.title}» теперь ${o.photos} фото — больше ${PHOTOS_MAX}. Чтобы добавить новые, удалите лишние.`);
  if (plan.clashes) notes.push(`Фото с чужим номером пропущены: ${plan.clashes} (файл, похоже, правили вручную).`);
  if (inc.dupes) notes.push(`Повторяющихся записей в файле: ${inc.dupes} — взята более свежая.`);
  if (inc.broken) notes.push(`Повреждённых записей в файле: ${inc.broken} — пропущены.`);
  if (inc.brokenWorks) notes.push(`Повреждённая сверка в файле: ${inc.brokenWorks} — не загружена, у объекта осталась своя.`);
  if (inc.trimmed) notes.push(`Слишком длинный текст обрезан: ${inc.trimmed}.`);
  if (inc.clockAheadMin >= 60) {
    const h = Math.round(inc.clockAheadMin / 60);
    notes.push(`Часы на телефоне, где сделана копия, спешат примерно на ${h} ${plural(h, ['час', 'часа', 'часов'])}. Проверьте на нём дату и время в настройках.`);
  } else if (inc.clockAheadMin > 5) {
    notes.push(`Часы на телефоне, где сделана копия, спешат примерно на ${inc.clockAheadMin} мин. Проверьте на нём дату и время.`);
  }
  if (plan.keptLocal.length) notes.push(`Из-за этого, где правки расходятся, оставлено то, что на этом телефоне: ${quote(plan.keptLocal)}. Новое из файла (фото, позиции) добавлено.`);
  return notes;
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
