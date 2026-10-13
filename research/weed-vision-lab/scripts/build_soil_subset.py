"""Phase 2: assign every weed instance a size band, an exclusion reason or a category, and build the subset.

Reads  <out>/profile/weed_instances.csv and images_phase2.csv (from profile_instances.py)
       configs/soil_only_v1.json (thresholds)
Writes <out>/subset/soil_only_v1/
         instances_labelled.csv       every weed instance with band, exclusion, category
         manifest.json                image ids and instance ids per split and category
         splits.json                  plot-aware split membership (plots and images)
         stats.json                   all counts used in the report
         sheet_selection.json         which instances the contact sheets show, and why
         report.md                    the human-readable profile and subset report
Also copies manifest.json, splits.json, stats.json and report.md to reports/subset/soil_only_v1/.

Deterministic: same profile and config give the same files.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import shutil
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import _bootstrap  # noqa: F401

from weedlab import LAB_VERSION
from weedlab.config import CONFIG_DIR, LAB_DIR, resolve_output_dir

BOOL = {"True": True, "False": False, "": None}


def _val(v: str):
    if v in BOOL:
        return BOOL[v]
    try:
        f = float(v)
        return int(f) if f.is_integer() and "." not in v else f
    except ValueError:
        return v


KEEP_TEXT = {"touching_ids", "image", "plot", "date", "split", "nearest_other_kind"}


def read_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as fh:
        return [{k: (v if k in KEEP_TEXT else _val(v)) for k, v in r.items()} for r in csv.DictReader(fh)]


def size_band(area: int, bands: dict) -> str:
    for name, (lo, hi) in bands.items():
        if name == "note":
            continue
        if area >= lo and (hi is None or area < hi):
            return name
    return "unbanded"


def label_instance(r: dict, cfg: dict) -> tuple[str | None, str | None]:
    """Return (exclusion_reason, category). Exactly one of them is None."""
    ex = cfg["exclude"]
    if r["partial"]:
        return "partial", None
    if r["touches_border"]:
        return "touches_border", None
    if r["area_px"] < ex["min_area_px"]:
        return "tiny", None
    d = cfg["category_D_dense_or_ambiguous"]
    touching = bool(r["touching_ids"]) if isinstance(r["touching_ids"], str) else False
    fragmented = r["n_components"] >= 2 and (r["area_px"] - r["largest_component_px"]) / r["area_px"] >= 0.05
    if (
        (d["touching_any_plant"] and touching)
        or r["dist_to_other_plant_px"] < d["dist_to_other_plant_lt_px"]
        or r["area_px"] >= d["area_ge_px"]
        or fragmented
        or r["ring_background"] < d["ring_background_lt"]
    ):
        return None, "D"
    dcrop = r["dist_to_crop_px"] if r["dist_to_crop_px"] is not None else math.inf
    a = cfg["category_A_isolated"]
    if r["dist_to_other_plant_px"] >= a["dist_to_other_plant_ge_px"] and dcrop >= a["dist_to_crop_ge_px"] and r["ring_background"] >= a["ring_background_ge"]:
        return None, "A"
    b = cfg["category_B_multiple_distinguishable"]
    if r["dist_to_other_plant_px"] >= b["dist_to_other_plant_ge_px"] and dcrop >= b["dist_to_crop_ge_px"] and r["ring_background"] >= b["ring_background_ge"]:
        return None, "B"
    c = cfg["category_C_crop_adjacent"]
    if r["dist_to_other_plant_px"] >= c["dist_to_other_plant_ge_px"] and dcrop < c["dist_to_crop_lt_px"] and r["ring_background"] >= c["ring_background_ge"]:
        return None, "C"
    return None, "unassigned"


def d_reasons(r: dict, cfg: dict) -> list[str]:
    d = cfg["category_D_dense_or_ambiguous"]
    out = []
    if isinstance(r["touching_ids"], str) and r["touching_ids"]:
        out.append("touching")
    elif r["dist_to_other_plant_px"] < d["dist_to_other_plant_lt_px"]:
        out.append("near_touching")
    if r["area_px"] >= d["area_ge_px"]:
        out.append("large_patch")
    if r["n_components"] >= 2 and (r["area_px"] - r["largest_component_px"]) / r["area_px"] >= 0.05:
        out.append("fragmented")
    if r["ring_background"] < d["ring_background_lt"]:
        out.append("low_background")
    return out


def make_splits(images: list[dict]) -> dict:
    """Plot-aware: val is the holdout; train plots alternate tune/check within each date."""
    by_date = defaultdict(set)
    for im in images:
        if im["split"] == "train":
            by_date[im["date"]].add(im["plot"])
    tune, check = [], []
    for date in sorted(by_date):
        for k, plot in enumerate(sorted(by_date[date])):
            (tune if k % 2 == 0 else check).append(plot)
    tune_s, check_s = set(tune), set(check)
    members = {"dev_tune": [], "dev_check": [], "holdout": []}
    for im in images:
        if im["split"] == "val":
            members["holdout"].append(im["image"])
        elif im["plot"] in tune_s:
            members["dev_tune"].append(im["image"])
        else:
            members["dev_check"].append(im["image"])
    return {
        "rule": "val = holdout (all plots). train plots sorted within each date and alternated tune, check, tune, ...",
        "plots": {"dev_tune": sorted(tune), "dev_check": sorted(check), "holdout": sorted({im["plot"] for im in images if im["split"] == "val"})},
        "images": {k: sorted(v) for k, v in members.items()},
        "n_images": {k: len(v) for k, v in members.items()},
    }


def quantiles(xs: list[float], qs=(0.05, 0.25, 0.5, 0.75, 0.95)) -> dict:
    if not xs:
        return {}
    s = sorted(xs)
    out = {}
    for q in qs:
        k = min(len(s) - 1, max(0, int(round(q * (len(s) - 1)))))
        out[f"p{int(q * 100):02d}"] = s[k]
    out["min"], out["max"], out["mean"] = s[0], s[-1], round(statistics.fmean(s), 2)
    return out


def pick_spread(rows: list[dict], k: int) -> list[dict]:
    """k rows evenly spaced through the list sorted by (date, plot, image, id)."""
    rows = sorted(rows, key=lambda r: (r["date"], r["plot"], r["image"], r["instance_id"]))
    if len(rows) <= k:
        return rows
    idx = [round(i * (len(rows) - 1) / (k - 1)) for i in range(k)] if k > 1 else [0]
    return [rows[i] for i in dict.fromkeys(idx)]


def select_for_sheets(rows: list[dict]) -> dict:
    """Deterministic choice of candidates and rejected examples for the contact sheets, train split only."""
    tr = [r for r in rows if r["split"] == "train"]
    chosen: list[dict] = []
    seen = set()

    def add(items, why):
        for r in items:
            key = (r["image"], r["instance_id"])
            if key in seen:
                continue
            seen.add(key)
            chosen.append({"image": r["image"], "instance_id": r["instance_id"], "category": r["category"], "exclusion": r["exclusion"], "why_shown": why})

    for cat, per_band in (("A", {"small": 5, "medium": 5, "large": 3}), ("B", {"small": 4, "medium": 4, "large": 2})):
        c = [r for r in tr if r["category"] == cat]
        for band, k in per_band.items():
            add(pick_spread([r for r in c if r["size_band"] == band], k), f"{cat} {band}, evenly spread by date/plot")
        if c:
            add([min(c, key=lambda r: (r["ring_background"], r["image"]))], f"{cat} hardest: lowest ring background")
            add([min(c, key=lambda r: (r["area_px"], r["image"]))], f"{cat} hardest: smallest area")
            add([min(c, key=lambda r: (r["solidity"] if r["solidity"] is not None else 1, r["image"]))], f"{cat} hardest: lowest solidity")
    c = [r for r in tr if r["category"] == "C"]
    add(sorted(c, key=lambda r: (r["dist_to_crop_px"], r["image"]))[:3], "C nearest to a crop")
    add(pick_spread(c, 3), "C evenly spread")
    d = [r for r in tr if r["category"] == "D"]
    add(sorted(d, key=lambda r: (-r["area_px"], r["image"]))[:2], "D largest patch")
    add(pick_spread([r for r in d if "touching" in r["d_reasons"]], 2), "D touching another plant")
    add(pick_spread([r for r in d if "fragmented" in r["d_reasons"]], 2), "D fragmented instance")
    candidates = chosen

    chosen = []
    seen = set()
    add(pick_spread([r for r in tr if r["exclusion"] == "tiny"], 4), "rejected: tiny (< 100 px)")
    add(pick_spread([r for r in tr if r["exclusion"] == "partial"], 4), "rejected: partial (class 4)")
    add(pick_spread([r for r in tr if r["exclusion"] == "touches_border"], 4), "rejected: touches image border")
    add(pick_spread([r for r in tr if r["category"] == "D" and "low_background" in r["d_reasons"]], 4), "D: ring under 50% background")
    add(pick_spread([r for r in tr if r["category"] == "D" and r["touching_crop"] > 0], 4), "D: touching a crop")
    add(pick_spread([r for r in tr if r["category"] == "unassigned"], 2), "unassigned by the rules")
    rejected = chosen
    return {"candidates": candidates, "rejected": rejected}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=None)
    ap.add_argument("--config", default=str(CONFIG_DIR / "soil_only_v1.json"))
    args = ap.parse_args(argv)
    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    out_root = resolve_output_dir(args.out)
    prof = out_root / "profile"
    if not (prof / "weed_instances.csv").exists():
        print("run scripts/profile_instances.py first", file=sys.stderr)
        return 2
    rows = read_csv(prof / "weed_instances.csv")
    images = read_csv(prof / "images_phase2.csv")
    meta = json.loads((prof / "profile_meta.json").read_text(encoding="utf-8"))
    out = out_root / "subset" / cfg["version"]
    out.mkdir(parents=True, exist_ok=True)

    bands = {k: v for k, v in cfg["size_bands_px"].items() if k != "note"}
    for r in rows:
        r["size_band"] = size_band(r["area_px"], bands)
        r["exclusion"], r["category"] = label_instance(r, cfg)
        r["d_reasons"] = " ".join(d_reasons(r, cfg)) if r["category"] == "D" else ""
    splits = make_splits(images)
    img_split = {}
    for k, names in splits["images"].items():
        for n in names:
            img_split[n] = k
    for r in rows:
        r["eval_split"] = img_split[r["image"]]

    # Image-level categories.
    by_img = defaultdict(list)
    for r in rows:
        by_img[r["image"]].append(r)
    img_cat = {}
    for im in images:
        rs = by_img.get(im["image"], [])
        cats = Counter(r["category"] for r in rs if r["category"])
        img_cat[im["image"]] = {
            "A": cats["A"] >= 1,
            "B": cats["A"] + cats["B"] >= 2,
            "C": cats["C"] >= 1,
            "D": cats["D"] >= 1,
            "n_A": cats["A"], "n_B": cats["B"], "n_C": cats["C"], "n_D": cats["D"],
            "n_excluded": sum(1 for r in rs if r["exclusion"]),
        }

    # Manifest: per eval split, per category, the image ids and instance ids.
    manifest = {"version": cfg["version"], "lab_version": LAB_VERSION, "profile_meta": meta, "config": cfg,
                "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"), "splits": {}}
    for sp in ("dev_tune", "dev_check", "holdout"):
        entry = {}
        for cat in ("A", "B", "C", "D"):
            inst = [r for r in rows if r["eval_split"] == sp and r["category"] == cat]
            entry[cat] = {
                "n_instances": len(inst),
                "n_images": len({r["image"] for r in inst}),
                "instances": [{"image": r["image"], "instance_id": r["instance_id"], "size_band": r["size_band"]} for r in sorted(inst, key=lambda r: (r["image"], r["instance_id"]))],
            }
        entry["images_A"] = sorted(n for n in splits["images"][sp] if img_cat[n]["A"])
        entry["images_B"] = sorted(n for n in splits["images"][sp] if img_cat[n]["B"])
        entry["excluded"] = {reason: [{"image": r["image"], "instance_id": r["instance_id"]} for r in rows if r["eval_split"] == sp and r["exclusion"] == reason] for reason in ("partial", "touches_border", "tiny")}
        manifest["splits"][sp] = entry

    # Stats.
    def count(pred):
        return sum(1 for r in rows if pred(r))

    stats = {
        "n_images": len(images), "n_weed_instances": len(rows),
        "n_images_no_weeds": sum(1 for im in images if im["n_weed"] == 0),
        "by_split": {s: {"images": sum(1 for im in images if im["split"] == s), "weeds": count(lambda r, s=s: r["split"] == s)} for s in ("train", "val")},
        "by_date": {d: {"images": sum(1 for im in images if im["date"] == d), "weeds": count(lambda r, d=d: r["date"] == d)} for d in sorted({im["date"] for im in images})},
        "weeds_per_image": quantiles([im["n_weed"] for im in images]),
        "crops_per_image": quantiles([im["n_crop"] for im in images]),
        "area_px": quantiles([r["area_px"] for r in rows]),
        "max_span_px": quantiles([r["max_span_px"] for r in rows]),
        "obb_length_px": quantiles([r["obb_length_px"] for r in rows]),
        "obb_width_px": quantiles([r["obb_width_px"] for r in rows]),
        "dist_to_crop_px": quantiles([r["dist_to_crop_px"] for r in rows if r["dist_to_crop_px"] is not None]),
        "dist_to_other_plant_px": quantiles([r["dist_to_other_plant_px"] for r in rows]),
        "ring_background": quantiles([r["ring_background"] for r in rows]),
        "border_dist_px": quantiles([r["border_dist_px"] for r in rows]),
        "size_bands": {b: {"n": count(lambda r, b=b: r["size_band"] == b), "fraction": round(count(lambda r, b=b: r["size_band"] == b) / len(rows), 4)} for b in bands},
        "size_bands_by_date": {d: {b: count(lambda r, b=b, d=d: r["size_band"] == b and r["date"] == d) for b in bands} for d in sorted({r["date"] for r in rows})},
        "size_bands_by_plot": {p: {b: count(lambda r, b=b, p=p: r["size_band"] == b and r["plot"] == p) for b in bands} for p in sorted({r["plot"] for r in rows})},
        "exclusions": {e: count(lambda r, e=e: r["exclusion"] == e) for e in ("partial", "touches_border", "tiny")},
        "categories": {c: count(lambda r, c=c: r["category"] == c) for c in ("A", "B", "C", "D", "unassigned")},
        "categories_by_split": {sp: {c: count(lambda r, c=c, sp=sp: r["category"] == c and r["eval_split"] == sp) for c in ("A", "B", "C", "D", "unassigned")} for sp in ("dev_tune", "dev_check", "holdout")},
        "categories_by_date": {d: {c: count(lambda r, c=c, d=d: r["category"] == c and r["date"] == d) for c in ("A", "B", "C", "D")} for d in sorted({r["date"] for r in rows})},
        "categories_by_band": {b: {c: count(lambda r, c=c, b=b: r["category"] == c and r["size_band"] == b) for c in ("A", "B", "C", "D")} for b in bands},
        "D_reasons": dict(Counter(reason for r in rows if r["category"] == "D" for reason in r["d_reasons"].split())),
        "touching": {"weed_touching_weed_pairs": sum(im["n_weed_touching_weed_pairs"] for im in images), "weeds_touching_crop": sum(im["n_weed_touching_crop"] for im in images), "instances_touching_any": count(lambda r: isinstance(r["touching_ids"], str) and r["touching_ids"] != "")},
        "fragmented_instances": count(lambda r: r["n_components"] >= 2 and (r["area_px"] - r["largest_component_px"]) / r["area_px"] >= 0.05),
        "images_by_category": {c: sum(1 for v in img_cat.values() if v[c]) for c in ("A", "B", "C", "D")},
        "images_by_category_and_split": {sp: {c: sum(1 for n in splits["images"][sp] if img_cat[n][c]) for c in ("A", "B", "C", "D")} for sp in ("dev_tune", "dev_check", "holdout")},
        "sensitivity": {
            "A_count_vs_dist_other_plant": {str(t): count(lambda r, t=t: r["exclusion"] is None and r["category"] in ("A", "B") and r["dist_to_other_plant_px"] >= t and (r["dist_to_crop_px"] or math.inf) >= 64 and r["ring_background"] >= 0.9) for t in (16, 24, 32, 48, 64, 96)},
            "A_count_vs_ring_background": {str(t): count(lambda r, t=t: r["exclusion"] is None and r["category"] in ("A", "B") and r["dist_to_other_plant_px"] >= 32 and (r["dist_to_crop_px"] or math.inf) >= 64 and r["ring_background"] >= t) for t in (0.5, 0.7, 0.8, 0.9, 0.95, 0.99)},
            "primary_count_vs_min_area": {str(t): count(lambda r, t=t: r["exclusion"] in (None, "tiny") and r["category"] in ("A", "B") and r["area_px"] >= t) for t in (25, 50, 100, 200, 400)},
        },
    }
    # Repeated observations: overlapping frames carry the same plant with the same
    # (plot, instance id) and an identical mask. Counts per unique plant are the
    # honest denominator for anything that claims "N weeds".
    def uniq(pred):
        return len({(r["plot"], r["instance_id"]) for r in rows if pred(r)})

    obs = Counter((r["split"], r["plot"], r["instance_id"]) for r in rows)
    stats["repeated_observations"] = {
        "unique_plants_all": uniq(lambda r: True),
        "unique_plants_by_split": {s: uniq(lambda r, s=s: r["split"] == s) for s in ("train", "val")},
        "frames_per_plant": dict(sorted(Counter(obs.values()).items())),
        "mean_frames_per_plant": round(len(rows) / uniq(lambda r: True), 2),
        "unique_plants_by_category_and_split": {sp: {c: uniq(lambda r, c=c, sp=sp: r["category"] == c and r["eval_split"] == sp) for c in ("A", "B", "C", "D")} for sp in ("dev_tune", "dev_check", "holdout")},
        "plants_with_more_than_one_category": sum(1 for v in defaultdict(set, {k: {r["category"] for r in rows if (r["plot"], r["instance_id"]) == k and r["category"]} for k in {(r["plot"], r["instance_id"]) for r in rows}}).values() if len(v) > 1),
    }
    # The min-area sensitivity must label tiny instances too; redo with the rule relaxed.
    relaxed = dict(cfg)
    relaxed["exclude"] = dict(cfg["exclude"], min_area_px=0)
    tiny_cats = Counter()
    for r in rows:
        if r["exclusion"] == "tiny":
            _, c = label_instance(r, relaxed)
            tiny_cats[c] += 1
    stats["tiny_would_be"] = dict(tiny_cats)
    stats["sensitivity"]["primary_count_vs_min_area"] = {
        str(t): sum(1 for r in rows if (r["exclusion"] is None or r["exclusion"] == "tiny") and r["area_px"] >= t and label_instance(r, relaxed)[1] in ("A", "B"))
        for t in (25, 50, 100, 200, 400)
    }

    sheet_sel = select_for_sheets(rows)

    # Write everything.
    fields = list(rows[0].keys())
    with (out / "instances_labelled.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    (out / "splits.json").write_text(json.dumps(splits, indent=1), encoding="utf-8")
    (out / "stats.json").write_text(json.dumps(stats, indent=1), encoding="utf-8")
    (out / "sheet_selection.json").write_text(json.dumps(sheet_sel, indent=1), encoding="utf-8")
    (out / "report.md").write_text(render_report(cfg, meta, stats, splits, sheet_sel), encoding="utf-8")
    rep = LAB_DIR / "reports" / "subset" / cfg["version"]
    rep.mkdir(parents=True, exist_ok=True)
    for f in ("manifest.json", "splits.json", "stats.json", "report.md", "sheet_selection.json"):
        shutil.copy(out / f, rep / f)
    print(json.dumps({"categories": stats["categories"], "exclusions": stats["exclusions"], "images_by_category": stats["images_by_category"]}, indent=1))
    print(f"wrote {out} and {rep}")
    return 0


def _q(d: dict) -> str:
    return " / ".join(f"{k} {d[k]}" for k in ("min", "p05", "p25", "p50", "p75", "p95", "max") if k in d)


def render_report(cfg, meta, st, splits, sel) -> str:
    L = []
    L.append(f"# Dataset profile and soil-only subset `{cfg['version']}`")
    L.append("")
    L.append(f"PhenoBench v1.1.0, splits train + val, {st['n_images']} images, {st['n_weed_instances']} weed instances. "
             f"Profiled {meta['generated_utc']} in {meta['seconds']} s with {meta['workers']} workers; lab {meta['lab_version']}. "
             f"Pixel units at native 1024 x 1024; no physical size is implied anywhere in this report.")
    L.append("")
    L.append("## Inventory")
    L.append("")
    L.append("| | images | weed instances |")
    L.append("|---|---|---|")
    for s, v in st["by_split"].items():
        L.append(f"| {s} | {v['images']} | {v['weeds']} |")
    for d, v in st["by_date"].items():
        L.append(f"| {d} | {v['images']} | {v['weeds']} |")
    L.append(f"| images with no weeds | {st['n_images_no_weeds']} | |")
    L.append("")
    L.append("Quantiles are min / p05 / p25 / p50 / p75 / p95 / max.")
    L.append("")
    L.append("| measure | quantiles |")
    L.append("|---|---|")
    for k in ("weeds_per_image", "crops_per_image", "area_px", "max_span_px", "obb_length_px", "obb_width_px", "dist_to_crop_px", "dist_to_other_plant_px", "ring_background", "border_dist_px"):
        L.append(f"| {k} | {_q(st[k])} |")
    L.append("")
    L.append(f"Weed instances touching another plant: {st['touching']['instances_touching_any']} "
             f"(weed-weed touching pairs {st['touching']['weed_touching_weed_pairs']}, weeds touching a crop {st['touching']['weeds_touching_crop']}). "
             f"Fragmented instances (two or more pieces, at least 5% of the area outside the largest): {st['fragmented_instances']}.")
    L.append("")
    L.append("## Size bands (area in pixels, half-open)")
    L.append("")
    L.append("| band | range | n | fraction |")
    L.append("|---|---|---|---|")
    for b, v in st["size_bands"].items():
        lo, hi = cfg["size_bands_px"][b]
        L.append(f"| {b} | [{lo}, {hi if hi is not None else 'inf'}) | {v['n']} | {v['fraction']:.3f} |")
    L.append("")
    L.append("| date | " + " | ".join(st["size_bands"]) + " |")
    L.append("|---|" + "---|" * len(st["size_bands"]))
    for d, v in st["size_bands_by_date"].items():
        L.append(f"| {d} | " + " | ".join(str(v[b]) for b in st["size_bands"]) + " |")
    L.append("")
    L.append("Per plot: see stats.json `size_bands_by_plot`.")
    L.append("")
    L.append("## Exclusions and categories (instance level)")
    L.append("")
    L.append("Order of the rules: partial, border, tiny are excluded first; then D if any D rule fires; then A; then B; then C.")
    L.append("")
    L.append("| group | n |")
    L.append("|---|---|")
    for e, n in st["exclusions"].items():
        L.append(f"| excluded: {e} | {n} |")
    for c, n in st["categories"].items():
        L.append(f"| category {c} | {n} |")
    L.append("")
    L.append(f"D reasons (an instance can have several): {st['D_reasons']}.")
    L.append(f"Tiny instances, had they not been excluded, would fall into: {st['tiny_would_be']}.")
    L.append("")
    L.append("| category | " + " | ".join(st["size_bands"]) + " |")
    L.append("|---|" + "---|" * len(st["size_bands"]))
    for c in ("A", "B", "C", "D"):
        L.append(f"| {c} | " + " | ".join(str(st["categories_by_band"][b][c]) for b in st["size_bands"]) + " |")
    L.append("")
    L.append("| category | " + " | ".join(st["categories_by_date"]) + " |")
    L.append("|---|" + "---|" * len(st["categories_by_date"]))
    for c in ("A", "B", "C", "D"):
        L.append(f"| {c} | " + " | ".join(str(st["categories_by_date"][d][c]) for d in st["categories_by_date"]) + " |")
    L.append("")
    L.append("## Image level")
    L.append("")
    L.append("A image: at least one A instance. B image: at least two instances in A or B. C and D images: at least one such instance.")
    L.append("")
    L.append("| split | images | A | B | C | D |")
    L.append("|---|---|---|---|---|---|")
    for sp, v in st["images_by_category_and_split"].items():
        L.append(f"| {sp} | {splits['n_images'][sp]} | {v['A']} | {v['B']} | {v['C']} | {v['D']} |")
    L.append(f"| all | {st['n_images']} | " + " | ".join(str(st["images_by_category"][c]) for c in ("A", "B", "C", "D")) + " |")
    L.append("")
    L.append("## Plot-aware splits")
    L.append("")
    L.append(splits["rule"])
    L.append("")
    for sp in ("dev_tune", "dev_check", "holdout"):
        L.append(f"- {sp}: {splits['n_images'][sp]} images, plots {', '.join(splits['plots'][sp])}")
    L.append("")
    L.append("| split | A | B | C | D | unassigned |")
    L.append("|---|---|---|---|---|---|")
    for sp, v in st["categories_by_split"].items():
        L.append(f"| {sp} | {v['A']} | {v['B']} | {v['C']} | {v['D']} | {v['unassigned']} |")
    L.append("")
    ro = st["repeated_observations"]
    L.append("## Repeated observations (the same plant in overlapping frames)")
    L.append("")
    L.append(f"A plant is a (plot, instance id) pair; overlapping frames repeat it with an identical mask. {st['n_weed_instances']} instance observations are {ro['unique_plants_all']} unique plants "
             f"(train {ro['unique_plants_by_split']['train']}, val {ro['unique_plants_by_split']['val']}), {ro['mean_frames_per_plant']} frames per plant on average. "
             f"Frames per plant: {ro['frames_per_plant']}. Plants whose category differs between frames: {ro['plants_with_more_than_one_category']}.")
    L.append("")
    L.append("| split | A plants | B plants | C plants | D plants |")
    L.append("|---|---|---|---|---|")
    for sp, v in ro["unique_plants_by_category_and_split"].items():
        L.append(f"| {sp} | {v['A']} | {v['B']} | {v['C']} | {v['D']} |")
    L.append("")
    L.append("## Threshold sensitivity (instances in A, before any inspection)")
    L.append("")
    for k, v in st["sensitivity"].items():
        L.append(f"- {k}: " + ", ".join(f"{t}: {n}" for t, n in v.items()))
    L.append("")
    L.append("## Contact sheets")
    L.append("")
    L.append(f"{len(sel['candidates'])} candidates and {len(sel['rejected'])} rejected or ambiguous examples were chosen by the rule in build_soil_subset.select_for_sheets (train split only) and are listed in sheet_selection.json. Rendered by scripts/render_subset_sheets.py under the output directory.")
    L.append("")
    return "\n".join(L)


if __name__ == "__main__":
    raise SystemExit(main())
