"""sensor.py against the reference table in the spec, and against the cost model.

The resolution columns are transcribed from the spec verbatim rather than
regenerated from the code they are meant to check. The flight-count column is
not: the spec quoted a quadratic-everywhere model, which is the pessimistic
limit. The piecewise model replaces it and only agrees below the crossover.
"""

from __future__ import annotations

import math

import pytest

from offrow import sensor

SPEC_SENSOR = sensor.CATALOG["spec-1in-50mp"]

#: The profile the crossover was agreed against.
REVIEW_PROFILE = sensor.MissionProfile(cruise_speed_ms=15.0, frame_interval_s=1.0, frontlap=0.75)

# altitude_m, gsd_mm, swath_m, px_across_a_3cm_weed. Resolution only: geometry.
SPEC_TABLE = [
    (10.0, 1.8, 15.0, 16),
    (20.0, 3.7, 30.0, 8),
    (30.0, 5.5, 45.0, 5),
    (60.0, 11.0, 90.0, 3),
    (120.0, 22.0, 180.0, 1),
]

# altitude_m, flights_vs_120m, limiter, under the review profile.
COST_TABLE = [
    (10.0, 64.0, "frame"),
    (20.0, 16.0, "frame"),
    (30.0, 7.111111, "frame"),
    (40.0, 4.0, "frame"),
    (60.0, 2.0, "cruise"),
    (120.0, 1.0, "cruise"),
]


def test_pixel_pitch_matches_spec():
    assert SPEC_SENSOR.pixel_pitch_um == pytest.approx(1.61, abs=0.005)


def test_spec_sensor_is_four_three_with_square_pixels():
    """8192 px across at 50 MP is 8192x6144, so the along-track edge is 9.9 mm.

    The along-track edge is what sets the crossover altitude, so getting the
    aspect wrong moves the headline number by 12 percent.
    """
    assert SPEC_SENSOR.rows == 6144
    assert SPEC_SENSOR.height_mm == pytest.approx(9.9)
    pitch_down = SPEC_SENSOR.height_mm * 1000.0 / SPEC_SENSOR.rows
    assert pitch_down == pytest.approx(SPEC_SENSOR.pixel_pitch_um, abs=0.005)


@pytest.mark.parametrize(("alt", "gsd", "swath", "px"), SPEC_TABLE)
def test_reference_resolution_table(alt, gsd, swath, px):
    plan = sensor.flight_plan(SPEC_SENSOR, alt, profile=REVIEW_PROFILE, target_object_mm=30.0)
    assert plan.gsd_mm == pytest.approx(gsd, abs=0.05)
    assert plan.swath_m == pytest.approx(swath, abs=0.5)
    assert round(plan.target_object_px) == px


@pytest.mark.parametrize(("alt", "flights", "limiter"), COST_TABLE)
def test_piecewise_cost_table(alt, flights, limiter):
    plan = sensor.flight_plan(SPEC_SENSOR, alt, profile=REVIEW_PROFILE)
    assert plan.relative_flight_count == pytest.approx(flights, rel=1e-5)
    assert plan.speed_limiter == limiter


def test_crossover_altitude():
    """15 m/s, 1 s, 75 percent frontlap, 9.9 mm along-track edge."""
    assert sensor.crossover_altitude_m(SPEC_SENSOR, REVIEW_PROFILE) == pytest.approx(
        53.33, abs=0.01
    )


def test_crossover_separates_linear_from_quadratic_scaling():
    """Above it, halving altitude doubles the cost. Below it, it quadruples it."""
    crossover = sensor.crossover_altitude_m(SPEC_SENSOR, REVIEW_PROFILE)
    high, low = 4 * crossover, crossover / 4

    above = sensor.relative_flight_count(SPEC_SENSOR, high / 2, high, REVIEW_PROFILE)
    below = sensor.relative_flight_count(SPEC_SENSOR, low / 2, low, REVIEW_PROFILE)
    assert above == pytest.approx(2.0)
    assert below == pytest.approx(4.0)


