"""The spec's list of tests that must exist and keep passing.

They are here as skips so the list is executable and visible in the runner's
summary rather than living only in a document. Each one names the step that
makes it real. A skip that is still skipped after its step has shipped is a
missing test, and `pytest -ra` will keep saying so.
"""

from __future__ import annotations

import pytest


@pytest.mark.skip(reason="step 6: rows.py")
def test_row_angle_within_one_degree_and_pitch_within_three_percent():
    """Swept across angles 0 to 175 and several pitches, on synthetic fields."""


@pytest.mark.skip(reason="step 6: rows.py")
def test_row_angle_survives_twenty_percent_skips_and_ten_percent_weeds():
    """The planter leaves gaps and the field has weeds. The angle must not care."""


@pytest.mark.skip(reason="step 5: io.py")
def test_windowed_run_matches_single_window_run_including_seam_blobs():
    """Blobs placed deliberately across the seam. The likeliest silent wrong answer."""


@pytest.mark.skip(reason="step 5: vegetation.py")
def test_mask_area_agrees_within_five_percent_across_gsd():
    """Same synthetic scene at 2.7 mm and 5.5 mm. Proves ground-unit thresholds work."""


@pytest.mark.skip(reason="step 4: altitude.py")
def test_degraded_scene_matches_natively_rendered_scene():
    """1.7 mm degraded to 5.5 mm against 5.5 mm rendered natively.

    If these diverge badly the degradation model is wrong, and every altitude
    number downstream of it is wrong too.
    """


@pytest.mark.skip(reason="step 7: candidates.py")
def test_headland_exclusion_drops_inside_and_keeps_just_outside():
    """Boundary buffer arithmetic, at the buffer edge where it can be off by one."""


@pytest.mark.skip(reason="step 7: end to end")
def test_end_to_end_recall_floor_at_5_5mm_with_shadows():
    """Synthetic field, shadows on, recall above an agreed floor at a fixed FP budget."""
