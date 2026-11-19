// ТЕСТОВЫЙ импорт из веб-пилота dot «Форман · единый модуль 0.3» (страница /work).
//
// Пилот хранит смену в localStorage браузера под ключом 'foreman-demo01-v1' и отдаёт её
// кнопками «Скачать резервную копию JSON» / «Показать текущий JSON». Здесь этот JSON:
//   1) проверяется теми же правилами, что функция valid() в app.js пилота (validV03),
//      плюс ограничения размера (V03_LIMITS);
//   2) превращается в документ синхронизации «Формана»: коллекция 'fm_work_v03' в базе
//      (в приложении — 'work_v03', префикс fm_ добавляет sync.ts), id документа = job;
//   3) importV03(json) показывает предпросмотр и сохраняет документ через sync.ts:
//      сначала на устройство, затем (если команда подключена) в базу.
//
// Фото пилота лежат отдельно, в IndexedDB 'foreman-private-photos-v1' того браузера,
// и в JSON не входят — значит, сюда тоже не попадают.
//
// Файл без импорта React Native: его же проверяет tests/import-v03.test.mjs в Node.
import type { DocData, SaveResult } from '@/lib/sync-core';

export const V03_COL = 'work_v03';          // имя для saveDoc/getDoc в приложении
export const V03_REMOTE_COL = 'fm_work_v03'; // так коллекция называется в базе
export const V03_JOB = 'DEMO-01';             // пилот принимает только эту смену

export const V03_LIMITS = {
  jsonChars: 2_000_000, // как в пилоте: «нужен JSON этой смены, до 2 МБ»
  docBytes: 2_000_000,  // готовый документ в UTF-8
  items: 200,           // как в пилоте
  team: 8,              // как в пилоте
  questions: 5,         // в пилоте ровно 5 вопросов q1…q5
  str: 20_000,          // одно текстовое поле (название, ответ, замечание…)
  notes: 200_000,       // заметки смены
  checks: 200,          // отметки этапов
  phases: 20,           // шаблон этапов (пилот при восстановлении всё равно берёт свой)
} as const;

type Scalar = string | number | null;
export type V03Item = {
  id: string; name: string; required: Scalar; unit: string; source: string; hint: string;
  ordered: Scalar; actual: Scalar; status: 'unknown' | 'present' | 'missing'; location: string; note: string;
};
export type V03Question = { id: string; text: string; source: string; answer: string; resolved: boolean };
export type V03Team = { role: string; task: string; next: string; status: 'open' | 'blocked' | 'done' };
export type V03Phase = { id: string; title: string; checks: [string, string][] };

// Документ «Формана» (коллекция fm_work_v03, id = job)
export type WorkV03Doc = DocData & {
  kind: 'forman-work-v03';
  source: 'dot-pilot-0.3' | 'forman'; // импорт из пилота или смена, начатая в «Формане»
  schema: 1;
  job: string;
  updated: string | null;
  importedAt: string | null;          // null — смена создана в «Формане», не импортирована
  items: V03Item[];
  questions: V03Question[];
  team: V03Team[];
  phases: V03Phase[];
  checks: Record<string, boolean>;
  notes: string;
  photosIncluded: false; // фото пилота в JSON не входят
};

export type V03Preview = {
  job: string;
  updated: string | null;
  items: number;
  itemsFilled: number; // позиции, где записано количество, место или замечание
  questions: number;
  answered: number;
  resolved: number;
  team: number;
  checks: number;
  notesChars: number;
  jsonChars: number;
  docBytes: number;
  ignoredKeys: string[]; // поля верхнего уровня, которые не переносятся
};

export type V03Reason = 'empty' | 'too_big' | 'not_json' | 'invalid' | 'limits';
export type V03Check =
  | { ok: true; preview: V03Preview; doc: WorkV03Doc }
  | { ok: false; reason: V03Reason; message: string; problems: string[] };

export type V03Saver = (col: string, id: string, data: DocData) => Promise<SaveResult>;
export type V03ImportResult =
  | { ok: true; preview: V03Preview; doc: WorkV03Doc; synced: boolean }
  | { ok: false; reason: V03Reason | 'save'; message: string; problems: string[]; preview?: V03Preview };

const MESSAGES: Record<V03Reason | 'save', string> = {
  empty: 'Вставьте JSON из пилота.',
  too_big: 'JSON слишком большой: пилот и импорт принимают до 2 МБ.',
  not_json: 'Это не JSON. Скопируйте текст из «Показать текущий JSON» целиком.',
  invalid: 'JSON не прошёл проверку пилота v0.3 (нужна смена DEMO-01, схема 1).',
  limits: 'JSON прошёл проверку пилота, но превышает ограничения импорта.',
  save: 'Не удалось сохранить на устройстве. Ничего не изменено.',
};

const KNOWN_KEYS = ['schema', 'job', 'updated', 'items', 'questions', 'phases', 'checks', 'notes', 'team'];
const ITEM_STATUS = ['unknown', 'present', 'missing'];
const TEAM_STATUS = ['open', 'blocked', 'done'];


