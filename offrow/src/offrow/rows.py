"""Row geometry: angle, pitch, centerlines, and signed distance to the crop.

This is the module the whole idea rests on. Fit the row centerlines and
vegetation between them is by construction not the planted crop. No appearance
model can be substituted for it.

Row fitting reports a confidence, so the recall curve can separate "rows not
found" from "rows found, weeds missed". Those are different failures with
different fixes, and a single recall number hides the difference.

On synthetic scenes the row structure survives 1.7 to 11 mm/px unchanged: a
76 cm pitch is 69 pixels even at 11 mm. What breaks is the angle. Project an
axis-aligned profile through rows running at 23 degrees and it is noise at every
resolution. The angle search is the fragile part, not the sampling, which is why
the confidence is split into an angle part and a pitch part and the model is
only as good as its weaker half. Treat that as an untested upper bound from
synthetic imagery until real flights say otherwise.

**Conventions.** Angles are degrees counterclockwise from the +x axis of the
*ground* CRS, in [0, 180), since a row and its reverse are the same row. Rasters
are north-up, so the array's row index increases as ground y decreases and a
direction in pixels maps to the negative of that angle in ground units;
:func:`pixel_angle_to_ground` is the one place that flip is applied.

**Memory.** :func:`fit_from_raster` is the production path and reads one tile at
a time. :func:`fit` takes a whole mask and is for small rasters and tests; a
field-sized mask does not belong in memory.
"""

from __future__ import annotations

import math
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from offrow import io as raster_io

#: Disagreement between recovered and grower-supplied pitch beyond which the
#: angle estimate has probably landed on a harmonic.
PITCH_DISAGREEMENT_WARN = 0.10

#: The Radon transform is run on a downsampled mask. Rows only need to be a few
#: pixels apart to be found, and a 20 m tile at 5.5 mm/px is 13 megapixels,
#: which is far more than an angle search needs. The grower's spacing sets the
#: factor; it is used for speed only and never enters the fit.
TARGET_PITCH_PX = 8.0

#: Plausible row spacings, as a multiple of the grower's figure. The pitch search
#: is confined to this band so the FFT cannot return a spacing nobody plants.
PITCH_SEARCH_BAND = (0.35, 2.6)

#: Tile confidence below which a tile is not used to interpolate the field model.
#:
#: Measured, not chosen. On 13 m synthetic tiles at 5.5 mm/px: real rows score
#: 0.98, real rows with 95 percent of the plants skipped score 0.49, spatially
#: correlated noise at the same vegetation coverage scores 0.22, random speckle
#: 0.23, and a fully closed canopy scores 0.00. A floor of 0.35 sits in the gap
#: between the worst real grid and the best noise.
MIN_TILE_CONFIDENCE = 0.35


class RowFitWarning(UserWarning):
    """A row fit that produced an answer worth doubting."""


# --------------------------------------------------------------------------
# Model
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class RowTile:
    """A locally fitted row model for one tile of the field."""

    origin_xy_m: tuple[float, float]
    size_m: float
    angle_deg: float
    pitch_m: float
    #: Offset of the row grid from this tile's own centre, along its own normal,
    #: in [0, pitch). Relative to the centre and never to the CRS origin: in UTM
    #: the coordinates are around 1e6, so a fit that is half a tenth of a degree
    #: off multiplies into hundreds of metres of across-row offset, and that
    #: modulo a 76 cm pitch is noise. Measured relative to the tile centre the
    #: lever arm is at most half a tile.
    phase_m: float
    confidence: float
    angle_confidence: float = 0.0
    pitch_confidence: float = 0.0
    vegetation_fraction: float = 0.0
    pitch_from_grower: bool = False
    #: What the fit actually recovered, before any fallback to the grower's
    #: figure. Kept so the warning can name the harmonic: re-checking the pitch
    #: after replacing it with the grower's would report perfect agreement and
    #: throw away the only evidence that the fit went wrong.
    recovered_pitch_m: float = 0.0

    #: Ground centre of the tile, which is what :attr:`phase_m` is measured from.
    centre_xy_m: tuple[float, float] = (0.0, 0.0)

    @property
    def normal(self) -> tuple[float, float]:
        """Unit vector across the rows. Signed distance is measured along this."""
        theta = math.radians(self.angle_deg)
        return (-math.sin(theta), math.cos(theta))


