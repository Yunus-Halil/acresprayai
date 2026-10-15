"""Resolution ladder: the frozen pipeline at 1, 1/2, 1/3, 1/4 and 1/8 of native resolution.

For each scale s:
  image      -> area-averaged downsample to (round8(1024*s)) px (ERFNet needs multiples of 8;
                1/3 becomes 344 px, s_eff = 0.336, recorded)
  semantics  -> per-class area fraction (anti-aliased resize of one-hot), argmax
  instances  -> each reference instance's mask resized as a float, kept where coverage >= 0.5;
                instances with no surviving pixel are "vanished" and still count as misses
  inference  -> ERFNet at the scaled size, then argmax / erode-1 / components (no size floor)
  scoring A  -> in the scaled space against the scaled references
  scoring B  -> labels upsampled (nearest) to native, against the native references
Categories and size bands stay the frozen native ones. Inference time per image is recorded per scale.

Writes <out>/ladder/<split>/<scale>/<config>/{summary.json, summary_native.json, per_reference*.csv}
and reports/ladder/ladder_<split>.md with the comparison table. In-sample for ERFNet.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from collections import defaultdict
from multiprocessing import Pool
from pathlib import Path
from types import SimpleNamespace

import _bootstrap  # noqa: F401
import numpy as np
from skimage.transform import resize

from weedlab.config import DatasetNotFound, LAB_DIR, resolve_dataset_root, resolve_output_dir
from weedlab.eval.matching import score_image
from weedlab.eval.report import extend_summary, summarise
from weedlab.phenobench.instances import extract_plant_instances
from weedlab.phenobench.reader import load_sample
from weedlab.postprocess.pipeline import run_config

DEFAULT_CKPT = "D:/swardus-research/checkpoints/phenobench-baselines/semantic-seg-erfnet.ckpt"
SCALES = {"1": 1.0, "1_2": 0.5, "1_3": 1.0 / 3.0, "1_4": 0.25, "1_8": 0.125}
CONFIGS = ("A1_argmax", "S3_erode_1")
_MODEL = None
_ARGS: dict = {}
_TABLE: dict = {}


def round8(x: float) -> int:
    return max(8, int(round(x / 8.0)) * 8)


def downsample_image(rgb: np.ndarray, size: int) -> np.ndarray:
    out = resize(rgb, (size, size, 3), order=1, anti_aliasing=True, preserve_range=True)
    return np.clip(np.rint(out), 0, 255).astype(np.uint8)


def downsample_semantics(sem: np.ndarray, size: int) -> np.ndarray:
    cls = np.unique(sem)
    stack = np.stack([resize((sem == c).astype(np.float32), (size, size), order=1, anti_aliasing=True, preserve_range=True) for c in cls], 0)
    return cls[np.argmax(stack, 0)].astype(sem.dtype)


def downsample_instances(inst: np.ndarray, size: int) -> tuple[np.ndarray, list[int]]:
    """Each instance by coverage >= 0.5 (ties resolved by the larger coverage). Returns (mask, vanished ids)."""
    ids = [int(i) for i in np.unique(inst) if i != 0]
    out = np.zeros((size, size), inst.dtype)
    best = np.zeros((size, size), np.float32)
    vanished = []
    for i in ids:
        cov = resize((inst == i).astype(np.float32), (size, size), order=1, anti_aliasing=True, preserve_range=True)
        keep = (cov >= 0.5) & (cov > best)
        if not keep.any():
            vanished.append(i)
            continue
        out[keep] = i
        best[keep] = cov[keep]
    return out, vanished


def upsample_labels(labels: np.ndarray, size: int) -> np.ndarray:
    return resize(labels, (size, size), order=0, anti_aliasing=False, preserve_range=True).astype(np.int32)


def _init(table, args):
    global _MODEL, _ARGS, _TABLE
    import torch
    from weedlab.detect.erfnet import load_model

    _ARGS, _TABLE = args, table
    torch.set_num_threads(int(args["threads"]))
    _MODEL = load_model(Path(args["ckpt"]))


def work(job):
    import torch
    from weedlab.detect.erfnet import preprocess

    split, name, scale_key = job
    s = SCALES[scale_key]
    root = Path(_ARGS["root"])
    smp = load_sample(root, split, name, kinds=("semantics", "plant_instances"))
    native = smp.image.shape[0]
    size = native if s == 1.0 else round8(native * s)
    t0 = time.perf_counter()
    rgb = smp.image if size == native else downsample_image(smp.image, size)
    t_down = (time.perf_counter() - t0) * 1000.0
    t1 = time.perf_counter()
    with torch.no_grad():
        prob = torch.softmax(_MODEL(preprocess(rgb)), dim=1)[0].numpy()
    t_inf = (time.perf_counter() - t1) * 1000.0
    if size == native:
        sem_s, inst_s, vanished = smp.semantics, smp.plant_instances, []
    else:
        sem_s = downsample_semantics(smp.semantics, size)
        inst_s, vanished = downsample_instances(smp.plant_instances, size)
    plants_s = extract_plant_instances(sem_s, inst_s)
    plants_n = extract_plant_instances(smp.semantics, smp.plant_instances)
    table = _TABLE.get(name, {})
    out = {}
    for cfg in CONFIGS:
        res, _ = run_config(cfg, rgb, prob)
        sc_s = score_image(res.labels, res.n, res.records, sem_s, inst_s, plants_s, table, name)
        if size == native:
            sc_n = sc_s
        else:
            lab_n = upsample_labels(res.labels, native)
            n_n = int(lab_n.max())
            recs_n = [{"det_id": k, "score": 0.0} for k in range(1, n_n + 1)]
            sc_n = score_image(lab_n, n_n, recs_n, smp.semantics, smp.plant_instances, plants_n, table, name)
        img = dict(sc_s.image)
        img.update({"ms_downsample": round(t_down, 2), "ms_erfnet": round(t_inf, 2), "ms_total": round(t_inf + res.timings_ms["total"], 2), **{f"ms_{k}": v for k, v in res.timings_ms.items() if k != "total"}})
        img["processing_px"] = size
        img["n_vanished"] = len(vanished)
        van = [{"image": name, "instance_id": i, **{k: v for k, v in table.get(i, {}).items()}} for i in vanished if table.get(i, {}).get("category") or table.get(i, {}).get("exclusion")]
        out[cfg] = {"image": img, "references": sc_s.references, "detections": sc_s.detections, "references_native": sc_n.references, "detections_native": sc_n.detections, "image_native": sc_n.image, "vanished": van}
    return out


def load_table(out_root: Path) -> dict:
    table = defaultdict(dict)
    with (out_root / "subset" / "soil_only_v1" / "instances_labelled.csv").open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            table[r["image"]][int(r["instance_id"])] = {"category": r["category"] or None, "exclusion": r["exclusion"] or None, "size_band": r["size_band"], "d_reasons": r.get("d_reasons", "")}
    return table


def write_rows(path: Path, rows: list[dict]) -> None:
    if rows:
        with path.open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--splits", nargs="+", default=["dev_tune"])
    ap.add_argument("--scales", nargs="+", default=list(SCALES))
    ap.add_argument("--ckpt", default=DEFAULT_CKPT)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--threads", type=int, default=3)
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args(argv)
    try:
        root = resolve_dataset_root(args.root)
    except DatasetNotFound as e:
        print(e, file=sys.stderr)
        return 2
    out_root = resolve_output_dir(args.out)
    table = load_table(out_root)
    splits = json.loads((LAB_DIR / "reports" / "subset" / "soil_only_v1" / "splits.json").read_text(encoding="utf-8"))
    hw = {"cpu": "AMD Ryzen 5 9600X", "workers": args.workers, "threads_per_worker": args.threads}
    for split in args.splits:
        names = splits["images"][split][: args.limit] if args.limit else splits["images"][split]
        ds = "val" if split == "holdout" else "train"
        rows_md = []
        for scale_key in args.scales:
            jobs = [(ds, n, scale_key) for n in names]
            t0 = time.perf_counter()
            acc = {cfg: {"images": [], "refs": [], "dets": [], "refs_n": [], "dets_n": [], "images_n": [], "vanished": []} for cfg in CONFIGS}
            with Pool(args.workers, initializer=_init, initargs=(table, {"root": str(root), "ckpt": args.ckpt, "threads": args.threads})) as pool:
                for k, r in enumerate(pool.imap(work, jobs, chunksize=4), 1):
                    for cfg in CONFIGS:
                        a = acc[cfg]
                        a["images"].append(r[cfg]["image"]); a["refs"].extend(r[cfg]["references"]); a["dets"].extend(r[cfg]["detections"])
                        a["refs_n"].extend(r[cfg]["references_native"]); a["dets_n"].extend(r[cfg]["detections_native"]); a["images_n"].append(r[cfg]["image_native"]); a["vanished"].extend(r[cfg]["vanished"])
                    if k % 100 == 0 or k == len(jobs):
                        print(f"  {split} scale {scale_key}: {k}/{len(jobs)} {time.perf_counter() - t0:.0f}s", flush=True)
            for cfg in CONFIGS:
                a = acc[cfg]
                out = out_root / "ladder" / split / scale_key / cfg
                out.mkdir(parents=True, exist_ok=True)
                ns = SimpleNamespace(method=cfg, closing=False)
                summ = summarise(a["images"], a["refs"], a["dets"], f"{cfg}@{scale_key}", split, ns, hw)
                stage = {k: {"median": round(float(np.median([im[k] for im in a["images"]])), 2), "p95": round(float(np.percentile([im[k] for im in a["images"]], 95)), 2)} for k in a["images"][0] if k.startswith("ms_")}
                summ = extend_summary(summ, a["refs"], a["dets"], a["images"], stage_ms=stage)
                summ["scale"] = {"key": scale_key, "nominal": SCALES[scale_key], "processing_px": a["images"][0]["processing_px"], "effective": a["images"][0]["processing_px"] / 1024.0}
                summ["vanished_references"] = {"n": len(a["vanished"]), "by_category": dict(defaultdict(int, {c: sum(1 for v in a["vanished"] if v.get("category") == c) for c in ("A", "B", "C", "D")})), "by_band": {b: sum(1 for v in a["vanished"] if v.get("size_band") == b) for b in ("tiny", "small", "medium", "large")}}
                summ["in_sample"] = True
                # Native-space scoring (what the integration outputs): recall denominators include vanished references automatically because the native references are all present.
                for im in a["images_n"]:
                    im.setdefault("ms_total", 0.0)
                summ_n = summarise(a["images_n"], a["refs_n"], a["dets_n"], f"{cfg}@{scale_key}->native", split, ns, hw)
                summ_n = extend_summary(summ_n, a["refs_n"], a["dets_n"], a["images_n"])
                (out / "summary.json").write_text(json.dumps(summ, indent=1), encoding="utf-8")
                (out / "summary_native.json").write_text(json.dumps(summ_n, indent=1), encoding="utf-8")
                write_rows(out / "per_reference.csv", a["refs"]); write_rows(out / "per_reference_native.csv", a["refs_n"]); write_rows(out / "per_image.csv", a["images"]); write_rows(out / "vanished.csv", a["vanished"])
                v = summ["by_iou_threshold"]["0.5"]; vn = summ_n["by_iou_threshold"]["0.5"]; q = summ["quality"]["AB"]; qn = summ_n["quality"]["AB"]
                f25 = summ["by_detection_size_floor_scoring_only"]["25"]["0.5"]
                rows_md.append({"scale": scale_key, "px": summ["scale"]["processing_px"], "cfg": cfg,
                                "A": v["recall_by_category"]["A"]["recall"], "B": v["recall_by_category"]["B"]["recall"], "C": v["recall_by_category"]["C"]["recall"], "D": v["recall_by_category"]["D"]["recall"],
                                "tiny": v["recall_by_band"]["tiny"]["recall"], "small": v["recall_by_band"]["small"]["recall"], "medium": v["recall_by_band"]["medium"]["recall"],
                                "AB@0.3": summ["by_iou_threshold"]["0.3"]["recall_primary_AB"], "iou": q["iou_median"], "iou_p10": q["iou_p10"], "bf1": q["boundary_f1_median"], "pixP": q["pixel_precision"], "pixR": q["pixel_recall"],
                                "fp_bg25": f25["fp_background_per_image"], "fp_crop25": f25["fp_crop_per_image"], "splitA": summ["separation"]["false_split_rate_A_single_isolated"], "vanished": len(a["vanished"]),
                                "nat_A": vn["recall_by_category"]["A"]["recall"], "nat_small": vn["recall_by_band"]["small"]["recall"], "nat_tiny": vn["recall_by_band"]["tiny"]["recall"], "nat_iou": qn["iou_median"], "nat_bf1": qn["boundary_f1_median"],
                                "ms_erfnet": stage["ms_erfnet"]["median"], "ms_total": stage["ms_total"]["median"]})
        rep = LAB_DIR / "reports" / "ladder"
        rep.mkdir(parents=True, exist_ok=True)
        L = [f"# Resolution ladder on `{split}` ({len(names)} images; in-sample for ERFNet)", "",
             "Scaled-space columns score at the processing resolution against references downsampled the same way (instances kept where coverage >= 0.5; vanished references count as misses in the native columns and are listed separately). Native columns score the labels upsampled to 1024 px against the untouched references. Runtime per image in a worker with 3 threads.", "",
             "| scale | px | config | A | B | C | D | tiny | small | medium | A+B@0.3 | IoU med | IoU p10 | bF1 | pixel P | pixel R | FP bg/img | FP crop/img | false split A | vanished refs | native: A | small | tiny | IoU | bF1 | ERFNet ms | total ms |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
        for r in rows_md:
            L.append("| " + " | ".join(str(r[k]) for k in ("scale", "px", "cfg", "A", "B", "C", "D", "tiny", "small", "medium", "AB@0.3", "iou", "iou_p10", "bf1", "pixP", "pixR", "fp_bg25", "fp_crop25", "splitA", "vanished", "nat_A", "nat_small", "nat_tiny", "nat_iou", "nat_bf1", "ms_erfnet", "ms_total")) + " |")
        (rep / f"ladder_{split}.md").write_text("\n".join(L), encoding="utf-8")
        (rep / f"ladder_{split}.json").write_text(json.dumps(rows_md, indent=1), encoding="utf-8")
        print("\n".join(L))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
