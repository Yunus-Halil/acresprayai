"""From a label image to the per-weed records the preview shows.

Coordinates: every number is in the ORIGINAL image's pixel coordinate system,
x to the right, y down, pixel centres at integer positions, even when inference
ran at a reduced processing scale. A value measured at processing scale s is
divided by s (lengths) or s squared (areas) and the record says so.

Geometry definitions are those of weedlab.phenobench.geometry.measure_mask:
area, max span (farthest pair of pixel centres), perpendicular span, minimum-
area oriented rectangle, solidity, pieces. Polygons are the outer contours of
the mask (skimage.measure.find_contours at 0.5 on a one-pixel-padded crop),
simplified with approximate_polygon at the given tolerance; holes are not
returned. Masks themselves are not returned unless asked, as run-length
encoded rows at processing scale.

Quality indicators (not confidence in any calibrated sense):
  score            mean P(weed) inside the instance (ERFNet algorithms) or mean ExG (colour algorithms)
  touches_border   the instance reaches the image edge: its span is a lower bound
  pieces           > 1 means the label is fragmented
  solidity         low values are thin or grass-like plants, where erosion and splitting are least reliable
  tiny             area at processing scale under 25 px: no boundary quality claim is defensible
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage
from skimage import measure

from weedlab.phenobench.geometry import measure_mask

TINY_PX = 25


def rle_encode(mask: np.ndarray) -> list[int]:
    """Row-major run lengths starting with a background run, COCO-style."""
    flat = np.concatenate([[0], mask.ravel().astype(np.int8), [0]])
    changes = np.flatnonzero(np.diff(flat))
    runs = np.diff(np.concatenate([[0], changes, [flat.size - 2]]))
    return [int(r) for r in runs]


def polygons_of(mask: np.ndarray, bbox: tuple[int, int, int, int], tolerance: float) -> list[list[list[float]]]:
    x0, y0, x1, y1 = bbox
    local = np.pad(mask[y0:y1, x0:x1], 1).astype(np.uint8)
    polys = []
    for c in measure.find_contours(local, 0.5):
        if len(c) < 4:
            continue
        simp = measure.approximate_polygon(c, tolerance) if tolerance > 0 else c
        # find_contours returns (row, col); shift by the 1-px pad and the crop origin
        poly = [[round(float(p[1]) - 1 + x0, 2), round(float(p[0]) - 1 + y0, 2)] for p in simp]
        polys.append(poly)
    polys.sort(key=len, reverse=True)
    return polys


GEOMETRY_MODES = ("full", "lite")


def measure_lite(mask: np.ndarray) -> dict:
    """The measures a map needs and nothing that needs a convex hull: area, centroid, box, equivalent diameter, pieces.
    Same definitions as measure_mask (pixel centres)."""
    ys, xs = np.nonzero(mask)
    if xs.size == 0:
        raise ValueError("empty mask")
    area = int(xs.size)
    _, n = ndimage.label(mask, structure=np.ones((3, 3), dtype=int))
    return {"area_px": area, "centroid": (float(xs.mean()), float(ys.mean())), "bbox": (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1),
            "equivalent_diameter_px": float(2.0 * np.sqrt(area / np.pi)), "n_components": int(n)}


def extract_instances(labels: np.ndarray, score_img: np.ndarray | None, scale: float, *, tolerance: float = 0.8, include_rle: bool = False, score_name: str = "mean_weed_probability", geometry: str = "full") -> tuple[list[dict], list[str]]:
    """Per-instance records in original coordinates. Returns (instances, warnings).

    geometry "lite" skips the hull-based measures (max span, perpendicular span, oriented box, solidity), returned as
    null: the map runs never read them, and they were 8% of a photo's service time (profile 2026-10-19)."""
    if geometry not in GEOMETRY_MODES:
        raise ValueError(f"geometry must be one of {GEOMETRY_MODES}")
    n = int(labels.max())
    out: list[dict] = []
    warnings: list[str] = []
    if n == 0:
        return out, warnings
    h, w = labels.shape
    objects = ndimage.find_objects(labels, max_label=n)
    inv = 1.0 / scale
    for k in range(1, n + 1):
        sl = objects[k - 1]
        if sl is None:
            continue
        ys, xs = sl
        local = labels[sl] == k
        # Geometry on the crop: every measure is translation-invariant, so the crop's
        # origin is added back afterwards. Measuring on the full image would make a
        # 50-megapixel photo with thousands of components quadratic in cost.
        ox, oy = int(xs.start), int(ys.start)
        if geometry == "lite":
            out.append(_lite_record(k, local, ox, oy, sl, score_img, inv, w, h, tolerance, include_rle, score_name))
            continue
        g = measure_mask(local)
        bbox = (g.bbox[0] + ox, g.bbox[1] + oy, g.bbox[2] + ox, g.bbox[3] + oy)
        polys = polygons_of(local, g.bbox, tolerance)
        polys = [[[x + ox, y + oy] for x, y in poly] for poly in polys]
        cxl, cyl = g.centroid
        (sx0, sy0), (sx1, sy1) = g.span_endpoints
        score = float(score_img[sl][local].mean()) if score_img is not None else None
        touches = bbox[0] == 0 or bbox[1] == 0 or bbox[2] == w or bbox[3] == h
        tiny = g.area_px < TINY_PX
        rec = {
            "id": k,
            "centroid_px": [round((cxl + ox) * inv, 2), round((cyl + oy) * inv, 2)],
            "bbox_px": [round(bbox[0] * inv, 1), round(bbox[1] * inv, 1), round(bbox[2] * inv, 1), round(bbox[3] * inv, 1)],
            "area_px": round(g.area_px * inv * inv, 1),
            "max_span_px": round(g.max_span_px * inv, 2),
            "span_endpoints_px": [[round((sx0 + ox) * inv, 1), round((sy0 + oy) * inv, 1)], [round((sx1 + ox) * inv, 1), round((sy1 + oy) * inv, 1)]],
            "perpendicular_span_px": round(g.perpendicular_span_px * inv, 2),
            "obb": {"length_px": round(g.obb_length_px * inv, 2), "width_px": round(g.obb_width_px * inv, 2), "angle_deg": round(g.obb_angle_deg, 1)},
            "equivalent_diameter_px": round(g.equivalent_diameter_px * inv, 2),
            "solidity": g.solidity,
            "pieces": g.n_components,
            "touches_border": bool(touches),
            "tiny": bool(tiny),
            "score": round(score, 4) if score is not None else None,
            "score_kind": score_name,
            "polygons_px": [[[round(x * inv, 2), round(y * inv, 2)] for x, y in p] for p in polys],
            "area_px_at_processing_scale": g.area_px,
        }
        if include_rle:
            rec["mask_rle_processing_scale"] = {"bbox": list(bbox), "rle": rle_encode(local)}
        flags = []
        if touches:
            flags.append("touches image border: span is a lower bound")
        if tiny:
            flags.append(f"under {TINY_PX} px at processing scale: boundary not reliable")
        if g.n_components > 1:
            flags.append(f"fragmented into {g.n_components} pieces")
        if g.solidity is not None and g.solidity < 0.3:
            flags.append("thin or grass-like shape: erosion and splitting least reliable")
        rec["flags"] = flags
        out.append(rec)
    n_tiny = sum(1 for r in out if r["tiny"])
    if n_tiny:
        warnings.append(f"{n_tiny} of {len(out)} instances are under {TINY_PX} px at processing scale; they are kept (no size floor) but their outlines are not reliable")
    n_border = sum(1 for r in out if r["touches_border"])
    if n_border:
        warnings.append(f"{n_border} instances touch the image border; their spans are lower bounds")
    return out, warnings


