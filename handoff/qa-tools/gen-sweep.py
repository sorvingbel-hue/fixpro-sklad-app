# Развёртка «фото экрана под углом»: шаг строк × поворот (вымышленный заказ). Берёт функции из gen-qa.py.
import sys, os, json, types
src = open(os.path.join(os.path.dirname(__file__), 'gen-qa.py')).read()
head = src.split('# --- S_A:')[0] + src.split('# ---------- фото экрана ----------')[1].split('# поворот:')[0]
OUT = sys.argv[1]
g = {'__name__': 'sweep'}; sys.argv = [sys.argv[0], OUT]
exec(head, g)
A = [('Return grille 20x20', 6), ('Filter MERV 13', 2), ('Breaker 2 pole 30', 1), ('Supply boot 6x10', 4), ('Flex duct 8 in', 3), ('Condensate pump', 1),
     ('Thermostat wire 18/5', 2), ('Disconnect 60A', 1)]
g['A'] = A
for pitch in (70, 80, 95, 110):
    img, d = g['canvas'](); y = g['top'](d)
    g['table'](d, y + 40, [('Description', 60, 'l'), ('Qty', g['W'] - 70, 'r')], [[n, q] for n, q in A], pitch=pitch)
    base = f'w{pitch}'; g['truth'][base] = A
    for rot in (-7, -6, -5.5, -5, -4.5, -4, -3.5, -3, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7):
        g['photo'](img, f'w{pitch}_r{rot:+}', rot=rot, blur=0.8, noise=3, q=85, seed=int(pitch * 10 + rot * 10), base=base)
    g['truth'].pop(base)
json.dump(g['truth'], open(os.path.join(OUT, 'truth.json'), 'w'), ensure_ascii=False, indent=1)
print('ok', len(g['truth']))
