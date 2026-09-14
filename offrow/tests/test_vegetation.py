"""vegetation.py: chromaticity as shadow handling, and what a mask's area means.

The two claims worth testing here are that normalising by intensity is what
makes shade survivable, and that a binary mask's ground area is only
GSD-invariant for objects comfortably larger than a pixel. The second replaces
the spec's original single requirement, which was unreachable for a seedling.
"""

from __future__ import annotations

import numpy as np
import pytest

from offrow import synth
from offrow import vegetation as veg

GSD_M = 0.0055

SOIL = np.array([150, 118, 90], dtype=np.uint8)
LEAF = np.array([70, 150, 60], dtype=np.uint8)


def patch(colour, shape=(64, 64)):
    return np.broadcast_to(np.asarray(colour, dtype=np.uint8), (*shape, 3)).copy()


def scene(**overrides):
    params = synth.SceneParams(width_m=3.0, height_m=3.0, seed=5, **overrides)
    return synth.generate(params)


# --------------------------------------------------------------------------
# Chromaticity is the shadow handling
# --------------------------------------------------------------------------


def test_chromaticity_sums_to_one():
    chroma = veg.chromaticity(patch(SOIL))
    assert chroma.sum(axis=2) == pytest.approx(1.0)


def test_black_pixels_are_zero_not_nan():
    """Deep shade divides by zero. NaN would poison every index downstream."""
    chroma = veg.chromaticity(patch((0, 0, 0)))
    assert np.isfinite(chroma).all()
    assert chroma.sum() == 0.0


def test_a_shaded_leaf_and_a_sunlit_leaf_land_in_the_same_place():
    """The whole reason chromaticity comes first.

    Shade is close to a multiplicative attenuation, which division by the
    channel sum removes entirely. In raw RGB these two differ by 60 percent.
    """
    sunlit = patch(LEAF)
    shaded = patch((LEAF * 0.4).astype(np.uint8))

    assert abs(int(sunlit[0, 0, 1]) - int(shaded[0, 0, 1])) > 50
    sunlit_index = veg.combined_index(sunlit).mean()
    shaded_index = veg.combined_index(shaded).mean()
    assert abs(sunlit_index - shaded_index) < 0.05


def test_shaded_leaf_still_separates_from_sunlit_soil():
    """The case an intensity threshold gets wrong: dark leaf, bright dirt."""
    shaded_leaf = veg.combined_index(patch((LEAF * 0.4).astype(np.uint8))).mean()
    sunlit_soil = veg.combined_index(patch(SOIL)).mean()
    assert shaded_leaf > sunlit_soil


def test_exg_is_positive_on_green_and_negative_on_soil():
    assert veg.exg(veg.chromaticity(patch(LEAF))).mean() > 0
    assert veg.exg(veg.chromaticity(patch(SOIL))).mean() < 0


def test_cive_keeps_the_published_constant_and_the_signal_drops_it():
    """The constant is kept where it aids comparison and dropped where it misleads."""
    chroma = veg.chromaticity(patch(LEAF))
    assert veg.cive(chroma).mean() > 18.0
    assert abs(veg.cive_signal(chroma).mean()) < 1.0


def test_cive_signal_points_the_same_way_as_exg():
    """Negated on purpose, so a weighted sum adds rather than cancels."""
    leaf = veg.chromaticity(patch(LEAF))
    soil = veg.chromaticity(patch(SOIL))
    assert veg.cive_signal(leaf).mean() > veg.cive_signal(soil).mean()
    assert veg.exg(leaf).mean() > veg.exg(soil).mean()


def test_raw_rgb_is_never_the_input_to_a_threshold():
    """A guard on the module, not on a value: chromaticity has to come first."""
    import inspect

    source = inspect.getsource(veg.combined_index)
    assert "chromaticity(" in source


# --------------------------------------------------------------------------
# Thresholding
# --------------------------------------------------------------------------


def test_otsu_splits_a_two_mode_window():
    index = np.concatenate([np.full(500, -0.2), np.full(500, 0.6)])
    threshold, fallback = veg.otsu_threshold(index)
    assert -0.2 < threshold < 0.6
    assert not fallback


def test_a_window_of_bare_soil_falls_back():
    """Otsu always returns a split. A window of one mode has nothing to split.

    Using its threshold would paint half the soil green, which is exactly the
    failure the fallback exists to prevent.
    """
    params = veg.VegetationParams(global_threshold=0.3)
    index = np.random.default_rng(0).normal(-0.2, 0.01, 4000)
    threshold, fallback = veg.otsu_threshold(index, params)
    assert fallback
    assert threshold == 0.3


