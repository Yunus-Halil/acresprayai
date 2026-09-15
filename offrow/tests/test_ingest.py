"""ingest.py: would this have caught the thing that ruins the day?

Every check in this module exists because the corresponding mistake produces a
full card of frames that look fine. So the tests build captures that are wrong in
exactly those ways and assert that the verdict comes back NOT USABLE, because a
check that cannot fail is decoration.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta

import numpy as np
import pytest
from PIL import Image

from offrow import ingest

EARTH_R = 6378137.0

# A 1 inch 20 MP mapping camera at the 5.5 mm/px rung.
SENSOR_MM = 13.2
FOCAL_MM = 8.8
FOCAL_35 = 24.0
WIDTH_PX = 5472
HEIGHT_PX = 3648
ALTITUDE_M = 20.1
ORIGIN = (40.5, -96.5)


def gsd_mm(altitude_m: float = ALTITUDE_M) -> float:
    return SENSOR_MM * altitude_m / (FOCAL_MM * WIDTH_PX) * 1000.0


def offset_latlon(east_m: float, north_m: float) -> tuple[float, float]:
    lat = ORIGIN[0] + math.degrees(north_m / EARTH_R)
    lon = ORIGIN[1] + math.degrees(east_m / (EARTH_R * math.cos(math.radians(ORIGIN[0]))))
    return lat, lon


def to_dms(value: float) -> tuple[tuple[float, float, float], str, bool]:
    negative = value < 0
    value = abs(value)
    degrees = int(value)
    minutes = int((value - degrees) * 60)
    seconds = (value - degrees - minutes / 60) * 3600
    return (float(degrees), float(minutes), seconds), ("S" if negative else "N"), negative


def write_frame(
    path,
    lat,
    lon,
    taken_at,
    altitude_m=ALTITUDE_M,
    exposure_s=1 / 1600,
    iso=200,
    f_number=4.0,
    gimbal_pitch=-90.0,
    focal_35=FOCAL_35,
    with_xmp=True,
):
    """A JPEG carrying the metadata a mapping drone actually writes."""
    image = Image.fromarray(np.zeros((16, 16, 3), dtype=np.uint8))
    exif = Image.Exif()
    exif[0x010F] = "TestAir"
    exif[0x0110] = "TA-1"
    exif[0x8769] = {
        0x829A: exposure_s,
        0x8827: iso,
        0x829D: f_number,
        0x920A: FOCAL_MM,
        0x9003: taken_at.strftime("%Y:%m:%d %H:%M:%S"),
        0xA002: WIDTH_PX,
        0xA003: HEIGHT_PX,
    }
    if focal_35:
        exif[0x8769][0xA405] = focal_35

    exif[0x8825] = {
        1: "N" if lat >= 0 else "S",
        2: to_dms(lat)[0],
        3: "E" if lon >= 0 else "W",
        4: to_dms(lon)[0],
        5: 0,
        6: 330.0 + altitude_m,
    }
    image.save(path, "JPEG", exif=exif.tobytes())

    if with_xmp:
        blob = path.read_bytes()
        xmp = (
            f'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description '
            f'drone-dji:RelativeAltitude="{altitude_m:+.2f}" '
            f'drone-dji:GimbalPitchDegree="{gimbal_pitch:+.2f}" '
            f'drone-dji:FlightYawDegree="+0.00"/></rdf:RDF></x:xmpmeta>'
        ).encode()
        # Splice an APP1 XMP segment in after SOI, which is where cameras put it.
        payload = b"http://ns.adobe.com/xap/1.0/\x00" + xmp
        segment = b"\xff\xe1" + (len(payload) + 2).to_bytes(2, "big") + payload
        path.write_bytes(blob[:2] + segment + blob[2:])
    return path


def build_rung(
    folder,
    lines=4,
    per_line=8,
    altitude_m=ALTITUDE_M,
    frontlap=0.80,
    sidelap=0.70,
    **frame_kwargs,
):
    """A whole rung: several parallel lines flown in a boustrophedon."""
    folder.mkdir(parents=True, exist_ok=True)
    swath = SENSOR_MM / FOCAL_MM * altitude_m
    along = (SENSOR_MM * HEIGHT_PX / WIDTH_PX) / FOCAL_MM * altitude_m
    step = along * (1 - frontlap)
    spacing = swath * (1 - sidelap)

    start = datetime(2026, 9, 18, 12, 0, 0)
    index = 0
    for line in range(lines):
        for position in range(per_line):
            north = position * step if line % 2 == 0 else (per_line - 1 - position) * step
            lat, lon = offset_latlon(line * spacing, north)
            write_frame(
                folder / f"frame_{index:04d}.jpg",
                lat,
                lon,
                start + timedelta(seconds=index),
                altitude_m=altitude_m,
                **frame_kwargs,
            )
            index += 1
    return folder


@pytest.fixture
def good_rung(tmp_path):
    return build_rung(tmp_path / "rung")


def status_of(report, name):
    return next(c.status for c in report.checks if c.name == name)


# --------------------------------------------------------------------------
# Reading what the camera wrote
# --------------------------------------------------------------------------


def test_sensor_width_comes_from_the_crop_factor(tmp_path):
    """No camera database, no format name. Every camera writes both focal lengths."""
    path = write_frame(tmp_path / "a.jpg", *offset_latlon(0, 0), datetime(2026, 9, 18, 12, 0))
    capture = ingest.read_capture(path)
    assert capture.sensor_width_mm == pytest.approx(SENSOR_MM, rel=0.001)
    assert capture.focal_mm == pytest.approx(FOCAL_MM)
    assert capture.width_px == WIDTH_PX


def test_xmp_relative_altitude_is_read(tmp_path):
    path = write_frame(tmp_path / "a.jpg", *offset_latlon(0, 0), datetime(2026, 9, 18, 12, 0))
    capture = ingest.read_capture(path)
    assert capture.relative_altitude_m == pytest.approx(ALTITUDE_M, abs=0.01)
    assert capture.gimbal_pitch_deg == pytest.approx(-90.0, abs=0.01)


def test_gps_is_read_and_signed(tmp_path):
    lat, lon = offset_latlon(0, 0)
    path = write_frame(tmp_path / "a.jpg", lat, lon, datetime(2026, 9, 18, 12, 0))
    capture = ingest.read_capture(path)
    assert capture.latitude == pytest.approx(lat, abs=1e-5)
    assert capture.longitude == pytest.approx(lon, abs=1e-5)
    assert capture.longitude < 0, "a western longitude must come back negative"


def test_a_frame_with_no_metadata_reads_as_unknown_not_as_zero(tmp_path):
    path = tmp_path / "plain.jpg"
    Image.fromarray(np.zeros((16, 16, 3), dtype=np.uint8)).save(path, "JPEG")
    capture = ingest.read_capture(path)
    assert capture.sensor_width_mm is None
    assert capture.altitude_m is None


def test_an_unreadable_file_does_not_stop_the_run(tmp_path):
    (tmp_path / "broken.jpg").write_bytes(b"not a jpeg")
    capture = ingest.read_capture(tmp_path / "broken.jpg")
    assert capture.path.name == "broken.jpg"


# --------------------------------------------------------------------------
# A good rung
# --------------------------------------------------------------------------


def test_a_good_rung_is_usable(good_rung):
    report = ingest.inspect_rung(good_rung, target_gsd_mm=5.5)
    assert report.usable, ingest.format_report(report)
    assert report.verdict.startswith("USABLE")


def test_gsd_is_measured_from_the_captures(good_rung):
    report = ingest.inspect_rung(good_rung, target_gsd_mm=5.5)
    assert report.gsd_mm == pytest.approx(gsd_mm(), rel=0.01)
    assert report.gsd_mm == pytest.approx(5.5, rel=0.02)
    assert status_of(report, "GSD achieved") == ingest.Status.PASS


def test_overlap_is_measured_not_assumed(good_rung):
    report = ingest.inspect_rung(good_rung, target_gsd_mm=5.5)
    assert report.frontlap == pytest.approx(0.80, abs=0.05)
    assert report.sidelap == pytest.approx(0.70, abs=0.05)


def test_ground_speed_and_blur_are_reported(good_rung):
    report = ingest.inspect_rung(good_rung, target_gsd_mm=5.5)
    assert report.ground_speed_ms is not None
    assert report.blur_px is not None
    assert status_of(report, "motion blur") == ingest.Status.PASS


# --------------------------------------------------------------------------
# The mistakes that produce a full card of useless frames
# --------------------------------------------------------------------------


def test_auto_exposure_is_caught_and_is_blocking(tmp_path):
    """The quietest killer. Each frame looks correct; overlapping frames disagree
    about the colour of the same ground, and chromaticity cannot undo that."""
    folder = tmp_path / "auto"
    folder.mkdir()
    start = datetime(2026, 9, 18, 12, 0)
    for index in range(12):
        lat, lon = offset_latlon(0, index * 1.0)
        write_frame(
            folder / f"f{index:03d}.jpg",
            lat,
            lon,
            start + timedelta(seconds=index),
            exposure_s=1 / (1600 + index * 120),  # the camera metering each frame
        )
    report = ingest.inspect_rung(folder, target_gsd_mm=5.5)
    assert status_of(report, "shutter locked") == ingest.Status.FAIL
    assert not report.usable


def test_locked_exposure_passes(good_rung):
    report = ingest.inspect_rung(good_rung)
    assert status_of(report, "shutter locked") == ingest.Status.PASS
    assert status_of(report, "ISO locked") == ingest.Status.PASS


def test_a_slow_shutter_shows_up_as_blur(tmp_path):
    folder = build_rung(tmp_path / "blur", exposure_s=1 / 200)
    report = ingest.inspect_rung(folder, target_gsd_mm=5.5)
    assert report.blur_px > ingest.BLUR_BUDGET_PX
    assert status_of(report, "motion blur") in (ingest.Status.WARN, ingest.Status.FAIL)


def test_a_tilted_gimbal_is_caught(tmp_path):
    folder = build_rung(tmp_path / "tilt", gimbal_pitch=-75.0)
    report = ingest.inspect_rung(folder)
    assert status_of(report, "gimbal nadir") == ingest.Status.WARN


def test_too_little_sidelap_is_caught(tmp_path):
    folder = build_rung(tmp_path / "gappy", sidelap=0.30)
    report = ingest.inspect_rung(folder)
    assert report.sidelap == pytest.approx(0.30, abs=0.06)
    assert status_of(report, "sidelap") in (ingest.Status.WARN, ingest.Status.FAIL)


def test_too_little_frontlap_is_caught(tmp_path):
    folder = build_rung(tmp_path / "fast", frontlap=0.40)
    report = ingest.inspect_rung(folder)
    assert status_of(report, "frontlap") in (ingest.Status.WARN, ingest.Status.FAIL)


def test_the_wrong_altitude_is_caught_against_the_target(tmp_path):
    """Flown at 30 m when the rung wanted 20. The frames are fine and the rung is not."""
    folder = build_rung(tmp_path / "high", altitude_m=30.0)
    report = ingest.inspect_rung(folder, target_gsd_mm=5.5)
    assert report.gsd_mm == pytest.approx(gsd_mm(30.0), rel=0.01)
    assert status_of(report, "GSD achieved") == ingest.Status.FAIL
    assert not report.usable
    advice = next(c.advice for c in report.checks if c.name == "GSD achieved")
    assert "Re-fly at" in advice


def test_an_empty_folder_fails_rather_than_passing_vacuously(tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    report = ingest.inspect_rung(empty)
    assert not report.usable
    assert status_of(report, "frames") == ingest.Status.FAIL


def test_a_missing_folder_is_an_error(tmp_path):
    with pytest.raises(FileNotFoundError):
        ingest.inspect_rung(tmp_path / "nope")


# --------------------------------------------------------------------------
# Truth coverage
# --------------------------------------------------------------------------


def write_truth_csv(path, points, diameters_cm):
    lines = ["id,lat,lon,diameter_cm"]
    for index, ((lat, lon), diameter) in enumerate(zip(points, diameters_cm, strict=True)):
        lines.append(f"w{index},{lat:.8f},{lon:.8f},{diameter}")
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def test_truth_inside_the_imagery_passes(tmp_path, good_rung):
    points = [offset_latlon(5.0 + i, 5.0 + i) for i in range(12)]
    truth = write_truth_csv(tmp_path / "truth.csv", points, [2.5] * 12)
    report = ingest.inspect_rung(good_rung, truth=truth, target_gsd_mm=5.5)
    assert status_of(report, "truth inside the imagery") == ingest.Status.PASS


def test_truth_outside_the_imagery_is_blocking(tmp_path, good_rung):
    """The half of the day that cannot be redone, landing on ground nobody flew."""
    points = [offset_latlon(900.0 + i, 900.0) for i in range(12)]
    truth = write_truth_csv(tmp_path / "truth.csv", points, [2.5] * 12)
    report = ingest.inspect_rung(good_rung, truth=truth, target_gsd_mm=5.5)
    assert status_of(report, "truth inside the imagery") == ingest.Status.FAIL
    assert not report.usable


def test_truth_with_too_few_small_weeds_warns(tmp_path, good_rung):
    """The flight-spec bin is under 4 cm and it is the only one that answers the question."""
    points = [offset_latlon(5.0 + i, 5.0) for i in range(12)]
    truth = write_truth_csv(tmp_path / "truth.csv", points, [20.0] * 12)
    report = ingest.inspect_rung(good_rung, truth=truth, target_gsd_mm=5.5)
    assert status_of(report, "truth size distribution") == ingest.Status.WARN


def test_truth_csv_reads_diameters_in_centimetres(tmp_path):
    points = [offset_latlon(0, 0), offset_latlon(1, 1)]
    path = write_truth_csv(tmp_path / "t.csv", points, [3.0, 25.0])
    read_points, sizes = ingest.read_truth_points(path)
    assert len(read_points) == 2
    assert sizes == pytest.approx([0.03, 0.25])


def test_truth_geojson_is_accepted_too(tmp_path):
    from shapely.geometry import Point

    from offrow import io

    path = io.write_geojson(
        tmp_path / "t.geojson",
        [Point(-96.5, 40.5), Point(-96.4999, 40.5001)],
        [{"diameter_m": 0.03}, {"diameter_m": 0.05}],
    )
    points, sizes = ingest.read_truth_points(path)
    assert len(points) == 2
    assert sizes == pytest.approx([0.03, 0.05])


# --------------------------------------------------------------------------
# The ortho
# --------------------------------------------------------------------------


def test_an_ortho_in_degrees_is_blocking(tmp_path, good_rung):
    """Most ortho tools default to WGS84 lat/lon, and every threshold here is metres."""
    import tifffile

    from offrow import io

    path = tmp_path / "wgs84.tif"
    tifffile.imwrite(path, np.zeros((64, 64, 3), np.uint8), tile=(32, 32), photometric="rgb")
    path.with_suffix(".tfw").write_text(
        "\n".join(["0.00000005", "0.0", "0.0", "-0.00000005", "-96.5", "40.5", ""]),
        encoding="utf-8",
    )
    path.with_suffix(".prj").write_text(
        'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],'
        'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]',
        encoding="utf-8",
    )
    report = ingest.inspect_rung(good_rung)
    ingest.check_ortho(report, path)
    assert status_of(report, "ortho CRS") == ingest.Status.FAIL
    assert not report.usable
    del io


def test_a_projected_ortho_passes(tmp_path, good_rung):
    import tifffile

    path = tmp_path / "utm.tif"
    tifffile.imwrite(path, np.zeros((64, 64, 3), np.uint8), tile=(32, 32), photometric="rgb")
    path.with_suffix(".tfw").write_text(
        "\n".join(["0.0055", "0.0", "0.0", "-0.0055", "500000.0", "4400000.0", ""]),
        encoding="utf-8",
    )
    from offrow.synth import PRJ_WKT

    path.with_suffix(".prj").write_text(PRJ_WKT["EPSG:32614"], encoding="utf-8")
    report = ingest.inspect_rung(good_rung)
    ingest.check_ortho(report, path, target_gsd_mm=5.5)
    assert status_of(report, "ortho CRS") == ingest.Status.PASS
    assert status_of(report, "ortho pixels") == ingest.Status.PASS


def test_a_missing_ortho_is_blocking(tmp_path, good_rung):
    report = ingest.inspect_rung(good_rung)
    ingest.check_ortho(report, tmp_path / "nothing.tif")
    assert status_of(report, "ortho readable") == ingest.Status.FAIL


# --------------------------------------------------------------------------
# Presentation
# --------------------------------------------------------------------------


def test_the_report_fits_a_phone_screen(good_rung):
    """It gets read in sunlight, one-handed, with the other hand holding a drone."""
    report = ingest.inspect_rung(good_rung, target_gsd_mm=5.5)
    text = ingest.format_report(report)
    # The first line is the folder the user chose, whose length is their
    # business. Everything this module generates has to fit.
    body = text.splitlines()[1:]
    assert all(len(line) <= 78 for line in body), max(body, key=len)
    assert "USABLE" in text


def test_a_failing_check_carries_advice(tmp_path):
    folder = build_rung(tmp_path / "high", altitude_m=30.0)
    report = ingest.inspect_rung(folder, target_gsd_mm=5.5)
    for check in report.checks:
        if check.is_blocking:
            assert check.advice, f"{check.name} fails without saying what to do"


def test_line_splitting_finds_the_lines(tmp_path):
    folder = build_rung(tmp_path / "r", lines=3, per_line=6)
    captures = ingest.read_folder(folder)
    xy = ingest.local_xy_m(captures)
    assert len(ingest.split_into_lines(xy)) == 3
