"""Boundary refinement of the ERFNet weed mask. Input: RGB, probabilities (3, H, W). Output: a weed mask.

Every method starts from the argmax weed mask (the seed) and may only ADD pixels
that are (a) within `radius` px of the seed, (b) not argmax crop, and (c)
connected to the seed through the admitted pixels (hysteresis). Nothing is ever
removed from the seed, so refinement cannot lower the baseline's coverage; it
can only add correct boundary pixels or false ones, which is what the scoring
has to decide.

Methods:
- argmax      : the seed itself (A1).
- exg_hyst    : admit pixels with ExG > low (A2).
- prob        : admit pixels with P(weed) > t_low and P(weed) >= P(crop) (A3).
- edge        : admit pixels whose chromaticity is within `colour_tol` of the
                mean chromaticity of the nearest seed component, and whose
                gradient magnitude does not exceed `edge_max` (A4). The second
                condition stops growth at a sharp edge; the first stops it on
                soil.
- hybrid      : prob OR (exg_hyst AND edge) (A5).
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

from weedlab.detect.classical import STRUCT8, chromaticity, index_exg

BG, CROP, WEED = 0, 1, 2


def seed_and_argmax(prob: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    cls = np.argmax(prob, axis=0).astype(np.uint8)
    return cls == WEED, cls


def grow(seed: np.ndarray, admit: np.ndarray, forbid: np.ndarray, radius: int) -> np.ndarray:
    """Hysteresis growth: components of (seed | admit) & ~forbid within `radius` of the seed, keeping only those containing seed pixels."""
    if not seed.any():
        return seed
    near = ndimage.distance_transform_edt(~seed) <= radius
    cand = (seed | (admit & near)) & ~(forbid & ~seed)
    labels, n = ndimage.label(cand, structure=STRUCT8)
    if n == 0:
        return seed
    keep = np.zeros(n + 1, bool)
    keep[np.unique(labels[seed])] = True
    keep[0] = False
    return keep[labels]


def refine_exg_hyst(rgb: np.ndarray, prob: np.ndarray, low: float = 0.03, radius: int = 8) -> np.ndarray:
    seed, cls = seed_and_argmax(prob)
    return grow(seed, index_exg(rgb) > low, cls == CROP, radius)


def refine_prob(rgb: np.ndarray, prob: np.ndarray, t_low: float = 0.2, radius: int = 8) -> np.ndarray:
    seed, cls = seed_and_argmax(prob)
    admit = (prob[WEED] > t_low) & (prob[WEED] >= prob[CROP])
    return grow(seed, admit, cls == CROP, radius)


def gradient_magnitude(rgb: np.ndarray) -> np.ndarray:
    g = rgb.astype(np.float32).mean(axis=2) / 255.0
    gx = ndimage.sobel(g, axis=1)
    gy = ndimage.sobel(g, axis=0)
    return np.hypot(gx, gy)


def refine_edge(rgb: np.ndarray, prob: np.ndarray, colour_tol: float = 0.04, edge_max: float = 0.35, radius: int = 8, low_exg: float = 0.0) -> np.ndarray:
    seed, cls = seed_and_argmax(prob)
    if not seed.any():
        return seed
    r, g, b = chromaticity(rgb)
    labels, n = ndimage.label(seed, structure=STRUCT8)
    idx = np.arange(1, n + 1)
    means = np.stack([ndimage.mean(c, labels, idx) for c in (r, g, b)], axis=1)  # (n, 3)
    # Nearest seed component for every pixel within reach.
    edt, (iy, ix) = ndimage.distance_transform_edt(~seed, return_indices=True)
    near_lab = labels[iy, ix]
    ref = means[np.clip(near_lab - 1, 0, max(0, n - 1))]
    dist = np.sqrt((r - ref[..., 0]) ** 2 + (g - ref[..., 1]) ** 2 + (b - ref[..., 2]) ** 2)
    admit = (dist <= colour_tol) & (gradient_magnitude(rgb) <= edge_max) & (index_exg(rgb) > low_exg)
    return grow(seed, admit, cls == CROP, radius)


def refine_hybrid(rgb: np.ndarray, prob: np.ndarray, t_low: float = 0.2, low: float = 0.03, colour_tol: float = 0.04, edge_max: float = 0.35, radius: int = 8) -> np.ndarray:
    seed, cls = seed_and_argmax(prob)
    if not seed.any():
        return seed
    admit_p = (prob[WEED] > t_low) & (prob[WEED] >= prob[CROP])
    r, g, b = chromaticity(rgb)
    labels, n = ndimage.label(seed, structure=STRUCT8)
    idx = np.arange(1, n + 1)
    means = np.stack([ndimage.mean(c, labels, idx) for c in (r, g, b)], axis=1)
    _, (iy, ix) = ndimage.distance_transform_edt(~seed, return_indices=True)
    ref = means[np.clip(labels[iy, ix] - 1, 0, max(0, n - 1))]
    dist = np.sqrt((r - ref[..., 0]) ** 2 + (g - ref[..., 1]) ** 2 + (b - ref[..., 2]) ** 2)
    admit_c = (index_exg(rgb) > low) & (dist <= colour_tol) & (gradient_magnitude(rgb) <= edge_max)
    return grow(seed, admit_p | admit_c, cls == CROP, radius)


REFINERS = {
    "argmax": lambda rgb, prob, **kw: seed_and_argmax(prob)[0],
    "exg_hyst": refine_exg_hyst,
    "prob": refine_prob,
    "edge": refine_edge,
    "hybrid": refine_hybrid,
}


# ---------------------------------------------------------------------------
# Tightening refiners (Experiment 5, second round). The first round showed the
# argmax weed mask is already larger than the reference (pixel recall 0.95,
# precision 0.72 on A+B); these REMOVE pixels from the seed instead of adding.
# ---------------------------------------------------------------------------

def refine_prob_high(rgb: np.ndarray, prob: np.ndarray, t_high: float = 0.6, **_) -> np.ndarray:
    """Keep argmax-weed pixels whose P(weed) >= t_high. Removes the low-confidence rim."""
    seed, _ = seed_and_argmax(prob)
    return seed & (prob[WEED] >= t_high)


def refine_exg_trim(rgb: np.ndarray, prob: np.ndarray, t_exg: float = 0.0, **_) -> np.ndarray:
    """Keep argmax-weed pixels whose ExG > t_exg: drops soil-coloured halo pixels, keeps green ones."""
    seed, _ = seed_and_argmax(prob)
    return seed & (index_exg(rgb) > t_exg)


def refine_erode(rgb: np.ndarray, prob: np.ndarray, px: int = 1, **_) -> np.ndarray:
    """Binary erosion by px (3x3 cross), the crude comparator for the two above."""
    seed, _ = seed_and_argmax(prob)
    return ndimage.binary_erosion(seed, structure=np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool), iterations=px, border_value=0)


def refine_prob_high_exg(rgb: np.ndarray, prob: np.ndarray, t_high: float = 0.6, t_exg: float = 0.0, **_) -> np.ndarray:
    """Both conditions: confidence and colour."""
    seed, _ = seed_and_argmax(prob)
    return seed & (prob[WEED] >= t_high) & (index_exg(rgb) > t_exg)


REFINERS.update({
    "prob_high": refine_prob_high,
    "exg_trim": refine_exg_trim,
    "erode": refine_erode,
    "prob_high_exg": refine_prob_high_exg,
})


def refine_erode_keep_high(rgb: np.ndarray, prob: np.ndarray, px: int = 1, keep: float = 0.9, **_) -> np.ndarray:
    """Erosion by px, but a seed pixel with P(weed) >= keep survives it: removes the low-confidence rim, spares thin confident leaves."""
    seed, _ = seed_and_argmax(prob)
    er = ndimage.binary_erosion(seed, structure=np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool), iterations=px, border_value=0)
    return er | (seed & (prob[WEED] >= keep))


REFINERS["erode_keep_high"] = refine_erode_keep_high
