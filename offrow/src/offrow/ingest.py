"""Is this rung usable? Answered in the field, between flights.

The cost of finding out on Saturday that a rung is unusable is not a re-flight.
It is that the corn has grown, the weeds you measured are a different size, and
the ground truth those captures were supposed to be scored against no longer
describes the field. Every check here exists because it fails silently: a full
card of frames that look fine and are not.

Everything is derived from the captures themselves, not from what the mission
planner was told to do. The altitude the aircraft actually held, the overlap it
actually achieved, the shutter it actually used. A plan is a hypothesis; the EXIF
is the measurement.

Nothing here needs the internet, a camera database, or a known airframe. Sensor
width comes out of the ratio between the true focal length and the 35 mm
equivalent, both of which every camera writes into every frame.
"""

from __future__ import annotations

import math
import re
import statistics
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np

from offrow import io as raster_io

#: Frame extensions worth opening.
FRAME_SUFFIXES = (".jpg", ".jpeg", ".JPG", ".JPEG", ".tif", ".tiff", ".TIF", ".dng", ".DNG")

#: Blur budget, in pixels, before a frame is called smeared. Half a pixel is the
#: point at which a few-pixel object starts losing its edge, and a 3 cm weed at
#: the target rung is five pixels across.
BLUR_BUDGET_PX = 0.5

#: How far the gimbal may be off nadir before the footprint geometry stops being
#: the simple one this module assumes.
NADIR_TOLERANCE_DEG = 3.0

#: Exposure is meant to be locked. This is how much variation is tolerated
#: before the capture is called auto-exposed, as a fraction of the median.
EXPOSURE_DRIFT_TOLERANCE = 0.02

EARTH_RADIUS_M = 6378137.0


class Status:
    """Three outcomes, and they mean different things to somebody in a field."""

    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"
    UNKNOWN = "unknown"


@dataclass
class Check:
    """One verdict, with the number behind it and what to do about it."""

    name: str
    status: str
    detail: str
    advice: str = ""

    @property
    def is_blocking(self) -> bool:
        return self.status == Status.FAIL


@dataclass
class Capture:
    """One frame, as the camera recorded it."""

    path: Path
    width_px: int | None = None
    height_px: int | None = None
    focal_mm: float | None = None
    focal_35mm: float | None = None
    exposure_s: float | None = None
    iso: float | None = None
    f_number: float | None = None
    taken_at: datetime | None = None
    latitude: float | None = None
    longitude: float | None = None
    gps_altitude_m: float | None = None
    relative_altitude_m: float | None = None
    gimbal_pitch_deg: float | None = None
    yaw_deg: float | None = None
    make: str = ""
    model: str = ""

    @property
    def sensor_width_mm(self) -> float | None:
        """Sensor width from the crop factor, which every camera writes down.

        ``36 * focal / focal_35mm``. No camera database, no format name, no
        guessing about what "1 inch" means this year.
        """
        if not self.focal_mm or not self.focal_35mm:
            return None
        return 36.0 * self.focal_mm / self.focal_35mm

    @property
    def altitude_m(self) -> float | None:
        """Height above ground, preferring the relative altitude if the aircraft wrote one."""
        return self.relative_altitude_m

    def gsd_mm(self, altitude_m: float | None = None) -> float | None:
        altitude = altitude_m if altitude_m is not None else self.altitude_m
        width = self.sensor_width_mm
        if not altitude or not width or not self.focal_mm or not self.width_px:
            return None
        return width * altitude / (self.focal_mm * self.width_px) * 1000.0


# --------------------------------------------------------------------------
# Reading
# --------------------------------------------------------------------------


