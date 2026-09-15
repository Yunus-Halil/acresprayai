"""rows.py: does the fitted grid land on the rows that are actually there.

Angle and pitch are easy to check and easy to get right. The phase is neither,
and it is the one that decides whether a candidate is off-row, so most of this
file is about it. Two phase bugs were found by the test that compares the model
against known crop positions, and neither would have shown up in an angle or
pitch assertion: both left those exact.
"""

from __future__ import annotations

import warnings

import numpy as np
import pytest

from offrow import io, rows, synth
from offrow import vegetation as veg

GSD_MM = 5.5
GSD_M = GSD_MM / 1000.0
FIELD_M = 13.0
ORIGIN = (500000.0, 4400000.0)

#: Planter jitter in the fixture is 1.9 cm across-row, so a perfect fit still
#: leaves about that much. Anything under 4 cm on a 76 cm pitch is the grid
#: landing on the rows; 19 cm would be uniform noise.
CROP_DISTANCE_CEILING_M = 0.04


def transform_for(field_m: float = FIELD_M, gsd_m: float = GSD_M) -> io.Transform:
    return io.Transform.from_origin(ORIGIN[0], ORIGIN[1] + field_m, gsd_m, gsd_m)


def fitted(gsd_mm: float = GSD_MM, tile_m: float = FIELD_M, grower_m: float | None = None, **kw):
    """Render a scene, mask it, fit rows, and hand back both."""
    params = dict(width_m=FIELD_M, height_m=FIELD_M, seed=1, weed_density_per_m2=0.5)
    params.update(kw)
    scene = synth.generate(synth.SceneParams(**params))
    gsd_m = gsd_mm / 1000.0
    mask = veg.mask_window(synth.render(scene, gsd_mm), gsd_m).mask
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", rows.RowFitWarning)
        model = rows.fit(
            mask,
            transform_for(FIELD_M, gsd_m),
            grower_m if grower_m is not None else scene.params.row_spacing_m,
            tile_m=tile_m,
        )
    return scene, model


def expected_ground_angle(scene: synth.Scene) -> float:
    """The scene's row angle as it appears on the ground.

    The scene's y grows downward like an array's row index; a north-up raster's
    ground y grows upward. So the angle is mirrored.
    """
    return (-scene.params.row_angle_deg) % 180.0


def angle_error_deg(got: float, want: float) -> float:
    """Difference between two angles that live modulo 180."""
    diff = abs(got - want) % 180.0
    return min(diff, 180.0 - diff)


# --------------------------------------------------------------------------
# Angle
# --------------------------------------------------------------------------


@pytest.mark.parametrize("angle", [0.0, 23.0, 45.0, 67.0, 90.0, 112.0, 140.0, 175.0])
def test_row_angle_is_recovered_within_one_degree(angle):
    """The spec's sweep across angles 0 to 175."""
    scene, model = fitted(row_angle_deg=angle)
    assert angle_error_deg(model.median_angle_deg, expected_ground_angle(scene)) < 1.0


def test_angle_convention_is_a_reflection_not_a_rotation():
    """Why a single-angle test is not enough.

    Radon's theta runs the opposite way to an angle measured counterclockwise in
    an array whose row index grows downward, so the array-frame angle is
    ``90 - theta``. Using ``theta - 90`` is a reflection about 0, which agrees at
    0 and 90 degrees and is wrong everywhere else. A fixture at 0 degrees passes
    either way, which is how the mistake survives.
    """
    mask = np.zeros((256, 256), dtype=bool)
    mask[::16, :] = True  # rows along the array's +x axis
    angle_px, _ = rows.row_angle(mask)
    assert angle_error_deg(angle_px, 0.0) < 1.0

    diagonal = np.zeros((256, 256), dtype=bool)
    yy, xx = np.mgrid[0:256, 0:256]
    diagonal[((yy - xx) % 24) < 2] = True  # rows along +45 degrees in array space
    angle_px, _ = rows.row_angle(diagonal)
    assert angle_error_deg(angle_px, 45.0) < 2.0


