"""io.py: ground units, two backends, and the window seam.

The seam is the single most likely source of a silent wrong answer in this repo,
so it gets tested against a raster with blobs placed deliberately across it,
under both backends, and compared to a single-window run.
"""

from __future__ import annotations

import numpy as np
import pytest
import tifffile

from offrow import io

GSD_M = 0.0055
ORIGIN = (500000.0, 4400000.0)

BACKENDS = ["tifffile"] + (["rasterio"] if io.rasterio_available() else [])


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------


def write_raster(path, array, gsd_m=GSD_M, origin=ORIGIN, tile=64):
    """Write a tiled TIFF plus world file, the way synth.py does."""
    height, width = array.shape[:2]
    tifffile.imwrite(
        path,
        array,
        tile=(tile, tile),
        photometric="rgb",
        compression="zlib",
    )
    path.with_suffix(".tfw").write_text(
        "\n".join(
            [
                f"{gsd_m:.10f}",
                "0.0",
                "0.0",
                f"{-gsd_m:.10f}",
                f"{origin[0] + gsd_m / 2:.6f}",
                f"{origin[1] + height * gsd_m - gsd_m / 2:.6f}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return path


def blob_scene(width=600, height=400, centres=(), radius_px=9):
    """Soil-coloured background with green discs at the given pixel centres."""
    array = np.full((height, width, 3), (150, 118, 90), dtype=np.uint8)
    yy, xx = np.mgrid[0:height, 0:width]
    for cx, cy in centres:
        array[(xx - cx) ** 2 + (yy - cy) ** 2 <= radius_px**2] = (70, 150, 60)
    return array


@pytest.fixture
def seam_raster(tmp_path):
    """A raster whose blobs sit deliberately on the window seams.

    With a 1.1 m window and 0.22 m overlap at 5.5 mm/px, seams land at 160 and
    320 pixels. Blobs are placed exactly on them, just inside them, and well
    away from them.
    """
    centres = [
        (160, 200),  # dead on the first vertical seam
        (320, 120),  # dead on the second
        (155, 300),  # just inside the overlap band
        (325, 300),
        (80, 80),  # nowhere near a seam
        (480, 340),
        (200, 200),  # on a horizontal seam too
    ]
    array = blob_scene(centres=centres)
    return write_raster(tmp_path / "seam.tif", array), array, centres


# --------------------------------------------------------------------------
# Transforms and ground units
# --------------------------------------------------------------------------


def test_transform_round_trips():
    transform = io.Transform.from_origin(500000.0, 4400013.0, GSD_M, GSD_M)
    x, y = transform.xy(10, 20)
    row, col = transform.rowcol(x, y)
    assert (row, col) == pytest.approx((20.0, 10.0))


def test_gsd_from_transform():
    assert io.gsd_m(io.Transform.from_origin(0, 0, GSD_M, GSD_M)) == pytest.approx(GSD_M)


def test_anisotropic_pixels_are_refused():
    """One metres-per-pixel number has to be true, or every threshold is a lie."""
    with pytest.raises(ValueError, match="anisotropic"):
        io.gsd_m(io.Transform.from_origin(0, 0, 0.005, 0.006))


def test_rotated_transform_is_refused():
    with pytest.raises(ValueError, match="rotated"):
        io.gsd_m(io.Transform(0.005, 0.001, 0, 0.001, -0.005, 0))


def test_m_to_px_and_back():
    transform = io.Transform.from_origin(0, 0, GSD_M, GSD_M)
    assert io.m_to_px(0.11, transform) == pytest.approx(20.0)
    assert io.px_to_m(20, transform) == pytest.approx(0.11)


def test_as_transform_accepts_a_plain_tuple():
    assert io.as_transform((1.0, 0.0, 2.0, 0.0, -1.0, 3.0)).c == 2.0


# --------------------------------------------------------------------------
# Backends
# --------------------------------------------------------------------------


@pytest.mark.parametrize("backend", BACKENDS)
def test_windowed_reads_match_the_whole_array(tmp_path, backend):
    array = blob_scene(centres=[(100, 100), (400, 300)])
    path = write_raster(tmp_path / "r.tif", array)
    rng = np.random.default_rng(0)
    with io.open_raster(path, backend=backend) as reader:
        assert reader.backend_name == backend
        for _ in range(12):
            x0 = int(rng.integers(0, reader.width - 50))
            y0 = int(rng.integers(0, reader.height - 50))
            w = int(rng.integers(1, 50))
            h = int(rng.integers(1, 50))
            got = reader.read(io.Window(x0, y0, w, h))
            assert np.array_equal(got, array[y0 : y0 + h, x0 : x0 + w])


@pytest.mark.skipif(len(BACKENDS) < 2, reason="needs both backends to compare them")
def test_both_backends_agree(tmp_path):
    """The seam between the backends is only worth having if they are the same.

    Same pixels, same transform, same GSD, from a file with a world file and no
    GeoTIFF tags.
    """
    array = blob_scene(centres=[(120, 90), (450, 260)])
    path = write_raster(tmp_path / "r.tif", array)
    window = io.Window(37, 51, 123, 97)
    with (
        io.open_raster(path, backend="rasterio") as a,
        io.open_raster(path, backend="tifffile") as b,
    ):
        assert np.array_equal(a.read(window), b.read(window))
        assert a.gsd_m == pytest.approx(b.gsd_m)
        assert a.bounds_m == pytest.approx(b.bounds_m)


def test_georeferencing_is_read_from_the_world_file(tmp_path):
    array = blob_scene(width=100, height=80)
    path = write_raster(tmp_path / "r.tif", array)
    with io.open_raster(path, backend="tifffile") as reader:
        assert reader.gsd_m == pytest.approx(GSD_M)
        minx, miny, maxx, maxy = reader.bounds_m
        assert minx == pytest.approx(ORIGIN[0])
        assert maxy == pytest.approx(ORIGIN[1] + 80 * GSD_M)


def test_a_raster_without_georeferencing_is_refused(tmp_path):
    """No transform means no ground units, and this repo will not invent one."""
    path = tmp_path / "bare.tif"
    tifffile.imwrite(path, blob_scene(width=64, height=64), tile=(32, 32), photometric="rgb")
    with pytest.raises(io.MissingGeoreference):
        io.open_raster(path, backend="tifffile")


def test_an_override_transform_is_accepted(tmp_path):
    path = tmp_path / "bare.tif"
    tifffile.imwrite(path, blob_scene(width=64, height=64), tile=(32, 32), photometric="rgb")
    transform = io.Transform.from_origin(0, 0, 0.01, 0.01)
    with io.open_raster(path, backend="tifffile", transform=transform) as reader:
        assert reader.gsd_m == pytest.approx(0.01)


def test_asking_for_a_backend_that_cannot_load_fails_loudly():
    if io.rasterio_available():
        pytest.skip("rasterio loads here, so there is nothing to refuse")
    with pytest.raises(RuntimeError, match="rasterio cannot load"):
        io.open_raster("x.tif", backend="rasterio")


# --------------------------------------------------------------------------
# Windows
# --------------------------------------------------------------------------


@pytest.mark.parametrize("backend", BACKENDS)
def test_windows_cover_the_raster_and_owned_rectangles_tile_it(tmp_path, backend):
    """Every pixel is inside some window, and owned by exactly one.

    If the owned rectangles left a gap, blobs there would vanish. If they
    overlapped, blobs there would be counted twice.
    """
    array = blob_scene(width=600, height=400)
    path = write_raster(tmp_path / "r.tif", array)
    chips = list(io.iter_windows(path, window_m=1.1, overlap_m=0.22, backend=backend))
    assert len(chips) > 4

    ownership = np.zeros((400, 600), dtype=np.int32)
    seen = np.zeros((400, 600), dtype=bool)
    for chip in chips:
        window = chip.window
        seen[window.row_off : window.row_end, window.col_off : window.col_end] = True
        rows, cols = chip.interior_slice
        ownership[
            window.row_off + rows.start : window.row_off + rows.stop,
            window.col_off + cols.start : window.col_off + cols.stop,
        ] += 1

    assert seen.all(), "some pixels are in no window"
    assert ownership.min() == 1, "some pixels are owned by no window"
    assert ownership.max() == 1, "some pixels are owned by more than one window"


def test_window_and_overlap_are_ground_units(tmp_path):
    array = blob_scene(width=600, height=400)
    path = write_raster(tmp_path / "r.tif", array)
    chip = next(iter(io.iter_windows(path, window_m=1.1, overlap_m=0.22)))
    assert chip.array.shape[0] == pytest.approx(round(1.1 / GSD_M), abs=1)
    assert chip.gsd_m == pytest.approx(GSD_M)


def test_overlap_must_be_smaller_than_the_window(tmp_path):
    array = blob_scene(width=100, height=100)
    path = write_raster(tmp_path / "r.tif", array)
    with pytest.raises(ValueError):
        list(io.iter_windows(path, window_m=1.0, overlap_m=1.0))


def test_required_overlap_exceeds_the_blob():
    """The rule the seam rests on: overlap at least one blob diameter."""
    assert io.required_overlap_m(0.2) > 0.2


def test_windows_outside_the_boundary_are_skipped(tmp_path):
    from shapely.geometry import box

    array = blob_scene(width=600, height=400)
    path = write_raster(tmp_path / "r.tif", array)
    everything = len(list(io.iter_windows(path, window_m=1.1, overlap_m=0.22)))
    corner = box(ORIGIN[0], ORIGIN[1] + 400 * GSD_M - 0.6, ORIGIN[0] + 0.6, ORIGIN[1] + 400 * GSD_M)
    clipped = len(list(io.iter_windows(path, window_m=1.1, overlap_m=0.22, boundary=corner)))
    assert 0 < clipped < everything


# --------------------------------------------------------------------------
# The seam
# --------------------------------------------------------------------------


def label_blobs(mask, transform, touching_matters=True):
    """Minimal connected components in ground coordinates.

    Stands in for ``blobs.py``, which is step 7. The point here is the seam
    machinery, not the feature extraction.
    """
    from skimage.measure import label, regionprops

    features = []
    height, width = mask.shape
    for region in regionprops(label(mask)):
        row, col = region.centroid
        x, y = transform.center(col, row)
        minr, minc, maxr, maxc = region.bbox
        touches = touching_matters and (minr == 0 or minc == 0 or maxr == height or maxc == width)
        features.append(
            {
                "centroid_xy_m": (x, y),
                "area_px": int(region.area),
                "touches_border": touches,
            }
        )
    return features


def green_mask(array):
    return array[..., 1].astype(np.int16) > array[..., 0].astype(np.int16)


@pytest.mark.parametrize("backend", BACKENDS)
def test_windowed_run_matches_single_window_run_including_seam_blobs(seam_raster, backend):
    """The spec's seam test, with blobs placed deliberately on the seams.

    A windowed run must find the same blobs, at the same ground positions, with
    the same areas, as reading the whole raster at once. Blobs cut by a window
    edge are dropped and recovered from the neighbour that holds them whole,
    which is only sound because the overlap is wider than a blob.
    """
    path, array, centres = seam_raster

    whole = label_blobs(
        green_mask(array),
        io.Transform.from_origin(ORIGIN[0], ORIGIN[1] + array.shape[0] * GSD_M, GSD_M, GSD_M),
        touching_matters=False,
    )
    assert len(whole) == len(centres)

    chunks = []
    for chip in io.iter_windows(path, window_m=1.1, overlap_m=0.22, backend=backend):
        chunks.append((chip, label_blobs(green_mask(chip.array), chip.transform)))
    windowed = io.merge_across_seams(chunks)

    assert len(windowed) == len(whole)
    assert sorted(f["area_px"] for f in windowed) == sorted(f["area_px"] for f in whole)

    # Positions are compared in ground units with a sub-pixel tolerance rather
    # than for exact equality. A windowed centroid is computed inside the window
    # and then offset by the window origin, so it carries a different rounding
    # path to the single-window answer; the two agree to about a fiftieth of a
    # pixel, which is agreement, and demanding bit-equality would be testing
    # float association rather than the seam.
    tolerance_m = GSD_M / 5.0
    unmatched = list(whole)
    for feature in windowed:
        x, y = feature["centroid_xy_m"]
        match = next(
            (
                candidate
                for candidate in unmatched
                if abs(candidate["centroid_xy_m"][0] - x) < tolerance_m
                and abs(candidate["centroid_xy_m"][1] - y) < tolerance_m
            ),
            None,
        )
        assert match is not None, f"windowed blob at {x}, {y} has no single-window counterpart"
        unmatched.remove(match)
    assert unmatched == []


def test_without_the_seam_merge_blobs_are_double_counted(seam_raster):
    """The failure this machinery exists to prevent, demonstrated.

    Concatenating per-window results counts every blob in the overlap twice and
    truncates the ones cut by an edge. It is a plausible-looking answer, which
    is what makes it dangerous.
    """
    path, array, centres = seam_raster
    naive = []
    for chip in io.iter_windows(path, window_m=1.1, overlap_m=0.22):
        naive.extend(label_blobs(green_mask(chip.array), chip.transform))
    assert len(naive) > len(centres)


def test_merge_keeps_a_feature_from_exactly_one_chip(seam_raster):
    path, _, _ = seam_raster
    chips = list(io.iter_windows(path, window_m=1.1, overlap_m=0.22))
    point = chips[0].interior_bounds_m
    x = (point[0] + point[2]) / 2
    y = (point[1] + point[3]) / 2
    owners = [chip for chip in chips if chip.owns(x, y)]
    assert len(owners) == 1


def test_border_touching_features_are_dropped(seam_raster):
    path, _, _ = seam_raster
    chips = list(io.iter_windows(path, window_m=1.1, overlap_m=0.22))
    chip = chips[0]
    x, y = (chip.interior_bounds_m[0] + 0.01, chip.interior_bounds_m[1] + 0.01)
    features = [{"centroid_xy_m": (x, y), "touches_border": True}]
    assert io.merge_across_seams([(chip, features)]) == []
    features[0]["touches_border"] = False
    assert len(io.merge_across_seams([(chip, features)])) == 1


# --------------------------------------------------------------------------
# Boundaries
# --------------------------------------------------------------------------


def test_clip_to_boundary_masks_outside(tmp_path):
    from shapely.geometry import box

    array = blob_scene(width=100, height=100)
    transform = io.Transform.from_origin(0.0, 100 * GSD_M, GSD_M, GSD_M)
    half = box(0.0, 0.0, 50 * GSD_M, 100 * GSD_M)
    inside = io.clip_to_boundary(array, transform, half)
    assert inside.shape == (100, 100)
    assert inside[:, :49].all()
    assert not inside[:, 51:].any()
    assert (~io.clip_to_boundary(array, transform, half, invert=True) == inside).all()


def test_inward_buffer_shrinks():
    from shapely.geometry import box

    field = box(0, 0, 100, 100)
    shrunk = io.inward_buffer(field, 15.0)
    assert shrunk.bounds == pytest.approx((15.0, 15.0, 85.0, 85.0))


def test_inward_buffer_that_eats_the_field_warns_rather_than_raising():
    """A 15 m headland on a 20 m plot legitimately leaves nothing to inspect."""
    from shapely.geometry import box

    with pytest.warns(UserWarning, match="consumed the whole boundary"):
        assert io.inward_buffer(box(0, 0, 20, 20), 15.0).is_empty


# --------------------------------------------------------------------------
# GeoJSON without GDAL
# --------------------------------------------------------------------------


def test_geojson_round_trip(tmp_path):
    from shapely.geometry import Point

    points = [Point(1.0, 2.0), Point(3.0, 4.0)]
    properties = [{"score": 0.9}, {"score": 0.1}]
    path = io.write_geojson(tmp_path / "p.geojson", points, properties, crs="EPSG:32614")
    geometries, read_properties, crs = io.read_geojson(path)
    assert crs == "EPSG:32614"
    assert [g.x for g in geometries] == [1.0, 3.0]
    assert read_properties == properties


def test_read_boundary_unions_features(tmp_path):
    from shapely.geometry import box

    path = io.write_geojson(tmp_path / "b.geojson", [box(0, 0, 1, 1), box(1, 0, 2, 1)])
    assert io.read_boundary(path).bounds == pytest.approx((0.0, 0.0, 2.0, 1.0))
