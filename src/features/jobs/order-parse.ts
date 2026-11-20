// Разбор распознанного скрина заказа → черновик позиций на проверку бригадиру.
// Формат №1: список позиций заказа, у строки есть количество: «Qty: 6», «Qty 6», «x6», «6 x», «6 ea», «6 pcs»,
// число в колонке «Qty». Чистая логика без React Native: её проверяет tests/order-parse.test.mjs в Node.
//
// Главное правило: НЕ УГАДЫВАТЬ. Если цифры количества распознаны неуверенно (низкая уверенность слова,
// буква вместо цифры: O/0, l/1/I, S/5, B/8, Z/2; цифра шире обычной — две цифры слились, «11» прочитано как «1»)
// — qty = null и флаг «проверь количество». Пустое поле честнее неверной цифры: по нему бригадир сам посмотрит скрин.
// Итоги, цены, адреса, телефоны — отбрасываются.
//
// Голое число в конце строки («Filter MERV 13», «Breaker 2 pole 30») — количество ТОЛЬКО при доказательстве:
//  (а) явный маркер в строке или строкой ниже: «Qty 2», «Qty: 2», «x2», «2 ea/pcs/ft»;
//  (б) на скрине выше есть заголовок колонки количества («Qty», «Quantity», «Кол-во») и число стоит в этой
//      колонке по горизонтали (рамки слов из groupWordsToLines);
//  (в) число выровнено по краю с числом соседней строки (до 3 строк), уже стоящим в этой колонке, — колонка
//      чисел под заголовком (на фото экрана с перекосом колонка «уезжает» вбок постепенно).
//  Без рамок слов (только текст) вместо (б)/(в): заголовок вида «Description Qty» («Qty» последним, слева —
//  колонка названий) — число в конце строки стоит в этой колонке (если только на скрине не преобладают строки
//  с явным «Qty»). Одинокое «Qty» без рамок ничего не доказывает. В приложении рамки слов есть всегда.
// Без доказательства: число остаётся в названии, qty = null, флаг «проверь количество» и причина.

export type OcrBox = { x0: number; y0: number; x1: number; y1: number };
export type OcrSymbol = { text: string; confidence: number; bbox?: OcrBox };
export type OcrWord = { text: string; confidence: number; bbox?: OcrBox; symbols?: OcrSymbol[] };
export type OcrLine = { text: string; confidence: number; words?: OcrWord[] };

// qty — «проверь количество»; name — «проверь название» (название распознано неуверенно)
export type DraftFlag = 'qty' | 'name';

export type DraftItem = {
  name: string;
  qty: number | null; // null — количество не прочитано уверенно: впишет человек
  unit: string;
  confidence: number; // 0–100, уверенность распознавания строки
  flags: DraftFlag[];
  raw: string;        // строка, как её распознал телефон (для сверки глазами)
  note?: string;      // почему количество не взято (показывается под строкой черновика)
};

export type Dropped = { raw: string; why: string };
export type ParseResult = { items: DraftItem[]; dropped: Dropped[] };

export const QTY_CONF_MIN = 70;  // ниже — цифру количества не берём
export const NAME_CONF_MIN = 60; // ниже — «проверь название»
export const QTY_MAX = 999;
export const NAME_MAX = 80;
export const DRAFT_MAX = 40;     // = ITEMS_MAX сверки

export const FLAG_TEXT: Record<DraftFlag, string> = { qty: 'проверь количество', name: 'проверь название' };

// t — текст, c — уверенность слова, d — наименьшая уверенность цифр этого слова (по знакам), если известна;
// wide — цифра этого слова шире обычной на этом скрине (две цифры могли слиться в одну); b — рамка слова на скрине
type Tok = { t: string; c: number; d?: number; wide?: true; b?: OcrBox };

// Уверенность цифр количества: отдельное число — по слову и по его цифрам (берём худшее); число, слитое
// с буквами («x4», «6ea», «Qty:6»), — по цифрам: такое «слово» не из словаря, и его общая уверенность занижена.
const qc = (x: Tok, glued: boolean): number => (glued ? x.d ?? x.c : Math.min(x.c, x.d ?? x.c));

const LETTERS = /[A-Za-zА-Яа-яЁё]/g;
const letterCount = (s: string) => (s.match(LETTERS) ?? []).length;

// Буквы, которые распознавание путает с цифрами (O/0, l/1/I/|, S/5, B/8, Z/2, g/9)
const CONFUSABLE = 'OoDQIl|iSsBZzg';
const QTY_LIKE = new RegExp(`^[0-9${CONFUSABLE.replace('|', '\\|')}]+$`);

