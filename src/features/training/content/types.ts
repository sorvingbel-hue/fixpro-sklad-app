// Типы содержимого тренажёра «Смена». Тексты лежат по языкам (ru.ts; позже en.ts, es.ts).
// В тексте можно выделить жирным: **слово**.

export type SourceKey = 'osha' | 'oem' | 'epa' | 'cec';
export type Link = { name: string; url: string };

// Вариант ответа. id не меняется при перемешивании; wrong — разбор, если выбран этот неверный вариант
export type LessonOption = { id: string; text: string; wrong?: string };

// Одно решение учебной смены
export type Lesson = {
  id: string;
  short: string;     // подпись в полосе шагов
  title: string;
  tag: string;       // время/этап
  scene: string;
  question: string;
  options: LessonOption[];
  correct: string;   // id верного варианта
  why: string;       // разбор после верного ответа
  take: string;      // «Запомнить»
  sources: SourceKey[];
};

// Практика с выбором одного варианта
export type ChoiceCase = {
  title: string;
  text: string;
  question: string;
  options: { id: string; text: string }[];
  correct: string;
  check: string;     // подпись кнопки
  good: string;
  bad: string;
  link?: Link;
};

export type TrainingContent = {
  ui: {
    segSteps: string;
    segPractice: string;
    segRef: string;
    loading: string;
    progress: string;          // {done} {total}
    stepEyebrow: string;       // {tag} {n}
    stepLocked: string;        // подсказка для закрытого шага
    feedbackOk: string;
    feedbackBad: string;
    remember: string;
    tryOther: string;
    prev: string;
    check: string;
    next: string;
    toFinish: string;
    notPermit: string;
    save: Record<'restored' | 'formatChanged' | 'storageOff' | 'savedLocal' | 'savedTeam' | 'saveFail', string>;
    reportWeb: string;
    reportNative: string;
    reportFail: string;
    reportDone: string;
  };
  header: { eyebrow: string; title: string; lead: string; pills: string[] };
  scenario: { eyebrow: string; title: string; text: string; small: string };
  safety: { title: string; paragraphs: string[] };
  lessons: Lesson[];
  sources: Record<SourceKey, Link>;
  finish: {
    eyebrow: string;
    title: string;
    text: string;
    done: string;
    firstTry: string;
    review: string;            // {list}
    allFirst: string;
    practice: string;
    reviewAll: string;
    reportWeb: string;
    reportNative: string;
  };
  practice: {
    eyebrow: string;
    title: string;
    intro: string;
    progress: string;          // {n}
    chooseFirst: string;
    stock: {
      title: string;
      text: string;
      inputLabel: string;
      placeholder: string;
      confirm: string;
      check: string;
      required: number;        // требуется по условию
      expected: number;        // фактически осмотрено по условию
      good: string;
      retry: string;           // начало любого неверного ответа
      notSeen: string;
      badNumber: string;       // не число / не целое
      mismatch: string;        // {status}
      statuses: Record<'notChecked' | 'needInt' | 'short' | 'match' | 'over', string>;
    };
    hold: ChoiceCase;
    report: ChoiceCase;
    reset: string;
    note: string;
  };
  glossary: { title: string; items: { term: string; def: string }[] };
  pocket: { eyebrow: string; title: string; items: { lead: string; text: string }[]; note: string };
  roadmap: { eyebrow: string; title: string; items: { when: string; what: string }[]; note: string };
  sourcesSection: { title: string; checked: string; items: (Link & { note: string })[] };
  footer: { privacy: string; restart: string; confirm: string; yes: string; no: string };
  report: {
    fileName: string;          // {date}
    shareTitle: string;
    title: string;
    disclaimer: string;
    date: string;              // {date}
    done: string;              // {done} {total}
    firstTry: string;          // {n} {total}
    line: string;              // {n} {title} {status} {tries}
    passed: string;
    notDone: string;
    remember: string;
    practiceTitle: string;     // {n}
    practiceDone: string;
    practiceNotDone: string;
  };
};
