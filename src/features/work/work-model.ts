// Рабочий режим смены (перенос из веб-пилота dot «Форман · единый модуль 0.3», страница /work):
// сверка трака, 5 вопросов, этапы, бригада, заметки, текстовый отчёт.
// Документ тот же, что пишет импорт пилота: коллекция 'work_v03' (в базе fm_work_v03), id = job.
// Файл без React Native — логику проверяет tests/work-model.test.mjs в Node.
// Только типы: файл должен грузиться в Node без сборщика (значения импорта — ниже, как в import-v03.ts).
import type { V03Item, V03Phase, V03Question, V03Team, WorkV03Doc } from './import-v03';

const V03_JOB = 'DEMO-01'; // = V03_JOB в import-v03.ts (пилот принимает только эту смену)

// Шаблон этапов — как в пилоте (пилот при восстановлении всегда берёт свой шаблон)
export const WORK_PHASES: V03Phase[] = [
  { id: 'morning', title: 'До выезда', checks: [['scope', 'Scope и вопросы просмотрены'], ['stock', 'Выдача и фактический комплект сверены'], ['kits', 'Наборы и недостачи записаны']] },
  { id: 'start', title: 'Перед запуском', checks: [['hold', 'Незакрытые технические вопросы переданы ответственному'], ['oem', 'Проверки по документации конкретного оборудования выполнены и записаны']] },
  { id: 'finish', title: 'Сдача', checks: [['tests', 'Результаты испытаний записаны, замечания не скрыты'], ['photos', 'Фото после и уборка выполнены'], ['restock', 'Расход и пополнение трака записаны']] },
];

const SEED_ITEMS: [string, string, number | null, string, string][] = [
  ['furnace', 'Furnace · условная модель F-01', 1, 'шт.', 'Вымышленная модель; в реальной смене требуется полная фактическая маркировка.'],
  ['thermostat', 'Термостат · условная модель T-01', 1, 'шт.', 'Условная запись. Совместимость оборудования не подтверждена.'],
  ['filter', 'Filter base', null, 'комплект', 'Входит в scope. Размер и состав не указаны.'],
  ['gas', 'Gas valve', null, 'комплект', 'Уточнить, какой именно узел и объём замены.'],
  ['flue', 'Flue pipe', null, 'комплект', 'Диаметр, длина, фитинги и объём не указаны.'],
  ['plenum', 'Переделка supply plenum', null, 'комплект', 'Материалы и размеры определить по фактическим замерам.'],
  ['registers', 'Bar type supply/return registers', 6, 'шт.', 'Нужны размеры и разделение supply / return.'],
];

const SEED_QUESTIONS: [string, string][] = [
  ['q1', 'Размеры шести решёток и какие из них supply / return'],
  ['q2', 'Filter base, gas valve, flue и plenum: точный состав и размеры'],
  ['q3', 'Уточнить причину предупреждающего тега до зависимых работ'],
  ['q4', 'Подтвердить применимые требования permit / инспекции у ответственного'],
  ['q5', 'Согласовать окно прибытия и ориентир завершения отдельно'],
];

export const TEAM_MAX = 8; // = V03_LIMITS.team в import-v03.ts

export function seedWork(): WorkV03Doc {
  return {
    kind: 'forman-work-v03',
    source: 'forman',
    schema: 1,
    job: V03_JOB,
    updated: null,
    importedAt: null,
    items: SEED_ITEMS.map(([id, name, required, unit, hint]): V03Item => ({
      id, name, required, unit, source: '', hint, ordered: '', actual: '', status: 'unknown', location: '', note: '',
    })),
    questions: SEED_QUESTIONS.map(([id, text]): V03Question => ({ id, text, source: '', answer: '', resolved: false })),
    team: [],
    phases: WORK_PHASES.map(p => ({ ...p, checks: p.checks.map(c => [c[0], c[1]] as [string, string]) })),
    checks: {},
    notes: '',
    photosIncluded: false,
  };
}

// Документ из базы → рабочий вид. Чужое/битое не принимаем (вернётся null — экран возьмёт шаблон).
export function normalizeWork(d: unknown): WorkV03Doc | null {
  const x = d as Partial<WorkV03Doc> | null;
  if (!x || typeof x !== 'object' || x.kind !== 'forman-work-v03' || x.schema !== 1) return null;
  if (!Array.isArray(x.items) || !Array.isArray(x.questions) || typeof x.notes !== 'string') return null;
  const checks: Record<string, boolean> = {};
  if (x.checks && typeof x.checks === 'object') for (const [k, v] of Object.entries(x.checks)) if (typeof v === 'boolean') checks[k] = v;
  return {
    ...seedWork(),
    ...x,
    team: Array.isArray(x.team) ? x.team.slice(0, TEAM_MAX) : [],
    phases: seedWork().phases, // как в пилоте: этапы всегда из шаблона
    checks,
  } as WorkV03Doc;
}

// Число из поля («», null, текст) — как quantity() в пилоте
export function quantity(v: unknown): number | null {
  return v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
}

export type Verdict = { kind: 'ok' | 'bad' | 'info'; text: string };

// Вердикт по позиции — те же правила и тот же порядок, что verdict() в пилоте
export function verdict(i: V03Item): Verdict {
  const actual = quantity(i.actual), required = quantity(i.required), ordered = quantity(i.ordered);
  if (i.status === 'missing') return { kind: 'bad', text: 'Не хватает · отмечено вручную' };
  if (required !== null && actual !== null && actual < required) return { kind: 'bad', text: `Не хватает: ${required - actual} ${i.unit}` };
  if (required !== null && ordered !== null && ordered < required) return { kind: 'bad', text: 'В заказе меньше требуемого' };
  if (i.status === 'present' && actual === null) return { kind: 'info', text: 'Указано «есть», но количество не записано' };
  if (i.status === 'present' && required === null) return { kind: 'info', text: 'Есть · необходимое количество ещё неизвестно' };
  if (i.status === 'present' && actual !== null && required !== null && actual >= required && ordered !== null && ordered >= required)
    return { kind: 'ok', text: 'Сверено вручную · по твоим отметкам' };
  return { kind: 'info', text: 'Не проверено / неполные данные' };
}

