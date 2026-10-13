"""Experiment 5 visual collections: RGB | Reference | ERFNet (A1) | Refined/Separated (config) | Instances | Error overlay.

Collections (each a folder of panels plus index.html), chosen deterministically
from the per-reference tables of the baseline (A1_argmax) and the config:
  largest_improvements   images where the config gains the most A+B matches at IoU 0.5
  largest_regressions    images where it loses the most
  small_seedlings        images with the most small-band A+B references
  crop_adjacent          images with the most C references
  touching               images with the most D references flagged touching
  ambiguous_reference    images with D references flagged large_patch or fragmented
  worst                  images with the most A+B references unmatched by the config
Panels carry the image id, the config name and the counts.
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
from weedlab.viz.panels import draw_outlines, instance_rgb  # noqa: E402


def load_refs(run_dir: Path) -> dict[str, list[dict]]:
    out = defaultdict(list)
    with (run_dir / "per_reference.csv").open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            out[r["image"]].append(r)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--split", default="dev_tune")
    ap.add_argument("--config", required=True)
    ap.add_argument("--baseline", default="A1_argmax")
    ap.add_argument("--per-collection", type=int, default=4)
    args = ap.parse_args(argv)
    try:
        root = resolve_dataset_root(args.root)
    except DatasetNotFound as e:
        print(e, file=sys.stderr)
        return 2
    base = resolve_output_dir(args.out) / "postprocess"
    db, dc = base / args.baseline / args.split, base / args.config / args.split
    rb, rc = load_refs(db), load_refs(dc)
    names = sorted(set(rb) & set(rc))
    hit = lambda rs: sum(1 for r in rs if r["category"] in ("A", "B") and r["matched@0.5"] == "True")
    gain = {n: hit(rc[n]) - hit(rb[n]) for n in names}
    cols = {
        "largest_improvements": sorted(names, key=lambda n: (-gain[n], n)),
        "largest_regressions": sorted(names, key=lambda n: (gain[n], n)),
        "small_seedlings": sorted(names, key=lambda n: (-sum(1 for r in rc[n] if r["category"] in ("A", "B") and r["size_band"] == "small"), n)),
        "crop_adjacent": sorted(names, key=lambda n: (-sum(1 for r in rc[n] if r["category"] == "C"), n)),
        "touching": sorted(names, key=lambda n: (-sum(1 for r in rc[n] if r["category"] == "D" and "touching" in r["d_reasons"]), n)),
        "ambiguous_reference": sorted(names, key=lambda n: (-sum(1 for r in rc[n] if r["category"] == "D" and ("large_patch" in r["d_reasons"] or "fragmented" in r["d_reasons"])), n)),
        "worst": sorted(names, key=lambda n: (-sum(1 for r in rc[n] if r["category"] in ("A", "B") and r["matched@0.5"] != "True"), n)),
    }
    out_root = base / "_sheets" / f"{args.config}__vs__{args.baseline}" / args.split
    index = ["<html><head><meta charset='utf-8'><style>body{font-family:sans-serif;background:#111;color:#ddd}img{max-width:100%}</style></head><body>", f"<h1>{args.config} vs {args.baseline} on {args.split}</h1>"]
    done = set()
    for coll, lst in cols.items():
        (out_root / coll).mkdir(parents=True, exist_ok=True)
        index.append(f"<h2>{coll}</h2>")
        k = 0
        for n in lst:
            if k >= args.per_collection:
                break
            if coll in ("largest_improvements",) and gain[n] <= 0:
                break
            if coll in ("largest_regressions",) and gain[n] >= 0:
                break
            s = load_sample(root, "train", n, kinds=("semantics", "plant_instances"))
            plants = extract_plant_instances(s.semantics, s.plant_instances)
            pb = np.asarray(Image.open(db / "pred" / n)).astype(np.int32)
            pc = np.asarray(Image.open(dc / "pred" / n)).astype(np.int32)
            fig, axes = plt.subplots(1, 6, figsize=(36, 6.8))
            axes[0].imshow(s.image); axes[0].set_title("A. original")
            axes[1].imshow(s.image); draw_outlines(axes[1], s.plant_instances, plants, label_ids=False)
            axes[1].set_title(f"B. reference: {sum(1 for p in plants if p.kind == 'weed')} weeds (yellow), crops cyan")
            axes[2].imshow(error_overlay(s.image, pb, s.semantics)); axes[2].set_title(f"C. {args.baseline}: A+B hit {hit(rb[n])}")
            axes[3].imshow(error_overlay(s.image, pc, s.semantics)); axes[3].set_title(f"D. {args.config}: A+B hit {hit(rc[n])}  (errors: magenta missed, cyan on crop, red on soil)")
            axes[4].imshow(instance_rgb(pc)); axes[4].set_title(f"E. instances: {int(pc.max())} ({args.config})")
            diff = np.zeros(s.image.shape, np.uint8)
            diff[(pb > 0) & (pc > 0)] = (120, 120, 120)
            diff[(pb == 0) & (pc > 0)] = (40, 230, 60)
            diff[(pb > 0) & (pc == 0)] = (230, 40, 40)
            axes[5].imshow(diff); axes[5].set_title("F. change vs baseline: green added, red removed, grey kept")
            for ax in axes:
                ax.set_xticks([]); ax.set_yticks([])
            fig.suptitle(f"[{coll}] {n}   config {args.config}   baseline {args.baseline}   gain {gain[n]:+d} A+B matches", fontsize=12)
            fig.tight_layout()
            fig.savefig(out_root / coll / n, dpi=90)
            plt.close(fig)
            index.append(f"<h3>{n} (gain {gain[n]:+d})</h3><img src='{coll}/{n}'>")
            done.add(n); k += 1
    index.append("</body></html>")
    (out_root / "index.html").write_text("\n".join(index), encoding="utf-8")
    print(f"wrote {out_root}: {len(done)} distinct images")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
