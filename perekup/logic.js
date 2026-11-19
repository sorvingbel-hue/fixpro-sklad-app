// «Перекуп» — логика приложения без DOM: ввод, склад, итоги, копия.
// Деньги и решения считает ядро perekup-core (core/calc.js собран из perekup-core/src/calc.ts).
// Здесь только подготовка ввода, проверки и учёт; своей копии формул нет.
// Правила (ТЗ §1): числа вводит человек из приложения eBay; ничего не уходит в сеть и в ИИ.

import { allocateLot, form1099kStatus, maxOffer, netProfit, payoutDays, sellThrough, verdict } from './core/calc.js';

export const SCHEMA = 'perekup';
// Версия схемы данных. 1 — срез 1 (оценка и склад); 2 — срез 2 (учёт для налогов: поездки, расходы,
// комиссии по видам, реестр правил). Копия версии 1 загружается и переводится в версию 2 без потерь.
export const SCHEMA_VERSION = 2;
// Новый ключ для версии 2: данные среза 1 в 'perekup.v1' не перезаписываются (остаются как запасная копия),
// а старая вкладка с прежней программой не может затереть новые поля.
export const STORAGE_KEY = 'perekup.v2';
export const LEGACY_STORAGE_KEY = 'perekup.v1';
export const DRAFT_KEY = 'perekup.draft.v1';
export const BROKEN_KEY_PREFIX = 'perekup.broken.';

// ---------- справочники ----------

// Основной путь вещи. «Списана» (не продано / лом) — отдельный конечный статус.
export const STATUSES = ['evaluated', 'have', 'listed', 'sold', 'paid'];
export const ALL_STATUSES = [...STATUSES, 'writeoff'];

export const ORIGINS = {
  bought: 'Купил для перепродажи',
  personal: 'Своя вещь (из личных)',
  own_stock: 'Свой запас HVAC',
};

export const CHANNELS = {
  ebay: 'eBay',
  marketplace: 'Facebook Marketplace',
  offerup: 'OfferUp',
  cash: 'Наличные (местная продажа)',
};

export const SHIP_MODES = {
  buyer: 'Платит покупатель',
  free: 'Бесплатная (плачу я)',
  pickup: 'Самовывоз',
  unknown: 'Не знаю',
};

export const WRITEOFF_KINDS = {
  unsold: 'Не продано — списал',
  scrap: 'Лом / на запчасти — списал',
};

export const CHECK_RESULTS = {
  works: 'Работает',
  partial: 'Работает частично',
  broken: 'Не работает',
  untested: 'Нечем проверить',
};

export const VERDICT_TEXT = {
  buy: 'БРАТЬ',
  offer: 'ПРЕДЛОЖИТЬ',
  skip: 'НЕ БРАТЬ',
  insufficient: 'НЕДОСТАТОЧНО ДАННЫХ',
};

// Стоп-лист ТЗ §7. По названию — только подсказка (бывают ложные совпадения, напр. моторы Mercury);
// решение «из стоп-листа» Георгий отмечает сам галочкой, и тогда вердикт — «не брать».
const STOP_HINTS = [
  { re: /(фреон|хладаг[её]нт|refrigerant|freon|\bR-?(?:12|22|32|134a|404a|407c|410a|502)\b)/iu, what: 'хладагент' },
  { re: /(ртут|mercury)/iu, what: 'ртуть (ртутный термостат)' },
  { re: /(катализатор|catalytic|\bcat converter)/iu, what: 'каталитический нейтрализатор' },
  { re: /(отзывн|recall)/iu, what: 'отзывной товар' },
];

// Стартовые значения из ТЗ §5 (комиссия 13,6% + $0,40, net ≥ $25, ≥ 5 продаж за 90 дней,
// STR ≥ 50% только для «быстрых» категорий, потолки покупки от медианы). Всё редактируется в «Настройках».
export function defaultCategories() {
  const base = { feePct: 0.136, perOrderFee: 0.4, minNet: 25, minSold90: 5 };
  return [
    { id: 'electronics', name: 'Консоли и электроника', ebayName: 'Video Games & Consoles / Consumer Electronics', ...base, minStr: 0.5, buyCeilingLow: 0.3, buyCeilingHigh: 0.45 },
    { id: 'tools', name: 'Инструменты', ebayName: 'Tools & Workshop Equipment', ...base, minStr: 0.5, buyCeilingLow: 0.3, buyCeilingHigh: 0.45 },
    { id: 'lego', name: 'LEGO', ebayName: 'LEGO Building Toys', ...base, minStr: 0.5, buyCeilingLow: 0.25, buyCeilingHigh: 0.5 },
    { id: 'furniture', name: 'Мебель', ebayName: 'Furniture', ...base, minStr: null, buyCeilingLow: 0.2, buyCeilingHigh: 0.4 },
    { id: 'hvac', name: 'HVAC: платы и модули', ebayName: 'HVAC & Refrigeration', ...base, minStr: null, buyCeilingLow: 0.3, buyCeilingHigh: 0.4 },
    { id: 'other', name: 'Другое', ebayName: 'Other', ...base, minStr: null, buyCeilingLow: 0.2, buyCeilingHigh: 0.3 },
  ];
}

// Ставка за милю и порог 1099-K здесь больше не хранятся: они берутся из реестра правил (taxRules) —
// ставка по дате поездки, порог по налоговому году (см. mileRateFor, k1099For, effectiveSettings).
export function defaultSettings() {
  return {
    categories: defaultCategories(),
    // Налог покупателя, с которого eBay тоже берёт комиссию (ТЗ §5, est_buyer_tax). Примерно; 7,75% — Сан-Диего.
    buyerTaxPct: 0.0775,
    // Оценка срока выплаты — только по своим прошлым выплатам, если их не меньше стольки.
    payoutEstimateMinN: 3,
    // ТЗ §7: флаг «слишком дёшево — возможно краденое», если просят меньше этой доли медианы.
    cheapFlagPct: 0.1,
  };
}

export function defaultState() {
  return {
    version: SCHEMA_VERSION, settings: defaultSettings(), items: [], lots: [],
    trips: [], expenses: [], taxRules: builtinRules(),
    meta: { lastExportAt: null, migratedFromV1: null },
  };
}

// ---------- реестр правил (ТЗ M4, таблица tax_rules) ----------
// У каждого правила: ключ, значение, налоговый год, период (для ставок по дате), ссылка на официальный источник,
// дата проверки, дата следующей проверки, статус. Начальные значения ТЗ v1.1 сверены с первоисточниками
// 19.11.2026 (scratchpad/perekup/tax_rules_verified.json): цифры ТЗ подтверждены, добавлена ставка 2025 года,
// налог Сан-Диего 7,75% действует весь 2026 год (01.10.2026 — дата таблицы CDTFA, а не смены ставки).
// Правила программы (builtin) обновляются вместе с программой, если Георгий не менял значение сам (edited).

export const RULE_KEYS = {
  mile_rate: { name: 'Ставка за милю (поездки по делу)', en: 'Standard mileage rate, business ($/mile)', unit: 'rate', byDate: true },
  k1099_min_gross: { name: '1099-K: сумма продаж больше', en: 'Form 1099-K threshold: gross over ($)', unit: 'money', byDate: false },
  k1099_min_count: { name: '1099-K: сделок больше', en: 'Form 1099-K threshold: transactions over', unit: 'count', byDate: false },
  sd_sales_tax: { name: 'Налог с продаж, город Сан-Диего', en: 'Sales tax rate, City of San Diego', unit: 'pct', byDate: true },
};

export const RULE_STATUS = { verified: 'проверено', unverified: 'не проверено' };

const V = { verifiedAt: '2026-11-19', nextCheck: '2026-12-04', status: 'verified' };
const IRS_1099K_FAQ = 'https://www.irs.gov/newsroom/form-1099-k-faqs-general-information';
const IRS_1099K_INSTR = 'https://www.irs.gov/pub/irs-pdf/i1099k.pdf';

// Значения, ссылки и даты — из проверки по первоисточникам 19.11.2026 (tests/fixtures/tax_rules_verified.json,
// тест сверяет реестр с файлом). Порог 1099-K — по налоговому году (период — справочно, как в файле).
// Налог Сан-Диего: в файле effective_to пусто; здесь — 31.12.2026, потому что проверен только 2026 год
// (таблицу CDTFA на 01.01.2027 ещё не выложили), и 2027 год не должен молча считаться по ставке 2026.
const BUILTIN_RULES = [
  { id: 'mile_rate_2025', key: 'mile_rate', value: 0.7, taxYear: 2025, validFrom: '2025-01-01', validTo: '2025-12-31', sourceUrl: 'https://www.irs.gov/newsroom/irs-increases-the-standard-mileage-rate-for-business-use-in-2025-key-rate-increases-3-cents-to-70-cents-per-mile', ...V, note: 'IR-2024-312, Notice 2025-5' },
  { id: 'mile_rate_2026_h1', key: 'mile_rate', value: 0.725, taxYear: 2026, validFrom: '2026-01-01', validTo: '2026-06-30', sourceUrl: 'https://www.irs.gov/newsroom/irs-sets-2026-business-standard-mileage-rate-at-725-cents-per-mile-up-25-cents', ...V, note: 'IR-2025-128, Notice 2026-10' },
  { id: 'mile_rate_2026_h2', key: 'mile_rate', value: 0.76, taxYear: 2026, validFrom: '2026-07-01', validTo: '2026-12-31', sourceUrl: 'https://www.irs.gov/irb/2026-29_irb#ANN-2026-11', ...V, note: 'Announcement 2026-11, IRB 2026-29' },
  { id: 'k1099_min_gross_2025', key: 'k1099_min_gross', value: 20000, taxYear: 2025, validFrom: '2025-01-01', validTo: '2025-12-31', sourceUrl: IRS_1099K_FAQ, ...V, note: 'IRS FAQ 1099-K (Fact Sheet 2025-08); порог восстановлен задним числом' },
  { id: 'k1099_min_count_2025', key: 'k1099_min_count', value: 200, taxYear: 2025, validFrom: '2025-01-01', validTo: '2025-12-31', sourceUrl: IRS_1099K_FAQ, ...V, note: 'IRS FAQ 1099-K (Fact Sheet 2025-08); порог восстановлен задним числом' },
  { id: 'k1099_min_gross_2026', key: 'k1099_min_gross', value: 20000, taxYear: 2026, validFrom: '2026-01-01', validTo: '2026-12-31', sourceUrl: IRS_1099K_INSTR, ...V, note: 'Instructions for Form 1099-K (Rev. December 2026)' },
  { id: 'k1099_min_count_2026', key: 'k1099_min_count', value: 200, taxYear: 2026, validFrom: '2026-01-01', validTo: '2026-12-31', sourceUrl: IRS_1099K_INSTR, ...V, note: 'Instructions for Form 1099-K (Rev. December 2026)' },
  { id: 'sd_sales_tax_2026', key: 'sd_sales_tax', value: 0.0775, taxYear: 2026, validFrom: '2026-01-01', validTo: '2026-12-31', sourceUrl: 'https://cdtfa.ca.gov/taxes-and-fees/rates.aspx', ...V, note: 'CDTFA, город San Diego, весь 2026 год; таблицы на 2027 ещё нет. Только для своих продаж за наличные' },
];

// Seller's permit (CDTFA Publication 107): в реестре не число, поэтому — только ссылка на источник рядом с наличными.
export const SELLERS_PERMIT = { sourceUrl: 'https://cdtfa.ca.gov/formspubs/pub107/', verifiedAt: '2026-11-19' };

export function builtinRules() {
  return BUILTIN_RULES.map((r) => ({ ...r, builtin: true, edited: false }));
}
export const BUILTIN_RULE_IDS = new Set(BUILTIN_RULES.map((r) => r.id));

// Правила программы + свои правки Георгия: неизменённые правила программы берутся из текущей версии программы
// (так проверенные цифры приходят с обновлением). У изменённого им правила программы остаётся только его
// значение (оно «не проверено»); ключ, период, год и ссылка — всегда из программы, их правкой и копией не подменить.
// Свои добавленные правила остаются.
export function mergeRules(stored) {
  const list = Array.isArray(stored) ? stored : [];
  const byId = new Map(list.map((r) => [r.id, r]));
  const out = builtinRules().map((b) => {
    const s = byId.get(b.id);
    if (!s || !s.edited || s.key !== b.key || !ruleValueOk(RULE_KEYS[b.key].unit, s.value)) return b;
    return { ...b, value: s.value, edited: true, status: 'unverified', verifiedAt: null };
  });
  for (const r of list) if (!BUILTIN_RULE_IDS.has(r.id) && !r.builtin) out.push({ ...r, builtin: false, edited: false });
  return out;
}

const preferUser = (a, b) => (a.builtin === b.builtin ? 0 : a.builtin ? 1 : -1);
const endOf = (r) => r.validTo || '9999-12-31';

// Какое правило действует, если периоды пересекаются: точнее то, что начинается позже, затем то, что
// короче. Своё правило побеждает правило программы только при том же периоде (или если оно точнее).
// Так своё правило «с 01.01.2026 без конца» не перекрывает проверенную ставку с 01.07.2026 и будущие
// проверенные ставки 2027 года, которые придут с обновлением программы.
function ruleOrder(a, b) {
  if (a.validFrom !== b.validFrom) return a.validFrom > b.validFrom ? -1 : 1;
  if (endOf(a) !== endOf(b)) return endOf(a) < endOf(b) ? -1 : 1;
  return preferUser(a, b);
}

// Правило на дату (ставка за милю — по дате поездки, налог с продаж — по дате продажи).
// shadowed — проверенные правила программы на эту дату, которые закрыло своё правило Георгия (предупреждение).
export function ruleOnDate(rules, key, date) {
  if (!isDate(date)) return null;
  const c = (rules || []).filter((r) => r.key === key && isDate(r.validFrom) && r.validFrom <= date && (!r.validTo || date <= r.validTo));
  if (!c.length) return null;
  c.sort(ruleOrder);
  const top = c[0];
  return { value: top.value, rule: top, shadowed: top.builtin ? [] : c.slice(1).filter((r) => r.builtin && r.status === 'verified') };
}

// Ставка за милю на дату поездки (ТЗ M4: rate_used). null — в реестре нет ставки на эту дату.
export function mileRateFor(rules, date) {
  return ruleOnDate(rules, 'mile_rate', date);
}

function yearRule(rules, key, year) {
  const c = (rules || []).filter((r) => r.key === key && r.taxYear === year).sort(preferUser);
  if (!c.length) return null;
  return { rule: c[0], shadowed: c[0].builtin ? [] : c.slice(1).filter((r) => r.builtin && r.status === 'verified') };
}

// Порог 1099-K на налоговый год: { minGross, minCount, rules, shadowed } или null (нет правил на этот год).
export function k1099For(rules, year) {
  const g = yearRule(rules, 'k1099_min_gross', year);
  const n = yearRule(rules, 'k1099_min_count', year);
  if (!g || !n) return null;
  return { minGross: g.rule.value, minCount: n.rule.value, rules: [g.rule, n.rule], shadowed: [...g.shadowed, ...n.shadowed] };
}

// Состояние проверки правила на сегодня: 'unverified' — не сверено (или изменено вами);
// 'stale' — сверено, но дата следующей проверки прошла; 'verified' — сверено и срок не вышел.
export function ruleCheckState(rule, today = todayLocal()) {
  if (!rule || rule.status !== 'verified') return 'unverified';
  if (isDate(rule.nextCheck) && today > rule.nextCheck) return 'stale';
  return 'verified';
}

// Где своё правило пересекается с правилом программы того же вида и какое из них там действует.
export function ruleOverlaps(rules, rule) {
  if (!rule || rule.builtin) return [];
  const meta = RULE_KEYS[rule.key];
  return (rules || []).filter((b) => b.builtin && b.key === rule.key && (meta && meta.byDate
    ? isDate(b.validFrom) && isDate(rule.validFrom) && b.validFrom <= endOf(rule) && rule.validFrom <= endOf(b)
    : b.taxYear === rule.taxYear))
    .map((b) => ({ builtin: b, wins: meta && meta.byDate ? (ruleOrder(rule, b) < 0 ? 'user' : 'builtin') : 'user' }));
}

// Настройки для расчётов «сейчас»: общие настройки + цифры из реестра на сегодня (ставка за милю — по
// местной дате, порог 1099-K — по текущему году). Так mileRate/k1099 не живут отдельно от реестра.
// today — «сегодня» для проверки дат в формах (дата в будущем — ошибка).
export function effectiveSettings(state, now = new Date()) {
  const rules = state.taxRules || builtinRules();
  const today = todayLocal(now);
  const mr = mileRateFor(rules, today);
  const k = k1099For(rules, Number(today.slice(0, 4)));
  return {
    ...state.settings, taxRules: rules, trips: state.trips || [], today,
    mileRate: mr ? mr.value : null, mileRateRule: mr ? mr.rule : null,
    k1099: k ? { minGross: k.minGross, minCount: k.minCount } : null, k1099Rules: k ? k.rules : null,
  };
}

const rulesOf = (settings) => (settings && settings.taxRules) || builtinRules();

// ---------- числа и даты ----------

const FIELD_NAMES = {
  median: 'Медиана проданных',
  sold90: 'Продано за 90 дней',
  active: 'Активных сейчас',
  shipCharged: 'Доставка с покупателя',
  label: 'Этикетка',
  buyPrice: 'Цена покупки',
  packaging: 'Упаковка',
  miles: 'Мили',
};

