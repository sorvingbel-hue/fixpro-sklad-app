# Дополнительные ВЫМЫШЛЕННЫЕ скрины (QA): упаковка в названии при колонке Qty; шапка только «Qty» под заголовком раздела.
import sys, os, json
src = open(os.path.join(os.path.dirname(__file__), 'gen-qa.py')).read()
head = src.split('# --- S_A:')[0]
OUT = sys.argv[1]
g = {'__name__': 'extra'}; sys.argv = [sys.argv[0], OUT]
exec(head, g)
W = g['W']
# sK: колонка Qty есть, в названии упаковка «100 pcs» / длина «100 ft»
K = [('Wire connectors 100 pcs', 2), ('Return grille 20x20', 6), ('Zip ties 8 in 100 pcs', 3), ('Hanger strap 100 ft', 1), ('Screws #8 50 pc', 4)]
img, d = g['canvas'](); y = g['top'](d)
g['table'](d, y + 40, [('Description', 60, 'l'), ('Qty', W - 70, 'r')], [[n, q] for n, q in K])
g['save_shot'](img, 'sK', K)
# sN: заголовок раздела, у шапки таблицы подписан только «Qty» (колонка названий без подписи)
N = [('Return grille 20x20', 6), ('Filter MERV 13', 2), ('Condensate pump', 1)]
img, d = g['canvas'](); y = g['top'](d)
d.text((60, y + 20), 'Parts and materials', font=g['font'](50, True), fill=g['TEXT']); y += 110
g['table'](d, y, [('', 60, 'l'), ('Qty', W - 70, 'r')], [[n, q] for n, q in N])
g['save_shot'](img, 'sN', N)
json.dump(g['truth'], open(os.path.join(OUT, 'truth.json'), 'w'), ensure_ascii=False, indent=1)
print('ok', list(g['truth']))
