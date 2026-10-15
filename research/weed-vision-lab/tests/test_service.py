"""Service tests: tiling plan and seams, instance records and coordinates, the HTTP API with synthetic images.

ERFNet itself is replaced by a tiny stand-in network in the API tests so they
run without the checkpoint; one test checks the missing-checkpoint path.
"""

import io
import json

import numpy as np
import pytest
import torch
from PIL import Image

from weedlab.service.algorithms import ALGORITHMS
from weedlab.service.app import MAX_PIXELS, create_app, decode_upload, parse_params
from weedlab.service.instances import extract_instances, polygons_of, rle_encode
from weedlab.service.tiling import infer_tiled, plan_tiles, ramp_weight, rescale_image


class GreenNet(torch.nn.Module):
    """Stand-in for ERFNet: weed where the (z-scored) green channel exceeds the others. Fully convolutional, any size."""

    def forward(self, x):
        g = x[:, 1:2]
        r = x[:, 0:1]
        b = x[:, 2:3]
        weed = (g - torch.maximum(r, b)) * 6.0
        bg = -weed
        crop = torch.full_like(weed, -8.0)
        return torch.cat([bg, crop, weed], dim=1)


def _scene(h, w, discs):
    rgb = np.full((h, w, 3), (150, 115, 80), np.uint8)
    yy, xx = np.mgrid[:h, :w]
    for cy, cx, r in discs:
        rgb[(yy - cy) ** 2 + (xx - cx) ** 2 <= r * r] = (60, 160, 50)
    return rgb


def _jpeg(rgb, fmt="PNG"):
    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, format=fmt)
    buf.seek(0)
    return buf


# ---------------- tiling ----------------

def test_plan_covers_image_and_aligns_last_tile():
    p = plan_tiles(2500, 3000, tile=1024, overlap=128)
    ys = sorted({y for y, _ in p.origins})
    xs = sorted({x for _, x in p.origins})
    assert ys[0] == 0 and ys[-1] == 2500 - 1024
    assert xs[0] == 0 and xs[-1] == 3000 - 1024
    assert all(y + 1024 <= 2500 for y in ys) and all(x + 1024 <= 3000 for x in xs)
    assert p.pad_bottom == 0 and p.pad_right == 0


def test_plan_pads_small_images():
    p = plan_tiles(500, 700, tile=1024, overlap=128)
    assert p.n_tiles == 1 and p.pad_bottom == 524 and p.pad_right == 324


def test_ramp_weight_sums_to_one_across_an_overlap():
    w = ramp_weight(64, 16)
    assert w[32, 32] == 1.0
    # two tiles overlapping by 16 px: weights of the same pixel from both tiles add to ~1
    left = w[32, 64 - 16:]
    right = w[32, :16]
    assert np.allclose(left + right, 1.0, atol=1e-6)


def test_blob_across_tile_boundary_is_one_instance():
    model = GreenNet().eval()
    rgb = _scene(300, 1200, [(150, 1024 - 64, 40)])  # straddles the first tile's right edge (tile 1024, overlap 128 -> seam band 896..1024)
    prob, plan, t = infer_tiled(model, rgb, tile=1024, overlap=128)
    assert plan.n_tiles == 2
    assert prob.shape == (3, 300, 1200)
    weed = np.argmax(prob, 0) == 2
    from scipy import ndimage

    _, n = ndimage.label(weed, structure=np.ones((3, 3), bool))
    assert n == 1
    assert abs(int(weed.sum()) - int(np.pi * 40 * 40)) < 0.1 * np.pi * 40 * 40


def test_tiled_equals_untiled_on_a_single_tile_image():
    model = GreenNet().eval()
    rgb = _scene(1024, 1024, [(200, 300, 30), (700, 800, 50)])
    prob, plan, _ = infer_tiled(model, rgb, tile=1024, overlap=128)
    from weedlab.detect.erfnet import preprocess

    with torch.no_grad():
        direct = torch.softmax(model(preprocess(rgb)), dim=1)[0].numpy()
    assert plan.n_tiles == 1
    assert np.allclose(prob, direct, atol=1e-5)


def test_rescale_image_shape():
    rgb = _scene(1000, 1500, [])
    assert rescale_image(rgb, 0.5).shape == (500, 750, 3)
    assert rescale_image(rgb, 1.0) is rgb


# ---------------- instances ----------------

