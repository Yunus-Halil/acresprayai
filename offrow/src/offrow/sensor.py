"""Camera geometry and the operational cost of flying lower.

Pure arithmetic. Nothing here touches imagery, and nothing here assumes a
particular airframe: a :class:`Sensor` is a handful of numbers the caller
supplies. :data:`CATALOG` holds candidate airframes as data, not as a default.

The resolution relationships are the thin-lens pinhole ones::

    swath_m = (sensor_width_mm / focal_length_mm) * altitude_m
    gsd     = swath_m / pixels_across

The cost relationship is piecewise, and that is the point of this module. Area
rate is effective swath times ground speed, and ground speed is the smaller of
what the aircraft can cruise at and what the camera can keep up with::

    frame_limited_speed = along_track_footprint * (1 - frontlap) / frame_interval

High up, the footprint is large and the aircraft is cruise-limited, so area rate
scales linearly with altitude. Low down, the footprint shrinks faster than the
camera can shoot, the frame interval binds, and the scaling turns quadratic. The
altitude where the two meet is :func:`crossover_altitude_m`, and it is the
headline number: it is where the cost of flying lower stops being proportionate.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

SQUARE_METRES_PER_ACRE = 4046.8564224

#: Altitude the relative-cost columns are quoted against. 120 m is the ceiling a
#: normal mapping mission is flown at, so it is the "free" baseline an operator
#: compares against when asked to fly lower.
DEFAULT_REFERENCE_ALTITUDE_M = 120.0

#: Frame aspect ratio assumed when a sensor's along-track dimension is not given.
#: 4:3 is the common mapping-camera frame. Give the height explicitly whenever it
#: is known: the along-track edge sets the crossover altitude, and guessing it
#: wrong moves the headline number.
DEFAULT_FRAME_ASPECT = 3.0 / 4.0

#: Roughly the smallest linear extent, in pixels, at which a blob is detectable
#: at all, and roughly where leaf shape becomes usable. Both are rules of thumb.
DETECTION_FLOOR_PX = 4.0
SHAPE_FLOOR_PX = 15.0


@dataclass(frozen=True)
class Sensor:
    """A camera, as the numbers that determine ground sampling and coverage.

    Args:
        name: Human label, used only in reports.
        sensor_width_mm: Active sensor width. Flown across-track.
        pixels_across: Pixel count along that width.
        focal_length_mm: True focal length, not 35 mm equivalent.
        sensor_height_mm: Active sensor height, flown along-track. Defaults to
            :data:`DEFAULT_FRAME_ASPECT` of the width.
        pixels_down: Pixel count along the height. Defaults to the same aspect.
        note: Provenance of these numbers. Anything from :data:`CATALOG` carries
            a warning here, because none of it has been verified against a
            physical body.
    """

    name: str
    sensor_width_mm: float
    pixels_across: int
    focal_length_mm: float
    sensor_height_mm: float | None = None
    pixels_down: int | None = None
    note: str = ""

    def __post_init__(self) -> None:
        if self.sensor_width_mm <= 0:
            raise ValueError("sensor_width_mm must be positive")
        if self.pixels_across <= 0:
            raise ValueError("pixels_across must be positive")
        if self.focal_length_mm <= 0:
            raise ValueError("focal_length_mm must be positive")
        if self.sensor_height_mm is not None and self.sensor_height_mm <= 0:
            raise ValueError("sensor_height_mm must be positive")
        if self.pixels_down is not None and self.pixels_down <= 0:
            raise ValueError("pixels_down must be positive")

    @property
    def height_mm(self) -> float:
        """Along-track sensor dimension, assumed from the aspect if not given."""
        if self.sensor_height_mm is not None:
            return self.sensor_height_mm
        return self.sensor_width_mm * DEFAULT_FRAME_ASPECT

    @property
    def rows(self) -> int:
        """Along-track pixel count, assumed from the aspect if not given."""
        if self.pixels_down is not None:
            return self.pixels_down
        return int(round(self.pixels_across * DEFAULT_FRAME_ASPECT))

    @property
    def pixel_pitch_um(self) -> float:
        """Physical size of one pixel, in micrometres."""
        return self.sensor_width_mm * 1000.0 / self.pixels_across

    @property
    def field_of_view_ratio(self) -> float:
        """Across-track ground swath per metre of altitude. Dimensionless."""
        return self.sensor_width_mm / self.focal_length_mm

    @property
    def along_track_ratio(self) -> float:
        """Along-track ground footprint per metre of altitude. Dimensionless.

        The one that sets the crossover altitude, because forward overlap is
        what the frame interval has to keep up with.
        """
        return self.height_mm / self.focal_length_mm


@dataclass(frozen=True)
class MissionProfile:
    """How the aircraft is flown. Every number here is an assumption, not geometry.

    Args:
        cruise_speed_ms: Ground speed the aircraft holds on a survey line.
        frame_interval_s: Shortest interval between captures. The camera's limit,
            including any write or autofocus cost, not the shutter speed.
        frontlap: Along-track overlap fraction required by the photogrammetry.
        sidelap: Across-track overlap fraction. Cancels out of any ratio between
            two altitudes, and only affects absolute coverage.
        duty_cycle: Fraction of wall-clock spent on survey lines, after turns,
            transit to and from the field, and battery swaps. The difference
            between theoretical and effective coverage.
    """

    cruise_speed_ms: float = 15.0
    frame_interval_s: float = 1.0
    frontlap: float = 0.75
    sidelap: float = 0.65
    duty_cycle: float = 0.55

    def __post_init__(self) -> None:
        if self.cruise_speed_ms <= 0:
            raise ValueError("cruise_speed_ms must be positive")
        if self.frame_interval_s <= 0:
            raise ValueError("frame_interval_s must be positive")
        if not 0.0 <= self.frontlap < 1.0:
            raise ValueError("frontlap must be in [0, 1)")
        if not 0.0 <= self.sidelap < 1.0:
            raise ValueError("sidelap must be in [0, 1)")
        if not 0.0 < self.duty_cycle <= 1.0:
            raise ValueError("duty_cycle must be in (0, 1]")


DEFAULT_PROFILE = MissionProfile()


#: Candidate airframes. No drone is committed to for this project, so these are
#: here to be compared, not to be depended on. Every entry is nominal: verify
#: against the body before any of it reaches a flight spec.
CATALOG: dict[str, Sensor] = {
    "spec-1in-50mp": Sensor(
        name="1 inch, 50 MP, 24 mm equivalent",
        sensor_width_mm=13.2,
        pixels_across=8192,
        focal_length_mm=8.8,
        sensor_height_mm=9.9,
        pixels_down=6144,
        note="Worked example from the spec. A plausible airframe, not a real product.",
    ),
    "1in-20mp": Sensor(
        name="1 inch, 20 MP, 24 mm equivalent",
        sensor_width_mm=13.2,
        pixels_across=5472,
        focal_length_mm=8.8,
        sensor_height_mm=8.8,
        pixels_down=3648,
        note="Nominal geometry of the common 1 inch 20 MP mapping camera, 3:2. Unverified.",
    ),
    "fourthirds-20mp": Sensor(
        name="Four Thirds, 20 MP, 24 mm equivalent",
        sensor_width_mm=17.3,
        pixels_across=5280,
        focal_length_mm=12.29,
        sensor_height_mm=12.98,
        pixels_down=3956,
        note="Nominal geometry of the common Four Thirds 20 MP mapping camera. Unverified.",
    ),
    "apsc-26mp": Sensor(
        name="APS-C, 26 MP, 24 mm equivalent",
        sensor_width_mm=23.5,
        pixels_across=6252,
        focal_length_mm=16.0,
        sensor_height_mm=15.7,
        pixels_down=4168,
        note="Nominal. The large-sensor end of the trade space. Unverified.",
    ),
}


# --------------------------------------------------------------------------
# Resolution
# --------------------------------------------------------------------------


def ground_swath_m(sensor: Sensor, altitude_m: float) -> float:
    """Across-track ground width covered by one frame, in metres."""
    if altitude_m <= 0:
        raise ValueError("altitude_m must be positive")
    return sensor.field_of_view_ratio * altitude_m


def along_track_footprint_m(sensor: Sensor, altitude_m: float) -> float:
    """Along-track ground length covered by one frame, in metres."""
    if altitude_m <= 0:
        raise ValueError("altitude_m must be positive")
    return sensor.along_track_ratio * altitude_m


def gsd_mm(sensor: Sensor, altitude_m: float) -> float:
    """Ground sample distance in millimetres per pixel."""
    return ground_swath_m(sensor, altitude_m) / sensor.pixels_across * 1000.0


def gsd_m(sensor: Sensor, altitude_m: float) -> float:
    """Ground sample distance in metres per pixel."""
    return gsd_mm(sensor, altitude_m) / 1000.0


def altitude_for_gsd_m(sensor: Sensor, target_gsd_mm: float) -> float:
    """Altitude in metres at which this sensor achieves ``target_gsd_mm``.

    The inverse of :func:`gsd_mm`, and the form flight planning actually needs:
    the resolution is the requirement and the altitude is the consequence.
    """
    if target_gsd_mm <= 0:
        raise ValueError("target_gsd_mm must be positive")
    return target_gsd_mm / 1000.0 * sensor.pixels_across / sensor.field_of_view_ratio


def pixels_across_object(object_size_mm: float, gsd_millimetres: float) -> float:
    """How many pixels span an object of ``object_size_mm`` at this GSD.

    Linear extent, not area. See :data:`DETECTION_FLOOR_PX` and
    :data:`SHAPE_FLOOR_PX` for what the number has to clear to mean anything.
    """
    if gsd_millimetres <= 0:
        raise ValueError("gsd must be positive")
    return object_size_mm / gsd_millimetres


# --------------------------------------------------------------------------
# Coverage
# --------------------------------------------------------------------------


def frame_limited_speed_ms(
    sensor: Sensor, altitude_m: float, profile: MissionProfile = DEFAULT_PROFILE
) -> float:
    """Fastest ground speed that still holds ``frontlap`` at this altitude.

    One frame interval may advance the aircraft by at most the un-overlapped
    part of the along-track footprint.
    """
    footprint = along_track_footprint_m(sensor, altitude_m)
    return footprint * (1.0 - profile.frontlap) / profile.frame_interval_s


def ground_speed_ms(
    sensor: Sensor, altitude_m: float, profile: MissionProfile = DEFAULT_PROFILE
) -> tuple[float, str]:
    """Ground speed actually flown, and which constraint set it.

    Returns:
        ``(speed_ms, limiter)`` where limiter is ``"cruise"`` or ``"frame"``.
        Reporting the limiter matters: a mission that is frame-limited gets
        cheaper with a faster camera, and one that is cruise-limited does not.
    """
    frame_limited = frame_limited_speed_ms(sensor, altitude_m, profile)
    if frame_limited < profile.cruise_speed_ms:
        return frame_limited, "frame"
    return profile.cruise_speed_ms, "cruise"


def crossover_altitude_m(sensor: Sensor, profile: MissionProfile = DEFAULT_PROFILE) -> float:
    """Altitude below which the frame interval, not the aircraft, sets the speed.

    Above it, coverage falls off linearly as you descend. Below it, quadratically.
    This is the altitude an operator needs to know, because it is where the cost
    of flying lower changes character.
    """
    return (
        profile.cruise_speed_ms
        * profile.frame_interval_s
        / ((1.0 - profile.frontlap) * sensor.along_track_ratio)
    )


def area_rate_m2_per_s(
    sensor: Sensor, altitude_m: float, profile: MissionProfile = DEFAULT_PROFILE
) -> float:
    """Ground covered per second of time actually spent on a survey line.

    Effective swath, after sidelap, times ground speed. Turns, transit and
    battery swaps are not in here; that is what ``duty_cycle`` is for.
    """
    speed, _ = ground_speed_ms(sensor, altitude_m, profile)
    return ground_swath_m(sensor, altitude_m) * (1.0 - profile.sidelap) * speed


def theoretical_acres_per_hour(
    sensor: Sensor, altitude_m: float, profile: MissionProfile = DEFAULT_PROFILE
) -> float:
    """Coverage per hour of survey-line time. An upper bound nobody achieves."""
    return area_rate_m2_per_s(sensor, altitude_m, profile) * 3600.0 / SQUARE_METRES_PER_ACRE


def effective_acres_per_hour(
    sensor: Sensor, altitude_m: float, profile: MissionProfile = DEFAULT_PROFILE
) -> float:
    """Coverage per hour of wall-clock, after the duty cycle.

    The number an operator can plan a day against, and the one most exposed to
    the assumptions in :class:`MissionProfile`.
    """
    return theoretical_acres_per_hour(sensor, altitude_m, profile) * profile.duty_cycle


def relative_flight_count(
    sensor: Sensor,
    altitude_m: float,
    reference_altitude_m: float = DEFAULT_REFERENCE_ALTITUDE_M,
    profile: MissionProfile = DEFAULT_PROFILE,
) -> float:
    """How many times more flying it takes to cover a field at ``altitude_m``.

    The ratio of area rates, so sidelap and duty cycle cancel and what survives
    is geometry plus the crossover. Both altitudes above the crossover gives a
    linear ratio; both below gives a quadratic one; straddling it gives
    something in between, which is the common case and the reason this is not a
    closed-form exponent.
    """
    if altitude_m <= 0 or reference_altitude_m <= 0:
        raise ValueError("altitudes must be positive")
    return area_rate_m2_per_s(sensor, reference_altitude_m, profile) / area_rate_m2_per_s(
        sensor, altitude_m, profile
    )


# --------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class FlightPlan:
    """Everything one altitude implies, bundled so a GSD never travels alone."""

    sensor: Sensor
    profile: MissionProfile
    altitude_m: float
    gsd_mm: float
    swath_m: float
    along_track_m: float
    ground_speed_ms: float
    speed_limiter: str
    crossover_altitude_m: float
    relative_flight_count: float
    theoretical_acres_per_hour: float
    effective_acres_per_hour: float
    reference_altitude_m: float
    target_object_mm: float
    target_object_px: float

    @property
    def gsd_m(self) -> float:
        return self.gsd_mm / 1000.0

    @property
    def frame_limited(self) -> bool:
        """Whether the camera, rather than the aircraft, is the binding constraint."""
        return self.speed_limiter == "frame"

    @property
    def detectable(self) -> bool:
        """Whether the target object clears the detection floor."""
        return self.target_object_px >= DETECTION_FLOOR_PX

    @property
    def shape_resolvable(self) -> bool:
        """Whether the target object clears the shape floor."""
        return self.target_object_px >= SHAPE_FLOOR_PX


def flight_plan(
    sensor: Sensor,
    altitude_m: float,
    profile: MissionProfile = DEFAULT_PROFILE,
    reference_altitude_m: float = DEFAULT_REFERENCE_ALTITUDE_M,
    target_object_mm: float = 30.0,
) -> FlightPlan:
    """Resolve one altitude into resolution, coverage and operational cost."""
    gsd = gsd_mm(sensor, altitude_m)
    speed, limiter = ground_speed_ms(sensor, altitude_m, profile)
    return FlightPlan(
        sensor=sensor,
        profile=profile,
        altitude_m=altitude_m,
        gsd_mm=gsd,
        swath_m=ground_swath_m(sensor, altitude_m),
        along_track_m=along_track_footprint_m(sensor, altitude_m),
        ground_speed_ms=speed,
        speed_limiter=limiter,
        crossover_altitude_m=crossover_altitude_m(sensor, profile),
        relative_flight_count=relative_flight_count(
            sensor, altitude_m, reference_altitude_m, profile
        ),
        theoretical_acres_per_hour=theoretical_acres_per_hour(sensor, altitude_m, profile),
        effective_acres_per_hour=effective_acres_per_hour(sensor, altitude_m, profile),
        reference_altitude_m=reference_altitude_m,
        target_object_mm=target_object_mm,
        target_object_px=pixels_across_object(target_object_mm, gsd),
    )


def altitude_ladder(
    sensor: Sensor,
    altitudes_m: Iterable[float],
    profile: MissionProfile = DEFAULT_PROFILE,
    reference_altitude_m: float = DEFAULT_REFERENCE_ALTITUDE_M,
    target_object_mm: float = 30.0,
) -> list[FlightPlan]:
    """A :func:`flight_plan` per altitude, in the order given."""
    return [
        flight_plan(
            sensor,
            altitude_m,
            profile=profile,
            reference_altitude_m=reference_altitude_m,
            target_object_mm=target_object_mm,
        )
        for altitude_m in altitudes_m
    ]


def _acres(value: float) -> str:
    """Rounding an hour of flying to zero acres reads as a failure rather than a cost."""
    return f"{value:.1f}" if value < 10 else f"{value:.0f}"


def format_table(plans: list[FlightPlan]) -> str:
    """Render a ladder as a markdown table."""
    if not plans:
        return ""
    ref = plans[0].reference_altitude_m
    target_cm = plans[0].target_object_mm / 10.0
    header = (
        f"| Altitude | GSD | Swath | Speed | Limit | Flights vs {ref:g} m "
        f"| Theo ac/h | Eff ac/h | {target_cm:g} cm weed |"
    )
    rule = "|---:|---:|---:|---:|:--|---:|---:|---:|---:|"
    rows = []
    for p in plans:
        theo = _acres(p.theoretical_acres_per_hour)
        eff = _acres(p.effective_acres_per_hour)
        rows.append(
            f"| {p.altitude_m:g} m | {p.gsd_mm:.1f} mm | {p.swath_m:.0f} m "
            f"| {p.ground_speed_ms:.1f} m/s | {p.speed_limiter} "
            f"| {p.relative_flight_count:.2f}x | {theo} | {eff} | {p.target_object_px:.0f} px |"
        )
    return "\n".join([header, rule, *rows])
