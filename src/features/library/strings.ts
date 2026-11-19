// Тексты вкладки «Установки». Устроено так же, как src/lib/i18n.ts: русский заполнен,
// английский и испанский пока пустые и берут русский. Язык — общий для приложения (getLanguage).
import { getLanguage, type Lang } from '@/lib/i18n';

import type { ScenarioStatus } from './types';

const ru = {
  'title': 'Установки',
  'intro': 'Пошаговые сценарии типовых установок: этапы, точки остановки, что сфотографировать. Откройте сценарий и включите «Чек-лист», чтобы отмечать сделанное.',
  'disclaimer': 'Черновики — подготовка по источникам, а не инструкция. Значения (вакуум, давления, моменты, зазоры, длины) — только из мануала модели и с шильдика. Работы с газом, хладагентом и электрикой — только с допуском.',
  'count': 'Сценариев: {n}. Не проверены бригадиром: {d}.',
  'meta': 'Этапов: {p} · стопов: {h}',
  'progress': 'Отмечено {done} из {total}',
  'open': 'Открыть сценарий {title}',

  'status.draft': 'Черновик, не проверен',
  'status.dictated': 'Проверено бригадиром',
  'status.verified': 'Проверено',

  'back': '← Все установки',
  'draftBanner': 'Черновик: не проверен бригадиром',
  'draftHint': 'Составлено ИИ по источникам {date}. Шаги — организационные; технические пункты — со ссылкой на источник. Главное — практика Георгия.',
  'mode.read': 'Описание',
  'mode.check': 'Чек-лист',
  'expandAll': 'Развернуть все этапы',
  'collapseAll': 'Свернуть все этапы',
  'phase.counts': 'шагов: {s} · стопов: {h} · фото: {f}',
  'phase.progress': '{done} из {total}',
  'steps': 'Шаги',
  'hold': 'СТОП',
  'photos': 'Сфотографировать',
  'photo': 'Фото',

  'check.hint': 'Нажимайте на пункт, когда он сделан. Отметки сохраняются на этом телефоне и уходят команде, если она подключена (вкладка «Ещё»).',
  'check.reset': 'Сбросить отметки',
  'check.resetConfirm': 'Нажмите ещё раз, чтобы сбросить все отметки',
  'check.saveFail': 'Не удалось сохранить отметку',
  'check.allDone': 'Все пункты отмечены',

  'mistakes': 'Частые ошибки',
  'ask': 'Что уточнить у бригадира',
  'sources': 'Источники',
  'sources.hint': 'Н — нормы и официальные документы, М — мануалы, С — справочные, П — практика (не норма). Нажмите, чтобы открыть.',
  'source.checked': 'ссылка проверена {date}',
  'source.unchecked': 'не открылась или не проверена',
  'source.openFail': 'Не удалось открыть ссылку',
  'kind.norm': 'Норма',
  'kind.manual': 'Мануал',
  'kind.ref': 'Справка',
  'kind.practice': 'Практика',

  'notes': 'Заметки',
  'notes.add': 'Добавить заметку голосом/текстом',
  'notes.hint': 'Голос: нажмите микрофон на клавиатуре телефона и надиктуйте. Запись звука — позже. Заметка хранится только на этом устройстве.',
  'notes.label': 'Заметка к сценарию',
  'notes.placeholder': 'Например: на этом объекте у нас так…',
  'notes.save': 'Сохранить заметку',
  'notes.cancel': 'Отмена',
  'notes.saved': 'Заметка сохранена на этом устройстве',
  'notes.fail': 'Не удалось сохранить заметку',
  'notes.empty': 'Заметок пока нет.',
  'notes.delete': 'Удалить',
  'notes.deleteConfirm': 'Точно удалить?',
} as const;

export type LibKey = keyof typeof ru;

// Переводы заполняются позже; отсутствующие ключи берутся из ru
const en: Partial<Record<LibKey, string>> = {};
const es: Partial<Record<LibKey, string>> = {};
const dict: Record<Lang, Partial<Record<LibKey, string>>> = { ru, en, es };

export function lt(key: LibKey, params?: Record<string, string | number>): string {
  let s: string = dict[getLanguage()][key] ?? ru[key] ?? key;
  if (params) for (const p in params) s = s.split('{' + p + '}').join(String(params[p]));
  return s;
}

export function statusLabel(s: ScenarioStatus): string {
  return lt(s === 'черновик ИИ' ? 'status.draft' : s === 'надиктовано Георгием' ? 'status.dictated' : 'status.verified');
}

// Дата ГГГГ-ММ-ДД → ДД.ММ.ГГГГ
export function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

// Время ISO → «ДД.ММ.ГГГГ ЧЧ:ММ» по часам этого устройства
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