def test_instances_in_original_coordinates_after_scaling():
    labels = np.zeros((100, 100), np.int32)
    labels[20:30, 40:60] = 1  # 10 x 20 block at processing scale
    inst, warns = extract_instances(labels, np.full((100, 100), 0.9, np.float32), scale=0.5)
    assert len(inst) == 1
    r = inst[0]
    assert r["area_px"] == pytest.approx(200 * 4)  # area scales by 1/s^2
    assert r["centroid_px"] == pytest.approx([(40 + 59) / 2 * 2, (20 + 29) / 2 * 2], abs=0.01)
    assert r["bbox_px"] == [80.0, 40.0, 120.0, 60.0]
    assert r["max_span_px"] == pytest.approx(np.hypot(19, 9) * 2, abs=0.05)
    assert r["score"] == 0.9 and not r["touches_border"] and not r["tiny"]
    assert all(78 <= x <= 122 and 38 <= y <= 62 for p in r["polygons_px"] for x, y in p)


def test_instance_ids_are_stable_and_flags_set():
    labels = np.zeros((50, 50), np.int32)
    labels[0:3, 0:3] = 1  # touches border, tiny
    labels[20:40, 20:40] = 2
    inst, warns = extract_instances(labels, None, scale=1.0)
    assert [r["id"] for r in inst] == [1, 2]
    assert inst[0]["touches_border"] and inst[0]["tiny"] and any("border" in f for f in inst[0]["flags"])
    assert any("under 25 px" in w for w in warns)


def test_rle_round_trip():
    m = np.zeros((4, 5), bool)
    m[1, 1:4] = True
    m[3, 0] = True
    runs = rle_encode(m)
    flat = np.zeros(20, np.int8)
    pos = 0
    val = 0
    for r in runs:
        flat[pos:pos + r] = val
        pos += r
        val ^= 1
    assert np.array_equal(flat.reshape(4, 5).astype(bool), m)


def test_polygon_encloses_mask():
    m = np.zeros((40, 40), bool)
    m[10:30, 5:25] = True
    polys = polygons_of(m, (5, 10, 25, 30), 0.8)
    assert len(polys) == 1
    xs = [x for x, _ in polys[0]]
    ys = [y for _, y in polys[0]]
    assert min(xs) >= 4 and max(xs) <= 25 and min(ys) >= 9 and max(ys) <= 30


# ---------------- API ----------------

@pytest.fixture
def client(tmp_path, monkeypatch):
    app = create_app(ckpt=str(tmp_path / "missing.ckpt"), threads=2)
    app.holder.model = GreenNet().eval()  # stand-in network, loaded
    app.holder.sha256 = "0" * 64
    app.config["TESTING"] = True
    return app.test_client()


def test_health_and_algorithms(client):
    r = client.get("/weed-vision/health")
    assert r.status_code == 200 and r.json["ok"] and r.json["research_only"]
    r = client.get("/weed-vision/algorithms")
    assert set(r.json["algorithms"]) == set(ALGORITHMS) and r.json["selected"] == "erfnet_erode1"


def test_detect_rejects_bad_inputs(client):
    assert client.post("/weed-vision/detect", data={}).status_code == 400
    r = client.post("/weed-vision/detect", data={"image": (io.BytesIO(b"not an image"), "x.jpg")}, content_type="multipart/form-data")
    assert r.status_code == 400 and "decodable" in r.json["error"]
    r = client.post("/weed-vision/detect", data={"image": (_jpeg(_scene(20, 20, [])), "s.png")}, content_type="multipart/form-data")
    assert r.status_code == 400 and "at least" in r.json["error"]
    r = client.post("/weed-vision/detect", data={"image": (_jpeg(_scene(100, 100, [])), "s.png"), "algorithm": "nope"}, content_type="multipart/form-data")
    assert r.status_code == 400 and "unknown algorithm" in r.json["error"]
    r = client.post("/weed-vision/detect", data={"image": (_jpeg(_scene(100, 100, [])), "s.png"), "scale": "3"}, content_type="multipart/form-data")
    assert r.status_code == 400


def test_detect_returns_schema_with_instances(client):
    rgb = _scene(300, 400, [(100, 100, 20), (200, 300, 30)])
    r = client.post("/weed-vision/detect", data={"image": (_jpeg(rgb), "scene.png"), "algorithm": "erfnet_erode1", "tile": "256", "overlap": "32"}, content_type="multipart/form-data")
    assert r.status_code == 200, r.json
    j = r.json
    assert j["schema_version"].startswith("weed-vision-preview-result") and j["research_only"]
    assert j["image"]["width"] == 400 and j["image"]["height"] == 300
    assert j["processing"]["tiles"] >= 1 and j["count"] == 2
    ids = [i["id"] for i in j["instances"]]
    assert ids == sorted(ids)
    big = max(j["instances"], key=lambda i: i["area_px"])
    assert abs(big["centroid_px"][0] - 300) < 1.5 and abs(big["centroid_px"][1] - 200) < 1.5
    assert 25 < big["max_span_px"] < 62 and big["polygons_px"]
    assert "total" in j["timings_ms"] and j["algorithm"]["name"] == "erfnet_erode1"
    assert j["measurement_note"].startswith("pixel units only")


