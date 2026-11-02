"""Crops and contact sheets for the visual audit (read-only: reads the original photographs, writes under the
validation folder). Each crop is cut from the ORIGINAL, unannotated photograph at native pixels and magnified; the
observation is shown only by short ticks at the crop's border pointing at it (along the row: cyan, across: yellow),
so the centre itself is never covered. Row ends get a 1 m crop with the row's direction ticked on the border it
comes from and a white tick pair at the end's place, off the line.

    python -I scripts/rowCrop/validate_crops.py <validation stage folder> <photos folder>

Writes crops/<class>/<id>.png, sheets/<class>-<n>.jpg (numbered cells) and sheets/index.json (sheet, cell -> id).
"""
import json, os, sys, math
from PIL import Image, ImageDraw

stage_dir, photos = sys.argv[1], sys.argv[2]
data = json.load(open(os.path.join(stage_dir, "samples.json")))
samples = data["samples"]
os.makedirs(os.path.join(stage_dir, "sheets"), exist_ok=True)

SPEC = {  # class -> (half crop in photo pixels, zoom, cells per sheet, columns)
    "rowEnd": (110, 2, 16, 4), "fieldEnd": (110, 2, 16, 4), "gap": (90, 2, 16, 4),
}
DEFAULT = (40, 4, 36, 6)
cache = {}


def photo(name):
    if name not in cache:
        cache.clear()
        cache[name] = Image.open(os.path.join(photos, f"{name}.JPG")).convert("RGB")
    return cache[name]


def crop(s):
    half, zoom, _, _ = SPEC.get(s["cls"], DEFAULT)
    im = photo(s["photo"])
    x, y = s["x"], s["y"]
    box = (int(round(x - half)), int(round(y - half)), int(round(x + half)), int(round(y + half)))
    c = im.crop(box).resize((2 * half * zoom, 2 * half * zoom), Image.NEAREST)
    d = ImageDraw.Draw(c)
    n = 2 * half * zoom
    cx = cy = n / 2
    ux, uy = s["ux"], s["uy"]
    if ux == 0 and uy == 0:
        ux, uy = 0, 1
    nx, ny = -uy, ux
    def edge_tick(dx, dy, col, length=14):
        # Walk from the centre to the border along (dx, dy); draw a tick there pointing inward.
        t = min((n / 2 - 2) / abs(dx) if abs(dx) > 1e-6 else 1e9, (n / 2 - 2) / abs(dy) if abs(dy) > 1e-6 else 1e9)
        ex, ey = cx + dx * t, cy + dy * t
        d.line([(ex, ey), (ex - dx * length, ey - dy * length)], fill=col, width=3)
    if s["cls"] in ("rowEnd",):
        # The row comes from -u; ticks where its line meets the border behind the end, and a white pair across at the end.
        edge_tick(-ux, -uy, (0, 230, 255), 22)
        for side in (-1, 1):
            a = (cx + side * nx * 18, cy + side * ny * 18)
            b = (cx + side * nx * 34, cy + side * ny * 34)
            d.line([a, b], fill=(255, 255, 255), width=3)
    else:
        for sgn in (-1, 1):
            edge_tick(sgn * ux, sgn * uy, (0, 230, 255))
            edge_tick(sgn * nx, sgn * ny, (255, 230, 0))
    return c


by_cls = {}
for s in samples:
    by_cls.setdefault(s["cls"], []).append(s)
index = []
for cls, ss in by_cls.items():
    os.makedirs(os.path.join(stage_dir, "crops", cls), exist_ok=True)
    half, zoom, per, cols = SPEC.get(cls, DEFAULT)
    cell = 2 * half * zoom
    ss = sorted(ss, key=lambda s: (int(s["photo"]) if s["photo"].isdigit() else 0, s["id"]))
    for k0 in range(0, len(ss), per):
        chunk = ss[k0:k0 + per]
        rows = math.ceil(len(chunk) / cols)
        sheet = Image.new("RGB", (cols * cell, rows * cell), (15, 15, 15))
        d = ImageDraw.Draw(sheet)
        for j, s in enumerate(chunk):
            c = crop(s)
            c.save(os.path.join(stage_dir, "crops", cls, f"{s['id']}.png"))
            ox, oy = (j % cols) * cell, (j // cols) * cell
            sheet.paste(c, (ox, oy))
            d.rectangle([ox, oy, ox + 34, oy + 20], fill=(0, 0, 0))
            d.text((ox + 4, oy + 4), str(j + 1), fill=(255, 255, 255))
            d.rectangle([ox, oy, ox + cell - 1, oy + cell - 1], outline=(40, 40, 40))
            index.append({"sheet": f"{cls}-{k0 // per + 1}", "cell": j + 1, "id": s["id"], "cls": cls, "photo": s["photo"]})
        sheet.save(os.path.join(stage_dir, "sheets", f"{cls}-{k0 // per + 1}.jpg"), quality=90)
json.dump(index, open(os.path.join(stage_dir, "sheets", "index.json"), "w"), indent=1)
print({c: len(v) for c, v in by_cls.items()}, "sheets:", sorted(set(i["sheet"] for i in index)))