def test_ground_angle_flips_for_a_north_up_raster():
    north_up = io.Transform.from_origin(0, 100, 0.01, 0.01)
    assert rows.pixel_angle_to_ground(23.0, north_up) == pytest.approx(157.0)
    south_up = io.Transform(0.01, 0.0, 0.0, 0.0, 0.01, 0.0)
    assert rows.pixel_angle_to_ground(23.0, south_up) == pytest.approx(23.0)


# --------------------------------------------------------------------------
# Pitch
# --------------------------------------------------------------------------


@pytest.mark.parametrize("spacing", [0.50, 0.70, 0.762, 0.914, 1.10])
def test_row_pitch_is_recovered_within_three_percent(spacing):
    """The spec's sweep across pitches."""
    scene, model = fitted(row_spacing_m=spacing, inrow_spacing_m=spacing * 0.2)
    error = abs(model.median_pitch_m - spacing) / spacing
    assert error < 0.03, f"pitch {model.median_pitch_m:.4f} against {spacing}"


def test_autocorrelation_agrees_with_fft():
    """Both methods the spec allows, on the same profile."""
    scene, _ = fitted()
    mask = veg.mask_window(synth.render(scene, GSD_MM), GSD_M).mask
    spacing = scene.params.row_spacing_m
    angle_px, _ = rows.row_angle(mask, GSD_M, spacing)
    profile, sample_m = rows.projection_profile(mask, angle_px, GSD_M, spacing)
    by_fft, _ = rows.row_pitch(profile, sample_m, "fft", spacing)
    by_acf, _ = rows.row_pitch(profile, sample_m, "autocorrelation", spacing)
    assert abs(by_fft - spacing) / spacing < 0.03
    assert abs(by_acf - spacing) / spacing < 0.05


def test_unknown_pitch_method_is_refused():
    with pytest.raises(ValueError):
        rows.row_pitch(np.sin(np.arange(200) / 3.0), 0.01, method="wishful")


# --------------------------------------------------------------------------
# The harmonic check
# --------------------------------------------------------------------------


def test_check_pitch_accepts_agreement():
    ok, message = rows.check_pitch(0.770, 0.762)
    assert ok
    assert "agrees" in message


@pytest.mark.parametrize(
    ("recovered", "grower", "word"),
    [(1.524, 0.762, "double"), (0.381, 0.762, "half"), (0.254, 0.762, "a third of")],
)
def test_check_pitch_names_the_harmonic(recovered, grower, word):
    """Naming the harmonic says which way the fit went wrong; a mismatch does not."""
    ok, message = rows.check_pitch(recovered, grower)
    assert not ok
    assert word in message
    assert "harmonic" in message


def test_check_pitch_reports_a_plain_disagreement_too():
    ok, message = rows.check_pitch(1.10, 0.762)
    assert not ok
    assert "disagrees" in message


def test_check_pitch_never_raises():
    for recovered, grower in ((0.0, 0.762), (0.762, 0.0), (-1.0, 0.762)):
        ok, message = rows.check_pitch(recovered, grower)
        assert not ok
        assert message


def test_a_harmonic_falls_back_to_the_grower_and_says_so():
    """The grower knows what they planted; a harmonic doubles every row."""
    scene, model = fitted(grower_m=0.381)
    assert model.median_pitch_m == pytest.approx(0.381)
    assert any(t.pitch_from_grower for t in model.tiles)
    assert model.warnings
    assert "double" in model.warnings[0]
    assert "harmonic" in model.warnings[0]


def test_the_fallback_message_uses_what_was_recovered_not_what_replaced_it():
    """Re-checking after the fallback would report perfect agreement.

    The recovered pitch is kept on the tile for exactly this reason: it is the
    only evidence that the fit went wrong, and overwriting it destroys the
    warning while leaving the model looking healthy.
    """
    _scene, model = fitted(grower_m=0.381)
    tile = next(t for t in model.tiles if t.pitch_from_grower)
    assert tile.recovered_pitch_m == pytest.approx(0.762, rel=0.05)
    assert tile.pitch_m == pytest.approx(0.381)


