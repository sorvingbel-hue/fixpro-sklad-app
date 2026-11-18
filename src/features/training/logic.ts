// Логика тренажёра без React: прогресс, проверка ответа, перемешивание, практика 1, текст отчёта.
import { fill, type Lesson, type TrainingContent } from './content';

export type Practice = { stock: boolean; hold: boolean; report: boolean };
export const PRACTICE_KEYS: (keyof Practice)[] = ['stock', 'hold', 'report'];

// Прогресс учебной смены. answers хранят id варианта (не позицию: варианты перемешиваются)
export type Progress = {
  schema: 2;
  index: number;                 // открытый шаг
  answers: (string | null)[];    // последний выбранный вариант по шагам
  passed: boolean[];             // шаг разобран (выбран верный ответ)
  first: (boolean | null)[];     // верно ли с первой попытки
  tries: number[];
  practice: Practice;
  updatedAt: string | null;      // когда менялся (ISO)
};

export function initialProgress(n: number, practice?: Practice): Progress {
  return {
    schema: 2,
    index: 0,
    answers: Array(n).fill(null),
    passed: Array(n).fill(false),
    first: Array(n).fill(null),
    tries: Array(n).fill(0),
    practice: practice ? { ...practice } : { stock: false, hold: false, report: false },
    updatedAt: null,
  };
}

// Проверка сохранённого прогресса (формат мог устареть или испортиться)
export function isValidProgress(s: unknown, lessons: Lesson[]): s is Progress {
  if (!s || typeof s !== 'object') return false;
  const p = s as Progress;
  const n = lessons.length;
  const arr = (a: unknown) => Array.isArray(a) && a.length === n;
  return (
    p.schema === 2 &&
    Number.isInteger(p.index) && p.index >= 0 && p.index < n &&
    arr(p.answers) && arr(p.passed) && arr(p.first) && arr(p.tries) &&
    p.answers.every((x, i) => x === null || lessons[i].options.some(o => o.id === x)) &&
    p.passed.every((x, i) => typeof x === 'boolean' && (!x || p.answers[i] === lessons[i].correct)) &&
    p.first.every(x => x === null || typeof x === 'boolean') &&
    p.tries.every(x => Number.isInteger(x) && x >= 0) &&
    !!p.practice && PRACTICE_KEYS.every(k => typeof p.practice[k] === 'boolean')
  );
}

const stamp = (p: Progress): Progress => ({ ...p, updatedAt: new Date().toISOString() });

// Ответ на шаг index вариантом optionId
export function answerStep(s: Progress, lessons: Lesson[], index: number, optionId: string): Progress {
  const l = lessons[index];
  if (!l || !l.options.some(o => o.id === optionId)) return s;
  const good = optionId === l.correct;
  const next: Progress = {
    ...s,
    answers: s.answers.slice(),
    passed: s.passed.slice(),
    first: s.first.slice(),
    tries: s.tries.slice(),
  };
  next.answers[index] = optionId;
  next.tries[index] += 1;
  if (next.first[index] === null) next.first[index] = good;
  next.passed[index] = good;
  return stamp(next);
}

export const goStep = (s: Progress, index: number): Progress => stamp({ ...s, index });
export const setPractice = (s: Progress, key: keyof Practice, ok: boolean): Progress =>
  stamp({ ...s, practice: { ...s.practice, [key]: ok } });
export const resetPractice = (s: Progress): Progress =>
  stamp({ ...s, practice: { stock: false, hold: false, report: false } });
// Сброс учебной смены: практики остаются
export const resetScenario = (s: Progress, n: number): Progress => stamp(initialProgress(n, s.practice));

export const countPassed = (s: Progress) => s.passed.filter(Boolean).length;
export const countFirst = (s: Progress) => s.first.filter(x => x === true).length;
export const countPractice = (s: Progress) => PRACTICE_KEYS.filter(k => s.practice[k]).length;

// Шаг закрыт, пока не разобран предыдущий (как в веб-тренажёре)
export const isLocked = (s: Progress, i: number) => i > 0 && !s.passed[i - 1] && i > s.index;

// Случайный порядок (Фишер–Йетс). Вызывается при каждом открытии шага и после сброса
export function shuffled<T>(items: readonly T[], rnd: () => number = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Практика 1: «требуется / факт / проверено ли физически»
export type StockStatus = 'notChecked' | 'needInt' | 'short' | 'match' | 'over';
export function assessStock(required: number, actual: number, confirmed: boolean): { status: StockStatus; missing: number | null } {
  if (!confirmed) return { status: 'notChecked', missing: null };
  if (!Number.isInteger(required) || !Number.isInteger(actual) || required < 0 || actual < 0) return { status: 'needInt', missing: null };
  return { status: actual < required ? 'short' : actual === required ? 'match' : 'over', missing: Math.max(0, required - actual) };
}

// Ответ на практику 1. «Верно» — только при числе 4 с отметкой проверки; иначе текст начинается с «Проверь ещё раз:»
export function stockFeedback(value: string, confirmed: boolean, c: TrainingContent['practice']['stock']): { ok: boolean; text: string } {
  const v = value.trim().replace(',', '.');
  const num = v === '' ? NaN : Number(v);
  const ok = confirmed && v !== '' && num === c.expected;
  if (ok) return { ok, text: c.good };
  if (!confirmed) return { ok, text: c.retry + ' ' + c.notSeen };
  const r = assessStock(c.required, num, confirmed);
  if (r.missing === null) return { ok, text: c.retry + ' ' + c.badNumber };
  return { ok, text: c.retry + ' ' + fill(c.mismatch, { status: c.statuses[r.status] }) };
}

// Дата и время по-русски (ДД.ММ.ГГГГ, ЧЧ:ММ). Без Intl — одинаково на телефоне и в браузере
export function formatDateRu(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fileDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Текст учебного отчёта (для скачивания или «Поделиться»)
export function buildReport(s: Progress, c: TrainingContent, now: Date): string {
  const r = c.report;
  const total = c.lessons.length;
  const lines = [
    r.title,
    r.disclaimer,
    fill(r.date, { date: formatDateRu(now) }),
    fill(r.done, { done: countPassed(s), total }),
    fill(r.firstTry, { n: countFirst(s), total }),
    '',
  ];
  c.lessons.forEach((l, i) => {
    lines.push(fill(r.line, { n: i + 1, title: l.title, status: s.passed[i] ? r.passed : r.notDone, tries: s.tries[i] }));
    if (s.passed[i]) lines.push(r.remember + l.take);
  });
  lines.push('', fill(r.practiceTitle, { n: countPractice(s) }));
  const titles = { stock: c.practice.stock.title, hold: c.practice.hold.title, report: c.practice.report.title };
  for (const k of PRACTICE_KEYS) lines.push(`${titles[k]}: ${s.practice[k] ? r.practiceDone : r.practiceNotDone}`);
  return lines.join('\n') + '\n';
}
