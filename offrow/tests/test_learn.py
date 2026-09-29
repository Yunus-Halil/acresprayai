"""The learning track's foundations: the store, the splits, the chips, the contract.

Everything here runs without torch except the last block, which skips when the
learn extra is not installed and is marked slow because it trains.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import numpy as np
import pytest

from offrow import synth as synth_mod
from offrow.learn import examples as ex
from offrow.learn import sources

# ---------------------------------------------------------------------------
# Splits
# ---------------------------------------------------------------------------


def test_split_is_a_pure_function_of_the_group():
    assert ex.split_for("usu:frame 12") == ex.split_for("usu:frame 12")
    assert (
        ex.split_for("usu:frame 12", seed="another") != ex.split_for("usu:frame 12") or True
    )  # may collide; the point is determinism


def test_splits_land_near_their_fractions_over_many_groups():
    counts = Counter(ex.split_for(f"group-{i}") for i in range(5000))
    assert abs(counts["test"] / 5000 - ex.TEST_FRACTION) < 0.02
    assert abs(counts["val"] / 5000 - ex.VAL_FRACTION) < 0.02


def test_two_chips_from_one_group_share_a_split():
    a = ex.Example(
        id="a",
        source="s",
        source_ref="r",
        chip="chips/a.png",
        gsd_m=0.005,
        span_m=0.5,
        label="weed",
        label_basis="synthetic truth",
        group="g",
        split=ex.split_for("g"),
    )
    b = ex.Example(
        id="b",
        source="s",
        source_ref="r",
        chip="chips/b.png",
        gsd_m=0.005,
        span_m=0.5,
        label="crop",
        label_basis="synthetic truth",
        group="g",
        split=ex.split_for("g"),
    )
    assert a.split == b.split


# ---------------------------------------------------------------------------
# The example record
# ---------------------------------------------------------------------------


def test_example_refuses_an_unknown_label_or_a_missing_gsd():
    kw = dict(
        id="a",
        source="s",
        source_ref="r",
        chip="c.png",
        span_m=0.5,
        label_basis="x",
        group="g",
        split="train",
    )
    with pytest.raises(ValueError):
        ex.Example(gsd_m=0.005, label="maybe", **kw)
    with pytest.raises(ValueError):
        ex.Example(gsd_m=0.0, label="weed", **kw)


def test_manifest_round_trips(tmp_path: Path):
    m = ex.Manifest(tmp_path)
    m.add(
        ex.Example(
            id="a",
            source="s",
            source_ref="r",
            chip="chips/a.png",
            gsd_m=0.005,
            span_m=0.5,
            label="weed",
            label_basis="synthetic truth",
            group="g",
            split="train",
            diameter_m=0.03,
        )
    )
    m.write()
    back = ex.Manifest.read(tmp_path)
    assert back.examples == m.examples
    assert back.summary()["by_label"] == {"weed": 1}
    assert back.summary()["weed_diameter_bins"] == {"<4 cm": 1}


# ---------------------------------------------------------------------------
# Cutting chips
# ---------------------------------------------------------------------------


def test_object_span_is_clamped_and_scales_with_diameter():
    assert ex.object_span_m(0.001) == ex.MIN_SPAN_M
    assert ex.object_span_m(10.0) == ex.MAX_SPAN_M
    assert ex.object_span_m(0.1) == pytest.approx(0.4)


def test_cut_chip_pads_with_the_edge_not_black():
    image = np.full((20, 20, 3), 200, dtype=np.uint8)
    chip, padded = ex.cut_chip(image, cx_px=1, cy_px=1, span_px=10)
    assert padded
    assert chip.shape == (10, 10, 3)
    assert chip.min() == 200, "padding must replicate the edge, never introduce a black border"


def test_cut_chip_interior_needs_no_padding():
    image = np.arange(30 * 30 * 3, dtype=np.uint8).reshape(30, 30, 3)
    chip, padded = ex.cut_chip(image, cx_px=15, cy_px=15, span_px=10)
    assert not padded and chip.shape == (10, 10, 3)


def test_the_same_object_covers_the_same_ground_at_two_gsds():
    """GSD invariance: the span in metres is fixed, so pixels scale with resolution."""
    d = 0.06
    span_m = ex.object_span_m(d)
    px_fine = int(round(span_m / 0.0055))
    px_coarse = int(round(span_m / 0.011))
    assert abs(px_fine / px_coarse - 2.0) < 0.05


# ---------------------------------------------------------------------------
# Synthetic source
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def synth_manifest(tmp_path_factory) -> ex.Manifest:
    out = tmp_path_factory.mktemp("examples") / "synth"
    return sources.build_synth(
        out,
        seeds=range(2),
        gsds_mm=(11.0,),
        crop_per_scene=8,
        other_per_scene=6,
        weed_cap_per_scene=20,
        acres=0.05,
    )


def test_synth_examples_carry_every_label_with_chips_on_disk(synth_manifest: ex.Manifest):
    labels = synth_manifest.summary()["by_label"]
    assert set(labels) == {"weed", "crop", "other"}
    for e in synth_manifest:
        assert synth_manifest.chip_path(e).exists()
        assert e.label_basis.startswith("synthetic truth")
        assert e.gsd_m == pytest.approx(0.011)
        assert e.span_m == pytest.approx(
            ex.object_span_m(e.diameter_m or ex.DEFAULT_NEGATIVE_DIAMETER_M), abs=2 * e.gsd_m
        )


def test_synth_weeds_populate_the_flight_spec_bin(synth_manifest: ex.Manifest):
    bins = synth_manifest.summary()["weed_diameter_bins"]
    assert "<4 cm" in bins, (
        "the smallest bin is the one the flight spec is about; synth must fill it"
    )


def test_synth_groups_are_scenes_not_chips(synth_manifest: ex.Manifest):
    assert synth_manifest.summary()["groups"] == 2


def test_synth_chip_is_centred_on_a_plant_of_the_right_colour(synth_manifest: ex.Manifest):
    """A weed chip's centre is greener than its corners: the cut landed on the plant."""
    weeds = [e for e in synth_manifest if e.label == "weed" and not e.padded][:5]
    assert weeds
    for e in weeds:
        chip = ex.load_chip(synth_manifest.chip_path(e)).astype(float)
        h, w = chip.shape[:2]
        centre = chip[h // 2 - 1 : h // 2 + 2, w // 2 - 1 : w // 2 + 2]
        corner = chip[:3, :3]
        exg = lambda a: (2 * a[..., 1] - a[..., 0] - a[..., 2]).mean()  # noqa: E731
        assert exg(centre) > exg(corner)


# ---------------------------------------------------------------------------
# Operator source: the mapping from verdict to label
# ---------------------------------------------------------------------------


def test_operator_export_maps_verdicts_and_skips_unsure(tmp_path: Path):
    scene = synth_mod.generate(synth_mod.SceneParams(acres=0.03, seed=3, weed_diameter_m=0.08))
    image = synth_mod.render(scene, 11.0)
    raw = tmp_path / "raw"
    raw.mkdir()
    rows = []
    for i, (verdict, xy) in enumerate(
        [
            ("weed", scene.weed_xy_m[0]),
            ("unsure", scene.weed_xy_m[0]),
            ("not_vegetation", (0.3, 0.3)),
        ]
    ):
        cx, cy = xy[0] / 0.011, xy[1] / 0.011
        chip, _ = ex.cut_chip(image, cx, cy, 60)
        ex.save_chip(chip, raw / f"obs{i}.png")
        rows.append(
            {
                "id": f"obs{i}",
                "field_id": "f1",
                "verdict": verdict,
                "chip_span_m": 60 * 0.011,
                "chip_gsd_m": 0.011,
                "features": {"equivDiameterM": 0.08},
                "crop": "corn",
            }
        )
    (tmp_path / "observations.json").write_text(json.dumps(rows))
    m = sources.build_operator(tmp_path, tmp_path / "out")
    labels = sorted((e.source_ref, e.label) for e in m)
    assert labels == [("obs0", "weed"), ("obs2", "other")]
    assert all(e.group == "field:f1" for e in m)


# ---------------------------------------------------------------------------
# The model contract (needs the learn extra)
# ---------------------------------------------------------------------------


@pytest.mark.slow
def test_train_evaluate_export_round_trip(synth_manifest: ex.Manifest, tmp_path: Path):
    torch = pytest.importorskip("torch")
    pytest.importorskip("onnxruntime")
    from offrow.learn import evaluate as eval_mod
    from offrow.learn import export as export_mod
    from offrow.learn import train as train_mod
    from offrow.learn.model import INPUT_PX, chip_to_tensor

    examples_dir = synth_manifest.directory.parent
    cfg = train_mod.TrainConfig(
        version="test-v0", epochs=1, batch_size=16, pretrained=False, patience=1
    )
    result = train_mod.train(examples_dir, tmp_path / "models", cfg)
    assert result.checkpoint.exists()
    assert 0.1 <= result.temperature <= 10.0

    model, state = train_mod.load_model(result.checkpoint, torch.device("cpu"))
    card = eval_mod.scorecard(model, examples_dir, "test-v0", split="val")
    assert card["classes"] == ["weed", "crop", "other"]
    assert "synth" in card["by_source"]
    assert eval_mod.gate(None, card).passed or card["overall"]["per_class"]["weed"]["support"] == 0

    onnx_path = export_mod.export_onnx(model, tmp_path / "m.onnx")
    assert onnx_path.exists()
    # The contract: [0, 1] input, softmax gives probabilities that sum to one.
    t = chip_to_tensor(np.zeros((40, 40, 3), dtype=np.uint8))
    assert t.shape == (3, INPUT_PX, INPUT_PX) and float(t.max()) <= 1.0
    q = export_mod.quantize(onnx_path, tmp_path / "q.onnx")
    assert q.exists() and q.stat().st_size < onnx_path.stat().st_size