// Правила valid() из app.js пилота v0.3 — те же условия и тот же порядок, разбиты на части,
// чтобы экран мог назвать причину отказа. Совпадение с оригиналом проверяет tests/import-v03.test.mjs.
const scalar = (v: unknown) => v === null || typeof v === 'string' || typeof v === 'number';
const str = (v: unknown) => typeof v === 'string';
const teamOk = (t: any) => !!(t && str(t.role) && str(t.task) && str(t.next) && TEAM_STATUS.includes(t.status));
const itemOk = (i: any) => !!(i && str(i.id) && str(i.name) && str(i.unit) && str(i.source) && str(i.hint) && str(i.note) && str(i.location) &&
  scalar(i.required) && scalar(i.actual) && scalar(i.ordered) && ITEM_STATUS.includes(i.status));
const questionOk = (q: any, k: number) => !!(q && q.id === 'q' + (k + 1) && str(q.text) && str(q.source) && str(q.answer) &&
  typeof q.resolved === 'boolean' && (!q.resolved || q.answer.trim()));
const uniqueIds = (items: any[]) => new Set(items.map((i: any) => i?.id)).size === items.length;
const checksOk = (c: any) => !!(c && typeof c === 'object' && !Array.isArray(c) && Object.values(c).every(v => typeof v === 'boolean'));

export function validV03(s: any): boolean {
  return !!(s && s.schema === 1 &&
    (!s.team || (Array.isArray(s.team) && s.team.length <= 8 && s.team.every(teamOk))) &&
    s.job === 'DEMO-01' && Array.isArray(s.items) && s.items.length <= 200 && uniqueIds(s.items) && s.items.every(itemOk) &&
    Array.isArray(s.questions) && s.questions.length === 5 && s.questions.every(questionOk) &&
    str(s.notes) && checksOk(s.checks));
}

// Понятные причины отказа для экрана (сама проверка — validV03)
function explain(s: any): string[] {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return ['ожидается объект смены'];
  const p: string[] = [];
  if (s.schema !== 1) p.push('schema должна быть 1');
  if (s.job !== V03_JOB) p.push(`job должен быть ${V03_JOB}`);
  if (!Array.isArray(s.items)) p.push('нет списка items');
  else {
    if (s.items.length > 200) p.push('позиций больше 200');
    if (!uniqueIds(s.items)) p.push('повторяются id позиций');
    const bad = s.items.findIndex((i: any) => !itemOk(i));
    if (bad >= 0) p.push(`позиция №${bad + 1} в неверном формате`);
  }
  if (!Array.isArray(s.questions) || s.questions.length !== 5) p.push('вопросов должно быть ровно 5 (q1…q5)');
  else s.questions.forEach((q: any, k: number) => {
    if (questionOk(q, k)) return;
    p.push(q && q.resolved === true && str(q.answer) && !q.answer.trim() ? `вопрос №${k + 1} отмечен уточнённым без ответа` : `вопрос №${k + 1} в неверном формате`);
  });
  if (s.team && (!Array.isArray(s.team) || s.team.length > 8 || !s.team.every(teamOk))) p.push('team: не больше 8 назначений, состояние open / blocked / done');
  if (!str(s.notes)) p.push('notes должно быть текстом');
  if (!checksOk(s.checks)) p.push('checks: объект с отметками да/нет');
  return p.length ? p.slice(0, 6) : ['формат не совпадает с пилотом v0.3'];
}

// Длина строки в UTF-8 (без TextEncoder — одинаково в Node, Hermes и браузере)
function utf8Bytes(text: string): number {
  let n = 0;
  for (let k = 0; k < text.length; k++) {
    const c = text.charCodeAt(k);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; k++; }
    else n += 3;
  }
  return n;
}

function validPhases(v: any): v is V03Phase[] {
  return Array.isArray(v) && v.length <= V03_LIMITS.phases && v.every((p: any) =>
    p && typeof p.id === 'string' && typeof p.title === 'string' && Array.isArray(p.checks) && p.checks.length <= 50 &&
    p.checks.every((c: any) => Array.isArray(c) && c.length === 2 && typeof c[0] === 'string' && typeof c[1] === 'string'));
}

// Ограничения размера сверх правил пилота
function limitProblems(s: any): string[] {
  const p: string[] = [];
  const long = (v: unknown) => typeof v === 'string' && v.length > V03_LIMITS.str;
  s.items.forEach((i: any, k: number) => {
    if (['id', 'name', 'unit', 'source', 'hint', 'note', 'location', 'required', 'ordered', 'actual'].some(f => long(i[f]))) p.push(`позиция №${k + 1}: текст длиннее ${V03_LIMITS.str} символов`);
  });
  s.questions.forEach((q: any, k: number) => {
    if (['text', 'source', 'answer'].some(f => long(q[f]))) p.push(`вопрос №${k + 1}: текст длиннее ${V03_LIMITS.str} символов`);
  });
  (Array.isArray(s.team) ? s.team : []).forEach((t: any, k: number) => {
    if (['role', 'task', 'next'].some(f => long(t[f]))) p.push(`назначение №${k + 1}: текст длиннее ${V03_LIMITS.str} символов`);
  });
  if (s.notes.length > V03_LIMITS.notes) p.push(`заметки длиннее ${V03_LIMITS.notes} символов`);
  const keys = Object.keys(s.checks);
  if (keys.length > V03_LIMITS.checks) p.push(`отметок этапов больше ${V03_LIMITS.checks}`);
  if (keys.some(k => k === '__proto__' || k.length > 100)) p.push('недопустимый ключ в checks');
  if (s.updated != null && (typeof s.updated !== 'string' || s.updated.length > 100)) p.push('updated: ожидается дата-строка');
  return p.slice(0, 6);
}

