"""Connected components and per-blob features, all in ground units.

STUB. No implementation yet.

Most of these features are not used by the current scoring, which is pure
geometry. They are computed anyway. They are the input to the one-class anomaly
step later, and extracting them now means the extraction is already validated,
already ground-unit correct, and already tested across the GSD ladder by the
time anything consumes them.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

#: Smallest blob kept, in square centimetres of ground. Below this a blob is
#: more likely to be mask speckle than a seedling.
MIN_AREA_CM2 = 4.0

LBP_POINTS = 8
LBP_RADIUS = 1


@dataclass
class Blob:
    """One connected component, described in ground units throughout.

    No field here is in pixels. The same physical plant imaged at two GSDs must
    produce the same numbers, which is only true if pixels never leak out of
    this module.
    """

    centroid_xy_m: tuple[float, float]
    area_m2: float
    equiv_diameter_m: float
    eccentricity: float
    solidity: float
    extent: float
    compactness: float
    major_axis_m: float
    minor_axis_m: float
    orientation_rel_row_deg: float

    chroma_r_mean: float
    chroma_r_std: float
    chroma_g_mean: float
    chroma_g_std: float
    chroma_b_mean: float
    chroma_b_std: float
    exg_mean: float
    exg_std: float
    lab_a_mean: float
    lab_a_std: float
    lab_b_mean: float
    lab_b_std: float
    lbp_histogram: np.ndarray

    distance_to_row_m: float
    inrow_spacing_residual_m: float

    gsd_m: float
    geometry: Any = None

    def as_feature_vector(self) -> np.ndarray:
        """Flatten to a numeric vector for the one-class step, when it exists."""
        raise NotImplementedError


def label_mask(mask: np.ndarray, connectivity: int = 2) -> np.ndarray:
    """Label connected components in a boolean mask."""
    raise NotImplementedError


def min_area_px(gsd_m: float, min_area_cm2: float = MIN_AREA_CM2) -> float:
    """Convert the ground-unit area floor into pixels for this raster."""
    raise NotImplementedError


def extract(
    mask: np.ndarray,
    rgb: np.ndarray,
    gsd_m: float,
    transform: Any = None,
    row_model: Any = None,
    min_area_cm2: float = MIN_AREA_CM2,
) -> list[Blob]:
    """Extract blobs and their features from one window.

    Args:
        mask: Boolean vegetation mask.
        rgb: The imagery the mask came from, for the colour and texture features.
        gsd_m: Ground sample distance, metres per pixel.
        transform: Raster transform, for placing centroids in ground coordinates.
        row_model: Fitted :class:`offrow.rows.RowModel`, for the row-relative
            features. If absent, those fields are NaN rather than zero, because
            zero means "on the row" and would be a lie.
        min_area_cm2: Ground-unit area floor.
    """
    raise NotImplementedError


def lbp_histogram(
    gray: np.ndarray, mask: np.ndarray, points: int = LBP_POINTS, radius: int = LBP_RADIUS
) -> np.ndarray:
    """Local binary pattern histogram over the masked region.

    Note the radius is in pixels, not ground units, and deliberately so: LBP
    describes the sampling grid's texture. Comparing LBP across GSDs is
    therefore not meaningful without resampling first, and that caveat travels
    with the feature.
    """
    raise NotImplementedError


def to_geodataframe(blobs: list[Blob], crs: Any = None) -> Any:
    """Blobs as a GeoDataFrame, one row per blob."""
    raise NotImplementedError
