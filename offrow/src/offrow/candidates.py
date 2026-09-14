"""Turning blobs into a ranked review queue.

STUB. No implementation yet.

Scoring is pure geometry: a blob far enough from every row centerline is a
candidate, and its score is how far off-row it sits. No appearance, no
classifier.

Nothing here produces a verdict. A candidate is something for an operator to
look at, and no field, name or docstring in this module may describe one as a
confirmed weed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

#: Fraction of the row spacing within which a blob counts as in-row. At 0.30 of
#: a 30 inch row that is a 23 cm band either side of centre, which tolerates
#: planter wander and a leaning V6 plant without swallowing the inter-row.
DEFAULT_BAND_FRAC = 0.30

#: Inward buffer from the field boundary, in metres. Headlands and end rows
#: break the row grid, and most early false positives live there.
DEFAULT_HEADLAND_BUFFER_M = 15.0


@dataclass
class Candidate:
    """One off-row blob, surfaced for review. Never a verdict."""

    centroid_xy_m: tuple[float, float]
    score: float
    distance_to_row_m: float
    area_m2: float
    gsd_m: float
    blob: Any = None
    geometry: Any = None


@dataclass(frozen=True)
class CandidateParams:
    """Geometric scoring parameters.

    Args:
        band_frac: In-row band as a fraction of row spacing.
        headland_buffer_m: Inward buffer applied before scoring.
        min_row_confidence: Below this row-model confidence, candidates are
            still emitted but flagged, because a bad row fit makes every
            distance meaningless and silence about that would be worse than
            a false positive.
    """

    band_frac: float = DEFAULT_BAND_FRAC
    headland_buffer_m: float = DEFAULT_HEADLAND_BUFFER_M
    min_row_confidence: float = 0.4


def apply_exclusions(
    blobs: list,
    boundary: Any,
    headland_buffer_m: float = DEFAULT_HEADLAND_BUFFER_M,
    exclusion_polygons: list | None = None,
) -> list:
    """Drop blobs in headlands, end rows and user-supplied exclusion zones.

    Applied before scoring, not after. Filtering afterwards would let excluded
    ground influence any normalisation the scoring does, and would waste the
    feature extraction on ground nobody intends to treat.
    """
    raise NotImplementedError


def score(
    distance_to_row_m: float, row_spacing_m: float, band_frac: float = DEFAULT_BAND_FRAC
) -> float:
    """Normalised off-row distance, clipped to [0, 1].

    Zero at the edge of the in-row band, one at the midpoint between rows. A
    blob dead centre between two rows is the strongest geometric claim
    available, and there is nothing stronger to express.
    """
    raise NotImplementedError


def detect(
    blobs: list,
    row_model: Any,
    boundary: Any = None,
    params: CandidateParams | None = None,
    exclusion_polygons: list | None = None,
) -> list[Candidate]:
    """Select and score off-row candidates from extracted blobs."""
    raise NotImplementedError


def to_geojson(candidates: list[Candidate], path: Any, crs: Any = None) -> None:
    """Write candidates to GeoJSON, sorted by score descending."""
    raise NotImplementedError
