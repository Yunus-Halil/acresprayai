"""Phase 2 profile: every weed instance in the labelled splits, with geometry and context.

Writes under <out>/profile/:
  weed_instances.csv / .json   one row per weed instance (train and val), all measurements
  images_phase2.csv             one row per image: counts, touching pairs, date, plot
  profile_meta.json             versions, definitions, timing

Nothing is sampled away: every image and every weed instance, including partial,
border-cut, one-pixel and dense-patch instances, is in the table. Category and
size-band assignment happen later (build_soil_subset.py) from this table, so the
thresholds can be changed without re-reading the dataset.

Definitions are in weedlab.phenobench.geometry and weedlab.phenobench.context.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from datetime import datetime, timezone
from multiprocessing import Pool
from pathlib import Path

import _bootstrap  # noqa: F401
import numpy as np

from weedlab import LAB_VERSION
from weedlab.config import DatasetNotFound, resolve_dataset_root, resolve_output_dir
from weedlab.phenobench.context import CONTEXT_PAD_PX, RING_PX, ImageContext
from weedlab.phenobench.geometry import measure_mask
from weedlab.phenobench.instances import extract_plant_instances
from weedlab.phenobench.reader import inventory_split, load_sample


def profile_one(args: tuple[str, str, str]) -> tuple[dict, list[dict]]:
    root_s, split, name = args
    root = Path(root_s)
    s = load_sample(root, split, name, kinds=("semantics", "plant_instances", "plant_visibility"))
    plants = extract_plant_instances(s.semantics, s.plant_instances, s.plant_visibility)
    ctx = ImageContext(s.semantics, s.plant_instances)
    weeds = [p for p in plants if p.kind == "weed"]
    rows = []
    touching_weed_pairs = set()
    n_weed_touching_crop = 0
    for p in weeds:
        mask = s.plant_instances == p.instance_id
        g = measure_mask(mask)
        c = ctx.measure(p.instance_id, p.bbox)
        for t in c.touching_ids:
            if t in {q.instance_id for q in weeds}:
                touching_weed_pairs.add(tuple(sorted((p.instance_id, t))))
        if c.touching_crop:
            n_weed_touching_crop += 1
        row = {
            "image": name,
            "split": split,
            "date": s.meta.date,
            "plot": s.meta.plot,
            "frame": s.meta.frame,
            "instance_id": p.instance_id,
            "partial": p.partial,
            "touches_border": p.touches_border,
            "visibility_mean": round(p.visibility_mean, 2) if p.visibility_mean is not None else None,
            "px_weed": p.pixels_by_class["weed"],
            "px_partial_weed": p.pixels_by_class["partial_weed"],
        }
        row.update({k: (round(v, 3) if isinstance(v, float) else v) for k, v in g.to_record().items()})
        row.update({k: (round(v, 3) if isinstance(v, float) else v) for k, v in c.to_record().items()})
        rows.append(row)
    crops = [p for p in plants if p.kind == "crop"]
    img = {
        "image": name,
        "split": split,
        "date": s.meta.date,
        "plot": s.meta.plot,
        "frame": s.meta.frame,
        "n_weed": len(weeds),
        "n_weed_full": sum(1 for p in weeds if not p.partial),
        "n_weed_partial": sum(1 for p in weeds if p.partial),
        "n_crop": len(crops),
        "n_crop_partial": sum(1 for p in crops if p.partial),
        "n_weed_touching_weed_pairs": len(touching_weed_pairs),
        "n_weed_touching_crop": n_weed_touching_crop,
        "weed_px": int(sum(p.area_px for p in weeds)),
        "crop_px": int(sum(p.area_px for p in crops)),
        "background_fraction": float(1.0 - (sum(p.area_px for p in plants) / s.semantics.size)),
    }
    return img, rows


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--splits", nargs="+", default=["train", "val"])
    ap.add_argument("--limit", type=int, default=None, help="first N images per split, for a quick run")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    args = ap.parse_args(argv)
    try:
        root = resolve_dataset_root(args.root)
    except DatasetNotFound as e:
        print(e, file=sys.stderr)
        return 2
    out = resolve_output_dir(args.out) / "profile"
    out.mkdir(parents=True, exist_ok=True)

    jobs = []
    for split in args.splits:
        inv = inventory_split(root, split)
        names = inv.names[: args.limit] if args.limit else inv.names
        jobs += [(str(root), split, n) for n in names]
    print(f"{len(jobs)} images, {args.workers} workers", flush=True)
    t0 = time.perf_counter()
    images, rows = [], []
    with Pool(args.workers) as pool:
        for k, (img, inst_rows) in enumerate(pool.imap(profile_one, jobs, chunksize=8), 1):
            images.append(img)
            rows.extend(inst_rows)
            if k % 200 == 0 or k == len(jobs):
                print(f"  {k}/{len(jobs)}  {time.perf_counter() - t0:.0f}s  weeds so far {len(rows)}", flush=True)
    seconds = time.perf_counter() - t0

    fields = list(rows[0].keys()) if rows else []
    with (out / "weed_instances.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    (out / "weed_instances.json").write_text(json.dumps(rows), encoding="utf-8")
    with (out / "images_phase2.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(images[0].keys()))
        w.writeheader()
        w.writerows(images)
    meta = {
        "lab_version": LAB_VERSION,
        "dataset": "PhenoBench v1.1.0",
        "dataset_root": str(root),
        "splits": args.splits,
        "n_images": len(images),
        "n_weed_instances": len(rows),
        "context_pad_px": CONTEXT_PAD_PX,
        "ring_px": RING_PX,
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seconds": round(seconds, 1),
        "workers": args.workers,
        "definitions": "weedlab.phenobench.geometry and weedlab.phenobench.context module docstrings",
    }
    (out / "profile_meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    print(f"wrote {out}: {len(images)} images, {len(rows)} weed instances in {seconds:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
