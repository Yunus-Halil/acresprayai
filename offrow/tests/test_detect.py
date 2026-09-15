"""blobs.py, candidates.py and grid.py: the detector, end to end.

The rules being tested are the ones a reviewer would want to see enforced rather
than asserted in prose: the area floor is the despeckling, exclusions happen
before scoring, a candidate is never called a weed, and a cell's rank is the
product.
"""

from __future__ import annotations

import json
import math
import warnings

import numpy as np
import pytest
from shapely.geometry import Point, box

from offrow import blobs as blobs_mod
from offrow import candidates as candidates_mod
from offrow import grid as grid_mod
from offrow import io, rows, synth
from offrow import vegetation as veg

GSD_M = 0.0055
FIELD_M = 13.0
ORIGIN = (500000.0, 4400000.0)
SPACING_M = 0.762


def transform_for(field_m: float = FIELD_M, gsd_m: float = GSD_M) -> io.Transform:
    return io.Transform.from_origin(ORIGIN[0], ORIGIN[1] + field_m, gsd_m, gsd_m)


def disc_mask(shape, centres_px, radius_px):
    mask = np.zeros(shape, dtype=bool)
    yy, xx = np.mgrid[0 : shape[0], 0 : shape[1]]
    for cx, cy in centres_px:
        mask |= (xx - cx) ** 2 + (yy - cy) ** 2 <= radius_px**2
    return mask


def green_rgb(mask):
    rgb = np.full((*mask.shape, 3), (150, 118, 90), dtype=np.uint8)
    rgb[mask] = (70, 150, 60)
    return rgb


@pytest.fixture(scope="module")
def scene_and_model():
    params = synth.SceneParams(
        width_m=FIELD_M, height_m=FIELD_M, seed=1, row_angle_deg=23.0, weed_density_per_m2=2.0
    )
    scene = synth.generate(params)
    image = synth.render(scene, 5.5)
    result = veg.mask_window(image, GSD_M)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", rows.RowFitWarning)
        model = rows.fit(result.mask, transform_for(), SPACING_M, tile_m=FIELD_M)
    return scene, image, result, model


# --------------------------------------------------------------------------
# blobs.py
# --------------------------------------------------------------------------


def test_the_area_floor_is_the_despeckling():
    """Ground units, continuous in GSD, unlike a structuring element.

    A 1 cm2 floor is 3.3 pixels at 5.5 mm/px and 13.2 at 2.75. Both are 1 cm2 of
    ground, which is the property morphology cannot offer.
    """
    assert blobs_mod.min_area_px(0.0055, 1.0) == pytest.approx(3.31, rel=0.01)
    assert blobs_mod.min_area_px(0.00275, 1.0) == pytest.approx(13.22, rel=0.01)
    assert blobs_mod.min_area_px(0.0055, 1.0) * (0.0055**2) == pytest.approx(0.0001)


def test_the_floor_leaves_the_flight_spec_target_a_margin():
    """The spec's 4 cm2 default sat on top of the thing being looked for.

    A weed's canopy diameter is not its leaf area. A 3 cm rosette covers about
    72 percent of its own circle, so about 5 cm2, and a 4 cm2 floor deleted
    two thirds of the 3 cm weeds in a synthetic field while buying no reduction
    in false positives at all.
    """
    leaf_area_of_a_3cm_weed_cm2 = 0.72 * math.pi * 1.5**2
    assert leaf_area_of_a_3cm_weed_cm2 == pytest.approx(5.09, rel=0.01)
    assert blobs_mod.MIN_AREA_CM2 < leaf_area_of_a_3cm_weed_cm2 / 3


def test_blobs_below_the_floor_are_dropped():
    mask = disc_mask((300, 300), [(80, 80), (200, 200)], 12)  # about 13.7 cm2 each
    mask |= disc_mask((300, 300), [(150, 40)], 2)  # about 0.4 cm2
    rgb = green_rgb(mask)
    kept = blobs_mod.extract(mask, rgb, GSD_M, min_area_cm2=4.0)
    assert len(kept) == 2
    assert min(b.area_m2 for b in kept) * 1e4 > 4.0


def test_the_floor_is_the_same_ground_area_at_two_gsds():
    """The claim that makes it better than morphology."""
    fine = blobs_mod.min_area_px(0.00275) * 0.00275**2
    coarse = blobs_mod.min_area_px(0.011) * 0.011**2
    assert fine == pytest.approx(coarse)


