# RB POS - membuat ikon aplikasi & layar pembuka Android dari icon.png (logo RB BAN, latar hitam)
import os, glob
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
BG = (0, 0, 0, 255)
logo = Image.open(os.path.join(ROOT, 'icon.png')).convert('RGBA')

def fit(size, scale):
    im = Image.new('RGBA', (size, size), BG)
    n = max(1, int(size * scale))
    lg = logo.resize((n, n), Image.LANCZOS)
    im.paste(lg, ((size - n) // 2, (size - n) // 2), lg)
    return im

DENS = {'mdpi': (48, 108), 'hdpi': (72, 162), 'xhdpi': (96, 216), 'xxhdpi': (144, 324), 'xxxhdpi': (192, 432)}
for d, (ic, fg) in DENS.items():
    folder = os.path.join(RES, 'mipmap-' + d)
    os.makedirs(folder, exist_ok=True)
    fit(ic, 1.0).save(os.path.join(folder, 'ic_launcher.png'))
    # ikon bulat: logo dipotong lingkaran
    r = fit(ic, 0.92)
    mask = Image.new('L', (ic, ic), 0)
    from PIL import ImageDraw
    ImageDraw.Draw(mask).ellipse((0, 0, ic - 1, ic - 1), fill=255)
    rr = Image.new('RGBA', (ic, ic), (0, 0, 0, 0)); rr.paste(r, (0, 0), mask)
    rr.save(os.path.join(folder, 'ic_launcher_round.png'))
    # ikon adaptif (Android 8+): logo di zona aman 66%
    fit(fg, 0.66).save(os.path.join(folder, 'ic_launcher_foreground.png'))

vals = os.path.join(RES, 'values')
os.makedirs(vals, exist_ok=True)
with open(os.path.join(vals, 'ic_launcher_background.xml'), 'w') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#000000</color>\n</resources>\n')

# layar pembuka (splash) bawaan Capacitor: ganti jadi hitam + logo
n = 0
for p in glob.glob(os.path.join(RES, 'drawable*', 'splash.png')):
    w, h = Image.open(p).size
    im = Image.new('RGB', (w, h), (0, 0, 0))
    s = int(min(w, h) * 0.45)
    lg = logo.resize((s, s), Image.LANCZOS)
    im.paste(lg, ((w - s) // 2, (h - s) // 2), lg)
    im.save(p); n += 1
print('Ikon RB POS dibuat. Splash diganti: %d file' % n)
