"""Evaluation: recall against a false-positive budget, and recall against GSD.

STUB. No implementation yet.

The headline metric is recall at a fixed false-positives-per-acre budget. Not
accuracy, which a field that is 99 percent crop makes meaningless, and not pixel
IoU, which measures how well a blob was outlined rather than whether anyone was
sent to the right place. The operator's real cost is how many junk flags they
click through per acre, so that is the axis.

The second metric aggregates to review cells, because coarse recall is what
determines whether the right ground gets treated.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from offrow import io as raster_io
from offrow.datasets import WEED_DIAMETER_BINS_M, diameter_bin, diameter_bin_labels

#: Centroid distance within which a prediction matches a truth point, in metres.
DEFAULT_MATCH_TOLERANCE_M = 0.25


@dataclass
class MatchResult:
    """One-to-one matching of predictions to truth at a given score threshold."""

    true_positives: int
    false_positives: int
    false_negatives: int
    score_threshold: float
    area_acres: float
    matched_diameters_m: list[float] = field(default_factory=list)
    missed_diameters_m: list[float] = field(default_factory=list)

    @property
    def recall(self) -> float:
        found = self.true_positives + self.false_negatives
        return self.true_positives / found if found else float("nan")

    @property
    def precision(self) -> float:
        flagged = self.true_positives + self.false_positives
        return self.true_positives / flagged if flagged else float("nan")

    @property
    def fp_per_acre(self) -> float:
        return self.false_positives / self.area_acres if self.area_acres > 0 else float("nan")


@dataclass
class Curve:
    """Recall against false positives per acre, for one diameter bin.

    Never pooled across bins. A single curve over a mixed size distribution
    reports the easy half of the problem.
    """

    thresholds: np.ndarray
    recall: np.ndarray
    fp_per_acre: np.ndarray
    label: str = ""
    diameter_bin: str = ""
    flown: bool = False

    def recall_at_budget(self, fp_per_acre_budget: float) -> float:
        """Recall at the loosest threshold that still meets the budget.

        Loosest, not tightest: the operator picks a budget and wants everything
        they can get inside it.
        """
        within = np.isfinite(self.fp_per_acre) & (self.fp_per_acre <= fp_per_acre_budget)
        if not within.any():
            return float("nan")
        index = int(np.argmax(np.where(within, self.recall, -np.inf)))
        return float(self.recall[index])


@dataclass(frozen=True)
class TruthPoint:
    """One ground-truth object, carrying the diameter recall is binned by."""

    xy_m: tuple[float, float]
    diameter_m: float
    label: str = "weed"

    @property
    def diameter_bin(self) -> str:
        return diameter_bin_labels()[diameter_bin(self.diameter_m)]


def read_truth(path: Path | str, label: str | None = None) -> list[TruthPoint]:
    """Read ground truth from GeoJSON, keeping the diameter.

    A truth file without a diameter can only produce a pooled number, and a
    pooled number over a mixed size distribution measures the easy half.
    """
    geometries, properties, _crs = raster_io.read_geojson(path)
    points = []
    for geometry, record in zip(geometries, properties, strict=True):
        if label and record.get("class") != label:
            continue
        diameter = record.get("diameter_m")
        if diameter is None:
            raise ValueError(
                f"{path} has a feature with no diameter_m. Recall is binned by diameter, "
                "so truth without it cannot be scored the way this repo reports."
            )
        points.append(
            TruthPoint(
                xy_m=(float(geometry.x), float(geometry.y)),
                diameter_m=float(diameter),
                label=str(record.get("class", "weed")),
            )
        )
    return points


def match(
    predictions: list,
    truth: list[TruthPoint],
    tolerance_m: float = DEFAULT_MATCH_TOLERANCE_M,
    area_acres: float = 0.0,
    score_threshold: float = 0.0,
) -> MatchResult:
    """Match predictions to truth by centroid distance.

    One-to-one and greedy by score: a single prediction cannot claim two truth
    points, and two predictions on one weed cost a false positive, which is what
    the operator experiences.
    """
    kept = [p for p in predictions if float(getattr(p, "score", 1.0)) >= score_threshold]
    kept.sort(key=lambda p: -float(getattr(p, "score", 1.0)))

    unclaimed = list(range(len(truth)))
    matched_diameters: list[float] = []
    true_positives = 0
    false_positives = 0

    truth_xy = np.array([t.xy_m for t in truth]) if truth else np.zeros((0, 2))
    for prediction in kept:
        if not unclaimed:
            false_positives += 1
            continue
        px, py = prediction.centroid_xy_m
        candidates = np.array(unclaimed)
        distances = np.hypot(truth_xy[candidates, 0] - px, truth_xy[candidates, 1] - py)
        best = int(np.argmin(distances))
        if distances[best] <= tolerance_m:
            index = int(candidates[best])
            unclaimed.remove(index)
            matched_diameters.append(truth[index].diameter_m)
            true_positives += 1
        else:
            false_positives += 1

    return MatchResult(
        true_positives=true_positives,
        false_positives=false_positives,
        false_negatives=len(unclaimed),
        score_threshold=score_threshold,
        area_acres=area_acres,
        matched_diameters_m=matched_diameters,
        missed_diameters_m=[truth[i].diameter_m for i in unclaimed],
    )


def recall_by_diameter(
    result: MatchResult, bins_m: tuple[float, ...] = WEED_DIAMETER_BINS_M
) -> dict[str, dict[str, float]]:
    """Recall per ground-truth diameter bin. Never pooled.

    The smallest bin is the only one that speaks to the flight spec. A pooled
    figure over a distribution that is mostly large weeds measures a different,
    easier problem, and the public sets contain nothing under 8 cm at all.
    """
    names = diameter_bin_labels(bins_m)
    table = {name: {"found": 0.0, "missed": 0.0} for name in names}
    for diameter in result.matched_diameters_m:
        table[names[diameter_bin(diameter, bins_m)]]["found"] += 1
    for diameter in result.missed_diameters_m:
        table[names[diameter_bin(diameter, bins_m)]]["missed"] += 1
    for row in table.values():
        total = row["found"] + row["missed"]
        row["truth"] = total
        row["recall"] = row["found"] / total if total else float("nan")
    return table


def recall_fp_curve(
    predictions: list,
    truth: list[TruthPoint],
    area_acres: float,
    tolerance_m: float = DEFAULT_MATCH_TOLERANCE_M,
    label: str = "",
    steps: int = 25,
    bins_m: tuple[float, ...] = WEED_DIAMETER_BINS_M,
) -> dict[str, Curve]:
    """Recall versus false positives per acre, one curve per diameter bin.

    Returns a curve per bin rather than one pooled curve, because a pooled curve
    is the thing this repo has agreed not to report.
    """
    thresholds = np.linspace(0.0, 1.0, steps)
    names = diameter_bin_labels(bins_m)
    recalls = {name: [] for name in names}
    fps = []

    for threshold in thresholds:
        result = match(predictions, truth, tolerance_m, area_acres, threshold)
        fps.append(result.fp_per_acre)
        table = recall_by_diameter(result, bins_m)
        for name in names:
            recalls[name].append(table[name]["recall"])

    return {
        name: Curve(
            thresholds=thresholds,
            recall=np.array(recalls[name]),
            fp_per_acre=np.array(fps),
            label=label,
            diameter_bin=name,
            flown=False,
        )
        for name in names
    }


def cell_recall(
    predictions: list,
    truth: list,
    cell_m: float = 10.0,
    boundary: Any = None,
) -> float:
    """Recall at spray resolution: fraction of truth-bearing cells that are flagged.

    Higher than point recall by construction, and the more honest number for a
    sprayer that treats a whole cell anyway.
    """
    raise NotImplementedError


def gsd_sweep(
    scenes: dict[float, Any],
    row_spacing_m: float,
    out_path: Path | None = None,
    flown: bool = True,
) -> dict[str, Any]:
    """Recall against GSD, from imagery captured at each GSD.

    Args:
        scenes: GSD in millimetres to the scene or dataset flown at it. One
            entry per rung of the ladder.
        row_spacing_m: What the grower planted.
        out_path: Where to write the plot.
        flown: Whether these rungs came from a camera. Synthetic rungs are
            rendered natively at each GSD and are still not flown; label them.

    Row-model confidence is plotted on the same axes. Without it a falling
    recall curve is ambiguous between "rows were found and the weeds were
    missed" and "rows were never found", and those have different fixes.

    Recall is reported per weed-diameter bin, never pooled. The public sets
    contain no weed under 8 cm, so a pooled curve from them would measure the
    easy regime; the smallest bin is the only one that speaks to the flight
    spec.
    """
    raise NotImplementedError


def plot_curve(curves: list[Curve], out_path: Path, title: str = "") -> None:
    """Plot one or more recall versus FP-per-acre curves."""
    raise NotImplementedError
