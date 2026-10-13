"""What surrounds a weed instance: crops, other weeds, background, the image edge.

Definitions (pixels, between pixel centres, Euclidean):

- dist_to_crop_px: smallest distance from any pixel of the instance to any pixel
  whose semantic class is crop or partial crop. Computed from one distance
  transform of the whole image per sample. None when the image has no crop
  pixels at all (never happens in PhenoBench, but handled).
- dist_to_other_plant_px: smallest distance from any pixel of the instance to any
  pixel of a different plant instance (crop or weed). Computed inside a window
  of the instance's box grown by CONTEXT_PAD_PX; when nothing is inside the
  window the value is reported as CONTEXT_PAD_PX and `other_plant_capped` is
  True (read as "at least this far").
- nearest_other_kind: "crop", "weed" or None, for the plant that sets
  dist_to_other_plant_px.
- touching_ids: other plant instances with a pixel in the 8-neighbourhood of
  the instance's pixels (distance <= sqrt(2)); touching_crop / touching_weed
  count them by kind.
- ring_*: the ring of pixels within RING_PX of the instance but not in it
  (distance transform of the complement, <= RING_PX). ring_background,
  ring_crop, ring_weed are the shares of ring pixels with that semantic family;
  ring_weed counts weed-family pixels of OTHER instances only. They sum to 1
  up to the share belonging to the instance itself (zero by construction).
- border_dist_px: smallest distance from the instance's box to the image edge;
  0 when it touches.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from scipy import ndimage

from .reader import CROP_CLASSES, PLANT_CLASSES, WEED_CLASSES

CONTEXT_PAD_PX = 128
RING_PX = 32


@dataclass
class InstanceContext:
    dist_to_crop_px: float | None
    dist_to_other_plant_px: float
    other_plant_capped: bool
    nearest_other_kind: str | None
    touching_ids: list[int]
    touching_crop: int
    touching_weed: int
    ring_px: int
    ring_background: float
    ring_crop: float
    ring_weed: float
    border_dist_px: int

    def to_record(self) -> dict:
        d = asdict(self)
        d["touching_ids"] = " ".join(str(i) for i in self.touching_ids)
        return d


class ImageContext:
    """Per-image precomputation shared by all instances of that image."""

    def __init__(self, semantics: np.ndarray, plant_instances: np.ndarray):
        self.sem = semantics
        self.inst = plant_instances
        self.h, self.w = semantics.shape
        self.crop = np.isin(semantics, CROP_CLASSES)
        self.weed = np.isin(semantics, WEED_CLASSES)
        self.plant = np.isin(semantics, PLANT_CLASSES)
        self.crop_edt = ndimage.distance_transform_edt(~self.crop) if self.crop.any() else None

    def measure(self, instance_id: int, bbox: tuple[int, int, int, int], pad: int = CONTEXT_PAD_PX, ring: int = RING_PX) -> InstanceContext:
        x0, y0, x1, y1 = bbox
        wx0, wy0 = max(0, x0 - pad), max(0, y0 - pad)
        wx1, wy1 = min(self.w, x1 + pad), min(self.h, y1 + pad)
        win = (slice(wy0, wy1), slice(wx0, wx1))
        inst_w = self.inst[win]
        sem_w = self.sem[win]
        mask = inst_w == instance_id
        if not mask.any():
            raise ValueError(f"instance {instance_id} has no pixels in its own box")
        other = self.plant[win] & ~mask

        dist_crop = float(self.crop_edt[win][mask].min()) if self.crop_edt is not None else None

        if other.any():
            edt, idx = ndimage.distance_transform_edt(~other, return_indices=True)
            d = edt[mask]
            k = int(np.argmin(d))
            dist_other = float(d[k])
            capped = dist_other >= pad
            yy, xx = np.nonzero(mask)
            ny, nx = idx[0][yy[k], xx[k]], idx[1][yy[k], xx[k]]
            near_kind = "crop" if self.crop[win][ny, nx] else "weed"
        else:
            dist_other, capped, near_kind = float(pad), True, None

        # Touching: any other plant pixel in the 8-neighbourhood of the mask.
        grown1 = ndimage.binary_dilation(mask, structure=np.ones((3, 3), dtype=bool))
        touch_ids = np.unique(inst_w[grown1 & other])
        touch_ids = [int(i) for i in touch_ids if i != 0]
        touching_crop = sum(1 for i in touch_ids if self.crop[win][inst_w == i].any())
        touching_weed = len(touch_ids) - touching_crop

        # Ring: within `ring` px of the mask, outside it.
        edt_mask = ndimage.distance_transform_edt(~mask)
        ring_mask = (edt_mask > 0) & (edt_mask <= ring)
        n_ring = int(ring_mask.sum())
        if n_ring:
            ring_bg = float((sem_w[ring_mask] == 0).mean())
            ring_crop = float(self.crop[win][ring_mask].mean())
            ring_weed = float((self.weed[win] & ring_mask & (inst_w != instance_id)).sum() / n_ring)
        else:
            ring_bg = ring_crop = ring_weed = 0.0

        border = int(min(x0, y0, self.w - x1, self.h - y1))
        return InstanceContext(
            dist_to_crop_px=dist_crop,
            dist_to_other_plant_px=dist_other,
            other_plant_capped=bool(capped),
            nearest_other_kind=near_kind,
            touching_ids=touch_ids,
            touching_crop=int(touching_crop),
            touching_weed=int(touching_weed),
            ring_px=ring,
            ring_background=ring_bg,
            ring_crop=ring_crop,
            ring_weed=ring_weed,
            border_dist_px=border,
        )
