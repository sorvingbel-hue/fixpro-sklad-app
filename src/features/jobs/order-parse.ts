// Разбор распознанного скрина заказа → черновик позиций на проверку бригадиру.
// Формат №1: список позиций заказа, у строки есть количество: «Qty: 6», «Qty 6», «x6», «6 x», «6 ea», «6 pcs»,
// число в конце строки после названия. Чистая логика без React Native: её проверяет tests/order-parse.test.mjs в Node.
//
// Главное правило: НЕ УГАДЫВАТЬ. Если цифры количества распознаны неуверенно (низкая уверенность слова,
// буква вместо цифры: O/0, l/1/I, S/5, B/8, Z/2) — qty = null и флаг «проверь количество». Пустое поле
// честнее неверной цифры: по нему бригадир сам посмотрит скрин. Итоги, цены, адреса, телефоны — отбрасываются.

export type OcrWord = { text: string; confidence: number; bbox?: { x0: number; y0: number; x1: number; y1: number } };
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
};

export type Dropped = { raw: string; why: string };
export type ParseResult = { items: DraftItem[]; dropped: Dropped[] };

export const QTY_CONF_MIN = 70;  // ниже — цифру количества не берём
export const NAME_CONF_MIN = 60; // ниже — «проверь название»
export const QTY_MAX = 999;
export const NAME_MAX = 80;
export const DRAFT_MAX = 40;     // = ITEMS_MAX сверки

export const FLAG_TEXT: Record<DraftFlag, string> = { qty: 'проверь количество', name: 'проверь название' };

type Tok = { t: string; c: number };

const LETTERS = /[A-Za-zА-Яа-яЁё]/g;
const letterCount = (s: string) => (s.match(LETTERS) ?? []).length;

// Буквы, которые распознавание путает с цифрами (O/0, l/1/I/|, S/5, B/8, Z/2, g/9)
const CONFUSABLE = 'OoDQIl|iSsBZzg';
const QTY_LIKE = new RegExp(`^[0-9${CONFUSABLE.replace('|', '\\|')}]+$`);