@dataclass
class RowModel:
    """The field's row geometry, as a set of locally fitted tiles.

    Contour and terrace planting mean a single global angle is wrong over any
    real field, so the model is per tile with the row phase interpolated between
    tiles. A field of one tile is the degenerate flat case.
    """

    tiles: list[RowTile] = field(default_factory=list)
    tile_size_m: float = 20.0
    nominal_spacing_m: float = 0.762  # 30 inch rows
    crs: object = None
    inrow_spacing_m: float | None = None
    warnings: list[str] = field(default_factory=list)

    @property
    def usable_tiles(self) -> list[RowTile]:
        """Tiles confident enough to interpolate from."""
        return [t for t in self.tiles if t.confidence >= MIN_TILE_CONFIDENCE]

    @property
    def confidence(self) -> float:
        """Field-level confidence, aggregated across tiles.

        Weighted by how much vegetation each tile held, because a tile of bare
        headland has nothing to fit and should not drag the field's score either
        way. Reported alongside every recall number this repo produces.
        """
        if not self.tiles:
            return 0.0
        weights = np.array([max(t.vegetation_fraction, 1e-6) for t in self.tiles])
        scores = np.array([t.confidence for t in self.tiles])
        return float(np.average(scores, weights=weights))

    @property
    def angle_confidence(self) -> float:
        """How well the row *direction* was found, ignoring the pitch."""
        if not self.tiles:
            return 0.0
        weights = np.array([max(t.vegetation_fraction, 1e-6) for t in self.tiles])
        return float(np.average([t.angle_confidence for t in self.tiles], weights=weights))

    @property
    def pitch_confidence(self) -> float:
        """How well the row *spacing* was found, ignoring the direction."""
        if not self.tiles:
            return 0.0
        weights = np.array([max(t.vegetation_fraction, 1e-6) for t in self.tiles])
        return float(np.average([t.pitch_confidence for t in self.tiles], weights=weights))

    @property
    def low_confidence_fraction(self) -> float:
        """Fraction of tiles too weak to use. The other half of the story."""
        if not self.tiles:
            return 1.0
        return 1.0 - len(self.usable_tiles) / len(self.tiles)

    @property
    def median_pitch_m(self) -> float:
        tiles = self.usable_tiles or self.tiles
        if not tiles:
            return self.nominal_spacing_m
        return float(np.median([t.pitch_m for t in tiles]))

    @property
    def median_angle_deg(self) -> float:
        tiles = self.usable_tiles or self.tiles
        if not tiles:
            return 0.0
        return _circular_mean_deg(
            np.array([t.angle_deg for t in tiles]),
            np.array([max(t.confidence, 1e-6) for t in tiles]),
        )

    def _weights(self, x_m: np.ndarray, y_m: np.ndarray) -> tuple[list[RowTile], np.ndarray]:
        """Inverse-distance weights from each query point to each usable tile."""
        tiles = self.usable_tiles
        if not tiles:
            raise ValueError(
                "no tile met the confidence floor, so there is no row model to query. "
                "Check RowModel.confidence before using the model, not after."
            )
        centres = np.array([t.centre_xy_m for t in tiles])
        dx = x_m[:, None] - centres[None, :, 0]
        dy = y_m[:, None] - centres[None, :, 1]
        distance = np.sqrt(dx * dx + dy * dy) + 1e-6
        weights = np.array([t.confidence for t in tiles])[None, :] / (distance**2)
        return tiles, weights / weights.sum(axis=1, keepdims=True)

    def angle_at(self, x_m: float, y_m: float) -> float:
        """Interpolated row angle at a ground position, in degrees."""
        return float(self.angles_at(np.array([x_m]), np.array([y_m]))[0])

    def angles_at(self, x_m: np.ndarray, y_m: np.ndarray) -> np.ndarray:
        """Interpolated row angle at many ground positions."""
        tiles, weights = self._weights(np.asarray(x_m), np.asarray(y_m))
        angles = np.array([t.angle_deg for t in tiles])
        # Doubled angles, because a row at 179 degrees and one at 1 degree are
        # two degrees apart, not 178.
        doubled = np.exp(2j * np.radians(angles))[None, :]
        blended = (weights * doubled).sum(axis=1)
        return np.degrees(np.angle(blended)) / 2.0 % 180.0

    def pitches_at(self, x_m: np.ndarray, y_m: np.ndarray) -> np.ndarray:
        tiles, weights = self._weights(np.asarray(x_m), np.asarray(y_m))
        return weights @ np.array([t.pitch_m for t in tiles])

    def offsets_at(self, x_m: np.ndarray, y_m: np.ndarray) -> np.ndarray:
        """Signed distance to the nearest row, blended across tiles.

        Each tile predicts a distance for the query point using its own angle,
        pitch and centre, and those predictions are blended on the unit circle.
        Interpolating the phases themselves and applying the result at the query
        point would be wrong twice over: phase lives modulo the pitch, so a plain
        average of 0.01 m and 0.75 m on a 0.762 m pitch gives 0.38 m, the space
        between two rows rather than a row; and a phase is only meaningful next
        to the point it was measured from.
        """
        x_m = np.asarray(x_m, dtype=np.float64)
        y_m = np.asarray(y_m, dtype=np.float64)
        tiles, weights = self._weights(x_m, y_m)

        angles = np.radians(np.array([t.angle_deg for t in tiles]))
        pitches = np.array([t.pitch_m for t in tiles])
        phases = np.array([t.phase_m for t in tiles])
        centres = np.array([t.centre_xy_m for t in tiles])

        across = (x_m[:, None] - centres[None, :, 0]) * -np.sin(angles)[None, :] + (
            y_m[:, None] - centres[None, :, 1]
        ) * np.cos(angles)[None, :]
        predicted = across - phases[None, :]
        blended = (weights * np.exp(2j * np.pi * predicted / pitches[None, :])).sum(axis=1)
        local_pitch = weights @ pitches
        return np.angle(blended) / (2 * np.pi) * local_pitch

    def centerlines(self, bounds_m: tuple[float, float, float, float]) -> list:
        """Row centerlines as line geometries within ``bounds_m``.

        Drawn from the model rather than from the profile peaks directly, so a
        row is present even where a planter skip left no plants to peak on.
        """
        from shapely.geometry import LineString, box

        minx, miny, maxx, maxy = bounds_m
        window = box(minx, miny, maxx, maxy)
        cx, cy = (minx + maxx) / 2.0, (miny + maxy) / 2.0
        angle = math.radians(self.angle_at(cx, cy))
        pitch = float(self.pitches_at(np.array([cx]), np.array([cy]))[0])
        # How far the window centre sits from its nearest row, so the comb can
        # be hung off a point inside the field rather than off the CRS origin.
        phase = -float(self.offsets_at(np.array([cx]), np.array([cy]))[0])

        direction = np.array([math.cos(angle), math.sin(angle)])
        normal = np.array([-math.sin(angle), math.cos(angle)])
        reach = math.hypot(maxx - minx, maxy - miny)
        centre = np.array([cx, cy])
        offset = float(np.dot(centre, normal))

        lines = []
        k_min = int(math.floor((-reach - phase) / pitch))
        k_max = int(math.ceil((reach - phase) / pitch))
        for k in range(k_min, k_max + 1):
            along = offset + phase + k * pitch
            # Anchor the segment at the point of the line nearest the field
            # centre. Using ``normal * along`` instead puts it at the point
            # nearest the CRS origin, which in UTM is thousands of kilometres
            # away, and every segment then misses the field entirely.
            base = centre + (along - offset) * normal
            line = LineString([base - direction * reach, base + direction * reach])
            clipped = line.intersection(window)
            if not clipped.is_empty:
                lines.append(clipped)
        return lines


