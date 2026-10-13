"""Classical vegetation detection: a colour index, a fixed decision rule, connected components.

Three methods, each parameter-free per image so nothing is tuned on a picture:

- exg_exr : chromaticity r, g, b = R, G, B / (R + G + B); ExG = 2g - r - b;
            ExR = 1.4 r - g; vegetation where ExG - ExR > 0 (Meyer and Neto 2008).
- exg_otsu: ExG on chromaticity, Otsu threshold over the whole image.
- hsv_band: hue in [60, 160] degrees, saturation >= 0.15, value >= 0.08 (fixed band).
- exg_fixed: ExG on chromaticity > t, with t a declared constant (default 0.10). The
            one method with a parameter; the value is chosen on dev_tune and
            confirmed on dev_check, and every run name carries it.

Then, optionally, one 3 x 3 binary closing (off by default), then 8-connected
components. No opening, no size floor, no hole filling: the Phase 2 profile
showed blades under 5 px wide and seedlings under 100 px, and any of those
operations would delete them before they could be scored.

Every component is a detection. Its score is the mean index value inside it
(ExG - ExR for exg_exr, ExG for exg_otsu, saturation for hsv_band); the score
is reported, never thresholded.

Stage timings are measured with perf_counter around each stage.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage
from skimage.filters import threshold_otsu

METHODS = ("exg_exr", "exg_otsu", "hsv_band", "exg_fixed")
DEFAULT_EXG_T = 0.10
EPS = 1e-6
STRUCT8 = np.ones((3, 3), dtype=bool)


@dataclass
class DetectionResult:
    method: str
    closing: bool
    labels: np.ndarray  # int32 HxW, 0 = background, 1..n = components
    n: int
    records: list[dict]  # per component: det_id, area_px, bbox, centroid, score
    timings_ms: dict[str, float] = field(default_factory=dict)
    threshold: float | None = None
    vegetation_fraction: float = 0.0


def chromaticity(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    x = rgb.astype(np.float32)
    s = x.sum(axis=2) + EPS
    return x[..., 0] / s, x[..., 1] / s, x[..., 2] / s


def index_exg(rgb: np.ndarray) -> np.ndarray:
    r, g, b = chromaticity(rgb)
    return 2.0 * g - r - b


def index_exg_exr(rgb: np.ndarray) -> np.ndarray:
    r, g, b = chromaticity(rgb)
    exg = 2.0 * g - r - b
    exr = 1.4 * r - g
    return exg - exr


def hsv(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Hue in degrees [0, 360), saturation and value in [0, 1]. Vectorised, no dependency."""
    x = rgb.astype(np.float32) / 255.0
    r, g, b = x[..., 0], x[..., 1], x[..., 2]
    mx = x.max(axis=2)
    mn = x.min(axis=2)
    d = mx - mn
    h = np.zeros_like(mx)
    nz = d > 0
    rm = nz & (mx == r)
    gm = nz & (mx == g) & ~rm
    bm = nz & ~rm & ~gm
    h[rm] = (60.0 * ((g[rm] - b[rm]) / d[rm])) % 360.0
    h[gm] = 60.0 * ((b[gm] - r[gm]) / d[gm]) + 120.0
    h[bm] = 60.0 * ((r[bm] - g[bm]) / d[bm]) + 240.0
    s = np.where(mx > 0, d / (mx + EPS), 0.0)
    return h, s, mx


def vegetation_mask(rgb: np.ndarray, method: str, exg_t: float = DEFAULT_EXG_T) -> tuple[np.ndarray, np.ndarray, float | None]:
    """Return (mask, score_image, threshold_used)."""
    if method == "exg_exr":
        idx = index_exg_exr(rgb)
        return idx > 0.0, idx, 0.0
    if method == "exg_fixed":
        idx = index_exg(rgb)
        return idx > exg_t, idx, float(exg_t)
    if method == "exg_otsu":
        idx = index_exg(rgb)
        t = float(threshold_otsu(idx)) if idx.max() > idx.min() else float(idx.max())
        return idx > t, idx, t
    if method == "hsv_band":
        h, s, v = hsv(rgb)
        return (h >= 60.0) & (h <= 160.0) & (s >= 0.15) & (v >= 0.08), s, None
    raise ValueError(f"unknown method {method!r}")


def detect(rgb: np.ndarray, method: str = "exg_exr", closing: bool = False, exg_t: float = DEFAULT_EXG_T) -> DetectionResult:
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ValueError("expected an HxWx3 RGB image")
    t: dict[str, float] = {}
    t0 = time.perf_counter()
    mask, score_img, thr = vegetation_mask(rgb, method, exg_t)
    t["index_and_threshold"] = (time.perf_counter() - t0) * 1000.0
    if closing:
        t1 = time.perf_counter()
        mask = ndimage.binary_closing(mask, structure=STRUCT8)
        t["closing"] = (time.perf_counter() - t1) * 1000.0
    t2 = time.perf_counter()
    labels, n = ndimage.label(mask, structure=STRUCT8)
    labels = labels.astype(np.int32)
    t["components"] = (time.perf_counter() - t2) * 1000.0
    t3 = time.perf_counter()
    records: list[dict] = []
    if n:
        objects = ndimage.find_objects(labels, max_label=n)
        areas = np.bincount(labels.ravel(), minlength=n + 1)
        sums = ndimage.sum_labels(score_img, labels, index=np.arange(1, n + 1))
        cy, cx = zip(*ndimage.center_of_mass(mask, labels, index=np.arange(1, n + 1))) if n else ((), ())
        for k in range(1, n + 1):
            ys, xs = objects[k - 1]
            records.append(
                {
                    "det_id": k,
                    "area_px": int(areas[k]),
                    "bbox_x0": int(xs.start), "bbox_y0": int(ys.start), "bbox_x1": int(xs.stop), "bbox_y1": int(ys.stop),
                    "centroid_x": float(cx[k - 1]), "centroid_y": float(cy[k - 1]),
                    "score": float(sums[k - 1] / areas[k]),
                }
            )
    t["measure"] = (time.perf_counter() - t3) * 1000.0
    t["total"] = (time.perf_counter() - t0) * 1000.0
    return DetectionResult(
        method=method, closing=closing, labels=labels, n=int(n), records=records,
        timings_ms={k: round(v, 3) for k, v in t.items()}, threshold=thr,
        vegetation_fraction=float(mask.mean()),
    )
