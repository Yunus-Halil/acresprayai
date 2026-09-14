"""sensor.py against the reference table in the spec.

The table is the check on the arithmetic, so it is transcribed here verbatim
rather than regenerated from the code it is meant to test.
"""

from __future__ import annotations

import math

import pytest

from offrow import sensor

SPEC_SENSOR = sensor.CATALOG["spec-1in-50mp"]

# altitude_m, gsd_mm, swath_m, flights_vs_120m, px_across_a_3cm_weed
SPEC_TABLE = [
    (10.0, 1.8, 15.0, 144.0, 16),
    (20.0, 3.7, 30.0, 36.0, 8),
    (30.0, 5.5, 45.0, 16.0, 5),
    (60.0, 11.0, 90.0, 4.0, 3),
    (120.0, 22.0, 180.0, 1.0, 1),
]


def test_pixel_pitch_matches_spec():
    assert SPEC_SENSOR.pixel_pitch_um == pytest.approx(1.61, abs=0.005)


@pytest.mark.parametrize(("alt", "gsd", "swath", "flights", "px"), SPEC_TABLE)
def test_reference_table(alt, gsd, swath, flights, px):
    plan = sensor.flight_plan(SPEC_SENSOR, alt, target_object_mm=30.0)
    assert plan.gsd_mm == pytest.approx(gsd, abs=0.05)
    assert plan.swath_m == pytest.approx(swath, abs=0.5)
    assert plan.relative_flight_count == pytest.approx(flights, rel=1e-9)
    assert round(plan.target_object_px) == px


def test_gsd_is_linear_in_altitude():
    a = sensor.gsd_mm(SPEC_SENSOR, 20.0)
    b = sensor.gsd_mm(SPEC_SENSOR, 40.0)
    assert b == pytest.approx(2 * a)


def test_altitude_for_gsd_round_trips():
    for altitude in (10.0, 37.5, 120.0):
        gsd = sensor.gsd_mm(SPEC_SENSOR, altitude)
        assert sensor.altitude_for_gsd_m(SPEC_SENSOR, gsd) == pytest.approx(altitude)


def test_acres_per_hour_scales_inversely_with_flight_count():
    ref = 200.0
    at_30 = sensor.acres_per_hour(30.0, 120.0, ref)
    assert at_30 == pytest.approx(ref / 16.0)


@pytest.mark.parametrize("key", list(sensor.CATALOG))
def test_catalog_entries_are_marked_unverified(key):
    """No airframe is committed to, so every catalog entry says where it came from."""
    assert sensor.CATALOG[key].note


def test_detection_floors():
    """The 20 to 40 m band is the plausible target; check the floors agree."""
    at_30 = sensor.flight_plan(SPEC_SENSOR, 30.0, target_object_mm=30.0)
    at_120 = sensor.flight_plan(SPEC_SENSOR, 120.0, target_object_mm=30.0)
    assert at_30.detectable
    assert not at_30.shape_resolvable
    assert not at_120.detectable


@pytest.mark.parametrize(
    ("width", "px", "focal"),
    [(0.0, 8192, 8.8), (13.2, 0, 8.8), (13.2, 8192, 0.0), (-13.2, 8192, 8.8)],
)
def test_sensor_rejects_impossible_geometry(width, px, focal):
    with pytest.raises(ValueError):
        sensor.Sensor(name="bad", sensor_width_mm=width, pixels_across=px, focal_length_mm=focal)


def test_altitude_must_be_positive():
    with pytest.raises(ValueError):
        sensor.gsd_mm(SPEC_SENSOR, 0.0)


def test_format_table_has_a_row_per_altitude():
    plans = sensor.altitude_ladder(SPEC_SENSOR, [10, 30, 120])
    lines = sensor.format_table(plans).splitlines()
    assert len(lines) == 5  # header, rule, three rows
    assert "Flights vs 120 m" in lines[0]


def test_wider_sensor_at_same_pixel_count_trades_resolution_for_swath():
    narrow = sensor.Sensor("n", 13.2, 6000, 8.8)
    wide = sensor.Sensor("w", 26.4, 6000, 8.8)
    assert sensor.ground_swath_m(wide, 30.0) == pytest.approx(
        2 * sensor.ground_swath_m(narrow, 30.0)
    )
    assert sensor.gsd_mm(wide, 30.0) == pytest.approx(2 * sensor.gsd_mm(narrow, 30.0))


def test_field_of_view_ratio_is_dimensionless_and_finite():
    assert math.isfinite(SPEC_SENSOR.field_of_view_ratio)
    assert SPEC_SENSOR.field_of_view_ratio == pytest.approx(1.5)
