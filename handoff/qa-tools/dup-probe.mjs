const { findExisting, planConfirm, toRows, parseOrderLines } = await import(process.argv[2]);
const ex = [{ id: 'a', name: 'Supply boot 6x10', qty: 4, actual: 2 }, { id: 'b', name: 'Flex duct 8 in', qty: 3 }, { id: 'c', name: 'Filter MERV 13', qty: 2 }];
for (const n of ['Supply boot 6x10 4', 'Flex duct 8in', 'Flex duct 8 jn', 'Filter MERY 13', 'Filter MERV 13', '2 Breaker 2 pole 30'])
  console.log(JSON.stringify(n), '→', findExisting(n, ex)?.name ?? 'НЕ узнан как повтор');
// правка количества в строке-повторе без выбора «Заменить»
const rows = toRows([{ name: 'Filter MERV 13', qty: 2, unit: 'шт.', confidence: 95, flags: [], raw: 'x' }], k => 'r' + k);
rows[0].qty = '8';
const p = planConfirm(rows, ex, {});
console.log('правка 2→8 без «Заменить»: add', p.add.length, 'replace', p.replace.length, 'keep', p.keep.length);
