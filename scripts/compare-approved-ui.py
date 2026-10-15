"""Isolate approved board panels and make honest, uniformly scaled review sheets.
Requires Pillow. No image registration, stretching, similarity score or target edits.
"""
from pathlib import Path
import json
from PIL import Image, ImageDraw
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/assets/implementation/comparisons'
OUT.mkdir(parents=True, exist_ok=True)
# Bounds in original 1448 x 1086 boards. Phone bounds exclude device chrome/status bar.
PANELS = {
    'desktop-main': ('desktop', (180, 135, 1416, 709), 'populated-1182.png', 1182),
    'phone-home': ('mobile', (243, 216, 439, 550), 'phone-home-390.png', 390),
    'phone-write': ('mobile', (1013, 216, 1208, 550), 'phone-write-390.png', 390),
    'phone-ask': ('mobile', (504, 668, 695, 986), 'phone-ask-390.png', 390),
}
manifest = {'method': 'Board panel isolated by explicit bounds; each image uniformly scaled to the stated width, top-aligned on a neutral canvas. Different content and viewport ratios remain visible. Overlay is diagnostic only; no pixel-perfect or numerical similarity claim.', 'panels': {}}
for name, (board, bounds, actual_name, width) in PANELS.items():
    reference = Image.open(ROOT / f'docs/assets/approved/{board}.png').convert('RGB').crop(bounds)
    actual = Image.open(ROOT / f'docs/assets/implementation/after/{actual_name}').convert('RGB')
    def fit(img):
        return img.resize((width, round(img.height * width / img.width)), Image.Resampling.LANCZOS)
    ref, live = fit(reference), fit(actual)
    height = max(ref.height, live.height)
    a = Image.new('RGB', (width, height), '#ddd9d2'); b = a.copy()
    a.paste(ref, (0, 0)); b.paste(live, (0, 0))
    sheet = Image.new('RGB', (width * 2 + 24, height + 48), '#ddd9d2')
    sheet.paste(a, (0, 48)); sheet.paste(b, (width + 24, 48))
    draw = ImageDraw.Draw(sheet)
    draw.text((12, 16), 'CANONICAL PANEL - illustrative board content', fill='#2f2f2f')
    draw.text((width + 36, 16), 'RUNNING APP - synthetic / empty evidence', fill='#2f2f2f')
    sheet.save(OUT / f'{name}-comparison.jpg', quality=90)
    Image.blend(a, b, .5).save(OUT / f'{name}-overlay.jpg', quality=90)
    reference.save(OUT / f'{name}-reference.png')
    manifest['panels'][name] = {'board': board, 'bounds_xyxy': bounds, 'actual': actual_name, 'uniform_width': width, 'reference_scaled_height': ref.height, 'actual_scaled_height': live.height}
(OUT / 'method.json').write_text(json.dumps(manifest, indent=2) + '\n')
