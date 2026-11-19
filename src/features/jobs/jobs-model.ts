// Объекты смены: модель без React Native (её проверяет tests/jobs-model.test.mjs в Node).
// Объект = то, что бригадир называет работой на сегодня: название, № заказа, фото, сверка, этапы.
// Сверка/вопросы/этапы объекта — документ «Работы» (WorkV03Doc), он хранится отдельно (jobs-store).
// Только типы: файл должен грузиться в Node без сборщика.
import type { WorkV03Doc } from '../work/import-v03';

export type PhotoKind = 'photo' | 'order';

export type JobPhoto = {
  id: string;
  kind: PhotoKind;     // photo — фото с объекта; order — скрин заказа (Orcatec и т.п.)
  addedAt: string;     // ISO
  w: number;
  h: number;
  bytes: number;
  name: string;        // имя исходного файла (для отчёта)
  sample?: boolean;    // встроенный вымышленный пример скрина заказа (кнопка «Попробовать разбор на примере»)
};

export type Job = {
  id: string;
  title: string;
  orderNo: string;
  note: string;
  createdAt: string;
  updatedAt: string;   // любая правка объекта (поля или фото)
  editedAt?: string;   // правка полей (название, № заказа, заметка) — для слияния копий с двух телефонов
  photos: JobPhoto[];
  removedPhotos?: string[]; // id удалённых фото: копия со второго телефона не вернёт их обратно
  example?: boolean;   // пример с вымышленными данными
};

export const TITLE_MIN = 2;
export const TITLE_MAX = 80;
export const ORDER_MAX = 40;
export const PHOTOS_MAX = 60; // на один объект: держим хранилище браузера в разумных пределах
export const REMOVED_MAX = 200; // сколько id удалённых фото помнить

export type JobInput = { title: string; orderNo?: string; note?: string };
export type JobErrors = { title?: string; orderNo?: string };

export function validateJob(i: JobInput): { ok: boolean; errors: JobErrors } {
  const errors: JobErrors = {};
  const title = (i.title ?? '').trim();
  if (title.length < TITLE_MIN) errors.title = 'Напишите, как вы называете объект (хотя бы 2 буквы)';
  else if (title.length > TITLE_MAX) errors.title = `Не длиннее ${TITLE_MAX} знаков`;
  if ((i.orderNo ?? '').trim().length > ORDER_MAX) errors.orderNo = `Не длиннее ${ORDER_MAX} знаков`;
  return { ok: Object.keys(errors).length === 0, errors };
}

// Короткий уникальный id без внешних библиотек: время + случайная часть
export function newId(prefix: string, now: Date = new Date(), rnd: () => number = Math.random): string {
  const r = Math.floor(rnd() * 36 ** 4).toString(36).padStart(4, '0');
  return `${prefix}-${now.getTime().toString(36)}${r}`;
}

export function makeJob(i: JobInput, now: Date = new Date(), id: string = newId('job', now)): Job {
  const t = now.toISOString();
  return {
    id,
    title: (i.title ?? '').trim().slice(0, TITLE_MAX),
    orderNo: (i.orderNo ?? '').trim().slice(0, ORDER_MAX),
    note: (i.note ?? '').trim(),
    createdAt: t,
    updatedAt: t,
    editedAt: t,
    photos: [],
  };
}

// Документ «Работы» для объекта. Настоящий объект — пустая сверка и без вопросов (свой список);
// шаблон с вымышленными позициями — только у примера. Этапы — общий шаблон.
export function workForJob(seed: WorkV03Doc, jobId: string, opts: { example?: boolean } = {}): WorkV03Doc {
  const base = { ...seed, job: jobId, source: 'forman' as const, updated: null, importedAt: null };
  return opts.example ? base : { ...base, items: [], questions: [] };
}

