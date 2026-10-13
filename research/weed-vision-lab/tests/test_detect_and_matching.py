import numpy as np
import pytest
from conftest import make_synthetic_sample

from weedlab.detect.classical import METHODS, detect, hsv, index_exg_exr
from weedlab.eval.matching import IOU_THRESHOLDS, score_image
from weedlab.phenobench.instances import extract_plant_instances


def _scene():
    """Soil-coloured image with green blobs exactly on the synthetic plant masks."""
    rgb, sem, inst, leaf, pvis, lvis = make_synthetic_sample()
    img = np.zeros_like(rgb)
    img[...] = (150, 115, 80)  # brown soil
    img[sem > 0] = (70, 150, 50)  # green plants
    return img, sem, inst


def test_indices_separate_green_from_brown():
    img, sem, _ = _scene()
    idx = index_exg_exr(img)
    assert (idx[sem > 0] > 0).all()
    assert (idx[sem == 0] < 0).all()
    h, s, v = hsv(img)
    assert 60 <= h[sem > 0].mean() <= 160
    assert h[sem == 0].mean() < 60


@pytest.mark.parametrize("method", METHODS)
def test_detect_finds_every_blob_without_annotations(method):
    img, sem, inst = _scene()
    res = detect(img, method=method)
    assert res.n == 6  # six plants, none touching
    assert set(res.timings_ms) >= {"index_and_threshold", "components", "measure", "total"}
    assert all(r["area_px"] > 0 for r in res.records)
    assert res.labels.dtype == np.int32


def test_detect_on_black_image_gives_nothing():
    res = detect(np.zeros((32, 32, 3), np.uint8), method="exg_exr")
    assert res.n == 0 and res.records == []


def test_perfect_prediction_scores_perfectly():
    img, sem, inst = _scene()
    plants = extract_plant_instances(sem, inst)
    res = detect(img, "exg_exr")
    lookup = {p.instance_id: {"category": "A", "exclusion": None, "size_band": "small"} for p in plants}
    sc = score_image(res.labels, res.n, res.records, sem, inst, plants, lookup, "x.png")
    assert len(sc.references) == 3  # three weeds (two full, one partial)
    for r in sc.references:
        assert r["found"] and r["matched@0.5"] and r["iou@0.5"] == 1.0
        assert r["merged_with_weed"] == 0 and r["merged_with_crop"] == 0 and not r["split"]
    # Crop blobs are detections that match nothing: false positives of kind crop.
    fps = [d for d in sc.detections if not d["matched@0.5"]]
    assert len(fps) == 3 and all(d["fp_kind@0.5"] == "crop" for d in fps)
    assert sc.image["tp@0.5"] == 3 and sc.image["fp@0.5"] == 3 and sc.image["fn@0.5"] == 0
    assert sc.image["veg_iou_plants"] == 1.0


def test_merge_and_split_are_detected():
    img, sem, inst = _scene()
    plants = extract_plant_instances(sem, inst)
    lookup = {}
    # One prediction covering weed C (65000) and crop A (300) entirely: a merge with a crop.
    labels = np.zeros(sem.shape, np.int32)
    labels[(inst == 65000) | (inst == 300)] = 1
    labels[5:40, 10:15] = 1  # a bridge between them
    # Weed D (65001, x 45..49, y 45..47) split into two halves.
    labels[45:48, 45:47] = 2
    labels[45:48, 47:50] = 3
    recs = [{"det_id": k, "score": 0.0} for k in (1, 2, 3)]
    sc = score_image(labels, 3, recs, sem, inst, plants, lookup, "x.png")
    by = {r["instance_id"]: r for r in sc.references}
    assert by[65000]["found"] and by[65000]["merged_with_crop"] == 1 and by[65000]["merged_with_weed"] == 0
    assert by[65000]["matched@0.5"] is False  # IoU dragged down by the crop and the bridge
    assert by[65000]["matched@0.1"] is True
    assert by[65001]["split"] and by[65001]["n_split"] == 2
    assert by[65001]["matched@0.5"]  # the larger half (9 of 15 px) still reaches IoU 0.6
    assert not by[700]["found"]  # nothing predicted there
    assert sc.image["fn@0.5"] == 2


def test_thresholds_are_fixed():
    assert IOU_THRESHOLDS == (0.5, 0.3, 0.1)
