import numpy as np
import pytest

from weedlab.detect.classical import detect, hysteresis_mask


def test_hysteresis_keeps_only_seeded_components():
    idx = np.zeros((10, 10), np.float32)
    idx[1:4, 1:4] = 0.05  # above low, no seed: dropped
    idx[6:9, 6:9] = 0.05  # above low
    idx[7, 7] = 0.2  # one seed: whole component kept
    m = hysteresis_mask(idx, high=0.10, low=0.03)
    assert m[7, 7] and m[6, 6] and m[8, 8]
    assert not m[2, 2]
    assert m.sum() == 9


def test_hysteresis_detect_grows_pale_margins():
    rgb = np.full((40, 40, 3), (150, 115, 80), np.uint8)
    rgb[10:20, 10:20] = (125, 130, 110)  # pale green: ExG about 0.07, above 0.03 and below 0.10
    rgb[14:16, 14:16] = (60, 160, 50)  # strong green core
    fixed = detect(rgb, method="exg_fixed", exg_t=0.10)
    hyst = detect(rgb, method="exg_hyst", hyst=(0.10, 0.03))
    assert fixed.n == 1 and hyst.n == 1
    assert hyst.records[0]["area_px"] > fixed.records[0]["area_px"]
    assert hyst.records[0]["area_px"] == 100


def test_erfnet_model_shapes_without_checkpoint():
    torch = pytest.importorskip("torch")
    from weedlab.detect.erfnet import ERFNetModel, preprocess

    model = ERFNetModel(num_classes=3).eval()
    x = preprocess(np.random.default_rng(0).integers(0, 255, (64, 64, 3), dtype=np.uint8))
    assert x.shape == (1, 3, 64, 64)
    assert abs(float(x[0, 0].mean())) < 1e-4 and abs(float(x[0, 0].std()) - 1.0) < 1e-3
    with torch.no_grad():
        y = model(x)
    assert y.shape == (1, 3, 64, 64)
    assert sum(p.numel() for p in model.parameters()) > 2_000_000