# --------------------------------------------------------------------------
# Angle
# --------------------------------------------------------------------------


def pixel_angle_to_ground(angle_px_deg: float, transform: Any) -> float:
    """Convert an angle measured in array coordinates to ground coordinates.

    A north-up raster has ``e < 0``: the array's row index grows as ground y
    shrinks. So a direction that rises to the right in the array falls to the
    right on the ground, and the angle changes sign. This is the only place that
    flip happens, and it is why the model's angles can be compared with a
    grower's bearing without a second thought.
    """
    flip_y = raster_io.as_transform(transform).e < 0
    return (-angle_px_deg if flip_y else angle_px_deg) % 180.0


def _downsample(mask: np.ndarray, factor: int) -> np.ndarray:
    """Mean-pool the mask, which keeps the periodic signal and antialiases it."""
    if factor <= 1:
        return mask.astype(np.float32)
    from skimage.measure import block_reduce

    return block_reduce(mask.astype(np.float32), (factor, factor), np.mean)


def _square_crop(image: np.ndarray) -> np.ndarray:
    """Centre crop to a square, which is what ``radon(circle=True)`` needs."""
    side = min(image.shape[:2])
    top = (image.shape[0] - side) // 2
    left = (image.shape[1] - side) // 2
    return image[top : top + side, left : left + side]


def _disc(side: int) -> np.ndarray:
    radius = side / 2.0
    yy, xx = np.mgrid[0:side, 0:side]
    return ((yy - radius + 0.5) ** 2 + (xx - radius + 0.5) ** 2) <= radius**2


def _profile_variances(image: np.ndarray, angles_deg: np.ndarray) -> np.ndarray:
    """Variance of the projection profile at each angle, chord-corrected.

    Projecting a disc gives a dome-shaped baseline whose own variance swamps the
    row signal. Dividing by the projection of a uniform disc removes it, leaving
    variance that is about periodic structure rather than about the shape of the
    window.
    """
    from skimage.transform import radon

    side = image.shape[0]
    disc = _disc(side)
    masked = np.where(disc, image, 0.0)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        sinogram = radon(masked, theta=angles_deg, circle=True)
        chord = radon(disc.astype(np.float32), theta=angles_deg, circle=True)

    keep = chord.max(axis=1) > 0.5 * chord.max()
    if keep.sum() < 8:
        keep = np.ones(chord.shape[0], dtype=bool)
    normalised = np.divide(sinogram, chord, out=np.zeros_like(sinogram), where=chord > 1e-6)
    return normalised[keep].var(axis=0), normalised, keep


