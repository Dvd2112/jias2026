#!/usr/bin/env python3
"""Gera os logos leves usados no site a partir dos originais em design/.
Uso: python3 scripts/optimize-logos.py      (requer Pillow e, para PDF, o pdftoppm)
Para trocar/adicionar um logo: ponha o arquivo em design/logos-aaa/, ajuste SRC abaixo e rode de novo."""
import subprocess, tempfile, pathlib
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
DESIGN = ROOT / 'design'          # originais pesados (não vão para o ar)
OUT = ROOT / 'public' / 'assets'  # versões leves usadas pelo site
SRC = {  # slug (mesmo de teams.js) -> arquivo original
    'corsarios': 'AAACSAUFB Corsários.PNG', 'macaco': 'AAACSUFB Macaco.png', 'urso': 'AAAD CESUL Urso.png',
    'marreco': 'AAAFB X DE MAIO Marreco.png', 'indio': 'INDIO.png', 'lobo': 'MED UNIOESTE SANGUINARIA.png',
    'predadores': 'PREDADORES.png', 'devora': 'AAANUFB Devora.pdf',
}

def load(path):
    if path.suffix.lower() == '.pdf':
        tmp = pathlib.Path(tempfile.mkdtemp()) / 'p'
        subprocess.run(['pdftoppm', '-png', '-r', '150', '-singlefile', str(path), str(tmp)], check=True)
        im = Image.open(str(tmp) + '.png').convert('RGBA')
        return knock_out_white(im)
    return Image.open(path).convert('RGBA')

def knock_out_white(im):
    """Tira o fundo branco ligado às bordas (o brasão tem contorno escuro, então o branco interno é preservado)."""
    rgb = im.convert('RGB'); mark = (255, 0, 255)
    for xy in [(0, 0), (im.width - 1, 0), (0, im.height - 1), (im.width - 1, im.height - 1)]:
        if rgb.getpixel(xy) != mark:
            ImageDraw.floodfill(rgb, xy, mark, thresh=40)
    px, out = rgb.load(), im.copy(); op = out.load()
    for y in range(im.height):
        for x in range(im.width):
            if px[x, y] == mark: op[x, y] = (255, 255, 255, 0)
    return out

def square(im, size, pad=0.04, bg=None):
    bbox = im.getchannel('A').point(lambda v: 255 if v > 10 else 0).getbbox()
    im = im.crop(bbox)
    side = int(max(im.size) * (1 + pad * 2))
    canvas = Image.new('RGBA', (side, side), bg or (0, 0, 0, 0))
    canvas.alpha_composite(im, ((side - im.width) // 2, (side - im.height) // 2))
    return canvas.resize((size, size), Image.LANCZOS)

out = OUT / 'teams'; out.mkdir(parents=True, exist_ok=True)
for slug, fn in SRC.items():
    square(load(DESIGN / 'logos-aaa' / fn), 256).save(out / f'{slug}.webp', quality=90, method=6)
    print('team', slug, (out / f'{slug}.webp').stat().st_size // 1024, 'KB')

jias = load(DESIGN / 'logo-jias' / 'Logo Colorido.png')
square(jias, 512, 0.02).save(OUT / 'logo.webp', quality=92, method=6)
navy = (15, 39, 68, 255)
square(jias, 192, 0.06, navy).save(OUT / 'icon-192.png')
square(jias, 512, 0.06, navy).save(OUT / 'icon-512.png')
square(jias, 180, 0.06, navy).save(OUT / 'apple-touch-icon.png')
square(jias, 64, 0.02).save(OUT / 'favicon.png')
print('jias logo', (OUT / 'logo.webp').stat().st_size // 1024, 'KB')
