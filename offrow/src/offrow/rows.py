"""Row geometry: angle, pitch, centerlines, and signed distance to the crop.

STUB. No implementation yet.

This is the module the whole idea rests on. Fit the row centerlines and
vegetation between them is by construction not the planted crop. No appearance
model can be substituted for it.

Row fitting is also the first thing expected to fail as GSD coarsens, because it
needs the projection profile to still show periodic structure. So it reports a
confidence, and the recall curve can then separate "rows not found" from "rows
found, weeds missed". Those are different failures with different fixes, and a
single recall number hides the difference.

On synthetic scenes the row structure survives 1.7 to 11 mm/px unchanged: a
76 cm pitch is 69 pixels even at 11 mm. What does break is the angle. Project
an axis-aligned profile through rows running at 23 degrees and it is noise at
every resolution. The angle search is the fragile part, not the sampling, and
the confidence metric is where that gets caught. Treat that as an untested
upper bound from synthetic imagery until real flights say otherwise.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

#: Disagreement between recovered and grower-supplied pitch beyond which the
#: angle estimate has probably landed on a harmonic.
PITCH_DISAGREEMENT_WARN = 0.10


@dataclass(frozen=True)
class RowTile:
    """A locally fitted row model for one tile of the field."""

    origin_xy_m: tuple[float, float]
    size_m: float
    angle_deg: float
    pitch_m: float
    phase_m: float
    confidence: float


@dataclass
class RowModel:
    """The field's row geometry, as a set of locally fitted tiles.

    Contour and terrace planting mean a single global angle is wrong over any
    real field, so the model is per tile with the row phase interpolated
    between tiles. A field of one tile is the degenerate flat case.
    """

    tiles: list[RowTile] = field(default_factory=list)
    tile_size_m: float = 20.0
    nominal_spacing_m: float = 0.762  # 30 inch rows
    crs: object = None

    @property
    def confidence(self) -> float:
        """Field-level confidence, aggregated across tiles.

        Reported alongside every recall number this repo produces.
        """
        raise NotImplementedError

    def angle_at(self, x_m: float, y_m: float) -> float:
        """Interpolated row angle at a ground position, in degrees."""
        raise NotImplementedError

    def centerlines(self, bounds_m: tuple[float, float, float, float]) -> list:
        """Row centerlines as line geometries within ``bounds_m``."""
        raise NotImplementedError


def row_angle(mask: np.ndarray, angle_step_deg: float = 0.5) -> tuple[float, float]:
    """Dominant row angle from the Radon transform of a vegetation mask.

    Project the mask at angles across 0 to 180 degrees and take the angle whose
    projection profile has maximum variance: rows aligned with the projection
    direction stack into sharp peaks, everything else smears flat.

    Returns:
        ``(angle_deg, confidence)``, confidence in [0, 1] from the margin
        between the best angle's profile variance and the background variance.
    """
    raise NotImplementedError


def row_pitch(profile: np.ndarray, gsd_m: float, method: str = "fft") -> tuple[float, float]:
    """Row spacing in metres from the perpendicular projection profile.

    Args:
        profile: 1-D projection profile at the recovered row angle.
        gsd_m: Needed to return metres rather than samples.
        method: ``"fft"`` or ``"autocorrelation"``.

    Returns:
        ``(pitch_m, confidence)``.
    """
    raise NotImplementedError


def check_pitch(recovered_m: float, grower_spacing_m: float) -> tuple[bool, str]:
    """Cross-check a recovered pitch against what the grower said they planted.

    Disagreement beyond :data:`PITCH_DISAGREEMENT_WARN` usually means the angle
    estimate landed on a harmonic, giving a pitch that is a neat multiple or
    fraction of the truth. The grower's number is the more reliable of the two.

    Returns:
        ``(ok, message)``. Never raises: a wrong pitch is a warning that has to
        reach the operator, not a crash that hides the field.
    """
    raise NotImplementedError


def fit(
    mask: np.ndarray,
    gsd_m: float,
    grower_spacing_m: float,
    origin_xy_m: tuple[float, float] = (0.0, 0.0),
    tile_m: float = 20.0,
) -> RowModel:
    """Fit a per-tile row model to a vegetation mask.

    Args:
        mask: Boolean vegetation mask.
        gsd_m: Ground sample distance, metres per pixel.
        grower_spacing_m: Row spacing the grower reports. Used to cross-check
            the recovered pitch, never silently overridden by it.
        origin_xy_m: Ground coordinate of the mask origin.
        tile_m: Tile edge length for local refitting.
    """
    raise NotImplementedError


def centerline_offsets(profile: np.ndarray, pitch_px: float) -> np.ndarray:
    """Peak positions in a projection profile, as the row centerlines."""
    raise NotImplementedError


def signed_distance_to_row(points: np.ndarray, model: RowModel) -> np.ndarray:
    """Perpendicular distance from each point to its nearest row centerline.

    Args:
        points: Nx2 array of ground coordinates in metres.
        model: Fitted row model.

    Returns:
        Length-N array in metres. Signed by which side of the centerline the
        point falls on, so that a systematic bias in the fit shows up as a
        nonzero mean rather than hiding inside an absolute value.
    """
    raise NotImplementedError


def inrow_spacing_residual(points: np.ndarray, model: RowModel) -> np.ndarray:
    """Along-row distance from each point to the nearest expected plant position.

    Planted corn sits at a regular in-row spacing as well as a regular row
    spacing. A blob on the centerline but between plant positions is a weaker
    claim to being crop than one sitting where a plant should be.
    """
    raise NotImplementedError
