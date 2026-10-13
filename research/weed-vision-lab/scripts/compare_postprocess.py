"""One table over every post-processing config evaluated on a split (Experiment 5).

Reads reports/postprocess/<config>/<split>/summary.json; writes reports/postprocess/comparison_<split>.md and .json.
"""

from __future__ import annotations

import argparse
import json

import _bootstrap  # noqa: F401

from weedlab.config import LAB_DIR


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--split", default="dev_sub")
    ap.add_argument("--configs", nargs="*", default=None)
    args = ap.parse_args(argv)
    base = LAB_DIR / "reports" / "postprocess"
    runs = {}
    for p in sorted(base.glob(f"*/{args.split}/summary.json")):
        name = p.parent.parent.name
        if args.configs and name not in args.configs:
            continue
        runs[name] = json.loads(p.read_text(encoding="utf-8"))
    if not runs:
        print("no runs")
        return 2
    first = next(iter(runs.values()))
    L = [f"# Post-processing configs on `{args.split}` (in-sample for ERFNet)", "", f"{len(runs)} configs; {first['n_images']} images, {first['n_reference_weeds']} reference weed observations. IoU matching 0.5 unless stated. Floor 25 = detections under 25 px set aside at scoring only.", ""]
    L.append("## Detection")
    L.append("")
    L.append("| config | dets/img | A | B | C | D | A+B@0.3 | tiny | small | medium | P raw | P floor25 | F1 floor25 | FP bg/img floor25 | FP crop/img floor25 | A+B recall CI95 (plots) |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for n, s in runs.items():
        v = s["by_iou_threshold"]["0.5"]; f = s["by_detection_size_floor_scoring_only"]["25"]["0.5"]; rc = v["recall_by_category"]; rb = v["recall_by_band"]
        ci = s["uncertainty_plot_bootstrap"]["AB_recall@0.5"]
        L.append(f"| {n} | {s['detections_per_image']['median']} | {rc['A']['recall']} | {rc['B']['recall']} | {rc['C']['recall']} | {rc['D']['recall']} | {s['by_iou_threshold']['0.3']['recall_primary_AB']} | {rb['tiny']['recall']} | {rb['small']['recall']} | {rb['medium']['recall']} | {v['raw']['precision']:.3f} | {f['raw']['precision']:.3f} | {f['raw']['f1']:.3f} | {f['fp_background_per_image']} | {f['fp_crop_per_image']} | {ci.get('point')} [{ci.get('ci95', ['', ''])[0]}, {ci.get('ci95', ['', ''])[1]}] |")
    L.append("")
    L.append("## Canopy quality of the assigned detection, A+B references (unfound count as 0)")
    L.append("")
    L.append("| config | IoU med | IoU p10 | Dice med | bF1 med | bF1 p10 | pixel P | pixel R | FP px/inst | FN px/inst | crop px/inst | small: IoU med | small: pixel R | found A+B |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for n, s in runs.items():
        q = s["quality"]["AB"]; qs = s["quality"]["AB_small"]
        L.append(f"| {n} | {q['iou_median']} | {q['iou_p10']} | {q['dice_median']} | {q['boundary_f1_median']} | {q['boundary_f1_p10']} | {q['pixel_precision']} | {q['pixel_recall']} | {q['fp_px_per_instance']} | {q['fn_px_per_instance']} | {q['crop_px_per_instance']} | {qs['iou_median']} | {qs['pixel_recall']} | {s['quality']['AB_found']['n']}/{q['n']} |")
    L.append("")
    L.append("## Separation")
    L.append("")
    L.append("| config | false split A | false split C | merge w/ weed B | merge w/ weed D touching (unambiguous) | split of ambiguous D | merge w/ crop D | components split | pieces added |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for n, s in runs.items():
        sp = s["separation"]; st = s.get("separation_stats", {})
        L.append(f"| {n} | {sp['false_split_rate_A_single_isolated']} | {sp['false_split_rate_C']} | {sp['merge_with_weed_rate_B']} | {sp['merge_with_weed_rate_D_touching_unambiguous']} | {sp['split_rate_D_ambiguous_reference']} | {sp['merge_with_crop_rate_D']} | {st.get('sep_n_split', '')} | {st.get('sep_n_pieces_added', '')} |")
    L.append("")
    L.append("## Cost (post-processing only; ERFNet inference cached, about 280 ms per image on this CPU)")
    L.append("")
    L.append("| config | refine ms med | separate ms med | total ms med | total ms p95 | peak RSS MB (worker) | wall s |")
    L.append("|---|---|---|---|---|---|---|")
    for n, s in runs.items():
        t = s["postprocess_ms"]
        L.append(f"| {n} | {t.get('ms_refine', {}).get('median')} | {t.get('ms_separate', {}).get('median')} | {t['ms_total']['median']} | {t['ms_total']['p95']} | {s.get('peak_rss_mb')} | {s['wall_seconds_parallel']} |")
    L.append("")
    (base / f"comparison_{args.split}.md").write_text("\n".join(L), encoding="utf-8")
    slim = {n: {"det": s["by_iou_threshold"]["0.5"], "floor25": s["by_detection_size_floor_scoring_only"]["25"]["0.5"], "quality_AB": s["quality"]["AB"], "quality_AB_small": s["quality"]["AB_small"], "separation": s["separation"], "ms": s["postprocess_ms"], "ci": s["uncertainty_plot_bootstrap"]} for n, s in runs.items()}
    (base / f"comparison_{args.split}.json").write_text(json.dumps(slim, indent=1), encoding="utf-8")
    print("\n".join(L))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
