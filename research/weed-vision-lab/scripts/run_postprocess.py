"""Experiment 5 runner: post-process cached ERFNet probabilities and score, one named config at a time.

Inference input: the RGB image and the cached probabilities (no references).
Scoring: the frozen Phase 2 table and the reference masks, after the labels exist.

Splits: dev_sub (every sixth dev_tune image, 120 images, for exploration),
dev_tune, dev_check. The holdout is refused.

Writes <out>/postprocess/<config>/<split>/  (pred/, per_reference.csv, per_detection.csv,
per_image.csv, summary.json, summary.md) and copies summary.* to reports/postprocess/.
"""

from __future__ import annotations

import argparse
import csv
import ctypes
import json
import os
import platform
import sys
import time
from collections import Counter, defaultdict
from multiprocessing import Pool
from pathlib import Path
from types import SimpleNamespace

import _bootstrap  # noqa: F401
import numpy as np
from PIL import Image

from weedlab.config import DatasetNotFound, LAB_DIR, resolve_dataset_root, resolve_output_dir
from weedlab.eval.matching import score_image
from weedlab.eval.report import extend_summary, summarise, write_md
from weedlab.phenobench.instances import extract_plant_instances
from weedlab.phenobench.reader import load_sample, read_rgb
from weedlab.postprocess.cache import CACHE_VERSION, CacheSpec, load_prob, sha256_of
from weedlab.postprocess.pipeline import CONFIGS, run_config

DEFAULT_CKPT = "D:/swardus-research/checkpoints/phenobench-baselines/semantic-seg-erfnet.ckpt"
_TABLE: dict = {}
_ARGS: dict = {}


def peak_rss_mb() -> float | None:
    if os.name != "nt":
        return None

    class PMC(ctypes.Structure):
        _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong), ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t), ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaNonPagedPoolUsage", ctypes.c_size_t), ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]

    k = ctypes.windll.kernel32
    fn = getattr(k, "K32GetProcessMemoryInfo", None)
    if fn is None:
        return None
    fn.argtypes = [ctypes.c_void_p, ctypes.POINTER(PMC), ctypes.c_ulong]
    fn.restype = ctypes.c_int
    k.GetCurrentProcess.restype = ctypes.c_void_p
    pmc = PMC()
    pmc.cb = ctypes.sizeof(PMC)
    if fn(k.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb):
        return round(pmc.PeakWorkingSetSize / (1024 * 1024), 1)
    return None


def load_frozen_table(out_root: Path) -> dict[str, dict[int, dict]]:
    path = out_root / "subset" / "soil_only_v1" / "instances_labelled.csv"
    table: dict[str, dict[int, dict]] = defaultdict(dict)
    with path.open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            table[r["image"]][int(r["instance_id"])] = {"category": r["category"] or None, "exclusion": r["exclusion"] or None, "size_band": r["size_band"], "d_reasons": r.get("d_reasons", "")}
    return table


def _init(table, args):
    global _TABLE, _ARGS
    _TABLE, _ARGS = table, args


def work(job):
    split, name = job
    root = Path(_ARGS["root"])
    rgb = read_rgb(root / split / "images" / name)
    prob = load_prob(Path(_ARGS["cache_root"]) / split / name)
    res, sstats = run_config(_ARGS["config"], rgb, prob)
    Image.fromarray(res.labels.astype(np.uint16)).save(Path(_ARGS["pred_dir"]) / name)
    s = load_sample(root, split, name, kinds=("semantics", "plant_instances"))
    plants = extract_plant_instances(s.semantics, s.plant_instances)
    sc = score_image(res.labels, res.n, res.records, s.semantics, s.plant_instances, plants, _TABLE.get(name, {}), name)
    img = dict(sc.image)
    img.update({f"ms_{k}": v for k, v in res.timings_ms.items()})
    img.update({f"sep_{k}": v for k, v in sstats.items()})
    img["vegetation_fraction"] = round(res.vegetation_fraction, 4)
    img["peak_rss_mb"] = peak_rss_mb()
    return {"image": img, "references": sc.references, "detections": sc.detections}


