from pathlib import Path

import numpy as np
import pytest
from conftest import make_synthetic_sample

from weedlab.config import DatasetNotFound, find_dataset_root, resolve_dataset_root
from weedlab.phenobench.reader import (
    discover,
    inventory_split,
    load_sample,
    parse_image_name,
    read_annotation,
    validate_sample,
)


def test_root_is_found_through_the_archive_nesting(synthetic_root: Path):
    assert find_dataset_root(synthetic_root) == synthetic_root
    assert find_dataset_root(synthetic_root.parent) == synthetic_root
    assert find_dataset_root(synthetic_root.parent.parent) is None  # two levels up: not guessed


def test_missing_root_raises_with_setup_instructions(tmp_path: Path, monkeypatch):
    import weedlab.config as cfg

    monkeypatch.delenv("WEEDLAB_PHENOBENCH_ROOT", raising=False)
    monkeypatch.setattr(cfg, "LOCAL_CONFIG", tmp_path / "no-local.json")  # ignore this machine's config
    with pytest.raises(DatasetNotFound) as e:
        resolve_dataset_root(tmp_path / "nowhere")
    assert "train/images" in str(e.value)
    assert "nowhere" in str(e.value)


def test_parse_image_name():
    m = parse_image_name("05-15_00028_P0030852.png")
    assert m.date == "2020-05-15"
    assert m.month_day == "05-15"
    assert m.frame == 28
    assert m.plot == "P0030852"
    assert m.stem == "05-15_00028_P0030852"
    with pytest.raises(ValueError):
        parse_image_name("weird.png")


def test_inventory_counts_and_detects_missing(synthetic_root: Path):
    inv = discover(synthetic_root)
    assert [len(inv[s].names) for s in ("train", "val", "test")] == [2, 1, 1]
    assert inv["train"].complete and inv["val"].complete and inv["test"].complete
    (synthetic_root / "train" / "leaf_visibility" / "05-15_00001_P0000001.png").unlink()
    inv2 = inventory_split(synthetic_root, "train")
    assert not inv2.complete
    assert inv2.missing["leaf_visibility"] == ["05-15_00001_P0000001.png"]


def test_sixteen_bit_ids_survive_loading(synthetic_root: Path):
    arr = read_annotation(synthetic_root / "train" / "plant_instances" / "05-15_00001_P0000001.png")
    assert arr.dtype == np.uint16
    assert set(np.unique(arr).tolist()) == {0, 300, 301, 700, 701, 65000, 65001}


def test_load_sample_keeps_dtypes_and_values(synthetic_root: Path):
    s = load_sample(synthetic_root, "train", "05-15_00001_P0000001.png")
    _, sem, inst, leaf, pvis, lvis = make_synthetic_sample()
    assert s.image.dtype == np.uint8 and s.image.shape == (64, 64, 3)
    assert np.array_equal(s.semantics, sem) and s.semantics.dtype == np.uint16
    assert np.array_equal(s.plant_instances, inst)
    assert np.array_equal(s.leaf_instances, leaf)
    assert np.array_equal(s.plant_visibility, pvis) and s.plant_visibility.dtype == np.uint8
    assert np.array_equal(s.leaf_visibility, lvis)
    assert set(np.unique(s.semantics).tolist()) == {0, 1, 2, 3, 4}


def test_validate_passes_on_consistent_sample(synthetic_root: Path):
    s = load_sample(synthetic_root, "train", "05-15_00001_P0000001.png")
    issues = validate_sample(s)
    # 64x64 is not the dataset's 1024x1024; that is the only expected remark.
    assert [i.severity for i in issues] == ["warning"]
    assert "expected (1024, 1024)" in issues[0].message


def test_validate_flags_shape_mismatch_and_bad_class(synthetic_root: Path):
    s = load_sample(synthetic_root, "train", "05-15_00001_P0000001.png")
    s.leaf_instances = s.leaf_instances[:32, :32]
    s.semantics = s.semantics.copy()
    s.semantics[0, 0] = 7
    msgs = [i.message for i in validate_sample(s) if i.severity == "error"]
    assert any("leaf_instances shape" in m for m in msgs)
    assert any("outside 0..4" in m and "[7]" in m for m in msgs)


def test_validate_warns_on_instance_without_class(synthetic_root: Path):
    s = load_sample(synthetic_root, "train", "05-15_00001_P0000001.png")
    s.plant_instances = s.plant_instances.copy()
    s.plant_instances[0, 10] = 5  # an id on a background pixel
    msgs = [i.message for i in validate_sample(s) if i.severity == "warning"]
    assert any("background pixels carry a plant instance id" in m for m in msgs)


def test_test_split_loads_image_only(synthetic_root: Path):
    s = load_sample(synthetic_root, "test", "05-15_00009_P0000009.png")
    assert s.semantics is None and s.plant_instances is None
