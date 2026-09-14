"""synth.py: the invariants that make a synthetic scene worth measuring against.

The scene generator is a measuring instrument. If its ground area changes with
the GSD it is rendered at, or its output changes with the block size it happened
to be rendered in, then every threshold tested against it is testing the
instrument rather than the code.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

from offrow import datasets, synth


def exg(image: np.ndarray) -> np.ndarray:
    """Excess green on chromaticity. Not ``vegetation.py``: that does not exist yet."""
    rgb = image.astype(np.float32)
    total = rgb.sum(axis=2) + 1e-6
    return 2 * rgb[..., 1] / total - rgb[..., 0] / total - rgb[..., 2] / total


def green_area_m2(image: np.ndarray, gsd_mm: float, threshold: float = 0.06) -> float:
    """Vegetated ground area by a hard ExG threshold. What a binary mask gives."""
    return float((exg(image) > threshold).sum()) * (gsd_mm / 1000.0) ** 2


def soft_green_area_m2(
    image: np.ndarray, gsd_mm: float, soil: float = -0.02, plant: float = 0.22
) -> float:
    """Vegetated ground area, unmixing each pixel between soil and plant.

    The coverage-weighted answer, which is what the renderer actually draws. A
    pixel half covered by a leaf counts as half a pixel rather than as one or as
    none.
    """
    coverage = np.clip((exg(image) - soil) / (plant - soil), 0.0, 1.0)
    return float(coverage.sum()) * (gsd_mm / 1000.0) ** 2


def small_scene(**overrides) -> synth.Scene:
    params = synth.SceneParams(
        width_m=3.0, height_m=3.0, seed=5, weed_density_per_m2=3.0, **overrides
    )
    return synth.generate(params)


# --------------------------------------------------------------------------
# The instrument
# --------------------------------------------------------------------------


def test_coverage_weighted_ground_area_agrees_across_gsd():
    """The renderer's ground-unit invariance.

    2.7 mm and 5.5 mm are a factor of two apart. Measured as coverage rather
    than as a binary decision, the vegetated ground area holds to a few percent,
    which is what it means for the renderer to draw ground rather than pixels.
    Anything worse here and no ground-unit threshold downstream could be trusted.
    """
    scene = small_scene()
    fine = soft_green_area_m2(synth.render(scene, 2.7), 2.7)
    coarse = soft_green_area_m2(synth.render(scene, 5.5), 5.5)
    assert fine > 0
    assert abs(coarse - fine) / fine < 0.04


def test_a_hard_threshold_inflates_small_objects_at_coarse_gsd():
    """A measured fact about binarisation, pinned before step 5 is written on top of it.

    A fixed index threshold on a soft edge grows an object by roughly half a
    pixel of rim. For a 12 cm plant that rim is a few percent of its area; for a
    3 cm seedling at 5.5 mm/px, which is five pixels across, it is a fifth.

    So the spec's "mask area agrees within 5 percent across GSD" is reachable
    for crop-sized objects and is not reachable for the seedling this system
    targets, not because the mask is wrong but because a binary mask of a
    five-pixel object is mostly edge. vegetation.py has to either carry
    sub-pixel coverage or accept that the blob area floor is GSD-dependent, and
    that decision should be made deliberately rather than discovered.
    """
    big = synth.generate(
        synth.SceneParams(width_m=3.0, height_m=3.0, seed=5, weed_density_per_m2=0.0)
    )
    small = synth.generate(
        synth.SceneParams(
            width_m=3.0, height_m=3.0, seed=5, skip_rate=1.0, weed_density_per_m2=20.0
        )
    )

    def inflation(scene, measure):
        fine = measure(synth.render(scene, 2.7), 2.7)
        coarse = measure(synth.render(scene, 5.5), 5.5)
        return (coarse - fine) / fine

    big_hard = inflation(big, green_area_m2)
    small_hard = inflation(small, green_area_m2)

    # Coarser sampling inflates, never shrinks: the rim is added, not removed.
    assert big_hard > 0
    assert small_hard > 0
    # And the seedling suffers several times more than the crop plant.
    assert small_hard > 3 * big_hard
    # Coverage-weighted, both are fine, which locates the problem in the
    # threshold rather than in the renderer.
    assert abs(inflation(small, soft_green_area_m2)) < 0.05


def test_render_is_independent_of_block_size():
    """A seam test for the writer.

    Render blocks are an implementation detail and must not be visible in the
    output. A plant whose shadow crosses a block boundary is the case that
    breaks first, which is why the hard scene is the one tested.
    """
    scene = small_scene(shadows=True)
    assert np.array_equal(
        synth.render(scene, 5.5, block_px=1024), synth.render(scene, 5.5, block_px=97)
    )


def test_plant_reach_covers_the_shadow():
    """The bucketing radius is what makes the seam test pass; pin it directly."""
    params = synth.SceneParams(shadows=True, sun_elevation_deg=30.0, crop_height_ratio=1.8)
    reach = synth.plant_reach_m(0.12, params, is_crop=True)
    shadow_length = 0.12 * 1.8 / np.tan(np.radians(30.0))
    assert reach > shadow_length

    no_shadow = synth.plant_reach_m(0.12, synth.SceneParams(shadows=False), is_crop=True)
    assert no_shadow < reach


def test_same_seed_is_the_same_scene():
    a, b = small_scene(), small_scene()
    assert np.array_equal(a.weed_xy_m, b.weed_xy_m)
    assert np.array_equal(a.weed_diameter_m, b.weed_diameter_m)


def test_different_seed_is_a_different_scene():
    a = synth.generate(synth.SceneParams(width_m=3.0, height_m=3.0, seed=1))
    b = synth.generate(synth.SceneParams(width_m=3.0, height_m=3.0, seed=2))
    assert not np.array_equal(a.weed_xy_m, b.weed_xy_m)


def test_soil_noise_is_anchored_to_the_ground_not_the_pixel_grid():
    """The same ground sampled twice, not two unrelated textures.

    Downsample the fine render to the coarse grid and the soil should broadly
    agree. If the noise were seeded per pixel this correlation would vanish and
    render_ladder would be no use as a cross-check on altitude.py.
    """
    scene = synth.generate(
        synth.SceneParams(width_m=3.0, height_m=3.0, seed=5, weed_density_per_m2=0.0, skip_rate=1.0)
    )
    fine = synth.render(scene, 2.75).astype(np.float32)
    coarse = synth.render(scene, 5.5).astype(np.float32)
    h, w = coarse.shape[:2]
    reduced = fine[: h * 2, : w * 2].reshape(h, 2, w, 2, 3).mean(axis=(1, 3))
    correlation = np.corrcoef(reduced[..., 0].ravel(), coarse[..., 0].ravel())[0, 1]
    assert correlation > 0.9


def test_a_subpixel_weed_still_contributes_area():
    """Analytic antialiasing, restated as a claim about a 1.2 cm weed at 11 mm/px.

    Just over one pixel across. A hard-edged renderer would drop it entirely or
    round it up to a whole pixel; neither is the right answer.
    """
    bare = synth.SceneParams(
        width_m=1.0, height_m=1.0, seed=1, skip_rate=1.0, weed_density_per_m2=0.0
    )
    empty = green_area_m2(synth.render(synth.generate(bare), 11.0), 11.0)

    weedy = synth.SceneParams(
        width_m=1.0,
        height_m=1.0,
        seed=1,
        skip_rate=1.0,
        weed_density_per_m2=20.0,
        weed_diameter_m=0.012,
        weed_diameter_cv=0.0,
    )
    seeded = green_area_m2(synth.render(synth.generate(weedy), 11.0), 11.0)
    assert seeded > empty


# --------------------------------------------------------------------------
# The scene
# --------------------------------------------------------------------------


def test_default_weed_size_is_the_flight_spec_target_not_the_public_sets():
    """USU has nothing under 8 cm. Synthetic is where the hard regime exists."""
    assert synth.SceneParams().weed_diameter_m == datasets.TARGET_WEED_DIAMETER_M
    histogram = small_scene().diameter_histogram()
    labels = datasets.diameter_bin_labels()
    assert histogram[labels[datasets.FLIGHT_SPEC_BIN]] > 0
    assert histogram[labels[3]] == 0  # nothing in the 16-32 cm bin USU is full of


def test_weed_size_is_controllable():
    big = small_scene(weed_diameter_m=0.25, weed_diameter_max_m=0.4, weed_diameter_cv=0.1)
    assert np.median(big.weed_diameter_m) > 0.2


def test_offrow_bias_extremes():
    """Bias 1 puts every weed at the inter-row midpoint; bias 0 leaves them uniform."""
    spacing = synth.SceneParams().row_spacing_m
    biased = small_scene(weed_offrow_bias=1.0)
    assert np.allclose(np.abs(biased.weed_distance_to_row_m), spacing / 2.0, atol=1e-6)

    uniform = small_scene(weed_offrow_bias=0.0)
    fractions = np.abs(uniform.weed_distance_to_row_m) / spacing
    assert fractions.min() < 0.1
    assert fractions.max() > 0.4


def test_default_bias_leaves_some_weeds_in_row():
    """In-row weeds are the failure mode a geometric detector has.

    A scene with none cannot produce an in-row false negative, so the default
    must not be so aggressive that it removes the hard case.
    """
    scene = small_scene()
    offrow = scene.offrow_mask
    assert offrow.any()
    assert not offrow.all()


def test_crop_sits_on_the_rows():
    """Ground truth for the row model: crop plants are on centerlines by construction."""
    scene = small_scene(spacing_jitter_frac=0.0)
    distance = synth._signed_distance_to_row(
        scene.crop_xy_m[:, 0], scene.crop_xy_m[:, 1], scene.params, *scene.extent_m
    )
    assert np.abs(distance).max() < 0.02


def test_row_angle_is_honoured():
    scene = small_scene(row_angle_deg=37.0, spacing_jitter_frac=0.0)
    distance = synth._signed_distance_to_row(
        scene.crop_xy_m[:, 0], scene.crop_xy_m[:, 1], scene.params, *scene.extent_m
    )
    assert np.abs(distance).max() < 0.02


def test_skip_rate_removes_plants():
    dense = small_scene(skip_rate=0.0)
    sparse = small_scene(skip_rate=0.5)
    assert len(sparse.crop_xy_m) < 0.7 * len(dense.crop_xy_m)


def test_acres_sets_the_extent():
    scene = synth.generate(synth.SceneParams(acres=2.0))
    assert scene.area_acres == pytest.approx(2.0, rel=1e-6)


# --------------------------------------------------------------------------
# What gets written
# --------------------------------------------------------------------------


def test_truth_geojson_carries_diameter_and_bin(tmp_path):
    """Recall is binned by diameter, so the truth file has to carry it."""
    scene = small_scene()
    path = scene.truth_geojson(tmp_path / "truth.geojson")
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["features"]
    properties = payload["features"][0]["properties"]
    assert properties["diameter_m"] > 0
    assert properties["diameter_bin"] in datasets.diameter_bin_labels()
    assert "distance_to_row_m" in properties
    assert isinstance(properties["offrow"], bool)


def test_crop_geojson_is_written_separately(tmp_path):
    """USU cannot offer labelled crop positions. Synthetic can, so it does."""
    scene = small_scene()
    payload = json.loads(scene.crop_geojson(tmp_path / "crop.geojson").read_text(encoding="utf-8"))
    assert len(payload["features"]) == len(scene.crop_xy_m)


def test_manifest_says_it_is_synthetic(tmp_path):
    """Nothing from this module may be quoted as an accuracy number."""
    manifest = small_scene().manifest()
    assert manifest["synthetic"] is True
    assert "weed_diameter_histogram" in manifest
    assert manifest["params"]["seed"] == 5


def test_worldfile_places_the_raster(tmp_path):
    """The .tfw carries pixel size and the centre of the top-left pixel."""
    scene = small_scene()
    path = tmp_path / "x.tif"
    synth.write_worldfile(scene, 5.5, path)
    lines = path.with_suffix(".tfw").read_text(encoding="utf-8").split("\n")
    assert float(lines[0]) == pytest.approx(0.0055)
    assert float(lines[3]) == pytest.approx(-0.0055)
    assert float(lines[4]) == pytest.approx(scene.origin_xy_m[0] + 0.00275)
    assert path.with_suffix(".prj").exists()


def test_raster_round_trips_through_tifffile(tmp_path):
    """The fallback writer produces a readable raster of the right size."""
    import tifffile

    scene = small_scene()
    path = synth.write_geotiff(scene, 11.0, tmp_path / "x.tif", backend="tifffile")
    assert synth.last_raster_backend() == "tifffile"
    array = tifffile.imread(path)
    expected = synth.render(scene, 11.0)
    assert array.shape == expected.shape
    assert np.array_equal(array, expected)


def test_requesting_rasterio_fails_loudly_when_it_cannot_load():
    """Never a silent substitution: the caller finds out which backend ran."""
    if synth.rasterio_available():
        pytest.skip("rasterio loads here, so there is nothing to refuse")
    with pytest.raises(RuntimeError, match="rasterio cannot load"):
        synth.write_geotiff(small_scene(), 11.0, Path_tmp(), backend="rasterio")


def Path_tmp():
    import tempfile
    from pathlib import Path

    return Path(tempfile.gettempdir()) / "offrow_never_written.tif"
