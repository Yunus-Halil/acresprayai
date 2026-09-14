"""Tile provenance, YOLO labels, and putting tiles back together.

The stitching path is what turns a 3 m tile into a 13 m frame, which is the
difference between a dataset that can exercise the row model and one that
cannot. It is worth testing on synthetic tiles with known answers rather than
only on the archive, since the archive is 2.4 GB and gitignored.
"""

from __future__ import annotations

import numpy as np
import pytest

from offrow import datasets

TILE_PX = 640
STRIDE_PX = 512
GSD_MM = 4.8


def test_tile_position_is_recovered_from_the_filename(tmp_path):
    position = datasets.parse_tile_position(tmp_path / "10m_cache (1036)_x1024_y512.jpg")
    assert position == datasets.TilePosition(source_id="10m_1036", x_px=1024, y_px=512)


def test_a_filename_without_an_origin_is_not_invented(tmp_path):
    """DRONEWEED names are species plus a counter. Returning a guess would be worse."""
    assert datasets.parse_tile_position(tmp_path / "chenopodium_1_00042.jpg") is None


def test_parse_data_yaml(tmp_path):
    path = tmp_path / "data.yaml"
    path.write_text(
        "path: ./x\ntrain: images/train\nnc: 3\nnames:\n  0: CL\n  1: RPW\n  2: GFT\n",
        encoding="utf-8",
    )
    assert datasets.parse_data_yaml(path) == {0: "CL", 1: "RPW", 2: "GFT"}


def test_parse_yolo_denormalises_to_pixels(tmp_path):
    path = tmp_path / "a.txt"
    path.write_text("0 0.5 0.25 0.1 0.2\n", encoding="utf-8")
    (ann,) = datasets.parse_yolo(path, {0: "CL"}, 640, 640)
    assert ann.label == "cl"
    assert ann.centroid_px == pytest.approx((320.0, 160.0))
    assert (ann.width_px, ann.height_px) == pytest.approx((64.0, 128.0))


def test_parse_yolo_skips_malformed_lines(tmp_path):
    path = tmp_path / "a.txt"
    path.write_text("0 0.5 0.25 0.1 0.2\n\nbroken\n1 0.1 0.1 0.1 0.1\n", encoding="utf-8")
    assert len(datasets.parse_yolo(path, {0: "CL", 1: "RPW"}, 100, 100)) == 2


def _tile(tmp_path, x, y, annotations=()):
    return datasets.Frame(
        image_path=tmp_path / f"t_x{x}_y{y}.jpg",
        gsd_mm=GSD_MM,
        width_px=TILE_PX,
        height_px=TILE_PX,
        annotations=list(annotations),
        tile=datasets.TilePosition("10m_1", x, y),
    )


def test_stitch_extent_is_the_union_of_the_tiles(tmp_path):
    tiles = [
        _tile(tmp_path, x, y)
        for x in range(0, 3 * STRIDE_PX, STRIDE_PX)
        for y in range(0, 2 * STRIDE_PX, STRIDE_PX)
    ]
    mosaic = datasets.stitch(tiles)
    assert mosaic.width_px == 2 * STRIDE_PX + TILE_PX
    assert mosaic.height_px == STRIDE_PX + TILE_PX
    assert mosaic.coverage_m[0] == pytest.approx(mosaic.width_px * GSD_MM / 1000.0)


def test_stitch_moves_annotations_into_mosaic_coordinates(tmp_path):
    tile = _tile(tmp_path, 1024, 512, [datasets.Annotation("cl", 10, 20, 30, 40)])
    mosaic = datasets.stitch([tile])
    (ann,) = mosaic.annotations
    assert (ann.x_min, ann.y_min) == (1034, 532)


def test_stitch_merges_the_same_object_labelled_in_two_overlapping_tiles(tmp_path):
    """Tiles overlap by 128 px. An object in the overlap is labelled twice.

    Leaving both in would inflate the truth count and depress every precision
    number computed against it.
    """
    # One object at mosaic pixel (600, 100): in tile x=0 at (600, 100) and in
    # tile x=512 at (88, 100).
    left = _tile(tmp_path, 0, 0, [datasets.Annotation("cl", 590, 90, 610, 110)])
    right = _tile(tmp_path, STRIDE_PX, 0, [datasets.Annotation("cl", 78, 90, 98, 110)])
    mosaic = datasets.stitch([left, right])
    assert len(mosaic.annotations) == 1


