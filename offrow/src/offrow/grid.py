"""Aggregating candidates into a ranked review grid.

The grid is the resolution the work actually happens at. A drone sprayer treats
ground in units of roughly ten metres, so a candidate located to the centimetre
and a candidate located to the metre produce the same treatment. Ranking cells,
not points, is what puts the operator's attention where the ground is.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from offrow import io as raster_io

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
    max_score: float = 0.0
    candidate_count: int = 0
    candidate_area_m2: float = 0.0
    geometry: Any = None

    @property
    def centre_xy_m(self) -> tuple[float, float]:
        half = self.size_m / 2.0
        return (self.origin_xy_m[0] + half, self.origin_xy_m[1] + half)

    @property
    def is_empty(self) -> bool:
        return self.candidate_count == 0


def _cell_polygon(x0: float, y0: float, size_m: float) -> Any:
    from shapely.geometry import box

    return box(x0, y0, x0 + size_m, y0 + size_m)


def tesselate(
    bounds_m: tuple[float, float, float, float],
    cell_m: float = DEFAULT_CELL_M,
    boundary: Any = None,
) -> list[ReviewCell]:
    """Cover the field with empty review cells, clipped to the boundary.

    Cells are anchored to a multiple of ``cell_m`` in the CRS rather than to the
    field's own corner, so two fields that share a border get cells that line up
    and an operator's ground unit means the same thing in both.
    """
    if cell_m <= 0:
        raise ValueError("cell_m must be positive")
    minx, miny, maxx, maxy = bounds_m
    x_start = math.floor(minx / cell_m) * cell_m
    y_start = math.floor(miny / cell_m) * cell_m

    cells = []
    y = y_start
    while y < maxy:
        x = x_start
        while x < maxx:
            polygon = _cell_polygon(x, y, cell_m)
            if boundary is None or boundary.intersects(polygon):
                cells.append(ReviewCell(origin_xy_m=(x, y), size_m=cell_m, geometry=polygon))
            x += cell_m
        y += cell_m
    return cells


def aggregate(
    candidates: list,
    cell_m: float = DEFAULT_CELL_M,
    boundary: Any = None,
    bounds_m: tuple[float, float, float, float] | None = None,
) -> list[ReviewCell]:
    """Assign candidates to cells and compute per-cell attributes.

    Cells are keyed by their snapped origin, so a candidate lands in exactly one
    cell and no candidate can be counted twice or dropped between cells.
    """
    if bounds_m is None and boundary is not None:
        bounds_m = boundary.bounds
    if bounds_m is None:
        if not candidates:
            return []
        xs = [c.centroid_xy_m[0] for c in candidates]
        ys = [c.centroid_xy_m[1] for c in candidates]
        bounds_m = (min(xs), min(ys), max(xs) + cell_m, max(ys) + cell_m)

    cells = {cell.origin_xy_m: cell for cell in tesselate(bounds_m, cell_m, boundary)}
    for candidate in candidates:
        x, y = candidate.centroid_xy_m
        key = (math.floor(x / cell_m) * cell_m, math.floor(y / cell_m) * cell_m)
        cell = cells.get(key)
        if cell is None:
            # A candidate outside the tesselated bounds, which can happen when
            # bounds came from a boundary the detector did not clip to. Give it
            # a cell rather than losing it.
            cell = ReviewCell(
                origin_xy_m=key, size_m=cell_m, geometry=_cell_polygon(key[0], key[1], cell_m)
            )
            cells[key] = cell
        cell.candidate_count += 1
        cell.candidate_area_m2 += float(candidate.area_m2)
        cell.max_score = max(cell.max_score, float(candidate.score))
    return list(cells.values())


def rank(cells: list[ReviewCell], drop_empty: bool = True) -> list[ReviewCell]:
    """Order cells the way an operator works down them.

    ``max_score`` first, then candidate count, then area. The tie-breaks matter
    on a real field: plenty of cells share a top score, and among those the one
    with more to look at is the better next stop.
    """
    kept = [c for c in cells if not (drop_empty and c.is_empty)]
    return sorted(kept, key=lambda c: (-c.max_score, -c.candidate_count, -c.candidate_area_m2))


def to_geojson(cells: list[ReviewCell], path: Any, crs: Any = None, drop_empty: bool = True) -> Any:
    """Write the review grid to GeoJSON, sorted by ``max_score`` descending.

    The sort order is the product. An operator works down the file and stops
    when the flags stop being worth the walk, so the ordering has to be the
    thing they can trust even when the scores are not calibrated.
    """
    ordered = rank(cells, drop_empty=drop_empty)
    properties = [
        {
            "rank": index + 1,
            "max_score": round(float(cell.max_score), 6),
            "candidate_count": int(cell.candidate_count),
            "candidate_area_m2": round(float(cell.candidate_area_m2), 6),
            "cell_m": cell.size_m,
            "status": "for review",
        }
        for index, cell in enumerate(ordered)
    ]
    return raster_io.write_geojson(
        path, [c.geometry for c in ordered], properties, crs=str(crs) if crs else None
    )


def summary(cells: list[ReviewCell]) -> dict[str, float]:
    """What the queue looks like, for a report line."""
    ranked = rank(cells)
    total = len(cells)
    return {
        "cells_total": float(total),
        "cells_flagged": float(len(ranked)),
        "flagged_fraction": float(len(ranked) / total) if total else 0.0,
        "max_score": float(ranked[0].max_score) if ranked else 0.0,
        "candidates": float(sum(c.candidate_count for c in ranked)),
        "candidate_area_m2": float(sum(c.candidate_area_m2 for c in ranked)),
    }
