"""Original | Reference | Prediction | Error overlay, for one image.

Error overlay colours on the RGB image:
  green   correct: predicted pixel on a reference weed
  magenta missing: reference weed pixel not predicted
  cyan    predicted pixel on a reference crop (a crop false positive or a merge)
  red     predicted pixel on background (soil, shadow, residue)
Reference weed outlines are drawn in yellow on the reference panel, crops in cyan.
"""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from weedlab.phenobench.instances import extract_plant_instances  # noqa: E402
from weedlab.phenobench.reader import CROP_CLASSES, WEED_CLASSES  # noqa: E402
from weedlab.viz.panels import draw_outlines, instance_rgb  # noqa: E402


def error_overlay(rgb: np.ndarray, pred: np.ndarray, sem: np.ndarray, alpha: float = 0.55) -> np.ndarray:
    out = rgb.astype(np.float32).copy()
    p = pred > 0
    weed = np.isin(sem, WEED_CLASSES)
    crop = np.isin(sem, CROP_CLASSES)
    layers = [
        (p & weed, (40, 220, 60)),
        (~p & weed, (255, 0, 220)),
        (p & crop, (0, 220, 255)),
        (p & ~weed & ~crop, (255, 40, 40)),
    ]
    for m, colour in layers:
        out[m] = (1 - alpha) * out[m] + alpha * np.array(colour, dtype=np.float32)
    return out.clip(0, 255).astype(np.uint8)


def render_comparison(sample, pred: np.ndarray, refs: list[dict], dets: list[dict], out_path: Path, title: str = "", dpi: int = 100) -> None:
    sem, inst = sample.semantics, sample.plant_instances
    plants = extract_plant_instances(sem, inst)
    n_ref = sum(1 for r in refs)
    tp = sum(1 for d in dets if d.get("matched@0.5"))
    fp_bg = sum(1 for d in dets if not d.get("matched@0.5") and d.get("fp_kind@0.5") == "background")
    fp_crop = sum(1 for d in dets if not d.get("matched@0.5") and d.get("fp_kind@0.5") == "crop")
    fn = sum(1 for r in refs if not r.get("matched@0.5"))
    merged = sum(1 for r in refs if r.get("merged_with_weed") or r.get("merged_with_crop"))
    fig, axes = plt.subplots(1, 4, figsize=(24, 6.6))
    axes[0].imshow(sample.image)
    axes[0].set_title("A. original")
    axes[1].imshow(sample.image)
    draw_outlines(axes[1], inst, plants, label_ids=False)
    axes[1].set_title(f"B. reference: {n_ref} weeds (yellow), crops cyan")
    axes[2].imshow(instance_rgb(pred))
    axes[2].set_title(f"C. prediction: {int(pred.max())} components")
    axes[3].imshow(error_overlay(sample.image, pred, sem))
    axes[3].set_title(f"D. errors: TP {tp}  FN {fn}  FP bg {fp_bg}  FP crop {fp_crop}  merged {merged}")
    for ax in axes:
        ax.set_xticks([])
        ax.set_yticks([])
    fig.suptitle(f"{title}  {sample.name}", fontsize=11)
    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=dpi)
    plt.close(fig)
