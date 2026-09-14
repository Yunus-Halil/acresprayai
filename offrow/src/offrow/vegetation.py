"""Vegetation masking from RGB, via normalized chromaticity.

Raw RGB is never thresholded here. A shaded corn leaf and a sunlit corn leaf
differ enormously in RGB and barely at all in chromaticity, so normalising by
intensity first is the entire shadow strategy. Everything after it depends on
that one step.

Indices used: ExG = 2g - r - b, and CIVE = 0.441r - 0.811g + 0.385b + 18.78745,
both on chromaticity, combined and thresholded with Otsu per window.

**On CIVE's constant.** The 18.78745 comes from the original formulation on raw
0 to 255 digital numbers. On chromaticity, where the channels sum to one, it is
an additive offset roughly twenty times larger than the signal it is attached
to. It cannot change any threshold, since Otsu is shift-equivariant, but it does
make a weighted sum with ExG meaningless: the weight would be scaling a constant.
So :func:`cive` returns the index exactly as specified, for anyone comparing
against the literature, and :func:`cive_signal` returns the part that carries
information, negated so that higher means more vegetation like ExG. The combined
index uses the latter.

**On area.** A binary mask's ground area is not GSD-invariant for objects a few
pixels across: a hard threshold on a soft edge adds about half a pixel of rim,
which is a few percent of a 12 cm plant and about a fifth of a 3 cm seedling.
That is measured, not feared. :func:`vegetation_coverage` returns the sub-pixel
coverage that is invariant, and :func:`coverage_area_m2` uses it. Callers that
need a stable ground area should prefer it to counting mask pixels.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

CIVE_COEFFICIENTS = (0.441, -0.811, 0.385, 18.78745)

#: Range the combined index is histogrammed over for the global fallback. ExG on
#: chromaticity spans [-1, 2]; the CIVE term widens it slightly.
INDEX_RANGE = (-1.5, 2.5)
HISTOGRAM_BINS = 512


@dataclass(frozen=True)
class VegetationParams:
    """Thresholds and kernels, all in ground units.

    Args:
        open_radius_mm: Morphological opening radius, millimetres of ground.
            Removes speckle smaller than a real seedling.
        close_radius_mm: Morphological closing radius, millimetres of ground.
            Rejoins a leaf split by a shadow across its midrib.
        otsu_min_spread: Minimum separation between the two Otsu class means for
            the per-window threshold to be trusted. Below it, the window is
            nearly all soil or nearly all canopy and the global fallback is used.
        global_threshold: Fallback threshold for those windows. ``None`` means
            derive it from the whole-raster histogram in a first pass; see
            :func:`global_threshold_from_windows`.
        cive_weight: Weight of the CIVE signal against ExG in the combined index.
        soil_percentile: Percentile of the index taken as pure soil when
            unmixing sub-pixel coverage.
        plant_percentile: Percentile taken as pure plant.
    """

    open_radius_mm: float = 3.0
    close_radius_mm: float = 5.0
    otsu_min_spread: float = 0.05
    global_threshold: float | None = None
    cive_weight: float = 0.5
    soil_percentile: float = 20.0
    plant_percentile: float = 99.5


DEFAULT_PARAMS = VegetationParams()


@dataclass(frozen=True)
class MaskResult:
    """A window's mask plus the diagnostics that say how much to trust it."""

    mask: np.ndarray
    coverage: np.ndarray
    threshold: float
    used_fallback: bool
    gsd_m: float
    open_radius_px: int
    close_radius_px: int

    @property
    def area_m2(self) -> float:
        """Ground area by counting mask pixels. Not GSD-invariant for small objects."""
        return mask_area_m2(self.mask, self.gsd_m)

    @property
    def coverage_area_m2(self) -> float:
        """Ground area by sub-pixel coverage. The GSD-invariant one."""
        return coverage_area_m2(self.coverage, self.gsd_m)

    @property
    def effective_open_radius_mm(self) -> float:
        """Ground radius of the opening actually applied, which is not the request.

        A ground-unit kernel can only be honoured in whole pixels. This is what
        the imagery actually saw.
        """
        return self.open_radius_px * self.gsd_m * 1000.0

    @property
    def effective_close_radius_mm(self) -> float:
        """Ground radius of the closing actually applied."""
        return self.close_radius_px * self.gsd_m * 1000.0

    @property
    def morphology_was_subpixel(self) -> bool:
        """Whether a requested kernel rounded away to nothing at this GSD.

        A 3 mm opening at 11 mm/px is not a small kernel, it is no kernel. Saying
        so beats silently skipping it.
        """
        return self.open_radius_px == 0 or self.close_radius_px == 0


# --------------------------------------------------------------------------
# Indices
# --------------------------------------------------------------------------


