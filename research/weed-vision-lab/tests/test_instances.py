import numpy as np
from conftest import make_synthetic_sample

from weedlab.phenobench.instances import (
    crop_instances,
    extract_plant_instances,
    weed_instances,
    weed_only_mask,
)


def _instances(include_partial=True):
    _, sem, inst, leaf, pvis, _ = make_synthetic_sample()
    return extract_plant_instances(sem, inst, pvis, leaf, include_partial=include_partial), inst


def test_weed_and_crop_are_told_apart_by_the_semantic_mask():
    inst, _ = _instances()
    by_id = {p.instance_id: p for p in inst}
    assert by_id[300].kind == "crop" and by_id[301].kind == "crop"
    assert by_id[65000].kind == "weed" and by_id[65001].kind == "weed"
    assert by_id[700].kind == "weed" and by_id[700].partial
    assert by_id[701].kind == "crop" and by_id[701].partial
    assert not any(p.mixed for p in inst)
    assert len(weed_instances(inst)) == 3 and len(crop_instances(inst)) == 3
    assert len(weed_instances(inst, include_partial=False)) == 2


def test_geometry_of_an_instance():
    inst, _ = _instances()
    c = {p.instance_id: p for p in inst}[65000]
    assert c.area_px == 100
    assert c.bbox == (10, 40, 20, 50)
    assert c.bbox_wh == (10, 10)
    assert c.centroid == (14.5, 44.5)
    assert c.n_leaves == 2
    assert c.visibility_mean == 255.0
    assert not c.touches_border
    assert c.pixels_by_class == {"background": 0, "crop": 0, "weed": 100, "partial_crop": 0, "partial_weed": 0}


def test_border_and_partial_flags():
    inst, _ = _instances()
    e = {p.instance_id: p for p in inst}[700]
    assert e.touches_border and e.partial and e.kind == "weed"
    assert e.visibility_mean == 90.0


def test_exclude_partial_drops_them():
    inst, _ = _instances(include_partial=False)
    assert sorted(p.instance_id for p in inst) == [300, 301, 65000, 65001]


def test_mixed_family_instance_is_flagged_not_hidden():
    _, sem, inst, _, _, _ = make_synthetic_sample()
    sem = sem.copy()
    sem[40:42, 10:20] = 1  # two rows of weed C relabelled crop
    out = {p.instance_id: p for p in extract_plant_instances(sem, inst)}
    assert out[65000].mixed
    assert out[65000].kind == "weed"  # 80 weed px vs 20 crop px
    assert out[65000].pixels_by_class["crop"] == 20


def test_weed_only_mask_keeps_original_ids():
    inst, raw = _instances()
    m = weed_only_mask(raw, inst)
    assert m.dtype == np.uint16
    assert set(np.unique(m).tolist()) == {0, 700, 65000, 65001}
    assert np.count_nonzero(m == 65000) == 100


def test_empty_masks_give_no_instances():
    sem = np.zeros((8, 8), dtype=np.uint16)
    inst = np.zeros((8, 8), dtype=np.uint16)
    assert extract_plant_instances(sem, inst) == []
