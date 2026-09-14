"""Windowed raster access, boundary clipping, and ground units.

STUB. No implementation yet.

A 100 acre field at 5 mm/px is on the order of 16 billion pixels, so no code
path in this repo may load a full raster. Everything reads through windows with
overlap, and blobs that straddle a window boundary are merged rather than
double-counted or truncated. That merge is the single most likely source of a
silent wrong answer in this repo, which is why it lives in one place.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np


@dataclass(frozen=True)
class WindowChip:
    """One window of a raster, carrying everything needed to georeference it."""

    array: np.ndarray
    transform: Any  # affine.Affine
    window: Any  # rasterio.windows.Window
    gsd_m: float
    crs: Any = None

    @property
    def interior_slice(self) -> tuple[slice, slice]:
        """The part of this chip that is not overlap with a neighbour.

        Features are kept from the chip whose interior contains their centroid,
        which is what makes the seam merge deterministic.
        """
        raise NotImplementedError


def gsd_m(transform: Any) -> float:
    """Ground sample distance in metres from a raster transform.

    Raises:
        ValueError: If the transform is anisotropic beyond tolerance. A raster
            with different x and y scales would silently break every
            ground-unit threshold in the repo.
    """
    raise NotImplementedError


def m_to_px(metres: float, transform: Any) -> float:
    """Convert a ground distance to pixels for this raster.

    All thresholds in this repo are stated in ground units and converted at the
    call site. This is that conversion.
    """
    raise NotImplementedError


def px_to_m(pixels: float, transform: Any) -> float:
    """Convert pixels to a ground distance for this raster."""
    raise NotImplementedError


def iter_windows(
    path: Path,
    window_m: float = 100.0,
    overlap_m: float = 2.0,
    boundary: Any = None,
    bands: tuple[int, ...] = (1, 2, 3),
) -> Iterator[WindowChip]:
    """Yield overlapping windows across a raster, in ground units.

    Args:
        path: Raster to read.
        window_m: Window edge length in metres, not pixels, so the memory cost
            of a window is independent of GSD only in ground terms; callers at
            very fine GSD should reduce it.
        overlap_m: Overlap between neighbouring windows. Must exceed the largest
            expected blob diameter, so that any blob appears whole in at least
            one window.
        boundary: Optional field boundary geometry; windows outside it are
            skipped entirely rather than read and discarded.
        bands: Band indices to read, 1-based as rasterio counts them.

    Yields:
        :class:`WindowChip` per window, in row-major order.
    """
    raise NotImplementedError


def clip_to_boundary(
    array: np.ndarray, transform: Any, boundary: Any, invert: bool = False
) -> np.ndarray:
    """Mask array pixels outside (or inside, if ``invert``) a boundary geometry."""
    raise NotImplementedError


def inward_buffer(boundary: Any, buffer_m: float) -> Any:
    """Shrink a boundary by ``buffer_m`` metres.

    Headlands and end rows are where the crop geometry stops being a grid, and
    therefore where most early false positives live. Excluding them is cheaper
    than explaining them.
    """
    raise NotImplementedError


def merge_across_seams(features: list[dict], overlap_m: float) -> list[dict]:
    """Merge features from overlapping windows into one deduplicated list.

    A feature is kept once, from the window whose interior contains its
    centroid. Features touching a seam are unioned by geometry before that test
    so a blob split across two windows becomes one blob with the correct area,
    not two half-sized ones.
    """
    raise NotImplementedError
