# ВЫМЫШЛЕННЫЕ скрины заказов для разрушающей проверки «Формана» (все данные выдуманы, генерируются здесь).
# Каждая картинка → как в приложении: скрин — копия для распознавания (JPEG 0.9, во всю ширину),
# фото — полная копия 1600 px по длинной стороне (JPEG 0.82). truth.json — правильные количества (None — пусто на скрине).
import json, math, os, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
F = '/usr/share/fonts/opentype/inter/Inter-Regular.otf'
FB = '/usr/share/fonts/opentype/inter/Inter-SemiBold.otf'
TEXT, GRAY, LINE, HEADBG = (25, 25, 28), (120, 120, 125), (222, 222, 226), (238, 241, 245)
font = lambda sz, b=False: ImageFont.truetype(FB if b else F, sz)
W, H = 1170, 2532
truth = {}

def canvas(h=H):
    img = Image.new('RGB', (W, h), 'white'); return img, ImageDraw.Draw(img)

def top(d, title='ORDER #QA-1187'):
    d.text((60, 40), '9:41', font=font(38), fill=TEXT)
    d.text((60, 150), title, font=font(56, True), fill=TEXT)
    d.text((60, 240), 'Fictional QA order, generated', font=font(38), fill=GRAY)
    return 330

def rt(d, x, y, t, f, fill=TEXT):  # текст, прижатый вправо к x
    d.text((x - d.textlength(t, font=f), y), t, font=f, fill=fill)

def table(d, y, cols, items, fs=46, pitch=110, headh=84):
    """cols: [(title, x, align)], items: [[cell,...]] (None — пусто)"""
    d.rectangle((0, y, W, y + headh), fill=HEADBG)
    for t, x, al in cols:
        (rt if al == 'r' else (lambda d_, x_, y_, t_, f_: d_.text((x_, y_), t_, font=f_, fill=TEXT)))(d, x, y + 16, t, font(44, True))
    y += headh + 36
    f = font(fs)
    for cells in items:
        for (t, x, al), c in zip(cols, cells):
            if c is None: continue
            (rt if al == 'r' else (lambda d_, x_, y_, t_, f_: d_.text((x_, y_), t_, font=f_, fill=TEXT)))(d, x, y, str(c), f)
        y += pitch - 34
        d.line((60, y, W - 60, y), fill=LINE, width=2)
        y += 34
    return y

def save_shot(img, name, items):
    img.save(os.path.join(OUT, name + '.png'))
    img.save(os.path.join(OUT, name + '.ocr.jpg'), quality=90)  # как копия :ocr в приложении
    truth[name] = items

# --- S_A: базовый «Description | Qty» (6 строк) — для фото под углом; S_A2 — плотные строки (шаг 80)
A = [('Return grille 20x20', 6), ('Filter MERV 13', 2), ('Breaker 2 pole 30', 1), ('Supply boot 6x10', 4), ('Flex duct 8 in', 3), ('Condensate pump', 1),
     ('Thermostat wire 18/5', 2), ('Disconnect 60A', 1)]
def shot_A(pitch=110, name='sA'):
    img, d = canvas(); y = top(d)
    table(d, y + 40, [('Description', 60, 'l'), ('Qty', W - 70, 'r')], [[n, q] for n, q in A], pitch=pitch)
    save_shot(img, name, A); return img
sA = shot_A(); sA2 = shot_A(80, 'sA2')

# --- S_B: после таблицы — итог и раздел «Equipment on site» с числами справа (под колонкой Qty)
img, d = canvas(); y = top(d)
B_items = [('Return grille 20x20', 6), ('Filter MERV 13', 2), ('Condensate pump', 1)]
y = table(d, y + 40, [('Description', 60, 'l'), ('Qty', W - 70, 'r')], [[n, q] for n, q in B_items])
y += 30
for lab, val in (('Subtotal', '$412.00'), ('Tax', '$33.99'), ('Total', '$445.99')):
    d.text((60, y), lab, font=font(46), fill=TEXT); rt(d, W - 70, y, val, font(46)); y += 76
y += 40; d.text((60, y), 'Equipment on site', font=font(50, True), fill=TEXT); y += 100
for lab, val in (('Breaker 2 pole', '30'), ('Tonnage', '3'), ('Filter MERV', '13'), ('Warranty years', '10')):
    d.text((60, y), lab, font=font(46), fill=TEXT); rt(d, W - 70, y, val, font(46)); y += 96
save_shot(img, 'sB', B_items)

# --- S_C: «Description | Qty | Unit», у двух строк клетка Qty пустая
img, d = canvas(); y = top(d)
C = [('Return grille 20x20', 6), ('Filter MERV 13', None), ('Breaker 2 pole 30', None), ('Supply boot 6x10', 4), ('Wire nuts', 10)]
table(d, y + 40, [('Description', 60, 'l'), ('Qty', 880, 'r'), ('Unit', W - 70, 'r')], [[n, q, 'ea'] for n, q in C])
save_shot(img, 'sC', C)

