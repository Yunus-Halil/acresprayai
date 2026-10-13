"""Pixel-level quality of one predicted mask against one reference mask.

- dice = 2 |P ∩ R| / (|P| + |R|)
- boundary F1 at tolerance t px (Csurka et al. 2013 style): boundary pixels are
  mask pixels with a 4-neighbour outside the mask; precision = share of
  predicted boundary pixels within t of a reference boundary pixel; recall =
  share of reference boundary pixels within t of a predicted boundary pixel;
  F1 their harmonic mean. Tolerance 2 px by default.
- fp_px = |P \\ R|, fn_px = |R \\ P|; crop_px = predicted pixels on crop-family semantic pixels.
All computed on a window around the union, so cost scales with the instance, not the image.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

BOUNDARY_TOL_PX = 2


def boundary(mask: np.ndarray) -> np.ndarray:
    er = ndimage.binary_erosion(mask, structure=np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool), border_value=0)
    return mask & ~er


def mask_quality(pred: np.ndarray, ref: np.ndarray, crop: np.ndarray | None = None, tol: int = BOUNDARY_TOL_PX) -> dict:
    union = pred | ref
    if not union.any():
        return {"iou": 0.0, "dice": 0.0, "boundary_f1": 0.0, "boundary_precision": 0.0, "boundary_recall": 0.0, "fp_px": 0, "fn_px": 0, "crop_px": 0}
    ys, xs = np.nonzero(union)
    pad = tol + 1
    y0, y1 = max(0, ys.min() - pad), min(union.shape[0], ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(union.shape[1], xs.max() + pad + 1)
    p = pred[y0:y1, x0:x1]
    r = ref[y0:y1, x0:x1]
    inter = int((p & r).sum())
    ps, rs = int(p.sum()), int(r.sum())
    iou = inter / max(1, ps + rs - inter)
    dice = 2 * inter / max(1, ps + rs)
    bp, br = boundary(p), boundary(r)
    if bp.any() and br.any():
        d_to_r = ndimage.distance_transform_edt(~br)
        d_to_p = ndimage.distance_transform_edt(~bp)
        bprec = float((d_to_r[bp] <= tol).mean())
        brec = float((d_to_p[br] <= tol).mean())
        bf1 = 2 * bprec * brec / (bprec + brec) if bprec + brec else 0.0
    else:
        bprec = brec = bf1 = 0.0
    crop_px = int((p & crop[y0:y1, x0:x1]).sum()) if crop is not None else 0
    return {
        "iou": round(iou, 4), "dice": round(dice, 4), "boundary_f1": round(bf1, 4),
        "boundary_precision": round(bprec, 4), "boundary_recall": round(brec, 4),
        "fp_px": ps - inter, "fn_px": rs - inter, "crop_px": crop_px,
    }