def test_fallback_is_not_used_when_no_global_threshold_is_known():
    """Without a global estimate there is nothing better to fall back to."""
    index = np.random.default_rng(0).normal(-0.2, 0.01, 4000)
    _threshold, fallback = veg.otsu_threshold(index, veg.VegetationParams())
    assert not fallback


def test_global_threshold_from_windows_matches_a_single_pass():
    """The two-pass fallback must not need the whole raster in memory at once."""
    image = synth.render(scene(weed_density_per_m2=2.0), 5.5)
    windows = [image[i : i + 128] for i in range(0, image.shape[0], 128)]
    pooled = veg.global_threshold_from_windows(windows)
    single = veg.threshold_from_histogram(veg.accumulate_histogram(veg.combined_index(image)))
    assert pooled == pytest.approx(single, abs=1e-6)


def test_accumulate_histogram_is_additive():
    a = np.array([[[10, 20, 30]]], dtype=np.uint8)
    first = veg.accumulate_histogram(veg.combined_index(a))
    twice = veg.accumulate_histogram(veg.combined_index(a), first)
    assert twice.sum() == 2 * first.sum()


# --------------------------------------------------------------------------
# Ground units
# --------------------------------------------------------------------------


def test_kernels_are_ground_units_so_pixel_radius_tracks_gsd():
    """A 3 mm opening is 3 mm of ground at every resolution, or it is nothing."""
    image = synth.render(scene(), 2.75)
    fine = veg.mask_window(image, 0.00275)
    coarse = veg.mask_window(synth.render(scene(), 11.0), 0.011)
    assert fine.open_radius_px > coarse.open_radius_px


def test_a_subpixel_kernel_is_reported_rather_than_silently_skipped():
    """A 3 mm opening at 11 mm/px is not a small kernel, it is no kernel."""
    params = veg.VegetationParams(open_radius_mm=3.0, close_radius_mm=3.0)
    result = veg.mask_window(synth.render(scene(), 11.0), 0.011, params)
    assert result.open_radius_px == 0
    assert result.morphology_was_subpixel


def test_crop_sized_mask_area_agrees_within_five_percent_across_gsd():
    """The spec's requirement, restricted to the objects it holds for.

    A 12 cm plant at 2.7 and 5.5 mm/px is 44 and 22 pixels across. Its half-pixel
    threshold rim is a small fraction of its area, so the binary mask's ground
    area is stable.
    """
    crop_only = scene(weed_density_per_m2=0.0)
    fine = veg.mask_window(synth.render(crop_only, 2.75), 0.00275).area_m2
    coarse = veg.mask_window(synth.render(crop_only, 5.5), 0.0055).area_m2
    assert abs(coarse - fine) / fine < 0.05


def test_seedling_mask_area_bias_across_gsd_is_measured_not_targeted():
    """The replacement for the half of the spec that was unreachable.

    Measured across 2.75 to 5.5 mm/px on 3 cm weeds, which go from 11 pixels
    across to 5.5. The binary mask's ground area rises by roughly 18 percent
    while a 12 cm crop plant moves about 1 percent. That is the half-pixel rim a
    hard threshold adds, which is a fifth of a five-pixel object and a rounding
    error on a twenty-two-pixel one.

    The numbers here are recorded, not aimed at. Do not tune a threshold, a
    percentile or a kernel to move them; if they move, something changed and the
    change needs explaining.
    """
    weeds_only = scene(skip_rate=1.0, weed_density_per_m2=20.0)
    crop_only = scene(weed_density_per_m2=0.0)

    def bias(scene_, measure):
        fine = measure(veg.mask_window(synth.render(scene_, 2.75), 0.00275))
        coarse = measure(veg.mask_window(synth.render(scene_, 5.5), 0.0055))
        return (coarse - fine) / fine

    hard = bias(weeds_only, lambda r: r.area_m2)
    crop_hard = bias(crop_only, lambda r: r.area_m2)
    soft = bias(weeds_only, lambda r: r.coverage_area_m2)

    assert hard > 0, "coarser sampling adds rim, it never removes it"
    assert 0.10 < hard < 0.30, f"seedling area bias moved: {hard:.3f}"
    assert abs(crop_hard) < 0.05, f"crop-sized area bias moved: {crop_hard:.3f}"
    assert hard > 5 * abs(crop_hard), "a seedling is mostly edge; a crop plant is not"

    # Sub-pixel coverage is the better measure and is not a cure. Its endpoints
    # come from percentiles of the window, and at 5.5 mm/px a 3 cm weed has few
    # fully-vegetated pixels to set the plant end from, so it still drifts. It
    # drifts less, which is the claim worth making.
    assert abs(soft) < abs(hard)


