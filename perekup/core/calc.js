// СГЕНЕРИРОВАНО из perekup-core/src/calc.ts — не править руками, запустить: node build.mjs
// source-sha256: 0a3242ee970f7b96e108219d1183b6f206375381a225bdc970efd5affb9803cc
// compiler: tsc 6.0.3
// «Перекуп» — ядро расчётов (ТЗ v1.1, §5). Чистые функции без сети и без ИИ:
// деньги и ликвидность считает код, ИИ только объясняет (ТЗ §1, §6).
// Все суммы — в долларах (number), округление только на выходе.
const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
// Чистая прибыль (ТЗ §5)
export function netProfit(cat, comps, costs) {
    if (comps.medianSold === null || !(comps.medianSold > 0))
        return null;
    const gross = comps.medianSold + n(comps.shipCharged);
    const fees = cat.feePct * (gross + n(costs.estBuyerTax)) + cat.perOrderFee;
    return gross - fees - n(costs.label) - n(costs.packaging) - n(costs.buyPrice) - n(costs.miles) * n(costs.mileRate);
}
// Доля продаж: только ориентир спроса, НЕ срок продажи вещи (ТЗ v1.1).
export function sellThrough(comps) {
    if (comps.sold90 === null || comps.activeNow === null)
        return null;
    if (!(comps.activeNow > 0))
        return null; // 0 активных — «недостаточно данных»
    return comps.sold90 / comps.activeNow;
}
// Максимальная цена покупки: меньшее из (а) цены, при которой net = minNet, и (б) потолка от медианы.
export function maxOffer(cat, comps, costs, ceiling = 'high') {
    const atZeroBuy = netProfit(cat, comps, { ...costs, buyPrice: 0 });
    if (atZeroBuy === null || comps.medianSold === null)
        return null;
    const byNet = atZeroBuy - cat.minNet;
    const byCeiling = comps.medianSold * (ceiling === 'high' ? cat.buyCeilingHigh : cat.buyCeilingLow);
    const v = Math.min(byNet, byCeiling);
    return v > 0 ? Math.floor(v) : 0;
}
// Вердикт кода (ИИ потом только объясняет его словами — ТЗ §6)
export function verdict(cat, comps, costs) {
    const missing = [];
    if (comps.medianSold === null || !(comps.medianSold > 0))
        missing.push('нет медианы продаж');
    if (comps.sold90 === null)
        missing.push('не введено «продано за 90 дней»');
    if (comps.activeNow === null)
        missing.push('не введено «активных сейчас»');
    else if (!(comps.activeNow > 0))
        missing.push('активных объявлений 0');
    if (comps.sold90 !== null && comps.sold90 < cat.minSold90)
        missing.push(`меньше ${cat.minSold90} продаж за 90 дней`);
    if (missing.length)
        return { kind: 'insufficient', reasons: missing };
    const net = netProfit(cat, comps, costs);
    const str = sellThrough(comps);
    const offer = maxOffer(cat, comps, costs);
    const weakDemand = cat.minStr !== null && str < cat.minStr;
    // maxOffer уже учитывает и минимальную прибыль, и потолок от медианы:
    // цена продавца ≤ maxOffer → брать; выше, но maxOffer > 0 → предложить maxOffer; иначе не брать.
    if (!weakDemand && net >= cat.minNet && n(costs.buyPrice) <= offer)
        return { kind: 'buy', net, str, maxOffer: offer };
    if (!weakDemand && offer > 0)
        return { kind: 'offer', net, str, maxOffer: offer };
    const reasons = [];
    if (weakDemand)
        reasons.push(`спрос слабый: STR ${(str * 100).toFixed(0)}% < ${(cat.minStr * 100).toFixed(0)}%`);
    if (offer <= 0)
        reasons.push('даже бесплатно не выходит на минимальную прибыль');
    else if (net < cat.minNet)
        reasons.push(`чистая прибыль ${net.toFixed(2)} < ${cat.minNet}`);
    return { kind: 'skip', net, str, reasons };
}
// Распределение цены лота по вещам (специфическая идентификация, ТЗ M2/M4):
// пропорционально оценкам, сумма долей = цена лота до цента.
export function allocateLot(totalCents, weights) {
    if (!Number.isInteger(totalCents) || totalCents < 0)
        throw new Error('totalCents: целое ≥ 0');
    const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
    if (!weights.length)
        return [];
    if (sum === 0)
        weights = weights.map(() => 1);
    const s = weights.reduce((a, b) => a + Math.max(0, b), 0);
    const raw = weights.map(w => (totalCents * Math.max(0, w)) / s);
    const out = raw.map(Math.floor);
    let rest = totalCents - out.reduce((a, b) => a + b, 0);
    const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
    for (let k = 0; rest > 0; k++, rest--)
        out[order[k % order.length][1]]++;
    return out;
}
// Скорость выплаты (ТЗ v1.1): дни от продажи до денег на счёте.
export function payoutDays(soldAt, paidAt) {
    if (!paidAt)
        return null;
    const d = (Date.parse(paidAt) - Date.parse(soldAt)) / 86400000;
    return Number.isFinite(d) ? Math.round(d * 10) / 10 : null;
}
// Счётчик 1099-K за год: порог из реестра tax_rules (на 2025–2026: > $20 000 И > 200 сделок).
export function form1099kStatus(sales, rule) {
    const gross = sales.reduce((a, s) => a + n(s.gross), 0);
    const count = sales.length;
    return { gross, count, overThreshold: gross > rule.minGross && count > rule.minCount };
}
