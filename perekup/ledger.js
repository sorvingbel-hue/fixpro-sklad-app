// «Перекуп» — годовая сводка для налогов и CSV для бухгалтера (ТЗ M4, срез 2). Без DOM и без сети.
// Только сложение записанных чисел: прибыль по продаже — через saleResult (netProfit ядра), себестоимость —
// специфическая идентификация (basisOf вещи), мили — мили × ставка, записанная на дату поездки.

import {
  CHANNELS, ORIGINS, WRITEOFF_KINDS, EXPENSE_CATEGORIES, EXPENSE_CATEGORIES_EN, TRIP_KINDS_EN,
  RULE_KEYS, basisOf, builtinRules, k1099Counters, k1099For, mileRateFor, mileageGroups, refundDateOf, ruleCheckState, ruleOnDate,
  saleRecords, saleResult, todayLocal, tripRows,
} from './logic.js';

const round2 = (v) => Math.round(v * 100) / 100;
const n0 = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const yearOf = (d) => (typeof d === 'string' ? Number(d.slice(0, 4)) : NaN);
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
// цели поездки «не за вещью»: почта, коробки, склад
const NOT_PURCHASE_TRIP = ['ship', 'supplies', 'storage'];

// Номера строк Schedule C (Form 1040) — только справка для бухгалтера в CSV, на расчёты не влияют.
// Сверены с формой 2025 и 2026 (19.11.2026, tests/fixtures/tax_rules_verified.json, запись schedule_c_lines).
// Ставятся только там, где строка однозначна; куда относить комиссии eBay, этикетки и коробки — решает бухгалтер.
export const SCHEDULE_C = {
  source: 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', checked: '2026-11-19',
  lines: { gross_receipts: '1', returns_allowances: '2', cogs_to_part1: '4', advertising: '8', car_truck_expenses: '9', business_miles: '44a', cogs_inventory_begin: '35', cogs_purchases: '36', cogs_inventory_end: '41', cogs: '42' },
};
const SC = SCHEDULE_C.lines;

export const CHANNELS_EN = { ebay: 'eBay', marketplace: 'Facebook Marketplace', offerup: 'OfferUp', cash: 'Cash (local sale)' };
const ORIGINS_EN = { bought: 'Bought for resale', personal: 'Personal item', own_stock: 'Own HVAC stock' };
const WRITEOFF_EN = { unsold: 'Unsold — written off', scrap: 'Scrap / parts — written off' };

// Годы, за которые есть записи (и текущий) — для выбора года сводки, новые первыми.
export function ledgerYears(state, now = new Date()) {
  const ys = new Set([yearOf(todayLocal(now))]);
  for (const it of state.items) {
    for (const k of ['have', 'writeoff']) if (it[k] && it[k].date) ys.add(yearOf(it[k].date));
    for (const rec of saleRecords(it)) {
      ys.add(yearOf(rec.sold.date));
      if (refundDateOf(rec.sold)) ys.add(yearOf(refundDateOf(rec.sold)));
      if (rec.returned) ys.add(yearOf(rec.returned.date));
    }
  }
  for (const l of state.lots || []) ys.add(yearOf(l.date));
  for (const t of state.trips || []) ys.add(yearOf(t.date));
  for (const x of state.expenses || []) ys.add(yearOf(x.date));
  return [...ys].filter(Number.isInteger).sort((a, b) => b - a);
}

// Лежала ли вещь на складе в конце дня d: куплена и после последней продажи/списания вернулась
// (продажи с возвратом идут по порядку, поэтому достаточно пройти их подряд).
export function inStockAt(it, d) {
  if (!it.have || it.have.date > d) return false;
  let inStock = true;
  for (const p of it.pastSales || []) {
    if (p.sold.date <= d) inStock = false;
    if (p.returned.date <= d) inStock = true;
  }
  if ((it.status === 'sold' || it.status === 'paid') && it.sold && it.sold.date <= d) inStock = false;
  if (it.status === 'writeoff' && it.writeoff && it.writeoff.date <= d) inStock = false;
  return inStock;
}