def chromaticity(rgb: np.ndarray) -> np.ndarray:
    """Normalise RGB to ``r = R/(R+G+B)`` and so on.

    This is the shadow handling. A leaf in shade and the same leaf in sun differ
    by a near-multiplicative factor, which division by the channel sum removes.

    Args:
        rgb: HxWx3, any dtype.

    Returns:
        HxWx3 float32 summing to 1 along the last axis. Pixels where the sum is
        zero are returned as zeros rather than NaN, so downstream indices stay
        finite in shadowed black.
    """
    array = np.asarray(rgb, dtype=np.float32)
    if array.ndim != 3 or array.shape[2] < 3:
        raise ValueError("chromaticity needs an HxWx3 array")
    array = array[..., :3]
    total = array.sum(axis=2)
    out = np.zeros_like(array)
    nonzero = total > 0
    np.divide(array, total[..., None], out=out, where=nonzero[..., None])
    return out


def exg(chroma: np.ndarray) -> np.ndarray:
    """Excess green, ``2g - r - b``, on chromaticity."""
    return 2.0 * chroma[..., 1] - chroma[..., 0] - chroma[..., 2]


def cive(chroma: np.ndarray) -> np.ndarray:
    """Colour index of vegetation extraction, on chromaticity, exactly as specified.

    Lower means more vegetation, opposite to ExG. Includes the 18.78745 offset,
    which makes the numbers comparable with the literature and useless for
    weighting; see :func:`cive_signal`.
    """
    r, g, b, offset = CIVE_COEFFICIENTS
    return r * chroma[..., 0] + g * chroma[..., 1] + b * chroma[..., 2] + offset


def cive_signal(chroma: np.ndarray) -> np.ndarray:
    """The informative part of CIVE, negated so higher means more vegetation."""
    r, g, b, _ = CIVE_COEFFICIENTS
    return -(r * chroma[..., 0] + g * chroma[..., 1] + b * chroma[..., 2])


def combined_index(rgb: np.ndarray, params: VegetationParams | None = None) -> np.ndarray:
    """ExG and CIVE combined into one float index. Higher means more vegetation."""
    params = params or DEFAULT_PARAMS
    chroma = chromaticity(rgb)
    return exg(chroma) + params.cive_weight * cive_signal(chroma)


# --------------------------------------------------------------------------
# Thresholding
# --------------------------------------------------------------------------


def otsu_threshold(index: np.ndarray, params: VegetationParams | None = None) -> tuple[float, bool]:
    """Otsu threshold for one window.

    Returns:
        ``(threshold, used_fallback)``. The flag matters: a window that fell back
        is a window where the mask is only as good as the global estimate, and
        that should be visible rather than silent.
    """
    params = params or DEFAULT_PARAMS
    finite = index[np.isfinite(index)]
    if finite.size == 0:
        return (params.global_threshold or 0.0, True)

    from skimage.filters import threshold_otsu

    try:
        threshold = float(threshold_otsu(finite))
    except ValueError:
        return (params.global_threshold if params.global_threshold is not None else 0.0, True)

    below = finite[finite <= threshold]
    above = finite[finite > threshold]
    if below.size == 0 or above.size == 0:
        return (params.global_threshold if params.global_threshold is not None else threshold, True)

    # Otsu always returns a split. The question is whether there were two modes
    # to split: a window of bare soil has a perfectly good threshold through the
    # middle of one mode, and using it would paint half the soil green.
    spread = float(above.mean() - below.mean())
    if spread < params.otsu_min_spread and params.global_threshold is not None:
        return (params.global_threshold, True)
    return (threshold, False)


def accumulate_histogram(index: np.ndarray, histogram: np.ndarray | None = None) -> np.ndarray:
    """Add a window's index values to a running histogram.

    The global fallback needs whole-raster statistics, and the repo does not get
    to load a whole raster to compute them. A fixed-range histogram is bounded
    memory and one pass.
    """
    counts, _ = np.histogram(
        np.clip(index[np.isfinite(index)], *INDEX_RANGE), bins=HISTOGRAM_BINS, range=INDEX_RANGE
    )
    if histogram is None:
        return counts.astype(np.int64)
    return histogram + counts


def threshold_from_histogram(histogram: np.ndarray) -> float:
    """Otsu's threshold on an accumulated histogram."""
    from skimage.filters import threshold_otsu

    edges = np.linspace(*INDEX_RANGE, HISTOGRAM_BINS + 1)
    centres = (edges[:-1] + edges[1:]) / 2.0
    if histogram.sum() == 0:
        return 0.0
    return float(threshold_otsu(hist=(histogram.astype(np.float64), centres)))


def global_threshold_from_windows(windows: Any, params: VegetationParams | None = None) -> float:
    """First pass: one global threshold from every window's index histogram.

    Args:
        windows: Iterable of ``HxWx3`` arrays, or of objects with an ``array``
            attribute such as :class:`offrow.io.WindowChip`.
    """
    params = params or DEFAULT_PARAMS
    histogram = None
    for window in windows:
        array = getattr(window, "array", window)
        histogram = accumulate_histogram(combined_index(array, params), histogram)
    if histogram is None:
        raise ValueError("no windows supplied")
    return threshold_from_histogram(histogram)


