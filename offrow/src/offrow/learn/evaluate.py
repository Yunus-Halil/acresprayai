"""The scorecard, and the gate that reads it.

One JSON per model version, on the frozen test split, broken down the ways a
pooled number would hide: per source (did it learn real weeds or synthetic
ones?), per weed diameter bin (does it see a 3 cm seedling or only a 30 cm
broadleaf?), and calibration (when it says 80%, is it right 80% of the time?).

The gate compares a new scorecard with the previous one. It is deliberately
simple: weed recall and precision on the test split may not fall by more than
a small margin, and calibration may not get worse. A model that fails the gate
is a model that would have shipped a regression to an operator's field.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader

from offrow.datasets import WEED_DIAMETER_BINS_M, diameter_bin, diameter_bin_labels
from offrow.learn.examples import LABELS, read_all
from offrow.learn.model import WeedNet, device, probabilities
from offrow.learn.train import ChipDataset, TrainConfig, predict_logits

WEED = LABELS.index("weed")

#: How much weed recall or precision may fall between versions before the gate refuses.
GATE_MARGIN = 0.02
#: How much expected calibration error may rise.
GATE_ECE_MARGIN = 0.02


def _prf(y_true: np.ndarray, y_pred: np.ndarray, c: int) -> dict:
    tp = int(np.sum((y_true == c) & (y_pred == c)))
    fp = int(np.sum((y_true != c) & (y_pred == c)))
    fn = int(np.sum((y_true == c) & (y_pred != c)))
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = (
        (2 * precision * recall / (precision + recall))
        if precision and recall
        else (0.0 if precision is not None and recall is not None else None)
    )
    return {"support": int(np.sum(y_true == c)), "precision": precision, "recall": recall, "f1": f1}


def expected_calibration_error(
    probs: np.ndarray, y_true: np.ndarray, bins: int = 15
) -> float | None:
    """ECE over the predicted class: |confidence - accuracy|, weighted by bin mass."""
    if len(y_true) == 0:
        return None
    conf = probs.max(-1)
    pred = probs.argmax(-1)
    correct = (pred == y_true).astype(np.float64)
    edges = np.linspace(0, 1, bins + 1)
    ece = 0.0
    for lo, hi in zip(edges[:-1], edges[1:], strict=False):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            ece += m.mean() * abs(conf[m].mean() - correct[m].mean())
    return float(ece)


def weed_auroc(probs: np.ndarray, y_true: np.ndarray) -> float | None:
    """Area under the ROC for weed against everything else."""
    y = (y_true == WEED).astype(int)
    if y.min() == y.max():
        return None
    from sklearn.metrics import roc_auc_score

    return float(roc_auc_score(y, probs[:, WEED]))


def scorecard(
    model: WeedNet,
    examples_dir: Path,
    version: str,
    split: str = "test",
    batch_size: int = 128,
) -> dict:
    manifests = read_all(Path(examples_dir))
    dataset = ChipDataset(manifests, split, augment=False, config=TrainConfig(version=version))
    dev = device()
    model.to(dev)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=False)
    logits, y_true = predict_logits(model, loader, dev)
    probs = (
        probabilities(torch.tensor(logits)).numpy() if len(y_true) else np.zeros((0, len(LABELS)))
    )
    y_pred = probs.argmax(-1) if len(y_true) else np.zeros((0,), dtype=np.int64)
    items = dataset.items

    def subset(mask: np.ndarray) -> dict:
        if not mask.any():
            return {"n": 0}
        out = {"n": int(mask.sum()), "accuracy": float((y_pred[mask] == y_true[mask]).mean())}
        out["per_class"] = {
            label: _prf(y_true[mask], y_pred[mask], i) for i, label in enumerate(LABELS)
        }
        out["weed_auroc"] = weed_auroc(probs[mask], y_true[mask])
        out["ece"] = expected_calibration_error(probs[mask], y_true[mask])
        return out

    sources = sorted({e.source for _, e in items})
    bin_labels = diameter_bin_labels()
    by_bin: dict[str, dict] = {}
    for b, name in enumerate(bin_labels):
        mask = np.array(
            [
                e.label == "weed"
                and e.diameter_m is not None
                and diameter_bin(e.diameter_m, WEED_DIAMETER_BINS_M) == b
                for _, e in items
            ]
        )
        if mask.any():
            by_bin[name] = {"n": int(mask.sum()), "recall": float((y_pred[mask] == WEED).mean())}
    confusion = np.zeros((len(LABELS), len(LABELS)), dtype=int)
    for t, p in zip(y_true, y_pred, strict=False):
        confusion[t, p] += 1
    return {
        "version": version,
        "split": split,
        "evaluated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "temperature": float(model.temperature.item()),
        "classes": list(LABELS),
        "overall": subset(np.ones(len(items), dtype=bool)),
        "by_source": {s: subset(np.array([e.source == s for _, e in items])) for s in sources},
        "weed_recall_by_diameter": by_bin,
        "confusion": {
            "rows": "true",
            "cols": "predicted",
            "labels": list(LABELS),
            "matrix": confusion.tolist(),
        },
        "groups": len({e.group for _, e in items}),
    }


@dataclass
class GateResult:
    passed: bool
    reasons: list[str]


def gate(previous: dict | None, new: dict) -> GateResult:
    """May this version ship? Compares against the previous scorecard, if any."""
    reasons: list[str] = []
    new_weed = new.get("overall", {}).get("per_class", {}).get("weed", {})
    if new.get("overall", {}).get("n", 0) == 0:
        return GateResult(False, ["the test split is empty; nothing was measured"])
    if new_weed.get("support", 0) == 0:
        return GateResult(False, ["no weeds in the test split; weed recall cannot be measured"])
    if previous is None:
        return GateResult(True, ["first scorecard; nothing to compare against"])
    old_weed = previous.get("overall", {}).get("per_class", {}).get("weed", {})
    for metric in ("recall", "precision"):
        old, cur = old_weed.get(metric), new_weed.get(metric)
        if old is not None and cur is not None and cur < old - GATE_MARGIN:
            reasons.append(f"weed {metric} fell from {old:.3f} to {cur:.3f}")
    old_ece, new_ece = previous.get("overall", {}).get("ece"), new.get("overall", {}).get("ece")
    if old_ece is not None and new_ece is not None and new_ece > old_ece + GATE_ECE_MARGIN:
        reasons.append(f"calibration error rose from {old_ece:.3f} to {new_ece:.3f}")
    return GateResult(not reasons, reasons or ["no regression against the previous scorecard"])


def write_scorecard(card: dict, reports_dir: Path) -> Path:
    reports_dir = Path(reports_dir)
    reports_dir.mkdir(parents=True, exist_ok=True)
    path = reports_dir / f"{card['version']}.json"
    path.write_text(json.dumps(card, indent=1))
    return path


def latest_scorecard(reports_dir: Path, exclude_version: str | None = None) -> dict | None:
    reports_dir = Path(reports_dir)
    if not reports_dir.exists():
        return None
    cards = []
    for path in reports_dir.glob("*.json"):
        try:
            card = json.loads(path.read_text())
        except json.JSONDecodeError:
            continue
        if card.get("version") and card["version"] != exclude_version and "overall" in card:
            cards.append(card)
    if not cards:
        return None
    return max(cards, key=lambda c: c.get("evaluated_at", ""))
