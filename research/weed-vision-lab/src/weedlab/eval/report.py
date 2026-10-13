"""Aggregation of per-image scores into a summary dict and a Markdown report. Shared by every runner."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from weedlab import LAB_VERSION
from weedlab.eval.matching import IOU_THRESHOLDS

SUBSET = "soil_only_v1"
CATEGORIES = ("A", "B", "C", "D")
EXCLUSIONS = ("partial", "touches_border", "tiny")
BANDS = ("tiny", "small", "medium", "large")


def prf(tp: int, fp: int, fn: int) -> dict:
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return {"tp": tp, "fp": fp, "fn": fn, "precision": round(p, 4), "recall": round(r, 4), "f1": round(f, 4)}


def summarise(images: list[dict], refs: list[dict], dets: list[dict], run: str, split: str, args, hw: dict) -> dict:
    n_img = len(images)
    out = {
        "lab_version": LAB_VERSION, "run": run, "method": getattr(args, "method", run), "closing": getattr(args, "closing", False), "exg_t": getattr(args, "exg_t", None) if getattr(args, "method", "") == "exg_fixed" else None, "hyst": list(args.hyst) if getattr(args, "method", "") == "exg_hyst" else None, "checkpoint": getattr(args, "ckpt", None) if str(getattr(args, "method", "")).startswith("erfnet") else None, "in_sample": str(getattr(args, "method", "")).startswith("erfnet"), "split": split,
        "subset_table": SUBSET, "n_images": n_img, "n_reference_weeds": len(refs), "n_detections": len(dets),
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"), "hardware": hw,
        "definitions": "weedlab.eval.matching docstring; detector in weedlab.detect.classical",
    }
    # Detection metrics per IoU threshold: raw (all unmatched detections are FP) and crop-aware
    # (unmatched detections whose majority pixels lie on reference crops are set aside, scoring only).
    per_tau = {}
    for tau in IOU_THRESHOLDS:
        tp = sum(1 for d in dets if d[f"matched@{tau}"])
        fp_kinds = Counter(d[f"fp_kind@{tau}"] for d in dets if not d[f"matched@{tau}"])
        fn = sum(1 for r in refs if not r[f"matched@{tau}"])
        fp = sum(fp_kinds.values())
        per_tau[str(tau)] = {
            "raw": prf(tp, fp, fn),
            "crop_aware": prf(tp, fp - fp_kinds["crop"], fn),
            "fp_by_pixel_kind": dict(fp_kinds),
            "fp_per_image": round(fp / max(1, n_img), 2),
            "fn_per_image": round(fn / max(1, n_img), 2),
            "fp_background_per_image": round(fp_kinds["background"] / max(1, n_img), 2),
            "fp_crop_per_image": round(fp_kinds["crop"] / max(1, n_img), 2),
            "recall_by_category": {},
            "recall_by_exclusion": {},
            "recall_by_band": {},
            "recall_primary_AB": None,
        }
        for cat in CATEGORIES:
            rs = [r for r in refs if r["category"] == cat]
            per_tau[str(tau)]["recall_by_category"][cat] = {"n": len(rs), "recall": round(sum(r[f"matched@{tau}"] for r in rs) / len(rs), 4) if rs else None}
        for ex in EXCLUSIONS:
            rs = [r for r in refs if r["exclusion"] == ex]
            per_tau[str(tau)]["recall_by_exclusion"][ex] = {"n": len(rs), "recall": round(sum(r[f"matched@{tau}"] for r in rs) / len(rs), 4) if rs else None}
        for b in BANDS:
            rs = [r for r in refs if r["size_band"] == b]
            per_tau[str(tau)]["recall_by_band"][b] = {"n": len(rs), "recall": round(sum(r[f"matched@{tau}"] for r in rs) / len(rs), 4) if rs else None}
        ab = [r for r in refs if r["category"] in ("A", "B")]
        per_tau[str(tau)]["recall_primary_AB"] = round(sum(r[f"matched@{tau}"] for r in ab) / len(ab), 4) if ab else None
    out["by_iou_threshold"] = per_tau

    # Scoring-time detection-size floors. The detector emits every component down to
    # one pixel (no inference-time filtering). This table says what happens when
    # detections under f px are set aside AT SCORING: precision over the kept
    # detections, recall counting only references matched by a kept detection.
    floors = {}
    for f in (1, 4, 10, 25, 50, 100):
        row = {}
        for tau in IOU_THRESHOLDS:
            kept = [d for d in dets if d["area_px"] >= f]
            tp = sum(1 for d in kept if d[f"matched@{tau}"])
            fp_kinds = Counter(d[f"fp_kind@{tau}"] for d in kept if not d[f"matched@{tau}"])
            fp = sum(fp_kinds.values())
            rec_all = sum(1 for r in refs if r[f"matched@{tau}"] and r[f"matched_det_area@{tau}"] >= f)
            ab = [r for r in refs if r["category"] in ("A", "B")]
            rec_ab = sum(1 for r in ab if r[f"matched@{tau}"] and r[f"matched_det_area@{tau}"] >= f)
            row[str(tau)] = {
                "n_kept": len(kept),
                "raw": prf(tp, fp, len(refs) - rec_all),
                "crop_aware": prf(tp, fp - fp_kinds["crop"], len(refs) - rec_all),
                "recall_primary_AB": round(rec_ab / len(ab), 4) if ab else None,
                "fp_background_per_image": round(fp_kinds["background"] / max(1, n_img), 2),
                "fp_crop_per_image": round(fp_kinds["crop"] / max(1, n_img), 2),
            }
        floors[str(f)] = row
    out["by_detection_size_floor_scoring_only"] = floors

    # Found (coverage >= 0.5), merge and split, by category and band.
    def found_stats(rs):
        n = len(rs)
        return {
            "n": n,
            "found": round(sum(r["found"] for r in rs) / n, 4) if n else None,
            "merged_with_weed": round(sum(1 for r in rs if r["merged_with_weed"] > 0) / n, 4) if n else None,
            "merged_with_crop": round(sum(1 for r in rs if r["merged_with_crop"] > 0) / n, 4) if n else None,
            "split": round(sum(1 for r in rs if r["split"]) / n, 4) if n else None,
            "median_best_iou": round(float(np.median([r["best_iou"] for r in rs])), 4) if n else None,
            "p10_best_iou": round(float(np.percentile([r["best_iou"] for r in rs], 10)), 4) if n else None,
        }

    out["found_merge_split"] = {
        "all": found_stats(refs),
        "by_category": {c: found_stats([r for r in refs if r["category"] == c]) for c in CATEGORIES},
        "by_exclusion": {e: found_stats([r for r in refs if r["exclusion"] == e]) for e in EXCLUSIONS},
        "by_band": {b: found_stats([r for r in refs if r["size_band"] == b]) for b in BANDS},
        "by_category_and_band": {c: {b: found_stats([r for r in refs if r["category"] == c and r["size_band"] == b]) for b in BANDS} for c in CATEGORIES},
    }
    # Weed count error per image.
    errs = [im["n_det"] - im["n_ref_weed"] for im in images]
    out["count_error"] = {"mean_signed": round(float(np.mean(errs)), 2), "median_abs": float(np.median(np.abs(errs))), "p90_abs": float(np.percentile(np.abs(errs), 90))}
    # Vegetation pixel diagnostics.
    out["vegetation_pixels"] = {k: {"median": round(float(np.median([im[k] for im in images])), 4), "p10": round(float(np.percentile([im[k] for im in images], 10)), 4)} for k in ("veg_iou_plants", "veg_iou_weeds", "veg_recall_plant_px", "veg_precision_px")}
    # Runtime from the workers (per image, wall time inside the worker; the first image per worker is cold).
    stages = [k for k in images[0] if k.startswith("ms_")]
    out["runtime_ms_per_image_in_workers"] = {k: {"median": round(float(np.median([im[k] for im in images])), 2), "p95": round(float(np.percentile([im[k] for im in images], 95)), 2), "max": round(float(np.max([im[k] for im in images])), 2)} for k in stages}
    out["detections_per_image"] = {"median": float(np.median([im["n_det"] for im in images])), "p95": float(np.percentile([im["n_det"] for im in images], 95)), "max": int(max(im["n_det"] for im in images))}
    out["reference_weeds_per_image"] = {"median": float(np.median([im["n_ref_weed"] for im in images]))}
    return out



def write_md(summary: dict, path: Path, timing: dict, worst: dict) -> None:
    L = [f"# Classical baseline `{summary['run']}` on `{summary['split']}`", ""]
    L.append(f"{summary['n_images']} images, {summary['n_reference_weeds']} reference weed observations, {summary['n_detections']} detections. "
             f"Generated {summary['generated_utc']}, lab {summary['lab_version']}. Hardware: {summary['hardware']['cpu']}, {summary['hardware']['python']}.")
    L.append("")
    L.append("Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.")
    L.append("")
    L.append("## Detection, one-to-one IoU matching, weeds only")
    L.append("")
    L.append("| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |")
    L.append("|---|---|---|---|---|---|---|---|---|---|")
    for tau, v in summary["by_iou_threshold"].items():
        L.append(f"| {tau} | {v['raw']['precision']:.3f} | {v['raw']['recall']:.3f} | {v['raw']['f1']:.3f} | {v['crop_aware']['precision']:.3f} | {v['crop_aware']['f1']:.3f} | {v['fp_per_image']} | {v['fn_per_image']} | {v['fp_background_per_image']} | {v['fp_crop_per_image']} |")
    L.append("")
    L.append("Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.")
    L.append("")
    L.append("## Scoring-time detection-size floor (IoU 0.5)")
    L.append("")
    L.append("The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.")
    L.append("")
    L.append("| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |")
    L.append("|---|---|---|---|---|---|---|---|---|---|")
    for f, row in summary["by_detection_size_floor_scoring_only"].items():
        v = row["0.5"]
        L.append(f"| {f} | {v['n_kept']} | {v['raw']['precision']:.3f} | {v['raw']['recall']:.3f} | {v['raw']['f1']:.3f} | {v['crop_aware']['precision']:.3f} | {v['crop_aware']['f1']:.3f} | {v['recall_primary_AB']} | {v['fp_background_per_image']} | {v['fp_crop_per_image']} |")
    L.append("")
    L.append("## Recall by category and by size band")
    L.append("")
    L.append("| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for tau, v in summary["by_iou_threshold"].items():
        rc, re, rb = v["recall_by_category"], v["recall_by_exclusion"], v["recall_by_band"]
        f = lambda d: "n/a" if d["recall"] is None else f"{d['recall']:.3f} ({d['n']})"
        L.append(f"| {tau} | {f(rc['A'])} | {f(rc['B'])} | {f(rc['C'])} | {f(rc['D'])} | {f(re['partial'])} | {f(re['touches_border'])} | {f(re['tiny'])} | {f(rb['tiny'])} | {f(rb['small'])} | {f(rb['medium'])} | {f(rb['large'])} |")
    L.append("")
    L.append("## Found, merged, split (coverage-based, independent of IoU)")
    L.append("")
    L.append("Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.")
    L.append("")
    L.append("| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |")
    L.append("|---|---|---|---|---|---|---|---|")
    fm = summary["found_merge_split"]
    rows = [("all", fm["all"])] + [(c, fm["by_category"][c]) for c in CATEGORIES] + [(e, fm["by_exclusion"][e]) for e in EXCLUSIONS] + [(f"band {b}", fm["by_band"][b]) for b in BANDS]
    for name, s in rows:
        if s["n"]:
            L.append(f"| {name} | {s['n']} | {s['found']:.3f} | {s['merged_with_weed']:.3f} | {s['merged_with_crop']:.3f} | {s['split']:.3f} | {s['median_best_iou']:.3f} | {s['p10_best_iou']:.3f} |")
    L.append("")
    L.append("| category x band | " + " | ".join(BANDS) + " |")
    L.append("|---|" + "---|" * len(BANDS))
    for c in CATEGORIES:
        cells = []
        for b in BANDS:
            s = fm["by_category_and_band"][c][b]
            cells.append("-" if not s["n"] else f"found {s['found']:.2f}, IoU {s['median_best_iou']:.2f} (n {s['n']})")
        L.append(f"| {c} | " + " | ".join(cells) + " |")
    L.append("")
    ce = summary["count_error"]
    L.append(f"Weed count error per image (detections minus reference weeds): mean {ce['mean_signed']}, median abs {ce['median_abs']}, p90 abs {ce['p90_abs']}. "
             f"Detections per image median {summary['detections_per_image']['median']}, p95 {summary['detections_per_image']['p95']}, max {summary['detections_per_image']['max']}; reference weeds per image median {summary['reference_weeds_per_image']['median']}.")
    L.append("")
    vp = summary["vegetation_pixels"]
    L.append(f"Vegetation pixels (diagnostic): IoU vs all plant pixels median {vp['veg_iou_plants']['median']:.3f} (p10 {vp['veg_iou_plants']['p10']:.3f}); pixel recall of plants {vp['veg_recall_plant_px']['median']:.3f}; pixel precision {vp['veg_precision_px']['median']:.3f}.")
    L.append("")
    L.append("## Runtime")
    L.append("")
    L.append(f"Single process, sequential, {timing['note']}. Cold first image: " + ", ".join(f"{k} {v}" for k, v in timing["cold_first_image"].items()) + ".")
    L.append("")
    L.append("| stage | steady median ms | steady p95 ms |")
    L.append("|---|---|---|")
    for k, v in timing["steady_state"].items():
        L.append(f"| {k} | {v['median']} | {v['p95']} |")
    L.append("")
    L.append("## Worst images")
    L.append("")
    for key, items in worst.items():
        L.append(f"- {key}: " + ", ".join(f"{n} ({v})" for n, v in items))
    L.append("")
    path.write_text("\n".join(L), encoding="utf-8")




# ---------------------------------------------------------------------------
# Experiment 5 additions: pixel quality, plot-clustered uncertainty, separation diagnostics.
# ---------------------------------------------------------------------------

def _plot_of(image_name: str) -> str:
    return image_name.split("_")[2][:-4]


def _q(xs, p):
    return round(float(np.percentile(xs, p)), 4) if len(xs) else None


def quality_block(rs: list[dict]) -> dict:
    """Pixel quality of the assigned detection over a group of references (found ones carry the numbers; unfound count as IoU 0)."""
    n = len(rs)
    if not n:
        return {"n": 0}
    iou = [r["q_iou"] for r in rs]
    dice = [r["q_dice"] for r in rs]
    bf1 = [r["q_boundary_f1"] for r in rs]
    fp = sum(r["q_fp_px"] for r in rs)
    fn = sum(r["q_fn_px"] for r in rs)
    crop = sum(r["q_crop_px"] for r in rs)
    ref_px = sum(r["area_px"] for r in rs)
    inter = ref_px - fn
    pred_px = inter + fp
    return {
        "n": n,
        "iou_median": _q(iou, 50), "iou_p10": _q(iou, 10), "iou_p25": _q(iou, 25),
        "dice_median": _q(dice, 50), "dice_p10": _q(dice, 10),
        "boundary_f1_median": _q(bf1, 50), "boundary_f1_p10": _q(bf1, 10),
        "pixel_precision": round(inter / pred_px, 4) if pred_px else None,
        "pixel_recall": round(inter / ref_px, 4) if ref_px else None,
        "fp_px_per_instance": round(fp / n, 1), "fn_px_per_instance": round(fn / n, 1),
        "crop_px_per_instance": round(crop / n, 2),
        "crop_contamination": round(crop / pred_px, 5) if pred_px else None,
    }


def plot_bootstrap(refs: list[dict], key, n_boot: int = 1000, seed: int = 20261013) -> dict:
    """Recall under `key` with a 95% interval from resampling PLOTS (the independent unit), not observations."""
    by_plot = defaultdict(lambda: [0, 0])
    for r in refs:
        p = _plot_of(r["image"])
        by_plot[p][0] += int(bool(key(r)))
        by_plot[p][1] += 1
    plots = list(by_plot)
    if not plots:
        return {"n_plots": 0}
    hits = np.array([by_plot[p][0] for p in plots], float)
    tot = np.array([by_plot[p][1] for p in plots], float)
    rng = np.random.default_rng(seed)
    vals = []
    for _ in range(n_boot):
        idx = rng.integers(0, len(plots), len(plots))
        vals.append(hits[idx].sum() / max(1.0, tot[idx].sum()))
    return {"n_plots": len(plots), "point": round(float(hits.sum() / tot.sum()), 4), "ci95": [round(float(np.percentile(vals, 2.5)), 4), round(float(np.percentile(vals, 97.5)), 4)],
            "per_plot_min": round(float((hits / np.maximum(tot, 1)).min()), 4), "per_plot_max": round(float((hits / np.maximum(tot, 1)).max()), 4)}


def separation_block(refs: list[dict]) -> dict:
    """Splits and merges sorted by what the reference can say about them."""
    def rate(rs, pred):
        return round(sum(1 for r in rs if pred(r)) / len(rs), 4) if rs else None

    a = [r for r in refs if r["category"] == "A"]
    b = [r for r in refs if r["category"] == "B"]
    c = [r for r in refs if r["category"] == "C"]
    d = [r for r in refs if r["category"] == "D"]
    d_touch = [r for r in d if "touching" in r["d_reasons"] or "near_touching" in r["d_reasons"]]
    d_ambig = [r for r in d if "large_patch" in r["d_reasons"] or "fragmented" in r["d_reasons"]]
    d_clean = [r for r in d_touch if r not in d_ambig]
    return {
        "false_split_rate_A_single_isolated": rate(a, lambda r: r["split"]),
        "false_split_rate_B": rate(b, lambda r: r["split"]),
        "false_split_rate_C": rate(c, lambda r: r["split"]),
        "merge_with_weed_rate_B": rate(b, lambda r: r["merged_with_weed"] > 0),
        "merge_with_weed_rate_D_touching_unambiguous": rate(d_clean, lambda r: r["merged_with_weed"] > 0),
        "merge_with_crop_rate_D": rate(d, lambda r: r["merged_with_crop"] > 0),
        "split_rate_D_ambiguous_reference": rate(d_ambig, lambda r: r["split"]),
        "n": {"A": len(a), "B": len(b), "C": len(c), "D": len(d), "D_touching_unambiguous": len(d_clean), "D_ambiguous": len(d_ambig)},
        "note": "A split on A is a false split (A is one isolated plant by construction). A split of a D 'large_patch' or 'fragmented' reference is ambiguous: the reference may itself be several plants. Merges are counted against D references that touch another plant and are not ambiguous.",
    }


def extend_summary(summary: dict, refs: list[dict], dets: list[dict], images: list[dict], stage_ms: dict | None = None, peak_rss_mb: float | None = None) -> dict:
    groups = {"all": refs, "AB": [r for r in refs if r["category"] in ("A", "B")]}
    for cat in CATEGORIES:
        groups[cat] = [r for r in refs if r["category"] == cat]
    for b in BANDS:
        groups[f"band_{b}"] = [r for r in refs if r["size_band"] == b]
    groups["AB_small"] = [r for r in refs if r["category"] in ("A", "B") and r["size_band"] == "small"]
    groups["AB_found"] = [r for r in refs if r["category"] in ("A", "B") and r["found"]]
    summary["quality"] = {g: quality_block(rs) for g, rs in groups.items()}
    ab = groups["AB"]
    summary["uncertainty_plot_bootstrap"] = {
        "AB_recall@0.5": plot_bootstrap(ab, lambda r: r["matched@0.5"]),
        "AB_recall@0.3": plot_bootstrap(ab, lambda r: r["matched@0.3"]),
        "A_recall@0.5": plot_bootstrap(groups["A"], lambda r: r["matched@0.5"]),
        "small_recall@0.5": plot_bootstrap(groups["band_small"], lambda r: r["matched@0.5"]),
    }
    summary["separation"] = separation_block(refs)
    if stage_ms:
        summary["postprocess_ms"] = stage_ms
    if peak_rss_mb is not None:
        summary["peak_rss_mb"] = peak_rss_mb
    return summary
