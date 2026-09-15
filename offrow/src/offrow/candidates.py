"""Turning blobs into a ranked review queue.

Scoring is pure geometry: a blob far enough from every row centerline is a
candidate, and its score is how far off-row it sits. No appearance, no
classifier. Every other feature on a blob is carried along untouched, for the
one-class step later.

Nothing here produces a verdict. A candidate is something for an operator to
look at, and no field, name or docstring in this module may describe one as a
confirmed weed.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from offrow import io as raster_io

#: Fraction of the row spacing within which a blob counts as in-row. At 0.30 of
#: a 30 inch row that is a 23 cm band either side of centre, which tolerates
#: planter wander and a leaning V6 plant without swallowing the inter-row.
DEFAULT_BAND_FRAC = 0.30

#: Inward buffer from the field boundary, in metres. Headlands and end rows
#: break the row grid, and most early false positives live there.
DEFAULT_HEADLAND_BUFFER_M = 15.0


class LowRowConfidence(UserWarning):
    """Candidates were scored against a row model that did not find the rows."""


@dataclass
class Candidate:
    """One off-row blob, surfaced for review. Never a verdict."""

    centroid_xy_m: tuple[float, float]
    score: float
    distance_to_row_m: float
    area_m2: float
    gsd_m: float
    row_confidence: float = 1.0
    blob: Any = None
    geometry: Any = None

    @property
    def offrow_fraction(self) -> float:
        """How far off-row, as a fraction of the row spacing. Diagnostic only."""
        return abs(self.distance_to_row_m)


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
        min_area_m2: Optional extra area floor at scoring time. The real
            despeckling is in :mod:`offrow.blobs`; this is for an operator who
            wants a coarser queue without re-running the detector.
    """

    band_frac: float = DEFAULT_BAND_FRAC
    headland_buffer_m: float = DEFAULT_HEADLAND_BUFFER_M
    min_row_confidence: float = 0.4
    min_area_m2: float = 0.0
    exclusion_ids: tuple[str, ...] = field(default=(), repr=False)


DEFAULT_PARAMS = CandidateParams()


def apply_exclusions(
    blobs: list,
    boundary: Any,
    headland_buffer_m: float = DEFAULT_HEADLAND_BUFFER_M,
    exclusion_polygons: list | None = None,
) -> list:
    """Drop blobs in headlands, end rows and user-supplied exclusion zones.

    Applied before scoring, not after. Filtering afterwards would let excluded
    ground influence any normalisation the scoring does, and would waste the
    feature extraction on ground nobody intends to treat. It also keeps the
    false-positives-per-acre denominator honest: acres nobody will walk should
    not be in it.

    A buffer that consumes the whole field returns nothing and says so, rather
    than silently handing back an empty queue that reads like a clean field.
    """
    kept = list(blobs)
    if boundary is not None and headland_buffer_m > 0:
        interior = raster_io.inward_buffer(boundary, headland_buffer_m)
        if interior.is_empty:
            warnings.warn(
                f"a {headland_buffer_m:g} m headland buffer leaves no ground to inspect; "
                "every blob was excluded, which is not the same as a clean field",
                stacklevel=2,
            )
            return []
        kept = [b for b in kept if _inside(interior, b)]
    elif boundary is not None:
        kept = [b for b in kept if _inside(boundary, b)]

    for polygon in exclusion_polygons or []:
        kept = [b for b in kept if not _inside(polygon, b)]
    return kept


def _inside(geometry: Any, blob: Any) -> bool:
    import shapely

    x, y = blob.centroid_xy_m
    return bool(shapely.contains_xy(geometry, x, y))