export type WorkSummary = { items: number; ok: number; bad: number; questionsOpen: number; checksDone: number; checksTotal: number; teamBlocked: number };

export function summarize(d: WorkV03Doc): WorkSummary {
  const v = d.items.map(verdict);
  const all = d.phases.flatMap(p => p.checks.map(c => c[0]));
  return {
    items: d.items.length,
    ok: v.filter(x => x.kind === 'ok').length,
    bad: v.filter(x => x.kind === 'bad').length,
    questionsOpen: d.questions.filter(q => !q.resolved).length,
    checksDone: all.filter(id => d.checks[id]).length,
    checksTotal: all.length,
    teamBlocked: d.team.filter(t => t.status === 'blocked').length,
  };
}

const show = (v: unknown) => (v === null || v === '' || v === undefined ? '?' : String(v));
const teamState = (t: V03Team) => (t.status === 'done' ? 'Подтверждено пользователем' : t.status === 'blocked' ? 'СТОП' : 'В работе');

// Текст отчёта — тот же порядок разделов, что кнопка «Отчёт» в пилоте
export function buildWorkReport(d: WorkV03Doc, now: Date, label?: string): string {
  return [
    `Личная сверка ${label ?? d.job} · ${now.toLocaleString('ru-RU')}`,
    'Отметки пользователя, не независимый допуск к запуску.',
    '',
    ...d.items.map(i =>
      `${i.name}: требуется ${show(i.required)}, заказано ${show(i.ordered)}, в траке ${show(i.actual)}; ${verdict(i).text}. ` +
      `${i.location ? 'Место: ' + i.location + '. ' : ''}${i.note}`.trimEnd()),
    '',
    'Вопросы:',
    ...d.questions.map(q => `${q.resolved ? 'УТОЧНЕНО' : 'ОТКРЫТО'}: ${q.text}. ${q.answer}`.trimEnd()),
    '',
    'Этапы:',
    ...d.phases.flatMap(p => [p.title, ...p.checks.map(([id, t]) => `${d.checks[id] ? 'Отмечено' : 'Не отмечено'}: ${t}`)]),
    '',
    'Бригада / передача готовности:',
    ...d.team.map(t => `${t.role || 'Роль не назначена'}: ${t.task || 'Задача не записана'}; ${teamState(t)}. ${t.next}`.trimEnd()),
    '',
    'Заметки:',
    d.notes,
  ].join('\n');
}

// Обновления документа (без мутаций — для React-состояния)
export const setItem = (d: WorkV03Doc, id: string, patch: Partial<V03Item>): WorkV03Doc =>
  ({ ...d, items: d.items.map(i => (i.id === id ? { ...i, ...patch } : i)) });

export function setQuestion(d: WorkV03Doc, id: string, patch: Partial<V03Question>): WorkV03Doc {
  return {
    ...d,
    questions: d.questions.map(q => {
      if (q.id !== id) return q;
      const next = { ...q, ...patch };
      if (!next.answer.trim()) next.resolved = false; // как в пилоте: без ответа «уточнено» снимается
      return next;
    }),
  };
}

export const setCheck = (d: WorkV03Doc, id: string, value: boolean): WorkV03Doc => ({ ...d, checks: { ...d.checks, [id]: value } });

export const addTeam = (d: WorkV03Doc): WorkV03Doc =>
  d.team.length >= TEAM_MAX ? d : { ...d, team: [...d.team, { role: '', task: '', status: 'open', next: '' }] };

export const setTeam = (d: WorkV03Doc, k: number, patch: Partial<V03Team>): WorkV03Doc =>
  ({ ...d, team: d.team.map((t, n) => (n === k ? { ...t, ...patch } : t)) });

export const removeTeam = (d: WorkV03Doc, k: number): WorkV03Doc => ({ ...d, team: d.team.filter((_, n) => n !== k) });

// Свои позиции в сверке (объекты «Формана»): добавить и убрать строку
export const ITEMS_MAX = 40;

export function addItem(d: WorkV03Doc, name: string, required: number | null, unit: string, id: string): WorkV03Doc {
  const n = name.trim();
  if (!n || d.items.length >= ITEMS_MAX) return d;
  const item: V03Item = { id, name: n.slice(0, 80), required, unit: unit.trim() || 'шт.', source: 'бригадир', hint: '', ordered: '', actual: '', status: 'unknown', location: '', note: '' };
  return { ...d, items: [...d.items, item] };
}

export const removeItem = (d: WorkV03Doc, id: string): WorkV03Doc => ({ ...d, items: d.items.filter(i => i.id !== id) });

// Свои вопросы до работы (объекты «Формана»)
export const QUESTIONS_MAX = 30;

export function addQuestion(d: WorkV03Doc, text: string, id: string): WorkV03Doc {
  const t = text.trim();
  if (!t || d.questions.length >= QUESTIONS_MAX) return d;
  return { ...d, questions: [...d.questions, { id, text: t.slice(0, 200), source: 'бригадир', answer: '', resolved: false }] };
}

export const removeQuestion = (d: WorkV03Doc, id: string): WorkV03Doc => ({ ...d, questions: d.questions.filter(q => q.id !== id) });
