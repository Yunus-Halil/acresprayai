"""Draw a saved preview result (JSON from the service) over its photograph, for inspection.

    python scripts/render_preview_result.py <image> <result.json> <out.png> [--crop x0 y0 x1 y1] [--max-side 2400]

Yellow outlines = weed instances with their ids; green dashed = crop regions (ERFNet only).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("image")
    ap.add_argument("result")
    ap.add_argument("out")
    ap.add_argument("--crop", type=int, nargs=4, default=None, metavar=("X0", "Y0", "X1", "Y1"))
    ap.add_argument("--max-side", type=int, default=2400)
    ap.add_argument("--no-ids", action="store_true")
    args = ap.parse_args(argv)
    im = ImageOps.exif_transpose(Image.open(args.image)).convert("RGB")
    r = json.loads(Path(args.result).read_text(encoding="utf-8"))
    assert (im.width, im.height) == (r["image"]["width"], r["image"]["height"]), "result does not belong to this image"
    x0, y0, x1, y1 = args.crop or (0, 0, im.width, im.height)
    im = im.crop((x0, y0, x1, y1))
    s = min(1.0, args.max_side / max(im.width, im.height))
    if s < 1.0:
        im = im.resize((int(im.width * s), int(im.height * s)), Image.BILINEAR)
    d = ImageDraw.Draw(im)
    tx = lambda p: ((p[0] - x0) * s, (p[1] - y0) * s)
    for poly in r.get("crop_regions_px") or []:
        pts = [tx(p) for p in poly]
        if len(pts) > 2:
            d.line(pts + [pts[0]], fill=(64, 224, 128), width=1)
    n = 0
    for inst in r["instances"]:
        bx = inst["bbox_px"]
        if bx[2] < x0 or bx[0] > x1 or bx[3] < y0 or bx[1] > y1:
            continue
        n += 1
        for poly in inst["polygons_px"]:
            pts = [tx(p) for p in poly]
            if len(pts) > 2:
                d.line(pts + [pts[0]], fill=(255, 230, 0), width=2)
        if not args.no_ids:
            cx, cy = tx(inst["centroid_px"])
            d.text((cx + 3, cy - 10), str(inst["id"]), fill=(255, 255, 255))
    d.text((6, 6), f"{r['algorithm']['name']}  scale {r['processing']['scale']}  {r['count']} weeds ({n} in view)  {r['timings_ms'].get('total')} ms", fill=(255, 255, 255))
    im.save(args.out)
    print(f"wrote {args.out}: {n} instances in view of {r['count']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
