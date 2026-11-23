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
  step?: string;       // шаг монтажа (PHOTO_STEPS[].id) или 'surprise' — фото к «Сюрпризу»
};

// «Сюрприз» на объекте: то, чего не было в заказе (гнилой пол, не тот размер, нет disconnect…) — фото + текст в офис
export type Surprise = {
  id: string;
  text: string;
  photoIds: string[];
  createdAt: string;
  sentAt?: string;     // бригадир отметил «отправлено» (или меню «Поделиться» завершилось)
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
  address?: string;    // адрес объекта «как продано» (для себя и для отчёта офису)
  surprises?: Surprise[];
};

export const TITLE_MIN = 2;
export const TITLE_MAX = 80;
export const ORDER_MAX = 40;
export const ADDRESS_MAX = 160;
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

export function patchJob(j: Job, p: Partial<Pick<Job, 'title' | 'orderNo' | 'note' | 'address' | 'surprises'>>, now?: Date): Job {
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

// Тип фото: фото объекта ↔ скрин заказа (добавили не той кнопкой). Пример скрина заказа остаётся скрином.
export function setPhotoKind(j: Job, photoId: string, kind: PhotoKind, now?: Date): Job {
  const p = j.photos.find(x => x.id === photoId);
  if (!p || p.kind === kind || p.sample) return j;
  return touch({ ...j, photos: j.photos.map(x => (x.id === photoId ? { ...x, kind } : x)) }, now);
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
        ? j.photos
          .filter(p => p && typeof p === 'object' && typeof p.id === 'string' && (p.kind === 'photo' || p.kind === 'order'))
          .map(p => (p.step === undefined || (p.kind === 'photo' && isStepId(p.step)) ? p : withoutStep(p)))
        : [],
      ...(j.surprises !== undefined ? { surprises: normalizeSurprises(j.surprises) } : {}),
      ...(j.address !== undefined ? { address: typeof j.address === 'string' ? j.address.slice(0, ADDRESS_MAX) : '' } : {}),
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
  shotsDone: number;
  shotsTotal: number;
  steps: { key: 'job' | 'photos' | 'truck' | 'shots'; label: string; done: boolean }[];
};

// Прогресс объекта для карточки в списке и для «Итога». sum — результат summarize() из work-model.
export function jobProgress(
  j: Job,
  sum: { items: number; ok: number; bad: number; unchecked?: number; questionsOpen: number; checksDone: number; checksTotal: number } | null,
): JobProgress {
  const photos = j.photos.filter(p => p.kind === 'photo').length;
  const orders = j.photos.filter(p => p.kind === 'order' && !p.sample).length; // вымышленный пример — не заказ
  const s = sum ?? { items: 0, ok: 0, bad: 0, questionsOpen: 0, checksDone: 0, checksTotal: 0 };
  const shots = stepsSummary(j);
  return {
    photos,
    orders,
    itemsOk: s.ok,
    itemsBad: s.bad,
    items: s.items,
    questionsOpen: s.questionsOpen,
    checksDone: s.checksDone,
    checksTotal: s.checksTotal,
    shotsDone: shots.done,
    shotsTotal: shots.total,
    steps: [
      { key: 'job', label: 'Объект', done: j.title.trim().length >= TITLE_MIN },
      { key: 'photos', label: 'Заказ', done: orders > 0 },
      { key: 'truck', label: 'Трак', done: s.items > 0 && (s.unchecked !== undefined ? s.unchecked === 0 : s.ok + s.bad === s.items) },
      { key: 'shots', label: 'Фото по шагам', done: shots.done === shots.total },
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

// ---------- Фото по шагам монтажа (М3) ----------
// Что офис и инспектор спрашивают чаще всего. «Сдать» показывает пустые шаги, но ничего не блокирует.
export type PhotoStep = { id: string; ru: string; en: string; hint: string };
export const PHOTO_STEPS: PhotoStep[] = [
  { id: 'before', ru: 'До начала', en: 'Before', hint: 'Старое оборудование и место работ, пока ничего не трогали' },
  { id: 'nameplate', ru: 'Шильдик нового оборудования', en: 'Nameplate (new equipment)', hint: 'Модель и серийный номер читаются' },
  { id: 'pad', ru: 'Площадка и наружный блок', en: 'Pad / outdoor unit', hint: 'Уровень, крепление, зазоры' },
  { id: 'disconnect', ru: 'Disconnect и зазор', en: 'Disconnect & clearance', hint: 'Видно расстояние до блока и рабочее место' },
  { id: 'drain', ru: 'Дренаж', en: 'Condensate drain', hint: 'Уклон, трап, насос или выход' },
  { id: 'vacuum', ru: 'Вакуум: прибор', en: 'Vacuum (gauge reading)', hint: 'Показания микрон на приборе' },
  { id: 'after', ru: 'После работ', en: 'After', hint: 'Готовая установка и чистое место' },
  { id: 'inspection', ru: 'Карта инспекции / permit', en: 'Inspection card / permit', hint: 'Если есть на объекте' },
];
export const SURPRISE_STEP = 'surprise';
const STEP_IDS = new Set([...PHOTO_STEPS.map(x => x.id), SURPRISE_STEP]);
export const isStepId = (v: unknown): v is string => typeof v === 'string' && STEP_IDS.has(v);

export const stepPhotos = (j: Job, step: string): JobPhoto[] => j.photos.filter(p => p.kind === 'photo' && p.step === step);

export function stepsSummary(j: Job): { done: number; total: number; missing: PhotoStep[] } {
  const missing = PHOTO_STEPS.filter(x => !j.photos.some(p => p.kind === 'photo' && p.step === x.id));
  return { done: PHOTO_STEPS.length - missing.length, total: PHOTO_STEPS.length, missing };
}

// Перенести фото в шаг (или убрать из шага: step = null)
export function setPhotoStep(j: Job, photoId: string, step: string | null, now?: Date): Job {
  const p = j.photos.find(x => x.id === photoId);
  if (!p || p.kind !== 'photo' || (step !== null && !isStepId(step)) || (p.step ?? null) === step) return j;
  return touch({ ...j, photos: j.photos.map(x => (x.id !== photoId ? x : step ? { ...x, step } : withoutStep(x))) }, now);
}
const withoutStep = (p: JobPhoto): JobPhoto => { const { step: _s, ...rest } = p; return rest; };

// ---------- «Сюрприз» (М4) ----------
export const SURPRISES_MAX = 30;
export const SURPRISE_TEXT_MAX = 1000;

export function addSurprise(j: Job, text: string, photoIds: string[], now: Date = new Date(), id: string = newId('sp', now)): Job {
  const t = text.trim().slice(0, SURPRISE_TEXT_MAX);
  const list = j.surprises ?? [];
  if ((!t && !photoIds.length) || list.length >= SURPRISES_MAX) return j;
  return patchJob(j, { surprises: [...list, { id, text: t, photoIds: [...photoIds], createdAt: now.toISOString() }] }, now);
}

export function markSurpriseSent(j: Job, id: string, sent: boolean, now: Date = new Date()): Job {
  const list = j.surprises ?? [];
  if (!list.some(x => x.id === id)) return j;
  return patchJob(j, { surprises: list.map(x => (x.id !== id ? x : sent ? { ...x, sentAt: now.toISOString() } : { id: x.id, text: x.text, photoIds: x.photoIds, createdAt: x.createdAt })) }, now);
}

export function removeSurprise(j: Job, id: string, now?: Date): Job {
  const list = j.surprises ?? [];
  if (!list.some(x => x.id === id)) return j;
  return patchJob(j, { surprises: list.filter(x => x.id !== id) }, now);
}

// Чистка «Сюрпризов» из хранилища или файла копии: только известные поля и простые id
const SIMPLE_ID = /^[A-Za-z0-9_-]{1,100}$/;
export function normalizeSurprises(raw: unknown): Surprise[] {
  const out: Surprise[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue;
    const r = x as Record<string, unknown>;
    if (typeof r.id !== 'string' || !SIMPLE_ID.test(r.id) || seen.has(r.id) || typeof r.createdAt !== 'string' || Number.isNaN(Date.parse(r.createdAt))) continue;
    seen.add(r.id);
    out.push({
      id: r.id,
      text: typeof r.text === 'string' ? r.text.slice(0, SURPRISE_TEXT_MAX) : '',
      photoIds: (Array.isArray(r.photoIds) ? r.photoIds : []).filter((p): p is string => typeof p === 'string' && SIMPLE_ID.test(p)).slice(0, 20),
      createdAt: new Date(Date.parse(r.createdAt)).toISOString(),
      ...(typeof r.sentAt === 'string' && !Number.isNaN(Date.parse(r.sentAt)) ? { sentAt: new Date(Date.parse(r.sentAt)).toISOString() } : {}),
    });
    if (out.length >= SURPRISES_MAX) break;
  }
  return out;
}

// ---------- Отчёт офису (М6): короткий, язык переключается (по умолчанию английский) ----------
export type ReportLang = 'en' | 'ru';
export const REPORT_LANG_DEFAULT: ReportLang = 'en';

const L = {
  en: {
    job: 'JOB', order: 'Order #', address: 'Address', none: 'not set', date: 'Report', example: ' (example, made-up data)',
    truck: 'TRUCK', truckAll: 'Everything on the order is on the truck.', truckMissing: 'Missing on the truck:', truckUnchecked: 'Not checked yet',
    truckEmpty: 'Truck check not filled in.', photos: 'PHOTOS BY STEP', photoMissing: 'no photo', other: 'Other photos',
    surprises: 'SURPRISES (not in the order)', sent: 'sent', notSent: 'NOT SENT YET', photo: 'photo', questions: 'OPEN QUESTIONS',
    notes: 'NOTES', photosAttached: 'Photos are attached to this message.', freeText: 'Notes are in the crew\'s own words.',
  },
  ru: {
    job: 'ОБЪЕКТ', order: '№ заказа', address: 'Адрес', none: 'не указан', date: 'Отчёт', example: ' (пример, вымышленные данные)',
    truck: 'ТРАК', truckAll: 'Всё по заказу в траке.', truckMissing: 'Не хватает в траке:', truckUnchecked: 'Ещё не проверено',
    truckEmpty: 'Сверка трака не заполнена.', photos: 'ФОТО ПО ШАГАМ', photoMissing: 'нет фото', other: 'Другие фото',
    surprises: 'СЮРПРИЗЫ (нет в заказе)', sent: 'отправлено', notSent: 'ЕЩЁ НЕ ОТПРАВЛЕНО', photo: 'фото', questions: 'ОТКРЫТЫЕ ВОПРОСЫ',
    notes: 'ЗАМЕТКИ', photosAttached: 'Фото приложены к этому сообщению.', freeText: '',
  },
} as const;

export type ReportTruck = { items: number; missing: string[]; unchecked: number };

export function buildFieldReport(
  j: Job,
  x: { truck: ReportTruck; openQuestions: string[]; notes: string },
  lang: ReportLang,
  now: Date,
): string {
  const t = L[lang];
  const steps = PHOTO_STEPS.map(st => {
    const n = stepPhotos(j, st.id).length;
    return `${n ? '✓' : '✗'} ${lang === 'en' ? st.en : st.ru}: ${n ? `${n} ${t.photo}` : t.photoMissing}`;
  });
  const other = j.photos.filter(p => p.kind === 'photo' && !p.step).length;
  const sp = j.surprises ?? [];
  const truck = x.truck.items === 0 ? [t.truckEmpty]
    : [
      ...(x.truck.missing.length ? [t.truckMissing, ...x.truck.missing.map(m => `• ${m}`)] : x.truck.unchecked ? [] : [t.truckAll]),
      ...(x.truck.unchecked ? [`${t.truckUnchecked}: ${x.truck.unchecked}`] : []),
    ];
  const lines = [
    `${t.job}: ${j.title}${j.example ? t.example : ''}`,
    `${t.order}: ${j.orderNo || t.none}`,
    `${t.address}: ${j.address?.trim() || t.none}`,
    `${t.date}: ${localTime(now.toISOString())}`,
    '',
    t.truck,
    ...truck,
    '',
    `${t.photos} (${PHOTO_STEPS.length - stepsSummary(j).missing.length}/${PHOTO_STEPS.length})`,
    ...steps,
    ...(other ? [`${t.other}: ${other}`] : []),
    ...(sp.length ? ['', t.surprises, ...sp.map(s => `• ${s.text || '—'}${s.photoIds.length ? ` (${s.photoIds.length} ${t.photo})` : ''} — ${s.sentAt ? `${t.sent} ${localTime(s.sentAt)}` : t.notSent}`)] : []),
    ...(x.openQuestions.length ? ['', t.questions, ...x.openQuestions.map(q => `• ${q}`)] : []),
    ...(x.notes.trim() ? ['', t.notes, x.notes.trim()] : []),
    '',
    t.photosAttached,
    ...(t.freeText && (sp.length || x.notes.trim() || x.openQuestions.length) ? [t.freeText] : []),
  ];
  return lines.join('\n');
}

// Текст сообщения «Сюрприз» для офиса
export function surpriseMessage(j: Job, s: Surprise, lang: ReportLang): string {
  return lang === 'en'
    ? [`SURPRISE on job: ${j.title}${j.address ? ` (${j.address})` : ''}`, j.orderNo ? `Order #${j.orderNo}` : '', s.text, 'Not in the order — please advise before we continue.'].filter(Boolean).join('\n')
    : [`СЮРПРИЗ на объекте: ${j.title}${j.address ? ` (${j.address})` : ''}`, j.orderNo ? `Заказ №${j.orderNo}` : '', s.text, 'Этого нет в заказе — что делаем дальше?'].filter(Boolean).join('\n');
}
