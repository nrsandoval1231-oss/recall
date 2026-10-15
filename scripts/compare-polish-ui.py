"""Place unscaled running-app captures side by side. No similarity scoring."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / 'docs/assets/polish'
out = root / 'comparisons'
out.mkdir(exist_ok=True)
for filename in ['empty-900.jpg', 'populated-900.png', 'write-900.jpg',
                 'ready-900.jpg', 'ask-900.jpg', 'phone-write-390.png',
                 'phone-results-390.png']:
    before = Image.open(root / 'before' / filename).convert('RGB')
    after = Image.open(root / 'after' / filename).convert('RGB')
    sheet = Image.new('RGB', (before.width + after.width + 24,
                             max(before.height, after.height) + 48), '#ebe1d9')
    sheet.paste(before, (0, 48))
    sheet.paste(after, (before.width + 24, 48))
    draw = ImageDraw.Draw(sheet)
    draw.text((12, 16), 'BEFORE - audited 6decc91 - synthetic data', fill='#2f2f2f')
    draw.text((before.width + 36, 16), 'AFTER - repaired running app - synthetic data', fill='#2f2f2f')
    sheet.save(out / (Path(filename).stem + '-comparison.jpg'), quality=92)