# --- S_D: материалы + вторая таблица «Labor | Hours»
img, d = canvas(); y = top(d)
D1 = [('Return grille 20x20', 6), ('Filter MERV 13', 2)]
y = table(d, y + 40, [('Description', 60, 'l'), ('Qty', W - 70, 'r')], [[n, q] for n, q in D1])
y += 40
y = table(d, y, [('Labor', 60, 'l'), ('Hours', W - 70, 'r')], [['Install return grille', 2], ['Replace breaker', 1], ['Startup and test', 1]])
save_shot(img, 'sD', D1 + [('Install return grille', None), ('Replace breaker', None), ('Startup and test', None)])

# --- S_E: карточки «название / Qty: N», размеры с пробелами и упаковка в названии
img, d = canvas(); y = top(d)
E = [('Return grille 20 x 20', 6), ('Pleated filter 16 x 25 x 1', 4), ('Wire connectors 100 pcs', 2), ('Flex duct 8in x 25ft', 3), ('Line set 3/8 x 3/4 x 25 ft', 1)]
for n, q in E:
    d.text((60, y), n, font=font(48, True), fill=TEXT); y += 70
    d.text((60, y), f'Qty: {q}', font=font(42), fill=GRAY); y += 60
    d.line((60, y + 10, W - 60, y + 10), fill=LINE, width=2); y += 50
save_shot(img, 'sE', E)

# --- S_F: «Description | Qty | Price» тесные колонки, цена целым числом
img, d = canvas(); y = top(d)
Fi = [('Return grille 20x20', 6, 45), ('Filter MERV 13', 2, 35), ('Condensate pump', 1, 189)]
table(d, y + 40, [('Description', 60, 'l'), ('Qty', 760, 'l'), ('Price', 880, 'l')], [[n, q, p] for n, q, p in Fi])
save_shot(img, 'sF', [(n, q) for n, q, _ in Fi])

# --- S_G: обычный счёт «Description | Qty | Price | Total» с $
img, d = canvas(); y = top(d)
G = [('Return grille 20x20', 6, '$45.00', '$270.00'), ('Filter MERV 13', 2, '$35.00', '$70.00'), ('Condensate pump', 1, '$189.00', '$189.00')]
table(d, y + 40, [('Description', 60, 'l'), ('Qty', 640, 'r'), ('Price', 880, 'r'), ('Total', W - 60, 'r')], [[n, q, p, t] for n, q, p, t in G], fs=40)
save_shot(img, 'sG', [(n, q) for n, q, _, _ in G])

# --- S_H: обрезанный скрин: шапка таблицы не попала (сверху — середина таблицы, строка разрезана)
full, d = canvas(); y = top(d)
table(d, y + 40, [('Description', 60, 'l'), ('Qty', W - 70, 'r')], [[n, q] for n, q in A])
crop = full.crop((0, 700, W, 1500)); crop.save(os.path.join(OUT, 'sH.png')); crop.save(os.path.join(OUT, 'sH.ocr.jpg'), quality=90)
truth['sH'] = A

# --- S_I: «Qty» колонка с количеством «1» тонкой цифрой и «11» (слияние)
img, d = canvas(); y = top(d)
I = [('Filter MERV 11', 11), ('Filter MERV 13', 1), ('Breaker 2 pole 30', 1), ('Wire nuts', 11), ('Return grille 20x20', 1)]
table(d, y + 40, [('Description', 60, 'l'), ('Qty', W - 70, 'r')], [[n, q] for n, q in I])
save_shot(img, 'sI', I)

# --- S_J: имя длинное, число в названии стоит близко к колонке Qty (узкий экран)
img, d = canvas(); y = top(d)
J = [('Bar type supply register 10x6 white 2', None), ('Return grille 20x20', 6), ('Copper elbow 3/4 inch 90 deg 12', None), ('Filter MERV 13', 2)]
table(d, y + 40, [('Description', 60, 'l'), ('Qty', W - 70, 'r')], [[n, q] for n, q in J], fs=50)
save_shot(img, 'sJ', J)

# ---------- фото экрана ----------
def find_coeffs(dst, src):
    m = []
    for (x, y), (u, v) in zip(dst, src):
        m.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); m.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    return np.linalg.solve(np.array(m, float), np.array(src, float).reshape(8)).tolist()

