"""Run every preview algorithm on a folder of images, render overlays, and score where a reference can be found.

    python scripts/run_testimagery.py --dir testimagery [--out <dir>]

1. Each image is matched by pixel content (SHA-1 of the RGB bytes) against the PhenoBench
   train, val and test images, so a renamed frame is recognised. A match in train or val
   brings its reference masks (scoring, in-sample for ERFNet if train); a match in test or
   no match means visual inspection only.
2. The five algorithms run in-process (model loaded once), native scale, 1024 / 128 tiling.
3. Per image: a contact row RGB | reference (if any) | one panel per algorithm, plus JSON results.
4. Per algorithm: counts, timings; and where references exist, the lab's detection, quality
   and separation metrics with the frozen categories when the image is in the labelled splits.

Writes <out>/testimagery/<run>/ : results/<image>.<algorithm>.json, panels/<image>.png,
summary.md, summary.json, matches.json.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
import time
from collections import defaultdict
from pathlib import Path
from types import SimpleNamespace

import _bootstrap  # noqa: F401
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from weedlab.config import DatasetNotFound, LAB_DIR, resolve_dataset_root, resolve_output_dir  # noqa: E402
from weedlab.eval.matching import score_image  # noqa: E402
from weedlab.eval.report import extend_summary, summarise  # noqa: E402
from weedlab.phenobench.instances import extract_plant_instances  # noqa: E402
from weedlab.phenobench.reader import load_sample, read_rgb  # noqa: E402
from weedlab.service.algorithms import ALGORITHMS, run_algorithm  # noqa: E402
from weedlab.service.instances import extract_instances  # noqa: E402
from weedlab.viz.compare import error_overlay  # noqa: E402
from weedlab.viz.panels import draw_outlines, instance_rgb  # noqa: E402

DEFAULT_CKPT = "D:/swardus-research/checkpoints/phenobench-baselines/semantic-seg-erfnet.ckpt"
ALGS = ["exg_fixed_0.08", "exg_hyst_0.10_0.03", "erfnet_argmax", "erfnet_erode1", "erfnet_erode1_watershed"]


def content_hash(rgb: np.ndarray) -> str:
    return hashlib.sha1(np.ascontiguousarray(rgb).tobytes()).hexdigest()


def dataset_index(root: Path, cache: Path) -> dict[str, tuple[str, str]]:
    """hash -> (split, name) over train, val and test; cached on disk."""
    if cache.exists():
        return {k: tuple(v) for k, v in json.loads(cache.read_text(encoding="utf-8")).items()}
    idx = {}
    for split in ("train", "val", "test"):
        for p in sorted((root / split / "images").iterdir()):
            idx[content_hash(read_rgb(p))] = (split, p.name)
        print(f"  indexed {split}", flush=True)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(idx), encoding="utf-8")
    return idx


def load_frozen_table(out_root: Path) -> dict[str, dict[int, dict]]:
    table: dict[str, dict[int, dict]] = defaultdict(dict)
    p = out_root / "subset" / "soil_only_v1" / "instances_labelled.csv"
    if not p.exists():
        return table
    with p.open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            table[r["image"]][int(r["instance_id"])] = {"category": r["category"] or None, "exclusion": r["exclusion"] or None, "size_band": r["size_band"], "d_reasons": r.get("d_reasons", "")}
    return table


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", default=str(LAB_DIR / "testimagery"))
    ap.add_argument("--root", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--ckpt", default=DEFAULT_CKPT)
    ap.add_argument("--threads", type=int, default=6)
    ap.add_argument("--algorithms", nargs="+", default=ALGS)
    args = ap.parse_args(argv)
    import torch

    from weedlab.detect.erfnet import load_model

    torch.set_num_threads(args.threads)
    try:
        root = resolve_dataset_root(args.root)
    except DatasetNotFound as e:
        print(e, file=sys.stderr)
        return 2
    out_root = resolve_output_dir(args.out)
    run_dir = out_root / "testimagery" / time.strftime("%Y%m%d-%H%M%S")
    (run_dir / "results").mkdir(parents=True)
    (run_dir / "panels").mkdir()
    files = sorted(p for p in Path(args.dir).iterdir() if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".tif", ".tiff"))
    print(f"{len(files)} images in {args.dir}", flush=True)
    print("indexing the dataset by content (first run takes about a minute)...", flush=True)
    idx = dataset_index(root, out_root / "cache" / "dataset_content_index.json")
    table = load_frozen_table(out_root)
    splits = json.loads((LAB_DIR / "reports" / "subset" / "soil_only_v1" / "splits.json").read_text(encoding="utf-8"))
    eval_split_of = {n: sp for sp, names in splits["images"].items() for n in names}
    model = load_model(Path(args.ckpt))

    matches = {}
    acc = {a: {"images": [], "refs": [], "dets": [], "counts": [], "ms": []} for a in args.algorithms}
    for f in files:
        rgb = np.asarray(Image.open(f).convert("RGB"), dtype=np.uint8)
        h = content_hash(rgb)
        m = idx.get(h)
        matches[f.name] = {"split": m[0], "name": m[1], "eval_split": eval_split_of.get(m[1], "test" if m[0] == "test" else None)} if m else None
        sample = load_sample(root, m[0], m[1], kinds=("semantics", "plant_instances")) if m and m[0] in ("train", "val") else None
        plants = extract_plant_instances(sample.semantics, sample.plant_instances) if sample else None
        panels = [("RGB", rgb)]
        if sample is not None:
            panels.append(("reference", None))
        per_alg = {}
        for a in args.algorithms:
            t0 = time.perf_counter()
            labels, score_img, info = run_algorithm(a, rgb, model, 1024, 128)
            ms = (time.perf_counter() - t0) * 1000.0
            inst, warns = extract_instances(labels, score_img, 1.0, score_name=info.get("score_kind", "score"))
            rec = {"image": f.name, "match": matches[f.name], "algorithm": a, "count": len(inst), "ms": round(ms, 1), "timings_ms": info["timings_ms"], "instances": inst, "warnings": warns,
                   "pixel_fractions": {"weed": info.get("weed_pixel_fraction"), "crop": info.get("crop_pixel_fraction")}}
            (run_dir / "results" / f"{f.stem}.{a}.json").write_text(json.dumps(rec), encoding="utf-8")
            acc[a]["counts"].append(len(inst)); acc[a]["ms"].append(ms)
            per_alg[a] = (labels, len(inst))
            if sample is not None:
                sc = score_image(labels, int(labels.max()), [{"det_id": k, "score": 0.0} for k in range(1, int(labels.max()) + 1)], sample.semantics, sample.plant_instances, plants, table.get(m[1], {}), m[1])
                img = dict(sc.image); img["ms_total"] = ms
                acc[a]["images"].append(img); acc[a]["refs"].extend(sc.references); acc[a]["dets"].extend(sc.detections)
        # Panel row.
        n = len(panels) + len(args.algorithms)
        fig, axes = plt.subplots(1, n, figsize=(5.2 * n, 5.6))
        axes = np.atleast_1d(axes)
        k = 0
        axes[k].imshow(rgb); axes[k].set_title(f"{f.name}\n{'= ' + m[0] + '/' + m[1] + (' (' + str(matches[f.name]['eval_split']) + ')' if matches[f.name] and matches[f.name]['eval_split'] else '') if m else 'no PhenoBench match'}", fontsize=9); k += 1
        if sample is not None:
            axes[k].imshow(rgb); draw_outlines(axes[k], sample.plant_instances, plants, label_ids=False)
            axes[k].set_title(f"reference: {sum(1 for p in plants if p.kind == 'weed')} weeds (yellow), crops cyan", fontsize=9); k += 1
        for a in args.algorithms:
            labels, cnt = per_alg[a]
            if sample is not None:
                axes[k].imshow(error_overlay(rgb, labels, sample.semantics))
                rs = [r for r in acc[a]["refs"] if r["image"] == m[1]]
                hit = sum(1 for r in rs if r["matched@0.5"]); title = f"{a}: {cnt} inst, {hit}/{len(rs)} refs at IoU 0.5"
            else:
                axes[k].imshow(instance_rgb(labels)); title = f"{a}: {cnt} instances"
            axes[k].set_title(title, fontsize=9); k += 1
        for ax in axes:
            ax.set_xticks([]); ax.set_yticks([])
        fig.tight_layout(); fig.savefig(run_dir / "panels" / f"{f.stem}.png", dpi=80); plt.close(fig)
        print(f"  {f.name}: {'match ' + m[0] + '/' + m[1] if m else 'no match'}  " + "  ".join(f"{a}={per_alg[a][1]}" for a in args.algorithms), flush=True)

    (run_dir / "matches.json").write_text(json.dumps(matches, indent=1), encoding="utf-8")
    n_lab = sum(1 for v in matches.values() if v and v["split"] in ("train", "val"))
    by_split = defaultdict(int)
    for v in matches.values():
        by_split[(v["split"] + "/" + str(v["eval_split"])) if v else "unmatched"] += 1
    L = [f"# Test imagery run: {len(files)} images from `{args.dir}`", "", f"Content matches against PhenoBench: {dict(by_split)}. Images from train are in-sample for ERFNet; val images are the holdout (reported here because you asked for these specific frames; this is not the planned one-shot holdout run of the final method).", "",
         "| algorithm | images | instances/img (median) | ms/img (median) |" + (" A | B | C | D | tiny | small | medium | A+B recall@0.5 | @0.3 | P raw | P floor25 | FP bg/img | FP crop/img | A+B IoU med | bF1 | merged w/ crop | false split A |" if n_lab else ""),
         "|---|---|---|---|" + ("---|" * 18 if n_lab else "")]
    summary = {"matches": matches, "algorithms": {}}
    for a in args.algorithms:
        row = f"| {a} | {len(files)} | {np.median(acc[a]['counts']):.0f} | {np.median(acc[a]['ms']):.0f} |"
        if n_lab and acc[a]["images"]:
            s = summarise(acc[a]["images"], acc[a]["refs"], acc[a]["dets"], a, "testimagery", SimpleNamespace(method=a, closing=False), {"cpu": "Ryzen 5 9600X"})
            s = extend_summary(s, acc[a]["refs"], acc[a]["dets"], acc[a]["images"])
            v = s["by_iou_threshold"]["0.5"]; f25 = s["by_detection_size_floor_scoring_only"]["25"]["0.5"]; rc = v["recall_by_category"]; rb = v["recall_by_band"]; q = s["quality"]["AB"]
            g = lambda d: "n/a" if d["recall"] is None else f"{d['recall']:.3f} ({d['n']})"
            row += f" {g(rc['A'])} | {g(rc['B'])} | {g(rc['C'])} | {g(rc['D'])} | {g(rb['tiny'])} | {g(rb['small'])} | {g(rb['medium'])} | {v['recall_primary_AB']} | {s['by_iou_threshold']['0.3']['recall_primary_AB']} | {v['raw']['precision']:.3f} | {f25['raw']['precision']:.3f} | {f25['fp_background_per_image']} | {f25['fp_crop_per_image']} | {q.get('iou_median')} | {q.get('boundary_f1_median')} | {s['found_merge_split']['all']['merged_with_crop']:.3f} | {s['separation']['false_split_rate_A_single_isolated']} |"
            summary["algorithms"][a] = {"detection": v, "floor25": f25, "quality_AB": q, "found_merge_split": s["found_merge_split"]["all"], "separation": s["separation"], "n_images_scored": len(acc[a]["images"])}
        L.append(row)
    L += ["", "Per-image panels: `panels/<image>.png` (RGB | reference | one error overlay per algorithm: green correct, magenta missed, cyan on crop, red on background; unmatched images show instance colours instead). Per-image JSON results: `results/`."]
    (run_dir / "summary.md").write_text("\n".join(L), encoding="utf-8")
    (run_dir / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    rep = LAB_DIR / "reports" / "testimagery"
    rep.mkdir(exist_ok=True)
    (rep / f"{run_dir.name}.md").write_text("\n".join(L), encoding="utf-8")
    print("\n".join(L)); print(f"\nwrote {run_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