// Виды полей: сколько знаков после точки и верхний предел (ошибка вместо молча неверного числа).
export const NUM = {
  money: { decimals: 2, max: 1_000_000 },
  count: { integer: true, max: 1_000_000 },
  miles: { decimals: 1, max: 5_000 },
  rate: { decimals: 3, max: 10 },
  pct: { decimals: 2, max: 100 },
};

const plain = (v) => v.toLocaleString('en-US', { maximumFractionDigits: 3 });

// Число из поля ввода. Пусто → null (НЕ ноль).
// Понимает «12,5» и «0,725» (русская запятая), «$1,200.50» и «1,200,000» (как в приложении eBay), «1 200».
// «1,500» без точки — непонятно (1500 или 1.5?), поэтому ошибка с подсказкой, а не молчаливая догадка.
export function parseNumber(raw, { integer = false, decimals = null, max = null } = {}) {
  if (raw === null || raw === undefined) return { value: null, error: null };
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { value: null, error: 'введите число' };
    raw = String(raw);
  } else if (typeof raw !== 'string') return { value: null, error: 'введите число' };
  let s = raw.trim().replace(/[\s    ]+/g, '').replace(/^\$/, '').replace(/\$$/, '').replace(/^\+/, '');
  if (s === '') return { value: null, error: null };
  if (/^[−–-]/.test(s)) return { value: null, error: 'не может быть меньше 0' };
  const hasComma = s.includes(',');
  if (hasComma && s.includes('.')) {
    if (!/^\d{1,3}(,\d{3})+\.\d*$/.test(s)) return { value: null, error: 'непонятная запись числа — наберите, например, 1200.50' };
    s = s.replace(/,/g, '');
  } else if (hasComma) {
    if (/^\d{1,3}(,\d{3}){2,}$/.test(s)) s = s.replace(/,/g, '');
    else if (/^\d+,\d+$/.test(s)) {
      const [a, b] = s.split(',');
      if (b.length === 3 && a !== '0' && a.length <= 3) {
        const asDec = String(Number(`${a}.${b}`));
        return { value: null, error: `непонятно: «${s}» — это ${a}${b} или ${asDec}? Наберите без запятой: ${a}${b} или ${asDec}` };
      }
      s = `${a}.${b}`;
    } else return { value: null, error: 'введите число' };
  }
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return { value: null, error: 'введите число' };
  const frac = (s.split('.')[1] || '').replace(/0+$/, '');
  const maxDec = integer ? 0 : decimals;
  if (maxDec !== null && frac.length > maxDec) {
    return { value: null, error: maxDec === 0 ? 'нужно целое число' : maxDec === 1 ? 'не больше 1 знака после точки' : `не больше ${maxDec} знаков после точки` };
  }
  if (s.replace('.', '').replace(/^0+/, '').length > 15) return { value: null, error: 'слишком большое число' };
  const v = Number(s);
  if (!Number.isFinite(v)) return { value: null, error: 'введите число' };
  if (max !== null && v > max) return { value: null, error: `слишком большое число (не больше ${plain(max)})` };
  return { value: v, error: null };
}

const pad = (x) => String(x).padStart(2, '0');

