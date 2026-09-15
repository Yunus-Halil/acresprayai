"""Connected components and per-blob features, all in ground units.

Most of these features are not used by the current scoring, which is pure
geometry. They are computed anyway. They are the input to the one-class anomaly
step later, and extracting them now means the extraction is already validated,
already ground-unit correct, and already tested by the time anything consumes
them.

**Despeckling is the area floor, not morphology.** A structuring element
quantises to whole pixels, so a 3 mm opening is one pixel at 1.7 mm/px, one
pixel at 2.75, and zero at 5.5: the ground radius it actually applies is not
constant and cannot be made constant. A pixel count times a pixel area is
continuous in GSD, so the floor is where the speckle goes.

**Blobs touching a window border are dropped.** A blob cut by an edge has a
displaced centroid and a truncated area, and every feature computed from it is
wrong in a way nothing downstream can detect. With the overlap at least one blob
diameter, the window that owns the blob holds it whole, so nothing is lost. See
:func:`offrow.io.merge_across_seams`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from offrow import io as raster_io

#: Smallest blob kept, in square centimetres of ground.
#:
#: **The spec said 4 cm2 and that was measured to be wrong.** A weed's canopy
#: diameter is not its leaf area: a 3 cm weed drawn as a rosette covers about
#: 72 percent of its own circle, so roughly 5 cm2, and a 4 cm2 floor therefore
#: sits directly on top of the flight-spec target. Anything a little smaller
#: than nominal is deleted before it can be scored.
#:
#: Measured on a 40 m synthetic field at 5.5 mm/px, recall by weed diameter
#: against the floor, with false positives per acre in brackets:
#:
#: ===========  ==============  ==============  ==============
#: diameter     4.0 cm2 floor   2.0 cm2 floor   1.0 cm2 floor
#: ===========  ==============  ==============  ==============
#: 1.8 - 2.4     0 %             42 %            83 %
#: 2.4 - 3.0     8 %             85 %            98 %
#: 3.0 - 3.6    66 %            100 %           100 %
#: 3.6 - 4.5    98 %            100 %           100 %
#: fp per acre   0.0             0.0             0.0
#: ===========  ==============  ==============  ==============
#:
#: The floor was pure loss across that range: nothing was bought with it. Hence
#: 1 cm2, which is about a fifth of the target's leaf area and leaves the 3 cm
#: weed a clear margin.
#:
#: **That zero is a property of synthetic soil, not a promise.** Real soil has
#: stones, residue and dry clods that a chromaticity threshold will occasionally
#: call green, and the floor is what removes them. The honest way to set this is
#: the false-positives-per-acre measurement from flown imagery; until then, 1 cm2
#: is the value that does not delete the thing being looked for.
MIN_AREA_CM2 = 1.0

LBP_POINTS = 8
LBP_RADIUS = 1
#: ``local_binary_pattern(method="uniform")`` returns P + 2 codes.
LBP_BINS = LBP_POINTS + 2


@dataclass
class Blob:
    """One connected component, described in ground units throughout.

    No field here is in pixels except the LBP histogram, which is a property of
    the sampling grid and says so. The same physical plant imaged at two GSDs
    must otherwise produce the same numbers, which is only true if pixels never
    leak out of this module.
    """

    centroid_xy_m: tuple[float, float]
    area_m2: float
    equiv_diameter_m: float
    eccentricity: float
    solidity: float
    extent: float
    compactness: float
    major_axis_m: float
    minor_axis_m: float
    orientation_rel_row_deg: float

    chroma_r_mean: float
    chroma_r_std: float
    chroma_g_mean: float
    chroma_g_std: float
    chroma_b_mean: float
    chroma_b_std: float
    exg_mean: float
    exg_std: float
    lab_a_mean: float
    lab_a_std: float
    lab_b_mean: float
    lab_b_std: float
    lbp_histogram: np.ndarray

    distance_to_row_m: float
    inrow_spacing_residual_m: float

    gsd_m: float
    touches_border: bool = False
    coverage_area_m2: float = 0.0
    geometry: Any = None

    #: Order of the scalar features in :meth:`as_feature_vector`. Named so the
    #: one-class step can say which feature it leaned on.
    FEATURE_NAMES: tuple[str, ...] = field(
        default=(
            "area_m2",
            "equiv_diameter_m",
            "eccentricity",
            "solidity",
            "extent",
            "compactness",
            "major_axis_m",
            "minor_axis_m",
            "orientation_rel_row_deg",
            "chroma_r_mean",
            "chroma_r_std",
            "chroma_g_mean",
            "chroma_g_std",
            "chroma_b_mean",
            "chroma_b_std",
            "exg_mean",
            "exg_std",
            "lab_a_mean",
            "lab_a_std",
            "lab_b_mean",
            "lab_b_std",
            "distance_to_row_m",
            "inrow_spacing_residual_m",
        ),
        repr=False,
        compare=False,
    )

    @property
    def aspect_ratio(self) -> float:
        return self.major_axis_m / self.minor_axis_m if self.minor_axis_m > 0 else np.inf

    def as_feature_vector(self) -> np.ndarray:
        """Flatten to a numeric vector for the one-class step, when it exists.

        The LBP histogram is appended after the scalars. NaN is left as NaN: a
        row-relative feature with no row model is unknown, and substituting zero
        would say "exactly on the row", which is a different claim.
        """
        scalars = [getattr(self, name) for name in self.FEATURE_NAMES]
        return np.concatenate([np.asarray(scalars, dtype=np.float64), self.lbp_histogram])

    def to_feature_dict(self) -> dict[str, float]:
        return {name: float(getattr(self, name)) for name in self.FEATURE_NAMES}


def label_mask(mask: np.ndarray, connectivity: int = 2) -> np.ndarray:
    """Label connected components in a boolean mask."""
    from skimage.measure import label

    return label(np.asarray(mask, dtype=bool), connectivity=connectivity)


def min_area_px(gsd_m: float, min_area_cm2: float = MIN_AREA_CM2) -> float:
    """Convert the ground-unit area floor into pixels for this raster.

    Fractional on purpose. Rounding to a whole pixel would make the floor a
    different ground area at every GSD, which is the mistake the morphological
    kernel cannot avoid and this one can.
    """
    if gsd_m <= 0:
        raise ValueError("gsd_m must be positive")
    return (min_area_cm2 / 10000.0) / (gsd_m * gsd_m)


def array_orientation_deg(skimage_orientation_rad: float) -> float:
    """Major-axis angle in array coordinates, degrees from +x, in [0, 180).

    skimage measures orientation from the row axis and the other way round, so
    the array-frame angle is ``90 - orientation``. The same reflection as the
    Radon convention in :mod:`offrow.rows`, and wrong in the same way if
    assumed: it agrees at 0 and 90 degrees and nowhere else.
    """
    return (90.0 - math.degrees(skimage_orientation_rad)) % 180.0


def rows_mod_pixel_angle_to_ground(angle_deg: float, transform: Any) -> float:
    """Array-frame angle to ground-frame, reusing the one place that flip lives."""
    from offrow import rows as rows_mod

    return rows_mod.pixel_angle_to_ground(angle_deg, transform)


def _relative_angle(orientation_deg: float, row_angle_deg: float | None) -> float:
    """Angle between a blob's major axis and the local row, in [0, 90].

    Both are undirected, so the answer folds twice: modulo 180 because a row and
    its reverse are the same row, then reflected about 90 because an axis 100
    degrees from the row is 80 degrees from it the other way.
    """
    if row_angle_deg is None:
        return float("nan")
    diff = abs(orientation_deg - row_angle_deg) % 180.0
    return min(diff, 180.0 - diff)


def extract(
    mask: np.ndarray,
    rgb: np.ndarray,
    gsd_m: float,
    transform: Any = None,
    row_model: Any = None,
    min_area_cm2: float = MIN_AREA_CM2,
    coverage: np.ndarray | None = None,
    include_polygons: bool = False,
) -> list[Blob]:
    """Extract blobs and their features from one window.

    Args:
        mask: Boolean vegetation mask.
        rgb: The imagery the mask came from, for the colour and texture features.
        gsd_m: Ground sample distance, metres per pixel.
        transform: Raster transform, for placing centroids in ground coordinates.
            Without one, centroids come back in window-local metres.
        row_model: Fitted :class:`offrow.rows.RowModel`, for the row-relative
            features. If absent, those fields are NaN rather than zero, because
            zero means "on the row" and would be a lie.
        min_area_cm2: Ground-unit area floor. This is the despeckling.
        coverage: Optional sub-pixel coverage from :mod:`offrow.vegetation`, used
            for a GSD-stable area alongside the pixel-count one.
        include_polygons: Attach a polygon outline per blob. Off by default: the
            review queue needs a position and a score, and outlines cost time and
            file size for something no operator reads.
    """
    from skimage.color import rgb2lab
    from skimage.feature import local_binary_pattern
    from skimage.measure import regionprops

    mask = np.asarray(mask, dtype=bool)
    if mask.ndim != 2:
        raise ValueError("mask must be 2-D")
    if gsd_m <= 0:
        raise ValueError("gsd_m must be positive")
    if transform is not None:
        transform = raster_io.as_transform(transform)

    labels = label_mask(mask)
    if labels.max() == 0:
        return []

    rgb = np.asarray(rgb)[..., :3].astype(np.float32)
    total = rgb.sum(axis=2) + 1e-6
    chroma = rgb / total[..., None]
    exg = 2.0 * chroma[..., 1] - chroma[..., 0] - chroma[..., 2]
    lab = rgb2lab(np.clip(rgb / 255.0, 0.0, 1.0))
    # Integer grey on purpose. LBP compares neighbours for strict inequality, so
    # on floats the comparison turns on differences far below anything the sensor
    # could have measured, and skimage warns about exactly that.
    grey = np.clip(rgb.mean(axis=2), 0, 255).astype(np.uint8)
    # One LBP for the window, not one per blob: the operator is a local
    # neighbourhood, so it is the same answer either way and far cheaper here.
    lbp = local_binary_pattern(grey, LBP_POINTS, LBP_RADIUS, method="uniform")

    floor_px = min_area_px(gsd_m, min_area_cm2)
    height, width = mask.shape
    pixel_area = gsd_m * gsd_m

    blobs: list[Blob] = []
    for region in regionprops(labels):
        if region.area < floor_px:
            continue

        row0, col0, row1, col1 = region.bbox
        local = region.image
        rows_idx, cols_idx = np.nonzero(labels[row0:row1, col0:col1] == region.label)
        rows_abs, cols_abs = rows_idx + row0, cols_idx + col0

        centroid_row, centroid_col = region.centroid
        if transform is not None:
            cx, cy = transform.center(centroid_col, centroid_row)
        else:
            cx, cy = (centroid_col + 0.5) * gsd_m, (centroid_row + 0.5) * gsd_m

        area_m2 = float(region.area) * pixel_area
        perimeter = float(region.perimeter) * gsd_m
        compactness = perimeter**2 / (4.0 * math.pi * area_m2) if area_m2 > 0 else np.nan

        distance_m, residual_m, row_angle = _row_features(row_model, cx, cy)
        orientation_array = array_orientation_deg(region.orientation)
        orientation_ground = (
            rows_mod_pixel_angle_to_ground(orientation_array, transform)
            if transform is not None
            else orientation_array
        )
        relative = _relative_angle(orientation_ground, row_angle)

        values_lbp = lbp[rows_abs, cols_abs]
        histogram, _ = np.histogram(values_lbp, bins=LBP_BINS, range=(0, LBP_BINS), density=False)
        histogram = histogram.astype(np.float64)
        if histogram.sum() > 0:
            histogram /= histogram.sum()

        blobs.append(
            Blob(
                centroid_xy_m=(float(cx), float(cy)),
                area_m2=area_m2,
                equiv_diameter_m=float(region.equivalent_diameter_area) * gsd_m,
                eccentricity=float(region.eccentricity),
                solidity=float(region.solidity),
                extent=float(region.extent),
                compactness=float(compactness),
                major_axis_m=float(region.axis_major_length) * gsd_m,
                minor_axis_m=float(region.axis_minor_length) * gsd_m,
                orientation_rel_row_deg=float(relative),
                chroma_r_mean=float(chroma[rows_abs, cols_abs, 0].mean()),
                chroma_r_std=float(chroma[rows_abs, cols_abs, 0].std()),
                chroma_g_mean=float(chroma[rows_abs, cols_abs, 1].mean()),
                chroma_g_std=float(chroma[rows_abs, cols_abs, 1].std()),
                chroma_b_mean=float(chroma[rows_abs, cols_abs, 2].mean()),
                chroma_b_std=float(chroma[rows_abs, cols_abs, 2].std()),
                exg_mean=float(exg[rows_abs, cols_abs].mean()),
                exg_std=float(exg[rows_abs, cols_abs].std()),
                lab_a_mean=float(lab[rows_abs, cols_abs, 1].mean()),
                lab_a_std=float(lab[rows_abs, cols_abs, 1].std()),
                lab_b_mean=float(lab[rows_abs, cols_abs, 2].mean()),
                lab_b_std=float(lab[rows_abs, cols_abs, 2].std()),
                lbp_histogram=histogram,
                distance_to_row_m=distance_m,
                inrow_spacing_residual_m=residual_m,
                gsd_m=gsd_m,
                touches_border=bool(row0 == 0 or col0 == 0 or row1 == height or col1 == width),
                coverage_area_m2=(
                    float(coverage[rows_abs, cols_abs].sum()) * pixel_area
                    if coverage is not None
                    else area_m2
                ),
                geometry=_polygon(local, row0, col0, transform, gsd_m)
                if include_polygons
                else _point(cx, cy),
            )
        )
    return blobs


def _row_features(row_model: Any, cx: float, cy: float) -> tuple[float, float, float | None]:
    """Distance to row, in-row residual, and the local row angle.

    NaN when there is no model. Zero would mean "exactly on the row", which is
    the strongest possible claim to being crop, and inventing it for every blob
    would suppress every candidate in the field.
    """
    if row_model is None:
        return (np.nan, np.nan, None)
    from offrow import rows as rows_mod

    point = np.array([[cx, cy]])
    try:
        distance = float(rows_mod.signed_distance_to_row(point, row_model)[0])
        residual = float(rows_mod.inrow_spacing_residual(point, row_model)[0])
        angle = float(row_model.angle_at(cx, cy))
    except ValueError:
        return (np.nan, np.nan, None)
    return (distance, residual, angle)


def _point(cx: float, cy: float) -> Any:
    from shapely.geometry import Point

    return Point(cx, cy)


def _polygon(local_mask: np.ndarray, row0: int, col0: int, transform: Any, gsd_m: float) -> Any:
    """Outline of one blob as a ground polygon."""
    from shapely.geometry import Polygon
    from skimage.measure import find_contours

    padded = np.pad(local_mask, 1)
    contours = find_contours(padded.astype(float), 0.5)
    if not contours:
        return None
    contour = max(contours, key=len)
    points = []
    for row, col in contour:
        r, c = row - 1 + row0, col - 1 + col0
        if transform is not None:
            points.append(transform.center(c, r))
        else:
            points.append(((c + 0.5) * gsd_m, (r + 0.5) * gsd_m))
    if len(points) < 4:
        return None
    return Polygon(points).buffer(0)


def lbp_histogram(
    gray: np.ndarray, mask: np.ndarray, points: int = LBP_POINTS, radius: int = LBP_RADIUS
) -> np.ndarray:
    """Local binary pattern histogram over the masked region.

    Note the radius is in pixels, not ground units, and deliberately so: LBP
    describes the sampling grid's texture. Comparing LBP across GSDs is
    therefore not meaningful without resampling first, and that caveat travels
    with the feature.
    """
    from skimage.feature import local_binary_pattern

    codes = local_binary_pattern(
        np.clip(np.asarray(gray), 0, 255).astype(np.uint8), points, radius, "uniform"
    )
    values = codes[np.asarray(mask, dtype=bool)]
    bins = points + 2
    histogram, _ = np.histogram(values, bins=bins, range=(0, bins))
    histogram = histogram.astype(np.float64)
    return histogram / histogram.sum() if histogram.sum() > 0 else histogram


def extract_from_raster(
    path: Any,
    gsd_m: float | None = None,
    row_model: Any = None,
    boundary: Any = None,
    window_m: float = 40.0,
    max_blob_diameter_m: float = 0.60,
    params: Any = None,
    min_area_cm2: float = MIN_AREA_CM2,
    backend: str = "auto",
    global_threshold: bool = True,
) -> list[Blob]:
    """Extract blobs across a whole orthomosaic, one window at a time.

    The overlap is derived from ``max_blob_diameter_m`` rather than chosen, so
    the seam rule is stated where it is used: a blob whose centroid falls in a
    window's owned rectangle lies whole inside that window.

    ``global_threshold`` runs the histogram pass from :mod:`offrow.vegetation`
    first, so windows that are nearly all soil or nearly all canopy have
    something better than their own Otsu split to fall back on. It costs a
    second read of the raster and is worth it on a real field.
    """
    from offrow import vegetation

    overlap_m = raster_io.required_overlap_m(max_blob_diameter_m)
    if params is None:
        params = vegetation.VegetationParams()

    if global_threshold and params.global_threshold is None:
        histogram = None
        for chip in raster_io.iter_windows(
            path, window_m=window_m, overlap_m=overlap_m, boundary=boundary, backend=backend
        ):
            histogram = vegetation.accumulate_histogram(
                vegetation.combined_index(chip.array, params), histogram
            )
        if histogram is not None:
            params = vegetation.VegetationParams(
                **{
                    **params.__dict__,
                    "global_threshold": vegetation.threshold_from_histogram(histogram),
                }
            )

    chunks = []
    for chip in raster_io.iter_windows(
        path, window_m=window_m, overlap_m=overlap_m, boundary=boundary, backend=backend
    ):
        valid = (
            raster_io.clip_to_boundary(chip.array, chip.transform, boundary)
            if boundary is not None
            else None
        )
        result = vegetation.mask_window(chip.array, chip.gsd_m, params, valid=valid)
        found = extract(
            result.mask,
            chip.array,
            chip.gsd_m,
            transform=chip.transform,
            row_model=row_model,
            min_area_cm2=min_area_cm2,
            coverage=result.coverage,
        )
        chunks.append((chip, [{"blob": b, **_seam_keys(b)} for b in found]))

    merged = raster_io.merge_across_seams(chunks)
    return [entry["blob"] for entry in merged]


def _seam_keys(blob: Blob) -> dict:
    return {"centroid_xy_m": blob.centroid_xy_m, "touches_border": blob.touches_border}


def to_geojson(blobs: list[Blob], path: Any, crs: Any = None) -> Any:
    """Write blobs and their features as GeoJSON points."""
    properties = []
    for blob in blobs:
        record = blob.to_feature_dict()
        record["coverage_area_m2"] = blob.coverage_area_m2
        record["gsd_m"] = blob.gsd_m
        properties.append(record)
    return raster_io.write_geojson(
        path, [b.geometry for b in blobs], properties, crs=str(crs) if crs else None
    )


def to_geodataframe(blobs: list[Blob], crs: Any = None) -> Any:
    """Blobs as a GeoDataFrame, one row per blob."""
    import geopandas as gpd
    import pandas as pd

    if not blobs:
        return gpd.GeoDataFrame(geometry=[], crs=crs)
    frame = pd.DataFrame([b.to_feature_dict() for b in blobs])
    for index in range(LBP_BINS):
        frame[f"lbp_{index}"] = [b.lbp_histogram[index] for b in blobs]
    return gpd.GeoDataFrame(frame, geometry=[b.geometry for b in blobs], crs=crs)
