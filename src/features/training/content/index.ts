// Содержимое тренажёра по языкам. Пока есть только русский; для EN/ES добавить en.ts / es.ts
// с тем же типом TrainingContent и вписать сюда. Нет перевода — берётся русский.
import type { Lang } from '@/lib/i18n';

import { ru } from './ru';
import type { TrainingContent } from './types';

export type { ChoiceCase, Lesson, LessonOption, Link, SourceKey, TrainingContent } from './types';

const byLang: Partial<Record<Lang, TrainingContent>> = { ru };

export function getTrainingContent(lang: Lang): TrainingContent {
  return byLang[lang] ?? ru;
}

// Подставить {имя} в строку
export function fill(s: string, params: Record<string, string | number>): string {
  let out = s;
  for (const k in params) out = out.split('{' + k + '}').join(String(params[k]));
  return out;
}
