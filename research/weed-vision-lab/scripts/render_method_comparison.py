"""Side-by-side panels: Original | Reference | method A | method B, each prediction with its error overlay.

Reads the prediction PNGs two runs wrote for the same split and renders the
images where the two methods disagree most, plus a few where both succeed and
both fail, so successes and failures are shown together.

Writes <out>/baseline/_compare/<runA>__vs__<runB>/<split>/<image>.png and index.html.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

import _bootstrap  # noqa: F401
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from weedlab.config import DatasetNotFound, resolve_dataset_root, resolve_output_dir  # noqa: E402
from weedlab.phenobench.instances import extract_plant_instances  # noqa: E402
from weedlab.phenobench.reader import load_sample  # noqa: E402
from weedlab.viz.compare import error_overlay  # noqa: E402
from weedlab.viz.panels import draw_outlines  # noqa: E402


def per_image_ab(run_dir: Path) -> dict[str, dict]:
    refs = defaultdict(list)
    with (run_dir / "per_reference.csv").open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            refs[r["image"]].append(r)
    dets = defaultdict(list)
    with (run_dir / "per_detection.csv").open(newline="", encoding="utf-8") as fh:
        for d in csv.DictReader(fh):
            dets[d["image"]].append(d)
    out = {}
    for img, rs in refs.items():
        ab = [r for r in rs if r["category"] in ("A", "B")]
        ds = dets.get(img, [])
        out[img] = {
            "ab_n": len(ab),
            "ab_hit": sum(1 for r in ab if r["matched@0.5"] == "True"),
            "fn": sum(1 for r in rs if r["matched@0.5"] != "True"),
            "fp_bg25": sum(1 for d in ds if d["matched@0.5"] != "True" and d["fp_kind@0.5"] == "background" and int(d["area_px"]) >= 25),
            "fp_crop25": sum(1 for d in ds if d["matched@0.5"] != "True" and d["fp_kind@0.5"] == "crop" and int(d["area_px"]) >= 25),
            "tp": sum(1 for d in ds if d["matched@0.5"] == "True"),
        }
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--split", default="dev_tune")
    ap.add_argument("--run-a", required=True)
    ap.add_argument("--run-b", required=True)
    ap.add_argument("--n", type=int, default=12)
    args = ap.parse_args(argv)
    try:
        root = resolve_dataset_root(args.root)
    except DatasetNotFound as e:
        print(e, file=sys.stderr)
        return 2
    base = resolve_output_dir(args.out) / "baseline"
    da, db = base / args.run_a / args.split, base / args.run_b / args.split
    sa, sb = per_image_ab(da), per_image_ab(db)
    names = sorted(set(sa) & set(sb))
    # Selection: B beats A most on A+B hits, A beats B most, both succeed, both fail; deterministic.
    gain = sorted(names, key=lambda n: (-(sb[n]["ab_hit"] - sa[n]["ab_hit"]), n))
    loss = sorted(names, key=lambda n: (-(sa[n]["ab_hit"] - sb[n]["ab_hit"]), n))
    both_ok = sorted([n for n in names if sa[n]["ab_n"] >= 2 and sa[n]["ab_hit"] == sa[n]["ab_n"] and sb[n]["ab_hit"] == sb[n]["ab_n"]], key=lambda n: (-sa[n]["ab_n"], n))
    both_fail = sorted([n for n in names if sa[n]["ab_n"] >= 2 and sa[n]["ab_hit"] == 0 and sb[n]["ab_hit"] == 0], key=lambda n: (-sa[n]["ab_n"], n))
    fp_b = sorted(names, key=lambda n: (-sb[n]["fp_bg25"] - sb[n]["fp_crop25"], n))
    chosen, why = [], {}
    for label, lst, k in (("B gains most A+B hits", gain, 3), ("A gains most A+B hits", loss, 3), ("both find every A+B weed", both_ok, 2), ("both miss every A+B weed", both_fail, 2), ("most B false positives (>= 25 px)", fp_b, 2)):
        for n in lst[:k]:
            if n not in why:
                why[n] = label
                chosen.append(n)
    chosen = chosen[: args.n]
    ds_split = "val" if args.split == "holdout" else "train"
    out = base / "_compare" / f"{args.run_a}__vs__{args.run_b}" / args.split
    out.mkdir(parents=True, exist_ok=True)
    html = [f"<html><head><meta charset='utf-8'><title>{args.run_a} vs {args.run_b}</title><style>body{{font-family:sans-serif;background:#111;color:#ddd}}img{{max-width:100%}}</style></head><body><h1>{args.run_a} (A) vs {args.run_b} (B) on {args.split}</h1>"]
    for name in chosen:
        s = load_sample(root, ds_split, name, kinds=("semantics", "plant_instances"))
        plants = extract_plant_instances(s.semantics, s.plant_instances)
        pa = np.asarray(Image.open(da / "pred" / name)).astype(np.int32)
        pb = np.asarray(Image.open(db / "pred" / name)).astype(np.int32)
        fig, axes = plt.subplots(1, 4, figsize=(24, 6.6))
        axes[0].imshow(s.image)
        axes[0].set_title("original")
        axes[1].imshow(s.image)
        draw_outlines(axes[1], s.plant_instances, plants, label_ids=False)
        axes[1].set_title(f"reference: {sum(1 for p in plants if p.kind == 'weed')} weeds, A+B {sa[name]['ab_n']}")
        axes[2].imshow(error_overlay(s.image, pa, s.semantics))
        axes[2].set_title(f"{args.run_a}: A+B hit {sa[name]['ab_hit']}/{sa[name]['ab_n']}  FN {sa[name]['fn']}  FP bg {sa[name]['fp_bg25']} crop {sa[name]['fp_crop25']} (>=25 px)")
        axes[3].imshow(error_overlay(s.image, pb, s.semantics))
        axes[3].set_title(f"{args.run_b}: A+B hit {sb[name]['ab_hit']}/{sb[name]['ab_n']}  FN {sb[name]['fn']}  FP bg {sb[name]['fp_bg25']} crop {sb[name]['fp_crop25']} (>=25 px)")
        for ax in axes:
            ax.set_xticks([])
            ax.set_yticks([])
        fig.suptitle(f"{name}   [{why[name]}]   green correct, magenta missed weed, cyan on crop, red on background", fontsize=11)
        fig.tight_layout()
        fig.savefig(out / name, dpi=100)
        plt.close(fig)
        html.append(f"<h3>{name} [{why[name]}]</h3><img src='{name}'>")
    html.append("</body></html>")
    (out / "index.html").write_text("\n".join(html), encoding="utf-8")
    (out / "selection.json").write_text(json.dumps({n: why[n] for n in chosen}, indent=1), encoding="utf-8")
    print(f"wrote {out}: {len(chosen)} panels")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