def test_a_harmonic_costs_confidence():
    _scene, honest = fitted()
    _scene2, tricked = fitted(grower_m=0.381)
    assert tricked.confidence < honest.confidence


# --------------------------------------------------------------------------
# Phase: the part that decides whether a candidate is off-row
# --------------------------------------------------------------------------


@pytest.mark.parametrize("angle", [0.0, 23.0, 67.0, 140.0])
@pytest.mark.parametrize("tile_m", [FIELD_M, FIELD_M / 2, FIELD_M / 3])
def test_fitted_rows_land_on_the_known_crop_positions(angle, tile_m):
    """The test that matters, and the one that caught both phase bugs.

    Crop plants are on centerlines by construction, so the distance from the
    fitted model to a known crop position is the fit's error. Uniform noise on a
    76 cm pitch averages 19 cm; a fit that has actually found the rows leaves the
    planter jitter, about 1.5 cm.
    """
    scene, model = fitted(row_angle_deg=angle, tile_m=tile_m)
    distance = rows.signed_distance_to_row(scene.ground_xy(scene.crop_xy_m), model)
    assert np.abs(distance).mean() < CROP_DISTANCE_CEILING_M
    assert np.percentile(np.abs(distance), 95) < 2 * CROP_DISTANCE_CEILING_M


def test_phase_is_measured_from_a_local_origin():
    """A UTM easting is about 1e6, and that is a lever on any angle error.

    ``x * -sin(theta)`` with x at 500000 and theta off by 0.05 degrees is a 436 m
    offset, and 436 m modulo a 76 cm pitch is uniform noise. The same fit
    referenced to the tile centre is worth millimetres. This test states the
    lever directly rather than trusting it not to come back.
    """
    scene, _ = fitted()
    mask = veg.mask_window(synth.render(scene, GSD_MM), GSD_M).mask
    transform = transform_for()
    spacing = scene.params.row_spacing_m
    centre = transform.center(mask.shape[1] / 2 - 0.5, mask.shape[0] / 2 - 0.5)

    truth = rows.phase_from_mask(mask, transform, 0.0, spacing, 8, reference_xy_m=centre)
    nudged = rows.phase_from_mask(mask, transform, 0.05, spacing, 8, reference_xy_m=centre)
    local_shift = abs(((nudged - truth + spacing / 2) % spacing) - spacing / 2)

    far = rows.phase_from_mask(mask, transform, 0.0, spacing, 8, reference_xy_m=(0.0, 0.0))
    far_nudged = rows.phase_from_mask(mask, transform, 0.05, spacing, 8, reference_xy_m=(0.0, 0.0))
    far_shift = abs(((far_nudged - far + spacing / 2) % spacing) - spacing / 2)

    assert local_shift < 0.02, "a tile-centred phase should barely move"
    assert far_shift > 5 * local_shift, "referencing the CRS origin should be far worse"


def test_signed_distance_is_signed():
    """A systematic bias shows up as a nonzero mean; an absolute value hides it."""
    scene, model = fitted()
    distance = rows.signed_distance_to_row(scene.ground_xy(scene.crop_xy_m), model)
    assert distance.min() < 0 < distance.max()
    assert abs(distance.mean()) < CROP_DISTANCE_CEILING_M


def test_signed_distance_is_bounded_by_half_the_pitch():
    scene, model = fitted()
    distance = rows.signed_distance_to_row(scene.ground_xy(scene.weed_xy_m), model)
    assert np.abs(distance).max() <= model.median_pitch_m / 2 + 1e-9


def test_signed_distance_rejects_a_bad_shape():
    _scene, model = fitted()
    with pytest.raises(ValueError):
        rows.signed_distance_to_row(np.zeros((5, 3)), model)


