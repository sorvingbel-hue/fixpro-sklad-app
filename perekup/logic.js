// «Перекуп» — логика приложения без DOM: ввод, склад, итоги, копия.
// Деньги и решения считает ядро perekup-core (core/calc.js собран из perekup-core/src/calc.ts).
// Здесь только подготовка ввода, проверки и учёт; своей копии формул нет.
// Правила (ТЗ §1): числа вводит человек из приложения eBay; ничего не уходит в сеть и в ИИ.

import { allocateLot, form1099kStatus, maxOffer, netProfit, payoutDays, sellThrough, verdict } from './core/calc.js';

export const SCHEMA = 'perekup';
export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'perekup.v1';
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

export function defaultSettings() {
  return {
    categories: defaultCategories(),
    // $/миля. По исследованию: 72,5¢ (01.01–30.06.2026), 76¢ (с 01.07.2026). Проверить на irs.gov до релиза.
    mileRate: 0.76,
    // Налог покупателя, с которого eBay тоже берёт комиссию (ТЗ §5, est_buyer_tax). Примерно; 7,75% — Сан-Диего.
    buyerTaxPct: 0.0775,
    // 1099-K за 2025–2026: больше $20 000 И больше 200 сделок (реестр правил, проверять по irs.gov).
    k1099: { minGross: 20000, minCount: 200 },
    // Оценка срока выплаты — только по своим прошлым выплатам, если их не меньше стольки.
    payoutEstimateMinN: 3,
    // ТЗ §7: флаг «слишком дёшево — возможно краденое», если просят меньше этой доли медианы.
    cheapFlagPct: 0.1,
  };
}