def _lite_record(k: int, local: np.ndarray, ox: int, oy: int, sl, score_img, inv: float, w: int, h: int, tolerance: float, include_rle: bool, score_name: str) -> dict:
    g = measure_lite(local)
    bbox = (g["bbox"][0] + ox, g["bbox"][1] + oy, g["bbox"][2] + ox, g["bbox"][3] + oy)
    polys = [[[x + ox, y + oy] for x, y in poly] for poly in polygons_of(local, g["bbox"], tolerance)]
    cxl, cyl = g["centroid"]
    score = float(score_img[sl][local].mean()) if score_img is not None else None
    touches = bbox[0] == 0 or bbox[1] == 0 or bbox[2] == w or bbox[3] == h
    tiny = g["area_px"] < TINY_PX
    rec = {
        "id": k,
        "centroid_px": [round((cxl + ox) * inv, 2), round((cyl + oy) * inv, 2)],
        "bbox_px": [round(bbox[0] * inv, 1), round(bbox[1] * inv, 1), round(bbox[2] * inv, 1), round(bbox[3] * inv, 1)],
        "area_px": round(g["area_px"] * inv * inv, 1),
        "max_span_px": None, "span_endpoints_px": None, "perpendicular_span_px": None, "obb": None,
        "equivalent_diameter_px": round(g["equivalent_diameter_px"] * inv, 2),
        "solidity": None,
        "pieces": g["n_components"],
        "touches_border": bool(touches),
        "tiny": bool(tiny),
        "score": round(score, 4) if score is not None else None,
        "score_kind": score_name,
        "polygons_px": [[[round(x * inv, 2), round(y * inv, 2)] for x, y in p] for p in polys],
        "area_px_at_processing_scale": g["area_px"],
        "geometry": "lite",
    }
    if include_rle:
        rec["mask_rle_processing_scale"] = {"bbox": list(bbox), "rle": rle_encode(local)}
    flags = []
    if touches:
        flags.append("touches image border: span is a lower bound")
    if tiny:
        flags.append(f"under {TINY_PX} px at processing scale: boundary not reliable")
    if g["n_components"] > 1:
        flags.append(f"fragmented into {g['n_components']} pieces")
    rec["flags"] = flags
    return rec