def test_offrow_classification_agrees_with_the_truth():
    """The thing candidates.py will actually do with the model."""
    scene, model = fitted(weed_density_per_m2=3.0)
    band = 0.30 * scene.params.row_spacing_m
    predicted = np.abs(rows.signed_distance_to_row(scene.ground_xy(scene.weed_xy_m), model)) > band
    truth = np.abs(scene.weed_distance_to_row_m) > band
    assert (predicted == truth).mean() > 0.92


# --------------------------------------------------------------------------
# Confidence
# --------------------------------------------------------------------------


def test_confidence_is_high_on_real_rows():
    _scene, model = fitted()
    assert model.confidence > 0.9
    assert model.low_confidence_fraction == 0.0


@pytest.mark.parametrize("kind", ["speckle", "blobs"])
def test_confidence_is_low_on_vegetation_with_no_rows(kind):
    """The metric is worthless unless it falls when there is nothing to find."""
    from scipy.ndimage import gaussian_filter

    rng = np.random.default_rng(0)
    side = int(FIELD_M / GSD_M)
    if kind == "speckle":
        mask = rng.random((side, side)) < 0.06
    else:
        field = gaussian_filter(rng.random((side, side)).astype(np.float32), 8)
        mask = field > np.quantile(field, 0.94)
    tile = rows.fit_tile(mask, transform_for(), 0.762)
    assert tile.confidence < rows.MIN_TILE_CONFIDENCE


def test_a_closed_canopy_has_no_rows_to_find():
    """Nothing in scope is after canopy closure, and the fit should say so."""
    side = int(FIELD_M / GSD_M)
    tile = rows.fit_tile(np.ones((side, side), dtype=bool), transform_for(), 0.762)
    assert tile.confidence < rows.MIN_TILE_CONFIDENCE


def test_one_row_gives_a_direction_but_no_pitch():
    """Why the confidence is split rather than being one number.

    A single row defines a direction perfectly well and says nothing whatever
    about spacing. Reporting one blended score would hide which half failed, and
    those have different fixes.
    """
    side = int(FIELD_M / GSD_M)
    mask = np.zeros((side, side), dtype=bool)
    mask[side // 2 - 3 : side // 2 + 3, :] = True
    tile = rows.fit_tile(mask, transform_for(), 0.762)
    assert tile.angle_confidence > 0.9
    assert tile.pitch_confidence < 0.2
    assert tile.confidence < rows.MIN_TILE_CONFIDENCE


def test_confidence_survives_skips_and_weeds():
    """The spec's robustness case: 20 percent skips with a weed population."""
    _scene, model = fitted(skip_rate=0.20, weed_density_per_m2=3.0)
    assert model.confidence > 0.9


def test_a_model_with_no_usable_tile_refuses_to_be_queried():
    """Better than returning distances computed from nothing."""
    model = rows.RowModel(tiles=[], nominal_spacing_m=0.762)
    with pytest.raises(ValueError, match="no tile met the confidence floor"):
        rows.signed_distance_to_row(np.array([[500000.0, 4400000.0]]), model)


def test_a_weak_fit_warns():
    side = int(FIELD_M / GSD_M)
    rng = np.random.default_rng(1)
    with pytest.warns(rows.RowFitWarning):
        rows.fit(rng.random((side, side)) < 0.06, transform_for(), 0.762, tile_m=FIELD_M)


# --------------------------------------------------------------------------
# Robustness the spec asks for
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "nuisance",
    [
        {"skip_rate": 0.20},
        {"weed_density_per_m2": 3.0},
        {"skip_rate": 0.20, "weed_density_per_m2": 3.0},
        {"shadows": True},
        {"wheel_tracks": True},
        {"wet_patches": True},
        {"shadows": True, "wheel_tracks": True, "wet_patches": True, "skip_rate": 0.20},
    ],
)
def test_the_fit_survives_the_known_false_positive_sources(nuisance):
    """Wheel tracks are the interesting one: linear, parallel, wrong pitch.

    They are the obvious way for a Radon peak to land on the wrong structure,
    which is why they are switchable in synth.py in the first place.
    """
    scene, model = fitted(row_angle_deg=23.0, **nuisance)
    assert angle_error_deg(model.median_angle_deg, expected_ground_angle(scene)) < 1.0
    assert (
        abs(model.median_pitch_m - scene.params.row_spacing_m) / scene.params.row_spacing_m < 0.03
    )
    distance = rows.signed_distance_to_row(scene.ground_xy(scene.crop_xy_m), model)
    assert np.abs(distance).mean() < CROP_DISTANCE_CEILING_M


