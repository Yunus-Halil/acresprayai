"""datasets.py: the VOC parser, and the coverage arithmetic that decides the architecture.

None of these need a download. The coverage question is answerable from the
published descriptors, which is the point of keeping capture parameters in
:data:`offrow.datasets.SPECS` rather than sniffing them from files.
"""

from __future__ import annotations

import pytest

from offrow import datasets

VOC_XML = """<annotation>
  <folder>MAIZE_1_chenopodium</folder>
  <filename>chenopodium_1_00042.jpg</filename>
  <path>D:/ortho/partitions/maize_r012_c034.jpg</path>
  <size><width>1000</width><height>1000</height><depth>3</depth></size>
  <object>
    <name>Chenopodium album</name>
    <bndbox><xmin>100</xmin><ymin>200</ymin><xmax>140</xmax><ymax>260</ymax></bndbox>
  </object>
  <object>
    <name>Zea mays</name>
    <bndbox><xmin>500</xmin><ymin>500</ymin><xmax>600</xmax><ymax>620</ymax></bndbox>
  </object>
</annotation>
"""


@pytest.fixture
def voc_file(tmp_path):
    path = tmp_path / "sample.xml"
    path.write_text(VOC_XML, encoding="utf-8")
    return path


def test_parse_voc_reads_boxes_and_size(voc_file):
    annotations, (width, height) = datasets.parse_voc(voc_file)
    assert (width, height) == (1000, 1000)
    assert len(annotations) == 2
    assert {a.label for a in annotations} == {"chenopodium album", "zea mays"}


def test_parse_voc_centroid_and_size_in_metres(voc_file):
    annotations, _ = datasets.parse_voc(voc_file)
    weed = next(a for a in annotations if a.label.startswith("chenopodium"))
    # 1.7 mm/px: a 40 x 60 px box is 6.8 x 10.2 cm of ground.
    assert weed.size_m(1.7) == pytest.approx((0.068, 0.102))
    assert weed.centroid_m(1.7) == pytest.approx((0.204, 0.391))


def test_voc_path_field_is_exposed_for_tile_provenance(voc_file):
    """The only place a tile's grid position could survive a rename into species folders."""
    assert "r012_c034" in datasets.voc_source_path(voc_file)


def test_frame_coverage_is_ground_units(tmp_path):
    frame = datasets.Frame(image_path=tmp_path / "x.jpg", gsd_mm=1.7, width_px=1000, height_px=1000)
    assert frame.coverage_m == pytest.approx((1.7, 1.7))
    assert frame.min_coverage_m == pytest.approx(1.7)


def test_droneweed_tile_spans_too_few_rows_for_any_row_model():
    """The finding that decides where rows.py can run.

    1000 px at 0.17 cm/px is 1.70 m. At 75 cm rows that is 2.3 rows, which is
    below the floor for an angle estimate, never mind a pitch.
    """
    feasibility = datasets.spec_feasibility("droneweed", datasets.ROW_SPACING_75CM_M)
    assert feasibility.coverage_m == pytest.approx(1.70, abs=0.01)
    assert feasibility.rows_spanned == pytest.approx(2.27, abs=0.01)
    assert not feasibility.can_fit_angle
    assert not feasibility.can_fit_pitch


def test_usu_tile_spans_enough_for_an_angle_but_not_a_pitch():
    feasibility = datasets.spec_feasibility("usu-corn-weeddb", datasets.ROW_SPACING_75CM_M)
    assert feasibility.coverage_m == pytest.approx(3.07, abs=0.01)
    assert feasibility.rows_spanned == pytest.approx(4.1, abs=0.05)
    assert feasibility.can_fit_angle
    assert not feasibility.can_fit_pitch


def test_feasibility_states_the_coverage_a_pitch_would_need():
    """A verdict that says only 'no' is less useful than one that says how much short."""
    feasibility = datasets.row_fit_feasibility(1.7, 0.762)
    assert feasibility.coverage_needed_for_pitch_m == pytest.approx(7.62)
    assert "needs 7.6 m" in str(feasibility)


@pytest.mark.parametrize("key", sorted(datasets.SPECS))
def test_every_spec_records_its_provenance_and_licence(key):
    spec = datasets.SPECS[key]
    assert spec.source and spec.license and spec.url
    assert spec.gsd_mm > 0


def test_droneweed_is_not_auto_fetchable_and_says_why(tmp_path):
    """The host blocks automated download. Say so; never fall back to another dataset."""
    with pytest.raises(datasets.DatasetUnavailable) as exc:
        datasets.fetch("droneweed", root=tmp_path)
    message = str(exc.value)
    assert "browser" in message
    assert str(tmp_path) in message


def test_unknown_dataset_is_a_key_error(tmp_path):
    with pytest.raises(KeyError):
        datasets.fetch("not-a-dataset", root=tmp_path)


def test_missing_directory_reports_the_route_rather_than_an_empty_dataset(tmp_path):
    with pytest.raises(datasets.DatasetUnavailable):
        datasets.load_usu_corn_weeddb(root=tmp_path)


def test_coverage_summary_and_labels(tmp_path):
    frames = [
        datasets.Frame(
            image_path=tmp_path / f"{i}.jpg",
            gsd_mm=1.7,
            width_px=1000,
            height_px=1000,
            annotations=[datasets.Annotation("weed", 0, 0, 40, 60)],
        )
        for i in range(5)
    ]
    data = datasets.Dataset(name="t", spec=datasets.SPECS["droneweed"], frames=frames)
    summary = data.coverage_summary()
    assert summary["frames"] == 5
    assert summary["short_edge_m_median"] == pytest.approx(1.7)
    assert data.labels() == {"weed": 5}
    sizes = data.annotation_size_summary()
    assert sizes["max_extent_m_median"] == pytest.approx(0.102)


def test_pairing_ignores_images_without_annotations(tmp_path):
    (tmp_path / "a.jpg").write_bytes(b"")
    (tmp_path / "b.jpg").write_bytes(b"")
    (tmp_path / "a.xml").write_text(VOC_XML, encoding="utf-8")
    pairs = datasets._pair_images_with_annotations(tmp_path)
    assert [p[0].name for p in pairs] == ["a.jpg"]
