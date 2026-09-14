"""Vegetation masking from RGB, via normalised chromaticity.

STUB. No implementation yet.

Raw RGB is never thresholded here. A shaded corn leaf and a sunlit corn leaf
differ enormously in RGB and barely at all in chromaticity, so normalising by
intensity first is the entire shadow strategy. Everything after it depends on
that one step.

Indices used: ExG = 2g - r - b, and CIVE = 0.441r - 0.811g + 0.385b + 18.78745,
both on chromaticity, combined and thresholded with Otsu per window.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

CIVE_COEFFICIENTS = (0.441, -0.811, 0.385, 18.78745)


@dataclass(frozen=True)
class VegetationParams:
    """Thresholds and kernels, all in ground units.

    Args:
        open_radius_mm: Morphological opening radius, millimetres of ground.
            Removes speckle smaller than a real seedling.
        close_radius_mm: Morphological closing radius, millimetres of ground.
            Rejoins a leaf split by a shadow across its midrib.
        otsu_min_spread: Minimum separation between the two Otsu modes for the
            per-window threshold to be trusted. Below it, the window is nearly
            all soil or nearly all canopy and the global fallback is used.
        global_threshold: Fallback threshold for those windows. ``None`` means
            derive it from the whole-raster histogram in a first pass.
        cive_weight: Weight of CIVE against ExG in the combined index.
    """

    open_radius_mm: float = 3.0
    close_radius_mm: float = 5.0
    otsu_min_spread: float = 0.05
    global_threshold: float | None = None
    cive_weight: float = 0.5


def chromaticity(rgb: np.ndarray) -> np.ndarray:
    """Normalise RGB to ``r = R/(R+G+B)`` and so on.

    Args:
        rgb: HxWx3, any dtype.

    Returns:
        HxWx3 float32 summing to 1 along the last axis. Pixels where the sum is
        zero are returned as zeros rather than NaN, so downstream indices stay
        finite in shadowed black.
    """
    raise NotImplementedError


def exg(chroma: np.ndarray) -> np.ndarray:
    """Excess green, ``2g - r - b``, on chromaticity."""
    raise NotImplementedError


def cive(chroma: np.ndarray) -> np.ndarray:
    """Colour index of vegetation extraction, on chromaticity.

    Lower means more vegetation, opposite to ExG, so it is negated before
    combining.
    """
    raise NotImplementedError


def combined_index(rgb: np.ndarray, params: VegetationParams | None = None) -> np.ndarray:
    """ExG and CIVE combined into one float index. Higher means more vegetation."""
    raise NotImplementedError


def otsu_threshold(index: np.ndarray, params: VegetationParams | None = None) -> tuple[float, bool]:
    """Otsu threshold for one window.

    Returns:
        ``(threshold, used_fallback)``. The flag matters: a window that fell
        back is a window where the mask is only as good as the global estimate,
        and that should be visible rather than silent.
    """
    raise NotImplementedError


def vegetation_mask(
    rgb: np.ndarray,
    gsd_m: float,
    params: VegetationParams | None = None,
) -> np.ndarray:
    """Boolean vegetation mask for one window.

    ``gsd_m`` is required, not inferred: the morphological kernels are specified
    in millimetres of ground and converted here. The same scene at two
    different GSDs must produce masks of the same ground area, and that property
    lives or dies in this function.

    Returns:
        HxW boolean array, True where vegetation.
    """
    raise NotImplementedError


def mask_area_m2(mask: np.ndarray, gsd_m: float) -> float:
    """Ground area of a mask, in square metres."""
    raise NotImplementedError