def row_angle(
    mask: np.ndarray,
    gsd_m: float | None = None,
    nominal_spacing_m: float | None = None,
    angle_step_deg: float = 1.0,
    refine_step_deg: float = 0.05,
) -> tuple[float, float]:
    """Dominant row angle from the Radon transform of a vegetation mask.

    Project the mask at angles across 0 to 180 degrees and take the angle whose
    projection profile has maximum variance: rows aligned with the projection
    direction stack into sharp peaks, everything else smears flat.

    Two passes, coarse then fine, because a one degree grid is not accurate
    enough and a 0.05 degree grid over 180 degrees is 3600 transforms.

    Args:
        mask: Boolean vegetation mask, in array coordinates.
        gsd_m: Ground sample distance, used with ``nominal_spacing_m`` only to
            pick a downsample factor.
        nominal_spacing_m: The grower's row spacing. Speed only; never fitted to.
        angle_step_deg: Coarse search step.
        refine_step_deg: Fine search step.

    Returns:
        ``(angle_px_deg, confidence)``. The angle is in *array* coordinates; use
        :func:`pixel_angle_to_ground` to put it on the ground. Confidence in
        [0, 1] from the margin between the best angle's profile variance and the
        typical variance across all angles.
    """
    image = _prepare_for_radon(mask, gsd_m, nominal_spacing_m)
    if image.size == 0 or not np.any(image > 0):
        return (0.0, 0.0)

    coarse = np.arange(0.0, 180.0, angle_step_deg)
    variances, _, _ = _profile_variances(image, coarse)
    best = float(coarse[int(np.argmax(variances))])

    fine = np.arange(best - angle_step_deg, best + angle_step_deg + 1e-9, refine_step_deg)
    fine_variances, _, _ = _profile_variances(image, fine % 180.0)
    best_fine = float(fine[int(np.argmax(fine_variances))]) % 180.0

    peak = float(variances.max())
    typical = float(np.median(variances))
    confidence = 0.0 if peak <= 0 else float(np.clip((peak - typical) / (peak + typical), 0.0, 1.0))

    # skimage's theta=90 stacks rows that run along the array's +x axis, and its
    # theta grows the opposite way to an angle measured counterclockwise in an
    # array whose row index grows downward. So the array-frame row angle is
    # 90 - theta, not theta - 90. Both give 0 for horizontal rows, which is why
    # the wrong one survives a test at a single angle and fails at every other:
    # it is a reflection, and 0 and 90 are the two fixed points of it.
    return ((90.0 - best_fine) % 180.0, confidence)


def _prepare_for_radon(
    mask: np.ndarray, gsd_m: float | None, nominal_spacing_m: float | None
) -> np.ndarray:
    factor = downsample_factor(gsd_m, nominal_spacing_m)
    return _square_crop(_downsample(np.asarray(mask), factor))


def downsample_factor(gsd_m: float | None, nominal_spacing_m: float | None) -> int:
    """How much to shrink a mask before the angle search.

    Speed only. The factor comes from the grower's spacing so that rows land
    around :data:`TARGET_PITCH_PX` apart, which is plenty to find a direction,
    and the fit itself is done on the result, never on the assumption.
    """
    if not gsd_m or not nominal_spacing_m:
        return 1
    pitch_px = nominal_spacing_m / gsd_m
    return max(int(pitch_px / TARGET_PITCH_PX), 1)


def projection_profile(
    mask: np.ndarray,
    angle_px_deg: float,
    gsd_m: float | None = None,
    nominal_spacing_m: float | None = None,
) -> tuple[np.ndarray, float]:
    """Profile across the rows at a given angle, and the metres per sample.

    Returns:
        ``(profile, sample_m)``. The sample spacing is the downsampled pixel
        size, so a pitch measured in samples converts straight to metres.
    """
    image = _prepare_for_radon(mask, gsd_m, nominal_spacing_m)
    factor = downsample_factor(gsd_m, nominal_spacing_m)
    theta = np.array([(90.0 - angle_px_deg) % 180.0])
    _variances, normalised, keep = _profile_variances(image, theta)
    profile = normalised[keep, 0]
    sample_m = (gsd_m or 1.0) * factor
    return profile, sample_m


# --------------------------------------------------------------------------
# Pitch
# --------------------------------------------------------------------------


