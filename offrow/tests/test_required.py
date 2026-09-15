"""The spec's list of tests that must exist and keep passing.

Outstanding ones are skips, so the list is executable and visible in the
runner's summary rather than living only in a document. Each names the step that
makes it real. A skip still skipped after its step has shipped is a missing
test, and ``pytest -ra`` will keep saying so.

Ones that have landed are listed in :data:`LANDED` with the test that covers
them, and :func:`test_landed_requirements_still_exist` fails if one is deleted
or renamed. A checklist that only tracks what is missing stops being a checklist
the moment something is quietly removed.
"""

from __future__ import annotations

import importlib

import pytest

#: Requirement -> the test that now covers it.
LANDED = {
    "windowed run matches single-window run, including seam blobs": (
        "tests.test_io",
        "test_windowed_run_matches_single_window_run_including_seam_blobs",
    ),
    "crop-sized mask area agrees within 5 percent across GSD": (
        "tests.test_vegetation",
        "test_crop_sized_mask_area_agrees_within_five_percent_across_gsd",
    ),
    "seedling mask area bias across GSD is pinned, not targeted": (
        "tests.test_vegetation",
        "test_seedling_mask_area_bias_across_gsd_is_measured_not_targeted",
    ),
    "row angle within 1 degree and pitch within 3 percent, swept": (
        "tests.test_rows",
        "test_row_angle_is_recovered_within_one_degree",
    ),
    "row pitch within 3 percent, swept across pitches": (
        "tests.test_rows",
        "test_row_pitch_is_recovered_within_three_percent",
    ),
    "row fit survives 20 percent skips and a weed population": (
        "tests.test_rows",
        "test_the_fit_survives_the_known_false_positive_sources",
    ),
    "the fitted grid lands on known crop positions": (
        "tests.test_rows",
        "test_fitted_rows_land_on_the_known_crop_positions",
    ),
}


@pytest.mark.parametrize("requirement", sorted(LANDED))
def test_landed_requirements_still_exist(requirement):
    """Each satisfied requirement still has a test behind it."""
    module_name, test_name = LANDED[requirement]
    module = importlib.import_module(module_name)
    assert hasattr(module, test_name), f"{requirement}: {module_name}.{test_name} is gone"


@pytest.mark.skip(reason="step 7: candidates.py")
def test_headland_exclusion_drops_inside_and_keeps_just_outside():
    """Boundary buffer arithmetic, at the buffer edge where it can be off by one."""


@pytest.mark.skip(reason="step 7: end to end")
def test_end_to_end_recall_floor_at_5_5mm_with_shadows():
    """Synthetic field, shadows on, recall above an agreed floor at a fixed FP budget."""