def test_gsd_must_be_positive():
    with pytest.raises(ValueError):
        blobs_mod.min_area_px(0.0)


def test_every_spec_feature_is_present(scene_and_model):
    _scene, image, result, model = scene_and_model
    found = blobs_mod.extract(
        result.mask, image, GSD_M, transform_for(), model, coverage=result.coverage
    )
    assert found
    blob = found[0]
    for name in (
        "area_m2",
        "equiv_diameter_m",
        "eccentricity",
        "solidity",
        "extent",
        "compactness",
        "major_axis_m",
        "minor_axis_m",
        "orientation_rel_row_deg",
        "chroma_r_mean",
        "chroma_g_std",
        "exg_mean",
        "lab_a_mean",
        "lab_b_std",
        "distance_to_row_m",
        "inrow_spacing_residual_m",
    ):
        assert hasattr(blob, name), name
    assert blob.lbp_histogram.shape == (blobs_mod.LBP_BINS,)
    assert blob.lbp_histogram.sum() == pytest.approx(1.0)
    assert blob.as_feature_vector().shape == (len(blob.FEATURE_NAMES) + blobs_mod.LBP_BINS,)


def test_features_that_nothing_uses_yet_are_still_finite(scene_and_model):
    """They feed the one-class step. A NaN now is a bug discovered much later."""
    _scene, image, result, model = scene_and_model
    found = blobs_mod.extract(result.mask, image, GSD_M, transform_for(), model)
    for name in ("eccentricity", "solidity", "extent", "compactness", "lab_a_mean", "exg_std"):
        values = np.array([getattr(b, name) for b in found])
        assert np.isfinite(values).all(), name


def test_row_relative_features_are_nan_without_a_row_model():
    """NaN, not zero. Zero means 'on the row', which is the opposite claim."""
    mask = disc_mask((200, 200), [(100, 100)], 12)
    blob = blobs_mod.extract(mask, green_rgb(mask), GSD_M)[0]
    assert math.isnan(blob.distance_to_row_m)
    assert math.isnan(blob.inrow_spacing_residual_m)
    assert math.isnan(blob.orientation_rel_row_deg)


def test_ground_units_do_not_depend_on_gsd():
    """The same disc at two resolutions is the same plant."""
    fine = disc_mask((400, 400), [(200, 200)], 40)
    coarse = disc_mask((200, 200), [(100, 100)], 20)
    a = blobs_mod.extract(fine, green_rgb(fine), 0.00275)[0]
    b = blobs_mod.extract(coarse, green_rgb(coarse), 0.0055)[0]
    assert a.area_m2 == pytest.approx(b.area_m2, rel=0.02)
    assert a.equiv_diameter_m == pytest.approx(b.equiv_diameter_m, rel=0.02)
    assert a.major_axis_m == pytest.approx(b.major_axis_m, rel=0.02)


def test_orientation_convention_is_calibrated():
    """skimage measures orientation from the row axis and the other way round."""
    from skimage.draw import ellipse

    for want in (0.0, 30.0, 60.0, 135.0):
        image = np.zeros((201, 201), dtype=bool)
        rr, cc = ellipse(100, 100, 8, 40, rotation=-math.radians(want))
        image[rr, cc] = True
        from skimage.measure import label, regionprops

        region = regionprops(label(image))[0]
        got = blobs_mod.array_orientation_deg(region.orientation)
        diff = abs(got - want) % 180.0
        assert min(diff, 180.0 - diff) < 1.0


def test_blobs_touching_a_border_are_flagged():
    mask = disc_mask((200, 200), [(0, 100), (100, 100)], 12)
    found = blobs_mod.extract(mask, green_rgb(mask), GSD_M)
    assert sum(b.touches_border for b in found) == 1


def test_coverage_area_is_carried_alongside_the_pixel_count(scene_and_model):
    _scene, image, result, model = scene_and_model
    found = blobs_mod.extract(
        result.mask, image, GSD_M, transform_for(), model, coverage=result.coverage
    )
    assert all(b.coverage_area_m2 > 0 for b in found)
    assert all(b.coverage_area_m2 <= b.area_m2 * 1.05 for b in found)


# --------------------------------------------------------------------------
# candidates.py
# --------------------------------------------------------------------------