def row_pitch(
    profile: np.ndarray,
    gsd_m: float,
    method: str = "fft",
    nominal_spacing_m: float | None = None,
) -> tuple[float, float]:
    """Row spacing in metres from the perpendicular projection profile.

    Args:
        profile: 1-D projection profile at the recovered row angle.
        gsd_m: Metres per profile sample. Needed to return metres, not samples.
        method: ``"fft"`` or ``"autocorrelation"``.
        nominal_spacing_m: Confines the search to plausible spacings. The fit
            happens inside that band; the band is not the answer.

    Returns:
        ``(pitch_m, confidence)``.
    """
    profile = np.asarray(profile, dtype=np.float64)
    if profile.size < 8 or not np.isfinite(profile).all() or profile.std() == 0:
        return (float(nominal_spacing_m or 0.0), 0.0)

    centred = profile - profile.mean()
    if method == "autocorrelation":
        return _pitch_autocorrelation(centred, gsd_m, nominal_spacing_m)
    if method != "fft":
        raise ValueError(f"unknown method {method!r}")
    return _pitch_fft(centred, gsd_m, nominal_spacing_m)


def _search_bounds(n: int, gsd_m: float, nominal_spacing_m: float | None) -> tuple[float, float]:
    """Pitch bounds in samples: the plausible band, clipped to what is resolvable."""
    longest = n / 3.0  # need at least three periods to call something periodic
    if nominal_spacing_m:
        low = nominal_spacing_m * PITCH_SEARCH_BAND[0] / gsd_m
        high = nominal_spacing_m * PITCH_SEARCH_BAND[1] / gsd_m
    else:
        low, high = 3.0, longest
    return (max(low, 3.0), min(high, longest))


def _pitch_fft(
    centred: np.ndarray, gsd_m: float, nominal_spacing_m: float | None
) -> tuple[float, float]:
    n = centred.size
    window = np.hanning(n)
    spectrum = np.abs(np.fft.rfft(centred * window, n=4 * n)) ** 2
    frequencies = np.fft.rfftfreq(4 * n)  # cycles per sample

    low_px, high_px = _search_bounds(n, gsd_m, nominal_spacing_m)
    band = (frequencies >= 1.0 / high_px) & (frequencies <= 1.0 / low_px)
    if not band.any():
        return (float(nominal_spacing_m or 0.0), 0.0)

    index = int(np.argmax(np.where(band, spectrum, 0.0)))
    peak_frequency = _parabolic_peak(spectrum, index, frequencies)
    if peak_frequency <= 0:
        return (float(nominal_spacing_m or 0.0), 0.0)

    pitch_m = gsd_m / peak_frequency
    inside = spectrum[band]
    peak = float(spectrum[index])
    typical = float(np.median(inside))
    confidence = 0.0 if peak <= 0 else float(np.clip((peak - typical) / (peak + typical), 0.0, 1.0))
    return (float(pitch_m), confidence)


def _parabolic_peak(spectrum: np.ndarray, index: int, frequencies: np.ndarray) -> float:
    """Sub-bin peak location, so the pitch is not quantised to the FFT grid.

    A 13 m tile of 76 cm rows holds seventeen periods, so one FFT bin is about
    six percent of the pitch and the spec asks for three. Interpolating the
    parabola through the peak and its neighbours gets an order of magnitude
    below the bin spacing.
    """
    if index <= 0 or index >= spectrum.size - 1:
        return float(frequencies[index])
    a, b, c = spectrum[index - 1], spectrum[index], spectrum[index + 1]
    denominator = a - 2 * b + c
    offset = 0.0 if denominator == 0 else 0.5 * (a - c) / denominator
    step = frequencies[1] - frequencies[0]
    return float(frequencies[index] + offset * step)


def _pitch_autocorrelation(
    centred: np.ndarray, gsd_m: float, nominal_spacing_m: float | None
) -> tuple[float, float]:
    n = centred.size
    correlation = np.correlate(centred, centred, mode="full")[n - 1 :]
    correlation /= correlation[0] if correlation[0] != 0 else 1.0

    low_px, high_px = _search_bounds(n, gsd_m, nominal_spacing_m)
    low, high = int(max(low_px, 1)), int(min(high_px, n - 2))
    if high <= low:
        return (float(nominal_spacing_m or 0.0), 0.0)

    band = correlation[low : high + 1]
    index = int(np.argmax(band)) + low
    if 0 < index < correlation.size - 1:
        a, b, c = correlation[index - 1], correlation[index], correlation[index + 1]
        denominator = a - 2 * b + c
        offset = 0.0 if denominator == 0 else 0.5 * (a - c) / denominator
    else:
        offset = 0.0
    pitch_m = (index + offset) * gsd_m
    peak = float(correlation[index])
    confidence = float(np.clip((peak - float(np.median(band))) / (abs(peak) + 1e-9), 0.0, 1.0))
    return (float(pitch_m), confidence)