def test_stitch_keeps_two_genuinely_different_objects(tmp_path):
    left = _tile(tmp_path, 0, 0, [datasets.Annotation("cl", 590, 90, 610, 110)])
    right = _tile(tmp_path, STRIDE_PX, 0, [datasets.Annotation("cl", 300, 300, 320, 320)])
    assert len(datasets.stitch([left, right]).annotations) == 2


def test_stitch_does_not_merge_across_labels(tmp_path):
    left = _tile(tmp_path, 0, 0, [datasets.Annotation("cl", 590, 90, 610, 110)])
    right = _tile(tmp_path, STRIDE_PX, 0, [datasets.Annotation("rpw", 78, 90, 98, 110)])
    assert len(datasets.stitch([left, right]).annotations) == 2


def test_stitch_refuses_tiles_without_a_position(tmp_path):
    orphan = datasets.Frame(image_path=tmp_path / "x.jpg", gsd_mm=GSD_MM, width_px=10, height_px=10)
    with pytest.raises(ValueError):
        datasets.stitch([orphan])


def test_stitching_is_what_makes_a_row_model_possible(tmp_path):
    """The finding, as an assertion.

    One 640 px tile at 4.8 mm/px is 3.07 m and cannot carry a pitch. Twenty-five
    of them on a 512 px stride are 12.9 m and can.
    """
    tile = _tile(tmp_path, 0, 0)
    assert not datasets.row_fit_feasibility(tile.min_coverage_m, 0.762).can_fit_pitch

    tiles = [
        _tile(tmp_path, x, y)
        for x in range(0, 5 * STRIDE_PX, STRIDE_PX)
        for y in range(0, 5 * STRIDE_PX, STRIDE_PX)
    ]
    mosaic = datasets.stitch(tiles)
    assert mosaic.min_coverage_m == pytest.approx(12.9, abs=0.05)
    feasibility = datasets.row_fit_feasibility(mosaic.min_coverage_m, 0.762)
    assert feasibility.can_fit_pitch
    assert feasibility.rows_spanned == pytest.approx(16.9, abs=0.1)


def test_group_tiles_ignores_frames_with_no_origin(tmp_path):
    dataset = datasets.Dataset(
        name="t",
        frames=[
            _tile(tmp_path, 0, 0),
            datasets.Frame(image_path=tmp_path / "x.jpg", gsd_mm=GSD_MM, width_px=1, height_px=1),
        ],
    )
    groups = datasets.group_tiles(dataset)
    assert list(groups) == ["10m_1"]
    assert len(groups["10m_1"]) == 1


def test_truth_footprint_is_smaller_than_the_imagery(tmp_path):
    """Complete imagery with partial truth is the normal case after stitching.

    A detection outside the truth footprint is unjudgeable, not wrong.
    """
    labelled = [_tile(tmp_path, 0, 0)]
    filler = [_tile(tmp_path, x, 0) for x in (STRIDE_PX, 2 * STRIDE_PX)]
    mosaic = datasets.stitch(labelled + filler)
    mosaic.truth_tiles = labelled
    assert mosaic.truth_footprint_m2 < mosaic.coverage_m2
    assert mosaic.truth_footprint_m2 == pytest.approx(labelled[0].coverage_m2, rel=0.05)


def test_mosaic_load_composes_tiles(tmp_path, monkeypatch):
    """Overlapping tiles compose without leaving holes or running off the canvas."""
    tiles = [_tile(tmp_path, x, y) for x in (0, STRIDE_PX) for y in (0, STRIDE_PX)]
    monkeypatch.setattr(
        datasets.Frame,
        "load",
        lambda self: np.full((self.height_px, self.width_px, 3), 200, dtype=np.uint8),
    )
    canvas = datasets.stitch(tiles).load()
    assert canvas.shape == (STRIDE_PX + TILE_PX, STRIDE_PX + TILE_PX, 3)
    assert (canvas == 200).all()