def score(
    distance_to_row_m: float, row_spacing_m: float, band_frac: float = DEFAULT_BAND_FRAC
) -> float:
    """Normalised off-row distance, clipped to [0, 1].

    Zero at the edge of the in-row band, one at the midpoint between rows. A
    blob dead centre between two rows is the strongest geometric claim
    available, and there is nothing stronger to express.

    NaN distance scores zero rather than raising. A blob with no row model
    behind it has no geometric claim at all, and a queue is the wrong place to
    discover that: :attr:`Candidate.row_confidence` carries the warning.
    """
    if row_spacing_m <= 0:
        raise ValueError("row_spacing_m must be positive")
    if not np.isfinite(distance_to_row_m):
        return 0.0
    band = band_frac * row_spacing_m
    half = row_spacing_m / 2.0
    if half <= band:
        raise ValueError(
            f"band_frac {band_frac} leaves no inter-row to score in; it must be below 0.5"
        )
    return float(np.clip((abs(distance_to_row_m) - band) / (half - band), 0.0, 1.0))


def detect(
    blobs: list,
    row_model: Any,
    boundary: Any = None,
    params: CandidateParams | None = None,
    exclusion_polygons: list | None = None,
) -> list[Candidate]:
    """Select and score off-row candidates from extracted blobs.

    A blob is a candidate when ``abs(distance_to_row_m)`` exceeds
    ``band_frac * row_spacing_m``. That is the whole rule.
    """
    params = params or DEFAULT_PARAMS
    if row_model is None:
        raise ValueError("candidates need a row model; off-row is meaningless without one")

    row_spacing_m = float(getattr(row_model, "median_pitch_m", row_model.nominal_spacing_m))
    confidence = float(getattr(row_model, "confidence", 0.0))
    if confidence < params.min_row_confidence:
        warnings.warn(
            f"row model confidence {confidence:.2f} is below {params.min_row_confidence:.2f}: "
            "these candidates are ranked by a distance to rows that were not reliably found. "
            "Low recall against this queue says nothing about whether weeds are detectable.",
            LowRowConfidence,
            stacklevel=2,
        )

    survivors = apply_exclusions(blobs, boundary, params.headland_buffer_m, exclusion_polygons)

    band = params.band_frac * row_spacing_m
    candidates = []
    for blob in survivors:
        if blob.area_m2 < params.min_area_m2:
            continue
        distance = blob.distance_to_row_m
        if not np.isfinite(distance) or abs(distance) <= band:
            continue
        candidates.append(
            Candidate(
                centroid_xy_m=blob.centroid_xy_m,
                score=score(distance, row_spacing_m, params.band_frac),
                distance_to_row_m=float(distance),
                area_m2=float(blob.area_m2),
                gsd_m=float(blob.gsd_m),
                row_confidence=confidence,
                blob=blob,
                geometry=blob.geometry,
            )
        )
    candidates.sort(key=lambda c: -c.score)
    return candidates


def to_geojson(candidates: list[Candidate], path: Any, crs: Any = None) -> Any:
    """Write candidates to GeoJSON, sorted by score descending."""
    ordered = sorted(candidates, key=lambda c: -c.score)
    properties = []
    for candidate in ordered:
        record = {
            "score": round(float(candidate.score), 6),
            "distance_to_row_m": round(float(candidate.distance_to_row_m), 5),
            "area_m2": round(float(candidate.area_m2), 6),
            "equiv_diameter_m": round(float(getattr(candidate.blob, "equiv_diameter_m", 0.0)), 5),
            "gsd_m": candidate.gsd_m,
            "row_confidence": round(float(candidate.row_confidence), 4),
            "status": "for review",
        }
        properties.append(record)
    return raster_io.write_geojson(
        path,
        [c.geometry for c in ordered],
        properties,
        crs=str(crs) if crs else None,
    )


def reviewable_acres(boundary: Any, headland_buffer_m: float = DEFAULT_HEADLAND_BUFFER_M) -> float:
    """Acres actually offered for review, after exclusions.

    The denominator for false positives per acre. Using the whole field instead
    would flatter the number by counting headlands nobody was asked to walk.
    """
    from offrow.sensor import SQUARE_METRES_PER_ACRE

    if boundary is None:
        return 0.0
    interior = raster_io.inward_buffer(boundary, headland_buffer_m)
    return float(interior.area) / SQUARE_METRES_PER_ACRE
