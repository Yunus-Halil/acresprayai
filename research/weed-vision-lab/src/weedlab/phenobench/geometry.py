"""Shape measurements of one binary mask, in pixels, with exact definitions.

All distances are between pixel centres: a pixel at column x has centre x, so a
one-pixel mask has span 0 and a horizontal run of n pixels has span n - 1. The
"+1 for pixel extent" convention is deliberately not applied here so the numbers
stay comparable with centroid and distance-transform values, which also use
centres. Callers that want extents add 1.

- area_px: number of mask pixels.
- max_span_px: the greatest Euclidean distance between two mask pixel centres.
  Computed over the convex hull vertices (the farthest pair of a point set is a
  pair of hull vertices).
- obb_length_px, obb_width_px, obb_angle_deg: the minimum-area rectangle that
  encloses all mask pixel centres, found by rotating calipers over the hull's
  edge directions. length >= width. angle is the long side's direction from the
  +x axis, in degrees, in [0, 180).
- perpendicular_span_px: extent of the mask pixel centres measured perpendicular
  to the max-span axis.
- hull_area_px, solidity: area of the convex hull of the pixel centres (shoelace
  on hull vertices) and area_px / hull_area_px. A degenerate hull (fewer than
  three non-collinear points) gives None for both.
- equivalent_diameter_px: 2 * sqrt(area / pi).
- n_components, largest_component_px: 8-connected pieces of the mask.
- centroid: mean of the pixel centres, (x, y).
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import numpy as np
from scipy import ndimage
from scipy.spatial import ConvexHull, QhullError


@dataclass
class MaskGeometry:
    area_px: int
    centroid: tuple[float, float]
    bbox: tuple[int, int, int, int]
    max_span_px: float
    span_endpoints: tuple[tuple[float, float], tuple[float, float]]
    perpendicular_span_px: float
    obb_length_px: float
    obb_width_px: float
    obb_angle_deg: float
    hull_area_px: float | None
    solidity: float | None
    equivalent_diameter_px: float
    n_components: int
    largest_component_px: int

    def to_record(self) -> dict:
        d = asdict(self)
        d["centroid_x"], d["centroid_y"] = d.pop("centroid")
        (ax, ay), (bx, by) = d.pop("span_endpoints")
        d["span_x0"], d["span_y0"], d["span_x1"], d["span_y1"] = ax, ay, bx, by
        d["bbox_x0"], d["bbox_y0"], d["bbox_x1"], d["bbox_y1"] = d.pop("bbox")
        return d


def _hull_points(pts: np.ndarray) -> np.ndarray | None:
    """Convex hull vertices in order, or None when the hull is degenerate."""
    if len(pts) < 3:
        return None
    try:
        hull = ConvexHull(pts)
    except QhullError:
        return None
    return pts[hull.vertices]


def _farthest_pair(pts: np.ndarray) -> tuple[float, int, int]:
    """Max pairwise distance over a small point set (hull vertices)."""
    if len(pts) == 1:
        return 0.0, 0, 0
    d2 = ((pts[:, None, :] - pts[None, :, :]) ** 2).sum(-1)
    i, j = np.unravel_index(int(np.argmax(d2)), d2.shape)
    return float(math.sqrt(d2[i, j])), int(i), int(j)


def _min_area_rect(hull: np.ndarray) -> tuple[float, float, float]:
    """Rotating calipers over hull edge directions. Returns (length, width, angle_deg)."""
    best = None
    n = len(hull)
    for k in range(n):
        e = hull[(k + 1) % n] - hull[k]
        norm = math.hypot(e[0], e[1])
        if norm == 0:
            continue
        ux, uy = e[0] / norm, e[1] / norm
        proj_u = hull @ np.array([ux, uy])
        proj_v = hull @ np.array([-uy, ux])
        lu = proj_u.max() - proj_u.min()
        lv = proj_v.max() - proj_v.min()
        area = lu * lv
        if best is None or area < best[0] - 1e-9:
            if lu >= lv:
                ang = math.degrees(math.atan2(uy, ux))
                best = (area, lu, lv, ang)
            else:
                ang = math.degrees(math.atan2(ux, -uy))
                best = (area, lv, lu, ang)
    if best is None:
        return 0.0, 0.0, 0.0
    _, length, width, ang = best
    ang = ang % 180.0
    return float(length), float(width), float(ang)


def _shoelace(pts: np.ndarray) -> float:
    x, y = pts[:, 0], pts[:, 1]
    return float(0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))


def measure_mask(mask: np.ndarray) -> MaskGeometry:
    """Measure a boolean mask. Raises ValueError on an empty mask."""
    ys, xs = np.nonzero(mask)
    if xs.size == 0:
        raise ValueError("empty mask")
    area = int(xs.size)
    pts = np.stack([xs, ys], axis=1).astype(np.float64)  # (x, y) pixel centres
    cx, cy = float(xs.mean()), float(ys.mean())
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)

    hull = _hull_points(pts)
    if hull is None:
        # Degenerate: a point, a line, or collinear pixels. Use all points directly
        # (sets this small are cheap) and an axis-aligned fallback for the box.
        uniq = np.unique(pts, axis=0)
        span, i, j = _farthest_pair(uniq)
        a, b = uniq[i], uniq[j]
        if span > 0:
            ux, uy = (b - a) / span
            perp = pts @ np.array([-uy, ux])
            perp_span = float(perp.max() - perp.min())
            length, width, ang = span, perp_span, math.degrees(math.atan2(uy, ux)) % 180.0
        else:
            perp_span, length, width, ang = 0.0, 0.0, 0.0, 0.0
        hull_area = None
        solidity = None
    else:
        span, i, j = _farthest_pair(hull)
        a, b = hull[i], hull[j]
        ux, uy = (b - a) / span
        perp = hull @ np.array([-uy, ux])
        perp_span = float(perp.max() - perp.min())
        length, width, ang = _min_area_rect(hull)
        hull_area = _shoelace(hull)
        # Pixel-centre hull area under-counts a pixel polygon's true area; the
        # ratio is still the standard solidity measure and is capped at 1.
        solidity = min(1.0, area / hull_area) if hull_area > 0 else None

    lab, n = ndimage.label(mask, structure=np.ones((3, 3), dtype=int))
    largest = int(np.bincount(lab.ravel())[1:].max()) if n else 0
    return MaskGeometry(
        area_px=area,
        centroid=(cx, cy),
        bbox=bbox,
        max_span_px=float(span),
        span_endpoints=((float(a[0]), float(a[1])), (float(b[0]), float(b[1]))),
        perpendicular_span_px=perp_span,
        obb_length_px=length,
        obb_width_px=width,
        obb_angle_deg=ang,
        hull_area_px=hull_area,
        solidity=solidity,
        equivalent_diameter_px=float(2.0 * math.sqrt(area / math.pi)),
        n_components=int(n),
        largest_component_px=largest,
    )
