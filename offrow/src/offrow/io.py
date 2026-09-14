"""Windowed raster access, boundary clipping, and ground units.

A 100 acre field at 5 mm/px is on the order of 16 billion pixels, so no code
path in this repo may load a full raster. Everything reads through windows with
overlap, and blobs that straddle a window boundary are merged rather than
double-counted or truncated. That merge is the single most likely source of a
silent wrong answer in this repo, which is why it lives in one place.

**Two backends, one interface.** ``rasterio`` is the right library and is used
whenever it loads. On a machine where an Application Control policy blocks the
GDAL DLLs it does not load at all, so there is a ``tifffile`` backend that reads
a tiled TIFF segment by segment and takes its georeferencing from GeoTIFF tags
or from a ``.tfw`` world file. The choice is made at runtime and reported by
:func:`active_backend`; it is never silent.

The seam logic is deliberately in this module rather than in either backend, so
both are correct for the same reason and the window-seam test covers both.
"""

from __future__ import annotations

import json
import math
import warnings
from abc import ABC, abstractmethod
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

#: Largest x/y scale mismatch tolerated before a raster is refused. Anisotropic
#: pixels would make "one number of metres per pixel" a lie, and every
#: ground-unit threshold in the repo is built on that number being true.
ANISOTROPY_TOLERANCE = 1e-6


class MissingGeoreference(RuntimeError):
    """Raised when a raster carries no usable transform.

    Not recoverable by guessing. A result without a GSD attached is not a
    result, and inventing a pixel size would make every ground-unit threshold
    downstream quietly wrong.
    """


# --------------------------------------------------------------------------
# Geometry primitives that do not need GDAL
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Transform:
    """An affine raster transform.

    Field names and meaning match ``affine.Affine`` exactly, so anything that
    reads ``.a`` and ``.e`` works with either this or rasterio's::

        x = a * col + b * row + c
        y = d * col + e * row + f

    For a north-up raster ``a`` is the pixel size and ``e`` is its negative.
    """

    a: float
    b: float
    c: float
    d: float
    e: float
    f: float

    @classmethod
    def from_origin(cls, west: float, north: float, xsize: float, ysize: float) -> Transform:
        """North-up transform from the top-left corner and pixel size."""
        return cls(xsize, 0.0, west, 0.0, -ysize, north)

    def xy(self, col: float, row: float) -> tuple[float, float]:
        """Ground coordinate of a pixel's top-left corner."""
        return (
            self.a * col + self.b * row + self.c,
            self.d * col + self.e * row + self.f,
        )

    def center(self, col: float, row: float) -> tuple[float, float]:
        """Ground coordinate of a pixel's centre."""
        return self.xy(col + 0.5, row + 0.5)

    def rowcol(self, x: float, y: float) -> tuple[float, float]:
        """Fractional pixel coordinate of a ground position."""
        determinant = self.a * self.e - self.b * self.d
        if determinant == 0:
            raise ValueError("degenerate transform")
        dx, dy = x - self.c, y - self.f
        col = (self.e * dx - self.b * dy) / determinant
        row = (-self.d * dx + self.a * dy) / determinant
        return (row, col)

    def translated(self, col_off: int, row_off: int) -> Transform:
        """The transform of a window starting at ``(col_off, row_off)``."""
        west, north = self.xy(col_off, row_off)
        return Transform(self.a, self.b, west, self.d, self.e, north)


@dataclass(frozen=True)
class Window:
    """A rectangle of pixels. Named to match ``rasterio.windows.Window``."""

    col_off: int
    row_off: int
    width: int
    height: int

    @property
    def col_end(self) -> int:
        return self.col_off + self.width

    @property
    def row_end(self) -> int:
        return self.row_off + self.height


def as_transform(value: Any) -> Transform:
    """Coerce anything six-coefficient into this module's :class:`Transform`.

    Accepts ``affine.Affine``, a plain tuple, or a :class:`Transform`. The point
    of the seam is that only the readers ever see a backend's own type.
    """
    if isinstance(value, Transform):
        return value
    coefficients = tuple(value)[:6]
    if len(coefficients) != 6:
        raise ValueError("a transform needs six coefficients")
    return Transform(*(float(v) for v in coefficients))


