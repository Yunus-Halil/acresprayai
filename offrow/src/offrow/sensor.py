"""Camera geometry and the operational cost of flying lower.

Pure arithmetic. Nothing here touches imagery, and nothing here assumes a
particular airframe: a :class:`Sensor` is four numbers the caller supplies.
:data:`CATALOG` holds candidate airframes as data, not as a default.

The relationships are the thin-lens pinhole ones::

    swath_m = (sensor_width_mm / focal_length_mm) * altitude_m
    gsd     = swath_m / pixels_across

which is why doubling altitude doubles both swath and GSD, and why a sensor
twice as wide at the same pixel count buys swath but costs resolution.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

SQUARE_METRES_PER_ACRE = 4046.8564224

#: Altitude the relative-cost columns are quoted against. 120 m is the ceiling a
#: normal mapping mission is flown at, so it is the "free" baseline an operator
#: compares against when asked to fly lower.
DEFAULT_REFERENCE_ALTITUDE_M = 120.0

#: Coverage of a single mapping aircraft at :data:`DEFAULT_REFERENCE_ALTITUDE_M`,
#: in acres per flight hour. This is an operational placeholder, not a measured
#: figure: it depends on overlap settings, battery swaps and turn overhead. It is
#: a parameter everywhere it is used so a real number can replace it later.
DEFAULT_REFERENCE_ACRES_PER_HOUR = 200.0

#: Roughly the smallest linear extent, in pixels, at which a blob is detectable
#: at all, and roughly where leaf shape becomes usable. Both are rules of thumb.
DETECTION_FLOOR_PX = 4.0
SHAPE_FLOOR_PX = 15.0


@dataclass(frozen=True)
class Sensor:
    """A camera, as the four numbers that determine ground sampling.

    Args:
        name: Human label, used only in reports.
        sensor_width_mm: Physical width of the active sensor area.
        pixels_across: Pixel count along that same width.
        focal_length_mm: True focal length, not 35 mm equivalent.
        note: Provenance of these numbers. Anything from :data:`CATALOG` carries
            a warning here, because none of it has been verified against a
            physical body.
    """

    name: str
    sensor_width_mm: float
    pixels_across: int
    focal_length_mm: float
    note: str = ""

    def __post_init__(self) -> None:
        if self.sensor_width_mm <= 0:
            raise ValueError("sensor_width_mm must be positive")
        if self.pixels_across <= 0:
            raise ValueError("pixels_across must be positive")
        if self.focal_length_mm <= 0:
            raise ValueError("focal_length_mm must be positive")

    @property
    def pixel_pitch_um(self) -> float:
        """Physical size of one pixel, in micrometres."""
        return self.sensor_width_mm * 1000.0 / self.pixels_across

    @property
    def field_of_view_ratio(self) -> float:
        """Ground swath per metre of altitude. Dimensionless."""
        return self.sensor_width_mm / self.focal_length_mm


#: Candidate airframes. No drone is committed to for this project, so these are
#: here to be compared, not to be depended on. Every entry is nominal: verify
#: against the body before any of it reaches a flight spec.
CATALOG: dict[str, Sensor] = {
    "spec-1in-50mp": Sensor(
        name="1 inch, 50 MP, 24 mm equivalent",
        sensor_width_mm=13.2,
        pixels_across=8192,
        focal_length_mm=8.8,
        note="Worked example from the spec. A plausible airframe, not a real product.",
    ),
    "1in-20mp": Sensor(
        name="1 inch, 20 MP, 24 mm equivalent",
        sensor_width_mm=13.2,
        pixels_across=5472,
        focal_length_mm=8.8,
        note="Nominal geometry of the common 1 inch 20 MP mapping camera. Unverified.",
    ),
    "fourthirds-20mp": Sensor(
        name="Four Thirds, 20 MP, 24 mm equivalent",
        sensor_width_mm=17.3,
        pixels_across=5280,
        focal_length_mm=12.29,
        note="Nominal geometry of the common Four Thirds 20 MP mapping camera. Unverified.",
    ),
    "apsc-26mp": Sensor(
        name="APS-C, 26 MP, 24 mm equivalent",
        sensor_width_mm=23.5,
        pixels_across=6252,
        focal_length_mm=16.0,
        note="Nominal. The large-sensor end of the trade space. Unverified.",
    ),
}


def ground_swath_m(sensor: Sensor, altitude_m: float) -> float:
    """Across-track ground width covered by one frame, in metres."""
    if altitude_m <= 0:
        raise ValueError("altitude_m must be positive")
    return sensor.field_of_view_ratio * altitude_m


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


def relative_flight_count(
    altitude_m: float,
    reference_altitude_m: float = DEFAULT_REFERENCE_ALTITUDE_M,
) -> float:
    """How many times more flying it takes to cover a field at ``altitude_m``.

    Quadratic in the altitude ratio, not linear. Halving altitude halves the
    swath, which doubles the number of passes; it also halves the along-track
    footprint, so holding forward overlap at a fixed frame interval halves the
    permissible ground speed as well. Both factors bite, and 10 m costs 144
    times as much flying as 120 m rather than 12.

    This assumes the camera is the binding constraint on speed. An aircraft
    already flying below its frame-rate limit at the reference altitude degrades
    more gently than this, so treat the number as the pessimistic end.
    """
    if altitude_m <= 0 or reference_altitude_m <= 0:
        raise ValueError("altitudes must be positive")
    return (reference_altitude_m / altitude_m) ** 2


def acres_per_hour(
    altitude_m: float,
    reference_altitude_m: float = DEFAULT_REFERENCE_ALTITUDE_M,
    reference_acres_per_hour: float = DEFAULT_REFERENCE_ACRES_PER_HOUR,
) -> float:
    """Coverage rate at ``altitude_m``, scaled from a known reference rate.

    Carries whatever error is in ``reference_acres_per_hour``. The ratio between
    two altitudes is the trustworthy part; the absolute number is only as good
    as the reference fed in.
    """
    return reference_acres_per_hour / relative_flight_count(altitude_m, reference_altitude_m)


def pixels_across_object(object_size_mm: float, gsd_millimetres: float) -> float:
    """How many pixels span an object of ``object_size_mm`` at this GSD.

    Linear extent, not area. See :data:`DETECTION_FLOOR_PX` and
    :data:`SHAPE_FLOOR_PX` for what the number has to clear to mean anything.
    """
    if gsd_millimetres <= 0:
        raise ValueError("gsd must be positive")
    return object_size_mm / gsd_millimetres


@dataclass(frozen=True)
class FlightPlan:
    """Everything one altitude implies, bundled so a GSD never travels alone."""

    sensor: Sensor
    altitude_m: float
    gsd_mm: float
    swath_m: float
    relative_flight_count: float
    acres_per_hour: float
    reference_altitude_m: float
    target_object_mm: float
    target_object_px: float

    @property
    def gsd_m(self) -> float:
        return self.gsd_mm / 1000.0

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
    reference_altitude_m: float = DEFAULT_REFERENCE_ALTITUDE_M,
    reference_acres_per_hour: float = DEFAULT_REFERENCE_ACRES_PER_HOUR,
    target_object_mm: float = 30.0,
) -> FlightPlan:
    """Resolve one altitude into resolution, swath and operational cost."""
    gsd = gsd_mm(sensor, altitude_m)
    return FlightPlan(
        sensor=sensor,
        altitude_m=altitude_m,
        gsd_mm=gsd,
        swath_m=ground_swath_m(sensor, altitude_m),
        relative_flight_count=relative_flight_count(altitude_m, reference_altitude_m),
        acres_per_hour=acres_per_hour(altitude_m, reference_altitude_m, reference_acres_per_hour),
        reference_altitude_m=reference_altitude_m,
        target_object_mm=target_object_mm,
        target_object_px=pixels_across_object(target_object_mm, gsd),
    )


def altitude_ladder(
    sensor: Sensor,
    altitudes_m: Iterable[float],
    reference_altitude_m: float = DEFAULT_REFERENCE_ALTITUDE_M,
    reference_acres_per_hour: float = DEFAULT_REFERENCE_ACRES_PER_HOUR,
    target_object_mm: float = 30.0,
) -> list[FlightPlan]:
    """A :func:`flight_plan` per altitude, in the order given."""
    return [
        flight_plan(
            sensor,
            altitude_m,
            reference_altitude_m=reference_altitude_m,
            reference_acres_per_hour=reference_acres_per_hour,
            target_object_mm=target_object_mm,
        )
        for altitude_m in altitudes_m
    ]


def format_table(plans: list[FlightPlan]) -> str:
    """Render a ladder as the markdown table the spec quotes."""
    if not plans:
        return ""
    ref = plans[0].reference_altitude_m
    target_cm = plans[0].target_object_mm / 10.0
    header = (
        f"| Altitude | GSD | Swath | Flights vs {ref:g} m | Acres/hour | {target_cm:g} cm weed |"
    )
    rule = "|---:|---:|---:|---:|---:|---:|"
    rows = [
        "| {alt:g} m | {gsd:.1f} mm | {swath:.0f} m | {rel:g}x | {aph} | {px:.0f} px |".format(
            alt=p.altitude_m,
            gsd=p.gsd_mm,
            swath=p.swath_m,
            rel=round(p.relative_flight_count, 2),
            # Rounding an hour of flying to zero acres would read as a failure
            # rather than as the cost of flying at 10 m, which is the finding.
            aph=f"{p.acres_per_hour:.1f}" if p.acres_per_hour < 10 else f"{p.acres_per_hour:.0f}",
            px=p.target_object_px,
        )
        for p in plans
    ]
    return "\n".join([header, rule, *rows])