def test_score_is_zero_at_the_band_edge_and_one_at_the_midpoint():
    band = 0.30 * SPACING_M
    assert candidates_mod.score(band, SPACING_M) == pytest.approx(0.0)
    assert candidates_mod.score(SPACING_M / 2, SPACING_M) == pytest.approx(1.0)
    assert 0.0 < candidates_mod.score((band + SPACING_M / 2) / 2, SPACING_M) < 1.0


def test_score_is_symmetric_in_sign():
    assert candidates_mod.score(0.3, SPACING_M) == candidates_mod.score(-0.3, SPACING_M)


def test_score_is_clipped():
    assert candidates_mod.score(10.0, SPACING_M) == 1.0
    assert candidates_mod.score(0.0, SPACING_M) == 0.0


def test_score_of_an_unknown_distance_is_zero_not_an_exception():
    """A blob with no row model has no geometric claim; the queue is not the
    place to discover that."""
    assert candidates_mod.score(float("nan"), SPACING_M) == 0.0


def test_a_band_that_swallows_the_interrow_is_refused():
    with pytest.raises(ValueError, match="no inter-row"):
        candidates_mod.score(0.3, SPACING_M, band_frac=0.5)


def test_exclusions_are_applied_before_scoring():
    """Not after. Excluded ground must not reach the scorer or the denominator."""
    field = box(0, 0, 100, 100)
    near_edge = _fake_blob(2.0, 50.0, distance=0.35)
    middle = _fake_blob(50.0, 50.0, distance=0.35)
    kept = candidates_mod.apply_exclusions([near_edge, middle], field, headland_buffer_m=15.0)
    assert kept == [middle]


def test_headland_exclusion_drops_inside_and_keeps_just_outside():
    """The spec's requirement, at the buffer edge where it can be off by one."""
    field = box(0, 0, 100, 100)
    just_inside = _fake_blob(14.5, 50.0, distance=0.35)
    just_outside = _fake_blob(15.5, 50.0, distance=0.35)
    kept = candidates_mod.apply_exclusions(
        [just_inside, just_outside], field, headland_buffer_m=15.0
    )
    assert kept == [just_outside]


def test_a_buffer_that_eats_the_field_says_so():
    """An empty queue from a consumed field reads exactly like a clean field."""
    with pytest.warns(UserWarning, match="not the same as a clean field"):
        assert (
            candidates_mod.apply_exclusions(
                [_fake_blob(10.0, 10.0, 0.35)], box(0, 0, 20, 20), headland_buffer_m=15.0
            )
            == []
        )


def test_user_exclusion_polygons_are_honoured():
    field = box(0, 0, 100, 100)
    inside_zone = _fake_blob(50.0, 50.0, distance=0.35)
    outside_zone = _fake_blob(80.0, 80.0, distance=0.35)
    kept = candidates_mod.apply_exclusions(
        [inside_zone, outside_zone], field, 0.0, [box(40, 40, 60, 60)]
    )
    assert kept == [outside_zone]


def test_in_row_blobs_are_not_candidates(scene_and_model):
    _scene, image, result, model = scene_and_model
    found = blobs_mod.extract(result.mask, image, GSD_M, transform_for(), model)
    queue = candidates_mod.detect(
        found, model, params=candidates_mod.CandidateParams(headland_buffer_m=0.0)
    )
    band = 0.30 * model.median_pitch_m
    assert all(abs(c.distance_to_row_m) > band for c in queue)
    assert len(queue) < len(found), "not every blob is off-row"


def test_candidates_come_back_sorted(scene_and_model):
    _scene, image, result, model = scene_and_model
    found = blobs_mod.extract(result.mask, image, GSD_M, transform_for(), model)
    queue = candidates_mod.detect(
        found, model, params=candidates_mod.CandidateParams(headland_buffer_m=0.0)
    )
    scores = [c.score for c in queue]
    assert scores == sorted(scores, reverse=True)


def test_detect_without_a_row_model_is_refused():
    with pytest.raises(ValueError, match="off-row is meaningless"):
        candidates_mod.detect([], None)