# --------------------------------------------------------------------------
# Masking
# --------------------------------------------------------------------------


def _radius_px(radius_mm: float, gsd_m: float) -> int:
    """Kernel radius in pixels for this raster. Floored, never rounded up.

    Rounding up is the tempting choice and it is wrong. A 3 mm radius is 1.09 px
    at 2.75 mm/px and 0.55 px at 5.5 mm/px; rounding both to 1 px applies a
    2.75 mm kernel at one resolution and a 5.5 mm kernel at the other, which is
    a ground-unit threshold that silently doubles when you fly higher. Measured
    on 3 cm weeds, that alone swung mask area by 29 points across a factor of
    two in GSD, and non-monotonically, since at 11 mm/px it rounds back to zero.

    Flooring means the kernel is never larger in ground units than asked for. It
    is sometimes absent instead, which :attr:`MaskResult.morphology_was_subpixel`
    reports rather than hides.
    """
    return max(int(radius_mm / 1000.0 / gsd_m), 0)


def mask_window(
    rgb: np.ndarray,
    gsd_m: float,
    params: VegetationParams | None = None,
    valid: np.ndarray | None = None,
) -> MaskResult:
    """Mask one window, with the diagnostics attached.

    ``gsd_m`` is required, not inferred: the morphological kernels are specified
    in millimetres of ground and converted here.

    Args:
        rgb: HxWx3 window.
        gsd_m: Ground sample distance, metres per pixel.
        params: Thresholds and kernels.
        valid: Optional boolean array of pixels to consider, for boundary
            clipping. Invalid pixels are excluded from the threshold statistics
            as well as from the mask, so ground outside the field cannot drag
            the threshold around.
    """
    params = params or DEFAULT_PARAMS
    if gsd_m <= 0:
        raise ValueError("gsd_m must be positive")

    index = combined_index(rgb, params)
    statistics = index if valid is None else index[valid]
    threshold, used_fallback = otsu_threshold(statistics, params)

    mask = index > threshold
    if valid is not None:
        mask &= valid

    open_px = _radius_px(params.open_radius_mm, gsd_m)
    close_px = _radius_px(params.close_radius_mm, gsd_m)
    mask = _morphology(mask, open_px, close_px)
    if valid is not None:
        mask &= valid

    coverage = _coverage_from_index(index, statistics, params)
    if valid is not None:
        coverage = np.where(valid, coverage, 0.0)

    return MaskResult(
        mask=mask,
        coverage=coverage,
        threshold=threshold,
        used_fallback=used_fallback,
        gsd_m=gsd_m,
        open_radius_px=open_px,
        close_radius_px=close_px,
    )


def _morphology(mask: np.ndarray, open_px: int, close_px: int) -> np.ndarray:
    """Open then close, with disks of the given pixel radius.

    Open first: closing first would weld speckle to real plants before the
    opening could remove it.
    """
    from skimage.morphology import closing, disk, opening

    if open_px > 0:
        mask = opening(mask, disk(open_px))
    if close_px > 0:
        mask = closing(mask, disk(close_px))
    return mask


def _coverage_from_index(
    index: np.ndarray, statistics: np.ndarray, params: VegetationParams
) -> np.ndarray:
    """Unmix each pixel between soil and plant, linearly, into [0, 1]."""
    finite = statistics[np.isfinite(statistics)]
    if finite.size == 0:
        return np.zeros_like(index, dtype=np.float32)
    soil = float(np.percentile(finite, params.soil_percentile))
    plant = float(np.percentile(finite, params.plant_percentile))
    if plant - soil < 1e-6:
        return np.zeros_like(index, dtype=np.float32)
    return np.clip((index - soil) / (plant - soil), 0.0, 1.0).astype(np.float32)


def vegetation_mask(
    rgb: np.ndarray,
    gsd_m: float,
    params: VegetationParams | None = None,
    valid: np.ndarray | None = None,
) -> np.ndarray:
    """Boolean vegetation mask for one window. True where vegetation."""
    return mask_window(rgb, gsd_m, params, valid).mask


def vegetation_coverage(
    rgb: np.ndarray,
    gsd_m: float,
    params: VegetationParams | None = None,
    valid: np.ndarray | None = None,
) -> np.ndarray:
    """Sub-pixel vegetation coverage in [0, 1] for one window."""
    return mask_window(rgb, gsd_m, params, valid).coverage


def mask_area_m2(mask: np.ndarray, gsd_m: float) -> float:
    """Ground area of a boolean mask, in square metres."""
    return float(np.count_nonzero(mask)) * gsd_m * gsd_m


def coverage_area_m2(coverage: np.ndarray, gsd_m: float) -> float:
    """Ground area from sub-pixel coverage, in square metres."""
    return float(np.sum(coverage, dtype=np.float64)) * gsd_m * gsd_m
