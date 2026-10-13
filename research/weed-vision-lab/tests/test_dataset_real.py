"""Checks against the real dataset. Skipped unless run with `-m dataset` and the data is present."""

import pytest

from weedlab.config import DatasetNotFound, resolve_dataset_root
from weedlab.phenobench.reader import discover, load_sample, validate_sample

pytestmark = pytest.mark.dataset


@pytest.fixture(scope="module")
def root():
    try:
        return resolve_dataset_root()
    except DatasetNotFound as e:
        pytest.skip(str(e))


def test_official_counts(root):
    inv = discover(root)
    assert len(inv["train"].names) == 1407
    assert len(inv["val"].names) == 772
    assert len(inv["test"].names) == 693
    assert inv["train"].complete and inv["val"].complete


def test_first_image_of_each_split_validates(root):
    inv = discover(root)
    for split in ("train", "val"):
        s = load_sample(root, split, inv[split].names[0])
        assert s.semantics.dtype.itemsize == 2
        assert s.plant_instances.dtype.itemsize == 2
        assert [i for i in validate_sample(s) if i.severity == "error"] == []