// Даты — по часам телефона (не UTC): вечером в Сан-Диего объект не должен получать завтрашнюю дату
const p2 = (n: number) => String(n).padStart(2, '0');
export const localDay = (d: Date): string => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const localTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${localDay(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

export const touch = (j: Job, now: Date = new Date()): Job => ({ ...j, updatedAt: now.toISOString() });

export function patchJob(j: Job, p: Partial<Pick<Job, 'title' | 'orderNo' | 'note'>>, now?: Date): Job {
  const t = touch({ ...j, ...p }, now);
  return { ...t, editedAt: t.updatedAt };
}

// Когда последний раз правили поля объекта (у старых записей поля editedAt нет — берём updatedAt)
export const jobEditedAt = (j: Job): string => j.editedAt || j.updatedAt || j.createdAt;

export function addPhotos(j: Job, photos: JobPhoto[], now?: Date): Job {
  const room = Math.max(0, PHOTOS_MAX - j.photos.length);
  return touch({ ...j, photos: [...j.photos, ...photos.slice(0, room)] }, now);
}

export function removePhoto(j: Job, photoId: string, now?: Date): Job {
  const removed = [...(j.removedPhotos ?? []).filter(id => id !== photoId), photoId].slice(-REMOVED_MAX);
  return touch({ ...j, photos: j.photos.filter(p => p.id !== photoId), removedPhotos: removed }, now);
}

// Объекты списка: свежие сверху
export const sortJobs = (jobs: Job[]): Job[] => [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export function upsertJob(jobs: Job[], j: Job): Job[] {
  const i = jobs.findIndex(x => x.id === j.id);
  return i < 0 ? [j, ...jobs] : jobs.map(x => (x.id === j.id ? j : x));
}

// Нормализация того, что прочитали из хранилища: битые записи отбрасываем, а не роняем экран.
// Незнакомые поля сохраняются как есть: их могла записать более новая версия «Формана» (например, адрес),
// и сохранение этим кодом не должно их стирать.
export function normalizeJobs(raw: unknown): Job[] {
  if (!Array.isArray(raw)) return [];
  const out: Job[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue;
    const { example, editedAt, removedPhotos, ...j } = x as Partial<Job> & Record<string, unknown>;
    if (typeof j.id !== 'string' || typeof j.title !== 'string' || typeof j.createdAt !== 'string') continue;
    out.push({
      ...j,
      id: j.id,
      title: j.title,
      orderNo: typeof j.orderNo === 'string' ? j.orderNo : '',
      note: typeof j.note === 'string' ? j.note : '',
      createdAt: j.createdAt,
      updatedAt: typeof j.updatedAt === 'string' ? j.updatedAt : j.createdAt,
      ...(typeof editedAt === 'string' ? { editedAt } : {}),
      photos: Array.isArray(j.photos)
        ? j.photos.filter(p => p && typeof p === 'object' && typeof p.id === 'string' && (p.kind === 'photo' || p.kind === 'order'))
        : [],
      ...(Array.isArray(removedPhotos) ? { removedPhotos: removedPhotos.filter(id => typeof id === 'string').slice(-REMOVED_MAX) } : {}),
      ...(example ? { example: true } : {}),
    });
  }
  return out;
}

export type JobProgress = {
  photos: number;
  orders: number;
  itemsOk: number;
  itemsBad: number;
  items: number;
  questionsOpen: number;
  checksDone: number;
  checksTotal: number;
  steps: { key: 'job' | 'photos' | 'truck' | 'phases'; label: string; done: boolean }[];
};

// Прогресс объекта для карточки в списке и для «Итога». sum — результат summarize() из work-model.
export function jobProgress(
  j: Job,
  sum: { items: number; ok: number; bad: number; questionsOpen: number; checksDone: number; checksTotal: number } | null,
): JobProgress {
  const photos = j.photos.filter(p => p.kind === 'photo').length;
  const orders = j.photos.filter(p => p.kind === 'order' && !p.sample).length; // вымышленный пример — не заказ
  const s = sum ?? { items: 0, ok: 0, bad: 0, questionsOpen: 0, checksDone: 0, checksTotal: 0 };
  return {
    photos,
    orders,
    itemsOk: s.ok,
    itemsBad: s.bad,
    items: s.items,
    questionsOpen: s.questionsOpen,
    checksDone: s.checksDone,
    checksTotal: s.checksTotal,
    steps: [
      { key: 'job', label: 'Объект', done: j.title.trim().length >= TITLE_MIN },
      { key: 'photos', label: 'Фото и заказ', done: photos > 0 && orders > 0 },
      { key: 'truck', label: 'Сверка', done: s.items > 0 && s.ok + s.bad === s.items },
      { key: 'phases', label: 'Этапы', done: s.checksTotal > 0 && s.checksDone === s.checksTotal },
    ],
  };
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);

// Шапка отчёта объекта; дальше к ней приклеивается отчёт «Работы» (buildWorkReport)
export function buildJobHeader(j: Job, now: Date): string {
  const p = j.photos.filter(x => x.kind === 'photo');
  const o = j.photos.filter(x => x.kind === 'order' && !x.sample);
  const samples = j.photos.filter(x => x.kind === 'order' && x.sample);
  return [
    `ОБЪЕКТ: ${j.title}${j.example ? ' (пример, вымышленные данные)' : ''}`,
    `№ заказа: ${j.orderNo || 'не указан'}`,
    `Создан: ${localTime(j.createdAt)} · отчёт: ${localTime(now.toISOString())}`,
    j.note ? `Заметка к объекту: ${j.note}` : '',
    '',
    `Фото с объекта: ${p.length}${p.length ? ' — ' + p.map(x => `${x.name} (${localTime(x.addedAt)}, ${kb(x.bytes)})`).join('; ') : ''}`,
    `Скрины заказа: ${o.length}${o.length ? ' — ' + o.map(x => `${x.name} (${localTime(x.addedAt)})`).join('; ') : ''}`,
    ...(samples.length ? [`Пример скрина заказа (вымышленный, для проверки разбора; не настоящий заказ): ${samples.length}`] : []),
    'Сами фото — в сообщении вместе с этим отчётом (кнопка «Отправить отчёт с фото») или в телефоне, где их добавили.',
    '',
  ].filter((line, k, arr) => !(line === '' && arr[k - 1] === '')).join('\n');
}

// Имя файла отчёта — только латиница и цифры: с кириллицей Chromium сохранял файл как «download»
export function reportFileName(j: Job, now: Date): string {
  const order = j.orderNo.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const t = `${localDay(now)}-${p2(now.getHours())}${p2(now.getMinutes())}`;
  return `forman-otchet${order ? '-' + order : ''}-${t}.txt`;
}
