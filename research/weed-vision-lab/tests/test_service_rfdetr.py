"""RF-DETR as a service algorithm: fusion across tiles, rasterisation, the API fields, with a stand-in model."""

import io

import numpy as np
import pytest
from PIL import Image

from weedlab.service.app import create_app, parse_params
from weedlab.service.rfdetr import fuse, rasterize, run_rfdetr, RFDetrHolder


class _Det:
    def __init__(self, masks, class_ids, scores):
        self.mask = np.asarray(masks, bool)
        self.class_id = np.asarray(class_ids, int)
        self.confidence = np.asarray(scores, float)

    def __len__(self):
        return len(self.class_id)


class GreenDiscSegmenter:
    """Stand-in for RFDETRSegLarge.predict: one mask per green blob (8-connected), small blobs are weeds, big ones crops."""

    class model_config:  # noqa: N801
        resolution = 504

    def __init__(self, big_px: int = 1500):
        self.big_px = big_px
        self.calls = 0

    def predict(self, pil: Image.Image, threshold: float = 0.5):
        from scipy import ndimage

        self.calls += 1
        rgb = np.asarray(pil.convert("RGB"), np.int32)
        green = (rgb[..., 1] - np.maximum(rgb[..., 0], rgb[..., 2])) > 20
        lab, n = ndimage.label(green, structure=np.ones((3, 3), bool))
        masks, cls, sc = [], [], []
        for k in range(1, n + 1):
            m = lab == k
            masks.append(m)
            cls.append(0 if m.sum() >= self.big_px else 1)
            sc.append(0.9 if m.sum() >= self.big_px else 0.7)
        if not masks:
            return _Det(np.zeros((0,) + green.shape, bool), [], [])
        return _Det(np.stack(masks), cls, sc)


def _scene(h, w, discs):
    rgb = np.full((h, w, 3), (150, 115, 80), np.uint8)
    yy, xx = np.mgrid[:h, :w]
    for cy, cx, r in discs:
        rgb[(yy - cy) ** 2 + (xx - cx) ** 2 <= r * r] = (60, 160, 50)
    return rgb


def _png(rgb):
    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, format="PNG")
    buf.seek(0)
    return buf


def _pred(cls, score, full_mask, tile=(0, 0)):
    ys, xs = np.nonzero(full_mask)
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    return {"class": cls, "score": score, "mask": full_mask[y0:y1, x0:x1].copy(), "bbox": [x0, y0, x1, y1], "fused": 0, "tiles": {tile}}


def _disc(h, w, cy, cx, r):
    yy, xx = np.mgrid[:h, :w]
    return (yy - cy) ** 2 + (xx - cx) ** 2 <= r * r


# ---------------- fusion ----------------

def test_duplicates_across_tiles_fuse_and_same_tile_never_fuses():
    m = _disc(100, 100, 50, 50, 15)
    a = _pred(1, 0.9, m, tile=(0, 0))
    b = _pred(1, 0.8, m, tile=(0, 64))  # the same weed seen from the neighbouring tile
    c = _pred(0, 0.95, m, tile=(0, 64))  # a crop at the same place: never merged with a weed
    d = _pred(1, 0.85, m, tile=(0, 0))  # same tile: two predictions of one tile are two instances, whatever their overlap
    out = fuse([a, b, c, d])
    weeds = [p for p in out if p["class"] == 1]
    assert len(out) == 3 and len(weeds) == 2 and max(p["fused"] for p in weeds) == 1
    assert any(p["class"] == 0 for p in out)


def test_seam_fragments_of_one_plant_are_stitched():
    # A disc of radius 30 centred on x = 100; tile A sees x < 112 (its edge plus overlap), tile B sees x >= 88.
    full = _disc(200, 200, 100, 100, 30)
    left = full.copy(); left[:, 112:] = False
    right = full.copy(); right[:, :88] = False
    a = _pred(1, 0.8, left, tile=(0, 0))
    b = _pred(1, 0.7, right, tile=(0, 64))
    out = fuse([a, b])
    assert len(out) == 1
    merged = out[0]
    assert merged["fused"] == 1 and merged["bbox"] == [70, 70, 131, 131]
    assert merged["mask"].sum() == full.sum()  # the union is the whole plant


def test_distinct_neighbours_from_different_tiles_stay_separate():
    a = _pred(1, 0.8, _disc(200, 200, 100, 80, 15), tile=(0, 0))
    b = _pred(1, 0.8, _disc(200, 200, 100, 118, 15), tile=(0, 64))  # touching but barely overlapping discs
    assert len(fuse([a, b])) == 2


# ---------------- rasterisation ----------------

def test_rasterize_keeps_higher_score_on_overlap_and_orders_labels_by_score():
    a = _pred(1, 0.6, _disc(60, 60, 30, 30, 10))
    b = _pred(1, 0.9, _disc(60, 60, 30, 36, 10))
    labels, score, sel = rasterize([a, b], 1, (60, 60))
    assert sel[0] is b and labels[30, 36] == 1 and labels[30, 24] == 2
    assert score[30, 36] == pytest.approx(0.9) and score[30, 24] == pytest.approx(0.6)
    assert labels.max() == 2


