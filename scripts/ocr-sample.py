# Встроенный ВЫМЫШЛЕННЫЙ пример «скрина заказа» для кнопки «Попробовать разбор на примере».
# Похож на скриншот заказа с телефона (1170×2000, простой шрифт), но это не настоящий заказ и не копия
# чьего-то интерфейса. Одна позиция — с размазанной цифрой количества: распознавание не должно её угадывать.
# Запуск (нужен Python 3 + Pillow): python3 scripts/ocr-sample.py public/ocr/primer-zakaza.png
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/ocr/primer-zakaza.png'
W, H = 1170, 2000
F = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FB = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
img = Image.new('RGB', (W, H), 'white')
d = ImageDraw.Draw(img)
f_small, f_body, f_bold, f_head = (ImageFont.truetype(F, 38), ImageFont.truetype(F, 46),
                                   ImageFont.truetype(FB, 46), ImageFont.truetype(FB, 58))
L, R = 60, W - 60
GRAY, LINE, TEXT = (110, 110, 110), (210, 210, 210), (20, 20, 20)

def right(y, text, font, fill=TEXT):
    d.text((R - d.textlength(text, font=font), y), text, font=font, fill=fill)

y = 40
d.text((L, y), '9:41', font=f_small, fill=TEXT)
y = 150
d.text((L, y), 'ORDER #DEMO-OCR (sample)', font=f_head, fill=TEXT); y += 90
d.text((L, y), 'Fictional example for testing, not a real order', font=f_small, fill=GRAY); y += 70
d.text((L, y), 'Customer: Sample Customer', font=f_small, fill=TEXT); y += 56
d.text((L, y), 'Phone: (555) 010-0199', font=f_small, fill=TEXT); y += 56
d.text((L, y), '100 Sample Way, San Diego, CA 92101', font=f_small, fill=TEXT); y += 90
d.rectangle((0, y, W, y + 80), fill=(238, 241, 245))
d.text((L, y + 14), 'Items', font=f_bold, fill=TEXT); right(y + 14, 'Qty', f_bold); y += 120

ROWS = [
    ('Furnace 80% 60k BTU (sample)', 'Qty 1'),
    ('Bar type supply registers 10x6', 'Qty 6'),
    ('Return air grille 20x20', 'Qty 2'),
    ('Flex duct 6 in, 25 ft', 'Qty 3'),
    ('Thermostat T-01 (sample)', 'Qty 1'),
    ('Condensate pump', None),  # количество размазано — должно стать «проверь количество»
]
for name, qty in ROWS:
    d.text((L, y), name, font=f_body, fill=TEXT)
    if qty:
        right(y, qty, f_body)
    else:
        # «Qty» читается, а цифра под размазанным пятном: угадывать её нельзя
        label = 'Qty '
        x0 = R - d.textlength(label + '4', font=f_body)
        d.text((x0, y), label, font=f_body, fill=TEXT)
        blot = Image.new('L', (90, 90), 0)
        bd = ImageDraw.Draw(blot)
        bd.text((14, 12), '4', font=f_body, fill=255)
        bd.ellipse((10, 18, 80, 72), fill=150)
        blot = blot.filter(ImageFilter.GaussianBlur(9))
        xq = int(x0 + d.textlength(label, font=f_body)) - 14
        img.paste((90, 90, 90), (xq, y - 12), blot)
    y += 76
    d.line((L, y, R, y), fill=LINE, width=2)
    y += 34

y += 40
for label, value in (('Subtotal', '$1,240.00'), ('Tax', '$96.10'), ('Total', '$1,336.10')):
    d.text((L, y), label, font=f_body if label != 'Total' else f_bold, fill=TEXT)
    right(y, value, f_body if label != 'Total' else f_bold)
    y += 70
y += 40
d.text((L, y), 'Technician: Demo Tech', font=f_small, fill=GRAY); y += 56
d.text((L, y), 'Sample image for Forman OCR test', font=f_small, fill=GRAY)
img.save(OUT, optimize=True)
print(OUT, img.size)