// Сегодня по местному времени телефона (не UTC: вечером в Сан-Диего UTC — уже завтра).
export function todayLocal(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export function addDays(dateStr, days) {
  const t = Date.parse(dateStr + 'T00:00:00Z') + Math.round(days) * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function fmtDate(s) {
  if (!isDate(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y}`;
}

export function fmtMoney(v, { cents = true } = {}) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return (v < 0 ? '−$' : '$') + abs;
}

export function fmtPct(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${Math.round(v * 100)}%`;
}

export function median(nums) {
  const a = nums.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const round2 = (v) => Math.round(v * 100) / 100;
const n0 = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Сумма за мили: мили (до 0,1) × ставка (до 0,001) — в целых, затем до цента. Для группы поездок с одной
// ставкой считается от суммы миль, а не складывается из округлённых поездок (66 миль × $0.76 = $50.16).
export function mileAmount(miles, rate) {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || typeof miles !== 'number' || !Number.isFinite(miles)) return null;
  return Math.round((Math.round(miles * 10) * Math.round(rate * 1000)) / 100) / 100;
}

// Мили по ставкам: группы { rate, miles, count, amount, rows } + без ставки (unknown) + итог (сумма групп).
export function mileageGroups(rows) {
  const by = new Map();
  const unknown = { count: 0, miles: 0, rows: [] };
  for (const r of rows) {
    if (typeof r.rateUsed !== 'number') { unknown.count++; unknown.miles = Math.round((unknown.miles + r.miles) * 10) / 10; unknown.rows.push(r); continue; }
    const g = by.get(r.rateUsed) || { rate: r.rateUsed, tenths: 0, count: 0, rows: [] };
    g.tenths += Math.round(r.miles * 10);
    g.count++;
    g.rows.push(r);
    by.set(r.rateUsed, g);
  }
  const groups = [...by.values()].sort((a, b) => a.rate - b.rate).map((g) => ({ rate: g.rate, count: g.count, miles: g.tenths / 10, amount: mileAmount(g.tenths / 10, g.rate), rows: g.rows }));
  const miles = Math.round(rows.reduce((a, r) => a + Math.round(r.miles * 10), 0)) / 10;
  return { groups, unknown, miles, amount: round2(groups.reduce((a, g) => a + g.amount, 0)) };
}

// Дата в будущем — почти всегда опечатка в годе (2062 вместо 2026): формы её не принимают.
function checkNotFuture(date, today, errors, key = 'date') {
  if (isDate(date) && isDate(today) && date > today && !errors[key]) errors[key] = `дата в будущем (${fmtDate(date)}) — проверьте год`;
}

export function newId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// ---------- оценка вещи (экран «Оценить») ----------

// Деньги сравниваются с точностью до цента: ядро получает порог прибыли на полцента ниже, а потолок
// от медианы — на 1e-12 выше. Иначе ошибка двоичной дроби (24.999999999999996 вместо 25, 28.999999999999996
// вместо 29) меняет вердикт на границе. Формулы остаются в ядре; правильнее перевести ядро на центы,
// но ветку perekup-core в этом шаге менять нельзя (см. README).
const CENT_TOLERANCE = 0.005 - 1e-9;
export function coreCategory(cat) {
  return { ...cat, minNet: cat.minNet - CENT_TOLERANCE, buyCeilingLow: cat.buyCeilingLow + 1e-12, buyCeilingHigh: cat.buyCeilingHigh + 1e-12 };
}

export function stopListHint(title) {
  const t = String(title || '');
  for (const h of STOP_HINTS) {
    const m = t.match(h.re);
    if (m) return { word: m[1], what: h.what };
  }
  return null;
}

// Причины ядра — простыми словами, без знаков «<» (только перевод текста, решение не меняется).
function humanReason(r, cat) {
  let m = r.match(/^спрос слабый: STR (\d+)% < (\d+)%$/);
  if (m) return `спрос слабый: продано за 90 дней — ${m[1]}% от числа активных объявлений, а нужно не меньше ${m[2]}%`;
  m = r.match(/^чистая прибыль (-?[\d.]+) < /);
  if (m) return `чистыми ${fmtMoney(Number(m[1]))} — меньше минимума ${fmtMoney(cat.minNet, { cents: false })}`;
  if (r === 'даже бесплатно не выходит на минимальную прибыль') return `даже если отдадут бесплатно, чистыми выйдет меньше минимума ${fmtMoney(cat.minNet, { cents: false })}`;
  return r;
}

// input — строки из формы: { title, categoryId, median, sold90, active, shipMode, shipCharged, label, buyPrice, packaging, miles }
// и галочки own (своя вещь), stop (из стоп-листа), prius (не влезет в Prius).
export function evaluate(settings, input) {
  const errors = {};
  const appMissing = [];
  const f = (key, preset) => {
    const r = parseNumber(input[key], preset);
    if (r.error) errors[key] = r.error;
    return r.value;
  };
  const own = input.own === true;
  const cat = settings.categories.find((c) => c.id === input.categoryId) || null;
  const med = f('median', NUM.money);
  const sold90 = f('sold90', NUM.count);
  const active = f('active', NUM.count);
  const buyPrice = f('buyPrice', NUM.money);
  const packaging = f('packaging', NUM.money);
  const miles = f('miles', NUM.miles);

  // Доставка: неизвестное НЕ превращается в $0 (критерий dot).
  let shipCharged = null;
  let label = null;
  switch (input.shipMode) {
    case 'buyer':
      shipCharged = f('shipCharged', NUM.money);
      label = f('label', NUM.money);
      if (shipCharged === null && !errors.shipCharged) appMissing.push('не введено, сколько покупатель платит за доставку');
      if (label === null && !errors.label) appMissing.push('неизвестна стоимость этикетки (отправки)');
      break;
    case 'free':
      shipCharged = 0;
      label = f('label', NUM.money);
      if (label === null && !errors.label) appMissing.push('неизвестна стоимость этикетки (отправки)');
      break;
    case 'pickup':
      shipCharged = 0;
      label = 0;
      break;
    case 'unknown':
      appMissing.push('доставка «не знаю» — без неё прибыль не посчитать');
      break;
    default:
      appMissing.push('не выбрана доставка');
  }
  const priceMissing = buyPrice === null && !errors.buyPrice;
  if (priceMissing) appMissing.push('не введена цена покупки (своя вещь — кнопка «Своя вещь, $0»)');
  if (!cat) appMissing.push('не выбрана категория');
  for (const k of Object.keys(errors)) appMissing.push(`${FIELD_NAMES[k] || k}: ${errors[k]}`);

  // Предупреждения ТЗ §7 (не формулы): подсказка стоп-листа, Prius, «слишком дёшево».
  const warnings = [];
  const hint = stopListHint(input.title);
  if (hint && input.stop !== true) warnings.push(`В названии «${hint.word}» — похоже на стоп-лист (${hint.what}). Если так — поставьте галочку «Из стоп-листа»: такое не берём.`);
  if (input.prius === true) warnings.push('Не влезет в Prius — брать, только если привезут сами. Лучше не брать.');
  const cheap = settings.cheapFlagPct;
  if (!own && buyPrice !== null && buyPrice > 0 && med !== null && med > 0 && buyPrice < cheap * med) {
    warnings.push(`Подозрительно дёшево: просят меньше ${fmtPct(cheap)} от медианы. Возможно краденое — спросите, откуда вещь и есть ли чек.`);
  }

  const comps = { medianSold: med, sold90, activeNow: active };
  if (shipCharged !== null) comps.shipCharged = shipCharged;
  const shipKnown = shipCharged !== null && label !== null;
  const costs = {
    packaging: packaging ?? 0,
    miles: miles ?? 0,
    mileRate: settings.mileRate,
    estBuyerTax: med !== null && shipKnown ? settings.buyerTaxPct * (med + shipCharged) : 0,
  };
  if (buyPrice !== null) costs.buyPrice = buyPrice;
  if (label !== null) costs.label = label;

  const str = sellThrough(comps);
  const cc = cat ? coreCategory(cat) : null;
  const core = cc ? verdict(cc, comps, costs) : null;
  const coreMissing = core && core.kind === 'insufficient' ? core.reasons : [];
  // Пустые «упаковка» и «мили» считаются как $0 — об этом пишем рядом с вердиктом, а не только в смете.
  const notes = [];
  if (packaging === null && !errors.packaging) notes.push('упаковка не указана — посчитана как $0');
  if (miles === null && !errors.miles) notes.push('мили не указаны — поездка посчитана как $0');
  else if (miles > 0 && typeof settings.mileRate !== 'number') notes.push('ставки за милю на сегодня нет в реестре правил — поездка посчитана как $0');

  // Потолок покупки — только когда смета полная (доставка и данные спроса известны).
  const ceilingOk = cat && shipKnown && !coreMissing.length && !Object.keys(errors).length;
  const ceiling = ceilingOk ? { high: maxOffer(cc, comps, costs, 'high'), low: maxOffer(cc, comps, costs, 'low') } : null;

  const base = { str, errors, notes, warnings, category: cat, own };
  if (input.stop === true) {
    return { ...base, kind: 'skip', stop: true, reasons: ['отмечено «из стоп-листа» (хладагент, ртуть, катализатор, отзывной товар или подделка) — не берём, даже если выгодно'], net: null, maxOffer: null, ceiling: null, breakdown: null };
  }
  if (!core || coreMissing.length || appMissing.length) {
    const reasons = [...coreMissing, ...appMissing];
    // Если не хватает только цены — потолок всё равно полезен для торга.
    const onlyPrice = priceMissing && appMissing.length === 1 && !coreMissing.length && ceilingOk;
    return { ...base, kind: 'insufficient', reasons, net: null, maxOffer: onlyPrice ? ceiling.high : null, ceiling: onlyPrice ? ceiling : null, breakdown: null };
  }

  // Смета полная: решение — целиком из ядра.
  const gross = med + shipCharged;
  const atZero = netProfit(cat, comps, { estBuyerTax: costs.estBuyerTax });
  const breakdown = {
    sale: med,
    shipCharged,
    fees: round2(gross - atZero),
    label,
    packaging: costs.packaging,
    buyPrice,
    trip: round2(costs.miles * costs.mileRate),
    net: core.net,
  };
  const reasons = [];
  if (core.kind === 'skip') reasons.push(...core.reasons.map((r) => humanReason(r, cat)));
  else {
    reasons.push(`чистыми ${fmtMoney(core.net)} — не меньше минимума ${fmtMoney(cat.minNet, { cents: false })}`);
    reasons.push(cat.minStr === null ? `спрос (STR) ${fmtPct(str)} — для этой категории не проверяется` : `спрос (STR) ${fmtPct(str)} — не ниже ${fmtPct(cat.minStr)}`);
    if (core.kind === 'buy') reasons.push(`цена покупки ${fmtMoney(buyPrice)} не выше потолка ${fmtMoney(core.maxOffer, { cents: false })}`);
    else reasons.push(`просят ${fmtMoney(buyPrice)} — выше потолка ${fmtMoney(core.maxOffer, { cents: false })}: дороже не выйдет ${fmtMoney(cat.minNet, { cents: false })} прибыли или больше ${fmtPct(cat.buyCeilingHigh)} от медианы`);
  }
  return {
    ...base,
    kind: core.kind,
    reasons,
    net: core.net,
    maxOffer: core.kind === 'skip' ? (ceiling ? ceiling.high : null) : core.maxOffer,
    ceiling,
    breakdown,
  };
}

export function verdictTitle(result) {
  if (result.own && result.kind === 'buy') return 'ПРОДАВАТЬ';
  if (result.own && result.kind === 'skip') return 'НЕ СТОИТ ПРОДАВАТЬ';
  if (result.kind === 'offer') return `ПРЕДЛОЖИТЬ максимум ${fmtMoney(result.maxOffer, { cents: false })}`;
  return VERDICT_TEXT[result.kind];
}

// ---------- склад ----------

const INPUT_TEXT_KEYS = ['title', 'categoryId', 'median', 'sold90', 'active', 'shipMode', 'shipCharged', 'label', 'buyPrice', 'packaging', 'miles', 'note'];
const INPUT_BOOL_KEYS = ['own', 'stop', 'prius'];

// Черновик / введённые данные оценки: только известные поля, строки и галочки (никаких объектов из чужих данных).
export function cleanDraft(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = {};
  for (const k of INPUT_TEXT_KEYS) if (typeof o[k] === 'string') out[k] = o[k].slice(0, 500);
  for (const k of INPUT_BOOL_KEYS) out[k] = o[k] === true;
  return out;
}

export function isEvalEmpty(input) {
  return !['title', 'median', 'sold90', 'active', 'buyPrice'].some((k) => String((input && input[k]) || '').trim());
}

// decision: 'take' — «беру / думаю» (в склад), 'pass' — «не беру» (только в журнал решений, ТЗ сценарий А п. 6).
export function makeItem(settings, input, result, now = new Date(), decision = 'take') {
  const cat = settings.categories.find((c) => c.id === input.categoryId) || null;
  const title = String(input.title || '').trim().slice(0, 200) || `Вещь от ${fmtDate(todayLocal(now))}`;
  return {
    id: newId(),
    createdAt: now.toISOString(),
    title,
    categoryId: cat ? cat.id : null,
    origin: input.own ? 'personal' : 'bought',
    status: 'evaluated',
    decision: { verdict: decision === 'pass' ? 'pass' : 'take', note: String(input.note || '').trim().slice(0, 500) },
    eval: {
      at: now.toISOString(),
      input: cleanDraft(input),
      result: { kind: result.kind, title: verdictTitle(result), net: result.net, str: result.str, maxOffer: result.maxOffer ?? null, reasons: [...result.reasons], warnings: [...(result.warnings || [])] },
      category: cat ? { ...cat } : null,
      mileRate: typeof settings.mileRate === 'number' ? settings.mileRate : null,
      buyerTaxPct: settings.buyerTaxPct,
      source: 'manual_ebay_app',
    },
    have: null,
    listed: null,
    sold: null,
    paid: null,
    checked: null,
    shipped: null,
    writeoff: null,
    pastSales: [],
  };
}

export function statusIndex(s) {
  return STATUSES.indexOf(s);
}

// Сколько шагов основного пути пройдено (у списанной вещи — до списания).
export function doneIndex(item) {
  if (item.status === 'writeoff') return item.listed ? 2 : 1;
  return statusIndex(item.status);
}

export function isPassed(item) {
  return item.status === 'evaluated' && !!item.decision && item.decision.verdict === 'pass';
}

export function statusLabel(item) {
  switch (item.status) {
    case 'evaluated': return isPassed(item) ? 'Не взял' : 'Оценена';
    case 'have': return (item.have && item.have.origin !== 'bought' ? 'Своя, на складе' : 'Куплена') + (hasReturns(item) ? ' · вернули после продажи' : '');
    case 'listed': return 'Выставлена';
    case 'sold': return (item.shipped ? 'Отправлена' : 'Продана') + ' — деньги в пути' + (item.sold && item.sold.refund ? ' · возврат' : '');
    case 'paid':
      if (item.paid && item.paid.cash) return 'Продана за наличные' + (item.sold && item.sold.refund ? ' · возврат' : '');
      return 'Деньги пришли' + (item.sold && item.sold.refund ? ' · возврат' : '');
    case 'writeoff': return item.writeoff && item.writeoff.kind === 'scrap' ? 'Списана: лом' : 'Списана: не продана';
    default: return String(item.status);
  }
}

export function nextStep(item) {
  if (item.status === 'writeoff') return null;
  const i = statusIndex(item.status);
  return i >= 0 && i < STATUSES.length - 1 ? STATUSES[i + 1] : null;
}

export function nextStepLabel(item) {
  switch (nextStep(item)) {
    case 'have': return item.origin === 'bought' ? 'Купил' : 'Своя — беру в продажу';
    case 'listed': return 'Выставил на продажу';
    case 'sold': return 'Продал';
    case 'paid': return 'Деньги пришли';
    default: return null;
  }
}

const prevDateOf = (item, step) => {
  const order = ['have', 'listed', 'sold', 'paid'];
  for (let i = order.indexOf(step) - 1; i >= 0; i--) {
    const d = item[order[i]];
    if (d && d.date) return { date: d.date, step: order[i] };
  }
  return null;
};

const STEP_DATE_NAME = { have: 'покупки', listed: 'выставления', sold: 'продажи', paid: 'выплаты' };

// ---------- возвраты ----------
// Два случая (ТЗ M2 «возврат», M4 refund):
//  1) деньги вернули, вещь осталась у покупателя (частичный или полный refund) — поле sold.refund с датой
//     sold.refundDate: в учёте возврат идёт в год, когда вернули деньги (старые записи без даты — в год продажи);
//  2) вещь вернули на склад — «Вещь вернули» (returnToStock): продажа с её расходами (этикетка, комиссия,
//     упаковка) остаётся в учёте своего года в item.pastSales, а возврат денег, обратная доставка, возвращённая
//     комиссия и себестоимость, вернувшаяся на склад, — в год возврата. Вещь снова «на складе» и продаётся заново.

export const hasReturns = (item) => Array.isArray(item.pastSales) && item.pastSales.length > 0;
export function lastReturnDate(item) {
  return hasReturns(item) ? item.pastSales[item.pastSales.length - 1].returned.date : null;
}
// Дата, с которой возврат денег идёт в учёт: записанная дата возврата, у старых записей — дата продажи.
export function refundDateOf(sold) {
  if (!sold || !(n0(sold.refund) > 0)) return null;
  return isDate(sold.refundDate) ? sold.refundDate : sold.date;
}
// Все продажи вещи: прошлые (вернулись на склад) и текущая. returned — данные возврата на склад или null.
export function saleRecords(item) {
  const out = (item.pastSales || []).map((p) => ({ listed: p.listed, sold: p.sold, paid: p.paid, shipped: p.shipped, returned: p.returned }));
  if ((item.status === 'sold' || item.status === 'paid') && item.sold) out.push({ listed: item.listed, sold: item.sold, paid: item.paid, shipped: item.shipped, returned: null });
  return out;
}

// Себестоимость вещи (ТЗ M4): цена + налог + комиссия аукциона + доставка до Георгия.
export function basisOf(have) {
  if (!have) return 0;
  return round2(n0(have.buyPrice) + n0(have.salesTax) + n0(have.buyerPremium) + n0(have.freight));
}

// Следующий свободный SKU вида PK-0001 (Георгий может заменить своим).
export function nextSku(items, offset = 0) {
  let max = 0;
  for (const it of items) {
    const m = it.have && typeof it.have.sku === 'string' ? it.have.sku.match(/^PK-(\d{1,9})$/) : null;
    if (m) max = Math.max(max, Number(m[1]));
  }
  return 'PK-' + String(max + 1 + offset).padStart(4, '0');
}

function cashPaid(s) {
  return { date: s.date, amount: round2(s.price + s.shipCharged - n0(s.refund)), payoutId: '', withheld: null, cash: true };
}

// Ставка за милю на дату покупки/лота — из реестра. Если на эту дату правила нет, а дата не менялась —
// остаётся прежняя записанная ставка; иначе null («неизвестна», не $0).
function rateOnDate(settings, date, prev) {
  const r = mileRateFor(rulesOf(settings), date);
  if (r) return r.value;
  return prev && prev.date === date && typeof prev.mileRate === 'number' ? prev.mileRate : null;
}

// Поездка за покупкой уже записана в журнале → покупка ссылается на неё (tripId), а мили покупки = 0,
// чтобы одна поездка не посчиталась дважды. raw.tripPick: '' / 'new' — свои мили, иначе id поездки.
function pickTrip(raw, date, settings, errors) {
  const pick = typeof raw.tripPick === 'string' ? raw.tripPick : '';
  if (!pick || pick === 'new') return { tripId: null };
  const t = ((settings && settings.trips) || []).find((x) => x.id === pick);
  if (!t) { errors.tripPick = 'поездка не найдена в журнале'; return { tripId: null }; }
  if (t.date !== date) { errors.tripPick = `поездка в журнале — за ${fmtDate(t.date)}, а дата здесь другая: выберите заново`; return { tripId: null }; }
  return { tripId: t.id };
}

// Комиссия продажи по видам: сумма и признак «введена» (иначе — оценка по % категории).
export function feesOf(sold) {
  const fb = (sold && sold.feesByType) || {};
  const platformKnown = sold && sold.channel === 'cash' ? true : [fb.finalValue, fb.perOrder, fb.other].some((v) => typeof v === 'number');
  return {
    known: platformKnown,
    finalValue: n0(fb.finalValue), perOrder: n0(fb.perOrder), ads: n0(fb.ads), other: n0(fb.other),
    total: round2(n0(fb.finalValue) + n0(fb.perOrder) + n0(fb.ads) + n0(fb.other)),
  };
}

// Проверка данных шага. raw — строки из формы. Возвращает { ok, data, errors }.
export function validateStep(item, step, raw, settings) {
  const errors = {};
  const num = (key, preset) => {
    const r = parseNumber(raw[key], preset);
    if (r.error) errors[key] = r.error;
    return r.value;
  };
  const text = (key, max) => {
    const v = String(raw[key] ?? '').trim();
    if (v.length > max) errors[key] = `не длиннее ${max} знаков`;
    return v.slice(0, max);
  };
  const today = (settings && settings.today) || todayLocal();
  const date = String(raw.date || '').trim();
  if (!isDate(date)) errors.date = 'укажите дату';
  else {
    const prev = prevDateOf(item, step);
    const ret = lastReturnDate(item);
    if (prev && date < prev.date) errors.date = `дата ${STEP_DATE_NAME[step]} раньше даты ${STEP_DATE_NAME[prev.step]} (${fmtDate(prev.date)})`;
    else if (ret && step !== 'have' && date < ret) errors.date = `дата ${STEP_DATE_NAME[step]} раньше возврата вещи (${fmtDate(ret)})`;
    checkNotFuture(date, today, errors);
  }
  let data = null;
  if (step === 'have') {
    const origin = Object.hasOwn(ORIGINS, raw.origin) ? raw.origin : null;
    if (!origin) errors.origin = 'выберите, откуда вещь';
    let buyPrice = num('buyPrice', NUM.money);
    if (origin === 'personal') buyPrice = 0;
    else if (origin === 'own_stock' && buyPrice === null && !errors.buyPrice) buyPrice = 0; // ТЗ M2: себестоимость 0 или подтверждённая
    else if (origin === 'bought' && buyPrice === null && !errors.buyPrice) errors.buyPrice = 'введите, сколько заплатили';
    const extra = (k) => (origin === 'personal' ? 0 : num(k, NUM.money) ?? 0);
    const trip = pickTrip(raw, date, settings, errors);
    const miles = trip.tripId ? 0 : num('miles', NUM.miles);
    data = {
      date, origin, buyPrice,
      salesTax: extra('salesTax'), buyerPremium: extra('buyerPremium'), freight: extra('freight'),
      place: text('place', 100), seller: text('seller', 100), sku: text('sku', 40), location: text('location', 80),
      miles: miles ?? 0, mileRate: rateOnDate(settings, date, item.have), lotId: (item.have && item.have.lotId) || null,
      tripId: trip.tripId,
    };
  } else if (step === 'listed') {
    const price = num('price', NUM.money);
    data = { date, price };
  } else if (step === 'sold') {
    const channel = Object.hasOwn(CHANNELS, raw.channel) ? raw.channel : null;
    if (!channel) errors.channel = 'выберите, где продали';
    const price = num('price', NUM.money);
    if (price === null && !errors.price) errors.price = 'введите цену продажи';
    else if (price !== null && !(price > 0)) errors.price = 'цена должна быть больше 0';
    let shipCharged = num('shipCharged', NUM.money);
    let label = num('label', NUM.money); // пусто = ещё не знаю (прибыль будет «неизвестна», не $0)
    const packaging = num('packaging', NUM.money);
    // Комиссия по видам (ТЗ M4, fees_by_type). Комиссия площадки (final value fee), фикс. сбор за заказ и прочее
    // пустые все три — eBay: посчитать по % категории (помечается «≈»). Реклама — отдельно, пусто = $0.
    let fees = { finalValue: num('feeFinal', NUM.money), perOrder: num('feeOrder', NUM.money), ads: num('feeAds', NUM.money), other: num('feeOther', NUM.money) };
    const taxCollected = num('taxCollected', NUM.money); // налог, который удержала площадка: не доход
    const refund = num('refund', NUM.money);
    if (channel === 'cash') {
      // Наличные при встрече: доставки, этикетки и комиссии нет, деньги на руках сразу.
      fees = { finalValue: 0, perOrder: 0, ads: 0, other: 0 };
      if (shipCharged === null) shipCharged = 0;
      if (label === null) label = 0;
    } else {
      if (shipCharged === null && !errors.shipCharged) errors.shipCharged = 'введите 0, если доставка бесплатная';
      if (fees.finalValue === null && !errors.feeFinal) {
        if (channel === 'marketplace' || channel === 'offerup') errors.feeFinal = 'введите комиссию площадки (0 — если встречались лично)';
        else if (fees.perOrder !== null || fees.other !== null) errors.feeFinal = 'введите и комиссию площадки — иначе итог неполный (или очистите поля комиссии: посчитаем по % категории)';
      }
    }
    if (refund !== null && price !== null && shipCharged !== null && refund > price + shipCharged) errors.refund = 'возврат больше суммы продажи';
    // Дата возврата денег: возврат уменьшает доход того года, когда деньги вернули (а не года продажи).
    // Нет поля в данных (старый вызов) — дата продажи; поле есть, но пустое — ошибка.
    let refundDate = null;
    if (refund !== null && refund > 0) {
      refundDate = raw.refundDate === undefined ? date : String(raw.refundDate || '').trim();
      if (!isDate(refundDate)) errors.refundDate = 'укажите дату, когда вернули деньги';
      else if (isDate(date) && refundDate < date) errors.refundDate = `дата возврата раньше продажи (${fmtDate(date)})`;
      else checkNotFuture(refundDate, today, errors, 'refundDate');
    }
    data = {
      date, channel, price, shipCharged, label, packaging: packaging ?? 0, feesByType: fees, feesCombined: false,
      taxCollected: channel === 'cash' ? null : taxCollected, refund: refund ?? 0, refundDate,
      feeBasis: settings && settings.categories ? feeBasisFor(item, settings) : null,
    };
  } else if (step === 'paid') {
    const amount = num('amount', NUM.money);
    const withheld = num('withheld', NUM.money);
    data = { date, amount, payoutId: text('payoutId', 80), withheld, cash: false };
  } else {
    errors.step = 'неизвестный шаг';
  }
  const ok = Object.keys(errors).length === 0;
  return { ok, data: ok ? data : null, errors };
}

// Перевести вещь на следующий статус (с данными шага).
export function advance(item, raw, settings) {
  const step = nextStep(item);
  if (!step) return { ok: false, errors: { step: 'вещь уже закрыта' } };
  const v = validateStep(item, step, raw, settings);
  if (!v.ok) return v;
  const out = { ...item, [step]: v.data, status: step };
  if (step === 'have') out.origin = v.data.origin;
  // Наличные: продажа и деньги — одно событие; срок выплаты для eBay они не искажают.
  if (step === 'sold' && v.data.channel === 'cash') {
    out.status = 'paid';
    out.paid = cashPaid(v.data);
    out.shipped = null;
  }
  return { ok: true, item: out, errors: {} };
}

const fail = (errors) => ({ ok: false, data: null, errors });

// Исправить данные уже пройденного шага, не меняя статус.
export function editStep(item, step, raw, settings) {
  if (statusIndex(step) < 1 || statusIndex(step) > doneIndex(item)) return fail({ step: 'шаг ещё не пройден' });
  if (step === 'paid' && item.paid && item.paid.cash) return fail({ step: 'наличные: деньги получены в день продажи — исправьте шаг «Продал»' });
  // Вещь из лота: цена, дата и происхождение посчитаны вместе с другими вещами — меняются только SKU и место.
  if (step === 'have' && item.have && item.have.lotId) {
    const sku = String(raw.sku ?? '').trim();
    const location = String(raw.location ?? '').trim();
    const errors = {};
    if (sku.length > 40) errors.sku = 'не длиннее 40 знаков';
    if (location.length > 80) errors.location = 'не длиннее 80 знаков';
    if (Object.keys(errors).length) return fail(errors);
    return { ok: true, item: { ...item, have: { ...item.have, sku, location } }, errors: {} };
  }
  const v = validateStep(item, step, raw, settings);
  if (!v.ok) return v;
  // правка продажи не меняет снимок % категории для оценки комиссии (иначе прошлые годы «поплывут»)
  if (step === 'sold' && item.sold && item.sold.feeBasis) v.data.feeBasis = item.sold.feeBasis;
  if (step === 'have' && hasReturns(item) && v.data.date > item.pastSales[0].listed.date) return fail({ date: `дата позже первого выставления (${fmtDate(item.pastSales[0].listed.date)})` });
  // дата не может стать позже следующего события
  const order = ['have', 'listed', 'sold', 'paid'];
  const next = item[order[order.indexOf(step) + 1]];
  const nextIsCash = step === 'sold' && item.paid && item.paid.cash;
  if (next && next.date && !nextIsCash && v.data.date > next.date) return fail({ date: `дата позже следующего шага (${fmtDate(next.date)})` });
  if (item.writeoff && v.data.date > item.writeoff.date) return fail({ date: `дата позже списания (${fmtDate(item.writeoff.date)})` });
  if (step === 'have' && item.checked && v.data.date > item.checked.date) return fail({ date: `дата позже проверки (${fmtDate(item.checked.date)})` });
  if (step === 'sold' && item.shipped && v.data.channel !== 'cash' && v.data.date > item.shipped.date) return fail({ date: `дата позже отправки (${fmtDate(item.shipped.date)})` });
  const out = { ...item, [step]: v.data };
  if (step === 'have') out.origin = v.data.origin;
  if (step === 'sold') {
    if (v.data.channel === 'cash') {
      out.status = 'paid';
      out.paid = cashPaid(v.data);
      out.shipped = null;
    } else if (item.paid && item.paid.cash) {
      out.status = 'sold';
      out.paid = null;
    }
  }
  return { ok: true, item: out, errors: {} };
}

export function stepBack(item) {
  if (item.status === 'writeoff') return { ...item, status: item.writeoff ? item.writeoff.fromStatus : 'have', writeoff: null };
  const i = statusIndex(item.status);
  if (i <= 0) return item;
  // вещь вернулась на склад после продажи → шаг назад = отменить возврат (продажа снова как была)
  if (item.status === 'have' && hasReturns(item)) {
    const p = item.pastSales[item.pastSales.length - 1];
    return { ...item, status: p.paid ? 'paid' : 'sold', listed: p.listed, sold: p.sold, paid: p.paid, shipped: p.shipped, pastSales: item.pastSales.slice(0, -1) };
  }
  if (item.status === 'have' && item.have && item.have.lotId) return item; // из лота назад не откатываем: доли посчитаны вместе
  if (item.status === 'paid' && item.paid && item.paid.cash) return { ...item, status: 'listed', sold: null, paid: null, shipped: null };
  const out = { ...item, [item.status]: null, status: STATUSES[i - 1] };
  if (item.status === 'sold') out.shipped = null;
  if (item.status === 'have') out.checked = null;
  return out;
}

// «Вещь вернули — снова на складе» (ТЗ M2: статус «возврат»). Продажа не стирается: она уходит в pastSales
// вместе с выставлением, выплатой и отправкой и остаётся в учёте своего года (доход, этикетка, комиссия).
// В год возврата: вернули покупателю (refund), обратная доставка, комиссия, которую вернула площадка,
// и себестоимость вещи снова на складе. raw: date, refund (сколько вернули, 0 — ничего), returnShipping, feeCredit, note.
export function returnToStock(item, raw, now = new Date()) {
  const s = item.sold;
  if (!s || (item.status !== 'sold' && item.status !== 'paid')) return fail({ step: 'возврат отмечают для проданной вещи' });
  const errors = {};
  const num = (key) => {
    const r = parseNumber(raw[key], NUM.money);
    if (r.error) errors[key] = r.error;
    return r.value;
  };
  const date = String(raw.date || '').trim();
  const floor = [s.date, item.shipped && item.shipped.date, refundDateOf(s)].filter(Boolean).sort().pop();
  if (!isDate(date)) errors.date = 'укажите дату';
  else if (date < floor) errors.date = `дата раньше продажи, отправки или прошлого возврата денег (${fmtDate(floor)})`;
  else checkNotFuture(date, todayLocal(now), errors);
  const gross = round2(s.price + s.shipCharged);
  const left = round2(gross - n0(s.refund));
  const refund = num('refund');
  if (refund === null && !errors.refund) errors.refund = 'сколько вернули покупателю? (0 — если ничего)';
  else if (refund !== null && refund > left) errors.refund = n0(s.refund) ? `больше, чем осталось после прошлого возврата (${fmtMoney(left)})` : `больше суммы продажи (${fmtMoney(gross)})`;
  const returnShipping = num('returnShipping') ?? 0;
  const feeCredit = num('feeCredit') ?? 0;
  if (feeCredit > gross && !errors.feeCredit) errors.feeCredit = 'больше суммы продажи';
  const note = String(raw.note ?? '').trim();
  if (note.length > 200) errors.note = 'не длиннее 200 знаков';
  if (Object.keys(errors).length) return fail(errors);
  const past = { listed: item.listed, sold: s, paid: item.paid, shipped: item.shipped, returned: { date, refund, returnShipping, feeCredit, note } };
  return { ok: true, item: { ...item, status: 'have', listed: null, sold: null, paid: null, shipped: null, pastSales: [...(item.pastSales || []), past] }, errors: {} };
}

// «Списать»: не продано или лом (ТЗ M2). Себестоимость остаётся в учёте.
export function writeOff(item, raw, now = new Date()) {
  if (item.status !== 'have' && item.status !== 'listed') return fail({ step: 'списать можно вещь на складе' });
  const errors = {};
  const date = String(raw.date || '').trim();
  const ret = lastReturnDate(item);
  const last = item.status === 'listed' ? item.listed.date : ret && ret > item.have.date ? ret : item.have.date;
  if (!isDate(date)) errors.date = 'укажите дату';
  else if (date < last) errors.date = `дата раньше ${item.status === 'listed' ? 'выставления' : last === ret ? 'возврата вещи' : 'покупки'} (${fmtDate(last)})`;
  else checkNotFuture(date, todayLocal(now), errors);
  const kind = Object.hasOwn(WRITEOFF_KINDS, raw.kind) ? raw.kind : null;
  if (!kind) errors.kind = 'выберите: не продано или лом';
  const note = String(raw.note ?? '').trim();
  if (note.length > 300) errors.note = 'не длиннее 300 знаков';
  if (Object.keys(errors).length) return fail(errors);
  return { ok: true, item: { ...item, status: 'writeoff', writeoff: { date, kind, note, fromStatus: item.status } }, errors: {} };
}

// «Проверил» (ТЗ M2: статус «проверено») — отметка, путь вещи не меняется.
export function markChecked(item, raw, now = new Date()) {
  if (item.status !== 'have' && item.status !== 'listed') return fail({ step: 'проверку отмечают для вещи на складе' });
  const errors = {};
  const date = String(raw.date || '').trim();
  if (!isDate(date)) errors.date = 'укажите дату';
  else if (date < item.have.date) errors.date = `дата раньше покупки (${fmtDate(item.have.date)})`;
  else checkNotFuture(date, todayLocal(now), errors);
  const result = Object.hasOwn(CHECK_RESULTS, raw.result) ? raw.result : null;
  if (!result) errors.result = 'выберите результат проверки';
  const note = String(raw.note ?? '').trim();
  if (note.length > 300) errors.note = 'не длиннее 300 знаков';
  if (Object.keys(errors).length) return fail(errors);
  return { ok: true, item: { ...item, checked: { date, result, note } }, errors: {} };
}

// «Отправил» (ТЗ M2: статус «отправлено») — дата и трек; деньги по-прежнему ждём от площадки.
export function markShipped(item, raw, now = new Date()) {
  if (!item.sold || (item.status !== 'sold' && item.status !== 'paid') || item.sold.channel === 'cash') return fail({ step: 'отправку отмечают для проданной вещи (не за наличные)' });
  const errors = {};
  const date = String(raw.date || '').trim();
  if (!isDate(date)) errors.date = 'укажите дату';
  else if (date < item.sold.date) errors.date = `дата раньше продажи (${fmtDate(item.sold.date)})`;
  else checkNotFuture(date, todayLocal(now), errors);
  const tracking = String(raw.tracking ?? '').trim();
  if (tracking.length > 60) errors.tracking = 'не длиннее 60 знаков';
  if (Object.keys(errors).length) return fail(errors);
  return { ok: true, item: { ...item, shipped: { date, tracking } }, errors: {} };
}

export function categoryFor(item, settings) {
  return settings.categories.find((c) => c.id === item.categoryId) || (item.eval && item.eval.category) || settings.categories[0];
}

// Снимок на день продажи: % и плата за заказ категории, налог покупателя. По нему считается «≈ комиссия»,
// если комиссию не ввели, — чтобы правка настроек сегодня не меняла сводку и CSV прошлых лет.
export function feeBasisFor(item, settings) {
  const c = categoryFor(item, settings);
  return { feePct: c.feePct, perOrderFee: c.perOrderFee, buyerTaxPct: settings.buyerTaxPct };
}

// Итог продажи: валовая сумма, комиссия, чистая прибыль (через netProfit ядра).
export function saleResult(item, settings) {
  const s = item.sold;
  if (!s) return null;
  const fb0 = s.feeBasis;
  const cat = fb0 ? { ...categoryFor(item, settings), feePct: fb0.feePct, perOrderFee: fb0.perOrderFee } : categoryFor(item, settings);
  const buyerTaxPct = fb0 ? fb0.buyerTaxPct : settings.buyerTaxPct;
  const fo = feesOf(s);
  const feesKnown = fo.known;
  const adFee = fo.ads;
  const refund = n0(s.refund);
  // введённая комиссия → категория с feePct 0 и «за заказ» = сумма комиссий по видам (с рекламой);
  // иначе — % категории + её плата за заказ (+ реклама)
  const feeCat = feesKnown ? { ...cat, feePct: 0, perOrderFee: fo.total } : { ...cat, perOrderFee: cat.perOrderFee + adFee };
  const estBuyerTax = feesKnown ? 0 : typeof s.taxCollected === 'number' ? s.taxCollected : buyerTaxPct * (s.price + s.shipCharged);
  const comps = { medianSold: s.price, sold90: null, activeNow: null, shipCharged: s.shipCharged };
  const gross = round2(s.price + s.shipCharged);
  const fees = round2(gross - netProfit(feeCat, comps, { estBuyerTax }));
  const feesEstimated = !feesKnown;
  // Комиссия по видам для сводки: введённые числа или (если не введены) оценка площадки отдельной строкой.
  const feesByType = feesKnown
    ? { finalValue: fo.finalValue, perOrder: fo.perOrder, ads: fo.ads, other: fo.other, estimated: 0 }
    : { finalValue: 0, perOrder: 0, ads: fo.ads, other: 0, estimated: round2(fees - fo.ads) };
  // Сколько придёт от площадки: продажа минус комиссии и возврат (налог площадка перечисляет сама, это не доход).
  const payout = round2(gross - fees - refund);
  const base = { gross, fees, feesEstimated, feesByType, refund, payout };
  if (s.label === null || s.label === undefined) {
    return { ...base, net: null, incomplete: 'нет стоимости этикетки' };
  }
  const h = item.have || {};
  if (n0(h.miles) > 0 && typeof h.mileRate !== 'number') {
    return { ...base, net: null, incomplete: 'нет ставки за милю на дату покупки (добавьте её в реестр правил)' };
  }
  // возврат покупателю уменьшает итог сделки (в формуле ядра его нет — вычитается отдельно)
  const net = netProfit(feeCat, comps, {
    buyPrice: basisOf(h),
    label: s.label,
    packaging: s.packaging ?? 0,
    miles: h.miles ?? 0,
    mileRate: h.mileRate ?? 0,
    estBuyerTax,
  }) - refund;
  return { ...base, net: round2(net), incomplete: null };
}

// Сколько денег ждём от площадки: продажа минус комиссия и возврат (примерно, если комиссия не введена).
export function expectedPayout(item, settings) {
  const r = saleResult(item, settings);
  return r ? r.payout : null;
}

// Выплата: факт — только после «деньги пришли» (payoutDays ядра); до этого — отдельная оценка
// по своим прошлым выплатам той же площадки или «неизвестно» (критерий dot). Наличные в оценку не входят.
export function payoutInfo(item, items, settings) {
  if (item.status === 'paid' && item.sold && item.paid) {
    if (item.paid.cash) return { state: 'cash', days: null };
    return { state: 'paid', days: payoutDays(item.sold.date, item.paid.date) };
  }
  if (item.status === 'sold' && item.sold) {
    const hist = ownPayoutStats(items, item.sold.channel);
    const minN = settings.payoutEstimateMinN ?? 3;
    if (hist.n >= minN) {
      return { state: 'transit', days: null, estimateDays: hist.medianDays, estimateN: hist.n, expectedDate: addDays(item.sold.date, Math.ceil(hist.medianDays)) };
    }
    return { state: 'transit', days: null, estimateDays: null, estimateN: hist.n, needN: minN };
  }
  return null;
}

export function ownPayoutStats(items, channel = null) {
  const days = items
    .filter((it) => it.status === 'paid' && it.sold && it.paid && !it.paid.cash && (channel === null || it.sold.channel === channel))
    .map((it) => payoutDays(it.sold.date, it.paid.date))
    .filter((d) => d !== null);
  return { n: days.length, medianDays: median(days) };
}

// Счётчики 1099-K за год по каждой площадке (кроме наличных): сумма продаж с доставкой и число сделок.
// Порог — из реестра правил на этот налоговый год; если правила нет, overThreshold = null («порог неизвестен»).
export function k1099Counters(state, year) {
  // все продажи года, в том числе те, после которых вещь вернули (1099-K считает платежи без вычета возвратов)
  const byCh = {};
  for (const it of state.items) {
    for (const { sold } of saleRecords(it)) {
      if (sold.channel !== 'cash' && sold.date.slice(0, 4) === String(year)) (byCh[sold.channel] ||= []).push({ gross: round2(sold.price + sold.shipCharged) });
    }
  }
  const rule = k1099For(state.taxRules || builtinRules(), year);
  const k1099 = Object.keys(CHANNELS)
    .filter((ch) => ch !== 'cash' && (ch === 'ebay' || byCh[ch]))
    .map((ch) => {
      const st = form1099kStatus(byCh[ch] || [], rule || { minGross: Infinity, minCount: Infinity });
      return { channel: ch, year, gross: round2(st.gross), count: st.count, overThreshold: rule ? st.overThreshold : null };
    });
  return { k1099, k1099Rule: rule };
}

export function totals(state, year = Number(todayLocal().slice(0, 4))) {
  const { items, settings } = state;
  const counts = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0]));
  let invested = 0, trips = 0, stockCount = 0, stockBasis = 0, woCount = 0, woBasis = 0;
  let soldCount = 0, soldGross = 0, netSum = 0, netIncomplete = 0, feesEstimated = 0, refundCount = 0, refundSum = 0;
  let transitCount = 0, transitAmount = 0, receivedCount = 0, receivedAmount = 0, receivedEstimated = 0, cashCount = 0;
  let evaluated = 0, passed = 0;
  for (const it of items) {
    counts[it.status] = (counts[it.status] || 0) + 1;
    if (it.status === 'evaluated') {
      evaluated++;
      if (isPassed(it)) passed++;
      continue;
    }
    if (it.have) {
      const b = basisOf(it.have);
      invested += b;
      if (it.status === 'have' || it.status === 'listed') { stockCount++; stockBasis += b; }
      if (it.status === 'writeoff') { woCount++; woBasis += b; }
      // продажи, после которых вещь вернули на склад: себестоимость снова на складе, убыток — этикетка,
      // упаковка, невозвращённая комиссия, обратная доставка
      // (себестоимость и поездка за покупкой снова «в вещи» — войдут в её следующую продажу, а не в эту)
      const tripCost = n0(it.have.miles) * n0(it.have.mileRate);
      for (const p of it.pastSales || []) {
        const r = saleResult({ ...it, sold: p.sold }, settings);
        refundCount++;
        refundSum += r.refund + p.returned.refund;
        if (r.net === null) netIncomplete++;
        else netSum += r.net + b + tripCost - p.returned.refund - p.returned.returnShipping + p.returned.feeCredit;
      }
    }
    if ((it.status === 'sold' || it.status === 'paid') && it.sold) {
      const r = saleResult(it, settings);
      soldCount++;
      soldGross += r.gross;
      if (r.net === null) netIncomplete++;
      else netSum += r.net;
      if (r.feesEstimated) feesEstimated++;
      if (r.refund) { refundCount++; refundSum += r.refund; }
      if (it.status === 'sold') {
        transitCount++;
        transitAmount += r.payout;
      } else {
        receivedCount++;
        if (it.paid && it.paid.cash) cashCount++;
        const factAmount = it.paid && typeof it.paid.amount === 'number';
        if (!factAmount) receivedEstimated++;
        receivedAmount += factAmount ? it.paid.amount : r.payout;
      }
    }
  }
  // мили: журнал + мили покупок и лотов, по ставке на дату (без ставки — не в сумме, видно в «Учёте»)
  trips = mileageGroups(tripRows(state)).amount;
  const { k1099, k1099Rule } = k1099Counters(state, year);
  const payout = ownPayoutStats(items, 'ebay');
  return {
    counts,
    invested: round2(invested),
    trips: round2(trips),
    k1099Rule,
    stock: { count: stockCount, basis: round2(stockBasis) },
    writeoff: { count: woCount, basis: round2(woBasis) },
    sold: { count: soldCount, gross: round2(soldGross) },
    net: { value: round2(netSum), incomplete: netIncomplete, feesEstimated },
    refunds: { count: refundCount, amount: round2(refundSum) },
    transit: { count: transitCount, amount: round2(transitAmount) },
    // estimated — сколько выплат без введённой суммы (сумма по ним — оценка: продажа минус комиссия)
    received: { count: receivedCount, amount: round2(receivedAmount), estimated: receivedEstimated, cash: cashCount },
    payout,
    decisions: { evaluated, passed },
    k1099,
  };
}