# ---------------- run_rfdetr ----------------

def _holder(model):
    h = RFDetrHolder("D:/nowhere/checkpoint.pth")
    h.model = model
    h.resolution = 504
    h.device = "fake"
    return h


def test_run_rfdetr_returns_weeds_and_crops_in_original_pixels_at_half_scale():
    rgb = _scene(400, 600, [(100, 100, 12), (300, 450, 40)])  # a small weed and a big crop
    small = rgb[::2, ::2]  # processing scale 0.5
    out = run_rfdetr(small, _holder(GreenDiscSegmenter(big_px=800)), tile=256, overlap=32, threshold=0.5, scale=0.5, tolerance=0.8, include_rle=False)
    assert len(out["instances"]) == 1 and len(out["crop_instances"]) == 1
    weed, crop = out["instances"][0], out["crop_instances"][0]
    assert weed["class"] == "weed" and crop["class"] == "crop"
    assert abs(weed["centroid_px"][0] - 100) < 3 and abs(weed["centroid_px"][1] - 100) < 3  # back in original pixels
    assert abs(crop["centroid_px"][0] - 450) < 3 and abs(crop["centroid_px"][1] - 300) < 3
    assert weed["score"] == pytest.approx(0.7) and crop["score"] == pytest.approx(0.9) and weed["score_kind"] == "detector_confidence"
    assert out["crop_regions_px"] and out["info"]["tiles"] >= 1 and out["info"]["threshold"] == 0.5
    assert out["labels"].shape == small.shape[:2]


# ---------------- API ----------------

@pytest.fixture
def client(tmp_path):
    app = create_app(ckpt=str(tmp_path / "missing-erfnet.ckpt"), threads=2, rfdetr_ckpt=str(tmp_path / "missing-rfdetr.pth"))
    app.holders["rfdetr"].model = GreenDiscSegmenter(big_px=1500)
    app.holders["rfdetr"].sha256 = "1" * 64
    app.holders["rfdetr"].resolution = 504
    app.holders["rfdetr"].device = "fake"
    app.config["TESTING"] = True
    return app.test_client()


def test_health_lists_both_models_and_registry_has_rfdetr(client):
    h = client.get("/weed-vision/health").json
    assert set(h["models"]) == {"erfnet", "rfdetr"} and h["models"]["rfdetr"]["loaded"] and not h["models"]["erfnet"]["loaded"]
    assert h["defaults"]["threshold"] == 0.5
    a = client.get("/weed-vision/algorithms").json["algorithms"]
    assert a["rfdetr_seg_large"]["family"] == "rfdetr" and a["rfdetr_seg_large"]["model"] == "rfdetr" and a["erfnet_erode1"]["model"] == "erfnet"


def test_detect_with_rfdetr_returns_classes_scores_and_crop_instances(client):
    rgb = _scene(300, 400, [(100, 100, 12), (200, 300, 30)])
    r = client.post("/weed-vision/detect", data={"image": (_png(rgb), "scene.png"), "algorithm": "rfdetr_seg_large", "tile": "256", "overlap": "32", "threshold": "0.4"}, content_type="multipart/form-data")
    assert r.status_code == 200, r.json
    j = r.json
    assert j["classes"] == ["crop", "weed"] and j["count"] == 1 and j["instances"][0]["class"] == "weed" and j["instances"][0]["score"] == pytest.approx(0.7)
    assert len(j["crop_instances"]) == 1 and j["crop_instances"][0]["class"] == "crop" and j["crop_regions_px"]
    assert j["processing"]["threshold"] == 0.4 and j["processing"]["model_resolution"] == 504 and j["model"]["architecture"].startswith("RFDETRSegLarge")
    assert "inference_forward" in j["timings_ms"] and j["algorithm"]["name"] == "rfdetr_seg_large"


def test_rfdetr_job_lifecycle_and_erfnet_still_503_without_checkpoint(client):
    rgb = _scene(300, 300, [(150, 150, 12)])
    r = client.post("/weed-vision/detect", data={"image": (_png(rgb), "s.png"), "algorithm": "rfdetr_seg_large", "tile": "256", "overlap": "32", "async": "1"}, content_type="multipart/form-data")
    assert r.status_code == 202
    job = r.json["job_id"]
    import time

    for _ in range(500):
        s = client.get(f"/weed-vision/jobs/{job}")
        if s.json["state"] in ("done", "error"):
            break
        time.sleep(0.02)
    assert s.json["state"] == "done" and s.json["result"]["count"] == 1
    r = client.post("/weed-vision/detect", data={"image": (_png(rgb), "s.png"), "algorithm": "erfnet_erode1"}, content_type="multipart/form-data")
    assert r.status_code == 503 and "erfnet checkpoint unavailable" in r.json["error"] and "models" in r.json


def test_threshold_param_validated():
    class F(dict):
        pass

    assert parse_params({"algorithm": "rfdetr_seg_large"})["threshold"] == 0.5
    assert parse_params({"algorithm": "erfnet_erode1", "threshold": "0.3"})["threshold"] == 0.3
    with pytest.raises(ValueError):
        parse_params({"algorithm": "rfdetr_seg_large", "threshold": "1.5"})