@pytest.mark.parametrize("gsd_mm", [1.7, 2.75, 5.5, 11.0])
def test_the_fit_holds_across_the_gsd_ladder(gsd_mm):
    """Synthetic, and an upper bound: a 76 cm pitch is 69 px even at 11 mm."""
    scene, model = fitted(gsd_mm=gsd_mm, row_angle_deg=23.0)
    assert angle_error_deg(model.median_angle_deg, expected_ground_angle(scene)) < 1.0
    assert (
        abs(model.median_pitch_m - scene.params.row_spacing_m) / scene.params.row_spacing_m < 0.03
    )


# --------------------------------------------------------------------------
# Centerlines and the raster path
# --------------------------------------------------------------------------


def test_centerlines_cross_the_field():
    """They were once anchored at the point nearest the CRS origin.

    In UTM that is thousands of kilometres from the field, so every segment
    missed it and the function returned nothing at all.
    """
    _scene, model = fitted()
    bounds = (ORIGIN[0], ORIGIN[1], ORIGIN[0] + FIELD_M, ORIGIN[1] + FIELD_M)
    lines = model.centerlines(bounds)
    expected = FIELD_M / model.median_pitch_m
    assert abs(len(lines) - expected) <= 2
    assert all(line.length > FIELD_M * 0.9 for line in lines)


def test_centerlines_sit_on_the_crop():
    _scene, model = fitted()
    bounds = (ORIGIN[0], ORIGIN[1], ORIGIN[0] + FIELD_M, ORIGIN[1] + FIELD_M)
    lines = model.centerlines(bounds)
    from shapely.geometry import Point

    scene, _ = fitted()
    sample = scene.ground_xy(scene.crop_xy_m)[:60]
    worst = max(min(line.distance(Point(x, y)) for line in lines) for x, y in sample)
    assert worst < CROP_DISTANCE_CEILING_M * 2


def test_fit_from_raster_matches_an_in_memory_fit():
    """The production path reads one tile at a time and must not differ for it."""
    path = "data/synth/hard_5.5mm.tif"
    with io.open_raster(path) as reader:
        if reader.width * reader.height > 30_000_000:
            pytest.skip("fixture raster is unexpectedly large")
        full = reader.read(io.Window(0, 0, reader.width, reader.height))
        transform = reader.transform
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", rows.RowFitWarning)
        in_memory = rows.fit(
            veg.mask_window(full, io.gsd_m(transform)).mask, transform, 0.762, tile_m=6.5
        )
        from_raster = rows.fit_from_raster(path, 0.762, tile_m=6.5)

    assert len(from_raster.tiles) == len(in_memory.tiles)
    assert angle_error_deg(from_raster.median_angle_deg, in_memory.median_angle_deg) < 0.5
    assert from_raster.median_pitch_m == pytest.approx(in_memory.median_pitch_m, rel=0.02)


def test_inrow_residual_is_nan_until_something_estimates_it():
    """NaN, not zero. Zero means 'exactly where a plant should be'."""
    _scene, model = fitted()
    residual = rows.inrow_spacing_residual(np.array([[500001.0, 4400001.0]]), model)
    assert np.isnan(residual).all()

    model.inrow_spacing_m = 0.15
    residual = rows.inrow_spacing_residual(np.array([[500001.0, 4400001.0]]), model)
    assert np.isfinite(residual).all()
    assert abs(residual[0]) <= 0.075 + 1e-9


def test_centerline_offsets_finds_the_peaks():
    profile = np.zeros(400)
    profile[::20] = 1.0
    peaks = rows.centerline_offsets(profile, 20.0)
    assert len(peaks) == pytest.approx(20, abs=1)
