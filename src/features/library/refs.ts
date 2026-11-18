// Ссылки на источники в тексте сценария: «… по мануалу [М1][Н15]».
// [Н15] — номер из каталога источников; любые другие скобки ([не проверено], [практика]) — пометки.
import { SOURCES } from './content/sources';
import type { Phase, Source } from './types';

export type TextPart =
  | { type: 'text'; value: string }
  | { type: 'ref'; source: Source }
  | { type: 'tag'; value: string };

const BRACKETS = /\[([^[\]]+)\]/g;

// Разбить строку на куски: обычный текст, ссылка на источник, пометка
export function splitRefs(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(BRACKETS)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ type: 'text', value: text.slice(last, at) });
    const src = SOURCES[m[1]];
    parts.push(src ? { type: 'ref', source: src } : { type: 'tag', value: m[1] });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

// Текст без ссылок и пометок — для подписей доступности и поиска
export function plainText(text: string): string {
  return text.replace(BRACKETS, '').replace(/\s{2,}/g, ' ').trim();
}

// Все источники, на которые ссылается сценарий, в порядке первого упоминания
export function collectSources(s: { summary: string; phases: Phase[]; commonMistakes: string[]; askGeorgy: string[] }): Source[] {
  const texts = [
    s.summary,
    ...s.phases.flatMap(p => [p.name, ...p.steps, ...p.holdPoints, ...p.photos]),
    ...s.commonMistakes,
    ...s.askGeorgy,
  ];
  const seen = new Map<string, Source>();
  for (const t of texts) {
    for (const part of splitRefs(t)) if (part.type === 'ref' && !seen.has(part.source.id)) seen.set(part.source.id, part.source);
  }
  return Array.from(seen.values());
}

// Вид источника по первой букве номера
export function sourceKind(id: string): 'norm' | 'manual' | 'ref' | 'practice' {
  const c = id.charAt(0);
  return c === 'Н' ? 'norm' : c === 'М' ? 'manual' : c === 'С' ? 'ref' : 'practice';
}