def gsd_m(transform: Any) -> float:
    """Ground sample distance in metres from a raster transform.

    Raises:
        ValueError: If the transform is anisotropic or rotated beyond tolerance.
    """
    x_scale = abs(transform.a)
    y_scale = abs(transform.e)
    if x_scale <= 0 or y_scale <= 0:
        raise ValueError("transform has a zero pixel size")
    if abs(x_scale - y_scale) / max(x_scale, y_scale) > ANISOTROPY_TOLERANCE:
        raise ValueError(
            f"anisotropic pixels: {x_scale} by {y_scale}. Every ground-unit threshold in "
            "this repo assumes one metres-per-pixel number; resample before continuing."
        )
    if abs(getattr(transform, "b", 0.0)) > 0 or abs(getattr(transform, "d", 0.0)) > 0:
        raise ValueError("rotated transform; north-up only")
    return float(x_scale)


def m_to_px(metres: float, transform: Any) -> float:
    """Convert a ground distance to pixels for this raster.

    All thresholds in this repo are stated in ground units and converted at the
    call site. This is that conversion.
    """
    return metres / gsd_m(transform)


def px_to_m(pixels: float, transform: Any) -> float:
    """Convert pixels to a ground distance for this raster."""
    return pixels * gsd_m(transform)


# --------------------------------------------------------------------------
# Backends
# --------------------------------------------------------------------------


def rasterio_available() -> bool:
    """Whether rasterio can actually load, not merely whether it is installed."""
    try:
        import rasterio  # noqa: F401
    except Exception:
        return False
    return True


class RasterReader(ABC):
    """Read-only windowed access to one raster. The seam between the backends."""

    backend_name: str
    width: int
    height: int
    count: int
    dtype: Any
    transform: Any
    crs: Any

    @abstractmethod
    def read(self, window: Window, bands: Sequence[int] = (1, 2, 3)) -> np.ndarray:
        """Read one window as ``HxWxC``. Bands are 1-based, as rasterio counts them."""

    @abstractmethod
    def close(self) -> None: ...

    def __enter__(self) -> RasterReader:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    @property
    def gsd_m(self) -> float:
        return gsd_m(self.transform)

    @property
    def bounds_m(self) -> tuple[float, float, float, float]:
        """``(minx, miny, maxx, maxy)`` in ground units."""
        x0, y0 = self.transform.xy(0, 0)
        x1, y1 = self.transform.xy(self.width, self.height)
        return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


class _RasterioReader(RasterReader):
    backend_name = "rasterio"

    def __init__(self, path: Path):
        import rasterio

        self._dataset = rasterio.open(path)
        self.width = self._dataset.width
        self.height = self._dataset.height
        self.count = self._dataset.count
        self.dtype = np.dtype(self._dataset.dtypes[0])
        # Normalised to this module's Transform at the seam, so nothing
        # downstream has to know which backend produced it. affine.Affine has
        # the same six coefficients and none of the helpers.
        self.transform = Transform(*tuple(self._dataset.transform)[:6])
        self.crs = str(self._dataset.crs) if self._dataset.crs else None

    def read(self, window: Window, bands: Sequence[int] = (1, 2, 3)) -> np.ndarray:
        from rasterio.windows import Window as RioWindow

        bands = tuple(b for b in bands if b <= self.count)
        array = self._dataset.read(
            bands,
            window=RioWindow(window.col_off, window.row_off, window.width, window.height),
        )
        return np.transpose(array, (1, 2, 0))

    def close(self) -> None:
        self._dataset.close()


