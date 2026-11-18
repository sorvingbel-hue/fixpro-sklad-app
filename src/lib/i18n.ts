// Тексты интерфейса. Основной язык — русский; английский и испанский пока пустые
// и подставляют русский текст. Чтобы добавить перевод — заполните en/es теми же ключами.

const ru = {
  'app.name': 'Форман',

  'tab.training': 'Смена',
  'tab.library': 'Установки',
  'tab.laws': 'Законы',
  'tab.sklad': 'Склад',
  'tab.more': 'Ещё',

  'training.title': 'Смена',
  'training.intro': 'Обучение на смене: короткие уроки и проверки для монтажников. Раздел в разработке.',
  'training.noteTitle': 'Заметка смены',
  'training.noteHint': 'Видна всей команде, если команда подключена (вкладка «Ещё»).',
  'training.notePlaceholder': 'Например: кто на каком объекте, что взять со склада',
  'training.save': 'Сохранить',
  'training.savedCloud': 'Сохранено и отправлено команде',
  'training.savedLocal': 'Сохранено на этом устройстве',
  'training.saveFail': 'Не удалось сохранить',

  'library.title': 'Установки',
  'library.intro': 'Библиотека установок: типовые схемы монтажа, чек-листы и фото-примеры. Раздел в разработке.',

  'laws.title': 'Законы Калифорнии',
  'laws.intro': 'Правила для HVAC в Калифорнии: лицензия CSLB, энергонормы Title 24, разрешения (permits), охрана труда Cal/OSHA, хладагенты (EPA 608). Раздел в разработке.',
  'laws.disclaimer': 'Это справка, а не юридическая консультация. Перед работой сверяйтесь с официальными источниками.',

  'sklad.title': 'Склад',
  'sklad.intro': 'Склад FixPro открывается отдельной страницей: остатки, приход и расход, комплекты на завтра.',
  'sklad.open': 'Открыть склад',
  'sklad.team': 'Откроется склад вашей команды: {name}.',
  'sklad.noTeam': 'Команда не подключена — склад сам спросит ссылку или код.',
  'sklad.openFail': 'Не удалось открыть страницу склада',

  'more.title': 'Ещё',

  'team.title': 'Команда',
  'team.label': 'Код команды',
  'team.hint': 'Вставьте ссылку команды (…#s=…&k=…) или ID команды и код через пробел.',
  'team.placeholder': 'Ссылка или «ID код»',
  'team.connect': 'Подключить',
  'team.disconnect': 'Отключить',
  'team.connected': 'Подключено: {name}',
  'team.id': 'ID команды: {space}',
  'team.checking': 'Проверяем код…',
  'team.bad': 'Не похоже на код команды',
  'team.denied': 'Неверный код команды',
  'team.offline': 'Нет связи. Попробуйте ещё раз',
  'team.noconfig': 'База не настроена в этой сборке',
  'team.error': 'База не приняла запрос',
  'team.done': 'Команда подключена',
  'team.off': 'Команда отключена. Данные остаются на этом устройстве.',
  'team.local': 'Пока команда не подключена, данные хранятся только на этом устройстве.',

  'sync.off': 'Только на этом устройстве',
  'sync.noconfig': 'База не настроена — данные только на устройстве',
  'sync.syncing': 'Синхронизация…',
  'sync.ok': 'Синхронизировано',
  'sync.pending': 'Не отправлено: {n}. Отправим, когда будет связь',
  'sync.offline': 'Нет связи — данные сохранены на устройстве',
  'sync.denied': 'Код команды не подходит — подключите заново',
  'sync.error': 'Ошибка синхронизации — данные сохранены на устройстве',

  'lang.title': 'Язык',
  'lang.soon': 'скоро',

  'v03.title': 'Импорт из пилота v0.3 (тест)',
  'v03.open': 'Импорт из пилота v0.3 (тест)',
  'v03.hint': 'Тестовый перенос смены DEMO-01 из веб-пилота «Форман · единый модуль 0.3». В пилоте: «Показать текущий JSON» → скопировать весь текст → вставить сюда. Только вымышленные данные.',
  'v03.label': 'JSON из пилота',
  'v03.check': 'Проверить',
  'v03.import': 'Импортировать',
  'v03.close': 'Закрыть',
  'v03.preview': 'Смена {job}: позиций {items} (заполнено {filled}), вопросов {questions} (с ответом {answered}), ролей {team}. Изменено в пилоте: {updated}.',
  'v03.replace': 'Если эта смена уже импортирована, запись будет заменена.',
  'v03.photos': 'Фото из пилота не переносятся: они хранятся только в браузере, где их добавили. Сохраните их отдельно.',
  'v03.ignored': 'Не переносятся поля: {keys}.',
  'v03.done.synced': 'Импортировано: на устройстве и в базе команды.',
  'v03.done.local': 'Импортировано на устройство. В базу уйдёт, когда подключена команда и есть связь.',

  'about.title': 'О приложении',
  'about.text': 'Форман — помощник бригадира HVAC в Сан-Диего: обучение на смене, библиотека установок, правила Калифорнии и склад.',
  'about.disclaimer': 'Важно: сведения в приложении справочные. Это не юридическая и не инженерная консультация. Решения принимает ответственный специалист по действующим нормам и инструкциям производителя.',
  'about.version': 'Версия {v}',
} as const;

export type I18nKey = keyof typeof ru;
export type Lang = 'ru' | 'en' | 'es';

// Переводы заполняются позже; отсутствующие ключи берутся из ru
const en: Partial<Record<I18nKey, string>> = {};
const es: Partial<Record<I18nKey, string>> = {};
const dict: Record<Lang, Partial<Record<I18nKey, string>>> = { ru, en, es };

// Языки для переключателя; пока включён только русский
export const LANGUAGES: { code: Lang; label: string; enabled: boolean }[] = [
  { code: 'ru', label: 'Русский', enabled: true },
  { code: 'en', label: 'English', enabled: false },
  { code: 'es', label: 'Español', enabled: false },
];

let current: Lang = 'ru';

export function getLanguage(): Lang {
  return current;
}

// Сменить язык (только включённые языки)
export function setLanguage(lang: Lang): boolean {
  const l = LANGUAGES.find(x => x.code === lang);
  if (!l || !l.enabled) return false;
  current = lang;
  return true;
}

// Текст по ключу; {name} в тексте заменяется значением из params
export function t(key: I18nKey, params?: Record<string, string | number>): string {
  let s: string = dict[current][key] ?? ru[key] ?? key;
  if (params) for (const p in params) s = s.split('{' + p + '}').join(String(params[p]));
  return s;
}