const KEYWORD = /^(qty|qt[yv]|[o0q][t][yv]|quantity|qnty|кол-?во|кол\.?|количество)[:.#]?$/i;
const KEYWORD_GLUED = /^(qty|quantity|кол-?во)[:.#]?(.+)$/i;
const HEADER_WORDS = /^(items?|description|product|products|service|services|name|материал(ы)?|позиции|наименование|товар(ы)?)$/i;

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

type Found = { qty: Qty; unit: string; name: Tok[]; qtyConf: number; kind: 'kw' | 'unit' | 'x' | 'trail'; keywordOnly?: boolean };

// Найти количество в строке (по порядку надёжности шаблонов)
function findQty(toks: Tok[]): Found | null {
  const n = toks.length;
  // 1) «Qty: 6», «Qty 6», «Qty:6», «Кол-во 6»
  for (let k = 0; k < n; k++) {
    const glued = toks[k].t.match(KEYWORD_GLUED);
    const isKw = KEYWORD.test(toks[k].t);
    if (!isKw && !(glued && /\d|[OolISB]/.test(glued[2]) && !/[a-z]{3,}/i.test(glued[2]))) continue;
    const valTok: Tok | undefined = isKw ? toks[k + 1] : { t: glued![2], c: toks[k].c };
    const after = isKw ? k + 2 : k + 1;
    const name = k > 0 ? toks.slice(0, k) : toks.slice(after + (unitOf(toks[after]?.t, true) ? 1 : 0));
    if (!valTok) return { qty: { qty: null, unsure: true }, unit: 'шт.', name, qtyConf: 0, kind: 'kw', keywordOnly: true };
    const q = readQty(valTok.t, valTok.c, true)!;
    const unit = unitOf(toks[after]?.t, true) ?? 'шт.';
    return { qty: q, unit, name, qtyConf: valTok.c, kind: 'kw' };
  }
  // 2) «6 ea», «6 pcs», «6ea»; длина («25 ft») — только в конце строки
  for (let k = n - 1; k >= 0; k--) {
    const glued = toks[k].t.match(/^(\d+(?:\.\d+)?)([A-Za-zА-Яа-я.]+)$/);
    if (glued && unitOf(glued[2], k === n - 1) && !/x/i.test(glued[2])) {
      const q = readQty(glued[1], toks[k].c, true)!;
      return { qty: q, unit: unitOf(glued[2], true)!, name: toks.slice(0, k), qtyConf: toks[k].c, kind: 'unit' };
    }
    if (k + 1 < n && unitOf(toks[k + 1].t, k + 1 === n - 1)) {
      const t = trimPunct(toks[k].t);
      // число перед единицей; буквы-«цифры» (S ea, O pcs) — тоже количество, но неуверенное
      if (/^\d+(\.\d+)?$/.test(t) || (QTY_LIKE.test(t) && t.length <= 3)) {
        const q = readQty(toks[k].t, toks[k].c, true)!;
        return { qty: q, unit: unitOf(toks[k + 1].t, true)!, name: [...toks.slice(0, k), ...toks.slice(k + 2)], qtyConf: toks[k].c, kind: 'unit' };
      }
    }
  }
  if (!n) return null;
  const last = toks[n - 1], first = toks[0];
  // 3) «… x6», «… x 6», «… ×6» в конце строки
  const xm = last.t.match(/^[x×](\S+)$/i);
  if (xm && /\d|^[OolISB]+$/.test(xm[1])) return { qty: readQty(xm[1], last.c, true)!, unit: 'шт.', name: toks.slice(0, -1), qtyConf: last.c, kind: 'x' };
  if (n >= 3 && /^[x×]$/i.test(toks[n - 2].t) && /^(\d+|[OolISB]{1,2})$/.test(trimPunct(last.t))) {
    return { qty: readQty(last.t, last.c, true)!, unit: 'шт.', name: toks.slice(0, -2), qtyConf: last.c, kind: 'x' };
  }
  // 4) «6 x Название», «6x Название», в конце строки «Название 6 x»
  const sm = first.t.match(/^(\S+?)[x×]$/i);
  if (sm && n >= 2 && /\d/.test(sm[1])) return { qty: readQty(sm[1], first.c, true)!, unit: 'шт.', name: toks.slice(1), qtyConf: first.c, kind: 'x' };
  if (n >= 3 && /^[x×]$/i.test(toks[1].t) && /\d/.test(first.t)) return { qty: readQty(first.t, first.c, true)!, unit: 'шт.', name: toks.slice(2), qtyConf: first.c, kind: 'x' };
  const em = last.t.match(/^(\S+?)[x×]$/i);
  if (em && n >= 2 && /^\d+$/.test(em[1])) return { qty: readQty(em[1], last.c, true)!, unit: 'шт.', name: toks.slice(0, -1), qtyConf: last.c, kind: 'x' };
  if (n >= 3 && /^[x×]$/i.test(last.t) && /\d/.test(toks[n - 2].t)) return { qty: readQty(toks[n - 2].t, toks[n - 2].c, true)!, unit: 'шт.', name: toks.slice(0, -2), qtyConf: toks[n - 2].c, kind: 'x' };
  // 5) число в конце строки после названия («Медная труба 3/8 25»); размеры (10x6, 3/8, 6") — не количество
  if (n >= 2) {
    const t = trimPunct(last.t);
    const prev = toks[n - 2].t;
    if (/\d/.test(t) && QTY_LIKE.test(t) && !/^[x×]$/i.test(prev) && letterCount(toks.slice(0, -1).map(x => x.t).join(' ')) >= 2) {
      return { qty: readQty(last.t, last.c, true)!, unit: 'шт.', name: toks.slice(0, -1), qtyConf: last.c, kind: 'trail' };
    }
  }
  return null;
}

function tokensOf(line: OcrLine): Tok[] {
  const words = (line.words ?? []).filter(w => w && typeof w.text === 'string' && w.text.trim());
  const base: Tok[] = words.length
    ? words.flatMap(w => w.text.trim().split(/\s+/).map(t => ({ t, c: Number.isFinite(w.confidence) ? w.confidence : 0 })))
    : line.text.trim().split(/\s+/).filter(Boolean).map(t => ({ t, c: Number.isFinite(line.confidence) ? line.confidence : 0 }));
  // «—» и «-» как отдельные слова — разделители; «×» → «x»
  return base.map(x => ({ ...x, t: x.t.replace(/×/g, 'x') })).filter(x => !/^[-–—|•·:]+$/.test(x.t));
}

export function parseOrderLines(lines: OcrLine[]): ParseResult {
  const items: DraftItem[] = [];
  const dropped: Dropped[] = [];
  let pending: { toks: Tok[]; raw: string } | null = null; // строка-название без количества (количество — на следующей строке)

  for (const line of lines) {
    const raw = (line.text ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) continue;
    const junk = JUNK.find(([re]) => re.test(raw));
    if (junk) {
      if (pending) dropped.push({ raw: pending.raw, why: 'нет количества' });
      dropped.push({ raw, why: junk[1] });
      pending = null;
      continue;
    }

    const all = tokensOf(line);
    const hadPrice = all.some(x => isPrice(x.t));
    const toks = all.filter(x => !isPrice(x.t));
    let found = findQty(toks);
    // в строке с ценой число в конце может быть куском цены — без явного «Qty/x/ea» не берём
    if (found && hadPrice && found.kind === 'trail') found = null;

    if (!found) {
      if (letterCount(raw) >= 2 && !HEADER_WORDS.test(raw)) {
        if (pending) dropped.push({ raw: pending.raw, why: 'нет количества' });
        pending = { toks, raw };
      } else {
        if (pending) dropped.push({ raw: pending.raw, why: 'нет количества' });
        dropped.push({ raw, why: HEADER_WORDS.test(raw) ? 'заголовок' : hadPrice ? 'цена' : 'нет количества' });
        pending = null;
      }
      continue;
    }

    let { name, conf } = cleanName(found.name);
    let rawOut = raw;
    if (letterCount(name) < 2 && pending) { // «Qty: 6» отдельной строкой под названием
      ({ name, conf } = cleanName(pending.toks));
      rawOut = `${pending.raw} / ${raw}`;
      pending = null;
    } else if (pending) {
      dropped.push({ raw: pending.raw, why: 'нет количества' });
      pending = null;
    }
    if (letterCount(name) < 2) { dropped.push({ raw, why: 'нет названия' }); continue; }
    if (found.keywordOnly && HEADER_WORDS.test(name)) { dropped.push({ raw, why: 'заголовок' }); continue; }

    const flags: DraftFlag[] = [];
    if (found.qty.unsure || found.qty.qty === null) flags.push('qty');
    if (conf < NAME_CONF_MIN) flags.push('name');
    const confidence = Math.round(Math.max(0, Math.min(100, found.qtyConf ? Math.min(conf, found.qtyConf) : conf)));
    if (items.length >= DRAFT_MAX) { dropped.push({ raw, why: `больше ${DRAFT_MAX} позиций` }); continue; }
    items.push({ name, qty: found.qty.qty, unit: found.unit, confidence, flags, raw: rawOut });
  }
  if (pending) dropped.push({ raw: pending.raw, why: 'нет количества' });
  return { items, dropped };
}

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
      const sorted = r.ws.sort((a, b) => a.bbox!.x0 - b.bbox!.x0).map(({ text, confidence, bbox }) => ({ text, confidence, bbox }));
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
export type DraftRow = { key: string; name: string; qty: string; unit: string; flags: DraftFlag[]; raw: string; confidence: number };

export const toRows = (items: DraftItem[], keyOf: (k: number) => string): DraftRow[] =>
  items.map((x, k) => ({ key: keyOf(k), name: x.name, qty: x.qty === null ? '' : String(x.qty), unit: x.unit, flags: x.flags, raw: x.raw, confidence: x.confidence }));

// Количество из поля черновика: пусто или не число — null (позиция добавится без количества)
export function rowQty(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 99999 ? n : null;
}

export type ConfirmPlan = { add: DraftRow[]; dupExisting: DraftRow[]; dupInDraft: DraftRow[]; empty: DraftRow[]; noQty: DraftRow[] };

// Что будет при «Подтвердить»: пустые строки не добавляются; повторы (уже в сверке или дважды в черновике)
// показываются человеку — молча не задваиваем.
export function planConfirm(rows: DraftRow[], existingNames: string[]): ConfirmPlan {
  const have = new Set(existingNames.map(nameKey).filter(Boolean));
  const seen = new Set<string>();
  const plan: ConfirmPlan = { add: [], dupExisting: [], dupInDraft: [], empty: [], noQty: [] };
  for (const r of rows) {
    const k = nameKey(r.name);
    if (!k) { plan.empty.push(r); continue; }
    if (have.has(k)) plan.dupExisting.push(r);
    else if (seen.has(k)) plan.dupInDraft.push(r);
    else plan.add.push(r);
    seen.add(k);
    if (rowQty(r.qty) === null && !have.has(k)) plan.noQty.push(r);
  }
  return plan;
}