class _TifffileReader(RasterReader):
    """Windowed reads from a tiled or striped TIFF, without GDAL.

    Decodes only the segments a window touches. A tiled file gives tile-sized
    segments; a striped file gives full-width strips, which is wasteful across
    but still bounded, and either way the whole raster never lands in memory.
    """

    backend_name = "tifffile"

    def __init__(self, path: Path, transform: Any = None, crs: Any = None):
        import tifffile

        self._tif = tifffile.TiffFile(path)
        page = self._tif.pages[0]
        self._page = page
        self.height = int(page.imagelength)
        self.width = int(page.imagewidth)
        self.count = int(page.samplesperpixel)
        self.dtype = np.dtype(page.dtype)
        self.transform = (
            as_transform(transform) if transform is not None else _read_transform(path, page)
        )
        self.crs = crs if crs is not None else _read_crs(path, page)

        if int(getattr(page, "planarconfig", 1)) != 1:
            raise NotImplementedError(
                "planar (band-sequential) TIFFs are not supported by this backend"
            )
        if page.is_tiled:
            self._seg_h = int(page.tilelength)
            self._seg_w = int(page.tilewidth)
        else:
            self._seg_h = int(page.rowsperstrip or self.height)
            self._seg_w = self.width
        self._cols = math.ceil(self.width / self._seg_w)

    def _segment_origin(self, index: int) -> tuple[int, int]:
        row, col = divmod(index, self._cols)
        return (row * self._seg_h, col * self._seg_w)

    def read(self, window: Window, bands: Sequence[int] = (1, 2, 3)) -> np.ndarray:
        page = self._page
        handle = self._tif.filehandle
        bands = tuple(b for b in bands if b <= self.count)
        out = np.zeros((window.height, window.width, len(bands)), dtype=self.dtype)
        picked = [b - 1 for b in bands]

        first_row = window.row_off // self._seg_h
        last_row = (window.row_end - 1) // self._seg_h
        first_col = window.col_off // self._seg_w
        last_col = (window.col_end - 1) // self._seg_w

        for seg_row in range(first_row, last_row + 1):
            for seg_col in range(first_col, last_col + 1):
                index = seg_row * self._cols + seg_col
                if index >= len(page.dataoffsets):
                    continue
                count = int(page.databytecounts[index])
                if count == 0:
                    continue
                handle.seek(int(page.dataoffsets[index]))
                segment, indices, _shape = page.decode(handle.read(count), index)
                segment = np.asarray(segment)
                if segment.ndim == 4:
                    segment = segment[0]
                if segment.ndim == 2:
                    segment = segment[..., None]
                y0, x0 = int(indices[-3]), int(indices[-2])

                # Intersect the segment with the requested window, in raster
                # coordinates, then copy the overlap across.
                sy0 = max(window.row_off, y0)
                sy1 = min(window.row_end, y0 + segment.shape[0], self.height)
                sx0 = max(window.col_off, x0)
                sx1 = min(window.col_end, x0 + segment.shape[1], self.width)
                if sy1 <= sy0 or sx1 <= sx0:
                    continue
                out[
                    sy0 - window.row_off : sy1 - window.row_off,
                    sx0 - window.col_off : sx1 - window.col_off,
                ] = segment[sy0 - y0 : sy1 - y0, sx0 - x0 : sx1 - x0, picked]
        return out

    def close(self) -> None:
        self._tif.close()


def _read_transform(path: Path, page: Any) -> Transform:
    """Georeferencing from GeoTIFF tags, or from a ``.tfw`` world file."""
    tags = getattr(page, "geotiff_tags", None) or {}
    scale = tags.get("ModelPixelScale")
    tiepoint = tags.get("ModelTiepoint")
    if scale is not None and tiepoint is not None and len(tiepoint) >= 6:
        return Transform.from_origin(
            float(tiepoint[3]), float(tiepoint[4]), float(scale[0]), float(scale[1])
        )

    for suffix in (".tfw", ".tifw", ".wld"):
        sidecar = path.with_suffix(suffix)
        if sidecar.exists():
            values = [float(line) for line in sidecar.read_text().split() if line.strip()]
            if len(values) >= 6:
                a, d, b, e, c, f = values[:6]
                # World files give the centre of the top-left pixel; this repo's
                # transforms are corner-anchored, like rasterio's.
                return Transform(a, b, c - a / 2.0 - b / 2.0, d, e, f - d / 2.0 - e / 2.0)

    raise MissingGeoreference(
        f"{path} has no GeoTIFF tags and no world file. A raster without a transform "
        "has no ground units, and this repo will not invent one."
    )


def _read_crs(path: Path, page: Any) -> Any:
    for suffix in (".prj",):
        sidecar = path.with_suffix(suffix)
        if sidecar.exists():
            return sidecar.read_text(encoding="utf-8").strip()
    tags = getattr(page, "geotiff_tags", None) or {}
    code = tags.get("ProjectedCSTypeGeoKey")
    return f"EPSG:{code}" if code else None