def check_pitch(recovered_m: float, grower_spacing_m: float) -> tuple[bool, str]:
    """Cross-check a recovered pitch against what the grower said they planted.

    Disagreement beyond :data:`PITCH_DISAGREEMENT_WARN` usually means the angle
    estimate landed on a harmonic, giving a pitch that is a neat multiple or
    fraction of the truth. Naming the harmonic is more useful than reporting a
    mismatch, because it says which way the fit went wrong.

    Returns:
        ``(ok, message)``. Never raises: a wrong pitch is a warning that has to
        reach the operator, not a crash that hides the field.
    """
    if grower_spacing_m <= 0:
        return (False, "grower spacing must be positive")
    if recovered_m <= 0:
        return (False, "no pitch was recovered")

    ratio = recovered_m / grower_spacing_m
    error = abs(recovered_m - grower_spacing_m) / grower_spacing_m
    if error <= PITCH_DISAGREEMENT_WARN:
        return (
            True,
            f"pitch {recovered_m:.3f} m agrees with the grower's {grower_spacing_m:.3f} m",
        )

    for factor, name in ((0.5, "half"), (2.0, "double"), (1 / 3, "a third of"), (3.0, "triple")):
        if abs(ratio - factor) / factor < 0.12:
            return (
                False,
                f"pitch {recovered_m:.3f} m is {name} the grower's {grower_spacing_m:.3f} m: "
                "the angle estimate has probably landed on a harmonic",
            )
    return (
        False,
        f"pitch {recovered_m:.3f} m disagrees with the grower's {grower_spacing_m:.3f} m "
        f"by {error:.0%}",
    )


# --------------------------------------------------------------------------
# Phase and centerlines
# --------------------------------------------------------------------------


def profile_phase(profile: np.ndarray, pitch_samples: float) -> float:
    """Offset of the row comb within a profile, in samples, in [0, pitch).

    Taken from the phase of the Fourier component at the row frequency, which is
    the circular mean of every row's contribution. Using the single tallest peak
    instead would hand the whole field's alignment to one lucky row.

    Not used by the fit. :func:`phase_from_mask` does that job in ground
    coordinates, because a profile's index origin depends on how the projection
    was cropped and trimmed, and getting that wrong puts every centerline at a
    random offset while the angle and pitch still look perfect.
    """
    n = profile.size
    centred = np.asarray(profile, dtype=np.float64) - np.mean(profile)
    k = n / pitch_samples
    index = np.arange(n)
    component = np.sum(centred * np.exp(-2j * np.pi * k * index / n))
    phase = (-np.angle(component) / (2 * np.pi)) * pitch_samples
    return float(phase % pitch_samples)


def phase_from_mask(
    mask: np.ndarray,
    transform: Any,
    angle_ground_deg: float,
    pitch_m: float,
    factor: int = 1,
    reference_xy_m: tuple[float, float] = (0.0, 0.0),
) -> float:
    """Row phase in ground metres, from the mask itself.

    The circular mean of ``exp(2*pi*i*across/pitch)`` over every vegetated pixel,
    where ``across`` is the signed distance along the row normal in ground
    coordinates. That is the same expression :func:`signed_distance_to_row` uses,
    so the phase is defined by the arithmetic that consumes it and there is no
    coordinate convention left to get wrong.

    ``reference_xy_m`` is subtracted first and matters enormously. In a UTM CRS
    the coordinates are around 1e6, so an angle off by 0.05 degrees turns
    ``x * -sin(theta)`` into a 400 m offset, and 400 m modulo a 76 cm pitch is
    uniform noise. Referencing the tile centre bounds the lever arm at half a
    tile, where the same angle error is worth a few millimetres.

    The other alternative, reading the offset out of the Radon profile, was tried
    and was wrong too. The profile is cropped to a square and trimmed where the
    chord gets short, so its index origin is not the tile origin. Angle and pitch
    came out exact and every centerline sat at a random offset, which is the kind
    of error that looks like a working model: crop plants fell 19 cm from the
    nearest fitted row on a 76 cm pitch, which is what uniform noise looks like.
    """
    if pitch_m <= 0:
        return 0.0
    transform = raster_io.as_transform(transform)
    reduced = _downsample(np.asarray(mask), factor)
    if not np.any(reduced > 0):
        return 0.0

    height, width = reduced.shape
    cols = (np.arange(width) + 0.5) * factor
    rows_ = (np.arange(height) + 0.5) * factor
    x = transform.a * cols[None, :] + transform.c
    y = transform.e * rows_[:, None] + transform.f

    theta = math.radians(angle_ground_deg)
    across = (x - reference_xy_m[0]) * -math.sin(theta) + (y - reference_xy_m[1]) * math.cos(theta)
    component = np.sum(reduced * np.exp(2j * np.pi * across / pitch_m))
    if component == 0:
        return 0.0
    return float((np.angle(component) / (2 * np.pi) * pitch_m) % pitch_m)