def test_a_low_confidence_row_model_warns_rather_than_silently_ranking():
    model = rows.RowModel(
        tiles=[
            rows.RowTile(
                origin_xy_m=(0.0, 0.0),
                centre_xy_m=(5.0, 5.0),
                size_m=10.0,
                angle_deg=0.0,
                pitch_m=SPACING_M,
                phase_m=0.0,
                confidence=0.5,
                angle_confidence=0.5,
                pitch_confidence=0.5,
                vegetation_fraction=0.1,
            )
        ],
        nominal_spacing_m=SPACING_M,
    )
    with pytest.warns(candidates_mod.LowRowConfidence):
        candidates_mod.detect(
            [], model, params=candidates_mod.CandidateParams(min_row_confidence=0.9)
        )


def test_nothing_in_the_output_calls_a_candidate_a_weed(tmp_path, scene_and_model):
    """The spec's hardest rule to keep by accident."""
    _scene, image, result, model = scene_and_model
    found = blobs_mod.extract(result.mask, image, GSD_M, transform_for(), model)
    queue = candidates_mod.detect(
        found, model, params=candidates_mod.CandidateParams(headland_buffer_m=0.0)
    )
    path = candidates_mod.to_geojson(queue[:20], tmp_path / "c.geojson")
    payload = json.loads(path.read_text(encoding="utf-8"))
    text = json.dumps(payload).lower()
    assert "weed" not in text
    assert payload["features"][0]["properties"]["status"] == "for review"


def test_reviewable_acres_excludes_the_headland():
    field = box(0, 0, 100, 100)
    whole = candidates_mod.reviewable_acres(field, 0.0)
    trimmed = candidates_mod.reviewable_acres(field, 15.0)
    assert trimmed < whole
    assert trimmed == pytest.approx(70 * 70 / 4046.8564224, rel=1e-6)


def _fake_blob(x, y, distance):
    return blobs_mod.Blob(
        centroid_xy_m=(x, y),
        area_m2=0.001,
        equiv_diameter_m=0.03,
        eccentricity=0.1,
        solidity=1.0,
        extent=0.8,
        compactness=1.0,
        major_axis_m=0.03,
        minor_axis_m=0.03,
        orientation_rel_row_deg=0.0,
        chroma_r_mean=0.3,
        chroma_r_std=0.0,
        chroma_g_mean=0.4,
        chroma_g_std=0.0,
        chroma_b_mean=0.3,
        chroma_b_std=0.0,
        exg_mean=0.2,
        exg_std=0.0,
        lab_a_mean=-10.0,
        lab_a_std=0.0,
        lab_b_mean=20.0,
        lab_b_std=0.0,
        lbp_histogram=np.zeros(blobs_mod.LBP_BINS),
        distance_to_row_m=distance,
        inrow_spacing_residual_m=float("nan"),
        gsd_m=GSD_M,
        geometry=Point(x, y),
    )


# --------------------------------------------------------------------------
# grid.py
# --------------------------------------------------------------------------


def _fake_candidate(x, y, score, area=0.001):
    return candidates_mod.Candidate(
        centroid_xy_m=(x, y),
        score=score,
        distance_to_row_m=0.35,
        area_m2=area,
        gsd_m=GSD_M,
        geometry=Point(x, y),
    )


def test_cells_are_snapped_to_the_crs_not_the_field_corner():
    """Two fields sharing a border get cells that line up."""
    cells = grid_mod.tesselate((503.0, 707.0, 523.0, 727.0), cell_m=10.0)
    assert all(cell.origin_xy_m[0] % 10 == 0 for cell in cells)
    assert all(cell.origin_xy_m[1] % 10 == 0 for cell in cells)


def test_a_candidate_lands_in_exactly_one_cell():
    candidates = [_fake_candidate(x, 5.0, 0.5) for x in (0.0, 9.999, 10.0, 10.001)]
    cells = grid_mod.aggregate(candidates, cell_m=10.0)
    assert sum(c.candidate_count for c in cells) == len(candidates)
    assert {c.origin_xy_m for c in cells if c.candidate_count} == {(0.0, 0.0), (10.0, 0.0)}


def test_cell_carries_max_score_count_and_area():
    cells = grid_mod.aggregate(
        [_fake_candidate(1.0, 1.0, 0.2, 0.01), _fake_candidate(2.0, 2.0, 0.9, 0.02)],
        cell_m=10.0,
    )
    cell = next(c for c in cells if c.candidate_count)
    assert cell.max_score == pytest.approx(0.9)
    assert cell.candidate_count == 2
    assert cell.candidate_area_m2 == pytest.approx(0.03)