def open_raster(
    path: Path | str, backend: str = "auto", transform: Any = None, crs: Any = None
) -> RasterReader:
    """Open a raster for windowed reading.

    Args:
        path: Raster to open.
        backend: ``"rasterio"``, ``"tifffile"``, or ``"auto"`` to prefer rasterio
            when it loads.
        transform: Override the file's georeferencing. For tests and for rasters
            that carry none.
        crs: Override the file's CRS.

    Raises:
        RuntimeError: If ``backend="rasterio"`` is asked for and cannot load.
    """
    path = Path(path)
    if backend not in ("auto", "rasterio", "tifffile"):
        raise ValueError(f"unknown backend {backend!r}")
    if backend == "rasterio" and not rasterio_available():
        raise RuntimeError(
            "rasterio cannot load here. Use backend='tifffile' or 'auto'; the tifffile "
            "backend reads tiled TIFFs window by window and takes georeferencing from "
            "GeoTIFF tags or a .tfw world file."
        )
    use_rasterio = rasterio_available() if backend == "auto" else backend == "rasterio"
    if use_rasterio:
        reader = _RasterioReader(path)
        if transform is not None:
            reader.transform = as_transform(transform)
        if crs is not None:
            reader.crs = crs
        return reader
    return _TifffileReader(path, transform=transform, crs=crs)


def active_backend() -> str:
    """Which backend :func:`open_raster` will choose on ``"auto"``."""
    return "rasterio" if rasterio_available() else "tifffile"


# --------------------------------------------------------------------------
# Windows
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class WindowChip:
    """One window of a raster, carrying everything needed to georeference it."""

    array: np.ndarray
    transform: Any
    window: Window
    gsd_m: float
    crs: Any = None
    #: Ground rectangle this chip owns, as ``(minx, miny, maxx, maxy)``. The
    #: owned rectangles tile the raster exactly, with no gaps and no overlaps.
    interior_bounds_m: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)
    index: tuple[int, int] = (0, 0)

    @property
    def bounds_m(self) -> tuple[float, float, float, float]:
        """Full ground extent of the chip, overlap included."""
        x0, y0 = self.transform.xy(0, 0)
        x1, y1 = self.transform.xy(self.array.shape[1], self.array.shape[0])
        return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))

    @property
    def interior_slice(self) -> tuple[slice, slice]:
        """The part of this chip's array that lies inside its owned rectangle.

        Features are kept from the chip whose owned rectangle contains their
        centroid, which is what makes the seam merge deterministic.
        """
        minx, miny, maxx, maxy = self.interior_bounds_m
        row_a, col_a = self.transform.rowcol(minx, maxy)
        row_b, col_b = self.transform.rowcol(maxx, miny)
        top = max(int(round(min(row_a, row_b))), 0)
        bottom = min(int(round(max(row_a, row_b))), self.array.shape[0])
        left = max(int(round(min(col_a, col_b))), 0)
        right = min(int(round(max(col_a, col_b))), self.array.shape[1])
        return (slice(top, bottom), slice(left, right))

    def owns(self, x_m: float, y_m: float) -> bool:
        """Whether a ground position falls in this chip's owned rectangle.

        Half-open on the top and right so that a point on a shared edge belongs
        to exactly one chip.
        """
        minx, miny, maxx, maxy = self.interior_bounds_m
        return minx <= x_m < maxx and miny <= y_m < maxy


def iter_windows(
    path: Path | str,
    window_m: float = 100.0,
    overlap_m: float = 2.0,
    boundary: Any = None,
    bands: Sequence[int] = (1, 2, 3),
    backend: str = "auto",
    reader: RasterReader | None = None,
) -> Iterator[WindowChip]:
    """Yield overlapping windows across a raster, in ground units.

    Args:
        path: Raster to read.
        window_m: Window edge length in metres, not pixels.
        overlap_m: Overlap between neighbouring windows. Must be at least the
            largest expected blob *diameter*: a chip's owned rectangle is inset
            half the overlap from its array edge, so a blob whose centroid is
            owned lies whole inside the chip when its radius is at most half the
            overlap.
        boundary: Optional field boundary geometry; windows that miss it are
            skipped without being read.
        bands: Band indices to read, 1-based.
        backend: Passed to :func:`open_raster`.
        reader: An already-open reader, used instead of opening ``path``.

    Yields:
        :class:`WindowChip` per window, in row-major order.
    """
    if window_m <= 0:
        raise ValueError("window_m must be positive")
    if overlap_m < 0:
        raise ValueError("overlap_m must not be negative")
    if overlap_m >= window_m:
        raise ValueError("overlap_m must be smaller than window_m")

    owned = reader is None
    reader = reader or open_raster(path, backend=backend)
    try:
        gsd = reader.gsd_m
        window_px = max(int(round(window_m / gsd)), 1)
        overlap_px = int(round(overlap_m / gsd))

        col_spans = _spans(reader.width, window_px, overlap_px)
        row_spans = _spans(reader.height, window_px, overlap_px)
        col_bounds = _owned_bounds(col_spans, reader.width)
        row_bounds = _owned_bounds(row_spans, reader.height)

        prepared = _prepare(boundary)

        for row_index, (row_off, height) in enumerate(row_spans):
            for col_index, (col_off, width) in enumerate(col_spans):
                window = Window(col_off, row_off, width, height)
                transform = reader.transform.translated(col_off, row_off)

                left_px, right_px = col_bounds[col_index]
                top_px, bottom_px = row_bounds[row_index]
                x0, y0 = reader.transform.xy(left_px, top_px)
                x1, y1 = reader.transform.xy(right_px, bottom_px)
                interior = (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))

                if prepared is not None and not _intersects(prepared, transform, width, height):
                    continue

                yield WindowChip(
                    array=reader.read(window, bands),
                    transform=transform,
                    window=window,
                    gsd_m=gsd,
                    crs=reader.crs,
                    interior_bounds_m=interior,
                    index=(col_index, row_index),
                )
    finally:
        if owned:
            reader.close()