// «aty», «Oty», «Qtv», «Qly» — так распознавание иногда читает мелкое «Qty»
const KEYWORD = /^(qty|qt[yv]|[o0qa]t[yv]|q[l1]y|quantity|qnty|кол-?во|кол\.?|количество)[:.#]?$/i;
const KEYWORD_GLUED = /^(qty|quantity|кол-?во)[:.#]?(.+)$/i;
const HEADER_WORDS = /^(items?|description|product|products|service|services|name|материал(ы)?|позиции|наименование|товар(ы)?)$/i;
// Слова, которые бывают в строке-заголовке таблицы рядом с «Qty» («Description Qty Price Total»)
const HEAD_VOCAB = /^(items?|description|desc|products?|services?|name|parts?|sku|materials?|материал(ы)?|позици[яи]|наименование|товар(ы)?|price|unit|units|rate|each|total|amount|cost|line|uom|цена|сумма|ед|no)$/i;

const COUNT_UNITS: Record<string, string> = {
  ea: 'шт.', each: 'шт.', pc: 'шт.', pcs: 'шт.', piece: 'шт.', pieces: 'шт.', unit: 'шт.', units: 'шт.', 'шт': 'шт.', 'шт.': 'шт.',
  box: 'кор.', boxes: 'кор.', roll: 'рулон', rolls: 'рулон', set: 'компл.', sets: 'компл.', kit: 'компл.', kits: 'компл.',
  pair: 'пара', pairs: 'пара', pr: 'пара', bag: 'меш.', bags: 'меш.',
};
const LENGTH_UNITS: Record<string, string> = { ft: 'фут', feet: 'фут', lf: 'фут', 'ft.': 'фут' };

// Строки, которые не позиции: итоги, деньги, контакты, адреса, шапка заказа
const JUNK: [RegExp, string][] = [
  [/\b(sub\s*-?\s*total|grand\s+total|total|tax(es)?|discount|balance|amount\s+due|deposit|tip|paid|payment|итого|налог|скидка)\b/i, 'итог или оплата'],
  [/\b(phone|tel|mobile|cell|fax|e-?mail|телефон)\b|@|https?:|www\./i, 'контакты'],
  [/\(?\b\d{3}\)?[\s.-]+\d{3}[\s.-]+\d{4}\b/, 'телефон'],
  [/\b[A-Z]{2}\s+\d{5}(-\d{4})?\b/, 'адрес'],
  [/^\s*\d{1,6}\s+[A-Za-z].*\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|hwy|pkwy|parkway|cir|circle)\b\.?,?/i, 'адрес'],
  [/^\s*(order|invoice|estimate|work\s*order|job|заказ|счёт|счет)\s*(#|no\.?|number|№)/i, 'шапка заказа'],
  [/^\s*(customer|client|technician|tech|date|created|scheduled|status|notes?|address|клиент|дата|адрес)\s*:/i, 'шапка заказа'],
  [/^\s*\d{1,2}:\d{2}(\s*[ap]\.?m\.?)?\s*$/i, 'время'],
  [/\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/, 'дата'],
];

const isPrice = (t: string) => /^\$/.test(t) || /^\d{1,3}(,\d{3})*\.\d{2}$/.test(t) || /^\d+\.\d{2}\$?$/.test(t);
// «Qty 2.00», «2.00 x $35.00» — это количество, а не цена: после «Qty» и перед «x» число с копейками без «$» оставляем
const keepAsQty = (all: Tok[], k: number) => !/^\$/.test(all[k].t) && /^\d+\.\d+$/.test(all[k].t) &&
  ((k > 0 && KEYWORD.test(all[k - 1].t)) || (k + 1 < all.length && /^[x×]$/i.test(all[k + 1].t)));

// Снять скобки и знаки препинания вокруг токена (цифра «6.» или «(6)» — это 6)
const trimPunct = (t: string) => t.replace(/^[([{"'«#:]+/, '').replace(/[)\]}"'»,.;:!]+$/, '');

type Qty = { qty: number | null; unsure: boolean };

// Прочитать количество из токена. Неуверенно — qty null и unsure (не угадываем).
function readQty(raw: string, conf: number, strict: boolean): Qty | null {
  const t = trimPunct(raw);
  if (!t) return strict ? { qty: null, unsure: true } : null;
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    const bad = conf < QTY_CONF_MIN || n === 0 || n > QTY_MAX;
    return { qty: bad ? null : n, unsure: bad };
  }
  if (/^\d+\.\d+$/.test(t)) {
    const n = Number(t);
    const bad = conf < QTY_CONF_MIN || n <= 0 || n > QTY_MAX;
    return { qty: bad ? null : n, unsure: bad };
  }
  // буквы, похожие на цифры («O», «l2», «S», «B»): в позиции количества — неуверенно
  if (QTY_LIKE.test(t)) {
    if (strict || /\d/.test(t)) return { qty: null, unsure: true };
    return null;
  }
  return strict ? { qty: null, unsure: true } : null;
}

const unitOf = (raw: string | undefined, lengthOk: boolean): string | null => {
  if (!raw) return null;
  const k = trimPunct(raw).toLowerCase();
  return COUNT_UNITS[k] ?? COUNT_UNITS[k + '.'] ?? (lengthOk ? LENGTH_UNITS[k] ?? null : null);
};

function cleanName(toks: Tok[]): { name: string; conf: number } {
  let name = toks.map(x => x.t).join(' ');
  name = name
    .replace(/^[\s\-–—•·*>]+/, '')
    .replace(/^\d{1,2}[.)]\s+/, '')
    .replace(/[\s\-–—:|,;.]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  const conf = toks.length ? toks.reduce((s, x) => s + x.c, 0) / toks.length : 0;
  return { name, conf };
}

// tok — слово, из которого взято количество
// kind: kw — «Qty N»; unit — «N ea»; x — «xN»; trail — голое число в конце (нужно доказательство колонкой);
// col — в колонке «Qty» стоит не число (цифра не прочиталась)
type Found = { qty: Qty; unit: string; name: Tok[]; qtyConf: number; kind: 'kw' | 'unit' | 'x' | 'trail' | 'col'; keywordOnly?: boolean; tok?: Tok };

// Найти количество в строке (по порядку надёжности шаблонов)
function findQty(toks: Tok[]): Found | null {
  const n = toks.length;
  // 1) «Qty: 6», «Qty 6», «Qty:6», «Кол-во 6»
  for (let k = 0; k < n; k++) {
    const glued = toks[k].t.match(KEYWORD_GLUED);
    const isKw = KEYWORD.test(toks[k].t);
    if (!isKw && !(glued && /\d|[OolISB]/.test(glued[2]) && !/[a-z]{3,}/i.test(glued[2]))) continue;
    const valTok: Tok | undefined = isKw ? toks[k + 1] : { t: glued![2], c: qc(toks[k], true) };
    const after = isKw ? k + 2 : k + 1;
    const name = k > 0 ? toks.slice(0, k) : toks.slice(after + (unitOf(toks[after]?.t, true) ? 1 : 0));
    if (!valTok) return { qty: { qty: null, unsure: true }, unit: 'шт.', name, qtyConf: 0, kind: 'kw', keywordOnly: true };
    const vc = isKw ? qc(valTok, false) : valTok.c;
    const q = readQty(valTok.t, vc, true)!;
    const unit = unitOf(toks[after]?.t, true) ?? 'шт.';
    return { qty: q, unit, name, qtyConf: vc, kind: 'kw', tok: isKw ? valTok : toks[k] };
  }
  // 2) «6 ea», «6 pcs», «6ea»; длина («25 ft») — только в конце строки
  for (let k = n - 1; k >= 0; k--) {
    const glued = toks[k].t.match(/^(\d+(?:\.\d+)?)([A-Za-zА-Яа-я.]+)$/);
    if (glued && unitOf(glued[2], k === n - 1) && !/x/i.test(glued[2])) {
      const q = readQty(glued[1], qc(toks[k], true), true)!;
      return { qty: q, unit: unitOf(glued[2], true)!, name: toks.slice(0, k), qtyConf: qc(toks[k], true), kind: 'unit', tok: toks[k] };
    }
    if (k + 1 < n && unitOf(toks[k + 1].t, k + 1 === n - 1)) {
      const t = trimPunct(toks[k].t);
      // число перед единицей; буквы-«цифры» (S ea, O pcs) — тоже количество, но неуверенное
      if (/^\d+(\.\d+)?$/.test(t) || (QTY_LIKE.test(t) && t.length <= 3)) {
        const q = readQty(toks[k].t, qc(toks[k], false), true)!;
        return { qty: q, unit: unitOf(toks[k + 1].t, true)!, name: [...toks.slice(0, k), ...toks.slice(k + 2)], qtyConf: qc(toks[k], false), kind: 'unit', tok: toks[k] };
      }
    }
  }
  if (!n) return null;
  const last = toks[n - 1], first = toks[0];
  // 3) «… x6», «… x 6», «… ×6» в конце строки
  const xm = last.t.match(/^[x×](\S+)$/i);
  if (xm && /\d|^[OolISB]+$/.test(xm[1])) return { qty: readQty(xm[1], qc(last, true), true)!, unit: 'шт.', name: toks.slice(0, -1), qtyConf: qc(last, true), kind: 'x', tok: last };
  if (n >= 3 && /^[x×]$/i.test(toks[n - 2].t) && /^(\d+|[OolISB]{1,2})$/.test(trimPunct(last.t))) {
    return { qty: readQty(last.t, qc(last, false), true)!, unit: 'шт.', name: toks.slice(0, -2), qtyConf: qc(last, false), kind: 'x', tok: last };
  }
  // 4) «6 x Название», «6x Название», в конце строки «Название 6 x»
  const sm = first.t.match(/^(\S+?)[x×]$/i);
  if (sm && n >= 2 && /\d/.test(sm[1])) return { qty: readQty(sm[1], qc(first, true), true)!, unit: 'шт.', name: toks.slice(1), qtyConf: qc(first, true), kind: 'x', tok: first };
  if (n >= 3 && /^[x×]$/i.test(toks[1].t) && /\d/.test(first.t)) return { qty: readQty(first.t, qc(first, false), true)!, unit: 'шт.', name: toks.slice(2), qtyConf: qc(first, false), kind: 'x', tok: first };
  const em = last.t.match(/^(\S+?)[x×]$/i);
  if (em && n >= 2 && /^\d+$/.test(em[1])) return { qty: readQty(em[1], qc(last, true), true)!, unit: 'шт.', name: toks.slice(0, -1), qtyConf: qc(last, true), kind: 'x', tok: last };
  if (n >= 3 && /^[x×]$/i.test(last.t) && /\d/.test(toks[n - 2].t)) return { qty: readQty(toks[n - 2].t, qc(toks[n - 2], false), true)!, unit: 'шт.', name: toks.slice(0, -2), qtyConf: qc(toks[n - 2], false), kind: 'x', tok: toks[n - 2] };
  // 5) число в конце строки после названия («Медная труба 3/8 25»); размеры (10x6, 3/8, 6") — не количество
  if (n >= 2) {
    const t = trimPunct(last.t);
    const prev = toks[n - 2].t;
    if (/\d/.test(t) && QTY_LIKE.test(t) && !/^[x×]$/i.test(prev) && letterCount(toks.slice(0, -1).map(x => x.t).join(' ')) >= 2) {
      return { qty: readQty(last.t, qc(last, false), true)!, unit: 'шт.', name: toks.slice(0, -1), qtyConf: qc(last, false), kind: 'trail', tok: last };
    }
  }
  return null;
}

// ---------- Ширина цифр: «11», прочитанное как «1» ----------
// Распознавание иногда склеивает две одинаковые узкие цифры в одну («11» → «1») и уверено в этом (уверенность > 90).
// По уверенности это не поймать, зато видно по рамке знака: слитая «1» вдвое шире обычной «1» на этом же скрине.
// Эталон — типичная ширина цифр на этом скрине (шрифт у всех цифр один), без эталона — общие пороги.
export type DigitRef = { one: number | null; other: number | null };
const boxRatio = (b: OcrBox) => (b.x1 - b.x0) / Math.max(1, b.y1 - b.y0);
const goodBox = (b: OcrBox | undefined): b is OcrBox => !!b && b.y1 - b.y0 >= 6 && b.x1 > b.x0;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

export function digitRef(lines: OcrLine[]): DigitRef {
  const ones: number[] = [], others: number[] = [];
  for (const l of lines) for (const w of l.words ?? []) for (const x of w.symbols ?? []) {
    if (!x || !/^\d$/.test(x.text) || !(x.confidence >= 85) || !goodBox(x.bbox)) continue;
    (x.text === '1' ? ones : others).push(boxRatio(x.bbox));
  }
  return { one: ones.length >= 3 ? median(ones) : null, other: others.length >= 3 ? median(others) : null };
}

// Цифра шире, чем бывает одна цифра этого шрифта, — возможно, две слились
export function digitTooWide(ch: string, b: OcrBox, ref: DigitRef): boolean {
  const r = boxRatio(b);
  if (ch === '1') {
    if (ref.one !== null) return r > Math.max(0.5, ref.one * 1.6);
    if (ref.other !== null) return r > ref.other * 1.2;
    return r > 0.8;
  }
  return r > Math.max(1.0, (ref.other ?? 0.68) * 1.5);
}

function wordTooWide(w: OcrWord, ref: DigitRef): boolean {
  const syms = (w.symbols ?? []).filter(x => x && /^\d$/.test(x.text) && goodBox(x.bbox));
  if (syms.length) return syms.some(x => digitTooWide(x.text, x.bbox!, ref));
  const t = w.text.trim();
  return /^\d$/.test(t) && goodBox(w.bbox) && digitTooWide(t, w.bbox, ref); // без знаков — по рамке слова из одной цифры
}

function tokensOf(line: OcrLine, ref: DigitRef): Tok[] {
  const words = (line.words ?? []).filter(w => w && typeof w.text === 'string' && w.text.trim());
  const digitConf = (w: OcrWord): number | undefined => {
    const ds = (w.symbols ?? []).filter(x => x && /^\d$/.test(x.text) && Number.isFinite(x.confidence)).map(x => x.confidence);
    return ds.length ? Math.min(...ds) : undefined;
  };
  const base: Tok[] = words.length
    ? words.flatMap(w => {
      const parts = w.text.trim().split(/\s+/);
      const wide = parts.length === 1 && /\d/.test(w.text) && wordTooWide(w, ref);
      // слитая цифра — уверенность цифр 0: такое количество не берём (флаг), число в названии не трогаем
      const d = parts.length === 1 ? (wide ? 0 : digitConf(w)) : undefined;
      const b = parts.length === 1 && w.bbox ? w.bbox : undefined;
      return parts.map(t => ({ t, c: Number.isFinite(w.confidence) ? w.confidence : 0, ...(d !== undefined ? { d } : {}), ...(wide ? { wide: true as const } : {}), ...(b ? { b } : {}) }));
    })
    : line.text.trim().split(/\s+/).filter(Boolean).map(t => ({ t, c: Number.isFinite(line.confidence) ? line.confidence : 0 }));
  // «—» и «-» как отдельные слова — разделители; «×» → «x»
  return base.map(x => ({ ...x, t: x.t.replace(/×/g, 'x') })).filter(x => !/^[-–—|•·:]+$/.test(x.t));
}

const WIDE_NOTE = 'цифра шире обычной — возможно, слились две цифры («11» как «1»)';
export const TRAIL_NOTE = 'число в конце может быть частью названия — проверь';
export const COL_NOTE = 'в колонке «Qty» не цифра (не прочиталась) — посмотри скрин';

// ---------- Колонка количества: заголовок «Qty» и положение числа ----------
// Заголовок: «Qty», «Items Qty», «Description Qty Price Total», «Наименование Кол-во» — без цифр, кроме слова
// количества только слова шапки таблицы. box — рамка слова «Qty» (если известна), last — «Qty» последнее слово
// после хотя бы одного слова шапки («Description Qty»: колонка названий слева, количества — справа).
type Head = { line: number; box?: OcrBox; last: boolean };

function qtyHeader(toks: Tok[], line: number): Head | null {
  if (!toks.length || toks.length > 8 || toks.some(x => /\d/.test(x.t))) return null;
  const k = toks.findIndex(x => KEYWORD.test(x.t));
  if (k < 0) return null;
  if (!toks.every((x, n) => { const w = trimPunct(x.t).replace(/[.#№]+$/, ''); return n === k || !w || HEAD_VOCAB.test(w); })) return null;
  return { line, last: k > 0 && k === toks.length - 1, ...(toks[k].b ? { box: toks[k].b } : {}) };
}

const hgt = (b: OcrBox) => Math.max(1, b.y1 - b.y0);
// (б) число по горизонтали в колонке заголовка «Qty» (с допуском в высоту строки: число бывает прижато к краю)
function inColumn(num: OcrBox, head: OcrBox): boolean {
  const tol = Math.max(hgt(num), hgt(head));
  return Math.min(num.x1, head.x1 + tol) > Math.max(num.x0, head.x0 - tol);
}
// (в) два числа соседних строк в одной колонке: совпадает правый или левый край, или заметно перекрываются
function aligned(a: OcrBox, b: OcrBox): boolean {
  const tol = 0.8 * Math.max(hgt(a), hgt(b));
  const ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  return Math.abs(a.x1 - b.x1) <= tol || Math.abs(a.x0 - b.x0) <= tol || ov >= 0.5 * Math.min(a.x1 - a.x0, b.x1 - b.x0);
}

// Позиция черновика с тем, из чего она собрана (для склейки со строкой «Qty N» ниже и для проверки формата);
// num — слово с числом в конце строки (правило «trail»), head — заголовок «Qty» выше этой строки
type Built = { item: DraftItem; kind: Found['kind']; toks: Tok[]; raw: string; line: number; num?: Tok; head?: Head | null };

function build(found: Found, nameToks: Tok[], raw: string): DraftItem | null {
  const { name, conf } = cleanName(nameToks);
  if (letterCount(name) < 2) return null;
  const flags: DraftFlag[] = [];
  if (found.qty.unsure || found.qty.qty === null) flags.push('qty');
  if (conf < NAME_CONF_MIN) flags.push('name');
  const confidence = Math.round(Math.max(0, Math.min(100, found.qtyConf ? Math.min(conf, found.qtyConf) : conf)));
  const wide = flags.includes('qty') && found.tok?.wide;
  return { name, qty: found.qty.qty, unit: found.unit, confidence, flags, raw, ...(wide ? { note: WIDE_NOTE } : {}) };
}

export function parseOrderLines(lines: OcrLine[]): ParseResult {
  const ref = digitRef(lines);
  const built: Built[] = [];
  const dropped: Dropped[] = [];
  let pending: { toks: Tok[]; raw: string } | null = null; // строка-название без количества (количество — на следующей строке)
  let head: Head | null = null; // последний заголовок колонки количества выше текущей строки

  lines.forEach((line, ln) => {
    const raw = (line.text ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) return;
    const all = tokensOf(line, ref);
    // заголовок таблицы («Description Qty Price Total») — до проверки на итоги: в нём бывает слово «Total».
    // Одно «Qty» сразу под строкой-названием — это её количество с размазанной цифрой, а не заголовок.
    const h = qtyHeader(all, ln);
    if (h && !(pending && all.length === 1)) {
      if (pending) dropped.push({ raw: pending.raw, why: 'нет количества' });
      dropped.push({ raw, why: 'заголовок' });
      pending = null;
      head = h;
      return;
    }
    const junk = JUNK.find(([re]) => re.test(raw));
    if (junk) {
      if (pending) dropped.push({ raw: pending.raw, why: 'нет количества' });
      dropped.push({ raw, why: junk[1] });
      pending = null;
      return;
    }

    const priceAt = all.map((x, k) => isPrice(x.t) && !keepAsQty(all, k));
    const hadPrice = priceAt.some(Boolean);
    const toks = all.filter((_, k) => !priceAt[k]);
    let found = findQty(toks);
    // в строке с ценой число в конце может быть куском цены — без явного «Qty/x/ea» не берём
    if (found && hadPrice && found.kind === 'trail') found = null;
    // в колонке «Qty» (по рамкам слов) короткое «слово», но не число: «3» прочитано как «a» — это клетка количества,
    // её не угадываем: позиция с пустым количеством и флагом (а не потерянная строка)
    if (!found && !hadPrice && head?.box && toks.length >= 2) {
      const last = toks[toks.length - 1];
      const t = trimPunct(last.t);
      if (last.b && t && t.length <= 3 && inColumn(last.b, head.box) && letterCount(toks.slice(0, -1).map(x => x.t).join(' ')) >= 2) {
        found = { qty: { qty: null, unsure: true }, unit: 'шт.', name: toks.slice(0, -1), qtyConf: 0, kind: 'col', tok: last };
      }
    }

    if (!found) {
      if (letterCount(raw) >= 2 && !HEADER_WORDS.test(raw)) {
        if (pending) dropped.push({ raw: pending.raw, why: 'нет количества' });
        pending = { toks, raw };
      } else {
        if (pending) dropped.push({ raw: pending.raw, why: 'нет количества' });
        dropped.push({ raw, why: HEADER_WORDS.test(raw) ? 'заголовок' : hadPrice ? 'цена' : 'нет количества' });
        pending = null;
      }
      return;
    }

    const own = cleanName(found.name);
    if (letterCount(own.name) < 2) {
      // «Qty: 6» отдельной строкой под названием
      if (pending) {
        const it = build(found, pending.toks, `${pending.raw} / ${raw}`);
        if (it) built.push({ item: it, kind: found.kind, toks: pending.toks, raw: it.raw, line: ln });
        else dropped.push({ raw, why: 'нет названия' });
        pending = null;
        return;
      }
      // «Flex duct 8» / «Qty 12»: число в конце строки выше было частью названия, количество — строкой ниже
      const prev = built[built.length - 1];
      if (prev && prev.kind === 'trail' && prev.line === ln - 1) {
        const it = build(found, prev.toks, `${prev.raw} / ${raw}`);
        if (it) { built[built.length - 1] = { item: it, kind: found.kind, toks: prev.toks, raw: it.raw, line: ln }; return; }
      }
      dropped.push({ raw, why: 'нет названия' });
      return;
    }
    if (pending) { dropped.push({ raw: pending.raw, why: 'нет количества' }); pending = null; }
    if (found.keywordOnly && HEADER_WORDS.test(own.name)) { dropped.push({ raw, why: 'заголовок' }); return; }
    const it = build(found, found.name, raw);
    if (!it) { dropped.push({ raw, why: 'нет названия' }); return; }
    if (found.kind === 'col') it.note = COL_NOTE;
    built.push({ item: it, kind: found.kind, toks, raw, line: ln, ...(found.kind === 'trail' ? { num: found.tok, head } : {}) });
  });
  if (pending) dropped.push({ raw: (pending as { raw: string }).raw, why: 'нет количества' });

  // Число в конце строки без «Qty/x/ea» («Filter MERV 13», «Breaker 2 pole 30») — количество только при
  // доказательстве колонкой «Qty» (см. начало файла). Склеенные со строкой «Qty N» ниже уже не «trail».
  const trails = built.filter(b => b.kind === 'trail');
  const proven = new Set<Built>();
  // (б) число стоит в колонке заголовка «Qty»
  for (const b of trails) if (b.head?.box && b.num?.b && inColumn(b.num.b, b.head.box)) proven.add(b);
  // (в) колонка чисел: число выровнено с уже доказанным числом соседней строки (до 3 строк) под тем же заголовком
  for (let grew = true; grew;) {
    grew = false;
    for (const b of trails) {
      if (proven.has(b) || !b.head?.box || !b.num?.b) continue;
      const nb = b.num.b;
      if ([...proven].some(p => p.head === b.head && Math.abs(p.line - b.line) <= 3 && aligned(p.num!.b!, nb))) { proven.add(b); grew = true; }
    }
  }
  // без рамок слов (только текст): заголовок с «Qty» последним словом; но если на скрине преобладают строки
  // с явным «Qty/x/ea», голое число в конце — скорее часть названия
  const explicit = built.length - trails.length;
  const mostlyExplicit = explicit >= 2 && explicit > trails.length;
  for (const b of trails) if (b.head && (!b.head.box || !b.num?.b) && b.head.last && !mostlyExplicit) proven.add(b);
  // не доказано: число остаётся в названии, количество пустое, флаг и причина
  for (const b of trails) {
    if (proven.has(b)) continue;
    const { name, conf } = cleanName(b.toks);
    const flags: DraftFlag[] = ['qty', ...(conf < NAME_CONF_MIN ? ['name' as const] : [])];
    b.item = { name, qty: null, unit: 'шт.', confidence: Math.round(Math.max(0, Math.min(100, conf))), flags, raw: b.raw, note: TRAIL_NOTE };
  }

  const items: DraftItem[] = [];
  for (const b of built) {
    if (items.length >= DRAFT_MAX) { dropped.push({ raw: b.raw, why: `больше ${DRAFT_MAX} позиций` }); continue; }
    items.push(b.item);
  }
  return { items, dropped };
}

// Числа отдельной строкой, без названия («6», «> 1»): строки скрина распались (фото экрана под углом) —
// количества не взяты; черновик об этом предупреждает, чтобы недостающие строки не потерялись молча
export const orphanNumbers = (dropped: Dropped[]): number =>
  dropped.filter(d => d.why === 'нет количества' && /^[^A-Za-zА-Яа-яЁё]{0,3}\d{1,3}[^A-Za-zА-Яа-яЁё]{0,3}$/.test(d.raw.trim())).length;

// Слова распознавания → строки по положению на скрине. Распознавание может разрезать строку на колонки
// (название слева, «Qty 6» справа) — собираем обратно по вертикали, слева направо.
export function groupWordsToLines(words: OcrWord[]): OcrLine[] {
  const ws = words.filter(w => w && w.bbox && typeof w.text === 'string' && w.text.trim())
    .map(w => ({ ...w, cy: (w.bbox!.y0 + w.bbox!.y1) / 2, h: Math.max(1, w.bbox!.y1 - w.bbox!.y0) }))
    .sort((a, b) => a.cy - b.cy);
  const rows: { y0: number; y1: number; ws: typeof ws }[] = [];
  for (const w of ws) {
    const row = rows.find(r => {
      const overlap = Math.min(r.y1, w.bbox!.y1) - Math.max(r.y0, w.bbox!.y0);
      return overlap >= 0.5 * Math.min(r.y1 - r.y0, w.h);
    });
    if (row) { row.ws.push(w); row.y0 = Math.min(row.y0, w.bbox!.y0); row.y1 = Math.max(row.y1, w.bbox!.y1); }
    else rows.push({ y0: w.bbox!.y0, y1: w.bbox!.y1, ws: [w] });
  }
  return rows
    .sort((a, b) => a.y0 - b.y0)
    .map(r => {
      const sorted = r.ws.sort((a, b) => a.bbox!.x0 - b.bbox!.x0).map(({ text, confidence, bbox, symbols }) => ({ text, confidence, bbox, ...(symbols ? { symbols } : {}) }));
      return {
        text: sorted.map(w => w.text).join(' '),
        confidence: sorted.reduce((s, w) => s + w.confidence, 0) / sorted.length,
        words: sorted,
      };
    });
}

// Ключ сравнения названий (повторы в сверке): регистр, пробелы и знаки не важны
export const nameKey = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();

// Строки черновика, которые бригадир правит на экране: количество — текст поля ('' = не прочитано)
export type DraftRow = { key: string; name: string; qty: string; unit: string; flags: DraftFlag[]; raw: string; confidence: number; note?: string };

export const toRows = (items: DraftItem[], keyOf: (k: number) => string): DraftRow[] =>
  items.map((x, k) => ({
    key: keyOf(k), name: x.name, qty: x.qty === null ? '' : String(x.qty), unit: x.unit, flags: x.flags, raw: x.raw, confidence: x.confidence,
    ...(x.note ? { note: x.note } : {}),
  }));

// Количество из поля черновика: пусто или не число — null (позиция добавится без количества)
export function rowQty(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 99999 ? n : null;
}

// ---------- Повторы: повторный разбор того же скрина, два перекрывающихся скрина одного заказа ----------
// Позиция сверки, с которой сравниваем строку черновика (по названию без учёта регистра и знаков)
export type ExistingItem = { id: string; name: string; qty: number | null; actual?: number | null; unit?: string };
// Что сделать со строкой, которая уже есть в сверке: оставить как есть (по умолчанию), заменить количество
// в сверке на количество из черновика, добавить отдельной позицией. Второй раз в черновике: 'keep' — не добавлять.
export type DupChoice = 'keep' | 'replace' | 'add';

export function findExisting(name: string, existing: ExistingItem[]): ExistingItem | null {
  const k = nameKey(name);
  return k ? existing.find(e => nameKey(e.name) === k) ?? null : null;
}

export type ConfirmPlan = {
  add: DraftRow[];                                       // добавить в сверку (новые и «добавить отдельно»)
  replace: { row: DraftRow; id: string; qty: number }[]; // «заменить количество» у позиции сверки id
  keep: DraftRow[];                                      // уже есть в сверке — оставлено как есть
  dupExisting: DraftRow[];                               // все строки, совпавшие с позицией сверки (любой выбор)
  dupInDraft: DraftRow[];                                // второй раз в этом черновике — не добавлены
  empty: DraftRow[];                                     // без названия — не добавлены
  noQty: DraftRow[];                                     // добавляются без количества
};

// Что будет при «Подтвердить»: пустые строки не добавляются; повторы (уже в сверке или дважды в черновике)
// молча не задваиваются: по умолчанию «оставить», заменить или добавить отдельно — только явным выбором человека.
// existing — позиции сверки (строка = только название, как раньше); choice — выбор по ключу строки черновика.
export function planConfirm(rows: DraftRow[], existing: (ExistingItem | string)[], choice: Record<string, DupChoice> = {}): ConfirmPlan {
  const ex = existing.map(e => (typeof e === 'string' ? { id: '', name: e, qty: null } : e));
  const seen = new Set<string>();
  const plan: ConfirmPlan = { add: [], replace: [], keep: [], dupExisting: [], dupInDraft: [], empty: [], noQty: [] };
  for (const r of rows) {
    const k = nameKey(r.name);
    if (!k) { plan.empty.push(r); continue; }
    const c = choice[r.key] ?? 'keep';
    const have = findExisting(r.name, ex);
    const q = rowQty(r.qty);
    if (have) {
      plan.dupExisting.push(r);
      if (c === 'add') plan.add.push(r);
      else if (c === 'replace' && q !== null && have.id) plan.replace.push({ row: r, id: have.id, qty: q });
      else plan.keep.push(r);
    } else if (seen.has(k)) {
      if (c === 'add') plan.add.push(r);
      else plan.dupInDraft.push(r);
    } else plan.add.push(r);
    seen.add(k);
  }
  plan.noQty = plan.add.filter(r => rowQty(r.qty) === null);
  return plan;
}
