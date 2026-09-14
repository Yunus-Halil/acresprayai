"""Aggregating candidates into a ranked review grid.

STUB. No implementation yet.

The grid is the resolution the work actually happens at. A drone sprayer treats
ground in units of roughly ten metres, so a candidate located to the centimetre
and a candidate located to the metre produce the same treatment. Ranking cells,
not points, is what puts the operator's attention where the ground is.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

#: Review cell edge length in metres, roughly a drone sprayer's unit of work.
DEFAULT_CELL_M = 10.0


@dataclass
class ReviewCell:
    """One cell of the review grid.

    Ranked by ``max_score`` rather than by count or area: one confident
    candidate is worth a look, and ten marginal ones in a cell are usually one
    mis-fitted row rather than ten weeds.
    """

    origin_xy_m: tuple[float, float]
    size_m: float
    max_score: float
    candidate_count: int
    candidate_area_m2: float
    geometry: Any = None


def tesselate(
    bounds_m: tuple[float, float, float, float],
    cell_m: float = DEFAULT_CELL_M,
    boundary: Any = None,
) -> list[ReviewCell]:
    """Cover the field with empty review cells, clipped to the boundary."""
    raise NotImplementedError


def aggregate(
    candidates: list, cell_m: float = DEFAULT_CELL_M, boundary: Any = None
) -> list[ReviewCell]:
    """Assign candidates to cells and compute per-cell attributes."""
    raise NotImplementedError


def to_geojson(
    cells: list[ReviewCell], path: Any, crs: Any = None, drop_empty: bool = True
) -> None:
    """Write the review grid to GeoJSON, sorted by ``max_score`` descending.

    The sort order is the product. An operator works down the file and stops
    when the flags stop being worth the walk, so the ordering has to be the
    thing they can trust even when the scores are not calibrated.
    """
    raise NotImplementedError
