"""Phase 3: run a classical detector over an evaluation split and score it against the references.

Inference sees only the RGB image. Scoring sees the references and the frozen
Phase 2 table (categories, size bands). The two never meet inside a worker
before the detection is finished.

Writes <out>/baseline/<run>/<split>/ where run = <method>[_closing]:
  pred/<image>.png          predicted component labels, uint16 (for later tools and panels)
  per_reference.csv         one row per reference weed instance
  per_detection.csv         one row per predicted component
  per_image.csv             counts, vegetation pixel IoU, stage timings
  summary.json / summary.md the metrics by threshold, category, size band, and the failure counts
  panels/<image>.png        Original | Reference | Prediction | Error overlay for the selected images
  index.html                a static page listing the worst images first
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import platform
import random
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from multiprocessing import Pool
from pathlib import Path

import _bootstrap  # noqa: F401
import numpy as np
from PIL import Image

from weedlab import LAB_VERSION
from weedlab.config import DatasetNotFound, LAB_DIR, resolve_dataset_root, resolve_output_dir
from weedlab.detect.classical import DEFAULT_EXG_T, DEFAULT_HYST, METHODS, detect

ERFNET_METHODS = ("erfnet_weed", "erfnet_veg")
ALL_METHODS = METHODS + ERFNET_METHODS
DEFAULT_CKPT = "D:/swardus-research/checkpoints/phenobench-baselines/semantic-seg-erfnet.ckpt"
from weedlab.eval.matching import IOU_THRESHOLDS, score_image
from weedlab.eval.report import BANDS, CATEGORIES, EXCLUSIONS, SUBSET, prf, summarise, write_md
from weedlab.phenobench.instances import extract_plant_instances
from weedlab.phenobench.reader import load_sample, read_rgb
from weedlab.viz.compare import render_comparison



def load_frozen_table(out_root: Path) -> dict[str, dict[int, dict]]:
    path = out_root / "subset" / SUBSET / "instances_labelled.csv"
    if not path.exists():
        raise FileNotFoundError(f"{path} missing; run build_soil_subset.py first")
    table: dict[str, dict[int, dict]] = defaultdict(dict)
    with path.open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            table[r["image"]][int(r["instance_id"])] = {
                "category": r["category"] or None,
                "exclusion": r["exclusion"] or None,
                "size_band": r["size_band"],
                "split": r["split"],
            }
    return table


_TABLE: dict | None = None
_ARGS: dict = {}
_MODEL = None


def _init(table, args):
    global _TABLE, _ARGS, _MODEL
    _TABLE, _ARGS = table, args
    if args["method"] in ERFNET_METHODS:
        import torch
        from weedlab.detect.erfnet import load_model

        torch.set_num_threads(max(1, int(args["torch_threads"])))
        _MODEL = load_model(Path(args["ckpt"]))


def run_detector(rgb):
    """Inference entry point shared by the workers and the timing run. RGB in, labels out."""
    if _ARGS["method"] in ERFNET_METHODS:
        from weedlab.detect.erfnet import detect_erfnet

        res, cls = detect_erfnet(_MODEL, rgb, variant=_ARGS["method"])
        return res, cls
    return detect(rgb, method=_ARGS["method"], closing=_ARGS["closing"], exg_t=_ARGS["exg_t"], hyst=tuple(_ARGS["hyst"])), None


def work(job: tuple[str, str]) -> dict:
    split, name = job
    root = Path(_ARGS["root"])
    # Inference: RGB only.
    rgb = read_rgb(root / split / "images" / name)
    res, cls = run_detector(rgb)
    Image.fromarray(res.labels.astype(np.uint16)).save(Path(_ARGS["pred_dir"]) / name)
    if cls is not None:
        Image.fromarray(cls.astype(np.uint8), mode="L").save(Path(_ARGS["pred_dir"]).parent / "pred_semantics" / name)
    # Scoring: references enter here.
    s = load_sample(root, split, name, kinds=("semantics", "plant_instances"))
    plants = extract_plant_instances(s.semantics, s.plant_instances)
    sc = score_image(res.labels, res.n, res.records, s.semantics, s.plant_instances, plants, _TABLE.get(name, {}), name)
    img = dict(sc.image)
    img.update({f"ms_{k}": v for k, v in res.timings_ms.items()})
    img["vegetation_fraction"] = round(res.vegetation_fraction, 4)
    img["threshold"] = res.threshold
    return {"image": img, "references": sc.references, "detections": sc.detections}


def timing_run(root: Path, split: str, names: list[str], table, wargs, n: int = 40) -> dict:
    """Single process, sequential: cold first image (includes model load for ERFNet), then steady state over the next n."""
    rows = []
    t_load = time.perf_counter()
    _init(table, dict(wargs, torch_threads=wargs.get("timing_threads", wargs.get("torch_threads", 1))))
    load_ms = (time.perf_counter() - t_load) * 1000.0
    for k, name in enumerate(names[: n + 1]):
        rgb = read_rgb(root / split / "images" / name)
        t0 = time.perf_counter()
        res, _ = run_detector(rgb)
        rows.append({"cold": k == 0, "total_ms": (time.perf_counter() - t0) * 1000.0, **{f"{s}_ms": v for s, v in res.timings_ms.items()}})
    steady = [r for r in rows if not r["cold"]]
    stages = [k for k in rows[0] if k.endswith("_ms")]
    return {
        "n_steady": len(steady),
        "cold_first_image": {k: round(rows[0][k], 2) for k in stages},
        "steady_state": {k: {"median": round(float(np.median([r[k] for r in steady])), 2), "p95": round(float(np.percentile([r[k] for r in steady], 95)), 2)} for k in stages},
        "note": "single process, sequential, perf_counter; image decode excluded; native 1024 x 1024",
        "model_load_ms": round(load_ms, 1),
        "torch_threads": wargs.get("timing_threads"),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--split", default="dev_tune", choices=["dev_tune", "dev_check", "holdout", "smoke"])
    ap.add_argument("--method", default="exg_exr", choices=ALL_METHODS)
    ap.add_argument("--hyst", type=float, nargs=2, default=list(DEFAULT_HYST), metavar=("HIGH", "LOW"), help="thresholds for exg_hyst; part of the run name")
    ap.add_argument("--ckpt", default=DEFAULT_CKPT, help="ERFNet checkpoint path (erfnet_* methods)")
    ap.add_argument("--torch-threads", type=int, default=None, help="threads per worker for ERFNet; default cpu_count // workers")
    ap.add_argument("--closing", action="store_true")
    ap.add_argument("--exg-t", type=float, default=DEFAULT_EXG_T, help="threshold for exg_fixed; part of the run name")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--panels", type=int, default=16, help="how many comparison panels to render")
    ap.add_argument("--seed", type=int, default=20261013)
    args = ap.parse_args(argv)
    if args.split == "holdout":
        print("The holdout is reserved for the final comparison. Pass --split holdout only with the founder's approval recorded in the report.", file=sys.stderr)
        return 3
    try:
        root = resolve_dataset_root(args.root)
    except DatasetNotFound as e:
        print(e, file=sys.stderr)
        return 2
    out_root = resolve_output_dir(args.out)
    table = load_frozen_table(out_root)
    splits = json.loads((LAB_DIR / "reports" / "subset" / SUBSET / "splits.json").read_text(encoding="utf-8"))
    if args.split == "smoke":
        cfg = json.loads((LAB_DIR / "configs" / "smoke10.json").read_text(encoding="utf-8"))
        names, ds_split = [e["name"] for e in cfg["images"]], "train"
    else:
        names = splits["images"][args.split]
        ds_split = "val" if args.split == "holdout" else "train"
    if args.limit:
        names = names[: args.limit]
    run = args.method + (f"_t{args.exg_t:.2f}" if args.method == "exg_fixed" else "") + (f"_h{args.hyst[0]:.2f}_l{args.hyst[1]:.2f}" if args.method == "exg_hyst" else "") + ("_closing" if args.closing else "")
    if args.method in ERFNET_METHODS:
        if not Path(args.ckpt).exists():
            print(f"checkpoint not found: {args.ckpt}", file=sys.stderr)
            return 2
        if args.workers == max(1, (os.cpu_count() or 2) - 1):
            args.workers = 2  # two processes, three threads each on this six-core machine
    torch_threads = args.torch_threads or max(1, (os.cpu_count() or 2) // args.workers)
    out = out_root / "baseline" / run / args.split
    (out / "pred").mkdir(parents=True, exist_ok=True)
    (out / "pred_semantics").mkdir(parents=True, exist_ok=True)
    (out / "panels").mkdir(parents=True, exist_ok=True)
    hw = {"cpu": platform.processor() or platform.machine(), "python": platform.python_version(), "os": platform.platform(), "workers": args.workers, "torch_threads_per_worker": torch_threads if args.method in ERFNET_METHODS else None}

    wargs = {"root": str(root), "method": args.method, "closing": args.closing, "exg_t": args.exg_t, "hyst": list(args.hyst), "ckpt": args.ckpt, "torch_threads": torch_threads, "timing_threads": os.cpu_count() or 1, "pred_dir": str(out / "pred")}
    t0 = time.perf_counter()
    images, refs, dets = [], [], []
    with Pool(args.workers, initializer=_init, initargs=(table, wargs)) as pool:
        for k, r in enumerate(pool.imap(work, [(ds_split, n) for n in names], chunksize=4), 1):
            images.append(r["image"])
            refs.extend(r["references"])
            dets.extend(r["detections"])
            if k % 100 == 0 or k == len(names):
                print(f"  {k}/{len(names)}  {time.perf_counter() - t0:.0f}s", flush=True)
    wall = time.perf_counter() - t0
    timing = timing_run(root, ds_split, names, table, wargs)
    summary = summarise(images, refs, dets, run, args.split, args, hw)
    summary["wall_seconds_parallel"] = round(wall, 1)
    summary["timing_single_process"] = timing

    # Worst images, for the panels and the report.
    tau = "0.5"
    by_img_refs = defaultdict(list)
    for r in refs:
        by_img_refs[r["image"]].append(r)
    fn_ab = {n: sum(1 for r in rs if r["category"] in ("A", "B") and not r["matched@0.5"]) for n, rs in by_img_refs.items()}
    fp_bg = Counter(d["image"] for d in dets if not d["matched@0.5"] and d["fp_kind@0.5"] == "background")
    fp_crop = Counter(d["image"] for d in dets if not d["matched@0.5"] and d["fp_kind@0.5"] == "crop")
    merged = {n: sum(1 for r in rs if r["merged_with_weed"] or r["merged_with_crop"]) for n, rs in by_img_refs.items()}
    worst = {
        "most A/B misses at IoU 0.5": sorted(fn_ab.items(), key=lambda t: (-t[1], t[0]))[:4],
        "most background false positives": fp_bg.most_common(4),
        "most crop false positives": fp_crop.most_common(4),
        "most merged references": sorted(merged.items(), key=lambda t: (-t[1], t[0]))[:4],
    }
    summary["worst_images"] = {k: v for k, v in worst.items()}
    rng = random.Random(args.seed)
    chosen = []
    for items in worst.values():
        chosen += [n for n, _ in items]
    chosen += rng.sample(names, min(4, len(names)))
    chosen = list(dict.fromkeys(chosen))[: args.panels]
    for name in chosen:
        s = load_sample(root, ds_split, name, kinds=("semantics", "plant_instances"))
        pred = np.asarray(Image.open(out / "pred" / name)).astype(np.int32)
        render_comparison(s, pred, [r for r in refs if r["image"] == name], [d for d in dets if d["image"] == name], out / "panels" / name, title=f"{run} {args.split}")

    # Write tables.
    for fname, rows in (("per_reference.csv", refs), ("per_detection.csv", dets), ("per_image.csv", images)):
        if rows:
            with (out / fname).open("w", newline="", encoding="utf-8") as fh:
                w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
                w.writeheader()
                w.writerows(rows)
    (out / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    write_md(summary, out / "summary.md", timing, worst)
    html = ["<html><head><meta charset='utf-8'><title>" + run + " " + args.split + "</title><style>body{font-family:sans-serif;background:#111;color:#ddd}img{max-width:100%}</style></head><body>",
            f"<h1>{run} on {args.split}</h1><pre>{json.dumps(summary['by_iou_threshold']['0.5'], indent=1)}</pre>"]
    for name in chosen:
        html.append(f"<h3>{name}</h3><img src='panels/{name}'>")
    html.append("</body></html>")
    (out / "index.html").write_text("\n".join(html), encoding="utf-8")
    rep = LAB_DIR / "reports" / "baseline" / run / args.split
    rep.mkdir(parents=True, exist_ok=True)
    for f in ("summary.json", "summary.md"):
        (rep / f).write_bytes((out / f).read_bytes())
    v = summary["by_iou_threshold"]["0.5"]
    print(f"{run} {args.split}: IoU0.5 raw P {v['raw']['precision']:.3f} R {v['raw']['recall']:.3f} F1 {v['raw']['f1']:.3f} | crop-aware P {v['crop_aware']['precision']:.3f} | A recall {v['recall_by_category']['A']['recall']} B {v['recall_by_category']['B']['recall']} | wall {wall:.0f}s")
    print(f"wrote {out} and {rep}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