def split_names(split: str) -> tuple[list[str], str]:
    splits = json.loads((LAB_DIR / "reports" / "subset" / "soil_only_v1" / "splits.json").read_text(encoding="utf-8"))
    if split == "dev_sub":
        return splits["images"]["dev_tune"][::6], "train"
    if split == "holdout":
        raise SystemExit("The holdout is reserved for the final method; not run here.")
    return splits["images"][split], "train"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--split", default="dev_sub", choices=["dev_sub", "dev_tune", "dev_check"])
    ap.add_argument("--configs", nargs="+", default=["A1_argmax"], help="config names from weedlab.postprocess.pipeline.CONFIGS, or 'all', or a prefix like A3")
    ap.add_argument("--ckpt", default=DEFAULT_CKPT)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    args = ap.parse_args(argv)
    try:
        root = resolve_dataset_root(args.root)
    except DatasetNotFound as e:
        print(e, file=sys.stderr)
        return 2
    out_root = resolve_output_dir(args.out)
    spec = CacheSpec(out_root / "cache" / CACHE_VERSION, sha256_of(Path(args.ckpt)))
    spec.check()
    table = load_frozen_table(out_root)
    names, ds_split = split_names(args.split)
    missing = [n for n in names if not spec.path_for(ds_split, n).exists()]
    if missing:
        print(f"{len(missing)} images of {args.split} are not cached yet (first: {missing[0]}); run scripts/cache_erfnet.py", file=sys.stderr)
        return 2
    cfg_names = []
    for c in args.configs:
        if c == "all":
            cfg_names += list(CONFIGS)
        elif c in CONFIGS:
            cfg_names.append(c)
        else:
            cfg_names += [k for k in CONFIGS if k.startswith(c)]
    cfg_names = list(dict.fromkeys(cfg_names))
    hw = {"cpu": platform.processor() or platform.machine(), "python": platform.python_version(), "os": platform.platform(), "workers": args.workers}
    for cfg in cfg_names:
        out = out_root / "postprocess" / cfg / args.split
        (out / "pred").mkdir(parents=True, exist_ok=True)
        wargs = {"root": str(root), "cache_root": str(spec.root), "config": cfg, "pred_dir": str(out / "pred")}
        t0 = time.perf_counter()
        images, refs, dets = [], [], []
        with Pool(args.workers, initializer=_init, initargs=(table, wargs)) as pool:
            for r in pool.imap(work, [(ds_split, n) for n in names], chunksize=4):
                images.append(r["image"])
                refs.extend(r["references"])
                dets.extend(r["detections"])
        wall = time.perf_counter() - t0
        ns = SimpleNamespace(method=cfg, closing=False)
        summary = summarise(images, refs, dets, cfg, args.split, ns, hw)
        summary["config"] = CONFIGS[cfg]
        summary["cache"] = {"version": CACHE_VERSION, "checkpoint_sha256": spec.checkpoint_sha256[:16]}
        summary["in_sample"] = True
        summary["wall_seconds_parallel"] = round(wall, 1)
        stage = {k: {"median": round(float(np.median([im[k] for im in images])), 2), "p95": round(float(np.percentile([im[k] for im in images], 95)), 2)} for k in images[0] if k.startswith("ms_")}
        sep = {k: int(sum(im[k] for im in images)) for k in images[0] if k.startswith("sep_")}
        summary["separation_stats"] = sep
        rss = [im["peak_rss_mb"] for im in images if im.get("peak_rss_mb")]
        summary = extend_summary(summary, refs, dets, images, stage_ms=stage, peak_rss_mb=max(rss) if rss else None)
        summary["timing_single_process"] = {"note": "post-processing only; ERFNet inference is cached (see cache manifest for its cost)", "cold_first_image": {}, "steady_state": {k: v for k, v in stage.items()}}
        for fname, rows in (("per_reference.csv", refs), ("per_detection.csv", dets), ("per_image.csv", images)):
            if rows:
                with (out / fname).open("w", newline="", encoding="utf-8") as fh:
                    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
                    w.writeheader()
                    w.writerows(rows)
        (out / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
        worst = {}
        write_md(summary, out / "summary.md", summary["timing_single_process"], worst)
        rep = LAB_DIR / "reports" / "postprocess" / cfg / args.split
        rep.mkdir(parents=True, exist_ok=True)
        for f in ("summary.json", "summary.md"):
            (rep / f).write_bytes((out / f).read_bytes())
        v = summary["by_iou_threshold"]["0.5"]
        q = summary["quality"]["AB"]
        print(f"{cfg:28s} {args.split}: A {v['recall_by_category']['A']['recall']} B {v['recall_by_category']['B']['recall']} AB@0.3 {summary['by_iou_threshold']['0.3']['recall_primary_AB']} | "
              f"P25 {summary['by_detection_size_floor_scoring_only']['25']['0.5']['raw']['precision']:.3f} FPbg25 {summary['by_detection_size_floor_scoring_only']['25']['0.5']['fp_background_per_image']} | "
              f"AB IoU med {q['iou_median']} p10 {q['iou_p10']} bF1 {q['boundary_f1_median']} pixP {q['pixel_precision']} pixR {q['pixel_recall']} | "
              f"splitA {summary['separation']['false_split_rate_A_single_isolated']} mergeD {summary['separation']['merge_with_weed_rate_D_touching_unambiguous']} | ms {stage['ms_total']['median']} | {wall:.0f}s", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
