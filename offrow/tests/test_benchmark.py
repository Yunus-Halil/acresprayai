"""The real-field benchmark: operator truth against stored predictions, and nothing else."""

from __future__ import annotations

import json

import numpy as np

from offrow.learn import benchmark as bm


def row(**over):
    base = {
        "id": "r",
        "field_id": "f1",
        "crop": "corn",
        "verdict": "weed",
        "verdict_source": "operator",
        "finding_class": "vegetation",
        "chip_gsd_m": 0.015,
        "prediction": {"pWeed": 0.9, "pCrop": 0.05, "pOther": 0.05, "modelVersion": "weed-v1"},
        "model_version": "weed-v1",
        "inference": {"status": "scored", "source": "orthomosaic", "effectiveGsdM": 0.015},
    }
    base.update(over)
    return base


def test_only_operator_verdicts_with_a_prediction_are_scored():
    rows = [
        row(id="a"),
        row(id="b", verdict_source="default"),
        row(id="c", verdict_source=None),
        row(id="d", verdict="unsure"),
        row(
            id="e",
            prediction=None,
            inference={"status": "unknown_resolution", "effectiveGsdM": 0.087},
        ),
        row(id="f", prediction=None, inference={}),
        row(id="g", verdict=None),
    ]
    scored, left = bm.partition(rows)
    assert [s.id for s in scored] == ["a"]
    assert left == {
        "not_operator": 1,
        "verdict_source_unknown": 1,
        "unsure": 1,
        "unknown_resolution": 1,
        "no_prediction": 1,
        "no_verdict": 1,
    }


def test_the_confusion_counts_can_be_checked_by_hand():
    rows = [
        row(id="1", verdict="weed", prediction={"pWeed": 0.9, "modelVersion": "weed-v1"}),
        row(id="2", verdict="weed", prediction={"pWeed": 0.3, "modelVersion": "weed-v1"}),
        row(id="3", verdict="not_weed", prediction={"pWeed": 0.8, "modelVersion": "weed-v1"}),
        row(id="4", verdict="crop", prediction={"pWeed": 0.1, "modelVersion": "weed-v1"}),
        row(id="5", verdict="not_vegetation", prediction={"pWeed": 0.5, "modelVersion": "weed-v1"}),
    ]
    card = bm.benchmark(rows, threshold=0.6)
    o = card["models"]["weed-v1"]["overall"]
    assert (o["tp"], o["fp"], o["fn"], o["tn"]) == (1, 1, 1, 2)
    assert o["precision"] == 0.5 and o["recall"] == 0.5
    assert o["false_positive_rate"] == 1 / 3
    # Confident defaults: rows 1 (weed), 2 (not), 3 (weed), 4 (not); corrected: 2 and 3.
    assert o["default_claimed"] == 4
    assert o["operator_correction_rate"] == 0.5


def test_auroc_is_rank_based_and_handles_ties():
    scores = np.array([0.9, 0.8, 0.7, 0.2, 0.1])
    truth = np.array([True, True, False, False, False])
    assert bm.auroc(scores, truth) == 1.0
    assert bm.auroc(np.array([0.5, 0.5]), np.array([True, False])) == 0.5
    assert bm.auroc(np.array([0.5]), np.array([True])) is None


def test_breakdowns_by_gsd_source_crop_field_and_class():
    rows = [
        row(
            id="a", inference={"status": "scored", "source": "orthomosaic", "effectiveGsdM": 0.087}
        ),
        row(
            id="b",
            inference={"status": "scored", "source": "source_frame", "effectiveGsdM": 0.027},
            crop="soybean",
            field_id="f2",
            finding_class="vegetation",
        ),
        row(
            id="c",
            chip_gsd_m=None,
            gsd_m=None,
            inference={"status": "scored", "source": "orthomosaic"},
        ),
    ]
    m = bm.benchmark(rows)["models"]["weed-v1"]
    assert set(m["by_gsd"]) == {">=8 cm", "2-4 cm", "unknown"}
    assert set(m["by_source"]) == {"orthomosaic", "source_frame"}
    assert set(m["by_crop"]) == {"corn", "soybean"}
    assert m["fields"] == 2
    assert bm.gsd_bin(0.005) == "<1 cm" and bm.gsd_bin(0.02) == "2-4 cm"


def test_the_gate_refuses_too_little_evidence_and_regressions():
    few = bm.benchmark([row(id=str(i)) for i in range(5)])
    r = bm.gate(None, few, "weed-v1")
    assert not r.passed and "5 operator verdicts" in r.reasons[0]

    def many(version, p_on_weeds, p_on_not):
        rows = [
            row(id=f"w{i}", prediction={"pWeed": p_on_weeds, "modelVersion": version})
            for i in range(20)
        ]
        rows += [
            row(
                id=f"n{i}",
                verdict="not_weed",
                prediction={"pWeed": p_on_not, "modelVersion": version},
            )
            for i in range(20)
        ]
        return bm.benchmark(rows)

    good = many("weed-v1", 0.9, 0.1)
    assert bm.gate(None, good, "weed-v1").passed
    worse = many("weed-v2", 0.5, 0.1)  # recall collapses
    r = bm.gate(good, worse, "weed-v2")
    assert not r.passed and "recall fell" in r.reasons[0]
    one_sided = bm.benchmark([row(id=str(i)) for i in range(40)])
    assert not bm.gate(None, one_sided, "weed-v1").passed


def test_predictions_stored_as_json_text_are_read(tmp_path):
    rows = [
        row(
            id="a",
            prediction=json.dumps({"pWeed": 0.7, "modelVersion": "weed-v1"}),
            inference=json.dumps({"status": "scored"}),
        )
    ]
    scored, _ = bm.partition(rows)
    assert scored[0].p_weed == 0.7
    card = bm.benchmark(rows)
    path = bm.write_benchmark(card, tmp_path)
    assert bm.latest_benchmark(tmp_path)["scored"] == 1
    assert path.name.startswith("benchmark-")
    assert any("weed-v1: n=1" in line for line in bm.summary_lines(card))
