"""Test fixtures: a tiny synthetic PhenoBench tree written with the real file encodings.

The fixture uses instance ids above 255 so that any accidental 8-bit cast shows
up as a wrong id, and a semantic mask that contains every class 0..4.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

_SRC = Path(__file__).resolve().parents[1] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

H = W = 64


def _save16(path: Path, arr: np.ndarray) -> None:
    Image.fromarray(arr.astype(np.uint16)).save(path)  # mode I;16, as the dataset ships


def _save8(path: Path, arr: np.ndarray) -> None:
    Image.fromarray(arr.astype(np.uint8), mode="L").save(path)


def make_synthetic_sample():
    """Two crops, two weeds, one partial weed, one partial crop; plus leaves and visibility.

    Layout (x, y): crop A at (5..15, 5..15) id 300, crop B at (40..60, 5..20) id 301,
    weed C at (10..20, 40..50) id 65000, weed D at (45..50, 45..48) id 65001,
    partial weed E at (0..4, 56..63) id 700 touching the border,
    partial crop F at (30..34, 30..34) id 701.
    """
    sem = np.zeros((H, W), dtype=np.uint16)
    inst = np.zeros((H, W), dtype=np.uint16)
    leaf = np.zeros((H, W), dtype=np.uint16)
    pvis = np.zeros((H, W), dtype=np.uint8)
    lvis = np.zeros((H, W), dtype=np.uint8)

    def put(x0, y0, x1, y1, cls, iid, vis):
        sem[y0:y1, x0:x1] = cls
        inst[y0:y1, x0:x1] = iid
        pvis[y0:y1, x0:x1] = vis

    put(5, 5, 15, 15, 1, 300, 255)
    put(40, 5, 60, 20, 1, 301, 255)
    put(10, 40, 20, 50, 2, 65000, 255)
    put(45, 45, 50, 48, 2, 65001, 200)
    put(0, 56, 4, 64, 4, 700, 90)
    put(30, 30, 34, 34, 3, 701, 100)
    # Two leaves on weed C, one on each crop.
    leaf[40:45, 10:20] = 900
    leaf[45:50, 10:20] = 901
    leaf[5:15, 5:15] = 902
    leaf[5:20, 40:60] = 903
    lvis[leaf > 0] = 255
    rgb = np.full((H, W, 3), 120, dtype=np.uint8)
    rgb[sem > 0] = (40, 160, 60)
    return rgb, sem, inst, leaf, pvis, lvis


@pytest.fixture
def synthetic_root(tmp_path: Path) -> Path:
    """<tmp>/PhenoBench-v110/PhenoBench/{train,val,test}/... with two train and one val image."""
    root = tmp_path / "PhenoBench-v110" / "PhenoBench"
    rgb, sem, inst, leaf, pvis, lvis = make_synthetic_sample()
    for split, names in (("train", ["05-15_00001_P0000001.png", "06-05_00002_P0000002.png"]), ("val", ["05-26_00003_P0000003.png"])):
        for kind in ("images", "semantics", "plant_instances", "leaf_instances", "plant_visibility", "leaf_visibility"):
            (root / split / kind).mkdir(parents=True, exist_ok=True)
        for name in names:
            Image.fromarray(rgb, mode="RGB").save(root / split / "images" / name)
            _save16(root / split / "semantics" / name, sem)
            _save16(root / split / "plant_instances" / name, inst)
            _save16(root / split / "leaf_instances" / name, leaf)
            _save8(root / split / "plant_visibility" / name, pvis)
            _save8(root / split / "leaf_visibility" / name, lvis)
    (root / "test" / "images").mkdir(parents=True)
    Image.fromarray(rgb, mode="RGB").save(root / "test" / "images" / "05-15_00009_P0000009.png")
    return root
