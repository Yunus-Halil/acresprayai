"""The real-field benchmark: the model's word against the operator's, per version.

The scorecard (evaluate.py) measures a model on a frozen test split of labelled
chips. This measures it where it matters: on the archive, where every row is a
spot an operator looked at and decided. The operator's verdict is the truth;
the stored prediction is what the model said when they looked. Nothing here
runs a model. It reads what was recorded.

Three rules, each worth a wrong number somewhere:

**Only operator verdicts count.** A row saved as proposed (``verdict_source =
'default'``) carries the model's own suggestion as its verdict; scoring the
model against it measures agreement with itself. Rows from before the column
existed (null) are unknown and left out too, with their count reported.

**Unsure is not a label.** A spot the operator could not decide teaches nothing
about either class and is reported, not scored.

**A declined spot is a declined spot.** ``UNKNOWN_RESOLUTION`` rows have no
prediction and are counted as such, never as misses: the model was not asked.

Runs without torch, so it can be a release gate on any machine.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

#: The app's default-verdict thresholds (lib/weedScout/classify/types.ts).
WEED_AT_OR_ABOVE = 0.6
NOT_WEED_BELOW = 0.4

#: Fewest operator verdicts (with a prediction) before a benchmark may gate a release.
MIN_OPERATOR_VERDICTS = 30
GATE_MARGIN = 0.02

#: Ground sample distance bins, metres per pixel, for "performance by GSD".
GSD_BINS_M = (0.01, 0.02, 0.04, 0.08)
GSD_LABELS = ("<1 cm", "1-2 cm", "2-4 cm", "4-8 cm", ">=8 cm")

WEED_VERDICTS = {"weed"}
NOT_WEED_VERDICTS = {"not_weed", "crop", "not_vegetation"}


def gsd_bin(gsd_m: float | None) -> str:
    if gsd_m is None:
        return "unknown"
    for edge, label in zip(GSD_BINS_M, GSD_LABELS, strict=False):
        if gsd_m < edge:
            return label
    return GSD_LABELS[-1]


@dataclass(frozen=True)
class Scored:
    """One operator-labelled spot with the model's stored prediction."""

    id: str
    model_version: str
    truth_weed: bool
    p_weed: float
    source: str
    gsd_m: float | None
    crop: str
    field_id: str
    finding_class: str
    verdict: str


def _prediction(row: dict[str, Any]) -> dict[str, Any] | None:
    p = row.get("prediction")
    if isinstance(p, str):
        try:
            p = json.loads(p)
        except json.JSONDecodeError:
            return None
    if not isinstance(p, dict) or not isinstance(p.get("pWeed"), (int, float)):
        return None
    return p


def _inference(row: dict[str, Any]) -> dict[str, Any]:
    i = row.get("inference")
    if isinstance(i, str):
        try:
            i = json.loads(i)
        except json.JSONDecodeError:
            return {}
    return i if isinstance(i, dict) else {}


def partition(rows: list[dict[str, Any]]) -> tuple[list[Scored], dict[str, int]]:
    """Split the archive into scorable spots and the counts of everything left out."""
    left_out = {
        "not_operator": 0,
        "verdict_source_unknown": 0,
        "unsure": 0,
        "unknown_resolution": 0,
        "no_prediction": 0,
        "no_verdict": 0,
    }
    scored: list[Scored] = []
    for row in rows:
        verdict = row.get("verdict")
        if not verdict:
            left_out["no_verdict"] += 1
            continue
        source = row.get("verdict_source")
        if source is None:
            left_out["verdict_source_unknown"] += 1
            continue
        if source != "operator":
            left_out["not_operator"] += 1
            continue
        if verdict == "unsure":
            left_out["unsure"] += 1
            continue
        inference = _inference(row)
        prediction = _prediction(row)
        if prediction is None:
            if inference.get("status") == "unknown_resolution":
                left_out["unknown_resolution"] += 1
            else:
                left_out["no_prediction"] += 1
            continue
        gsd = inference.get("effectiveGsdM")
        if not isinstance(gsd, (int, float)):
            gsd = row.get("chip_gsd_m") or row.get("gsd_m")
        scored.append(
            Scored(
                id=str(row.get("id")),
                model_version=str(
                    prediction.get("modelVersion") or row.get("model_version") or "unknown"
                ),
                truth_weed=verdict in WEED_VERDICTS,
                p_weed=float(prediction["pWeed"]),
                source=str(inference.get("source") or "orthomosaic"),
                gsd_m=float(gsd) if isinstance(gsd, (int, float)) else None,
                crop=str(row.get("crop") or "unknown"),
                field_id=str(row.get("field_id") or "unknown"),
                finding_class=str(row.get("finding_class") or "unknown"),
                verdict=str(verdict),
            )
        )
    return scored, left_out