// Пилот → документ «Формана». Берём только известные поля, создаём новые объекты.
function toDoc(s: any, importedAt: string): WorkV03Doc {
  const checks: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(s.checks)) checks[k] = v as boolean;
  return {
    kind: 'forman-work-v03',
    source: 'dot-pilot-0.3',
    schema: 1,
    job: s.job,
    updated: typeof s.updated === 'string' ? s.updated : null,
    importedAt,
    items: s.items.map((i: any): V03Item => ({
      id: i.id, name: i.name, required: i.required, unit: i.unit, source: i.source, hint: i.hint,
      ordered: i.ordered, actual: i.actual, status: i.status, location: i.location, note: i.note,
    })),
    questions: s.questions.map((q: any): V03Question => ({ id: q.id, text: q.text, source: q.source, answer: q.answer, resolved: q.resolved })),
    team: (Array.isArray(s.team) ? s.team : []).map((t: any): V03Team => ({ role: t.role, task: t.task, next: t.next, status: t.status })),
    phases: validPhases(s.phases) ? s.phases.map((p: V03Phase) => ({ id: p.id, title: p.title, checks: p.checks.map(c => [c[0], c[1]] as [string, string]) })) : [],
    checks,
    notes: s.notes,
    photosIncluded: false,
  };
}

const fail = (reason: V03Reason, problems: string[] = []): V03Check => ({ ok: false, reason, message: MESSAGES[reason], problems });

// Проверка и предпросмотр без сохранения. Не бросает ошибок ни на каком входе.
export function checkV03(input: unknown, now: Date = new Date()): V03Check {
  try {
    let text: string;
    let s: any;
    if (typeof input === 'string') {
      text = input;
      if (!text.trim()) return fail('empty');
      if (text.length > V03_LIMITS.jsonChars) return fail('too_big'); // до разбора, как в пилоте
      try { s = JSON.parse(text); } catch { return fail('not_json'); }
    } else {
      if (input == null) return fail('empty');
      try { text = JSON.stringify(input) ?? ''; } catch { return fail('not_json'); }
      if (text.length > V03_LIMITS.jsonChars) return fail('too_big');
      s = JSON.parse(text);
    }
    if (!validV03(s)) return fail('invalid', explain(s));
    const lim = limitProblems(s);
    if (lim.length) return fail('limits', lim);
    const doc = toDoc(s, now.toISOString());
    const docBytes = utf8Bytes(JSON.stringify(doc));
    if (docBytes > V03_LIMITS.docBytes) return fail('too_big');
    const ignoredKeys = Object.keys(s).filter(k => !KNOWN_KEYS.includes(k));
    // шаблон этапов в неожиданном виде не переносим — пилот при восстановлении всё равно берёт свой
    if (s.phases !== undefined && !validPhases(s.phases)) ignoredKeys.push('phases');
    const filled = (v: Scalar) => v !== null && v !== '';
    return {
      ok: true,
      doc,
      preview: {
        job: doc.job,
        updated: doc.updated,
        items: doc.items.length,
        itemsFilled: doc.items.filter(i => filled(i.actual) || filled(i.ordered) || i.location || i.note).length,
        questions: doc.questions.length,
        answered: doc.questions.filter(q => q.answer.trim()).length,
        resolved: doc.questions.filter(q => q.resolved).length,
        team: doc.team.length,
        checks: Object.keys(doc.checks).length,
        notesChars: doc.notes.length,
        jsonChars: text.length,
        docBytes,
        ignoredKeys,
      },
    };
  } catch {
    return fail('invalid');
  }
}

// Импорт: проверка + предпросмотр + сохранение через sync.ts (на устройство, затем в базу).
// save можно подменить (тест передаёт клиент sync-core на временной команде). Не бросает ошибок.
export async function importV03(input: unknown, save?: V03Saver): Promise<V03ImportResult> {
  const check = checkV03(input);
  if (!check.ok) return check;
  try {
    const saver: V03Saver = save ?? (await import('@/lib/sync')).saveDoc;
    const r = await saver(V03_COL, check.doc.job, check.doc);
    if (!r.ok) return { ok: false, reason: 'save', message: MESSAGES.save, problems: [], preview: check.preview };
    return { ok: true, preview: check.preview, doc: check.doc, synced: r.synced };
  } catch {
    return { ok: false, reason: 'save', message: MESSAGES.save, problems: [], preview: check.preview };
  }
}
