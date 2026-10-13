import math

import numpy as np
import pytest
from conftest import make_synthetic_sample

from weedlab.phenobench.context import ImageContext
from weedlab.phenobench.instances import extract_plant_instances


def _ctx():
    _, sem, inst, _, _, _ = make_synthetic_sample()
    plants = {p.instance_id: p for p in extract_plant_instances(sem, inst)}
    return ImageContext(sem, inst), plants


def test_distances_to_crop_and_other_plant():
    ctx, plants = _ctx()
    # weed C occupies x 10..19, y 40..49. Nearest crop-family plant is partial crop F
    # at x 30..33, y 30..33: from C's (19, 40) to F's (30, 33) is dx 11, dy 7.
    c = ctx.measure(65000, plants[65000].bbox)
    assert c.dist_to_crop_px == pytest.approx(math.hypot(11, 7))
    # Nearest plant of any kind is partial weed E at x 0..3, y 56..63: (10, 49) to (3, 56).
    assert c.dist_to_other_plant_px == pytest.approx(math.hypot(7, 7))
    assert c.nearest_other_kind == "weed"
    assert c.touching_ids == [] and c.touching_crop == 0 and c.touching_weed == 0
    assert not c.other_plant_capped


def test_ring_fractions_are_mostly_background():
    ctx, plants = _ctx()
    c = ctx.measure(65001, plants[65001].bbox)  # weed D at x 45..49, y 45..47
    assert c.ring_px == 32
    assert c.ring_background > 0.9
    assert c.ring_background + c.ring_crop + c.ring_weed == pytest.approx(1.0, abs=1e-6)
    assert c.ring_weed > 0  # weed C lies within 32 px of D (gap 25 cols)


def test_border_distance():
    ctx, plants = _ctx()
    e = ctx.measure(700, plants[700].bbox)  # x 0..3, y 56..63 touches left and bottom
    assert e.border_dist_px == 0
    c = ctx.measure(65000, plants[65000].bbox)
    assert c.border_dist_px == 10


def test_touching_is_detected():
    _, sem, inst, _, _, _ = make_synthetic_sample()
    sem = sem.copy()
    inst = inst.copy()
    sem[40:50, 20:25] = 2  # a second weed flush against C's right edge
    inst[40:50, 20:25] = 800
    ctx = ImageContext(sem, inst)
    c = ctx.measure(65000, (10, 40, 20, 50))
    assert c.touching_ids == [800]
    assert c.touching_weed == 1 and c.touching_crop == 0
    assert c.dist_to_other_plant_px == 1.0 and c.nearest_other_kind == "weed"


def test_capped_when_nothing_is_near():
    sem = np.zeros((600, 600), np.uint16)
    inst = np.zeros((600, 600), np.uint16)
    sem[300:310, 300:310] = 2
    inst[300:310, 300:310] = 5
    ctx = ImageContext(sem, inst)
    c = ctx.measure(5, (300, 300, 310, 310))
    assert c.dist_to_crop_px is None
    assert c.other_plant_capped and c.dist_to_other_plant_px == 128 and c.nearest_other_kind is None
    assert c.ring_background == 1.0
