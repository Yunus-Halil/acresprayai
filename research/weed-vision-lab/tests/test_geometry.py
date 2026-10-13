import math

import numpy as np
import pytest

from weedlab.phenobench.geometry import measure_mask


def test_single_pixel():
    m = np.zeros((8, 8), bool)
    m[3, 4] = True
    g = measure_mask(m)
    assert g.area_px == 1 and g.max_span_px == 0 and g.centroid == (4.0, 3.0)
    assert g.n_components == 1 and g.hull_area_px is None


def test_horizontal_line_of_five():
    m = np.zeros((8, 8), bool)
    m[2, 1:6] = True
    g = measure_mask(m)
    assert g.max_span_px == 4.0  # between pixel centres
    assert g.perpendicular_span_px == 0.0
    assert g.obb_length_px == 4.0 and g.obb_width_px == 0.0
    assert g.obb_angle_deg == 0.0


def test_axis_aligned_rectangle():
    m = np.zeros((20, 30), bool)
    m[5:10, 3:13] = True  # 5 rows x 10 cols
    g = measure_mask(m)
    assert g.area_px == 50
    assert g.max_span_px == pytest.approx(math.hypot(9, 4))
    assert g.obb_length_px == pytest.approx(9.0) and g.obb_width_px == pytest.approx(4.0)
    assert g.obb_angle_deg in (pytest.approx(0.0), pytest.approx(180.0))
    assert g.hull_area_px == pytest.approx(36.0)  # (9 x 4) hull of centres
    assert g.solidity == 1.0  # capped: 50 / 36 > 1
    assert g.equivalent_diameter_px == pytest.approx(2 * math.sqrt(50 / math.pi))


def test_diagonal_bar_has_rotated_box():
    m = np.zeros((40, 40), bool)
    for t in range(20):
        m[10 + t, 10 + t] = True
        m[11 + t, 10 + t] = True
    g = measure_mask(m)
    assert 40 < g.obb_angle_deg < 50
    assert g.obb_length_px > 5 * g.obb_width_px


def test_two_components_and_solidity():
    m = np.zeros((30, 30), bool)
    m[2:8, 2:8] = True
    m[20:26, 20:26] = True
    g = measure_mask(m)
    assert g.n_components == 2 and g.largest_component_px == 36
    assert g.solidity is not None and g.solidity < 0.4


def test_empty_mask_raises():
    with pytest.raises(ValueError):
        measure_mask(np.zeros((4, 4), bool))


def test_record_is_flat():
    m = np.zeros((8, 8), bool)
    m[1:4, 1:4] = True
    r = measure_mask(m).to_record()
    assert "centroid_x" in r and "span_x0" in r and "bbox_x1" in r
    assert all(not isinstance(v, (tuple, list, dict)) for v in r.values())