def photo(shot, name, rot=0.0, skew=0.0, side=0.0, blur=0.0, moire=0.0, glare=0.0, noise=3, q=85, seed=1, base=None):
    rnd = random.Random(seed); npr = np.random.default_rng(seed)
    bez = 60
    ph = Image.new('RGB', (shot.width + 2 * bez, shot.height + 2 * bez), (18, 18, 20)); ph.paste(shot, (bez, bez))
    a = np.asarray(ph).astype(np.float32) * np.array([0.93, 0.96, 1.0]) + np.array([8, 10, 16])
    if moire > 0:
        yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
        th = math.radians(rnd.uniform(10, 35)); per = rnd.uniform(5.5, 8.0)
        a = a * (1 + moire * np.sin(2 * math.pi * (xx * math.cos(th) + yy * math.sin(th)) / per))[..., None]
    ph = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    CW, CH = 3024, 4032
    bg = (npr.normal(128, 10, (CH // 8, CW // 8, 3)) + np.array([30, 22, 10])).clip(0, 255).astype(np.uint8)
    cv = Image.fromarray(bg).resize((CW, CH), Image.BILINEAR)
    pw, phh = ph.size; sc = 0.80 * CH / phh; w2, h2 = pw * sc, phh * sc
    cx, cy = CW / 2, CH / 2
    cs = [(-w2 / 2, -h2 / 2), (w2 / 2, -h2 / 2), (w2 / 2, h2 / 2), (-w2 / 2, h2 / 2)]
    # skew — верх уже низа (камера снизу); side — правый край короче левого (камера сбоку)
    cs = [(x * (1 - skew if y < 0 else 1), y * (1 - side if x > 0 else 1)) for x, y in cs]
    r = math.radians(rot)
    dst = [(cx + x * math.cos(r) - y * math.sin(r), cy + x * math.sin(r) + y * math.cos(r)) for x, y in cs]
    co = find_coeffs(dst, [(0, 0), (pw, 0), (pw, phh), (0, phh)])
    cv.paste(ph.transform((CW, CH), Image.PERSPECTIVE, co, Image.BICUBIC), (0, 0), Image.new('L', ph.size, 255).transform((CW, CH), Image.PERSPECTIVE, co, Image.BICUBIC))
    if blur > 0: cv = cv.filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(cv).astype(np.float32)
    if glare > 0:
        yy, xx = np.mgrid[0:CH, 0:CW]
        gx, gy = cx + rnd.uniform(-0.25, 0.25) * w2, cy + rnd.uniform(-0.3, 0.1) * h2
        a = a + glare * 255 * np.exp(-(((xx - gx) / (0.22 * w2)) ** 2 + ((yy - gy) / (0.12 * h2)) ** 2))[..., None]
    a = a + npr.normal(0, noise, a.shape)
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    out.save(os.path.join(OUT, name + '.jpg'), quality=q)          # «камера»
    k = 1600 / max(out.size)                                          # как в приложении: полная копия 1600 px, JPEG 0.82
    out.resize((round(out.width * k), round(out.height * k)), Image.LANCZOS).save(os.path.join(OUT, name + '.ocr.jpg'), quality=82)
    truth[name] = truth[base]

# поворот: правый край выше (−) и ниже (+); резкое и с размытием
for rot in (-9, -7, -6, -5, -4, -3, 3, 4, 5, 6, 7, 9):
    photo(sA, f'pA_r{rot:+d}', rot=rot, blur=0.8, noise=3, q=85, seed=100 + rot, base='sA')
for rot in (-6, -4, -3, -2, 2, 3, 4, 6):
    photo(sA2, f'pA2_r{rot:+d}', rot=rot, blur=0.8, noise=3, q=85, seed=200 + rot, base='sA2')
# перспектива (камера снизу/сбоку) + поворот, JPEG 30–50, муар, блик
photo(sA, 'pA_persp1', rot=-3, skew=0.12, side=0.0, blur=1.2, moire=0.05, glare=0.2, noise=5, q=45, seed=301, base='sA')
photo(sA, 'pA_persp2', rot=2, skew=0.0, side=0.15, blur=1.2, moire=0.05, glare=0.0, noise=5, q=40, seed=302, base='sA')
photo(sA, 'pA_persp3', rot=-5, skew=0.2, side=0.1, blur=1.5, moire=0.07, glare=0.4, noise=6, q=35, seed=303, base='sA')
photo(sA, 'pA_persp4', rot=6, skew=0.1, side=-0.12, blur=1.0, moire=0.06, glare=0.3, noise=6, q=30, seed=304, base='sA')
photo(sA2, 'pA2_persp1', rot=-4, skew=0.15, side=0.05, blur=1.4, moire=0.06, glare=0.3, noise=5, q=50, seed=305, base='sA2')
photo(sA, 'pA_blur', rot=-1.5, blur=3.0, moire=0.08, glare=0.0, noise=8, q=35, seed=306, base='sA')

json.dump(truth, open(os.path.join(OUT, 'truth.json'), 'w'), ensure_ascii=False, indent=1)
print('ok', len(truth), 'картинок')