// Сводка за налоговый год. Все суммы — в долларах, округлены до цента.
// Продажа — в год продажи; возврат денег — в год, когда вернули; вещь, вернувшаяся на склад, — продажа и её
// расходы остаются в своём году, а в год возврата: возврат денег, обратная доставка, возвращённая комиссия
// и себестоимость, вернувшаяся на склад (уменьшает себестоимость года). Так склад на 1 января + куплено −
// склад на 31 декабря всегда равен себестоимости года.
export function yearSummary(state, year, now = new Date()) {
  const Y = Number(year);
  const inY = (d) => yearOf(d) === Y;
  const settings = state.settings;
  const rules = state.taxRules || builtinRules();
  const today = todayLocal(now);

  // --- продажи: доходы, комиссии, этикетки, упаковка, себестоимость проданного; возвраты ---
  const byChannel = {};
  const chan = (c) => (byChannel[c] ||= { channel: c, count: 0, gross: 0, refunds: 0 });
  const sales = [];
  const refundRows = [];
  const fees = { finalValue: 0, perOrder: 0, ads: 0, other: 0, estimated: 0 };
  let feesEstimatedCount = 0, labels = 0, labelsMissing = 0, packaging = 0, taxCollected = 0, cogsSold = 0;
  let returnShipping = 0, feeCredits = 0, cogsReturned = 0, returnedCount = 0;
  const personal = { count: 0, gross: 0 };
  const cashSales = [];
  for (const it of state.items) {
    const basis = basisOf(it.have);
    const sku = (it.have && it.have.sku) || '';
    for (const rec of saleRecords(it)) {
      const s = rec.sold;
      const r = saleResult({ ...it, sold: s }, settings);
      if (inY(s.date)) {
        const ch = chan(s.channel);
        ch.count++;
        ch.gross += r.gross;
        if (it.have && it.have.origin === 'personal') { personal.count++; personal.gross += r.gross; }
        for (const k of Object.keys(fees)) fees[k] += r.feesByType[k];
        if (r.feesEstimated) feesEstimatedCount++;
        if (s.label === null || s.label === undefined) labelsMissing++;
        else labels += s.label;
        packaging += n0(s.packaging);
        taxCollected += n0(s.taxCollected);
        cogsSold += basis;
        if (s.channel === 'cash') cashSales.push({ date: s.date, gross: r.gross });
        sales.push({
          date: s.date, channel: s.channel, title: it.title, sku, origin: it.have ? it.have.origin : it.origin,
          price: s.price, shipCharged: s.shipCharged, gross: r.gross, feesByType: r.feesByType, feesEstimated: r.feesEstimated, feesCombined: !!s.feesCombined,
          fees: r.fees, label: s.label ?? null, packaging: n0(s.packaging), refund: r.refund, refundDate: refundDateOf(s), taxCollected: s.taxCollected ?? null, basis,
          payoutId: (rec.paid && rec.paid.payoutId) || '', net: r.net, returnedOn: rec.returned ? rec.returned.date : null,
        });
      }
      const rd = refundDateOf(s);
      if (rd && inY(rd)) {
        chan(s.channel).refunds += n0(s.refund);
        refundRows.push({ date: rd, saleDate: s.date, channel: s.channel, title: it.title, sku, kind: 'refund', amount: n0(s.refund), returnShipping: 0, feeCredit: 0, basisBack: 0 });
      }
      const ret = rec.returned;
      if (ret && inY(ret.date)) {
        chan(s.channel).refunds += ret.refund;
        returnShipping += ret.returnShipping;
        feeCredits += ret.feeCredit;
        cogsReturned += basis;
        returnedCount++;
        refundRows.push({ date: ret.date, saleDate: s.date, channel: s.channel, title: it.title, sku, kind: 'return', amount: ret.refund, returnShipping: ret.returnShipping, feeCredit: ret.feeCredit, basisBack: basis });
      }
    }
  }
  sales.sort(byDate);
  refundRows.sort(byDate);
  const channels = Object.keys(CHANNELS).filter((c) => byChannel[c]).map((c) => {
    const x = byChannel[c];
    return { channel: c, count: x.count, gross: round2(x.gross), refunds: round2(x.refunds), net: round2(x.gross - x.refunds) };
  });
  const gross = round2(channels.reduce((a, c) => a + c.gross, 0));
  const refunds = round2(channels.reduce((a, c) => a + c.refunds, 0));

  // --- списания за год (себестоимость остаётся в учёте как убыток) ---
  const writeoffs = state.items
    .filter((it) => it.status === 'writeoff' && it.writeoff && inY(it.writeoff.date))
    .map((it) => ({ date: it.writeoff.date, kind: it.writeoff.kind, title: it.title, sku: (it.have && it.have.sku) || '', basis: basisOf(it.have) }))
    .sort(byDate);
  const cogsWriteoff = round2(writeoffs.reduce((a, w) => a + w.basis, 0));

  // --- склад (себестоимость): на 1 января, куплено за год, на 31 декабря ---
  const dec31prev = `${Y - 1}-12-31`, dec31 = `${Y}-12-31`;
  let invBegin = 0, invEnd = 0;
  const purchases = [];
  for (const it of state.items) {
    if (!it.have) continue;
    const b = basisOf(it.have);
    if (inStockAt(it, dec31prev)) invBegin += b;
    if (inStockAt(it, dec31)) invEnd += b;
    if (inY(it.have.date)) {
      const h = it.have;
      purchases.push({ date: h.date, title: it.title, sku: h.sku || '', origin: h.origin, buyPrice: h.buyPrice, salesTax: n0(h.salesTax), buyerPremium: n0(h.buyerPremium), freight: n0(h.freight), basis: b, place: h.place || '', seller: h.seller || '', lot: !!h.lotId });
    }
  }
  purchases.sort(byDate);
  const purchasesTotal = round2(purchases.reduce((a, p) => a + p.basis, 0));

  // --- расходы Schedule C по категориям ---
  const expenses = (state.expenses || []).filter((x) => inY(x.date)).sort(byDate);
  const expByCat = Object.keys(EXPENSE_CATEGORIES).map((c) => {
    const xs = expenses.filter((x) => x.category === c);
    return { category: c, count: xs.length, amount: round2(xs.reduce((a, x) => a + x.amount, 0)) };
  });
  const expensesTotal = round2(expenses.reduce((a, x) => a + x.amount, 0));

  // --- мили: журнал + мили из покупок и лотов; сумма по каждой ставке — от суммы миль ---
  const trips = tripRows(state).filter((r) => inY(r.date)).sort(byDate);
  const mg = mileageGroups(trips);
  let mismatch = 0;
  const tripRule = new Map();
  for (const t of trips) {
    const reg = mileRateFor(rules, t.date);
    if (reg) tripRule.set(t, reg);
    if (reg && reg.value !== t.rateUsed) mismatch++;
  }
  const tripDays = new Set(trips.filter((t) => t.src === 'trip').map((t) => t.date));
  const doubleDays = [...new Set(trips.filter((t) => t.src !== 'trip' && tripDays.has(t.date)).map((t) => t.date))];
  // покупка привязана к поездке журнала с другой целью (почта, коробки, склад) — мили за самой покупкой
  // могли не записаться (поездка за покупкой — отдельная)
  const tripById = new Map((state.trips || []).map((t) => [t.id, t]));
  const offKind = (id) => { const t = tripById.get(id); return !!t && NOT_PURCHASE_TRIP.includes(t.kind); };
  const oddLinks = state.items.filter((it) => it.have && it.have.tripId && inY(it.have.date) && offKind(it.have.tripId)).length
    + (state.lots || []).filter((l) => l.tripId && inY(l.date) && offKind(l.tripId)).length;
  // у каждой ставки — правила реестра, по которым она взята (пометка «не проверено» и ссылка на источник)
  const byRate = mg.groups.map((g) => {
    const rs = [...new Set(g.rows.map((t) => tripRule.get(t)).filter((x) => x && x.value === g.rate).map((x) => x.rule))];
    return { rate: g.rate, count: g.count, miles: g.miles, amount: g.amount, rules: rs };
  });

  // --- 1099-K по площадкам ---
  const { k1099, k1099Rule } = k1099Counters(state, Y);

  // --- свои продажи за наличные: налог с продаж по ставке Сан-Диего на дату продажи (≈, справочно) ---
  const taxGroups = new Map();
  let cashUnknown = 0;
  for (const c of cashSales) {
    const r = ruleOnDate(rules, 'sd_sales_tax', c.date);
    if (!r) { cashUnknown += c.gross; continue; }
    const g = taxGroups.get(r.rule.id) || { rate: r.value, rule: r.rule, gross: 0, count: 0 };
    g.gross += c.gross;
    g.count++;
    taxGroups.set(r.rule.id, g);
  }
  const cashTax = {
    count: cashSales.length, gross: round2(cashSales.reduce((a, c) => a + c.gross, 0)),
    groups: [...taxGroups.values()].map((g) => ({ rate: g.rate, rule: g.rule, count: g.count, gross: round2(g.gross), tax: round2(g.gross * g.rate) })),
    unknownGross: round2(cashUnknown),
  };
  cashTax.tax = round2(cashTax.groups.reduce((a, g) => a + g.tax, 0));

  const feesTotal = fees.finalValue + fees.perOrder + fees.ads + fees.other + fees.estimated;
  const salesCosts = round2(feesTotal - feeCredits + labels + packaging + returnShipping);
  const cogsTotal = round2(cogsSold + cogsWriteoff - cogsReturned);
  const mileage = {
    miles: mg.miles, amount: mg.amount, byRate,
    unknown: { count: mg.unknown.count, miles: mg.unknown.miles }, mismatch, doubleDays, oddLinks, rows: trips,
  };
  const profit = round2(gross - refunds - cogsTotal - salesCosts - expensesTotal - mileage.amount);

  // правила, по которым посчитан год: ставки поездок, порог 1099-K, налог для наличных
  const used = new Set();
  for (const g of byRate) for (const r of g.rules) used.add(r);
  if (k1099Rule) for (const r of k1099Rule.rules) used.add(r);
  for (const g of cashTax.groups) used.add(g.rule);
  const usedRules = rules.filter((r) => used.has(r));
  // своё правило закрыло проверенное правило программы (на дату поездки или на год 1099-K)
  const shadowed = new Set();
  for (const t of trips) { const reg = tripRule.get(t); if (reg) for (const b of reg.shadowed) shadowed.add(b); }
  const k = k1099For(rules, Y);
  if (k) for (const b of k.shadowed) shadowed.add(b);

  const warnings = [];
  if (feesEstimatedCount) warnings.push({ code: 'fees', text: `Комиссия не введена у продаж: ${feesEstimatedCount} — посчитана ≈ по % категории. Введите факт из eBay.` });
  if (labelsMissing) warnings.push({ code: 'labels', text: `Нет цены этикетки у продаж: ${labelsMissing}.` });
  if (mg.unknown.count) warnings.push({ code: 'rate', text: `Поездок без ставки за милю: ${mg.unknown.count} (${mg.unknown.miles} миль) — в сумму не вошли.` });
  if (mismatch) warnings.push({ code: 'mismatch', text: `Поездок, где ставка отличается от реестра: ${mismatch}.` });
  if (oddLinks) warnings.push({ code: 'tripkind', text: `Покупок, привязанных к поездке на почту, за коробками или на склад: ${oddLinks} — проверьте, записаны ли мили за самой покупкой.` });
  if (doubleDays.length) warnings.push({ code: 'double', text: `Дни, где поездка есть и в журнале, и в покупке: ${doubleDays.length} — проверьте, не посчитана ли дважды.` });
  if (packaging > 0 && expByCat.find((c) => c.category === 'boxes').amount > 0) warnings.push({ code: 'pack', text: 'Упаковка есть и в продажах, и в расходах «Коробки и упаковка» — проверьте, не дважды ли.' });
  if (!k1099Rule) warnings.push({ code: 'k1099', text: `Порога 1099-K на ${Y} год нет в реестре правил.` });
  if (shadowed.size) warnings.push({ code: 'override', text: `Ваше правило вместо проверенного правила программы: ${shadowed.size}.` });
  const unverified = usedRules.filter((r) => ruleCheckState(r, today) === 'unverified');
  if (unverified.length) warnings.push({ code: 'rules', text: `Цифры правил не проверены: ${unverified.length}.` });
  const stale = usedRules.filter((r) => ruleCheckState(r, today) === 'stale');
  if (stale.length) warnings.push({ code: 'stale', text: `Цифры правил пора перепроверить: ${stale.length}.` });
  if (cashTax.unknownGross) warnings.push({ code: 'cashtax', text: `Продажи за наличные без ставки налога в реестре: ${round2(cashTax.unknownGross)}.` });

  return {
    year: Y,
    income: { channels, gross, refunds, net: round2(gross - refunds), count: sales.length, personal: { count: personal.count, gross: round2(personal.gross) }, taxCollected: round2(taxCollected) },
    salesCosts: {
      fees: Object.fromEntries(Object.entries(fees).map(([kk, v]) => [kk, round2(v)])), feesEstimatedCount, feeCredits: round2(feeCredits),
      labels: round2(labels), labelsMissing, packaging: round2(packaging), returnShipping: round2(returnShipping), total: salesCosts,
    },
    cogs: { sold: round2(cogsSold), soldCount: sales.length, writeoff: cogsWriteoff, writeoffCount: writeoffs.length, returned: round2(cogsReturned), returnedCount, total: cogsTotal },
    inventory: { begin: round2(invBegin), purchases: purchasesTotal, purchasesCount: purchases.length, end: round2(invEnd) },
    expenses: { byCategory: expByCat, total: expensesTotal, rows: expenses },
    mileage,
    k1099, k1099Rule,
    cashTax,
    profit, approx: feesEstimatedCount > 0 || labelsMissing > 0 || mg.unknown.count > 0,
    rules: usedRules,
    warnings,
    rows: { sales, refunds: refundRows, writeoffs, purchases },
  };
}

