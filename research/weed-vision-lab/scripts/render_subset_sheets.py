"""Phase 2 contact sheets: candidate weeds by category, and rejected or ambiguous cases.

Reads <out>/subset/<version>/sheet_selection.json and instances_labelled.csv.
Writes <out>/subset/<version>/sheets/
  candidates_AB.png, candidates_CD.png   one cell per instance
  rejected.png
  cells/<image>_<id>.png                  the individual cells

Each cell: a window around the instance (2.5 x its box, at least 160 px, clipped
to the image) shown three ways: RGB; RGB with reference outlines (the selected
instance thick yellow, other weeds orange, crops cyan, partial dashed is not
drawn at this size); the semantic mask with the selected instance in magenta.
Below: image id, instance id, category or exclusion, band, the selection
measurements.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import _bootstrap  # noqa: F401
import numpy as np
from PIL import Image, ImageDraw
from skimage import measure

from weedlab.config import DatasetNotFound, resolve_dataset_root, resolve_output_dir
from weedlab.phenobench.reader import CROP_CLASSES, WEED_CLASSES, load_sample
from weedlab.viz.panels import semantic_rgb

CELL = 224
CAP_H = 92
PAD = 6


def window_for(bbox, h, w, factor=2.5, min_side=160):
    x0, y0, x1, y1 = bbox
    side = int(max(min_side, factor * max(x1 - x0, y1 - y0)))
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    wx0, wy0 = max(0, cx - side // 2), max(0, cy - side // 2)
    wx1, wy1 = min(w, wx0 + side), min(h, wy0 + side)
    wx0, wy0 = max(0, wx1 - side), max(0, wy1 - side)
    return wx0, wy0, wx1, wy1


def draw_contours(draw: ImageDraw.ImageDraw, mask: np.ndarray, scale: float, colour, width: int):
    for c in measure.find_contours(np.pad(mask.astype(np.uint8), 1), 0.5):
        pts = [((p[1] - 1) * scale, (p[0] - 1) * scale) for p in c]
        if len(pts) > 1:
            draw.line(pts, fill=colour, width=width)


def render_cell(sample, inst_id: int, row: dict, text_lines: list[str]) -> Image.Image:
    sem, inst = sample.semantics, sample.plant_instances
    h, w = sem.shape
    bbox = (row["bbox_x0"], row["bbox_y0"], row["bbox_x1"], row["bbox_y1"])
    wx0, wy0, wx1, wy1 = window_for(bbox, h, w)
    win = (slice(wy0, wy1), slice(wx0, wx1))
    rgb = sample.image[win]
    sem_w, inst_w = sem[win], inst[win]
    scale = CELL / max(rgb.shape[0], rgb.shape[1])
    size = (int(round(rgb.shape[1] * scale)), int(round(rgb.shape[0] * scale)))

    a = Image.fromarray(rgb).resize(size, Image.BILINEAR)
    b = a.copy()
    d = ImageDraw.Draw(b)
    sel = inst_w == inst_id
    crop = np.isin(sem_w, CROP_CLASSES)
    other_weed = np.isin(sem_w, WEED_CLASSES) & ~sel
    draw_contours(d, crop, scale, (64, 224, 255), 1)
    draw_contours(d, other_weed, scale, (255, 150, 40), 1)
    draw_contours(d, sel, scale, (255, 230, 0), 2)
    c_arr = semantic_rgb(sem_w)
    c_arr[sel] = (255, 0, 255)
    c = Image.fromarray(c_arr).resize(size, Image.NEAREST)

    cell = Image.new("RGB", (3 * CELL + 4 * PAD, CELL + CAP_H + 2 * PAD), (24, 24, 24))
    for k, im in enumerate((a, b, c)):
        cell.paste(im, (PAD + k * (CELL + PAD), PAD))
    dd = ImageDraw.Draw(cell)
    for k, line in enumerate(text_lines):
        dd.text((PAD, CELL + PAD + 4 + 13 * k), line, fill=(235, 235, 235))
    dd.text((PAD + 2 * (CELL + PAD), CELL + PAD + 4 + 13 * 5), f"window {wx1 - wx0}px, scale x{scale:.2f}", fill=(160, 160, 160))
    return cell


def sheet(cells: list[Image.Image], cols: int, title: str) -> Image.Image:
    if not cells:
        return Image.new("RGB", (400, 60), (24, 24, 24))
    cw, ch = cells[0].size
    rows = (len(cells) + cols - 1) // cols
    out = Image.new("RGB", (cols * cw, 28 + rows * ch), (24, 24, 24))
    ImageDraw.Draw(out).text((8, 8), title, fill=(255, 255, 255))
    for k, c in enumerate(cells):
        out.paste(c, ((k % cols) * cw, 28 + (k // cols) * ch))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--version", default="soil_only_v1")
    args = ap.parse_args(argv)
    try:
        root = resolve_dataset_root(args.root)
    except DatasetNotFound as e:
        print(e, file=sys.stderr)
        return 2
    sub = resolve_output_dir(args.out) / "subset" / args.version
    sel = json.loads((sub / "sheet_selection.json").read_text(encoding="utf-8"))
    with (sub / "instances_labelled.csv").open(newline="", encoding="utf-8") as fh:
        table = {(r["image"], int(r["instance_id"])): r for r in csv.DictReader(fh)}
    (sub / "sheets" / "cells").mkdir(parents=True, exist_ok=True)

    cache: dict[str, object] = {}

    def get_sample(name, split):
        if name not in cache:
            cache[name] = load_sample(root, split, name, kinds=("semantics", "plant_instances"))
        return cache[name]

    def cell_for(item):
        r = table[(item["image"], item["instance_id"])]
        for k in ("bbox_x0", "bbox_y0", "bbox_x1", "bbox_y1"):
            r[k] = int(r[k])
        s = get_sample(item["image"], r["split"])
        label = item["category"] if item["category"] else f"excluded: {item['exclusion']}"
        dcrop = r["dist_to_crop_px"] or "none"
        lines = [
            f"{item['image']}  id {item['instance_id']}  [{label}]  band {r['size_band']}  {r['date']} {r['plot']}",
            f"area {r['area_px']} px  span {float(r['max_span_px']):.1f}  obb {float(r['obb_length_px']):.1f} x {float(r['obb_width_px']):.1f}  solidity {r['solidity'] or 'n/a'}  pieces {r['n_components']}",
            f"dist crop {dcrop}  dist other plant {r['dist_to_other_plant_px']}{' (capped)' if r['other_plant_capped'] == 'True' else ''} ({r['nearest_other_kind'] or '-'})  touching [{r['touching_ids']}]",
            f"ring32 background {float(r['ring_background']):.2f} crop {float(r['ring_crop']):.2f} weed {float(r['ring_weed']):.2f}  border {r['border_dist_px']} px  partial {r['partial']}  D: {r['d_reasons'] or '-'}",
            f"shown because: {item['why_shown']}",
        ]
        c = render_cell(s, item["instance_id"], r, lines)
        c.save(sub / "sheets" / "cells" / f"{item['image'][:-4]}_{item['instance_id']}.png")
        return c

    ab = [cell_for(i) for i in sel["candidates"] if i["category"] in ("A", "B")]
    cd = [cell_for(i) for i in sel["candidates"] if i["category"] in ("C", "D")]
    rj = [cell_for(i) for i in sel["rejected"]]
    sheet(ab, 2, f"{args.version}: candidates, categories A and B ({len(ab)}). Panels: RGB | reference outlines (selected yellow, other weeds orange, crops cyan) | semantic with selected magenta").save(sub / "sheets" / "candidates_AB.png")
    sheet(cd, 2, f"{args.version}: candidates, categories C and D ({len(cd)})").save(sub / "sheets" / "candidates_CD.png")
    sheet(rj, 2, f"{args.version}: rejected or ambiguous ({len(rj)}), reason in the last caption line").save(sub / "sheets" / "rejected.png")
    print(f"wrote {sub / 'sheets'}: AB {len(ab)}, CD {len(cd)}, rejected {len(rj)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