def test_crossover_moves_with_the_camera_not_the_altitude():
    """A faster camera lowers the crossover; a faster aircraft raises it."""
    base = sensor.crossover_altitude_m(SPEC_SENSOR, REVIEW_PROFILE)
    faster_camera = sensor.MissionProfile(cruise_speed_ms=15.0, frame_interval_s=0.5, frontlap=0.75)
    faster_aircraft = sensor.MissionProfile(
        cruise_speed_ms=30.0, frame_interval_s=1.0, frontlap=0.75
    )
    assert sensor.crossover_altitude_m(SPEC_SENSOR, faster_camera) == pytest.approx(base / 2)
    assert sensor.crossover_altitude_m(SPEC_SENSOR, faster_aircraft) == pytest.approx(base * 2)


def test_more_frontlap_raises_the_crossover():
    """Overlap is bought with speed, so demanding more of it costs altitude headroom."""
    less = sensor.MissionProfile(frontlap=0.60)
    more = sensor.MissionProfile(frontlap=0.85)
    assert sensor.crossover_altitude_m(SPEC_SENSOR, more) > sensor.crossover_altitude_m(
        SPEC_SENSOR, less
    )


def test_flight_ratio_ignores_sidelap_and_duty_cycle():
    """Both are constant factors, so they cancel. Only the absolute numbers move."""
    a = sensor.MissionProfile(sidelap=0.65, duty_cycle=0.55)
    b = sensor.MissionProfile(sidelap=0.80, duty_cycle=0.30)
    assert sensor.relative_flight_count(SPEC_SENSOR, 30.0, 120.0, a) == pytest.approx(
        sensor.relative_flight_count(SPEC_SENSOR, 30.0, 120.0, b)
    )
    assert sensor.effective_acres_per_hour(SPEC_SENSOR, 30.0, a) != pytest.approx(
        sensor.effective_acres_per_hour(SPEC_SENSOR, 30.0, b)
    )


def test_effective_is_duty_cycle_times_theoretical():
    profile = sensor.MissionProfile(duty_cycle=0.4)
    theo = sensor.theoretical_acres_per_hour(SPEC_SENSOR, 30.0, profile)
    assert sensor.effective_acres_per_hour(SPEC_SENSOR, 30.0, profile) == pytest.approx(0.4 * theo)


def test_piecewise_is_never_worse_than_the_quadratic_estimate():
    """The old model was the pessimistic limit, so the new one must not exceed it."""
    for alt in (5.0, 10.0, 30.0, 60.0, 119.0):
        quadratic = (120.0 / alt) ** 2
        assert (
            sensor.relative_flight_count(SPEC_SENSOR, alt, 120.0, REVIEW_PROFILE)
            <= quadratic + 1e-9
        )


def test_gsd_is_linear_in_altitude():
    a = sensor.gsd_mm(SPEC_SENSOR, 20.0)
    b = sensor.gsd_mm(SPEC_SENSOR, 40.0)
    assert b == pytest.approx(2 * a)


def test_altitude_for_gsd_round_trips():
    for altitude in (10.0, 37.5, 120.0):
        gsd = sensor.gsd_mm(SPEC_SENSOR, altitude)
        assert sensor.altitude_for_gsd_m(SPEC_SENSOR, gsd) == pytest.approx(altitude)


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


@pytest.mark.parametrize(
    "kwargs",
    [
        {"cruise_speed_ms": 0.0},
        {"frame_interval_s": 0.0},
        {"frontlap": 1.0},
        {"sidelap": -0.1},
        {"duty_cycle": 0.0},
        {"duty_cycle": 1.5},
    ],
)
def test_profile_rejects_impossible_missions(kwargs):
    with pytest.raises(ValueError):
        sensor.MissionProfile(**kwargs)


def test_altitude_must_be_positive():
    with pytest.raises(ValueError):
        sensor.gsd_mm(SPEC_SENSOR, 0.0)


def test_default_aspect_is_used_when_height_is_not_given():
    guessed = sensor.Sensor("g", 13.2, 8192, 8.8)
    assert guessed.height_mm == pytest.approx(9.9)
    assert guessed.rows == 6144


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