// ---------- CSV для бухгалтера ----------
// Один файл с разделами (удобно сохранить с телефона одним нажатием): UTF-8 с BOM, разделитель — запятая,
// числа с точкой. Текст, начинающийся с = + - @, получает в начале апостроф (защита от формул в Excel).

class Num { constructor(s) { this.s = s; } }
const money = (v) => (typeof v === 'number' && Number.isFinite(v) ? new Num(round2(v).toFixed(2)) : '');
const numF = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? new Num(v.toFixed(d)) : '');
const int = (v) => (Number.isInteger(v) ? new Num(String(v)) : '');

export function csvCell(v) {
  if (v instanceof Num) return v.s;
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const line = (cells) => cells.map(csvCell).join(',');
const yn = (b) => (b ? 'yes' : 'no');

export function csvFileName(year) {
  return `perekup-nalogi-${year}.csv`;
}

export function summaryCsv(state, year, now = new Date()) {
  const S = yearSummary(state, year, now);
  const today = todayLocal(now);
  const L = [];
  const row = (...c) => L.push(line(c));
  const blank = () => L.push('');
  const ruleVal = (r) => (r ? r.value : null);
  const statusEn = (r) => ({ verified: 'verified', stale: 'verified, recheck due', unverified: 'unverified' }[ruleCheckState(r, today)]);

  row('Perekup — tax year summary / Сводка «Перекупа» для налогов', int(S.year));
  row('Generated / Создано', today);
  row('Note / Пометка', 'Rules marked "unverified" are not checked yet / Цифры правил со статусом «не проверено» ещё не проверены');
  row('Schedule C lines / Строки Schedule C', `Form line numbers checked ${SCHEDULE_C.checked}: ${SCHEDULE_C.source} — shown only where the line is unambiguous; the accountant decides the rest`);
  blank();

  row('SUMMARY / СВОДКА');
  row('Line', 'Строка', 'Value', 'Unit', 'Schedule C line');
  const sum = (en, ru, v, unit = 'USD', ln = '') => row(en, ru, unit === 'USD' ? money(v) : unit === 'miles' ? numF(v, 1) : int(v), unit, ln);
  sum('Gross sales incl. shipping charged', 'Валовые продажи (с доставкой с покупателя)', S.income.gross, 'USD', SC.gross_receipts);
  for (const c of S.income.channels) sum(`Gross sales — ${CHANNELS_EN[c.channel]}`, `Продажи — ${CHANNELS[c.channel]}`, c.gross);
  sum('Sales count', 'Продаж, шт.', S.income.count, 'count');
  sum('Refunds to buyers (in the year money was refunded)', 'Возвраты покупателям (в год возврата денег)', S.income.refunds, 'USD', SC.returns_allowances);
  sum('Net sales', 'Продажи за вычетом возвратов', S.income.net);
  sum('  of which personal items (gross)', '  из них свои (личные) вещи', S.income.personal.gross);
  sum('Sales tax collected by platforms (not income)', 'Налог с продаж, удержанный площадками (не доход)', S.income.taxCollected);
  sum('Own cash sales (gross)', 'Свои продажи за наличные', S.cashTax.gross);
  sum('Sales tax on own cash sales at San Diego rate (approx.)', 'Налог с продаж с наличных по ставке Сан-Диего (≈)', S.cashTax.tax);
  sum('Cost of goods sold (specific identification)', 'Себестоимость проданного (по вещам)', S.cogs.sold);
  sum('Inventory written off (unsold / scrap)', 'Списано: не продано / лом (себестоимость)', S.cogs.writeoff);
  sum('Returned items back in stock (cost, subtracted)', 'Вернулись на склад после продажи (себестоимость, вычитается)', S.cogs.returned);
  sum('Cost of goods total', 'Себестоимость всего', S.cogs.total, 'USD', `${SC.cogs} (→ ${SC.cogs_to_part1})`);
  sum('Platform fees — final value fee', 'Комиссия площадки (final value fee)', S.salesCosts.fees.finalValue);
  sum('Platform fees — per-order fee', 'Фикс. сбор за заказ', S.salesCosts.fees.perOrder);
  sum('Advertising (promoted listings)', 'Реклама', S.salesCosts.fees.ads, 'USD', SC.advertising);
  sum('Other platform fees', 'Прочие сборы площадки', S.salesCosts.fees.other);
  sum('Platform fees — ESTIMATED (not entered)', 'Комиссия ≈ по % категории (не введена)', S.salesCosts.fees.estimated);
  sum('Fee credits from platform on returns (subtracted)', 'Комиссия, возвращённая площадкой при возврате (вычитается)', S.salesCosts.feeCredits);
  sum('Shipping labels', 'Этикетки (доставка)', S.salesCosts.labels);
  sum('Return shipping paid', 'Обратная доставка при возвратах', S.salesCosts.returnShipping);
  sum('Packaging (entered per sale)', 'Упаковка (в продажах)', S.salesCosts.packaging);
  for (const c of S.expenses.byCategory) sum(`Expenses — ${EXPENSE_CATEGORIES_EN[c.category]}`, `Расходы — ${EXPENSE_CATEGORIES[c.category]}`, c.amount);
  sum('Expenses total', 'Расходы всего', S.expenses.total);
  sum('Business miles', 'Мили по делу', S.mileage.miles, 'miles', SC.business_miles);
  for (const g of S.mileage.byRate) row(`Miles at $${g.rate}/mile`, `Мили по ставке $${g.rate}`, numF(g.miles, 1), 'miles');
  for (const g of S.mileage.byRate) row(`Amount at $${g.rate}/mile (total miles × rate)`, `Сумма по ставке $${g.rate} (мили × ставка)`, money(g.amount), 'USD');
  sum('Mileage amount (miles × rate on trip date)', 'Мили × ставка на дату поездки', S.mileage.amount, 'USD', SC.car_truck_expenses);
  sum('Miles without a rate (not in amount)', 'Мили без ставки (не в сумме)', S.mileage.unknown.miles, 'miles');
  sum('Profit by these numbers' + (S.approx ? ' (approx.)' : ''), 'Прибыль по этим цифрам' + (S.approx ? ' (≈)' : ''), S.profit);
  sum('Inventory at cost, Jan 1', 'Склад на 1 января (себестоимость)', S.inventory.begin, 'USD', SC.cogs_inventory_begin);
  sum('Purchases at cost during year', 'Куплено за год (себестоимость)', S.inventory.purchases, 'USD', SC.cogs_purchases);
  sum('Inventory at cost, Dec 31', 'Склад на 31 декабря (себестоимость)', S.inventory.end, 'USD', SC.cogs_inventory_end);
  blank();

  row('SALES / ПРОДАЖИ');
  row('Date', 'Platform', 'Item', 'SKU', 'Origin', 'Price', 'Shipping charged', 'Gross', 'Fee: final value', 'Fee: per order', 'Fee: ads', 'Fee: other', 'Fee: estimated', 'Fees total', 'Fees entered as one sum', 'Label', 'Packaging', 'Refund', 'Refund date', 'Returned to stock on', 'Sales tax collected by platform', 'Cost basis (COGS)', 'Payout ID');
  for (const s of S.rows.sales) {
    const f = s.feesByType;
    row(s.date, CHANNELS_EN[s.channel], s.title, s.sku, ORIGINS_EN[s.origin] || s.origin, money(s.price), money(s.shipCharged), money(s.gross),
      money(f.finalValue), money(f.perOrder), money(f.ads), money(f.other), money(f.estimated), money(s.fees), yn(s.feesCombined),
      s.label === null ? 'unknown' : money(s.label), money(s.packaging), money(s.refund), s.refundDate || '', s.returnedOn || '', money(s.taxCollected), money(s.basis), s.payoutId);
  }
  blank();

  row('REFUNDS AND RETURNS / ВОЗВРАТЫ');
  row('Date', 'Sale date', 'Platform', 'Item', 'SKU', 'Kind', 'Refunded to buyer', 'Return shipping', 'Fee credit from platform', 'Cost back in stock');
  for (const r of S.rows.refunds) {
    row(r.date, r.saleDate, CHANNELS_EN[r.channel], r.title, r.sku, r.kind === 'return' ? 'item returned to stock' : 'refund (item kept by buyer)',
      money(r.amount), money(r.returnShipping), money(r.feeCredit), money(r.basisBack));
  }
  blank();

  row('WRITE-OFFS / СПИСАНИЯ');
  row('Date', 'Item', 'SKU', 'Kind', 'Cost basis');
  for (const w of S.rows.writeoffs) row(w.date, w.title, w.sku, WRITEOFF_EN[w.kind] || WRITEOFF_KINDS[w.kind], money(w.basis));
  blank();

  row('PURCHASES (INVENTORY) / ПОКУПКИ');
  row('Date', 'Item', 'SKU', 'Origin', 'Price', 'Sales tax', 'Buyer premium', 'Freight to me', 'Cost basis', 'Place', 'Seller', 'Part of lot');
  for (const p of S.rows.purchases) row(p.date, p.title, p.sku, ORIGINS_EN[p.origin] || ORIGINS[p.origin], money(p.buyPrice), money(p.salesTax), money(p.buyerPremium), money(p.freight), money(p.basis), p.place, p.seller, yn(p.lot));
  blank();

  row('EXPENSES / РАСХОДЫ');
  row('Date', 'Category', 'Категория', 'Amount', 'What', 'Receipt note (no receipt photos yet)');
  for (const x of S.expenses.rows) row(x.date, EXPENSE_CATEGORIES_EN[x.category], EXPENSE_CATEGORIES[x.category], money(x.amount), x.note, x.receipt);
  blank();

  row('MILEAGE LOG / ЖУРНАЛ ПОЕЗДОК');
  row('Date', 'From', 'To', 'Purpose', 'Miles', 'Rate used ($/mile)', 'Amount (per trip, rounded)', 'Recorded as');
  const srcEn = { trip: 'trip log', item: 'with purchase', lot: 'with lot purchase' };
  for (const t of S.mileage.rows) {
    const purpose = [TRIP_KINDS_EN[t.kind], t.purpose].filter(Boolean).join(': ');
    row(t.date, t.from, t.to, purpose, numF(t.miles, 1), t.rateUsed === null ? 'unknown' : numF(t.rateUsed, 3), money(t.amount), srcEn[t.src]);
  }
  blank();

  row('FORM 1099-K COUNTERS / СЧЁТЧИКИ 1099-K');
  row('Platform', 'Gross (price + shipping)', 'Transactions', 'Threshold: gross over', 'Threshold: transactions over', 'Over threshold');
  for (const k of S.k1099) {
    row(CHANNELS_EN[k.channel], money(k.gross), int(k.count), S.k1099Rule ? money(S.k1099Rule.minGross) : 'unknown', S.k1099Rule ? int(S.k1099Rule.minCount) : 'unknown', k.overThreshold === null ? 'unknown' : yn(k.overThreshold));
  }
  blank();

  row('TAX RULES USED / ПРАВИЛА');
  row('Rule', 'Value', 'Tax year', 'Valid from', 'Valid to', 'Status', 'Verified on', 'Next check', 'Official source');
  for (const r of S.rules) {
    const meta = RULE_KEYS[r.key];
    const v = meta.unit === 'rate' ? numF(r.value, 3) : meta.unit === 'pct' ? numF(r.value * 100, 2) : meta.unit === 'count' ? int(r.value) : money(ruleVal(r));
    row(meta.en, v, int(r.taxYear), r.validFrom || '', r.validTo || '', statusEn(r), r.verifiedAt || '', r.nextCheck || '', r.sourceUrl);
  }
  if (S.warnings.length) {
    blank();
    row('WARNINGS / ПРОВЕРИТЬ');
    for (const w of S.warnings) row(w.text);
  }
  return '﻿' + L.join('\r\n') + '\r\n';
}
