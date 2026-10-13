"""Per-image inventory of one labelled split: plants, weeds, sizes, dates, issues.

Writes <out>/profile/<split>.csv and <split>.json. Every image in the split is
included; nothing is sampled away. Used to choose the smoke images and, later,
to define the soil-only subset.

Isolation here is a cheap, reproducible geometric rule for selection purposes
only: a weed is "isolated" when its bounding box, grown by ISOLATION_MARGIN_PX
on every side, intersects no other plant's bounding box. The Phase-2 subset
definition will use pixel distances; this flag is for picking images to look at.
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
import time
from pathlib import Path

import _bootstrap  # noqa: F401
import numpy as np

from weedlab import LAB_VERSION
from weedlab.config import DatasetNotFound, resolve_dataset_root, resolve_output_dir
from weedlab.phenobench.instances import extract_plant_instances
from weedlab.phenobench.reader import inventory_split, load_sample, validate_sample

ISOLATION_MARGIN_PX = 32


def boxes_intersect(a, b) -> bool:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    return ax0 < bx1 and bx0 < ax1 and ay0 < by1 and by0 < ay1


def grow(box, m, w, h):
    x0, y0, x1, y1 = box
    return (max(0, x0 - m), max(0, y0 - m), min(w, x1 + m), min(h, y1 + m))


def profile_image(root: Path, split: str, name: str) -> dict:
    sample = load_sample(root, split, name)
    issues = validate_sample(sample)
    inst = extract_plant_instances(sample.semantics, sample.plant_instances, sample.plant_visibility, sample.leaf_instances)
    h, w = sample.semantics.shape
    weeds = [p for p in inst if p.kind == "weed"]
    crops = [p for p in inst if p.kind == "crop"]
    isolated = 0
    near_crop = 0
    for p in weeds:
        g = grow(p.bbox, ISOLATION_MARGIN_PX, w, h)
        others = [q for q in inst if q.instance_id != p.instance_id]
        if not any(boxes_intersect(g, q.bbox) for q in others):
            isolated += 1
        if any(boxes_intersect(g, q.bbox) for q in crops):
            near_crop += 1
    weed_areas = [p.area_px for p in weeds]
    crop_areas = [p.area_px for p in crops]
    return {
        "name": name,
        "split": split,
        "date": sample.meta.date,
        "plot": sample.meta.plot,
        "frame": sample.meta.frame,
        "n_plants": len(inst),
        "n_weed": len(weeds),
        "n_weed_full": sum(1 for p in weeds if not p.partial),
        "n_weed_partial": sum(1 for p in weeds if p.partial),
        "n_crop": len(crops),
        "n_crop_full": sum(1 for p in crops if not p.partial),
        "n_crop_partial": sum(1 for p in crops if p.partial),
        "n_unlabelled": sum(1 for p in inst if p.kind == "unlabelled"),
        "n_mixed": sum(1 for p in inst if p.mixed),
        "n_weed_border": sum(1 for p in weeds if p.touches_border),
        "n_weed_isolated": isolated,
        "n_weed_near_crop": near_crop,
        "weed_area_min": min(weed_areas) if weed_areas else None,
        "weed_area_median": statistics.median(weed_areas) if weed_areas else None,
        "weed_area_max": max(weed_areas) if weed_areas else None,
        "weed_area_total": sum(weed_areas),
        "crop_area_median": statistics.median(crop_areas) if crop_areas else None,
        "crop_area_total": sum(crop_areas),
        "weed_pixel_fraction": sum(weed_areas) / (h * w),
        "plant_pixel_fraction": (sum(weed_areas) + sum(crop_areas)) / (h * w),
        "n_leaves": int(np.count_nonzero(np.unique(sample.leaf_instances))),
        "n_issue_errors": sum(1 for i in issues if i.severity == "error"),
        "n_issue_warnings": sum(1 for i in issues if i.severity == "warning"),
        "issues": [f"{i.severity}: {i.message}" for i in issues],
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=None, help="PhenoBench root (overrides env and configs/local.json)")
    ap.add_argument("--out", default=None, help="output directory (overrides env and configs/local.json)")
    ap.add_argument("--split", default="train", choices=["train", "val"])
    ap.add_argument("--limit", type=int, default=None, help="profile only the first N images (for a quick look)")
    args = ap.parse_args(argv)
    try:
        root = resolve_dataset_root(args.root)
    except DatasetNotFound as e:
        print(e, file=sys.stderr)
        return 2
    out = resolve_output_dir(args.out) / "profile"
    out.mkdir(parents=True, exist_ok=True)
    inv = inventory_split(root, args.split)
    if not inv.complete:
        print(f"WARNING: split {args.split} has missing or extra annotation files; see the JSON", file=sys.stderr)
    names = inv.names[: args.limit] if args.limit else inv.names
    rows = []
    t0 = time.perf_counter()
    for k, name in enumerate(names, 1):
        rows.append(profile_image(root, args.split, name))
        if k % 100 == 0 or k == len(names):
            el = time.perf_counter() - t0
            print(f"  {k}/{len(names)}  {el:.0f}s elapsed", flush=True)
    payload = {
        "lab_version": LAB_VERSION,
        "dataset_root": str(root),
        "split": args.split,
        "n_images": len(rows),
        "isolation_margin_px": ISOLATION_MARGIN_PX,
        "inventory": {"missing": inv.missing, "extra": inv.extra},
        "seconds": round(time.perf_counter() - t0, 1),
        "images": rows,
    }
    (out / f"{args.split}.json").write_text(json.dumps(payload, indent=1), encoding="utf-8")
    fields = [k for k in rows[0].keys() if k != "issues"] if rows else []
    with (out / f"{args.split}.csv").open("w", newline="", encoding="utf-8") as fh:
        wtr = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        wtr.writeheader()
        wtr.writerows(rows)
    print(f"wrote {out / (args.split + '.json')} and .csv  ({len(rows)} images)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
