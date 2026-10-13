"""Milestone 3: read ten images with every annotation, validate, extract weed instances, render.

Writes under <out>/smoke10/:
  panels/<stem>.png        the seven panels A..G plus a stats panel, one file per image
  contact-sheet.png        one row per image: RGB | semantic | weed instances | weed outlines
  manifest.json            everything measured, per image and per instance
  instances.csv            one row per plant instance (weed and crop)
  summary.md               the table a person reads first

Two independent weed-instance counts are recorded per image and must agree:
  (a) this lab's extraction (majority semantic class over each instance's pixels)
  (b) the devkit's rule: unique instance ids under semantic pixels of class 2 or 4
A disagreement means an instance straddles crop and weed classes; it is reported, not resolved.
"""

from __future__ import annotations

import argparse
import csv
import json
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import _bootstrap  # noqa: F401
import numpy as np

from weedlab import LAB_VERSION
from weedlab.config import CONFIG_DIR, DatasetNotFound, resolve_dataset_root, resolve_output_dir
from weedlab.phenobench.instances import extract_plant_instances, weed_only_mask
from weedlab.phenobench.reader import WEED_CLASSES, load_sample, validate_sample
from weedlab.viz.panels import contact_sheet, instance_rgb, overlay_image, render_sample_panels, semantic_rgb


def devkit_weed_ids(sem: np.ndarray, inst: np.ndarray) -> list[int]:
    ids = np.unique(inst[np.isin(sem, WEED_CLASSES)])
    return [int(i) for i in ids if i != 0]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--config", default=str(CONFIG_DIR / "smoke10.json"))
    ap.add_argument("--dpi", type=int, default=110)
    args = ap.parse_args(argv)
    try:
        root = resolve_dataset_root(args.root)
    except DatasetNotFound as e:
        print(e, file=sys.stderr)
        return 2
    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    split = cfg["split"]
    out = resolve_output_dir(args.out) / "smoke10"
    (out / "panels").mkdir(parents=True, exist_ok=True)

    manifest_images = []
    instance_rows = []
    sheet_rows = []
    t_all = time.perf_counter()
    for entry in cfg["images"]:
        name = entry["name"]
        t0 = time.perf_counter()
        s = load_sample(root, split, name)
        t_load = time.perf_counter() - t0
        issues = validate_sample(s)
        inst = extract_plant_instances(s.semantics, s.plant_instances, s.plant_visibility, s.leaf_instances)
        weeds = [p for p in inst if p.kind == "weed"]
        crops = [p for p in inst if p.kind == "crop"]
        lab_ids = sorted(p.instance_id for p in weeds)
        dk_ids = devkit_weed_ids(s.semantics, s.plant_instances)
        # Purity: share of each weed instance's pixels that carry a weed-family class.
        purity = [
            (p.pixels_by_class["weed"] + p.pixels_by_class["partial_weed"]) / p.area_px for p in weeds
        ]
        t1 = time.perf_counter()
        stem = s.meta.stem
        render_sample_panels(s, inst, out / "panels" / f"{stem}.png", dpi=args.dpi)
        wmask = weed_only_mask(s.plant_instances, inst)
        sheet_rows.append(
            (
                f"{stem}  [{entry['category']}]  weeds {len(weeds)} crops {len(crops)}",
                [s.image, semantic_rgb(s.semantics), instance_rgb(wmask), overlay_image(s, inst)],
            )
        )
        t_render = time.perf_counter() - t1
        rec = {
            "name": name,
            "category": entry["category"],
            "selection_reason": entry["reason"],
            "date": s.meta.date,
            "plot": s.meta.plot,
            "frame": s.meta.frame,
            "shape": list(s.image.shape),
            "dtypes": {k: str(getattr(s, k).dtype) for k in ("semantics", "plant_instances", "leaf_instances", "plant_visibility", "leaf_visibility")},
            "semantic_values_present": [int(v) for v in np.unique(s.semantics)],
            "issues": [f"{i.severity}: {i.message}" for i in issues],
            "n_plant_instances": len(inst),
            "n_weed": len(weeds),
            "n_weed_full": sum(1 for p in weeds if not p.partial),
            "n_weed_partial": sum(1 for p in weeds if p.partial),
            "n_crop": len(crops),
            "n_crop_partial": sum(1 for p in crops if p.partial),
            "n_mixed": sum(1 for p in inst if p.mixed),
            "n_unlabelled": sum(1 for p in inst if p.kind == "unlabelled"),
            "n_leaf_instances": int(np.count_nonzero(np.unique(s.leaf_instances))),
            "weed_ids_lab": lab_ids,
            "weed_ids_devkit_rule": dk_ids,
            "weed_id_sets_agree": lab_ids == dk_ids,
            "weed_pixel_purity_min": min(purity) if purity else None,
            "weed_area_px": [p.area_px for p in weeds],
            "seconds_load": round(t_load, 4),
            "seconds_render": round(t_render, 3),
        }
        manifest_images.append(rec)
        for p in inst:
            r = p.to_record()
            r["image"] = name
            r["date"] = s.meta.date
            r["pixels_by_class"] = json.dumps(r["pixels_by_class"])
            r["bbox"] = json.dumps(r["bbox"])
            r["centroid_x"], r["centroid_y"] = r.pop("centroid")
            instance_rows.append(r)
        print(f"  {stem}: weeds {len(weeds)} (partial {rec['n_weed_partial']}) crops {len(crops)} "
              f"agree={rec['weed_id_sets_agree']} issues={len(issues)}", flush=True)

    contact_sheet(sheet_rows, out / "contact-sheet.png", cell=300,
                  header=["RGB", "semantic (crop green, weed red, partial lighter/orange)", "weed instances only", "weed outlines on RGB"])
    manifest = {
        "lab_version": LAB_VERSION,
        "dataset": "PhenoBench v1.1.0",
        "dataset_root": str(root),
        "split": split,
        "config": str(Path(args.config)),
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "python": platform.python_version(),
        "machine": platform.machine(),
        "seconds_total": round(time.perf_counter() - t_all, 2),
        "all_weed_id_sets_agree": all(r["weed_id_sets_agree"] for r in manifest_images),
        "any_errors": any(i.startswith("error") for r in manifest_images for i in r["issues"]),
        "images": manifest_images,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    if instance_rows:
        with (out / "instances.csv").open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(instance_rows[0].keys()))
            w.writeheader()
            w.writerows(instance_rows)
    lines = [
        "# Ten-image smoke test",
        "",
        f"PhenoBench v1.1.0, split `{split}`, {len(manifest_images)} images, generated {manifest['generated_utc']}.",
        "",
        "| image | category | date | weeds (partial) | crops (partial) | leaves | mixed | lab = devkit ids | min purity | issues |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in manifest_images:
        lines.append(
            f"| {r['name']} | {r['category']} | {r['date']} | {r['n_weed']} ({r['n_weed_partial']}) | {r['n_crop']} ({r['n_crop_partial']}) | "
            f"{r['n_leaf_instances']} | {r['n_mixed']} | {'yes' if r['weed_id_sets_agree'] else 'NO'} | "
            f"{r['weed_pixel_purity_min'] if r['weed_pixel_purity_min'] is None else round(r['weed_pixel_purity_min'], 3)} | "
            f"{'; '.join(r['issues']) or 'none'} |"
        )
    lines += ["", f"All weed id sets agree: {manifest['all_weed_id_sets_agree']}. Any format errors: {manifest['any_errors']}.", ""]
    (out / "summary.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
