"""Synthetic field generator: the development fixture and the source of exact truth.

STUB. No implementation yet.

Synthetic scenes exist because the tests need ground truth that is known rather
than annotated, and because the false-positive sources worth testing against
(shadows, wheel tracks, wet patches) have to be switchable to be studied.

Synthetic drives development and tests. It does not produce reportable accuracy
numbers. Anything quoted outside this repo comes from the public datasets.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np


@dataclass(frozen=True)
class SceneParams:
    """Everything about a synthetic field except the GSD it is rendered at.

    Separating the scene from the render resolution is the point: the same
    scene rendered natively at several GSDs is the cross-check on whether
    :mod:`offrow.altitude`'s degradation model behaves sensibly.

    Args:
        acres: Field size.
        row_spacing_m: Nominal planted row spacing.
        row_angle_deg: Row direction.
        inrow_spacing_m: Nominal within-row plant spacing.
        spacing_jitter_frac: Random displacement as a fraction of spacing.
        skip_rate: Fraction of plant positions left empty, as a planter would.
        plant_diameter_m: Canopy diameter of a crop plant at the target stage.
        weed_density_per_m2: Weed plants per square metre.
        weed_offrow_bias: 0 places weeds uniformly, 1 places them all at the
            inter-row midpoint. Sweeping this is how the detector's dependence
            on the geometry being true gets measured.
        weed_diameter_m: Mean weed canopy diameter.
        shadows: Directional shadows cast by plants.
        sun_azimuth_deg: Shadow direction.
        wheel_tracks: Compacted, brighter wheel tracks parallel to the rows.
        wet_patches: Dark soil patches that fool an intensity threshold.
        seed: Reproducibility.
    """

    acres: float = 2.0
    row_spacing_m: float = 0.762
    row_angle_deg: float = 0.0
    inrow_spacing_m: float = 0.15
    spacing_jitter_frac: float = 0.1
    skip_rate: float = 0.05
    plant_diameter_m: float = 0.12
    weed_density_per_m2: float = 0.3
    weed_offrow_bias: float = 0.7
    weed_diameter_m: float = 0.04
    shadows: bool = False
    sun_azimuth_deg: float = 135.0
    wheel_tracks: bool = False
    wet_patches: bool = False
    seed: int = 0


@dataclass
class Scene:
    """A generated field: the plant positions, before any pixels exist."""

    params: SceneParams
    crop_xy_m: np.ndarray
    weed_xy_m: np.ndarray
    weed_diameter_m: np.ndarray
    extent_m: tuple[float, float]

    def truth_geojson(self, path: Path, crs: Any = None) -> None:
        """Write weed positions as ground truth points."""
        raise NotImplementedError


def generate(params: SceneParams | None = None) -> Scene:
    """Lay out crop and weed positions. No rendering, no GSD involved."""
    raise NotImplementedError


def render(scene: Scene, gsd_mm: float, rng: np.random.Generator | None = None) -> np.ndarray:
    """Render a scene to RGB at a given GSD.

    Soil first, as noise-based texture with colour variation, then plant sprites
    at their positions, then shadows, tracks and wet patches if enabled. Sprites
    are drawn at the size the ground dictates, so a 4 cm weed is genuinely
    subpixel at 22 mm/px rather than being drawn as a visible dot.
    """
    raise NotImplementedError


def render_ladder(
    scene: Scene, gsds_mm: list[float], rng: np.random.Generator | None = None
) -> list[tuple[float, np.ndarray]]:
    """Render the same scene natively at several GSDs.

    The reference the altitude simulation is checked against. These are drawn
    from the ground truth at each resolution, so they are what the camera would
    have seen, not what a degradation model thinks it would have seen.
    """
    raise NotImplementedError


def write_geotiff(
    array: np.ndarray,
    gsd_mm: float,
    path: Path,
    origin_xy_m: tuple[float, float] = (0.0, 0.0),
    crs: Any = None,
) -> None:
    """Write a rendered scene as a georeferenced raster the pipeline can read."""
    raise NotImplementedError


def boundary_geojson(scene: Scene, path: Path, crs: Any = None) -> None:
    """Write the field boundary for a rendered scene."""
    raise NotImplementedError