export function defaultState() {
  return { version: SCHEMA_VERSION, settings: defaultSettings(), items: [], lots: [], meta: { lastExportAt: null } };
}

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
      mileRate: settings.mileRate,
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
    case 'have': return item.have && item.have.origin !== 'bought' ? 'Своя, на складе' : 'Куплена';
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
  const date = String(raw.date || '').trim();
  if (!isDate(date)) errors.date = 'укажите дату';
  else {
    const prev = prevDateOf(item, step);
    if (prev && date < prev.date) errors.date = `дата ${STEP_DATE_NAME[step]} раньше даты ${STEP_DATE_NAME[prev.step]} (${fmtDate(prev.date)})`;
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
    const miles = num('miles', NUM.miles);
    const keepRate = item.have && typeof item.have.mileRate === 'number' ? item.have.mileRate : settings.mileRate;
    data = {
      date, origin, buyPrice,
      salesTax: extra('salesTax'), buyerPremium: extra('buyerPremium'), freight: extra('freight'),
      place: text('place', 100), seller: text('seller', 100), sku: text('sku', 40), location: text('location', 80),
      miles: miles ?? 0, mileRate: keepRate, lotId: (item.have && item.have.lotId) || null,
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
    let fees = num('fees', NUM.money); // eBay: пусто = посчитать по % категории (помечается «≈»)
    const adFee = num('adFee', NUM.money);
    const taxCollected = num('taxCollected', NUM.money); // налог, который удержала площадка: не доход
    const refund = num('refund', NUM.money);
    if (channel === 'cash') {
      // Наличные при встрече: доставки, этикетки и комиссии нет, деньги на руках сразу.
      fees = 0;
      if (shipCharged === null) shipCharged = 0;
      if (label === null) label = 0;
    } else {
      if (shipCharged === null && !errors.shipCharged) errors.shipCharged = 'введите 0, если доставка бесплатная';
      if ((channel === 'marketplace' || channel === 'offerup') && fees === null && !errors.fees) errors.fees = 'введите комиссию площадки (0 — если встречались лично)';
    }
    if (refund !== null && price !== null && shipCharged !== null && refund > price + shipCharged) errors.refund = 'возврат больше суммы продажи';
    data = { date, channel, price, shipCharged, label, packaging: packaging ?? 0, fees, adFee: channel === 'cash' ? 0 : adFee ?? 0, taxCollected: channel === 'cash' ? null : taxCollected, refund: refund ?? 0 };
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
  if (item.status === 'have' && item.have && item.have.lotId) return item; // из лота назад не откатываем: доли посчитаны вместе
  if (item.status === 'paid' && item.paid && item.paid.cash) return { ...item, status: 'listed', sold: null, paid: null, shipped: null };
  const out = { ...item, [item.status]: null, status: STATUSES[i - 1] };
  if (item.status === 'sold') out.shipped = null;
  if (item.status === 'have') out.checked = null;
  return out;
}

// «Списать»: не продано или лом (ТЗ M2). Себестоимость остаётся в учёте.
export function writeOff(item, raw) {
  if (item.status !== 'have' && item.status !== 'listed') return fail({ step: 'списать можно вещь на складе' });
  const errors = {};
  const date = String(raw.date || '').trim();
  const last = item.status === 'listed' ? item.listed.date : item.have.date;
  if (!isDate(date)) errors.date = 'укажите дату';
  else if (date < last) errors.date = `дата раньше ${item.status === 'listed' ? 'выставления' : 'покупки'} (${fmtDate(last)})`;
  const kind = Object.hasOwn(WRITEOFF_KINDS, raw.kind) ? raw.kind : null;
  if (!kind) errors.kind = 'выберите: не продано или лом';
  const note = String(raw.note ?? '').trim();
  if (note.length > 300) errors.note = 'не длиннее 300 знаков';
  if (Object.keys(errors).length) return fail(errors);
  return { ok: true, item: { ...item, status: 'writeoff', writeoff: { date, kind, note, fromStatus: item.status } }, errors: {} };
}

// «Проверил» (ТЗ M2: статус «проверено») — отметка, путь вещи не меняется.
export function markChecked(item, raw) {
  if (item.status !== 'have' && item.status !== 'listed') return fail({ step: 'проверку отмечают для вещи на складе' });
  const errors = {};
  const date = String(raw.date || '').trim();
  if (!isDate(date)) errors.date = 'укажите дату';
  else if (date < item.have.date) errors.date = `дата раньше покупки (${fmtDate(item.have.date)})`;
  const result = Object.hasOwn(CHECK_RESULTS, raw.result) ? raw.result : null;
  if (!result) errors.result = 'выберите результат проверки';
  const note = String(raw.note ?? '').trim();
  if (note.length > 300) errors.note = 'не длиннее 300 знаков';
  if (Object.keys(errors).length) return fail(errors);
  return { ok: true, item: { ...item, checked: { date, result, note } }, errors: {} };
}

// «Отправил» (ТЗ M2: статус «отправлено») — дата и трек; деньги по-прежнему ждём от площадки.
export function markShipped(item, raw) {
  if (!item.sold || (item.status !== 'sold' && item.status !== 'paid') || item.sold.channel === 'cash') return fail({ step: 'отправку отмечают для проданной вещи (не за наличные)' });
  const errors = {};
  const date = String(raw.date || '').trim();
  if (!isDate(date)) errors.date = 'укажите дату';
  else if (date < item.sold.date) errors.date = `дата раньше продажи (${fmtDate(item.sold.date)})`;
  const tracking = String(raw.tracking ?? '').trim();
  if (tracking.length > 60) errors.tracking = 'не длиннее 60 знаков';
  if (Object.keys(errors).length) return fail(errors);
  return { ok: true, item: { ...item, shipped: { date, tracking } }, errors: {} };
}

export function categoryFor(item, settings) {
  return settings.categories.find((c) => c.id === item.categoryId) || (item.eval && item.eval.category) || settings.categories[0];
}

// Итог продажи: валовая сумма, комиссия, чистая прибыль (через netProfit ядра).
export function saleResult(item, settings) {
  const s = item.sold;
  if (!s) return null;
  const cat = categoryFor(item, settings);
  const cashNoFee = s.channel === 'cash' && (s.fees === null || s.fees === undefined);
  const feesKnown = typeof s.fees === 'number' || cashNoFee;
  const adFee = n0(s.adFee);
  const refund = n0(s.refund);
  // введённая комиссия → категория с feePct 0 и «за заказ» = комиссия (+ реклама); иначе — % категории (+ реклама)
  const feeCat = feesKnown ? { ...cat, feePct: 0, perOrderFee: n0(s.fees) + adFee } : { ...cat, perOrderFee: cat.perOrderFee + adFee };
  const estBuyerTax = feesKnown ? 0 : typeof s.taxCollected === 'number' ? s.taxCollected : settings.buyerTaxPct * (s.price + s.shipCharged);
  const comps = { medianSold: s.price, sold90: null, activeNow: null, shipCharged: s.shipCharged };
  const gross = round2(s.price + s.shipCharged);
  const fees = round2(gross - netProfit(feeCat, comps, { estBuyerTax }));
  const feesEstimated = !feesKnown;
  // Сколько придёт от площадки: продажа минус комиссии и возврат (налог площадка перечисляет сама, это не доход).
  const payout = round2(gross - fees - refund);
  if (s.label === null || s.label === undefined) {
    return { gross, fees, feesEstimated, refund, payout, net: null, incomplete: 'нет стоимости этикетки' };
  }
  const h = item.have || {};
  // возврат покупателю уменьшает итог сделки (в формуле ядра его нет — вычитается отдельно)
  const net = netProfit(feeCat, comps, {
    buyPrice: basisOf(h),
    label: s.label,
    packaging: s.packaging ?? 0,
    miles: h.miles ?? 0,
    mileRate: h.mileRate ?? 0,
    estBuyerTax,
  }) - refund;
  return { gross, fees, feesEstimated, refund, payout, net: round2(net), incomplete: null };
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

export function totals(state, year = Number(todayLocal().slice(0, 4))) {
  const { items, settings } = state;
  const counts = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0]));
  let invested = 0, trips = 0, stockCount = 0, stockBasis = 0, woCount = 0, woBasis = 0;
  let soldCount = 0, soldGross = 0, netSum = 0, netIncomplete = 0, feesEstimated = 0, refundCount = 0, refundSum = 0;
  let transitCount = 0, transitAmount = 0, receivedCount = 0, receivedAmount = 0, receivedEstimated = 0, cashCount = 0;
  let evaluated = 0, passed = 0;
  const salesByChannel = {};
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
      if (!it.have.lotId) trips += n0(it.have.miles) * n0(it.have.mileRate);
      if (it.status === 'have' || it.status === 'listed') { stockCount++; stockBasis += b; }
      if (it.status === 'writeoff') { woCount++; woBasis += b; }
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
      if (it.sold.channel !== 'cash' && it.sold.date.slice(0, 4) === String(year)) {
        (salesByChannel[it.sold.channel] ||= []).push({ gross: r.gross });
      }
    }
  }
  for (const lot of state.lots || []) trips += n0(lot.miles) * n0(lot.mileRate);
  const k1099 = Object.keys(CHANNELS)
    .filter((ch) => ch !== 'cash' && (ch === 'ebay' || salesByChannel[ch]))
    .map((ch) => ({ channel: ch, year, ...form1099kStatus(salesByChannel[ch] || [], settings.k1099) }));
  const payout = ownPayoutStats(items, 'ebay');
  return {
    counts,
    invested: round2(invested),
    trips: round2(trips),
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
  const miles = parseNumber(raw.miles, NUM.miles);
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
  const mileRate = state.settings.mileRate;
  const cat = state.settings.categories.find((c) => c.id === raw.categoryId) || state.settings.categories[0];
  const items = [...state.items];
  const itemIds = [];
  entries.forEach((e, i) => {
    const have = { date, origin: 'bought', buyPrice: cents[i] / 100, salesTax: 0, buyerPremium: 0, freight: 0, place, seller, sku: nextSku(state.items, i), location: '', miles: 0, mileRate, lotId };
    if (e.itemId) {
      const k = items.findIndex((x) => x.id === e.itemId);
      items[k] = { ...items[k], origin: 'bought', status: 'have', have };
      itemIds.push(e.itemId);
    } else {
      const id = newId();
      items.push({ id, createdAt: now.toISOString(), title: String(e.title).trim(), categoryId: cat.id, origin: 'bought', status: 'have', decision: null, eval: null, have, listed: null, sold: null, paid: null, checked: null, shipped: null, writeoff: null });
      itemIds.push(id);
    }
  });
  const lot = { id: lotId, date, total: total.value, miles: miles.value ?? 0, mileRate, itemIds, allocations: cents.map((c) => c / 100), place, seller };
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

export function undoLot(state, lotId) {
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
  return { ok: true, state: { ...state, items, lots: state.lots.filter((l) => l.id !== lotId) } };
}

// Удалить вещь. Вещь из лота удалить нельзя: сумма долей должна оставаться равной цене лота.
export function deleteItem(state, id) {
  const it = state.items.find((x) => x.id === id);
  if (!it) return { ok: false, error: 'вещь не найдена' };
  if (lotOf(state, it)) return { ok: false, error: 'вещь из лота: удалить можно, только отменив покупку всего лота (доли цены считались вместе)' };
  return { ok: true, state: { ...state, items: state.items.filter((x) => x.id !== id) } };
}

// ---------- проверка данных (хранение и копия) ----------
// Любые данные из памяти телефона или из файла копии собираются заново по известным полям с проверкой типов:
// чужой «файл копии» не может подсунуть ни код в интерфейс, ни поломанную запись, роняющую экраны.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const inRange = (v, lo, hi) => isNum(v) && v >= lo && v <= hi;
const isMoney = (v) => inRange(v, 0, 10_000_000);
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
const SETTING_CHECKS = {
  mileRate: [(v) => inRange(v, 0, 10), 'ставка за милю вне 0–10'],
  buyerTaxPct: [(v) => inRange(v, 0, 0.3), 'налог покупателя вне 0–30%'],
  payoutEstimateMinN: [(v) => inRange(v, 1, 1000) && Number.isInteger(v), 'число выплат для оценки — целое 1–1000'],
  cheapFlagPct: [(v) => inRange(v, 0, 1), 'флаг «слишком дёшево» вне 0–100%'],
};

export function validateSettings(s) {
  const errs = [];
  for (const [k, [ok, msg]] of Object.entries(SETTING_CHECKS)) if (!ok(s[k])) errs.push(msg);
  if (!isObj(s.k1099) || !inRange(s.k1099.minGross, 0, 1e9)) errs.push('порог 1099-K (сумма) неверный');
  if (!isObj(s.k1099) || !inRange(s.k1099.minCount, 0, 1e7) || !Number.isInteger(s.k1099.minCount)) errs.push('порог 1099-K (сделок) — целое число ≥ 0');
  return errs;
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
  if (s.k1099 !== undefined) {
    if (!isObj(s.k1099)) P.push('настройки: порог 1099-K испорчен');
    else {
      out.k1099 = { ...d.k1099 };
      if (s.k1099.minGross !== undefined) { if (inRange(s.k1099.minGross, 0, 1e9)) out.k1099.minGross = s.k1099.minGross; else P.push('настройки: порог 1099-K (сумма) неверный'); }
      if (s.k1099.minCount !== undefined) { if (inRange(s.k1099.minCount, 0, 1e7) && Number.isInteger(s.k1099.minCount)) out.k1099.minCount = s.k1099.minCount; else P.push('настройки: порог 1099-K (сделок) неверный'); }
    }
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

function cleanItem(it, E) {
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
  const obj = (v, what) => (v === undefined || v === null ? null : isObj(v) ? v : (E.push(what), null));
  const dateOk = (d, what) => { if (!isDate(d)) E.push(what); return d; };

  let have = obj(it.have, 'покупка испорчена');
  if (have) {
    const h = have;
    dateOk(h.date, 'нет даты покупки');
    if (!Object.hasOwn(ORIGINS, h.origin)) E.push('происхождение в покупке испорчено');
    if (!isMoney(h.buyPrice)) E.push('цена покупки испорчена');
    for (const k of ['salesTax', 'buyerPremium', 'freight']) if (!nullOr(h[k], isMoney)) E.push('расходы на покупку испорчены');
    if (!nullOr(h.miles, (v) => inRange(v, 0, 100_000)) || !nullOr(h.mileRate, (v) => inRange(v, 0, 10))) E.push('мили испорчены');
    if (!nullOr(h.lotId, (v) => isText(v, 100))) E.push('ссылка на лот испорчена');
    have = {
      date: h.date, origin: h.origin, buyPrice: h.buyPrice,
      salesTax: h.salesTax ?? 0, buyerPremium: h.buyerPremium ?? 0, freight: h.freight ?? 0,
      place: textOr(h.place, 100, E, 'место покупки испорчено'), seller: textOr(h.seller, 100, E, 'продавец испорчен'),
      sku: textOr(h.sku, 40, E, 'SKU испорчен'), location: textOr(h.location, 80, E, 'место хранения испорчено'),
      miles: h.miles ?? 0, mileRate: h.mileRate ?? 0, lotId: h.lotId || null,
    };
  }
  let listed = obj(it.listed, 'выставление испорчено');
  if (listed) {
    dateOk(listed.date, 'нет даты выставления');
    if (!nullOr(listed.price, isMoney)) E.push('цена объявления испорчена');
    listed = { date: listed.date, price: listed.price ?? null };
  }
  let sold = obj(it.sold, 'продажа испорчена');
  if (sold) {
    const s = sold;
    dateOk(s.date, 'нет даты продажи');
    if (!Object.hasOwn(CHANNELS, s.channel)) E.push('площадка продажи испорчена');
    if (!isMoney(s.price) || !(s.price > 0)) E.push('цена продажи испорчена');
    if (!isMoney(s.shipCharged)) E.push('доставка с покупателя испорчена');
    if (!nullOr(s.label, isMoney) || !nullOr(s.packaging, isMoney) || !nullOr(s.fees, isMoney) || !nullOr(s.adFee, isMoney) || !nullOr(s.taxCollected, isMoney) || !nullOr(s.refund, isMoney)) E.push('расходы продажи испорчены');
    sold = { date: s.date, channel: s.channel, price: s.price, shipCharged: s.shipCharged, label: s.label ?? null, packaging: s.packaging ?? 0, fees: s.fees ?? null, adFee: s.adFee ?? 0, taxCollected: s.taxCollected ?? null, refund: s.refund ?? 0 };
  }
  let paid = obj(it.paid, 'выплата испорчена');
  if (paid) {
    dateOk(paid.date, 'нет даты выплаты');
    if (!nullOr(paid.amount, isMoney) || !nullOr(paid.withheld, isMoney)) E.push('сумма выплаты испорчена');
    if (!nullOr(paid.cash, (v) => typeof v === 'boolean')) E.push('выплата испорчена');
    paid = { date: paid.date, amount: paid.amount ?? null, payoutId: textOr(paid.payoutId, 80, E, 'ID выплаты испорчен'), withheld: paid.withheld ?? null, cash: paid.cash === true };
  }
  let checked = obj(it.checked, 'проверка испорчена');
  if (checked) {
    dateOk(checked.date, 'нет даты проверки');
    if (!Object.hasOwn(CHECK_RESULTS, checked.result)) E.push('результат проверки испорчен');
    checked = { date: checked.date, result: checked.result, note: textOr(checked.note, 300, E, 'заметка проверки испорчена') };
  }
  let shipped = obj(it.shipped, 'отправка испорчена');
  if (shipped) {
    dateOk(shipped.date, 'нет даты отправки');
    shipped = { date: shipped.date, tracking: textOr(shipped.tracking, 60, E, 'трек испорчен') };
  }
  let writeoff = obj(it.writeoff, 'списание испорчено');
  if (writeoff) {
    dateOk(writeoff.date, 'нет даты списания');
    if (!Object.hasOwn(WRITEOFF_KINDS, writeoff.kind) || !['have', 'listed'].includes(writeoff.fromStatus)) E.push('списание испорчено');
    writeoff = { date: writeoff.date, kind: writeoff.kind, note: textOr(writeoff.note, 300, E, 'заметка списания испорчена'), fromStatus: writeoff.fromStatus };
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
  const seq = [have, listed, sold, paid].filter(Boolean).map((x) => x.date);
  for (let i = 1; i < seq.length; i++) if (seq[i] < seq[i - 1]) E.push('даты шагов не по порядку');
  if (writeoff && seq.length && writeoff.date < seq[seq.length - 1]) E.push('дата списания раньше прошлого шага');
  if (shipped && sold && shipped.date < sold.date) E.push('дата отправки раньше продажи');
  if (checked && have && checked.date < have.date) E.push('дата проверки раньше покупки');
  if (E.length) return null;
  return {
    id: it.id, createdAt: it.createdAt ?? null, title: it.title, categoryId: it.categoryId ?? null, origin, status: it.status,
    decision, eval: ev, have, listed, sold, paid, checked, shipped, writeoff,
  };
}

function cleanLot(lot, E) {
  if (!isObj(lot)) { E.push('запись лота не объект'); return null; }
  if (!isText(lot.id, 100) || !lot.id) E.push('нет id лота');
  if (!isDate(lot.date)) E.push('нет даты лота');
  if (!isMoney(lot.total)) E.push('цена лота испорчена');
  if (!nullOr(lot.miles, (v) => inRange(v, 0, 100_000)) || !nullOr(lot.mileRate, (v) => inRange(v, 0, 10))) E.push('мили лота испорчены');
  const ids = Array.isArray(lot.itemIds) && lot.itemIds.length >= 2 && lot.itemIds.length <= 1000 && lot.itemIds.every((x) => isText(x, 100) && x) && new Set(lot.itemIds).size === lot.itemIds.length;
  if (!ids) E.push('список вещей лота испорчен');
  const allocs = Array.isArray(lot.allocations) && ids && lot.allocations.length === lot.itemIds.length && lot.allocations.every(isMoney);
  if (!allocs) E.push('доли лота испорчены');
  else if (isMoney(lot.total) && Math.round(lot.allocations.reduce((a, b) => a + b, 0) * 100) !== Math.round(lot.total * 100)) E.push('сумма долей не равна цене лота');
  const place = textOr(lot.place, 100, E, 'место покупки лота испорчено');
  const seller = textOr(lot.seller, 100, E, 'продавец лота испорчен');
  if (E.length) return null;
  return { id: lot.id, date: lot.date, total: lot.total, miles: lot.miles ?? 0, mileRate: lot.mileRate ?? 0, itemIds: [...lot.itemIds], allocations: [...lot.allocations], place, seller };
}

// Собрать состояние заново из сырых данных. problems — что испорчено (испорченные записи не попадают в state).
export function sanitizeState(raw) {
  const P = [];
  const d = defaultState();
  if (!isObj(raw)) return { state: d, problems: raw === null || raw === undefined ? [] : ['данные испорчены'] };
  const settings = cleanSettings(raw.settings, P);
  const items = [];
  const ids = new Set();
  if (raw.items !== undefined && !Array.isArray(raw.items)) P.push('список вещей испорчен');
  for (const [i, it] of (Array.isArray(raw.items) ? raw.items : []).entries()) {
    const E = [];
    const c = cleanItem(it, E);
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
    const c = cleanLot(lot, E);
    if (!c) { P.push(`лот №${i + 1}: ${[...new Set(E)].slice(0, 3).join(', ')}`); continue; }
    const bad = c.itemIds.find((id) => { const it = items.find((x) => x.id === id); return !it || !it.have || it.have.lotId !== c.id; });
    if (bad) { P.push(`лот №${i + 1}: вещи лота не найдены или не ссылаются на лот`); continue; }
    lots.push(c);
  }
  for (const it of items) {
    if (it.have && it.have.lotId && !lots.some((l) => l.id === it.have.lotId)) P.push(`«${it.title.slice(0, 40)}»: лот этой вещи не найден`);
  }
  let lastExportAt = null;
  if (isObj(raw.meta) && raw.meta.lastExportAt !== undefined && raw.meta.lastExportAt !== null) {
    if (isIso(raw.meta.lastExportAt)) lastExportAt = raw.meta.lastExportAt;
    else P.push('дата последней копии испорчена');
  }
  return { state: { version: SCHEMA_VERSION, settings, items, lots, meta: { lastExportAt } }, problems: P };
}

// Привести сохранённые данные к текущему виду (недостающие поля — по умолчанию, испорченные записи — отбросить).
export function normalizeState(raw) {
  return sanitizeState(raw).state;
}

export function exportBackup(state, now = new Date()) {
  return JSON.stringify({ schema: SCHEMA, version: SCHEMA_VERSION, exportedAt: now.toISOString(), data: state }, null, 2);
}

const MAX_BACKUP_CHARS = 20_000_000;

// Импорт копии — строго: если хоть что-то испорчено, копия не загружается целиком, текущие данные не трогаются.
export function parseBackup(text) {
  if (typeof text !== 'string' || text.length > MAX_BACKUP_CHARS) return { ok: false, error: 'Файл слишком большой или пустой — это не копия «Перекупа».' };
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Файл не читается: это не копия «Перекупа» (не JSON).' };
  }
  if (!isObj(obj) || obj.schema !== SCHEMA) return { ok: false, error: 'Это не копия «Перекупа».' };
  if (!(isNum(obj.version) && obj.version >= 1 && obj.version <= SCHEMA_VERSION)) return { ok: false, error: `Копия от более новой версии программы (${String(obj.version).slice(0, 10)}). Обновите приложение.` };
  const data = obj.data;
  if (!isObj(data) || !Array.isArray(data.items)) return { ok: false, error: 'В копии нет списка вещей.' };
  const { state, problems } = sanitizeState(data);
  if (problems.length) {
    const more = problems.length > 3 ? ` и ещё ${problems.length - 3}` : '';
    return { ok: false, error: `Копия испорчена, загружать её нельзя: ${problems.slice(0, 3).join('; ')}${more}. Ваши данные не тронуты.`, problems };
  }
  return { ok: true, state, exportedAt: isIso(obj.exportedAt) ? obj.exportedAt : null };
}

export function loadState(storage) {
  let text = null;
  try {
    text = storage.getItem(STORAGE_KEY);
  } catch {
    return { state: defaultState(), error: 'Память браузера не читается.', raw: null };
  }
  if (!text) return { state: defaultState(), error: null, raw: null };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    // raw — испорченный текст: приложение откладывает его в отдельный ключ, чтобы следующая запись его не стёрла
    return { state: defaultState(), error: 'Не удалось прочитать сохранённые данные (испорченный текст отложен отдельно).', raw: text };
  }
  const { state, problems } = sanitizeState(raw);
  if (problems.length) {
    return { state, error: `Часть сохранённых данных испорчена и не показана (${problems.length}): ${problems.slice(0, 2).join('; ')}. Полный текст отложен отдельно.`, raw: text };
  }
  return { state, error: null, raw: null };
}

export function saveState(storage, state) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
