from pathlib import Path

import numpy as np
from conftest import make_synthetic_sample

from weedlab.phenobench.instances import extract_plant_instances
from weedlab.phenobench.reader import load_sample
from weedlab.viz.panels import contact_sheet, instance_rgb, overlay_image, render_sample_panels, semantic_rgb


def test_semantic_colours_cover_every_class():
    _, sem, *_ = make_synthetic_sample()
    rgb = semantic_rgb(sem)
    assert rgb.shape == (64, 64, 3)
    assert len({tuple(c) for c in rgb.reshape(-1, 3).tolist()}) == 5


def test_instance_colours_are_stable_and_distinct():
    _, _, inst, *_ = make_synthetic_sample()
    a = instance_rgb(inst)
    b = instance_rgb(inst)
    assert np.array_equal(a, b)
    colours = {tuple(a[y, x].tolist()) for y, x in [(10, 10), (10, 50), (45, 15), (46, 47), (60, 2), (32, 32)]}
    assert len(colours) == 6


def test_panels_and_contact_sheet_render(synthetic_root: Path, tmp_path: Path):
    s = load_sample(synthetic_root, "train", "05-15_00001_P0000001.png")
    inst = extract_plant_instances(s.semantics, s.plant_instances, s.plant_visibility, s.leaf_instances)
    out = tmp_path / "p.png"
    render_sample_panels(s, inst, out, dpi=40)
    assert out.exists() and out.stat().st_size > 1000
    ov = overlay_image(s, inst)
    assert ov.shape == (64, 64, 3)
    sheet = tmp_path / "sheet.png"
    contact_sheet([("row", [s.image, semantic_rgb(s.semantics), ov])], sheet, cell=64, header=["a", "b", "c"])
    assert sheet.exists()
