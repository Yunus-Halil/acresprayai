"""Turn the semantic and plant-instance masks into per-plant records.

A plant instance id says nothing about weed or crop on its own; the semantic
mask does. Every pixel of an instance is looked up in the semantic mask and the
instance is called a weed when its weed-family pixels (2 or 4) outnumber its
crop-family pixels (1 or 3). An instance whose pixels fall in both families is
flagged `mixed`; such cases are reported, never silently resolved.

Partial plants (classes 3 and 4, under 50% visible per the README) are kept and
flagged by default so the caller can choose a policy; `include_partial=False`
drops them.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from scipy import ndimage

from .reader import (
    BACKGROUND,
    CROP,
    CROP_CLASSES,
    PARTIAL_CROP,
    PARTIAL_WEED,
    WEED,
    WEED_CLASSES,
)


@dataclass
class PlantInstance:
    instance_id: int
    kind: str  # "weed", "crop" or "unlabelled"
    partial: bool  # majority of pixels in a partial class
    mixed: bool  # pixels in both the crop family and the weed family
    area_px: int
    bbox: tuple[int, int, int, int]  # x0, y0, x1, y1; half-open, pixel indices
    centroid: tuple[float, float]  # x, y in pixels, mean of mask pixels
    touches_border: bool
    pixels_by_class: dict[str, int]
    visibility_mean: float | None  # mean of plant_visibility over the mask, 0..255
    n_leaves: int | None  # distinct leaf ids inside the mask

    @property
    def bbox_wh(self) -> tuple[int, int]:
        x0, y0, x1, y1 = self.bbox
        return x1 - x0, y1 - y0

    def to_record(self) -> dict:
        d = asdict(self)
        d["bbox_w"], d["bbox_h"] = self.bbox_wh
        return d


def instance_mask(plant_instances: np.ndarray, instance_id: int) -> np.ndarray:
    return plant_instances == instance_id


def extract_plant_instances(
    semantics: np.ndarray,
    plant_instances: np.ndarray,
    plant_visibility: np.ndarray | None = None,
    leaf_instances: np.ndarray | None = None,
    include_partial: bool = True,
) -> list[PlantInstance]:
    if semantics.shape != plant_instances.shape:
        raise ValueError("semantics and plant_instances must share a shape")
    h, w = semantics.shape
    ids = np.unique(plant_instances)
    ids = ids[ids != 0]
    out: list[PlantInstance] = []
    if ids.size == 0:
        return out
    # One labelled pass for the bounding boxes instead of a np.where per id.
    objects = ndimage.find_objects(plant_instances.astype(np.int64), max_label=int(ids.max()))
    for iid in ids.tolist():
        sl = objects[iid - 1]
        if sl is None:
            continue
        ys, xs = sl
        local = plant_instances[sl] == iid
        sem_local = semantics[sl][local]
        counts = {
            "background": int(np.count_nonzero(sem_local == BACKGROUND)),
            "crop": int(np.count_nonzero(sem_local == CROP)),
            "weed": int(np.count_nonzero(sem_local == WEED)),
            "partial_crop": int(np.count_nonzero(sem_local == PARTIAL_CROP)),
            "partial_weed": int(np.count_nonzero(sem_local == PARTIAL_WEED)),
        }
        weed_px = counts["weed"] + counts["partial_weed"]
        crop_px = counts["crop"] + counts["partial_crop"]
        if weed_px == 0 and crop_px == 0:
            kind = "unlabelled"
        else:
            kind = "weed" if weed_px > crop_px else "crop"
        partial_px = counts["partial_weed"] + counts["partial_crop"]
        partial = partial_px > (weed_px + crop_px) / 2
        if partial and not include_partial:
            continue
        mixed = weed_px > 0 and crop_px > 0
        area = int(local.sum())
        yy, xx = np.nonzero(local)
        cx = float(xx.mean() + xs.start)
        cy = float(yy.mean() + ys.start)
        bbox = (int(xs.start), int(ys.start), int(xs.stop), int(ys.stop))
        touches = xs.start == 0 or ys.start == 0 or xs.stop == w or ys.stop == h
        vis_mean = None
        if plant_visibility is not None:
            vis_mean = float(plant_visibility[sl][local].mean())
        n_leaves = None
        if leaf_instances is not None:
            leaf_ids = np.unique(leaf_instances[sl][local])
            n_leaves = int(np.count_nonzero(leaf_ids))
        out.append(
            PlantInstance(
                instance_id=int(iid),
                kind=kind,
                partial=bool(partial),
                mixed=bool(mixed),
                area_px=area,
                bbox=bbox,
                centroid=(cx, cy),
                touches_border=bool(touches),
                pixels_by_class=counts,
                visibility_mean=vis_mean,
                n_leaves=n_leaves,
            )
        )
    return out


def weed_instances(instances: list[PlantInstance], include_partial: bool = True) -> list[PlantInstance]:
    return [p for p in instances if p.kind == "weed" and (include_partial or not p.partial)]


def crop_instances(instances: list[PlantInstance], include_partial: bool = True) -> list[PlantInstance]:
    return [p for p in instances if p.kind == "crop" and (include_partial or not p.partial)]


def weed_only_mask(plant_instances: np.ndarray, instances: list[PlantInstance]) -> np.ndarray:
    """Instance-id mask restricted to weed instances; everything else 0. Keeps the original ids."""
    keep = np.array([p.instance_id for p in instances if p.kind == "weed"], dtype=plant_instances.dtype)
    out = np.where(np.isin(plant_instances, keep), plant_instances, 0)
    return out.astype(plant_instances.dtype)


def semantic_weed_pixels(semantics: np.ndarray) -> np.ndarray:
    return np.isin(semantics, WEED_CLASSES)


def semantic_crop_pixels(semantics: np.ndarray) -> np.ndarray:
    return np.isin(semantics, CROP_CLASSES)
