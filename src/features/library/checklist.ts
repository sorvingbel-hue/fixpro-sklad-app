// Пункты чек-листа сценария и их ключи.
// Ключ — короткий отпечаток текста пункта: если текст шага поменяют после диктовки,
// старая отметка к новому тексту не прилипнет (шаг придётся отметить заново).
import type { CheckItem, CheckKind, Phase, Scenario } from './types';

// Простой отпечаток строки (djb2) — не для защиты, только для устойчивых ключей
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function itemKey(phase: string, kind: CheckKind, text: string): string {
  return kind.charAt(0) + hash(phase + '|' + text);
}

// Пункты одного этапа: сначала точки остановки (они важнее), затем шаги, затем фото
export function phaseItems(p: Phase): CheckItem[] {
  return [
    ...p.holdPoints.map(text => ({ key: itemKey(p.name, 'hold', text), kind: 'hold' as const, text })),
    ...p.steps.map(text => ({ key: itemKey(p.name, 'step', text), kind: 'step' as const, text })),
    ...p.photos.map(text => ({ key: itemKey(p.name, 'photo', text), kind: 'photo' as const, text })),
  ];
}

export function scenarioItems(s: Scenario): CheckItem[] {
  return s.phases.flatMap(phaseItems);
}

// Сколько отмеченных ключей ещё есть в сценарии (устаревшие отметки не считаются)
export function countDone(s: Scenario, done: Iterable<string>): { done: number; total: number } {
  const keys = new Set(scenarioItems(s).map(i => i.key));
  let n = 0;
  for (const k of new Set(done)) if (keys.has(k)) n++;
  return { done: n, total: keys.size };
}
