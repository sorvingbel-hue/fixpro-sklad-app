// Содержание библиотеки для текущего языка. Пока есть только русский;
// перевод добавляется отдельным файлом (например, scenarios-en.ts) и строкой в BY_LANG.
import { getLanguage, type Lang } from '@/lib/i18n';

import type { Scenario } from '../types';
import { CLUSTERS, CONTENT_DATE, SCENARIOS_RU } from './scenarios';

const BY_LANG: Partial<Record<Lang, Scenario[]>> = { ru: SCENARIOS_RU };

export function getScenarios(): Scenario[] {
  return BY_LANG[getLanguage()] ?? SCENARIOS_RU;
}

export function getScenario(id: string): Scenario | undefined {
  return getScenarios().find(s => s.id === id);
}

export { CLUSTERS, CONTENT_DATE };