// ---------- лот ----------

// Покупка лота: цена делится по вещам пропорционально оценкам (allocateLot ядра, до цента).
// entries: [{ itemId } | { title }, weight] ; новые вещи создаются сразу «куплены».
export function applyLot(state, raw, now = new Date()) {
  const errors = {};
  const total = parseNumber(raw.total, NUM.money);
  if (total.error) errors.total = total.error;
  else if (total.value === null) errors.total = 'введите цену лота';
  const date = String(raw.date || '').trim();
  if (!isDate(date)) errors.date = 'укажите дату';
  checkNotFuture(date, todayLocal(now), errors);
  const trip = pickTrip(raw, date, { trips: state.trips || [] }, errors);
  const miles = trip.tripId ? { value: 0, error: null } : parseNumber(raw.miles, NUM.miles);
  if (miles.error) errors.miles = miles.error;
  const place = String(raw.place ?? '').trim().slice(0, 100);
  const seller = String(raw.seller ?? '').trim().slice(0, 100);
  const entries = (raw.entries || []).filter((e) => e && (e.itemId || String(e.title || '').trim()));
  if (entries.length < 2) errors.entries = 'в лоте должно быть хотя бы 2 вещи';
  const weights = entries.map((e, i) => {
    const w = parseNumber(e.weight, NUM.money);
    if (w.error || w.value === null) errors['w' + i] = 'введите оценку каждой вещи, $' + (w.error ? ` (${w.error})` : '');
    return w.value ?? 0;
  });
  const seen = new Set();
  for (const e of entries) {
    if (e.itemId) {
      if (seen.has(e.itemId)) errors.entries = 'одна вещь выбрана дважды';
      seen.add(e.itemId);
      const it = state.items.find((x) => x.id === e.itemId);
      if (!it) errors.entries = 'вещь не найдена';
      else if (it.status !== 'evaluated') errors.entries = `«${it.title}» уже не в статусе «оценена»`;
    } else if (String(e.title).trim().length > 200) errors.entries = 'название вещи длиннее 200 знаков';
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const cents = allocateLot(Math.round(total.value * 100), weights);
  const lotId = newId();
  const rate = mileRateFor(state.taxRules || builtinRules(), date);
  const mileRate = rate ? rate.value : null;
  const cat = state.settings.categories.find((c) => c.id === raw.categoryId) || state.settings.categories[0];
  const items = [...state.items];
  const itemIds = [];
  entries.forEach((e, i) => {
    const have = { date, origin: 'bought', buyPrice: cents[i] / 100, salesTax: 0, buyerPremium: 0, freight: 0, place, seller, sku: nextSku(state.items, i), location: '', miles: 0, mileRate, lotId, tripId: null };
    if (e.itemId) {
      const k = items.findIndex((x) => x.id === e.itemId);
      items[k] = { ...items[k], origin: 'bought', status: 'have', have };
      itemIds.push(e.itemId);
    } else {
      const id = newId();
      items.push({ id, createdAt: now.toISOString(), title: String(e.title).trim(), categoryId: cat.id, origin: 'bought', status: 'have', decision: null, eval: null, have, listed: null, sold: null, paid: null, checked: null, shipped: null, writeoff: null, pastSales: [] });
      itemIds.push(id);
    }
  });
  const lot = { id: lotId, date, total: total.value, miles: miles.value ?? 0, mileRate, itemIds, allocations: cents.map((c) => c / 100), place, seller, tripId: trip.tripId };
  return { ok: true, state: { ...state, items, lots: [...(state.lots || []), lot] }, lot, errors: {} };
}

export function lotOf(state, item) {
  if (!item || !item.have || !item.have.lotId) return null;
  return (state.lots || []).find((l) => l.id === item.have.lotId) || null;
}

// Отменить покупку лота (ошибка при вводе): можно, пока все вещи лота только «куплены».
export function canUndoLot(state, lot) {
  if (!lot) return false;
  return lot.itemIds.every((id) => {
    const it = state.items.find((x) => x.id === id);
    return it && it.status === 'have';
  });
}

export function undoLot(state, lotId, now = new Date()) {
  const lot = (state.lots || []).find((l) => l.id === lotId);
  if (!lot) return { ok: false, error: 'лот не найден' };
  if (!canUndoLot(state, lot)) return { ok: false, error: 'часть вещей лота уже выставлена или продана — отменить лот нельзя' };
  const ids = new Set(lot.itemIds);
  const items = [];
  for (const it of state.items) {
    if (!ids.has(it.id)) { items.push(it); continue; }
    // была оценена до лота → снова «оценена»; создана в лоте → убирается
    if (it.eval) items.push({ ...it, status: 'evaluated', have: null, checked: null });
  }
  const kept = keepTrip({ ...state, items, lots: state.lots.filter((l) => l.id !== lotId) }, lot.date, lot.miles, lot.mileRate, lot.place, `покупка лота: ${lot.itemIds.length} вещ. (лот отменён)`, now);
  return { ok: true, state: kept.state, keptTrip: kept.trip };
}

// Мили, записанные в покупке или лоте, хранятся только там. Когда покупка стирается (удаление вещи, шаг назад
// с «Куплена», отмена лота), поездка не пропадает молча: она переходит в журнал отдельной записью с той же
// датой, милями и ставкой. Если поездки не было (ошибка ввода) — её можно удалить в журнале.
function keepTrip(state, date, miles, rate, to, purpose, now) {
  if (!(n0(miles) > 0) || !isDate(date)) return { state, trip: null };
  const trip = {
    id: newId(), createdAt: now.toISOString(), date, from: '', to: String(to || '').slice(0, 100), kind: 'buy',
    purpose: String(purpose).slice(0, 200), miles, rateUsed: typeof rate === 'number' && rate > 0 ? rate : null,
  };
  return { state: { ...state, trips: [trip, ...(state.trips || [])] }, trip };
}

const keepPurchaseTrip = (state, it, now) => (it.have && !it.have.lotId
  ? keepTrip(state, it.have.date, it.have.miles, it.have.mileRate, it.have.place, `покупка: ${it.title}`, now)
  : { state, trip: null });

// Мили покупки, которые перейдут в журнал, если стереть покупку (для текста подтверждения).
export function purchaseTripOf(it) {
  return it && it.have && !it.have.lotId && n0(it.have.miles) > 0 ? { date: it.have.date, miles: it.have.miles, amount: mileAmount(it.have.miles, it.have.mileRate) } : null;
}

// Удалить вещь. Вещь из лота удалить нельзя: сумма долей должна оставаться равной цене лота.
export function deleteItem(state, id, now = new Date()) {
  const it = state.items.find((x) => x.id === id);
  if (!it) return { ok: false, error: 'вещь не найдена' };
  if (lotOf(state, it)) return { ok: false, error: 'вещь из лота: удалить можно, только отменив покупку всего лота (доли цены считались вместе)' };
  const kept = keepPurchaseTrip({ ...state, items: state.items.filter((x) => x.id !== id) }, it, now);
  return { ok: true, state: kept.state, keptTrip: kept.trip };
}

// Шаг назад в данных: если стирается покупка с милями — поездка переходит в журнал.
export function stepBackInState(state, id, now = new Date()) {
  const it = state.items.find((x) => x.id === id);
  if (!it) return { ok: false, error: 'вещь не найдена' };
  const back = stepBack(it);
  if (back === it) return { ok: false, error: 'дальше назад нельзя' };
  const next = { ...state, items: state.items.map((x) => (x.id === id ? back : x)) };
  const kept = it.have && !back.have ? keepPurchaseTrip(next, it, now) : { state: next, trip: null };
  return { ok: true, state: kept.state, item: back, keptTrip: kept.trip };
}

// ---------- журнал поездок (ТЗ M4, таблица trips) ----------
// Отдельные поездки (в том числе без покупки) лежат в state.trips. Мили, записанные при покупке или лоте
// (have.miles, lot.miles), остаются там, где их ввели, и показываются в журнале как строки «из покупки» —
// одна поездка хранится в одном месте, поэтому двойного счёта нет. Если поездка уже есть в журнале,
// покупка/лот ссылается на неё (tripId) и свои мили = 0.

export const TRIP_KINDS = {
  source: 'Распродажа / поиск вещей',
  buy: 'Забрать купленное',
  ship: 'Почта / отправка',
  supplies: 'Коробки, материалы',
  storage: 'Склад / хранение',
  other: 'Другое по делу',
};
// Цели поездки «за вещью»: только такую поездку из журнала форма покупки может предложить сама.
// Поездку на почту, за коробками или на склад нельзя молча выдать за поездку за покупкой.
export const PURCHASE_TRIP_KINDS = ['source', 'buy'];
export const TRIP_KINDS_EN = {
  source: 'Sourcing (sales, auctions)',
  buy: 'Picking up purchased items',
  ship: 'Post office / shipping',
  supplies: 'Buying supplies',
  storage: 'Storage',
  other: 'Other business',
};

const textField = (raw, key, max, errors) => {
  const v = String(raw[key] ?? '').trim();
  if (v.length > max) errors[key] = `не длиннее ${max} знаков`;
  return v.slice(0, max);
};

export function validateTrip(raw, rules, today = todayLocal()) {
  const errors = {};
  const date = String(raw.date || '').trim();
  if (!isDate(date)) errors.date = 'укажите дату';
  checkNotFuture(date, today, errors);
  const m = parseNumber(raw.miles, NUM.miles);
  if (m.error) errors.miles = m.error;
  else if (m.value === null) errors.miles = 'сколько миль (туда и обратно)?';
  else if (!(m.value > 0)) errors.miles = 'мили должны быть больше 0';
  const kind = Object.hasOwn(TRIP_KINDS, raw.kind) ? raw.kind : null;
  if (!kind) errors.kind = 'выберите, зачем ездили';
  const from = textField(raw, 'from', 100, errors);
  const to = textField(raw, 'to', 100, errors);
  const purpose = textField(raw, 'purpose', 200, errors);
  if (Object.keys(errors).length) return { ok: false, data: null, errors };
  const r = mileRateFor(rules, date);
  return { ok: true, data: { date, from, to, kind, purpose, miles: m.value, rateUsed: r ? r.value : null }, errors: {} };
}

export function addTrip(state, raw, now = new Date()) {
  const v = validateTrip(raw, state.taxRules || builtinRules(), todayLocal(now));
  if (!v.ok) return v;
  const trip = { id: newId(), createdAt: now.toISOString(), ...v.data };
  return { ok: true, trip, state: { ...state, trips: [trip, ...(state.trips || [])] }, errors: {} };
}

export function updateTrip(state, id, raw, now = new Date()) {
  const old = (state.trips || []).find((t) => t.id === id);
  if (!old) return { ok: false, errors: { step: 'поездка не найдена' } };
  const v = validateTrip(raw, state.taxRules || builtinRules(), todayLocal(now));
  if (!v.ok) return v;
  // ставки на дату нет в реестре, а дата та же — остаётся прежняя записанная ставка
  const rateUsed = v.data.rateUsed ?? (v.data.date === old.date ? old.rateUsed : null);
  // поменяли дату — покупки другого дня больше не могут ссылаться на эту поездку
  const unlink = v.data.date !== old.date;
  const trip = { ...old, ...v.data, rateUsed };
  return { ok: true, trip, state: unlinkTrip({ ...state, trips: state.trips.map((t) => (t.id === id ? trip : t)) }, unlink ? id : null), errors: {} };
}

function unlinkTrip(state, id) {
  if (!id) return state;
  return {
    ...state,
    items: state.items.map((it) => (it.have && it.have.tripId === id ? { ...it, have: { ...it.have, tripId: null } } : it)),
    lots: (state.lots || []).map((l) => (l.tripId === id ? { ...l, tripId: null } : l)),
  };
}

export function deleteTrip(state, id) {
  if (!(state.trips || []).some((t) => t.id === id)) return { ok: false, error: 'поездка не найдена' };
  return { ok: true, state: unlinkTrip({ ...state, trips: state.trips.filter((t) => t.id !== id) }, id) };
}

// Покупки и лоты, которые ссылаются на поездку из журнала.
export function tripLinks(state, tripId) {
  const items = state.items.filter((it) => it.have && it.have.tripId === tripId).map((it) => ({ kind: 'item', id: it.id, title: it.title }));
  const lots = (state.lots || []).filter((l) => l.tripId === tripId).map((l) => ({ kind: 'lot', id: l.id, title: `лот: ${l.itemIds.length} вещ.` }));
  return [...items, ...lots];
}

// Все поездки одним списком (журнал и сводка): записанные в журнал + мили из покупок и лотов.
// src: 'trip' | 'item' | 'lot'; amount = мили × ставка, null — ставка неизвестна.
export function tripRows(state) {
  const amount = (miles, rate) => mileAmount(miles, rate);
  const rows = (state.trips || []).map((t) => ({
    src: 'trip', id: t.id, date: t.date, from: t.from, to: t.to, kind: t.kind, purpose: t.purpose,
    miles: t.miles, rateUsed: t.rateUsed, amount: amount(t.miles, t.rateUsed), links: tripLinks(state, t.id),
  }));
  for (const it of state.items) {
    const h = it.have;
    if (!h || h.lotId || !(n0(h.miles) > 0)) continue;
    rows.push({ src: 'item', id: it.id, date: h.date, from: '', to: h.place || '', kind: 'buy', purpose: `покупка: ${it.title}`, miles: h.miles, rateUsed: typeof h.mileRate === 'number' ? h.mileRate : null, amount: amount(h.miles, h.mileRate), links: [] });
  }
  for (const l of state.lots || []) {
    if (!(n0(l.miles) > 0)) continue;
    rows.push({ src: 'lot', id: l.id, date: l.date, from: '', to: l.place || '', kind: 'buy', purpose: `покупка лота: ${l.itemIds.length} вещ.`, miles: l.miles, rateUsed: typeof l.mileRate === 'number' ? l.mileRate : null, amount: amount(l.miles, l.mileRate), links: [] });
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// Поездки за день, уже записанные в журнал (для выбора при покупке/лоте).
export function tripsOnDate(state, date) {
  return (state.trips || []).filter((t) => t.date === date);
}

// Мили, введённые при покупке/лоте в этот день (подсказка в форме поездки: не записать дважды).
export function purchaseMilesOnDate(state, date) {
  return tripRows(state).filter((r) => r.src !== 'trip' && r.date === date);
}

// Пересчитать ставку за милю у всех поездок по текущему реестру (например, после проверки правил).
// Меняются только записи, у которых в реестре есть ставка на их дату и она отличается от записанной.
export function reapplyRates(state) {
  const rules = state.taxRules || builtinRules();
  let changed = 0;
  const fix = (date, cur) => {
    const r = mileRateFor(rules, date);
    if (!r || r.value === cur) return cur;
    changed++;
    return r.value;
  };
  const trips = (state.trips || []).map((t) => {
    const v = fix(t.date, t.rateUsed);
    return v === t.rateUsed ? t : { ...t, rateUsed: v };
  });
  const items = state.items.map((it) => {
    if (!it.have || it.have.lotId || !(n0(it.have.miles) > 0)) return it;
    const v = fix(it.have.date, it.have.mileRate);
    return v === it.have.mileRate ? it : { ...it, have: { ...it.have, mileRate: v } };
  });
  const lots = (state.lots || []).map((l) => {
    if (!(n0(l.miles) > 0)) return l;
    const v = fix(l.date, l.mileRate);
    return v === l.mileRate ? l : { ...l, mileRate: v };
  });
  return { changed, state: { ...state, trips, items, lots } };
}

// ---------- расходы Schedule C (ТЗ M4, таблица expenses) ----------

export const EXPENSE_CATEGORIES = {
  boxes: 'Коробки и упаковка',
  tape: 'Плёнка и лента',
  storage: 'Хранение',
  tools: 'Инструменты',
  fees: 'Комиссии и подписки',
  other: 'Прочее',
};
export const EXPENSE_CATEGORIES_EN = {
  boxes: 'Boxes & packaging',
  tape: 'Bubble wrap & tape',
  storage: 'Storage',
  tools: 'Tools',
  fees: 'Fees & subscriptions',
  other: 'Other',
};

export function validateExpense(raw, today = todayLocal()) {
  const errors = {};
  const date = String(raw.date || '').trim();
  if (!isDate(date)) errors.date = 'укажите дату';
  checkNotFuture(date, today, errors);
  const a = parseNumber(raw.amount, NUM.money);
  if (a.error) errors.amount = a.error;
  else if (a.value === null) errors.amount = 'введите сумму';
  else if (!(a.value > 0)) errors.amount = 'сумма должна быть больше 0';
  const category = Object.hasOwn(EXPENSE_CATEGORIES, raw.category) ? raw.category : null;
  if (!category) errors.category = 'выберите, на что';
  const note = textField(raw, 'note', 200, errors);
  const receipt = textField(raw, 'receipt', 200, errors);
  if (Object.keys(errors).length) return { ok: false, data: null, errors };
  return { ok: true, data: { date, category, amount: a.value, note, receipt }, errors: {} };
}

export function addExpense(state, raw, now = new Date()) {
  const v = validateExpense(raw, todayLocal(now));
  if (!v.ok) return v;
  const exp = { id: newId(), createdAt: now.toISOString(), ...v.data };
  return { ok: true, expense: exp, state: { ...state, expenses: [exp, ...(state.expenses || [])] }, errors: {} };
}

export function updateExpense(state, id, raw, now = new Date()) {
  const old = (state.expenses || []).find((e) => e.id === id);
  if (!old) return { ok: false, errors: { step: 'расход не найден' } };
  const v = validateExpense(raw, todayLocal(now));
  if (!v.ok) return v;
  const exp = { ...old, ...v.data };
  return { ok: true, expense: exp, state: { ...state, expenses: state.expenses.map((e) => (e.id === id ? exp : e)) }, errors: {} };
}

export function deleteExpense(state, id) {
  if (!(state.expenses || []).some((e) => e.id === id)) return { ok: false, error: 'расход не найден' };
  return { ok: true, state: { ...state, expenses: state.expenses.filter((e) => e.id !== id) } };
}

// ---------- правка реестра правил ----------

const RULE_PRESET = { rate: NUM.rate, money: NUM.money, count: NUM.count, pct: NUM.pct };

// Значение правила — как в форме: ставка до 3 знаков, деньги до 2, проценты до сотых (доля до 4 знаков).
function ruleValueOk(unit, v) {
  if (!isNum(v)) return false;
  if (unit === 'rate') return v > 0 && v <= 10 && decOk(v, 3);
  if (unit === 'money') return v >= 0 && v <= 1e9 && decOk(v, 2);
  if (unit === 'count') return Number.isInteger(v) && v >= 0 && v <= 1e7;
  if (unit === 'pct') return v >= 0 && v <= 0.3 && decOk(v, 4);
  return false;
}

// Значение из поля ввода (проценты вводятся как 7.75 → 0.0775).
export function parseRuleValue(key, raw) {
  const meta = RULE_KEYS[key];
  if (!meta) return { error: 'неизвестное правило' };
  const r = parseNumber(raw, RULE_PRESET[meta.unit]);
  if (r.error) return { error: r.error };
  if (r.value === null) return { error: 'нужно значение' };
  const v = meta.unit === 'pct' ? Math.round(r.value * 100) / 10000 : r.value;
  if (!ruleValueOk(meta.unit, v)) return { error: meta.unit === 'rate' ? 'ставка — больше 0 и не больше $10' : meta.unit === 'pct' ? 'от 0 до 30%' : 'значение вне допустимого' };
  return { value: v };
}

// Георгий поменял значение: оно становится его (не перезаписывается обновлением программы) и «не проверено».
export function setRuleValue(state, id, raw) {
  const r = (state.taxRules || []).find((x) => x.id === id);
  if (!r) return { ok: false, error: 'правило не найдено' };
  const p = parseRuleValue(r.key, raw);
  if (p.error) return { ok: false, error: p.error };
  if (p.value === r.value) return { ok: true, state, changed: false };
  const upd = { ...r, value: p.value, edited: true, status: 'unverified', verifiedAt: null };
  return { ok: true, changed: true, state: { ...state, taxRules: state.taxRules.map((x) => (x.id === id ? upd : x)) } };
}

// Вернуть значение программы (для правила программы) — оно снова обновляется вместе с программой.
export function resetRule(state, id) {
  const b = builtinRules().find((x) => x.id === id);
  if (!b) return { ok: false, error: 'это ваше правило — его можно только удалить' };
  return { ok: true, state: { ...state, taxRules: (state.taxRules || []).map((x) => (x.id === id ? b : x)) } };
}

const HTTPS_URL = /^https:\/\/[^\s"'<>\\]+$/;

export function addRule(state, raw) {
  const errors = {};
  const key = Object.hasOwn(RULE_KEYS, raw.key) ? raw.key : null;
  if (!key) errors.key = 'выберите, какое правило';
  const meta = key ? RULE_KEYS[key] : null;
  let value = null;
  if (key) {
    const p = parseRuleValue(key, raw.value);
    if (p.error) errors.value = p.error;
    else value = p.value;
  }
  let validFrom = null, validTo = null, taxYear = null;
  if (meta && meta.byDate) {
    validFrom = String(raw.validFrom || '').trim();
    if (!isDate(validFrom)) errors.validFrom = 'с какой даты';
    validTo = String(raw.validTo || '').trim() || null;
    if (validTo !== null && !isDate(validTo)) errors.validTo = 'неверная дата';
    else if (validTo && isDate(validFrom) && validTo < validFrom) errors.validTo = 'раньше даты начала';
    if (isDate(validFrom)) taxYear = Number(validFrom.slice(0, 4));
  } else if (meta) {
    const y = parseNumber(raw.taxYear, NUM.count);
    if (y.error || y.value === null || y.value < 2000 || y.value > 2100) errors.taxYear = 'налоговый год, например 2027';
    else taxYear = y.value;
  }
  const sourceUrl = String(raw.sourceUrl || '').trim();
  if (sourceUrl && (!HTTPS_URL.test(sourceUrl) || sourceUrl.length > 300)) errors.sourceUrl = 'ссылка должна начинаться с https://';
  if (Object.keys(errors).length) return { ok: false, errors };
  const rule = { id: 'user-' + newId(), key, value, taxYear, validFrom, validTo, sourceUrl, verifiedAt: null, nextCheck: null, status: 'unverified', note: 'добавлено вами', builtin: false, edited: false };
  return { ok: true, rule, state: { ...state, taxRules: [...(state.taxRules || []), rule] }, errors: {} };
}

export function deleteRule(state, id) {
  const r = (state.taxRules || []).find((x) => x.id === id);
  if (!r) return { ok: false, error: 'правило не найдено' };
  if (r.builtin) return { ok: false, error: 'правило программы удалить нельзя — можно вернуть его значение' };
  return { ok: true, state: { ...state, taxRules: state.taxRules.filter((x) => x.id !== id) } };
}

export function fmtRuleValue(rule) {
  const meta = RULE_KEYS[rule.key];
  if (!meta || !isNum(rule.value)) return '—';
  if (meta.unit === 'rate') return `$${rule.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} за милю`;
  if (meta.unit === 'money') return fmtMoney(rule.value, { cents: false });
  if (meta.unit === 'count') return String(rule.value);
  return `${Math.round(rule.value * 10000) / 100}%`;
}

export function ruleInputValue(rule) {
  const meta = RULE_KEYS[rule.key];
  if (!meta || !isNum(rule.value)) return '';
  return meta.unit === 'pct' ? String(Math.round(rule.value * 10000) / 100) : String(rule.value);
}

export function rulePeriod(rule) {
  const meta = RULE_KEYS[rule.key];
  if (meta && meta.byDate) return `${fmtDate(rule.validFrom)} – ${rule.validTo ? fmtDate(rule.validTo) : '…'}`;
  return `${rule.taxYear} год`;
}

// ---------- проверка данных (хранение и копия) ----------
// Любые данные из памяти телефона или из файла копии собираются заново по известным полям с проверкой типов:
// чужой «файл копии» не может подсунуть ни код в интерфейс, ни поломанную запись, роняющую экраны.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const inRange = (v, lo, hi) => isNum(v) && v >= lo && v <= hi;
// Не больше d знаков после точки (как в формах): деньги — 2, мили — 1, ставка — 3.
function decOk(v, d) {
  const x = v * 10 ** d;
  return Math.abs(x - Math.round(x)) < 1e-6;
}
const isMoney = (v) => inRange(v, 0, 10_000_000) && decOk(v, 2);
const isMiles = (v) => inRange(v, 0, 100_000) && decOk(v, 1);
const isRate = (v) => inRange(v, 0, 10) && decOk(v, 3);
const isText = (v, max) => typeof v === 'string' && v.length <= max;
const isIso = (v) => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export function validateCategory(c) {
  const errs = [];
  if (!isObj(c)) return ['категория: не объект'];
  if (!isText(c.id, 100) || !c.id) errs.push('нет id');
  if (!isText(c.name, 80) || !c.name.trim()) errs.push('нет названия (до 80 знаков)');
  if (!(c.ebayName === undefined || isText(c.ebayName, 120))) errs.push('категория eBay — до 120 знаков');
  if (!isNum(c.feePct) || c.feePct < 0 || c.feePct >= 1) errs.push('комиссия % вне 0–99');
  if (!inRange(c.perOrderFee, 0, 1000)) errs.push('плата за заказ вне 0–1000');
  if (!inRange(c.minNet, 0, 1_000_000)) errs.push('минимальная прибыль вне 0–1 000 000');
  if (!inRange(c.minSold90, 0, 1_000_000) || !Number.isInteger(c.minSold90)) errs.push('минимум продаж — целое число ≥ 0');
  if (!(c.minStr === null || inRange(c.minStr, 0, 100))) errs.push('STR неверный');
  if (!isNum(c.buyCeilingLow) || !isNum(c.buyCeilingHigh) || c.buyCeilingLow < 0 || c.buyCeilingHigh > 1 || c.buyCeilingLow > c.buyCeilingHigh) errs.push('потолок покупки неверный (от ≤ до, 0–100%)');
  return errs;
}

function cleanCategory(c) {
  const out = { id: c.id, name: c.name, feePct: c.feePct, perOrderFee: c.perOrderFee, minNet: c.minNet, minSold90: c.minSold90, minStr: c.minStr, buyCeilingLow: c.buyCeilingLow, buyCeilingHigh: c.buyCeilingHigh };
  if (typeof c.ebayName === 'string') out.ebayName = c.ebayName;
  return out;
}

// Общие настройки: каждое число проверяется (иначе вердикт молча неверный).
// Ставка за милю и порог 1099-K — в реестре правил (taxRules), не здесь.
const SETTING_CHECKS = {
  buyerTaxPct: [(v) => inRange(v, 0, 0.3), 'налог покупателя вне 0–30%'],
  payoutEstimateMinN: [(v) => inRange(v, 1, 1000) && Number.isInteger(v), 'число выплат для оценки — целое 1–1000'],
  cheapFlagPct: [(v) => inRange(v, 0, 1), 'флаг «слишком дёшево» вне 0–100%'],
};

export function validateSettings(s) {
  const errs = [];
  for (const [k, [ok, msg]] of Object.entries(SETTING_CHECKS)) if (!ok(s[k])) errs.push(msg);
  return errs;
}

// Значения по умолчанию среза 1 (ставка за милю и порог 1099-K жили в настройках).
export const V1_DEFAULTS = { mileRate: 0.76, k1099: { minGross: 20000, minCount: 200 } };

// Настройки среза 1: ставка за милю и порог 1099-K жили в настройках. В реестр правил они НЕ переносятся:
// реестр сверен с первоисточниками, а своя ставка среза 1 (например 0,725 «до 30.06») перекрыла бы
// проверенную ставку второго полугодия. Исходные числа сохраняются в meta.migratedFromV1 и показываются
// в реестре; мили покупок среза 1 остаются со ставкой, записанной тогда, — сводка покажет «ставка отличается
// от реестра» и кнопку «Пересчитать мили по реестру».
function migrateV1Settings(s, P) {
  const legacy = { mileRate: null, k1099: null };
  if (!isObj(s)) return legacy;
  if (s.mileRate !== undefined) {
    if (inRange(s.mileRate, 0, 10)) legacy.mileRate = s.mileRate;
    else P.push('настройки: ставка за милю вне 0–10');
  }
  if (s.k1099 !== undefined) {
    if (!isObj(s.k1099)) P.push('настройки: порог 1099-K испорчен');
    else {
      const g = s.k1099.minGross, c = s.k1099.minCount;
      const gOk = g === undefined || inRange(g, 0, 1e9);
      const cOk = c === undefined || (inRange(c, 0, 1e7) && Number.isInteger(c));
      if (!gOk) P.push('настройки: порог 1099-K (сумма) неверный');
      if (!cOk) P.push('настройки: порог 1099-K (сделок) неверный');
      if (gOk && cOk) legacy.k1099 = { minGross: g ?? V1_DEFAULTS.k1099.minGross, minCount: c ?? V1_DEFAULTS.k1099.minCount };
    }
  }
  return legacy;
}

// Свои цифры среза 1, которые отличались от значений по умолчанию (для пометки в реестре).
export function legacyCustomRules(meta) {
  const m = meta && meta.migratedFromV1;
  if (!m) return null;
  const out = {};
  if (typeof m.mileRate === 'number' && m.mileRate !== V1_DEFAULTS.mileRate) out.mileRate = m.mileRate;
  if (m.k1099 && (m.k1099.minGross !== V1_DEFAULTS.k1099.minGross || m.k1099.minCount !== V1_DEFAULTS.k1099.minCount)) out.k1099 = m.k1099;
  return Object.keys(out).length ? out : null;
}

function cleanSettings(s, P) {
  const d = defaultSettings();
  if (s === undefined || s === null) return d;
  if (!isObj(s)) { P.push('настройки испорчены'); return d; }
  const out = { ...d };
  for (const [k, [ok, msg]] of Object.entries(SETTING_CHECKS)) {
    if (s[k] === undefined) continue;
    if (ok(s[k])) out[k] = s[k];
    else P.push(`настройки: ${msg}`);
  }
  if (s.categories !== undefined) {
    const cats = s.categories;
    if (!Array.isArray(cats) || !cats.length) P.push('настройки: нет списка категорий');
    else {
      const bad = cats.map((c) => validateCategory(c)).find((e) => e.length);
      const ids = new Set(cats.map((c) => c && c.id));
      if (bad) P.push(`в копии испорчена категория: ${bad.join(', ')}`);
      else if (ids.size !== cats.length) P.push('настройки: у двух категорий одинаковый id');
      else out.categories = cats.map(cleanCategory);
    }
  }
  return out;
}

const nullOr = (v, check) => v === null || v === undefined || check(v);

function cleanInput(o, E) {
  if (o === undefined || o === null) return {};
  if (!isObj(o)) { E.push('введённые данные оценки испорчены'); return {}; }
  for (const k of INPUT_TEXT_KEYS) if (o[k] !== undefined && !isText(o[k], 500)) E.push('введённые данные оценки испорчены');
  for (const k of INPUT_BOOL_KEYS) if (o[k] !== undefined && typeof o[k] !== 'boolean') E.push('введённые данные оценки испорчены');
  return cleanDraft(o);
}

function cleanEval(ev, E) {
  if (ev === null || ev === undefined) return null;
  if (!isObj(ev) || !isObj(ev.result) || !Object.hasOwn(VERDICT_TEXT, ev.result.kind)) { E.push('оценка испорчена'); return null; }
  const r = ev.result;
  const strList = (a, max) => a === undefined ? [] : Array.isArray(a) && a.length <= max && a.every((x) => isText(x, 500)) ? [...a] : (E.push('причины оценки испорчены'), []);
  if (!isIso(ev.at)) E.push('нет даты оценки');
  if (!isText(r.title, 100)) E.push('нет текста вердикта');
  if (!nullOr(r.net, isNum) || !nullOr(r.str, isNum) || !nullOr(r.maxOffer, isNum)) E.push('числа оценки испорчены');
  if (!Array.isArray(r.reasons)) E.push('нет причин оценки');
  let category = null;
  if (ev.category !== null && ev.category !== undefined) {
    if (validateCategory(ev.category).length) E.push('категория в оценке испорчена');
    else category = cleanCategory(ev.category);
  }
  if (!nullOr(ev.mileRate, (v) => inRange(v, 0, 10)) || !nullOr(ev.buyerTaxPct, (v) => inRange(v, 0, 1))) E.push('настройки в оценке испорчены');
  return {
    at: ev.at,
    input: cleanInput(ev.input, E),
    result: { kind: r.kind, title: r.title, net: r.net ?? null, str: r.str ?? null, maxOffer: r.maxOffer ?? null, reasons: strList(r.reasons, 50), warnings: strList(r.warnings, 20) },
    category,
    mileRate: ev.mileRate ?? null,
    buyerTaxPct: ev.buyerTaxPct ?? null,
    source: isText(ev.source, 40) ? ev.source : 'manual_ebay_app',
  };
}

function textOr(v, max, E, what) {
  if (v === undefined || v === null) return '';
  if (isText(v, max)) return v;
  E.push(what);
  return '';
}

const FEE_KEYS = ['finalValue', 'perOrder', 'ads', 'other'];

// Продажа: версия 2 — комиссия по видам (feesByType); версия 1 — одно поле fees + adFee.
// Перевод 1 → 2 без потерь: fees → комиссия площадки (с пометкой feesCombined «введено одной суммой»),
// adFee → реклама; итог комиссий не меняется. Пустая комиссия eBay остаётся пустой (оценка по % категории).
function cleanSoldFees(s, E, fromVersion) {
  if (fromVersion >= 2) {
    if (!isObj(s.feesByType)) { E.push('нет комиссий продажи по видам'); return null; }
    for (const k of FEE_KEYS) if (!nullOr(s.feesByType[k], isMoney)) E.push('комиссия продажи испорчена');
    if (!nullOr(s.feesCombined, (v) => typeof v === 'boolean')) E.push('комиссия продажи испорчена');
    return { feesByType: Object.fromEntries(FEE_KEYS.map((k) => [k, s.feesByType[k] ?? null])), feesCombined: s.feesCombined === true };
  }
  if (!nullOr(s.fees, isMoney) || !nullOr(s.adFee, isMoney)) E.push('расходы продажи испорчены');
  const fees = isMoney(s.fees) ? s.fees : null;
  const ads = isMoney(s.adFee) ? s.adFee : 0;
  return { feesByType: { finalValue: fees, perOrder: null, ads, other: null }, feesCombined: fees !== null && s.channel !== 'cash' };
}

const objOr = (v, E, what) => (v === undefined || v === null ? null : isObj(v) ? v : (E.push(what), null));

function cleanListed(v, E) {
  const l = objOr(v, E, 'выставление испорчено');
  if (!l) return null;
  if (!isDate(l.date)) E.push('нет даты выставления');
  if (!nullOr(l.price, isMoney)) E.push('цена объявления испорчена');
  return { date: l.date, price: l.price ?? null };
}

// Снимок % категории для оценки комиссии (feeBasis): необязателен; нет — заполняется при загрузке.
function cleanFeeBasis(v, E) {
  if (v === undefined || v === null) return null;
  if (!isObj(v) || !(isNum(v.feePct) && v.feePct >= 0 && v.feePct < 1) || !inRange(v.perOrderFee, 0, 1000) || !inRange(v.buyerTaxPct, 0, 0.3)) { E.push('снимок комиссии продажи испорчен'); return null; }
  return { feePct: v.feePct, perOrderFee: v.perOrderFee, buyerTaxPct: v.buyerTaxPct };
}

function cleanSold(v, E, fromVersion) {
  const s = objOr(v, E, 'продажа испорчена');
  if (!s) return null;
  if (!isDate(s.date)) E.push('нет даты продажи');
  if (!Object.hasOwn(CHANNELS, s.channel)) E.push('площадка продажи испорчена');
  if (!isMoney(s.price) || !(s.price > 0)) E.push('цена продажи испорчена');
  if (!isMoney(s.shipCharged)) E.push('доставка с покупателя испорчена');
  if (!nullOr(s.label, isMoney) || !nullOr(s.packaging, isMoney) || !nullOr(s.taxCollected, isMoney) || !nullOr(s.refund, isMoney)) E.push('расходы продажи испорчены');
  // как в форме: возврат не больше суммы продажи
  if (isMoney(s.refund) && isMoney(s.price) && isMoney(s.shipCharged) && s.refund > round2(s.price + s.shipCharged)) E.push('возврат больше суммы продажи');
  let refundDate = null;
  if (s.refundDate !== undefined && s.refundDate !== null) {
    if (!isDate(s.refundDate) || (isDate(s.date) && s.refundDate < s.date)) E.push('дата возврата денег испорчена');
    else if (n0(s.refund) > 0) refundDate = s.refundDate;
  }
  const f = cleanSoldFees(s, E, fromVersion);
  // наличные при встрече: комиссии площадки и налога площадки нет (форма ставит 0)
  if (fromVersion >= 2 && s.channel === 'cash' && f && (FEE_KEYS.some((k) => n0(f.feesByType[k]) !== 0) || (s.taxCollected !== undefined && s.taxCollected !== null))) E.push('у продажи за наличные есть комиссия площадки');
  return {
    date: s.date, channel: s.channel, price: s.price, shipCharged: s.shipCharged, label: s.label ?? null, packaging: s.packaging ?? 0,
    ...(f || { feesByType: null, feesCombined: false }), taxCollected: s.taxCollected ?? null, refund: s.refund ?? 0, refundDate,
    feeBasis: cleanFeeBasis(s.feeBasis, E),
  };
}

function cleanPaid(v, E) {
  const p = objOr(v, E, 'выплата испорчена');
  if (!p) return null;
  if (!isDate(p.date)) E.push('нет даты выплаты');
  if (!nullOr(p.amount, isMoney) || !nullOr(p.withheld, isMoney)) E.push('сумма выплаты испорчена');
  if (!nullOr(p.cash, (x) => typeof x === 'boolean')) E.push('выплата испорчена');
  return { date: p.date, amount: p.amount ?? null, payoutId: textOr(p.payoutId, 80, E, 'ID выплаты испорчен'), withheld: p.withheld ?? null, cash: p.cash === true };
}

function cleanShipped(v, E) {
  const sh = objOr(v, E, 'отправка испорчена');
  if (!sh) return null;
  if (!isDate(sh.date)) E.push('нет даты отправки');
  return { date: sh.date, tracking: textOr(sh.tracking, 60, E, 'трек испорчен') };
}

// Продажа, после которой вещь вернули на склад: выставление, продажа, выплата, отправка и данные возврата.
function cleanPastSale(v, E, fromVersion) {
  if (!isObj(v) || !isObj(v.listed) || !isObj(v.sold) || !isObj(v.returned)) { E.push('возврат на склад испорчен'); return null; }
  const listed = cleanListed(v.listed, E);
  const sold = cleanSold(v.sold, E, fromVersion);
  const paid = cleanPaid(v.paid, E);
  const shipped = cleanShipped(v.shipped, E);
  const r = v.returned;
  if (!isDate(r.date) || !isMoney(r.refund) || !isMoney(r.returnShipping) || !isMoney(r.feeCredit)) E.push('возврат на склад испорчен');
  const returned = { date: r.date, refund: r.refund, returnShipping: r.returnShipping, feeCredit: r.feeCredit, note: textOr(r.note, 200, E, 'заметка возврата испорчена') };
  if (E.length) return null;
  const gross = round2(sold.price + sold.shipCharged);
  if (round2(n0(sold.refund) + returned.refund) > gross || returned.feeCredit > gross) E.push('возврат больше суммы продажи');
  if (sold.date < listed.date || returned.date < sold.date || (shipped && (shipped.date < sold.date || returned.date < shipped.date)) || (paid && paid.date < sold.date)) E.push('даты продажи с возвратом не по порядку');
  if (refundDateOf(sold) && returned.date < refundDateOf(sold)) E.push('даты продажи с возвратом не по порядку');
  if (paid && paid.cash !== (sold.channel === 'cash')) E.push('выплата не совпадает с площадкой');
  if (shipped && sold.channel === 'cash') E.push('отправка без продажи');
  return { listed, sold, paid, shipped, returned };
}

function cleanItem(it, E, fromVersion = SCHEMA_VERSION) {
  if (!isObj(it)) { E.push('запись не объект'); return null; }
  if (!isText(it.id, 100) || !it.id) E.push('нет id');
  if (!isText(it.title, 300)) E.push('нет названия');
  if (!ALL_STATUSES.includes(it.status)) E.push('неизвестный статус');
  if (!nullOr(it.createdAt, isIso)) E.push('дата создания испорчена');
  if (!nullOr(it.categoryId, (v) => isText(v, 100))) E.push('категория испорчена');
  const origin = it.origin === undefined ? (isObj(it.have) && Object.hasOwn(ORIGINS, it.have.origin) ? it.have.origin : 'bought') : it.origin;
  if (!Object.hasOwn(ORIGINS, origin)) E.push('происхождение вещи испорчено');
  let decision = null;
  if (it.decision !== undefined && it.decision !== null) {
    if (!isObj(it.decision) || !['take', 'pass'].includes(it.decision.verdict)) E.push('решение испорчено');
    else decision = { verdict: it.decision.verdict, note: textOr(it.decision.note, 500, E, 'заметка решения испорчена') };
  }
  const ev = cleanEval(it.eval, E);

  let have = objOr(it.have, E, 'покупка испорчена');
  if (have) {
    const h = have;
    if (!isDate(h.date)) E.push('нет даты покупки');
    if (!Object.hasOwn(ORIGINS, h.origin)) E.push('происхождение в покупке испорчено');
    if (!isMoney(h.buyPrice)) E.push('цена покупки испорчена');
    for (const k of ['salesTax', 'buyerPremium', 'freight']) if (!nullOr(h[k], isMoney)) E.push('расходы на покупку испорчены');
    if (!nullOr(h.miles, isMiles) || !nullOr(h.mileRate, isRate)) E.push('мили испорчены');
    // ставка 0 при милях — это не «неизвестна», а $0 (в версии 2 так не записывается)
    if (fromVersion >= 2 && n0(h.miles) > 0 && h.mileRate === 0) E.push('мили испорчены');
    if (!nullOr(h.lotId, (v) => isText(v, 100))) E.push('ссылка на лот испорчена');
    if (!nullOr(h.tripId, (v) => isText(v, 100) && v.length > 0)) E.push('ссылка на поездку испорчена');
    if (h.tripId && n0(h.miles) > 0) E.push('мили покупки и поездка из журнала одновременно');
    have = {
      date: h.date, origin: h.origin, buyPrice: h.buyPrice,
      salesTax: h.salesTax ?? 0, buyerPremium: h.buyerPremium ?? 0, freight: h.freight ?? 0,
      place: textOr(h.place, 100, E, 'место покупки испорчено'), seller: textOr(h.seller, 100, E, 'продавец испорчен'),
      sku: textOr(h.sku, 40, E, 'SKU испорчен'), location: textOr(h.location, 80, E, 'место хранения испорчено'),
      // версия 1 всегда хранила число; null (версия 2) — ставки на дату не было в реестре
      miles: h.miles ?? 0, mileRate: h.mileRate === undefined ? 0 : h.mileRate, lotId: h.lotId || null, tripId: h.tripId || null,
    };
  }
  const listed = cleanListed(it.listed, E);
  const sold = cleanSold(it.sold, E, fromVersion);
  const paid = cleanPaid(it.paid, E);
  const shipped = cleanShipped(it.shipped, E);
  let checked = objOr(it.checked, E, 'проверка испорчена');
  if (checked) {
    if (!isDate(checked.date)) E.push('нет даты проверки');
    if (!Object.hasOwn(CHECK_RESULTS, checked.result)) E.push('результат проверки испорчен');
    checked = { date: checked.date, result: checked.result, note: textOr(checked.note, 300, E, 'заметка проверки испорчена') };
  }
  let writeoff = objOr(it.writeoff, E, 'списание испорчено');
  if (writeoff) {
    if (!isDate(writeoff.date)) E.push('нет даты списания');
    if (!Object.hasOwn(WRITEOFF_KINDS, writeoff.kind) || !['have', 'listed'].includes(writeoff.fromStatus)) E.push('списание испорчено');
    writeoff = { date: writeoff.date, kind: writeoff.kind, note: textOr(writeoff.note, 300, E, 'заметка списания испорчена'), fromStatus: writeoff.fromStatus };
  }
  let pastSales = [];
  if (it.pastSales !== undefined && it.pastSales !== null) {
    if (!Array.isArray(it.pastSales) || it.pastSales.length > 100) E.push('список возвратов испорчен');
    else pastSales = it.pastSales.map((p) => cleanPastSale(p, E, fromVersion));
  }
  if (E.length) return null;

  // Согласованность: у статуса есть данные всех пройденных шагов, даты идут по порядку.
  const need = { evaluated: [], have: ['have'], listed: ['have', 'listed'], sold: ['have', 'listed', 'sold'], paid: ['have', 'listed', 'sold', 'paid'], writeoff: ['have', 'writeoff'] }[it.status];
  const parts = { have, listed, sold, paid, writeoff };
  for (const k of need) if (!parts[k]) E.push(`нет данных шага «${k}» для статуса`);
  const allowed = new Set(need);
  if (it.status === 'writeoff' && writeoff && writeoff.fromStatus === 'listed') allowed.add('listed');
  for (const k of ['have', 'listed', 'sold', 'paid', 'writeoff']) if (parts[k] && !allowed.has(k)) E.push(`лишние данные шага «${k}»`);
  if (it.status === 'writeoff' && writeoff && writeoff.fromStatus === 'listed' && !listed) E.push('нет данных выставления');
  if (checked && !have) E.push('проверка без покупки');
  if (shipped && (!sold || sold.channel === 'cash')) E.push('отправка без продажи');
  if (paid && sold && paid.cash !== (sold.channel === 'cash')) E.push('выплата не совпадает с площадкой');
  if (have && have.origin !== origin) E.push('происхождение не совпадает');
  if (pastSales.length && !have) E.push('возврат на склад без покупки');
  // время вещи: покупка → [выставление → продажа → возврат]… → текущие шаги
  const seq = have ? [have.date] : [];
  for (const p of pastSales) seq.push(p.listed.date, p.sold.date, p.returned.date);
  seq.push(...[listed, sold, paid].filter(Boolean).map((x) => x.date));
  for (let i = 1; i < seq.length; i++) if (seq[i] < seq[i - 1]) E.push('даты шагов не по порядку');
  if (writeoff && seq.length && writeoff.date < seq[seq.length - 1]) E.push('дата списания раньше прошлого шага');
  if (shipped && sold && shipped.date < sold.date) E.push('дата отправки раньше продажи');
  if (checked && have && checked.date < have.date) E.push('дата проверки раньше покупки');
  if (E.length) return null;
  return {
    id: it.id, createdAt: it.createdAt ?? null, title: it.title, categoryId: it.categoryId ?? null, origin, status: it.status,
    decision, eval: ev, have, listed, sold, paid, checked, shipped, writeoff, pastSales,
  };
}

function cleanLot(lot, E, fromVersion = SCHEMA_VERSION) {
  if (!isObj(lot)) { E.push('запись лота не объект'); return null; }
  if (!isText(lot.id, 100) || !lot.id) E.push('нет id лота');
  if (!isDate(lot.date)) E.push('нет даты лота');
  if (!isMoney(lot.total)) E.push('цена лота испорчена');
  if (!nullOr(lot.miles, isMiles) || !nullOr(lot.mileRate, isRate)) E.push('мили лота испорчены');
  // ставка 0 при милях — это $0, а не «неизвестна» (в версии 2 так не записывается)
  if (fromVersion >= 2 && n0(lot.miles) > 0 && lot.mileRate === 0) E.push('мили лота испорчены');
  const ids = Array.isArray(lot.itemIds) && lot.itemIds.length >= 2 && lot.itemIds.length <= 1000 && lot.itemIds.every((x) => isText(x, 100) && x) && new Set(lot.itemIds).size === lot.itemIds.length;
  if (!ids) E.push('список вещей лота испорчен');
  const allocs = Array.isArray(lot.allocations) && ids && lot.allocations.length === lot.itemIds.length && lot.allocations.every(isMoney);
  if (!allocs) E.push('доли лота испорчены');
  else if (isMoney(lot.total) && Math.round(lot.allocations.reduce((a, b) => a + b, 0) * 100) !== Math.round(lot.total * 100)) E.push('сумма долей не равна цене лота');
  const place = textOr(lot.place, 100, E, 'место покупки лота испорчено');
  const seller = textOr(lot.seller, 100, E, 'продавец лота испорчен');
  if (!nullOr(lot.tripId, (v) => isText(v, 100) && v.length > 0)) E.push('ссылка лота на поездку испорчена');
  if (lot.tripId && n0(lot.miles) > 0) E.push('мили лота и поездка из журнала одновременно');
  if (E.length) return null;
  return { id: lot.id, date: lot.date, total: lot.total, miles: lot.miles ?? 0, mileRate: lot.mileRate === undefined ? 0 : lot.mileRate, itemIds: [...lot.itemIds], allocations: [...lot.allocations], place, seller, tripId: lot.tripId || null };
}

function cleanTrip(t, E) {
  if (!isObj(t)) { E.push('запись поездки не объект'); return null; }
  if (!isText(t.id, 100) || !t.id) E.push('нет id поездки');
  if (!isDate(t.date)) E.push('нет даты поездки');
  if (!isMiles(t.miles) || !(t.miles > 0)) E.push('мили поездки испорчены');
  // ставки нет — null («неизвестна»), а не 0 (иначе сумма $0 вместо «неизвестна»)
  if (!nullOr(t.rateUsed, (v) => isRate(v) && v > 0)) E.push('ставка поездки испорчена');
  if (!Object.hasOwn(TRIP_KINDS, t.kind)) E.push('цель поездки испорчена');
  if (!nullOr(t.createdAt, isIso)) E.push('дата записи поездки испорчена');
  const from = textOr(t.from, 100, E, '«откуда» испорчено');
  const to = textOr(t.to, 100, E, '«куда» испорчено');
  const purpose = textOr(t.purpose, 200, E, '«зачем» испорчено');
  if (E.length) return null;
  return { id: t.id, createdAt: t.createdAt ?? null, date: t.date, from, to, kind: t.kind, purpose, miles: t.miles, rateUsed: t.rateUsed ?? null };
}

function cleanExpense(x, E) {
  if (!isObj(x)) { E.push('запись расхода не объект'); return null; }
  if (!isText(x.id, 100) || !x.id) E.push('нет id расхода');
  if (!isDate(x.date)) E.push('нет даты расхода');
  if (!Object.hasOwn(EXPENSE_CATEGORIES, x.category)) E.push('категория расхода испорчена');
  if (!isMoney(x.amount) || !(x.amount > 0)) E.push('сумма расхода испорчена');
  if (!nullOr(x.createdAt, isIso)) E.push('дата записи расхода испорчена');
  const note = textOr(x.note, 200, E, 'заметка расхода испорчена');
  const receipt = textOr(x.receipt, 200, E, 'заметка про чек испорчена');
  if (E.length) return null;
  return { id: x.id, createdAt: x.createdAt ?? null, date: x.date, category: x.category, amount: x.amount, note, receipt };
}

function cleanRule(r, E) {
  if (!isObj(r)) { E.push('правило не объект'); return null; }
  if (!isText(r.id, 100) || !r.id) E.push('нет id правила');
  const meta = RULE_KEYS[r.key];
  if (!meta || !Object.hasOwn(RULE_KEYS, r.key)) { E.push('неизвестное правило'); return null; }
  if (!ruleValueOk(meta.unit, r.value)) E.push('значение правила испорчено');
  if (!(Number.isInteger(r.taxYear) && r.taxYear >= 2000 && r.taxYear <= 2100)) E.push('налоговый год правила испорчен');
  if (!nullOr(r.validFrom, isDate) || !nullOr(r.validTo, isDate)) E.push('период правила испорчен');
  if (meta.byDate && !isDate(r.validFrom)) E.push('у ставки нет даты начала');
  if (isDate(r.validFrom) && isDate(r.validTo) && r.validTo < r.validFrom) E.push('период правила испорчен');
  if (!(r.sourceUrl === undefined || r.sourceUrl === '' || (isText(r.sourceUrl, 300) && HTTPS_URL.test(r.sourceUrl)))) E.push('ссылка правила — только https://');
  if (!nullOr(r.verifiedAt, isDate) || !nullOr(r.nextCheck, isDate)) E.push('даты проверки правила испорчены');
  if (!Object.hasOwn(RULE_STATUS, r.status)) E.push('статус правила испорчен');
  if (!nullOr(r.builtin, (v) => typeof v === 'boolean') || !nullOr(r.edited, (v) => typeof v === 'boolean')) E.push('правило испорчено');
  const note = textOr(r.note, 200, E, 'заметка правила испорчена');
  if (E.length) return null;
  return {
    id: r.id, key: r.key, value: r.value, taxYear: r.taxYear, validFrom: r.validFrom ?? null, validTo: r.validTo ?? null,
    sourceUrl: r.sourceUrl || '', verifiedAt: r.verifiedAt ?? null, nextCheck: r.nextCheck ?? null, status: r.status, note,
    builtin: r.builtin === true, edited: r.edited === true,
  };
}

// Список записей: каждая проверяется отдельно, испорченные — в problems с номером.
function cleanList(raw, key, what, cleaner, P) {
  const out = [];
  if (raw[key] === undefined) return out;
  if (!Array.isArray(raw[key])) { P.push(`список «${what}» испорчен`); return out; }
  const ids = new Set();
  for (const [i, x] of raw[key].entries()) {
    const E = [];
    const c = cleaner(x, E);
    if (!c) { P.push(`${what} №${i + 1}: ${[...new Set(E)].slice(0, 3).join(', ')}`); continue; }
    if (ids.has(c.id)) { P.push(`${what} №${i + 1}: повторяется id`); continue; }
    ids.add(c.id);
    out.push(c);
  }
  return out;
}

// Версия данных: в памяти телефона — поле version (у среза 1 — 1 или нет поля), в копии — версия файла.
export function dataVersion(raw) {
  if (!isObj(raw) || raw.version === undefined) return 1;
  return raw.version;
}

// Собрать состояние заново из сырых данных. problems — что испорчено (испорченные записи не попадают в state).
// fromVersion: 1 — данные среза 1 (переводятся в версию 2), 2 — текущие. now — дата перевода настроек среза 1.
// keepSync — только для памяти телефона: отметка, какие данные среза 1 уже перенесены (meta.v1Sync, см. syncLegacy);
// в файл копии она не попадает и из файла не берётся.
export function sanitizeState(raw, { fromVersion = dataVersion(raw), now = new Date(), keepSync = false } = {}) {
  const P = [];
  const d = defaultState();
  if (!isObj(raw)) return { state: d, problems: raw === null || raw === undefined ? [] : ['данные испорчены'] };
  if (!(fromVersion === 1 || fromVersion === SCHEMA_VERSION)) return { state: d, problems: [`неизвестная версия данных (${String(fromVersion).slice(0, 10)})`] };
  const settings = cleanSettings(raw.settings, P);
  const legacy = fromVersion === 1 ? migrateV1Settings(raw.settings, P) : null;
  const items = [];
  const ids = new Set();
  if (raw.items !== undefined && !Array.isArray(raw.items)) P.push('список вещей испорчен');
  for (const [i, it] of (Array.isArray(raw.items) ? raw.items : []).entries()) {
    const E = [];
    const c = cleanItem(it, E, fromVersion);
    const name = isObj(it) && typeof it.title === 'string' && it.title ? `«${it.title.slice(0, 40)}»` : `вещь №${i + 1}`;
    if (!c) { P.push(`${name}: ${[...new Set(E)].slice(0, 3).join(', ')}`); continue; }
    if (ids.has(c.id)) { P.push(`${name}: повторяется id`); continue; }
    ids.add(c.id);
    items.push(c);
  }
  const lots = [];
  if (raw.lots !== undefined && !Array.isArray(raw.lots)) P.push('список лотов испорчен');
  for (const [i, lot] of (Array.isArray(raw.lots) ? raw.lots : []).entries()) {
    const E = [];
    const c = cleanLot(lot, E, fromVersion);
    if (!c) { P.push(`лот №${i + 1}: ${[...new Set(E)].slice(0, 3).join(', ')}`); continue; }
    const bad = c.itemIds.find((id) => { const it = items.find((x) => x.id === id); return !it || !it.have || it.have.lotId !== c.id; });
    if (bad) { P.push(`лот №${i + 1}: вещи лота не найдены или не ссылаются на лот`); continue; }
    lots.push(c);
  }
  for (const it of items) {
    if (it.have && it.have.lotId && !lots.some((l) => l.id === it.have.lotId)) P.push(`«${it.title.slice(0, 40)}»: лот этой вещи не найден`);
  }
  // Срез 2: поездки, расходы, реестр правил (в данных версии 1 их нет — пустые списки и правила программы).
  const trips = cleanList(raw, 'trips', 'поездка', cleanTrip, P);
  const expenses = cleanList(raw, 'expenses', 'расход', cleanExpense, P);
  const storedRules = cleanList(raw, 'taxRules', 'правило', cleanRule, P);
  // правило программы с чужим ключом (например, порог 1099-K, переделанный в ставку) — испорчено
  const builtinKey = new Map(builtinRules().map((r) => [r.id, r.key]));
  for (const r of storedRules) if (builtinKey.has(r.id) && builtinKey.get(r.id) !== r.key) P.push(`правило программы «${r.id.slice(0, 40)}» испорчено`);
  const taxRules = mergeRules(storedRules.filter((r) => !builtinKey.has(r.id) || builtinKey.get(r.id) === r.key));
  // снимок % категории для «≈ комиссии» у продаж без него (данные среза 1 и записи до снимка) — на день загрузки
  const fill = (it, sold) => (sold && !sold.feeBasis ? { ...sold, feeBasis: feeBasisFor(it, settings) } : sold);
  for (const [k, it] of items.entries()) {
    const sold = fill(it, it.sold);
    const pastSales = it.pastSales.map((p) => (p.sold.feeBasis ? p : { ...p, sold: fill(it, p.sold) }));
    if (sold !== it.sold || pastSales.some((p, i) => p !== it.pastSales[i])) items[k] = { ...it, sold, pastSales };
  }
  // Ссылка покупки/лота на поездку — только на существующую поездку того же дня (иначе ссылка снимается).
  const tripById = new Map(trips.map((t) => [t.id, t]));
  const linkOk = (tripId, date) => tripId && tripById.has(tripId) && tripById.get(tripId).date === date;
  for (const [k, it] of items.entries()) {
    if (it.have && it.have.tripId && !linkOk(it.have.tripId, it.have.date)) items[k] = { ...it, have: { ...it.have, tripId: null } };
  }
  for (const [k, l] of lots.entries()) if (l.tripId && !linkOk(l.tripId, l.date)) lots[k] = { ...l, tripId: null };
  let lastExportAt = null;
  if (isObj(raw.meta) && raw.meta.lastExportAt !== undefined && raw.meta.lastExportAt !== null) {
    if (isIso(raw.meta.lastExportAt)) lastExportAt = raw.meta.lastExportAt;
    else P.push('дата последней копии испорчена');
  }
  let migratedFromV1 = null;
  if (legacy) migratedFromV1 = { at: now.toISOString(), mileRate: legacy.mileRate, k1099: legacy.k1099 };
  else if (isObj(raw.meta) && raw.meta.migratedFromV1 !== undefined && raw.meta.migratedFromV1 !== null) {
    const m = raw.meta.migratedFromV1;
    const ok = isObj(m) && isIso(m.at) && nullOr(m.mileRate, (v) => inRange(v, 0, 10))
      && (m.k1099 === null || m.k1099 === undefined || (isObj(m.k1099) && inRange(m.k1099.minGross, 0, 1e9) && inRange(m.k1099.minCount, 0, 1e7)));
    if (ok) migratedFromV1 = { at: m.at, mileRate: m.mileRate ?? null, k1099: m.k1099 ? { minGross: m.k1099.minGross, minCount: m.k1099.minCount } : null };
    else P.push('отметка о переводе со старой версии испорчена');
  }
  const meta = { lastExportAt, migratedFromV1 };
  if (keepSync && isObj(raw.meta) && raw.meta.v1Sync) {
    const v = cleanV1Sync(raw.meta.v1Sync);
    if (v) meta.v1Sync = v;
  }
  return { state: { version: SCHEMA_VERSION, settings, items, lots, trips, expenses, taxRules, meta }, problems: P };
}

// Привести сохранённые данные к текущему виду (недостающие поля — по умолчанию, испорченные записи — отбросить).
export function normalizeState(raw) {
  return sanitizeState(raw).state;
}

export function exportBackup(state, now = new Date()) {
  // отметка переноса из старого ключа памяти относится только к этому телефону — в файл не идёт
  const data = { ...state, meta: { lastExportAt: state.meta.lastExportAt ?? null, migratedFromV1: state.meta.migratedFromV1 ?? null } };
  return JSON.stringify({ schema: SCHEMA, version: SCHEMA_VERSION, exportedAt: now.toISOString(), data }, null, 2);
}

// ---------- старая программа в другой вкладке (данные среза 1 после перевода) ----------
// После перевода новая версия читает только 'perekup.v2'. Вкладка со старой программой (до её обновления)
// продолжает писать в 'perekup.v1'. Чтобы эти записи не пропали, при переводе запоминается отпечаток каждой
// вещи и лота среза 1 (meta.v1Sync), а приложение отмечает вещи, изменённые уже в новой версии (touched).
// Если старый ключ изменился: новые вещи и лоты — добавляются; вещь, изменённая там и не тронутая здесь, —
// берётся оттуда; изменённая и там, и здесь — остаётся как здесь и называется в предупреждении.

// FNV-1a (32 бита) — только чтобы заметить изменение записи, не для защиты.
export function hashText(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
const hashOf = (v) => hashText(JSON.stringify(v) ?? '');

function makeV1Sync(raw, text) {
  const map = (list) => Object.fromEntries((Array.isArray(list) ? list : []).filter((x) => isObj(x) && isText(x.id, 100) && x.id).map((x) => [x.id, hashOf(x)]));
  return { text: hashText(text), items: map(raw && raw.items), lots: map(raw && raw.lots), touched: [] };
}

function cleanV1Sync(v) {
  const hashMap = (m) => isObj(m) && Object.keys(m).length <= 20000 && Object.entries(m).every(([k, x]) => k.length <= 100 && isText(x, 16));
  if (!isObj(v) || !isText(v.text, 16) || !hashMap(v.items) || !hashMap(v.lots) || !Array.isArray(v.touched) || v.touched.length > 20000 || !v.touched.every((x) => isText(x, 100))) return null;
  return { text: v.text, items: Object.fromEntries(Object.entries(v.items)), lots: Object.fromEntries(Object.entries(v.lots)), touched: [...new Set(v.touched)] };
}

// Отметить вещи, изменённые в новой версии (их версию из старой вкладки не берём без спроса).
export function markTouched(state, ids) {
  const sync = state.meta && state.meta.v1Sync;
  if (!sync || !ids.length) return state;
  const t = new Set(sync.touched);
  const before = t.size;
  for (const id of ids) t.add(id);
  if (t.size === before) return state;
  return { ...state, meta: { ...state.meta, v1Sync: { ...sync, touched: [...t] } } };
}

export function syncLegacy(state, legacyText, now = new Date()) {
  const none = { state, changed: false, added: [], updated: [], conflicts: [], failed: false };
  const sync = state.meta && state.meta.v1Sync;
  if (!sync || typeof legacyText !== 'string' || !legacyText || hashText(legacyText) === sync.text) return none;
  let raw;
  try { raw = JSON.parse(legacyText); } catch { return none; }
  if (!isObj(raw)) return none;
  const conv = sanitizeState(raw, { fromVersion: 1, now }).state;
  const convItems = new Map(conv.items.map((x) => [x.id, x]));
  const known = (m, id) => Object.hasOwn(m, id);
  const touched = new Set(sync.touched);
  const items = [...state.items];
  const pos = new Map(items.map((x, i) => [x.id, i]));
  const added = [], updated = [], conflicts = [], taken = new Set();
  const nextItems = {};
  for (const r of Array.isArray(raw.items) ? raw.items : []) {
    if (!isObj(r) || !isText(r.id, 100) || !r.id) continue;
    const h = hashOf(r);
    nextItems[r.id] = h;
    if (known(sync.items, r.id) && sync.items[r.id] === h) continue; // в старой вкладке не менялась
    const c = convItems.get(r.id);
    if (!c) continue; // испорченную запись не переносим
    if (!pos.has(r.id)) {
      if (!known(sync.items, r.id)) { items.push(c); added.push(c.title); taken.add(c.id); }
      else conflicts.push(c.title); // здесь удалена, там изменена
    } else if (!touched.has(r.id)) { items[pos.get(r.id)] = c; updated.push(c.title); taken.add(c.id); }
    else conflicts.push(c.title);
  }
  const lots = [...(state.lots || [])];
  const lotIds = new Set(lots.map((l) => l.id));
  const nextLots = {};
  for (const r of Array.isArray(raw.lots) ? raw.lots : []) {
    if (!isObj(r) || !isText(r.id, 100) || !r.id) continue;
    nextLots[r.id] = hashOf(r);
    const c = conv.lots.find((l) => l.id === r.id);
    if (c && !lotIds.has(c.id) && !known(sync.lots, c.id)) lots.push(c);
  }
  const v1Sync = { text: hashText(legacyText), items: nextItems, lots: nextLots, touched: [...touched].filter((id) => !taken.has(id)) };
  const merged = { ...state, items, lots, meta: { ...state.meta, v1Sync } };
  const chk = sanitizeState(merged, { fromVersion: SCHEMA_VERSION, now, keepSync: true });
  if (chk.problems.length) {
    // не сходится (например, лот отменён там, а вещи изменены здесь) — ничего не переносим, только называем
    return { state: { ...state, meta: { ...state.meta, v1Sync: { ...v1Sync, touched: [...touched] } } }, changed: true, added: [], updated: [], conflicts: [...added, ...updated, ...conflicts], failed: true };
  }
  return { state: chk.state, changed: true, added, updated, conflicts, failed: false };
}

const MAX_BACKUP_CHARS = 20_000_000;

// Импорт копии — строго: если хоть что-то испорчено, копия не загружается целиком, текущие данные не трогаются.
export function parseBackup(text, now = new Date()) {
  if (typeof text !== 'string' || text.length > MAX_BACKUP_CHARS) return { ok: false, error: 'Файл слишком большой или пустой — это не копия «Перекупа».' };
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Файл не читается: это не копия «Перекупа» (не JSON).' };
  }
  if (!isObj(obj) || obj.schema !== SCHEMA) return { ok: false, error: 'Это не копия «Перекупа».' };
  if (!(Number.isInteger(obj.version) && obj.version >= 1)) return { ok: false, error: 'Это не копия «Перекупа» (нет версии).' };
  if (obj.version > SCHEMA_VERSION) return { ok: false, error: `Копия от более новой версии программы (${String(obj.version).slice(0, 10)}). Обновите приложение.` };
  const data = obj.data;
  if (!isObj(data) || !Array.isArray(data.items)) return { ok: false, error: 'В копии нет списка вещей.' };
  // версия внутри данных (если есть) должна совпадать с версией файла
  if (data.version !== undefined && data.version !== obj.version) return { ok: false, error: 'Копия испорчена, загружать её нельзя: версия данных не совпадает с версией файла. Ваши данные не тронуты.' };
  const { state, problems } = sanitizeState(data, { fromVersion: obj.version, now });
  if (problems.length) {
    const more = problems.length > 3 ? ` и ещё ${problems.length - 3}` : '';
    return { ok: false, error: `Копия испорчена, загружать её нельзя: ${problems.slice(0, 3).join('; ')}${more}. Ваши данные не тронуты.`, problems };
  }
  return { ok: true, state, exportedAt: isIso(obj.exportedAt) ? obj.exportedAt : null, fromVersion: obj.version };
}

// Чтение из памяти телефона. Если данных версии 2 ещё нет, а есть данные среза 1 ('perekup.v1') —
// они переводятся в версию 2 (migrated: true; приложение сразу сохраняет результат под новым ключом,
// а старый ключ не трогает).
export function loadState(storage, now = new Date()) {
  let text = null;
  let migrated = false;
  try {
    text = storage.getItem(STORAGE_KEY);
    if (!text) {
      text = storage.getItem(LEGACY_STORAGE_KEY);
      migrated = !!text;
    }
  } catch {
    return { state: defaultState(), error: 'Память браузера не читается.', raw: null, migrated: false };
  }
  if (!text) return { state: defaultState(), error: null, raw: null, migrated: false };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    // raw — испорченный текст: приложение откладывает его в отдельный ключ, чтобы следующая запись его не стёрла
    return { state: defaultState(), error: 'Не удалось прочитать сохранённые данные (испорченный текст отложен отдельно).', raw: text, migrated: false };
  }
  // в старом ключе — всегда данные среза 1, даже если поле version испорчено
  const { state, problems } = sanitizeState(raw, { fromVersion: migrated ? 1 : dataVersion(raw), now, keepSync: !migrated });
  if (migrated) state.meta.v1Sync = makeV1Sync(raw, text);
  if (problems.length) {
    return { state, error: `Часть сохранённых данных испорчена и не показана (${problems.length}): ${problems.slice(0, 2).join('; ')}. Полный текст отложен отдельно.`, raw: text, migrated };
  }
  return { state, error: null, raw: null, migrated };
}

export function saveState(storage, state) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// ---------- испорченные данные в памяти телефона ----------
// Испорченный текст откладывается в 'perekup.broken.<время>' — но только один раз: тот же текст второй раз
// не откладывается (иначе каждое открытие добавляло бы полную копию и забило память Safari). Хранится не больше
// MAX_BROKEN копий (старые удаляются). «Стереть все данные» (wipeStorage) убирает и их.
export const MAX_BROKEN = 3;

function storageKeys(storage) {
  const out = [];
  try {
    const n = typeof storage.length === 'number' ? storage.length : 0;
    for (let i = 0; i < n; i++) {
      const k = typeof storage.key === 'function' ? storage.key(i) : null;
      if (typeof k === 'string') out.push(k);
    }
  } catch { /* память не читается — пусто */ }
  return out;
}

export function brokenKeys(storage) {
  return storageKeys(storage).filter((k) => k.startsWith(BROKEN_KEY_PREFIX)).sort();
}

// raw — испорченный текст. Возвращает { ok, key, duplicate }: ok — текст сохранён (сейчас или раньше).
export function setAsideBroken(storage, raw, now = Date.now()) {
  if (typeof raw !== 'string' || !raw) return { ok: false, key: null, duplicate: false };
  const keys = brokenKeys(storage);
  for (const k of keys) {
    try { if (storage.getItem(k) === raw) return { ok: true, key: k, duplicate: true }; } catch { /* дальше */ }
  }
  let key = BROKEN_KEY_PREFIX + now;
  while (keys.includes(key)) key += '-1';
  try {
    storage.setItem(key, raw);
  } catch {
    return { ok: false, key: null, duplicate: false };
  }
  const all = [...keys, key].sort((a, b) => Number(a.slice(BROKEN_KEY_PREFIX.length).split('-')[0]) - Number(b.slice(BROKEN_KEY_PREFIX.length).split('-')[0]));
  for (const k of all.slice(0, Math.max(0, all.length - MAX_BROKEN))) {
    try { storage.removeItem(k); } catch { /* ignore */ }
  }
  return { ok: true, key, duplicate: false };
}

// «Стереть все данные»: данные, запасная копия среза 1, черновик оценки и отложенные испорченные копии.
export function wipeStorage(storage) {
  for (const k of [STORAGE_KEY, LEGACY_STORAGE_KEY, DRAFT_KEY, ...brokenKeys(storage)]) {
    try { storage.removeItem(k); } catch { /* ignore */ }
  }
}

// Вещи, изменённые между двумя состояниями (новый объект, новая или удалённая вещь) — для отметки «изменено
// в новой версии» (meta.v1Sync.touched), чтобы запись старой вкладки не затёрла правку молча.
export function changedItemIds(prevItems, nextItems) {
  const before = new Map((prevItems || []).map((x) => [x.id, x]));
  const out = [];
  for (const x of nextItems || []) {
    if (before.get(x.id) !== x) out.push(x.id);
    before.delete(x.id);
  }
  for (const id of before.keys()) out.push(id);
  return out;
}