def _spans(extent_px: int, window_px: int, overlap_px: int) -> list[tuple[int, int]]:
    """Window offsets and widths along one axis.

    The final window is pulled back to end at the raster edge rather than
    hanging off it, which makes its overlap with the previous one larger than
    nominal. Larger is safe; the seam only needs a lower bound.
    """
    stride = max(window_px - overlap_px, 1)
    if extent_px <= window_px:
        return [(0, extent_px)]
    offsets = []
    offset = 0
    while True:
        if offset + window_px >= extent_px:
            offsets.append(extent_px - window_px)
            break
        offsets.append(offset)
        offset += stride
    # Clamping can duplicate the last offset when the raster divides evenly.
    deduped = sorted(set(offsets))
    return [(o, min(window_px, extent_px - o)) for o in deduped]


def _owned_bounds(spans: list[tuple[int, int]], extent_px: int) -> list[tuple[float, float]]:
    """Ownership boundaries between consecutive windows, in pixels.

    The boundary between two neighbours is the midpoint of the ground they
    actually share, computed from the offsets that were used rather than from
    the nominal stride. Clamping the last window changes its overlap, and an
    ownership rule that ignored that would leave two windows owning the same
    ground and every blob there counted twice.
    """
    bounds = []
    for index, (offset, width) in enumerate(spans):
        left = (
            0.0
            if index == 0
            else (spans[index][0] + spans[index - 1][0] + spans[index - 1][1]) / 2.0
        )
        if index == len(spans) - 1:
            right = float(extent_px)
        else:
            right = (spans[index + 1][0] + offset + width) / 2.0
        bounds.append((left, right))
    return bounds


def window_count(width: int, height: int, window_px: int, overlap_px: int) -> tuple[int, int]:
    """How many windows :func:`iter_windows` will produce. Useful for progress."""
    return (
        len(_spans(width, window_px, overlap_px)),
        len(_spans(height, window_px, overlap_px)),
    )


# --------------------------------------------------------------------------
# Boundaries
# --------------------------------------------------------------------------


def _prepare(boundary: Any) -> Any:
    if boundary is None:
        return None
    from shapely import prepare

    prepare(boundary)
    return boundary


def _intersects(boundary: Any, transform: Any, width: int, height: int) -> bool:
    from shapely.geometry import box

    x0, y0 = transform.xy(0, 0)
    x1, y1 = transform.xy(width, height)
    return boundary.intersects(box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)))


def clip_to_boundary(
    array: np.ndarray, transform: Any, boundary: Any, invert: bool = False
) -> np.ndarray:
    """Mask array pixels outside (or inside, if ``invert``) a boundary geometry.

    Returns a boolean mask of the same height and width, True where the pixel is
    kept. The array itself is not modified: a caller masking imagery and a
    caller masking a vegetation mask want different fill values, and this module
    should not pick one for them.
    """
    import shapely

    height, width = array.shape[:2]
    cols = np.arange(width, dtype=np.float64) + 0.5
    rows = np.arange(height, dtype=np.float64) + 0.5
    xx = transform.a * cols[None, :] + transform.b * rows[:, None] + transform.c
    yy = transform.d * cols[None, :] + transform.e * rows[:, None] + transform.f
    inside = shapely.contains_xy(boundary, xx, yy)
    return ~inside if invert else inside