def test_a_ground_unit_kernel_is_never_larger_than_requested():
    """Rounding a sub-pixel kernel up doubles a ground-unit threshold.

    A 3 mm radius is 1.09 px at 2.75 mm/px and 0.55 px at 5.5 mm. Rounding both
    to 1 px would apply 2.75 mm of ground at one resolution and 5.5 mm at the
    other, and at 11 mm/px it would round back to 0. That is a ground-unit
    threshold that grows when you fly higher and then vanishes, which is exactly
    the kind of silent GSD dependence a recall-versus-GSD curve cannot survive.

    Flooring bounds it: the kernel applied is never larger in ground units than
    the one asked for. It is not, and cannot be, constant. ``floor(3.0/1.7)`` and
    ``floor(3.0/2.75)`` are both one pixel, which is 1.7 mm of ground at one
    resolution and 2.75 mm at the other, and no choice of rounding fixes that
    while structuring elements are whole pixels.

    The conclusion for step 7: morphology is not the ground-unit-correct way to
    remove speckle, because it quantises. The blob area floor is, because a count
    of pixels times a pixel area is continuous in GSD. Leave the opening small
    and let ``blobs.py`` do the despeckling.
    """
    params = veg.VegetationParams(open_radius_mm=3.0, close_radius_mm=5.0)
    effective = []
    for gsd_mm in (1.7, 2.75, 5.5, 11.0):
        result = veg.mask_window(synth.render(scene(), gsd_mm), gsd_mm / 1000.0, params)
        assert result.effective_open_radius_mm <= params.open_radius_mm + 1e-9
        assert result.effective_close_radius_mm <= params.close_radius_mm + 1e-9
        effective.append(result.effective_open_radius_mm)

    # Quantised, so it is reported rather than assumed. A caller comparing masks
    # across a GSD ladder needs to know the kernel was not the same at each rung.
    assert effective != [params.open_radius_mm] * len(effective)
    assert max(effective) <= params.open_radius_mm


def test_coverage_area_is_bounded_by_the_window():
    result = veg.mask_window(synth.render(scene(), 5.5), 0.0055)
    assert 0 < result.coverage_area_m2 < 9.1  # a 3 x 3 m scene


def test_mask_area_counts_pixels_in_ground_units():
    mask = np.zeros((10, 10), dtype=bool)
    mask[:2, :5] = True
    assert veg.mask_area_m2(mask, 0.01) == pytest.approx(10 * 0.0001)


# --------------------------------------------------------------------------
# Masking a real scene
# --------------------------------------------------------------------------


def test_mask_finds_the_crop_rows():
    """Sanity: a scene of corn rows masks to a plausible fraction of green."""
    result = veg.mask_window(synth.render(scene(weed_density_per_m2=1.0), 5.5), 0.0055)
    assert 0.02 < result.mask.mean() < 0.35
    assert not result.used_fallback


def test_shadows_do_not_become_vegetation():
    """The end-to-end version of the chromaticity claim.

    Turning shadows on adds a lot of dark pixels and must not add much green.
    """
    lit = veg.mask_window(synth.render(scene(weed_density_per_m2=1.0), 5.5), 0.0055)
    shady = veg.mask_window(synth.render(scene(weed_density_per_m2=1.0, shadows=True), 5.5), 0.0055)
    assert shady.mask.sum() < 1.5 * lit.mask.sum()


def test_valid_mask_keeps_outside_pixels_out_of_the_statistics():
    """Ground outside the field must not drag the threshold around."""
    image = synth.render(scene(weed_density_per_m2=1.0), 5.5)
    valid = np.zeros(image.shape[:2], dtype=bool)
    valid[:, : image.shape[1] // 2] = True
    result = veg.mask_window(image, 0.0055, valid=valid)
    assert not result.mask[:, image.shape[1] // 2 :].any()
    assert result.coverage[:, image.shape[1] // 2 :].sum() == 0


def test_gsd_must_be_positive():
    with pytest.raises(ValueError):
        veg.mask_window(patch(LEAF), 0.0)


def test_chromaticity_rejects_a_non_image():
    with pytest.raises(ValueError):
        veg.chromaticity(np.zeros((10, 10)))
