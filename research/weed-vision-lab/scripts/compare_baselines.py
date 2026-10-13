"""Collect every baseline run's summary.json for one split into a comparison table.

Reads  <out>/baseline/<run>/<split>/summary.json for every run
Writes reports/baseline/comparison_<split>.md and .json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import _bootstrap  # noqa: F401

from weedlab.config import LAB_DIR, resolve_output_dir


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=None)
    ap.add_argument("--split", default="dev_tune")
    args = ap.parse_args(argv)
    base = resolve_output_dir(args.out) / "baseline"
    runs = {}
    for p in sorted(base.glob(f"*/{args.split}/summary.json")):
        runs[p.parent.parent.name] = json.loads(p.read_text(encoding="utf-8"))
    if not runs:
        print("no runs found")
        return 2
    L = [f"# Classical baselines on `{args.split}`", "", f"{len(runs)} runs; every run saw the same {next(iter(runs.values()))['n_images']} images and {next(iter(runs.values()))['n_reference_weeds']} reference weed observations. IoU matching 0.5 unless stated.", ""]
    L.append("## Raw (every component down to 1 px counts) and with a 25 px scoring floor")
    L.append("")
    L.append("| run | dets/img | P raw | R | F1 raw | P crop-aware | F1 crop-aware | A+B recall | floor 25: P raw | R | F1 raw | P crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for name, s in runs.items():
        v = s["by_iou_threshold"]["0.5"]
        f = s["by_detection_size_floor_scoring_only"]["25"]["0.5"]
        L.append(f"| {name} | {s['detections_per_image']['median']} | {v['raw']['precision']:.3f} | {v['raw']['recall']:.3f} | {v['raw']['f1']:.3f} | {v['crop_aware']['precision']:.3f} | {v['crop_aware']['f1']:.3f} | {v['recall_primary_AB']} | "
                 f"{f['raw']['precision']:.3f} | {f['raw']['recall']:.3f} | {f['raw']['f1']:.3f} | {f['crop_aware']['precision']:.3f} | {f['crop_aware']['f1']:.3f} | {f['recall_primary_AB']} | {f['fp_background_per_image']} | {f['fp_crop_per_image']} |")
    L.append("")
    L.append("## Recall by category (IoU 0.5) and found rate (coverage 0.5)")
    L.append("")
    L.append("| run | A | B | C | D | tiny | small | medium | large | found A | found B | found small | merged w/ crop (all) | merged w/ weed (all) | split (all) |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for name, s in runs.items():
        v = s["by_iou_threshold"]["0.5"]
        fm = s["found_merge_split"]
        rc, rb = v["recall_by_category"], v["recall_by_band"]
        g = lambda d: "n/a" if d["recall"] is None else f"{d['recall']:.3f}"
        L.append(f"| {name} | {g(rc['A'])} | {g(rc['B'])} | {g(rc['C'])} | {g(rc['D'])} | {g(rb['tiny'])} | {g(rb['small'])} | {g(rb['medium'])} | {g(rb['large'])} | "
                 f"{fm['by_category']['A']['found']:.3f} | {fm['by_category']['B']['found']:.3f} | {fm['by_band']['small']['found']:.3f} | {fm['all']['merged_with_crop']:.3f} | {fm['all']['merged_with_weed']:.3f} | {fm['all']['split']:.3f} |")
    L.append("")
    L.append("## Vegetation pixels and runtime")
    L.append("")
    L.append("| run | veg IoU vs plants (median / p10) | plant pixel recall | pixel precision | steady total ms (median / p95) | cold first image ms | wall s (parallel) |")
    L.append("|---|---|---|---|---|---|---|")
    for name, s in runs.items():
        vp = s["vegetation_pixels"]
        t = s["timing_single_process"]
        L.append(f"| {name} | {vp['veg_iou_plants']['median']:.3f} / {vp['veg_iou_plants']['p10']:.3f} | {vp['veg_recall_plant_px']['median']:.3f} | {vp['veg_precision_px']['median']:.3f} | {t['steady_state']['total_ms']['median']} / {t['steady_state']['total_ms']['p95']} | {t['cold_first_image']['total_ms']} | {s['wall_seconds_parallel']} |")
    L.append("")
    rep = LAB_DIR / "reports" / "baseline"
    rep.mkdir(parents=True, exist_ok=True)
    (rep / f"comparison_{args.split}.md").write_text("\n".join(L), encoding="utf-8")
    slim = {n: {"iou0.5": s["by_iou_threshold"]["0.5"], "floor25": s["by_detection_size_floor_scoring_only"]["25"]["0.5"], "found_merge_split": s["found_merge_split"], "vegetation_pixels": s["vegetation_pixels"], "timing": s["timing_single_process"]} for n, s in runs.items()}
    (rep / f"comparison_{args.split}.json").write_text(json.dumps(slim, indent=1), encoding="utf-8")
    print("\n".join(L))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