def test_detect_colour_algorithm_needs_no_model(tmp_path):
    app = create_app(ckpt=str(tmp_path / "missing.ckpt"))
    c = app.test_client()
    rgb = _scene(200, 200, [(100, 100, 25)])
    r = c.post("/weed-vision/detect", data={"image": (_jpeg(rgb), "s.png"), "algorithm": "exg_fixed_0.08"}, content_type="multipart/form-data")
    assert r.status_code == 200 and r.json["count"] == 1 and r.json["model"] is None


def test_missing_checkpoint_is_a_503_not_a_crash(tmp_path):
    app = create_app(ckpt=str(tmp_path / "missing.ckpt"))
    c = app.test_client()
    r = c.post("/weed-vision/detect", data={"image": (_jpeg(_scene(100, 100, [])), "s.png"), "algorithm": "erfnet_erode1"}, content_type="multipart/form-data")
    assert r.status_code == 503 and "checkpoint" in r.json["error"]
    assert c.get("/weed-vision/health").json["model"]["loaded"] is False


def test_scale_maps_back_to_original_coordinates(client):
    rgb = _scene(400, 400, [(200, 120, 40)])
    r = client.post("/weed-vision/detect", data={"image": (_jpeg(rgb), "s.png"), "algorithm": "erfnet_argmax", "scale": "0.5", "tile": "256", "overlap": "32"}, content_type="multipart/form-data")
    assert r.status_code == 200 and r.json["count"] == 1
    i = r.json["instances"][0]
    assert r.json["processing"]["width"] == 200 and r.json["processing"]["scale"] == 0.5
    assert abs(i["centroid_px"][0] - 120) < 2 and abs(i["centroid_px"][1] - 200) < 2
    assert abs(i["area_px"] - np.pi * 40 * 40) < 0.15 * np.pi * 40 * 40
    assert any("processed at" in w for w in r.json["warnings"])


def test_async_job_lifecycle(client):
    rgb = _scene(300, 300, [(150, 150, 30)])
    r = client.post("/weed-vision/detect", data={"image": (_jpeg(rgb), "s.png"), "algorithm": "erfnet_erode1", "async": "1", "tile": "256", "overlap": "32"}, content_type="multipart/form-data")
    assert r.status_code == 202
    job = r.json["job_id"]
    import time

    for _ in range(200):
        s = client.get(f"/weed-vision/jobs/{job}")
        if s.json["state"] in ("done", "error"):
            break
        time.sleep(0.02)
    assert s.json["state"] == "done" and s.json["result"]["count"] == 1
    assert client.get(f"/weed-vision/jobs/{job}").status_code == 404


def test_evaluate_scores_against_reference(client):
    rgb = _scene(300, 300, [(100, 100, 25), (200, 220, 30)])
    ref = np.zeros((300, 300), np.uint16)
    yy, xx = np.mgrid[:300, :300]
    ref[(yy - 100) ** 2 + (xx - 100) ** 2 <= 25 * 25] = 7
    ref[(yy - 60) ** 2 + (xx - 250) ** 2 <= 10 * 10] = 9  # a reference weed the scene does not contain
    rb = io.BytesIO()
    Image.fromarray(ref).save(rb, format="PNG")
    rb.seek(0)
    r = client.post("/weed-vision/evaluate", data={"image": (_jpeg(rgb), "s.png"), "reference": (rb, "ref.png"), "algorithm": "erfnet_erode1", "tile": "256", "overlap": "32"}, content_type="multipart/form-data")
    assert r.status_code == 200, r.json
    ev = r.json["evaluation"]
    assert ev["reference_instances"] == 2 and ev["predicted_instances"] == 2
    assert ev["detection"]["iou_0.5"]["tp"] == 1 and ev["detection"]["iou_0.5"]["fp"] == 1 and ev["detection"]["iou_0.5"]["fn"] == 1
    assert ev["regions_px"]["missed"] and ev["regions_px"]["false_positive"]


def test_parse_params_and_limits():
    class F(dict):
        pass

    p = parse_params(F(algorithm="selected"))
    assert p["algorithm"] == "selected" and p["tile"] == 1024 and p["overlap"] == 128 and p["scale"] == 1.0
    with pytest.raises(ValueError):
        parse_params(F(tile="100"))
    assert MAX_PIXELS >= 50_000_000  # a 50 MP Air 3S frame must be accepted
