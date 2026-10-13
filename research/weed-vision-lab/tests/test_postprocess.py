import numpy as np
import pytest

from weedlab.eval.quality import mask_quality
from weedlab.postprocess.cache import argmax_from, load_prob, quantise, save_prob
from weedlab.postprocess.pipeline import CONFIGS, run_config
from weedlab.postprocess.refine import grow, refine_exg_hyst, refine_prob, seed_and_argmax
from weedlab.postprocess.separate import separate


def _disc(h, w, cy, cx, r):
    yy, xx = np.mgrid[:h, :w]
    return (yy - cy) ** 2 + (xx - cx) ** 2 <= r * r


def _prob_from_mask(weed, crop=None):
    h, w = weed.shape
    p = np.zeros((3, h, w), np.float32)
    p[2][weed] = 0.9
    if crop is not None:
        p[1][crop] = 0.9
    p[0] = 1.0 - p[1] - p[2]
    return p


def test_cache_round_trip(tmp_path):
    p = np.random.default_rng(0).random((3, 8, 8)).astype(np.float32)
    p /= p.sum(0, keepdims=True)
    save_prob(tmp_path / "x.png", p)
    q = load_prob(tmp_path / "x.png")
    assert q.shape == (3, 8, 8) and np.abs(q - p).max() <= 0.5 / 255 + 1e-6
    assert (argmax_from(q) == np.argmax(p, 0)).mean() > 0.9


def test_quality_identical_and_shifted():
    r = _disc(40, 40, 20, 20, 8)
    q = mask_quality(r, r)
    assert q["iou"] == 1.0 and q["dice"] == 1.0 and q["boundary_f1"] == 1.0 and q["fp_px"] == 0 and q["fn_px"] == 0
    p = _disc(40, 40, 20, 23, 8)  # shifted 3 px: boundary within 2 px only partly
    q2 = mask_quality(p, r)
    assert 0.5 < q2["iou"] < 1.0 and 0 < q2["boundary_f1"] < 1.0 and q2["fp_px"] == q2["fn_px"] > 0


def test_grow_respects_radius_and_crop():
    seed = np.zeros((30, 30), bool)
    seed[10:15, 10:15] = True
    admit = np.ones((30, 30), bool)
    crop = np.zeros((30, 30), bool)
    crop[10:15, 20:30] = True
    g = grow(seed, admit, crop, radius=3)
    assert g[12, 17] and not g[12, 19]  # within 3 px yes, 4 px no
    assert not g[12, 21]  # crop never admitted
    assert g[10:15, 10:15].all()  # seed never removed


def test_refiners_only_add_pixels():
    rgb = np.full((40, 40, 3), (150, 115, 80), np.uint8)
    weed = _disc(40, 40, 20, 20, 6)
    rgb[_disc(40, 40, 20, 20, 9)] = (110, 135, 95)  # pale green halo around a strong core
    rgb[weed] = (60, 160, 50)
    prob = _prob_from_mask(weed)
    seed, _ = seed_and_argmax(prob)
    for fn, kw in ((refine_exg_hyst, {"low": 0.03, "radius": 8}), (refine_prob, {"t_low": 0.2, "radius": 8})):
        m = fn(rgb, prob, **kw)
        assert (m | seed).sum() == m.sum()  # superset of the seed
    assert refine_exg_hyst(rgb, prob, low=0.03, radius=8).sum() > seed.sum()


def test_separation_splits_touching_discs_but_not_one_disc():
    one = _disc(60, 60, 30, 30, 12)
    two = _disc(60, 60, 30, 20, 10) | _disc(60, 60, 30, 38, 10)  # overlapping: one component with a waist
    labc, _ = separate(two, "cc")
    assert labc.max() == 1
    lab1, st1 = separate(one, "adaptive", max_solidity=0.95)
    lab2, st2 = separate(two, "adaptive", max_solidity=0.95)
    assert lab1.max() == 1 and st1["n_split"] == 0  # one disc has one distance peak
    assert lab2.max() == 2 and st2["n_split"] == 1
    labw, _ = separate(two, "watershed")
    assert labw.max() == 2


def test_run_config_all_names_execute():
    rgb = np.full((48, 48, 3), (150, 115, 80), np.uint8)
    weed = _disc(48, 48, 24, 16, 7) | _disc(48, 48, 24, 32, 7)
    rgb[weed] = (60, 160, 50)
    prob = _prob_from_mask(weed)
    for name in CONFIGS:
        res, st = run_config(name, rgb, prob)
        assert res.labels.shape == (48, 48) and res.n >= 1 and "total" in res.timings_ms