def centerline_offsets(profile: np.ndarray, pitch_px: float) -> np.ndarray:
    """Peak positions in a projection profile, as the row centerlines.

    Kept because the spec asks for it and because it is the honest way to see
    what the profile actually contains. The model itself uses pitch and phase,
    which survive a planter skip that leaves a row without a peak to find.
    """
    from scipy.signal import find_peaks

    profile = np.asarray(profile, dtype=np.float64)
    if profile.size == 0:
        return np.zeros(0)
    peaks, _ = find_peaks(
        profile, distance=max(pitch_px * 0.6, 1.0), height=float(np.median(profile))
    )
    return peaks.astype(np.float64)


# --------------------------------------------------------------------------
# Fitting
# --------------------------------------------------------------------------


def fit_tile(
    mask: np.ndarray,
    transform: Any,
    grower_spacing_m: float,
    pitch_method: str = "fft",
    trust_grower_on_disagreement: bool = True,
) -> RowTile:
    """Fit one tile: angle, pitch, phase, and how much to believe them."""
    transform = raster_io.as_transform(transform)
    gsd = raster_io.gsd_m(transform)
    vegetation_fraction = float(np.mean(mask)) if mask.size else 0.0

    angle_px, angle_conf = row_angle(mask, gsd, grower_spacing_m)
    profile, sample_m = projection_profile(mask, angle_px, gsd, grower_spacing_m)
    pitch_m, pitch_conf = row_pitch(profile, sample_m, pitch_method, grower_spacing_m)

    ok, message = check_pitch(pitch_m, grower_spacing_m)
    recovered_pitch_m = pitch_m
    used_grower = False
    if not ok and trust_grower_on_disagreement:
        # The grower knows what they planted; a harmonic would double or halve
        # every row in the field. Keep their number and say the fit was weak.
        pitch_m = grower_spacing_m
        pitch_conf *= 0.5
        used_grower = True

    angle_ground = pixel_angle_to_ground(angle_px, transform)
    height, width = mask.shape[:2]
    centre_xy = transform.center(width / 2.0 - 0.5, height / 2.0 - 0.5)
    phase_m = phase_from_mask(
        mask,
        transform,
        angle_ground,
        pitch_m,
        downsample_factor(gsd, grower_spacing_m),
        reference_xy_m=centre_xy,
    )

    origin_x, origin_y = transform.xy(0, height)
    confidence = min(angle_conf, pitch_conf)

    return RowTile(
        origin_xy_m=(origin_x, origin_y),
        centre_xy_m=(float(centre_xy[0]), float(centre_xy[1])),
        size_m=max(width, height) * gsd,
        angle_deg=angle_ground,
        pitch_m=float(pitch_m),
        phase_m=float(phase_m),
        confidence=float(confidence),
        angle_confidence=float(angle_conf),
        pitch_confidence=float(pitch_conf),
        vegetation_fraction=vegetation_fraction,
        pitch_from_grower=used_grower,
        recovered_pitch_m=float(recovered_pitch_m),
    )


def _harmonic_message(tile: RowTile, grower_spacing_m: float) -> str:
    """Why a tile fell back to the grower's spacing, using what it actually found."""
    return (
        f"tile at {tile.origin_xy_m[0]:.1f}, {tile.origin_xy_m[1]:.1f}: "
        + check_pitch(tile.recovered_pitch_m, grower_spacing_m)[1]
        + "; using the grower's spacing instead"
    )