def inward_buffer(boundary: Any, buffer_m: float) -> Any:
    """Shrink a boundary by ``buffer_m`` metres.

    Headlands and end rows are where the crop geometry stops being a grid, and
    therefore where most early false positives live. Excluding them is cheaper
    than explaining them.

    A buffer large enough to consume the field returns an empty geometry rather
    than raising: a 15 m headland on a 20 m plot legitimately leaves nothing,
    and the caller should see an empty field, not a crash.
    """
    if buffer_m <= 0:
        return boundary
    shrunk = boundary.buffer(-buffer_m)
    if shrunk.is_empty:
        warnings.warn(
            f"inward buffer of {buffer_m} m consumed the whole boundary; no ground left to inspect",
            stacklevel=2,
        )
    return shrunk


# --------------------------------------------------------------------------
# Seams
# --------------------------------------------------------------------------


def merge_across_seams(
    chunks: Sequence[tuple[WindowChip, Sequence[dict]]],
    drop_border_touching: bool = True,
) -> list[dict]:
    """Deduplicate per-window features into one list covering the whole raster.

    A feature is kept from the chip whose owned rectangle contains its centroid.
    Owned rectangles tile the raster exactly, so every feature is kept once and
    only once.

    Features flagged ``touches_border`` are dropped first. A blob cut by a
    window edge has a displaced centroid and a truncated area, so it cannot be
    trusted even if its centroid happens to land in the owned rectangle. Nothing
    is lost by dropping it: with the overlap at least one blob diameter, every
    blob appears whole in the chip that owns it.

    Args:
        chunks: ``(chip, features)`` pairs. Each feature is a dict with
            ``centroid_xy_m`` and optionally ``touches_border``.
        drop_border_touching: Set False only when the features are known whole,
            for instance on a single-window run.
    """
    merged: list[dict] = []
    for chip, features in chunks:
        for feature in features:
            if drop_border_touching and feature.get("touches_border"):
                continue
            x_m, y_m = feature["centroid_xy_m"]
            if chip.owns(x_m, y_m):
                merged.append(feature)
    return merged


def required_overlap_m(max_blob_diameter_m: float, safety: float = 1.25) -> float:
    """Overlap that guarantees a blob of this size appears whole in one window.

    The owned rectangle is inset half the overlap from the array edge, so a blob
    of radius ``r`` centred in the owned region is whole when the overlap is at
    least ``2r``. The safety factor covers the rounding from metres to pixels.
    """
    if max_blob_diameter_m <= 0:
        raise ValueError("max_blob_diameter_m must be positive")
    return max_blob_diameter_m * safety


# --------------------------------------------------------------------------
# GeoJSON, without fiona or pyogrio
# --------------------------------------------------------------------------


def read_geojson(path: Path | str) -> tuple[list[Any], list[dict], str | None]:
    """Read a GeoJSON file into shapely geometries and property dicts.

    Hand-rolled because ``pyogrio`` needs GDAL and GDAL does not load on every
    machine this has to run on. ``shapely.geometry.shape`` needs nothing.

    Returns:
        ``(geometries, properties, crs_name)``.
    """
    from shapely.geometry import shape

    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    features = payload.get("features", [])
    geometries = [shape(f["geometry"]) for f in features if f.get("geometry")]
    properties = [f.get("properties", {}) or {} for f in features if f.get("geometry")]
    crs = None
    crs_block = payload.get("crs")
    if isinstance(crs_block, dict):
        crs = (crs_block.get("properties") or {}).get("name")
    return geometries, properties, crs


def write_geojson(
    path: Path | str,
    geometries: Sequence[Any],
    properties: Sequence[dict] | None = None,
    crs: str | None = None,
) -> Path:
    """Write shapely geometries and properties as GeoJSON."""
    from shapely.geometry import mapping

    properties = properties or [{} for _ in geometries]
    payload: dict[str, Any] = {
        "type": "FeatureCollection",
        "name": Path(path).stem,
        "features": [
            {"type": "Feature", "geometry": mapping(geom), "properties": dict(props)}
            for geom, props in zip(geometries, properties, strict=True)
        ],
    }
    if crs:
        payload["crs"] = {"type": "name", "properties": {"name": crs}}
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def read_boundary(path: Path | str) -> Any:
    """Read a boundary file as one geometry, unioning multiple features."""
    from shapely.ops import unary_union

    geometries, _, _ = read_geojson(path)
    if not geometries:
        raise ValueError(f"{path} contains no geometry")
    return unary_union(geometries)