def _rational(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _dms(value: Any, reference: Any) -> float | None:
    """Degrees-minutes-seconds plus a hemisphere letter into signed degrees."""
    if value is None:
        return None
    try:
        degrees, minutes, seconds = (float(v) for v in value)
    except (TypeError, ValueError):
        return None
    signed = degrees + minutes / 60.0 + seconds / 3600.0
    if str(reference).upper() in ("S", "W"):
        signed = -signed
    return signed


_ALT_KEYS = r"(?:drone-dji|Camera|drone-parrot):RelativeAltitude"

XMP_PATTERNS = {
    "relative_altitude_m": _ALT_KEYS + r"[=>\"']*\s*\"?([-+0-9.]+)",
    "gimbal_pitch_deg": r"(?:drone-dji|Camera):GimbalPitchDegree[=>\"']*\s*\"?([-+0-9.]+)",
    "yaw_deg": r"(?:drone-dji|Camera):(?:FlightYawDegree|Yaw)[=>\"']*\s*\"?([-+0-9.]+)",
}


def read_xmp(path: Path, limit: int = 1 << 18) -> dict[str, float]:
    """Pull the drone-specific fields out of the XMP packet.

    XMP is plain XML sitting near the front of the file, so this reads the first
    chunk and scans it. Parsing the whole JPEG to reach it would be slower and no
    more correct, and a frame with no XMP simply returns nothing.
    """
    try:
        with open(path, "rb") as handle:
            head = handle.read(limit)
    except OSError:
        return {}
    start = head.find(b"<x:xmpmeta")
    if start < 0:
        return {}
    text = head[start : head.find(b"</x:xmpmeta>") + 12].decode("utf-8", "ignore")
    found = {}
    for key, pattern in XMP_PATTERNS.items():
        match = re.search(pattern, text)
        if match:
            try:
                found[key] = float(match.group(1))
            except ValueError:
                continue
    return found


def read_capture(path: Path) -> Capture:
    """Read one frame's metadata. Missing fields stay None rather than guessed."""
    from PIL import Image

    capture = Capture(path=Path(path))
    try:
        with Image.open(path) as image:
            capture.width_px, capture.height_px = image.size
            exif = image.getexif()
    except Exception:
        return capture

    capture.make = str(exif.get(0x010F) or "").strip()
    capture.model = str(exif.get(0x0110) or "").strip()

    sub = exif.get_ifd(0x8769)
    capture.exposure_s = _rational(sub.get(0x829A))
    iso = sub.get(0x8827) or sub.get(0x8833)
    capture.iso = _rational(iso[0] if isinstance(iso, tuple) else iso)
    capture.f_number = _rational(sub.get(0x829D))
    capture.focal_mm = _rational(sub.get(0x920A))
    capture.focal_35mm = _rational(sub.get(0xA405))
    if sub.get(0xA002):
        capture.width_px = int(sub.get(0xA002))
    if sub.get(0xA003):
        capture.height_px = int(sub.get(0xA003))
    stamp = sub.get(0x9003) or sub.get(0x9004)
    if stamp:
        try:
            capture.taken_at = datetime.strptime(str(stamp), "%Y:%m:%d %H:%M:%S")
        except ValueError:
            pass

    gps = exif.get_ifd(0x8825)
    capture.latitude = _dms(gps.get(2), gps.get(1))
    capture.longitude = _dms(gps.get(4), gps.get(3))
    altitude = _rational(gps.get(6))
    if altitude is not None and gps.get(5) in (1, b"\x01"):
        altitude = -altitude
    capture.gps_altitude_m = altitude

    for key, value in read_xmp(Path(path)).items():
        setattr(capture, key, value)
    return capture


def read_folder(folder: Path | str) -> list[Capture]:
    """Read every frame in a folder, in capture order."""
    folder = Path(folder)
    if not folder.exists():
        raise FileNotFoundError(f"{folder} does not exist")
    paths = sorted(p for p in folder.rglob("*") if p.suffix in FRAME_SUFFIXES)
    captures = [read_capture(p) for p in paths]
    captures.sort(key=lambda c: (c.taken_at or datetime.min, c.path.name))
    return captures


# --------------------------------------------------------------------------
# Geometry from positions
# --------------------------------------------------------------------------


def local_xy_m(captures: list[Capture]) -> np.ndarray:
    """Positions in metres on a local tangent plane, relative to the first fix.

    Good to a few millimetres over a field, needs no projection library, and
    keeps the numbers small enough that an angle error cannot turn into a
    kilometre of offset.
    """
    fixes = [(c.latitude, c.longitude) for c in captures if c.latitude is not None]
    if not fixes:
        return np.zeros((0, 2))
    lat0 = math.radians(statistics.fmean(f[0] for f in fixes))
    lon0 = statistics.fmean(f[1] for f in fixes)
    lat_ref = statistics.fmean(f[0] for f in fixes)
    points = []
    for capture in captures:
        if capture.latitude is None or capture.longitude is None:
            points.append((np.nan, np.nan))
            continue
        x = math.radians(capture.longitude - lon0) * EARTH_RADIUS_M * math.cos(lat0)
        y = math.radians(capture.latitude - lat_ref) * EARTH_RADIUS_M
        points.append((x, y))
    return np.array(points, dtype=float)


def split_into_lines(xy: np.ndarray, gap_factor: float = 3.0) -> list[list[int]]:
    """Group frames into flight lines by where the heading reverses.

    A turn shows up as a large change in direction between consecutive frames.
    Splitting on that is more robust than clustering on position, because a
    mission flown at an angle to north has no axis to cluster along.
    """
    if len(xy) < 3:
        return [list(range(len(xy)))]
    steps = np.diff(xy, axis=0)
    lengths = np.hypot(steps[:, 0], steps[:, 1])
    typical = float(np.nanmedian(lengths)) if np.isfinite(lengths).any() else 0.0

    lines: list[list[int]] = [[0]]
    for index in range(1, len(xy)):
        previous = steps[index - 1]
        turned = False
        if index >= 2 and np.isfinite(previous).all():
            before = steps[index - 2]
            if np.isfinite(before).all():
                dot = float(np.dot(before, previous))
                norms = float(np.linalg.norm(before) * np.linalg.norm(previous))
                if norms > 0 and dot / norms < 0.5:  # more than 60 degrees
                    turned = True
        if (
            typical > 0
            and np.isfinite(lengths[index - 1])
            and lengths[index - 1] > gap_factor * typical
        ):
            turned = True
        if turned:
            lines.append([])
        lines[-1].append(index)
    return [line for line in lines if len(line) > 1]


# --------------------------------------------------------------------------
# The report
# --------------------------------------------------------------------------


@dataclass
class RungReport:
    """Everything measured about one rung, and whether it is usable."""

    folder: Path
    captures: list[Capture] = field(default_factory=list)
    checks: list[Check] = field(default_factory=list)
    gsd_mm: float | None = None
    altitude_m: float | None = None
    frontlap: float | None = None
    sidelap: float | None = None
    ground_speed_ms: float | None = None
    blur_px: float | None = None
    footprint: Any = None

    @property
    def usable(self) -> bool:
        return not any(check.is_blocking for check in self.checks)

    @property
    def verdict(self) -> str:
        if not self.usable:
            return "NOT USABLE - re-fly this rung before you leave the field"
        if any(check.status == Status.WARN for check in self.checks):
            return "USABLE, with warnings - read them before you move on"
        return "USABLE"

    def add(self, name: str, status: str, detail: str, advice: str = "") -> None:
        self.checks.append(Check(name, status, detail, advice))


def inspect_rung(
    folder: Path | str,
    truth: Path | str | None = None,
    ortho: Path | str | None = None,
    target_gsd_mm: float | None = None,
    frontlap: float = 0.80,
    sidelap: float = 0.70,
) -> RungReport:
    """Measure one rung from its captures and say whether it can be used."""
    report = RungReport(folder=Path(folder))
    report.captures = read_folder(folder)
    captures = report.captures

    if not captures:
        report.add(
            "frames",
            Status.FAIL,
            f"no frames found under {folder}",
            "Check the card was copied and the folder is the right one.",
        )
        return report
    report.add("frames", Status.PASS, f"{len(captures)} frames")

    _check_camera(report, captures)
    _check_altitude_and_gsd(report, captures, target_gsd_mm)
    _check_exposure_lock(report, captures)
    _check_gimbal(report, captures)
    _check_timing_and_blur(report, captures)
    _check_overlap(report, captures, frontlap, sidelap)
    _check_truth_coverage(report, captures, truth)
    if ortho:
        check_ortho(report, ortho, target_gsd_mm)
    return report


def _check_camera(report: RungReport, captures: list[Capture]) -> None:
    first = next((c for c in captures if c.sensor_width_mm), None)
    if first is None:
        report.add(
            "camera geometry",
            Status.WARN,
            "no FocalLengthIn35mmFilm in the EXIF, so sensor width cannot be derived",
            "Supply --sensor-mm and --focal-mm by hand; GSD and overlap will be "
            "estimated from the altitude alone.",
        )
        return
    report.add(
        "camera geometry",
        Status.PASS,
        f"{first.make} {first.model}: {first.sensor_width_mm:.2f} mm sensor, "
        f"{first.focal_mm:.2f} mm focal, {first.width_px} px across",
    )


def _check_altitude_and_gsd(
    report: RungReport, captures: list[Capture], target_gsd_mm: float | None
) -> None:
    altitudes = [c.altitude_m for c in captures if c.altitude_m is not None]
    if not altitudes:
        gps = [c.gps_altitude_m for c in captures if c.gps_altitude_m is not None]
        if gps:
            report.add(
                "altitude",
                Status.WARN,
                f"no relative altitude in the metadata; GPS altitude spans "
                f"{min(gps):.1f} to {max(gps):.1f} m above sea level",
                "GSD cannot be measured without height above ground. Use the scale "
                "bars in the ortho to check it instead.",
            )
        else:
            report.add("altitude", Status.WARN, "no altitude in the metadata")
        return

    median = statistics.median(altitudes)
    spread = max(altitudes) - min(altitudes)
    report.altitude_m = median
    status = Status.PASS if spread < 0.05 * median else Status.WARN
    report.add(
        "altitude held",
        status,
        f"{median:.1f} m AGL, spread {spread:.1f} m ({spread / median:.0%})",
        ""
        if status == Status.PASS
        else "A drifting altitude means a drifting GSD "
        "across the plot, which is the variable being measured.",
    )

    gsds = [c.gsd_mm(median) for c in captures if c.gsd_mm(median)]
    if not gsds:
        return
    report.gsd_mm = statistics.median(gsds)
    if target_gsd_mm:
        error = abs(report.gsd_mm - target_gsd_mm) / target_gsd_mm
        status = Status.PASS if error < 0.10 else (Status.WARN if error < 0.25 else Status.FAIL)
        report.add(
            "GSD achieved",
            status,
            f"{report.gsd_mm:.2f} mm/px against a {target_gsd_mm:g} mm target ({error:+.0%})",
            ""
            if status == Status.PASS
            else f"Re-fly at {target_gsd_mm / report.gsd_mm * median:.1f} m to hit the target.",
        )
    else:
        report.add("GSD achieved", Status.PASS, f"{report.gsd_mm:.2f} mm/px")
    weed_px = 30.0 / report.gsd_mm
    report.add(
        "3 cm weed",
        Status.PASS if weed_px >= 4.0 else Status.WARN,
        f"{weed_px:.1f} px across",
        ""
        if weed_px >= 4.0
        else "Below the 4 px detection floor. Expected at the "
        "coarse rungs; that failure is the point of flying them.",
    )


def _check_exposure_lock(report: RungReport, captures: list[Capture]) -> None:
    """Auto-exposure is the quietest way to ruin a capture.

    Frames look correct individually and the chromaticity of the same ground
    differs between overlapping frames, which is precisely what the vegetation
    mask cannot undo.
    """
    for label, values in (
        ("shutter", [c.exposure_s for c in captures if c.exposure_s]),
        ("ISO", [c.iso for c in captures if c.iso]),
        ("aperture", [c.f_number for c in captures if c.f_number]),
    ):
        if len(values) < 2:
            continue
        median = statistics.median(values)
        drift = (max(values) - min(values)) / median if median else 0.0
        if drift > EXPOSURE_DRIFT_TOLERANCE:
            report.add(
                f"{label} locked",
                Status.FAIL,
                f"{label} varies across the flight: {min(values):.6g} to {max(values):.6g}",
                "The camera was not in manual. Overlapping frames now disagree about "
                "the colour of the same ground, and no amount of processing fixes "
                "that. Set M, lock it, re-fly.",
            )
        else:
            report.add(f"{label} locked", Status.PASS, f"{median:.6g}, constant")

    shutters = [c.exposure_s for c in captures if c.exposure_s]
    if shutters:
        slowest = max(shutters)
        report.add(
            "shutter speed",
            Status.PASS if slowest <= 1 / 1500 else Status.WARN,
            f"slowest 1/{1 / slowest:.0f} s",
            ""
            if slowest <= 1 / 1500
            else "Slower than 1/1500. Check the blur figure below before trusting this rung.",
        )


def _check_gimbal(report: RungReport, captures: list[Capture]) -> None:
    pitches = [c.gimbal_pitch_deg for c in captures if c.gimbal_pitch_deg is not None]
    if not pitches:
        report.add("gimbal nadir", Status.UNKNOWN, "no gimbal pitch in the metadata")
        return
    worst = max(abs(p + 90.0) for p in pitches)
    status = Status.PASS if worst <= NADIR_TOLERANCE_DEG else Status.WARN
    report.add(
        "gimbal nadir",
        status,
        f"worst {worst:.1f} deg off nadir",
        ""
        if status == Status.PASS
        else "Off-nadir frames have a footprint this tool "
        "does not model, and an ortho built from them has a varying GSD.",
    )


def _check_timing_and_blur(report: RungReport, captures: list[Capture]) -> None:
    stamps = [c.taken_at for c in captures if c.taken_at]
    xy = local_xy_m(captures)
    if len(stamps) >= 2:
        gaps = [
            (b - a).total_seconds()
            for a, b in zip(stamps, stamps[1:], strict=False)
            if 0 < (b - a).total_seconds() < 60
        ]
        if gaps:
            report.add(
                "frame interval",
                Status.PASS,
                f"{statistics.median(gaps):.2f} s median, {min(gaps):.2f} to {max(gaps):.2f} s",
            )

    if len(xy) >= 2 and len(stamps) == len(captures):
        speeds = []
        for index in range(1, len(xy)):
            seconds = (stamps[index] - stamps[index - 1]).total_seconds()
            step = np.hypot(*(xy[index] - xy[index - 1]))
            if 0 < seconds < 60 and np.isfinite(step) and step < 200:
                speeds.append(step / seconds)
        if speeds:
            report.ground_speed_ms = statistics.median(speeds)
            report.add("ground speed", Status.PASS, f"{report.ground_speed_ms:.1f} m/s median")
            shutters = [c.exposure_s for c in captures if c.exposure_s]
            if shutters and report.gsd_mm:
                report.blur_px = (
                    report.ground_speed_ms * statistics.median(shutters) * 1000.0 / report.gsd_mm
                )
                status = (
                    Status.PASS
                    if report.blur_px <= BLUR_BUDGET_PX
                    else (Status.WARN if report.blur_px <= 1.0 else Status.FAIL)
                )
                report.add(
                    "motion blur",
                    status,
                    f"{report.blur_px:.2f} px at {report.ground_speed_ms:.1f} m/s",
                    ""
                    if status == Status.PASS
                    else "A 3 cm weed is about five pixels "
                    "across at the target rung, so this much smear removes the thing "
                    "being looked for. Faster shutter or slower flying.",
                )


def _check_overlap(
    report: RungReport, captures: list[Capture], want_front: float, want_side: float
) -> None:
    xy = local_xy_m(captures)
    if len(xy) < 3 or not report.altitude_m:
        report.add("overlap", Status.UNKNOWN, "not enough positions to measure overlap")
        return
    first = next((c for c in captures if c.sensor_width_mm), None)
    if first is None or not first.focal_mm or not first.height_px or not first.width_px:
        report.add("overlap", Status.UNKNOWN, "camera geometry unknown")
        return

    pixel_mm = first.sensor_width_mm / first.width_px
    swath_m = first.sensor_width_mm / first.focal_mm * report.altitude_m
    along_m = (pixel_mm * first.height_px) / first.focal_mm * report.altitude_m

    lines = split_into_lines(xy)
    steps = []
    for line in lines:
        for a, b in zip(line, line[1:], strict=False):
            step = float(np.hypot(*(xy[b] - xy[a])))
            if np.isfinite(step):
                steps.append(step)
    if steps:
        report.frontlap = 1.0 - statistics.median(steps) / along_m
        status = (
            Status.PASS
            if report.frontlap >= want_front - 0.05
            else (Status.WARN if report.frontlap >= 0.60 else Status.FAIL)
        )
        report.add(
            "frontlap",
            status,
            f"{report.frontlap:.0%} measured against {want_front:.0%} planned "
            f"({statistics.median(steps):.2f} m between frames, {along_m:.1f} m footprint)",
            ""
            if status == Status.PASS
            else "Too little forward overlap for a field of "
            "near-identical green objects. Slow down or shorten the interval.",
        )

    if len(lines) >= 2:
        centres = [xy[line].mean(axis=0) for line in lines]
        spacings = [float(np.hypot(*(b - a))) for a, b in zip(centres, centres[1:], strict=False)]
        spacings = [s for s in spacings if np.isfinite(s) and s > 0]
        if spacings:
            report.sidelap = 1.0 - statistics.median(spacings) / swath_m
            status = (
                Status.PASS
                if report.sidelap >= want_side - 0.05
                else (Status.WARN if report.sidelap >= 0.50 else Status.FAIL)
            )
            report.add(
                "sidelap",
                status,
                f"{report.sidelap:.0%} measured across {len(lines)} lines "
                f"({statistics.median(spacings):.2f} m apart, {swath_m:.1f} m swath)",
                ""
                if status == Status.PASS
                else "Lines too far apart. Gaps between "
                "them will not appear in the ortho as holes; they appear as stretched "
                "ground, which is worse.",
            )
    else:
        report.add(
            "sidelap",
            Status.UNKNOWN,
            f"only {len(lines)} flight line detected",
            "A single line cannot be a mapping mission over a 50 m plot.",
        )


def _check_truth_coverage(
    report: RungReport, captures: list[Capture], truth: Path | str | None
) -> None:
    if not truth:
        return
    from shapely.geometry import MultiPoint, Point

    xy = local_xy_m(captures)
    finite = xy[np.isfinite(xy).all(axis=1)]
    if len(finite) < 3 or not report.altitude_m:
        report.add("truth coverage", Status.UNKNOWN, "no usable frame positions")
        return

    first = next((c for c in captures if c.sensor_width_mm), None)
    swath_m = (
        first.sensor_width_mm / first.focal_mm * report.altitude_m
        if first and first.focal_mm
        else 0.0
    )
    footprint = MultiPoint([tuple(p) for p in finite]).convex_hull.buffer(swath_m / 2.0)
    report.footprint = footprint

    points, sizes = read_truth_points(truth)
    if not points:
        report.add("truth coverage", Status.WARN, f"no truth points read from {truth}")
        return

    lat0 = statistics.fmean(c.latitude for c in captures if c.latitude is not None)
    lon0 = statistics.fmean(c.longitude for c in captures if c.longitude is not None)
    inside = 0
    for lat, lon in points:
        x = math.radians(lon - lon0) * EARTH_RADIUS_M * math.cos(math.radians(lat0))
        y = math.radians(lat - lat0) * EARTH_RADIUS_M
        if footprint.contains(Point(x, y)):
            inside += 1

    fraction = inside / len(points)
    status = Status.PASS if fraction > 0.95 else (Status.WARN if fraction > 0.75 else Status.FAIL)
    report.add(
        "truth inside the imagery",
        status,
        f"{inside} of {len(points)} truth points fall inside the flown footprint ({fraction:.0%})",
        ""
        if status == Status.PASS
        else "Truth outside the imagery cannot be scored, "
        "and it is the half of the day that cannot be redone. Extend the mission area "
        "and re-fly while the markers are still in the ground.",
    )

    if sizes:
        small = sum(1 for s in sizes if s < 0.04)
        report.add(
            "truth size distribution",
            Status.PASS if small >= 10 else Status.WARN,
            f"{small} of {len(sizes)} truth objects are under 4 cm",
            ""
            if small >= 10
            else "The flight-spec bin is under 4 cm and it is the "
            "only one that answers the question. Measure more small weeds.",
        )


def read_truth_points(path: Path | str) -> tuple[list[tuple[float, float]], list[float]]:
    """Read truth as (lat, lon) pairs and diameters in metres.

    Accepts the GeoJSON this repo writes and a plain CSV of the kind somebody
    transcribes from a notebook in a vehicle. The CSV route matters: on Friday
    evening the truth is a notebook, not a GIS layer.
    """
    path = Path(path)
    if path.suffix.lower() in (".geojson", ".json"):
        geometries, properties, _crs = raster_io.read_geojson(path)
        points = [(g.y, g.x) for g in geometries]
        sizes = [float(p.get("diameter_m", p.get("diameter_cm", 0) or 0) or 0) for p in properties]
        sizes = [s / 100.0 if s > 1.0 else s for s in sizes]
        return points, sizes

    import csv

    points, sizes = [], []
    with open(path, newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            keys = {k.lower().strip(): v for k, v in row.items() if k}
            lat = keys.get("lat") or keys.get("latitude") or keys.get("northing")
            lon = keys.get("lon") or keys.get("longitude") or keys.get("easting")
            if lat is None or lon is None:
                continue
            try:
                points.append((float(lat), float(lon)))
            except ValueError:
                continue
            diameter = keys.get("diameter_cm") or keys.get("diameter_m") or keys.get("diameter")
            try:
                value = float(diameter) if diameter else 0.0
            except ValueError:
                value = 0.0
            sizes.append(value / 100.0 if "cm" in " ".join(keys) or value > 1.0 else value)
    return points, sizes


def _is_geographic(crs: str) -> bool:
    """Is this a CRS in degrees rather than metres?

    A raster in degrees makes every ground-unit threshold in the repo nonsense,
    and it is what most ortho tools produce unless told otherwise. An absent CRS
    counts as geographic here for the same practical reason: nothing downstream
    can work without knowing the units.
    """
    if not crs:
        return True
    lowered = crs.lower()
    if "projcs" in lowered or "projcrs" in lowered:
        return False
    return "4326" in crs or "longlat" in lowered or "geogcs" in lowered


def _crs_label(crs: str) -> str:
    """A CRS short enough to read on a phone. WKT runs to thousands of characters."""
    if not crs:
        return "none"
    if crs.startswith("EPSG:") and len(crs) < 20:
        return crs
    match = re.search(r"PROJCS\[\"([^\"]+)\"", crs) or re.search(r"GEOGCS\[\"([^\"]+)\"", crs)
    if match:
        return match.group(1)
    return crs if len(crs) <= 40 else crs[:37] + "..."


def check_ortho(report: RungReport, ortho: Path | str, target_gsd_mm: float | None = None) -> None:
    """Does this ortho meet what io.py requires, before Saturday finds out.

    Three of these are refusals rather than warnings in :mod:`offrow.io`, and
    two of them are what an ortho tool does by default unless told otherwise.
    """
    try:
        reader = raster_io.open_raster(ortho)
    except Exception as exc:
        report.add(
            "ortho readable",
            Status.FAIL,
            f"{type(exc).__name__}: {exc}",
            "Without georeferencing there are no ground units and nothing downstream can run.",
        )
        return

    with reader:
        crs = str(reader.crs or "")
        degrees = _is_geographic(crs)
        report.add(
            "ortho CRS",
            Status.FAIL if degrees else Status.PASS,
            _crs_label(crs),
            ""
            if not degrees
            else "Every threshold in this repo is in metres. Re-export "
            "in a projected CRS: UTM for your zone, or a state plane.",
        )

        try:
            gsd = reader.gsd_m
            report.add("ortho pixels", Status.PASS, f"square, {gsd * 1000:.2f} mm/px")
            if target_gsd_mm:
                error = abs(gsd * 1000 - target_gsd_mm) / target_gsd_mm
                if error > 0.25:
                    report.add(
                        "ortho resolution",
                        Status.WARN,
                        f"{gsd * 1000:.2f} mm/px against a {target_gsd_mm:g} mm target",
                        "Export at the native GSD. Resampling makes the rung measure "
                        "something other than its own resolution.",
                    )
        except ValueError as exc:
            report.add(
                "ortho pixels",
                Status.FAIL,
                str(exc),
                "io.py refuses this. Re-export north-up with square pixels.",
            )

        megapixels = reader.width * reader.height / 1e6
        report.add(
            "ortho size", Status.PASS, f"{reader.width} x {reader.height} px, {megapixels:.0f} MP"
        )


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------

SYMBOL = {
    Status.PASS: "ok  ",
    Status.WARN: "warn",
    Status.FAIL: "FAIL",
    Status.UNKNOWN: "?   ",
}


def format_report(report: RungReport, width: int = 78) -> str:
    """The whole answer, short enough to read on a phone in sunlight.

    Wrapped rather than truncated: the numbers are the point, and a detail that
    runs off the right of a phone screen is a number nobody read.
    """
    lines = [str(report.folder), ""]
    for check in report.checks:
        head = f"  [{SYMBOL[check.status]}] {check.name}: "
        body = _wrap(check.detail, max(width - len(head), 20))
        lines.append(head + (body[0] if body else ""))
        lines.extend(" " * len(head) + extra for extra in body[1:])
        lines.extend("         " + wrapped for wrapped in _wrap(check.advice, width - 11))
    lines.append("")
    lines.append(f"  {report.verdict}")
    return "\n".join(lines)


def _wrap(text: str, width: int) -> list[str]:
    words, line, out = text.split(), "", []
    for word in words:
        if len(line) + len(word) + 1 > width:
            out.append(line)
            line = word
        else:
            line = f"{line} {word}".strip()
    if line:
        out.append(line)
    return out
