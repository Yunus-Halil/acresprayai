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

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

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

    @property
    def recall(self) -> float:
        raise NotImplementedError

    @property
    def precision(self) -> float:
        raise NotImplementedError

    @property
    def fp_per_acre(self) -> float:
        raise NotImplementedError


@dataclass
class Curve:
    """Recall against false positives per acre, swept over score threshold."""

    thresholds: np.ndarray
    recall: np.ndarray
    fp_per_acre: np.ndarray
    label: str = ""
    diameter_bin: str = ""
    flown: bool = False

    def recall_at_budget(self, fp_per_acre_budget: float) -> float:
        """Recall at the highest threshold meeting the budget."""
        raise NotImplementedError


def match(
    predictions: list,
    truth: list,
    tolerance_m: float = DEFAULT_MATCH_TOLERANCE_M,
) -> MatchResult:
    """Match predictions to truth by centroid distance.

    One-to-one and greedy by score: a single prediction cannot claim two truth
    points, and two predictions on one weed cost a false positive, which is what
    the operator experiences.
    """
    raise NotImplementedError


def recall_fp_curve(
    predictions: list,
    truth: list,
    area_acres: float,
    tolerance_m: float = DEFAULT_MATCH_TOLERANCE_M,
    label: str = "",
) -> Curve:
    """Full recall versus false-positives-per-acre curve."""
    raise NotImplementedError


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