def fit(
    mask: np.ndarray,
    transform: Any,
    grower_spacing_m: float,
    tile_m: float = 20.0,
    pitch_method: str = "fft",
    crs: Any = None,
) -> RowModel:
    """Fit a per-tile row model to a vegetation mask held in memory.

    For small rasters and tests. A field-sized mask does not belong in memory;
    use :func:`fit_from_raster`.

    Args:
        mask: Boolean vegetation mask.
        transform: Raster transform, which carries the GSD and the origin.
        grower_spacing_m: Row spacing the grower reports. Used to cross-check the
            recovered pitch and to size the downsample, never silently fitted to.
        tile_m: Tile edge length for local refitting.
        pitch_method: ``"fft"`` or ``"autocorrelation"``.
    """
    transform = raster_io.as_transform(transform)
    gsd = raster_io.gsd_m(transform)
    tile_px = max(int(round(tile_m / gsd)), 16)

    tiles: list[RowTile] = []
    messages: list[str] = []
    height, width = mask.shape[:2]
    for row_off in range(0, max(height - tile_px // 2, 1), tile_px):
        for col_off in range(0, max(width - tile_px // 2, 1), tile_px):
            sub = mask[row_off : row_off + tile_px, col_off : col_off + tile_px]
            if sub.shape[0] < 16 or sub.shape[1] < 16 or not np.any(sub):
                continue
            sub_transform = transform.translated(col_off, row_off)
            tile = fit_tile(sub, sub_transform, grower_spacing_m, pitch_method)
            tiles.append(tile)
            if tile.pitch_from_grower:
                messages.append(_harmonic_message(tile, grower_spacing_m))

    model = RowModel(
        tiles=tiles,
        tile_size_m=tile_m,
        nominal_spacing_m=grower_spacing_m,
        crs=crs,
        warnings=messages,
    )
    _warn_if_weak(model)
    return model


def fit_from_raster(
    path: Path | str,
    grower_spacing_m: float,
    tile_m: float = 20.0,
    boundary: Any = None,
    params: Any = None,
    backend: str = "auto",
    pitch_method: str = "fft",
) -> RowModel:
    """Fit a row model straight from an orthomosaic, one tile at a time.

    The production path. Tiles are read through :func:`offrow.io.iter_windows`
    with no overlap, because a row model is a field-wide property and does not
    need seam handling: nothing here is counted, only measured.
    """
    from offrow import vegetation

    tiles: list[RowTile] = []
    messages: list[str] = []
    crs = None
    for chip in raster_io.iter_windows(
        path, window_m=tile_m, overlap_m=0.0, boundary=boundary, backend=backend
    ):
        crs = chip.crs
        valid = (
            raster_io.clip_to_boundary(chip.array, chip.transform, boundary)
            if boundary is not None
            else None
        )
        mask = vegetation.mask_window(chip.array, chip.gsd_m, params, valid=valid).mask
        if not np.any(mask):
            continue
        tile = fit_tile(mask, chip.transform, grower_spacing_m, pitch_method)
        tiles.append(tile)
        if tile.pitch_from_grower:
            messages.append(_harmonic_message(tile, grower_spacing_m))

    model = RowModel(
        tiles=tiles,
        tile_size_m=tile_m,
        nominal_spacing_m=grower_spacing_m,
        crs=crs,
        warnings=messages,
    )
    _warn_if_weak(model)
    return model


def _warn_if_weak(model: RowModel) -> None:
    if not model.tiles:
        warnings.warn("no tile produced a row fit", RowFitWarning, stacklevel=3)
        return
    if model.confidence < MIN_TILE_CONFIDENCE:
        warnings.warn(
            f"row model confidence {model.confidence:.2f}: the rows were not found. "
            "Candidate distances computed against this model are meaningless, and a low "
            "recall against it says nothing about whether weeds are detectable.",
            RowFitWarning,
            stacklevel=3,
        )
    for message in model.warnings[:3]:
        warnings.warn(message, RowFitWarning, stacklevel=3)


# --------------------------------------------------------------------------
# Querying
# --------------------------------------------------------------------------


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
    points = np.asarray(points, dtype=np.float64)
    if points.ndim != 2 or points.shape[1] != 2:
        raise ValueError("points must be an Nx2 array of ground coordinates")
    if points.size == 0:
        return np.zeros(0)

    return model.offsets_at(points[:, 0], points[:, 1])


def inrow_spacing_residual(points: np.ndarray, model: RowModel) -> np.ndarray:
    """Along-row distance from each point to the nearest expected plant position.

    Planted corn sits at a regular in-row spacing as well as a regular row
    spacing. A blob on the centerline but between plant positions is a weaker
    claim to being crop than one sitting where a plant should be.

    Returns NaN when ``model.inrow_spacing_m`` is unset, which is the usual case:
    nothing estimates it yet. NaN rather than zero, because zero means "exactly
    where a plant should be" and would be a lie.
    """
    points = np.asarray(points, dtype=np.float64)
    if model.inrow_spacing_m is None:
        return np.full(len(points), np.nan)
    if points.size == 0:
        return np.zeros(0)

    angles = np.radians(model.angles_at(points[:, 0], points[:, 1]))
    along = points[:, 0] * np.cos(angles) + points[:, 1] * np.sin(angles)
    spacing = model.inrow_spacing_m
    return (along + spacing / 2.0) % spacing - spacing / 2.0


def _circular_mean_deg(angles_deg: np.ndarray, weights: np.ndarray) -> float:
    """Weighted mean of angles that live modulo 180 degrees."""
    doubled = np.exp(2j * np.radians(angles_deg))
    return float(np.degrees(np.angle((weights * doubled).sum())) / 2.0 % 180.0)