def auroc(scores: np.ndarray, truth: np.ndarray) -> float | None:
    """Rank-based AUROC; None when one class is absent."""
    pos = scores[truth]
    neg = scores[~truth]
    if len(pos) == 0 or len(neg) == 0:
        return None
    ranks = (
        np.argsort(np.argsort(np.concatenate([pos, neg]), kind="mergesort"), kind="mergesort") + 1
    )
    # Ties get the mean rank.
    order = np.concatenate([pos, neg])
    uniq, inv = np.unique(order, return_inverse=True)
    mean_rank = np.zeros(len(uniq))
    np.add.at(mean_rank, inv, ranks)
    counts = np.bincount(inv)
    mean_rank /= counts
    r = mean_rank[inv]
    return float((r[: len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def confusion(items: list[Scored], threshold: float) -> dict[str, Any]:
    """Binary weed / not-weed at a threshold, with the counts a reader can check by hand."""
    if not items:
        return {"n": 0}
    truth = np.array([s.truth_weed for s in items])
    p = np.array([s.p_weed for s in items])
    pred = p >= threshold
    tp = int(np.sum(truth & pred))
    fp = int(np.sum(~truth & pred))
    fn = int(np.sum(truth & ~pred))
    tn = int(np.sum(~truth & ~pred))
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    specificity = tn / (tn + fp) if tn + fp else None
    # The app's default was weed / not weed / unsure; a correction is an operator
    # verdict that differs from a confident default. The unsure band is not a claim.
    default_weed = p >= WEED_AT_OR_ABOVE
    default_not = p < NOT_WEED_BELOW
    claimed = default_weed | default_not
    corrected = (default_weed & ~truth) | (default_not & truth)
    return {
        "n": len(items),
        "weeds": int(truth.sum()),
        "not_weeds": int((~truth).sum()),
        "threshold": threshold,
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "precision": precision,
        "recall": recall,
        "specificity": specificity,
        "false_positive_rate": (fp / (fp + tn)) if fp + tn else None,
        "f1": (2 * precision * recall / (precision + recall)) if precision and recall else None,
        "auroc": auroc(p, truth),
        "median_p_weed_on_weeds": float(np.median(p[truth])) if truth.any() else None,
        "median_p_weed_on_not_weeds": float(np.median(p[~truth])) if (~truth).any() else None,
        "default_claimed": int(claimed.sum()),
        "operator_correction_rate": (
            float(corrected.sum() / claimed.sum()) if claimed.sum() else None
        ),
    }


def _by(items: list[Scored], key, threshold: float) -> dict[str, dict[str, Any]]:
    groups: dict[str, list[Scored]] = {}
    for s in items:
        groups.setdefault(key(s), []).append(s)
    return {k: confusion(v, threshold) for k, v in sorted(groups.items())}


def benchmark(rows: list[dict[str, Any]], threshold: float = WEED_AT_OR_ABOVE) -> dict[str, Any]:
    """The benchmark over an archive export, per model version."""
    scored, left_out = partition(rows)
    versions = sorted({s.model_version for s in scored})
    out: dict[str, Any] = {
        "kind": "real-field-benchmark",
        "evaluated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rows": len(rows),
        "scored": len(scored),
        "left_out": left_out,
        "threshold": threshold,
        "models": {},
    }
    for v in versions:
        items = [s for s in scored if s.model_version == v]
        out["models"][v] = {
            "overall": confusion(items, threshold),
            "by_source": _by(items, lambda s: s.source, threshold),
            "by_gsd": _by(items, lambda s: gsd_bin(s.gsd_m), threshold),
            "by_crop": _by(items, lambda s: s.crop, threshold),
            "by_field": _by(items, lambda s: s.field_id, threshold),
            "by_finding_class": _by(items, lambda s: s.finding_class, threshold),
            "fields": len({s.field_id for s in items}),
        }
    return out


@dataclass
class GateResult:
    passed: bool
    reasons: list[str]


def gate(previous: dict[str, Any] | None, new: dict[str, Any], version: str) -> GateResult:
    """May this version ship, on real-field evidence?

    Refuses outright below MIN_OPERATOR_VERDICTS: too few decisions to say
    anything. Against a previous benchmark of another version, weed recall and
    precision may not fall by more than the margin.
    """
    cur = new.get("models", {}).get(version, {}).get("overall", {})
    n = cur.get("n", 0)
    if n < MIN_OPERATOR_VERDICTS:
        return GateResult(
            False, [f"only {n} operator verdicts with a prediction; {MIN_OPERATOR_VERDICTS} needed"]
        )
    if not cur.get("weeds") or not cur.get("not_weeds"):
        return GateResult(False, ["both weeds and not-weeds are needed to measure anything"])
    if previous is None:
        return GateResult(True, ["first benchmark; nothing to compare against"])
    reasons: list[str] = []
    for other, prev in previous.get("models", {}).items():
        if other == version:
            continue
        old = prev.get("overall", {})
        for metric in ("recall", "precision"):
            a, b = old.get(metric), cur.get(metric)
            if a is not None and b is not None and b < a - GATE_MARGIN:
                reasons.append(f"weed {metric} fell from {a:.3f} ({other}) to {b:.3f} ({version})")
    return GateResult(not reasons, reasons or ["no regression against the previous benchmark"])


def write_benchmark(card: dict[str, Any], reports_dir: Path) -> Path:
    reports_dir = Path(reports_dir)
    reports_dir.mkdir(parents=True, exist_ok=True)
    stamp = card["evaluated_at"].replace(":", "").replace("-", "")[:15]
    path = reports_dir / f"benchmark-{stamp}.json"
    path.write_text(json.dumps(card, indent=1))
    return path


def latest_benchmark(reports_dir: Path) -> dict[str, Any] | None:
    reports_dir = Path(reports_dir)
    if not reports_dir.exists():
        return None
    cards = []
    for path in reports_dir.glob("benchmark-*.json"):
        try:
            card = json.loads(path.read_text())
        except json.JSONDecodeError:
            continue
        if card.get("kind") == "real-field-benchmark":
            cards.append(card)
    return max(cards, key=lambda c: c.get("evaluated_at", "")) if cards else None


def summary_lines(card: dict[str, Any]) -> list[str]:
    """What a person reads at the terminal."""
    lo = card["left_out"]
    lines = [
        f"{card['rows']} archive rows; {card['scored']} operator verdicts with a prediction "
        "scored.",
        f"left out: {lo['not_operator']} saved as proposed, "
        f"{lo['verdict_source_unknown']} of unknown source, {lo['unsure']} unsure, "
        f"{lo['unknown_resolution']} declined for resolution, "
        f"{lo['no_prediction']} without a prediction, {lo['no_verdict']} without a verdict.",
    ]

    def fmt(x: float | None) -> str:
        return "n/a" if x is None else f"{x:.3f}"

    for v, m in card["models"].items():
        o = m["overall"]
        lines.append(
            f"{v}: n={o['n']} (weeds {o['weeds']}, not {o['not_weeds']}) "
            f"at p>={o['threshold']}: precision {fmt(o['precision'])}, "
            f"recall {fmt(o['recall'])}, FPR {fmt(o['false_positive_rate'])}, "
            f"AUROC {fmt(o['auroc'])}; median pWeed weeds "
            f"{fmt(o['median_p_weed_on_weeds'])} vs not {fmt(o['median_p_weed_on_not_weeds'])}; "
            f"operator corrected {fmt(o['operator_correction_rate'])} of confident defaults."
        )
        for kind, groups in (("gsd", m["by_gsd"]), ("source", m["by_source"])):
            for label, g in groups.items():
                lines.append(
                    f"  {kind} {label}: n={g['n']} recall {fmt(g.get('recall'))} "
                    f"precision {fmt(g.get('precision'))}"
                )
    return lines