def test_ranking_is_by_worst_candidate_then_count():
    """One confident candidate beats ten marginal ones; that is the design."""
    cells = grid_mod.aggregate(
        [
            _fake_candidate(5.0, 5.0, 0.95),
            *[_fake_candidate(15.0 + i * 0.1, 5.0, 0.4) for i in range(10)],
        ],
        cell_m=10.0,
    )
    ranked = grid_mod.rank(cells)
    assert ranked[0].max_score == pytest.approx(0.95)
    assert ranked[0].candidate_count == 1


def test_geojson_is_sorted_by_max_score_descending(tmp_path):
    cells = grid_mod.aggregate(
        [_fake_candidate(5.0, 5.0, 0.2), _fake_candidate(15.0, 5.0, 0.9)], cell_m=10.0
    )
    path = grid_mod.to_geojson(cells, tmp_path / "g.geojson")
    payload = json.loads(path.read_text(encoding="utf-8"))
    scores = [f["properties"]["max_score"] for f in payload["features"]]
    assert scores == sorted(scores, reverse=True)
    assert payload["features"][0]["properties"]["rank"] == 1
    assert "weed" not in json.dumps(payload).lower()


def test_empty_cells_are_dropped_by_default():
    cells = grid_mod.aggregate(
        [_fake_candidate(5.0, 5.0, 0.5)], cell_m=10.0, boundary=box(0, 0, 40, 40)
    )
    assert len(cells) > 1
    assert len(grid_mod.rank(cells)) == 1


def test_cell_size_must_be_positive():
    with pytest.raises(ValueError):
        grid_mod.tesselate((0, 0, 10, 10), cell_m=0.0)


# --------------------------------------------------------------------------
# End to end
# --------------------------------------------------------------------------


@pytest.mark.slow
def test_end_to_end_on_a_synthetic_field_with_shadows(tmp_path):
    """The spec's end-to-end requirement, at 5.5 mm GSD with shadows on.

    The floor is on off-row truth, which is what a geometric detector claims to
    find. In-row weeds are out of scope by construction and counting them would
    be scoring the method against a problem it does not claim to solve.
    """
    params = synth.SceneParams(
        width_m=FIELD_M,
        height_m=FIELD_M,
        seed=7,
        shadows=True,
        weed_density_per_m2=2.0,
        row_spacing_m=SPACING_M,
    )
    scene = synth.generate(params)
    image = synth.render(scene, 5.5)
    result = veg.mask_window(image, GSD_M)
    transform = transform_for()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", rows.RowFitWarning)
        model = rows.fit(result.mask, transform, SPACING_M, tile_m=FIELD_M)
    assert model.confidence > 0.9

    found = blobs_mod.extract(result.mask, image, GSD_M, transform, model, coverage=result.coverage)
    queue = candidates_mod.detect(
        found, model, params=candidates_mod.CandidateParams(headland_buffer_m=0.0)
    )
    assert queue

    from offrow import eval as eval_mod

    ground = scene.ground_xy(scene.weed_xy_m)
    distances = rows.signed_distance_to_row(ground, model)
    band = 0.30 * model.median_pitch_m
    truth = [
        eval_mod.TruthPoint(xy_m=(float(x), float(y)), diameter_m=float(d))
        for (x, y), d, dist in zip(ground, scene.weed_diameter_m, distances, strict=True)
        if abs(dist) > band
    ]
    acres = FIELD_M * FIELD_M / 4046.8564224
    curves = eval_mod.recall_fp_curve(queue, truth, acres, tolerance_m=0.25)

    from offrow import datasets

    smallest = datasets.diameter_bin_labels()[datasets.FLIGHT_SPEC_BIN]
    recall = curves[smallest].recall_at_budget(200.0)
    assert np.isfinite(recall)
    assert recall > 0.5, f"flight-spec bin recall {recall:.2%}"


def test_grid_command_round_trips(tmp_path):
    """GeoJSON out of detect has to be readable by grid without GDAL."""
    queue = [_fake_candidate(5.0, 5.0, 0.9), _fake_candidate(25.0, 5.0, 0.3)]
    path = candidates_mod.to_geojson(queue, tmp_path / "c.geojson", crs="EPSG:32614")
    geometries, properties, crs = io.read_geojson(path)
    assert crs == "EPSG:32614"
    assert [p["score"] for p in properties] == [0.9, 0.3]
    assert [g.x for g in geometries] == [5.0, 25.0]
