"""Synthetic field generator: the development fixture and the source of exact truth.

Synthetic scenes exist for three reasons. The tests need ground truth that is
known rather than annotated. The known false-positive sources (shadows, wheel
tracks, wet patches) have to be switchable to be studied. And the public sets do
not contain the problem this system is specified against: USU has zero labelled
weeds under 8 cm, against a 3 cm seedling target, so the hard regime is only
testable here.

That last one sets the default. :attr:`SceneParams.weed_diameter_m` is 3 cm,
matching the flight spec rather than the 15 to 38 cm distribution the public
sets happen to contain.

Two design rules make the renders worth trusting:

**Everything is drawn in ground coordinates.** Soil texture comes from a noise
field anchored to the ground, not to the pixel grid, so the same scene rendered
at two GSDs is the same ground, sampled twice, rather than two unrelated
fields that happen to share a seed.

**Edges are antialiased analytically.** Coverage per pixel comes from a signed
distance function, so a 3 cm weed at 11 mm/px is a soft two-and-a-half-pixel
smudge with the right total area, not a hard dot drawn at whatever size the
pixel grid allows. Without this, ground-unit area invariance across GSD is
impossible and every threshold in the repo would be untestable.

Synthetic drives development and tests. It does not produce reportable accuracy
numbers. Anything quoted outside this repo comes from the public datasets.
"""

from __future__ import annotations

import json
import math
from collections.abc import Iterator
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np

from offrow.datasets import TARGET_WEED_DIAMETER_M, diameter_bin, diameter_bin_labels

SQUARE_METRES_PER_ACRE = 4046.8564224

#: Default projected CRS for generated scenes. A real projected CRS in metres,
#: so shapely, geopandas and rasterio all behave as they will on real orthos.
DEFAULT_CRS = "EPSG:32614"
DEFAULT_ORIGIN_XY = (500000.0, 4400000.0)

#: Block edge for rendering, in pixels. Scenes are rendered and written block by
#: block: two acres at 5.5 mm/px is 267 megapixels, and the repo does not get to
#: break its own rule about full-raster loads just because it is the one writing.
RENDER_BLOCK_PX = 1024


@dataclass(frozen=True)
class SceneParams:
    """Everything about a synthetic field except the GSD it is rendered at.

    Separating the scene from the render resolution is the point: the same scene
    can be rendered natively at several GSDs, which is how a resolution question
    gets asked of a detector without confounding it with a different field.

    Args:
        acres: Field size. Ignored if ``width_m`` and ``height_m`` are given.
        width_m: Explicit field width. Overrides ``acres``.
        height_m: Explicit field height. Overrides ``acres``.
        row_spacing_m: Nominal planted row spacing.
        row_angle_deg: Row direction, degrees counterclockwise from the x axis.
        inrow_spacing_m: Nominal within-row plant spacing.
        spacing_jitter_frac: Random displacement as a fraction of spacing.
        skip_rate: Fraction of plant positions left empty, as a planter would.
        crop_diameter_m: Canopy diameter of a crop plant at the target stage.
            12 cm is around V4.
        crop_diameter_cv: Coefficient of variation on crop size.
        crop_leaves: Leaves drawn per crop plant.
        crop_height_ratio: Plant height as a multiple of canopy diameter. Sets
            shadow length, so it matters even though nothing here is 3D.
        crop_leaf_spread_deg: Corn is distichous: leaves alternate on two sides
            rather than radiating evenly, so from above a V4 plant is two fans
            on a common axis, not a star. The row it sits in looks different as
            a result, which is the reason to bother.
        weed_density_per_m2: Weed plants per square metre.
        weed_offrow_bias: 0 places weeds uniformly across the row spacing, 1
            places them all at the inter-row midpoint. Sweeping this is how the
            detector's dependence on the geometry being true gets measured. The
            default of 0.5 leaves roughly a fifth of weeds inside the in-row
            band on purpose: a scene where every weed is off-row cannot produce
            an in-row false negative, and in-row weeds are exactly the failure
            mode a geometric detector has.
        weed_diameter_m: Mean weed canopy diameter. Defaults to the flight-spec
            target, deliberately not to what the public sets contain.
        weed_diameter_cv: Coefficient of variation on weed size.
        weed_diameter_min_m: Lower clamp, so a sampled diameter never goes
            negative or absurdly subpixel.
        weed_diameter_max_m: Upper clamp.
        weed_leaves: Leaves drawn per weed.
        shadows: Directional shadows cast by plants.
        sun_azimuth_deg: Shadow direction.
        sun_elevation_deg: Sun height, which sets shadow length.
        shadow_strength: How much a shadow darkens what it falls on.
        shadow_softness_m: Penumbra width. A shadow with a hard edge reads as a
            second dark plant, and a row of those puts a spurious second peak
            into the projection profile at half the true row pitch, which is
            exactly the harmonic the pitch check exists to catch. Real
            penumbrae are soft; making these soft keeps the shadow test a test
            of shadows rather than of an artefact.
        wheel_tracks: Compacted wheel tracks parallel to the rows. A false
            positive source for the row model rather than for the mask: they are
            linear, parallel and at a different pitch, so the Radon peak can
            land on them.
        wheel_track_every_rows: Track pair spacing, in rows. A 12 row planter
            leaves tracks every 12 rows.
        wheel_track_width_m: Width of one track.
        wet_patches: Dark soil patches that fool an intensity threshold.
        wet_patch_scale_m: Size of the patches.
        wet_patch_fraction: Roughly what fraction of the field is wet.
        soil_texture_scale_m: Base scale of the soil noise.
        seed: Reproducibility.
    """

    acres: float = 2.0
    width_m: float | None = None
    height_m: float | None = None

    row_spacing_m: float = 0.762
    row_angle_deg: float = 0.0
    inrow_spacing_m: float = 0.15
    spacing_jitter_frac: float = 0.1
    skip_rate: float = 0.05

    crop_diameter_m: float = 0.12
    crop_diameter_cv: float = 0.2
    crop_leaves: int = 6
    crop_height_ratio: float = 1.8
    crop_leaf_spread_deg: float = 38.0

    weed_density_per_m2: float = 0.3
    weed_offrow_bias: float = 0.5
    weed_diameter_m: float = TARGET_WEED_DIAMETER_M
    weed_diameter_cv: float = 0.35
    weed_diameter_min_m: float = 0.012
    weed_diameter_max_m: float = 0.10
    weed_leaves: int = 5
    weed_height_ratio: float = 0.5

    shadows: bool = False
    sun_azimuth_deg: float = 135.0
    sun_elevation_deg: float = 40.0
    shadow_strength: float = 0.32
    shadow_softness_m: float = 0.02

    wheel_tracks: bool = False
    wheel_track_every_rows: int = 12
    wheel_track_width_m: float = 0.35

    wet_patches: bool = False
    wet_patch_scale_m: float = 6.0
    wet_patch_fraction: float = 0.15

    soil_texture_scale_m: float = 0.08
    seed: int = 0

    @property
    def extent_m(self) -> tuple[float, float]:
        """Field size in metres, from ``acres`` unless overridden."""
        if self.width_m is not None and self.height_m is not None:
            return (self.width_m, self.height_m)
        side = math.sqrt(self.acres * SQUARE_METRES_PER_ACRE)
        return (side, side)

    @property
    def row_direction(self) -> tuple[float, float]:
        """Unit vector along the rows."""
        theta = math.radians(self.row_angle_deg)
        return (math.cos(theta), math.sin(theta))

    @property
    def row_normal(self) -> tuple[float, float]:
        """Unit vector across the rows. Signed distance is measured along this."""
        theta = math.radians(self.row_angle_deg)
        return (-math.sin(theta), math.cos(theta))


@dataclass
class Scene:
    """A generated field: the plant positions, before any pixels exist.

    Crop and weed are kept apart because they play different roles. Weeds are the
    ground truth a detector is scored against; crop positions are what a row fit
    can be checked against, which is the thing USU cannot offer.
    """

    params: SceneParams
    crop_xy_m: np.ndarray
    crop_diameter_m: np.ndarray
    crop_orientation_deg: np.ndarray
    weed_xy_m: np.ndarray
    weed_diameter_m: np.ndarray
    weed_orientation_deg: np.ndarray
    #: Signed distance to the nearest row, in scene coordinates. The magnitude is
    #: what matters and is unaffected by the flip into ground coordinates; the
    #: sign is not, since mirroring y negates the row normal's y component.
    weed_distance_to_row_m: np.ndarray
    extent_m: tuple[float, float]
    origin_xy_m: tuple[float, float] = DEFAULT_ORIGIN_XY
    crs: str = DEFAULT_CRS

    @property
    def area_acres(self) -> float:
        return self.extent_m[0] * self.extent_m[1] / SQUARE_METRES_PER_ACRE

    @property
    def offrow_mask(self) -> np.ndarray:
        """Which weeds sit outside the in-row band, by the candidates.py rule."""
        band = 0.30 * self.params.row_spacing_m
        return np.abs(self.weed_distance_to_row_m) > band

    def min_coverage_rows(self, row_spacing_m: float) -> float:
        """Rows spanned across the short edge. The row-fit feasibility of this scene."""
        return min(self.extent_m) / row_spacing_m

    def diameter_histogram(self) -> dict[str, int]:
        """Weed count per diameter bin. The check that a scene tests what it claims to."""
        names = diameter_bin_labels()
        counts = dict.fromkeys(names, 0)
        for diameter in self.weed_diameter_m:
            counts[names[diameter_bin(float(diameter))]] += 1
        return counts

    def ground_xy(self, xy_m: np.ndarray) -> np.ndarray:
        """Scene coordinates to ground coordinates.

        The scene's y grows downward, the way an array's row index does, because
        that is how it is rendered. A north-up raster's ground y grows upward. So
        the two are mirrored, and every position leaving this class has to be
        flipped or the truth lands on the opposite side of the field from the
        imagery it describes.

        This was wrong once: truth points were written with ``oy + y`` and sat
        mirrored against their own render, which would have scored every
        detection against the wrong ground.
        """
        xy_m = np.atleast_2d(np.asarray(xy_m, dtype=np.float64))
        ox, oy = self.origin_xy_m
        out = np.empty_like(xy_m)
        out[:, 0] = ox + xy_m[:, 0]
        out[:, 1] = oy + self.extent_m[1] - xy_m[:, 1]
        return out

    def truth_geojson(self, path: Path) -> Path:
        """Write weed positions as ground truth points, carrying diameter.

        Diameter is in the properties of every feature because recall is binned
        by it. A truth file without it can only produce a pooled number, and a
        pooled number over a synthetic size distribution is meaningless.
        """
        band = 0.30 * self.params.row_spacing_m
        ground = self.ground_xy(self.weed_xy_m) if len(self.weed_xy_m) else np.zeros((0, 2))
        features = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [float(x), float(y)]},
                "properties": {
                    "class": "weed",
                    "diameter_m": round(float(d), 5),
                    "diameter_bin": diameter_bin_labels()[diameter_bin(float(d))],
                    "distance_to_row_m": round(float(dist), 5),
                    "offrow": bool(abs(float(dist)) > band),
                },
            }
            for (x, y), d, dist in zip(
                ground, self.weed_diameter_m, self.weed_distance_to_row_m, strict=True
            )
        ]
        return _write_geojson(path, features, self.crs)

    def crop_geojson(self, path: Path) -> Path:
        """Write crop positions. What a row fit gets checked against."""
        ground = self.ground_xy(self.crop_xy_m) if len(self.crop_xy_m) else np.zeros((0, 2))
        features = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [float(x), float(y)]},
                "properties": {"class": "crop", "diameter_m": round(float(d), 5)},
            }
            for (x, y), d in zip(ground, self.crop_diameter_m, strict=True)
        ]
        return _write_geojson(path, features, self.crs)

    def boundary_geojson(self, path: Path) -> Path:
        """Write the field boundary."""
        ox, oy = self.origin_xy_m
        w, h = self.extent_m
        ring = [[ox, oy], [ox + w, oy], [ox + w, oy + h], [ox, oy + h], [ox, oy]]
        feature = {
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            "properties": {"acres": round(self.area_acres, 4)},
        }
        return _write_geojson(path, [feature], self.crs)

    def manifest(self) -> dict[str, Any]:
        """Everything needed to regenerate this scene, plus what it contains."""
        return {
            "params": asdict(self.params),
            "extent_m": list(self.extent_m),
            "origin_xy_m": list(self.origin_xy_m),
            "crs": self.crs,
            "area_acres": round(self.area_acres, 4),
            "crop_plants": int(len(self.crop_xy_m)),
            "weeds": int(len(self.weed_xy_m)),
            "weeds_offrow": int(self.offrow_mask.sum()),
            "weed_diameter_histogram": self.diameter_histogram(),
            "synthetic": True,
            "note": (
                "Synthetic. Drives development and tests. Never a reportable accuracy number."
            ),
        }


def _write_geojson(path: Path, features: list[dict], crs: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "type": "FeatureCollection",
        "name": path.stem,
        "crs": {"type": "name", "properties": {"name": crs}},
        "features": features,
    }
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


# --------------------------------------------------------------------------
# Scene generation
# --------------------------------------------------------------------------


def generate(params: SceneParams | None = None) -> Scene:
    """Lay out crop and weed positions. No rendering, no GSD involved."""
    params = params or SceneParams()
    rng = np.random.default_rng(params.seed)
    width, height = params.extent_m

    ux, uy = params.row_direction
    nx, ny = params.row_normal

    # Rows are laid out in the rotated frame and mapped back, so a field at any
    # angle gets the same plant count and the same edge behaviour.
    reach = math.hypot(width, height)
    n_rows = int(reach / params.row_spacing_m) + 2
    n_along = int(reach / params.inrow_spacing_m) + 2

    row_index = np.arange(-n_rows, n_rows + 1)
    along_index = np.arange(-n_along, n_along + 1)
    across, along = np.meshgrid(
        row_index * params.row_spacing_m, along_index * params.inrow_spacing_m, indexing="ij"
    )
    across = across.ravel()
    along = along.ravel()

    jitter = params.spacing_jitter_frac
    along = along + rng.normal(0.0, jitter * params.inrow_spacing_m, along.shape)
    across = across + rng.normal(0.0, jitter * params.row_spacing_m * 0.25, across.shape)

    cx = width / 2.0 + along * ux + across * nx
    cy = height / 2.0 + along * uy + across * ny

    inside = (cx >= 0) & (cx < width) & (cy >= 0) & (cy < height)
    kept = inside & (rng.random(cx.shape) >= params.skip_rate)
    crop_xy = np.stack([cx[kept], cy[kept]], axis=1)

    crop_d = rng.normal(
        params.crop_diameter_m, params.crop_diameter_cv * params.crop_diameter_m, len(crop_xy)
    )
    crop_d = np.clip(crop_d, params.crop_diameter_m * 0.3, params.crop_diameter_m * 2.5)
    crop_orientation = rng.uniform(0.0, 360.0, len(crop_xy))

    # Weeds: uniform positions, then pushed toward the inter-row midpoint by the
    # bias. Bias 0 leaves them uniform; bias 1 puts every one dead centre between
    # two rows, which is the strongest geometric signal the scene can contain.
    n_weeds = int(round(params.weed_density_per_m2 * width * height))
    wx = rng.uniform(0.0, width, n_weeds)
    wy = rng.uniform(0.0, height, n_weeds)

    signed = _signed_distance_to_row(wx, wy, params, width, height)
    fraction = signed / params.row_spacing_m  # in [-0.5, 0.5]
    biased = (
        fraction * (1.0 - params.weed_offrow_bias)
        + np.sign(fraction) * 0.5 * params.weed_offrow_bias
    )
    shift = (biased - fraction) * params.row_spacing_m
    wx = wx + shift * nx
    wy = wy + shift * ny

    inside = (wx >= 0) & (wx < width) & (wy >= 0) & (wy < height)
    wx, wy = wx[inside], wy[inside]
    weed_xy = np.stack([wx, wy], axis=1)

    weed_d = rng.normal(
        params.weed_diameter_m, params.weed_diameter_cv * params.weed_diameter_m, len(weed_xy)
    )
    weed_d = np.clip(weed_d, params.weed_diameter_min_m, params.weed_diameter_max_m)
    weed_orientation = rng.uniform(0.0, 360.0, len(weed_xy))
    weed_distance = _signed_distance_to_row(wx, wy, params, width, height)

    return Scene(
        params=params,
        crop_xy_m=crop_xy,
        crop_diameter_m=crop_d,
        crop_orientation_deg=crop_orientation,
        weed_xy_m=weed_xy,
        weed_diameter_m=weed_d,
        weed_orientation_deg=weed_orientation,
        weed_distance_to_row_m=weed_distance,
        extent_m=(width, height),
    )


def _signed_distance_to_row(
    x: np.ndarray, y: np.ndarray, params: SceneParams, width: float, height: float
) -> np.ndarray:
    """Signed perpendicular distance to the nearest row centerline, in metres.

    The ground-truth version of what ``rows.py`` will have to estimate. Rows pass
    through the field centre, matching :func:`generate`.
    """
    nx, ny = params.row_normal
    across = (x - width / 2.0) * nx + (y - height / 2.0) * ny
    spacing = params.row_spacing_m
    return across - np.round(across / spacing) * spacing


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------

SOIL_RGB = np.array([148.0, 116.0, 88.0])
SOIL_VARIATION = np.array([26.0, 22.0, 18.0])
WET_SOIL_RGB = np.array([84.0, 63.0, 46.0])
TRACK_RGB = np.array([176.0, 147.0, 118.0])
CROP_RGB = np.array([84.0, 128.0, 54.0])
WEED_RGB = np.array([104.0, 140.0, 62.0])

#: Shadows darken multiplicatively and lift blue slightly, which is what skylight
#: fill actually does. A purely multiplicative shadow would leave chromaticity
#: exactly unchanged and make ``vegetation.py``'s normalisation look better than
#: it is; a subtractive one would change hue far more than reality. This sits
#: between them on purpose.
SHADOW_BLUE_LIFT = 0.14


def _value_noise(
    x_m: np.ndarray, y_m: np.ndarray, scale_m: float, seed: int, octaves: int = 3
) -> np.ndarray:
    """Smooth noise anchored to ground coordinates, not to the pixel grid.

    This is what makes rendering the same scene at two GSDs give the same soil
    rather than two unrelated textures. The lattice is in metres and the value at
    a point is interpolated from it, so a finer pixel grid samples the same field
    more densely instead of drawing a different one.
    """
    total = np.zeros_like(x_m, dtype=np.float32)
    amplitude = 1.0
    norm = 0.0
    for octave in range(octaves):
        cell = scale_m / (2**octave)
        gx = x_m / cell
        gy = y_m / cell
        x0 = np.floor(gx).astype(np.int64)
        y0 = np.floor(gy).astype(np.int64)
        fx = (gx - x0).astype(np.float32)
        fy = (gy - y0).astype(np.float32)
        # Smoothstep, so the interpolation has no visible lattice creases.
        fx = fx * fx * (3.0 - 2.0 * fx)
        fy = fy * fy * (3.0 - 2.0 * fy)

        def lattice(ix: np.ndarray, iy: np.ndarray, octave: int = octave) -> np.ndarray:
            # Integer hash in uint64, where overflow wraps by definition rather
            # than raising. The offset keeps negative lattice coordinates, which
            # occur at the field edge, out of the conversion.
            offset = np.uint64(1 << 20)
            hx = (ix.astype(np.int64) + np.int64(1 << 20)).astype(np.uint64)
            hy = (iy.astype(np.int64) + np.int64(1 << 20)).astype(np.uint64)
            h = hx * np.uint64(0x9E3779B97F4A7C15)
            h ^= hy * np.uint64(0xC2B2AE3D27D4EB4F)
            h ^= np.uint64((seed + octave * 7919) & 0xFFFFFFFF) * offset
            h ^= h >> np.uint64(29)
            h *= np.uint64(0xBF58476D1CE4E5B9)
            h ^= h >> np.uint64(32)
            return (h >> np.uint64(40)).astype(np.float32) / float(1 << 24)

        v00 = lattice(x0, y0)
        v10 = lattice(x0 + 1, y0)
        v01 = lattice(x0, y0 + 1)
        v11 = lattice(x0 + 1, y0 + 1)
        top = v00 + (v10 - v00) * fx
        bottom = v01 + (v11 - v01) * fx
        total += amplitude * (top + (bottom - top) * fy)
        norm += amplitude
        amplitude *= 0.5
    return total / norm


def _ellipse_alpha(
    x_m: np.ndarray,
    y_m: np.ndarray,
    cx: float,
    cy: float,
    semi_major_m: float,
    semi_minor_m: float,
    angle_deg: float,
    gsd_m: float,
    softness_m: float = 0.0,
) -> np.ndarray:
    """Per-pixel coverage of an ellipse, antialiased over roughly one pixel.

    Analytic coverage rather than a hard test, because a 3 cm weed at 11 mm/px is
    2.7 px across and a hard test would quantise its area to whole pixels. The
    same scene at two GSDs has to produce the same ground area, and that starts
    here.
    """
    theta = math.radians(angle_deg)
    dx = x_m - cx
    dy = y_m - cy
    u = dx * math.cos(theta) + dy * math.sin(theta)
    v = -dx * math.sin(theta) + dy * math.cos(theta)
    r = np.sqrt((u / semi_major_m) ** 2 + (v / semi_minor_m) ** 2)
    # Convert the normalised radius into an approximate distance in metres, then
    # into pixels, and take a linear ramp across one pixel.
    distance_m = (r - 1.0) * min(semi_major_m, semi_minor_m)
    ramp_m = max(gsd_m, softness_m)
    return np.clip(0.5 - distance_m / ramp_m, 0.0, 1.0)


def _leaf_angles(orientation_deg: float, leaves: int, spread_deg: float | None) -> list[float]:
    """Leaf directions for one plant.

    Even radial spacing for a rosette; two alternating fans for corn.
    """
    if spread_deg is None:
        return [orientation_deg + index * (360.0 / leaves) for index in range(leaves)]
    angles = []
    per_side = max(leaves // 2, 1)
    for side in (0.0, 180.0):
        for index in range(per_side):
            offset = 0.0 if per_side == 1 else (index / (per_side - 1) - 0.5) * 2.0 * spread_deg
            angles.append(orientation_deg + side + offset)
    return angles[:leaves] if leaves <= len(angles) else angles


def _plant_alpha(
    x_m: np.ndarray,
    y_m: np.ndarray,
    cx: float,
    cy: float,
    diameter_m: float,
    orientation_deg: float,
    leaves: int,
    gsd_m: float,
    spread_deg: float | None = None,
) -> np.ndarray:
    """Coverage of one plant, drawn as leaves radiating from a centre.

    Drawing leaves rather than a disc matters at fine GSD, where the gaps between
    them are resolvable and a disc would overstate the vegetated area.

    ``spread_deg`` set makes the plant distichous: leaves alternate about a
    single axis, which is what corn does and what makes a corn row look like a
    row of little fans. Left as None the leaves radiate evenly, which is closer
    to a broadleaf weed rosette.

    ``x_m`` and ``y_m`` are expected to be the plant's own bounding window, not
    the whole block. Evaluating every leaf over a full block is the difference
    between a scene rendering in seconds and in hours.
    """
    alpha = np.zeros(x_m.shape, dtype=np.float32)
    radius = diameter_m / 2.0
    leaf_length = radius
    leaf_width = max(radius * 0.28, gsd_m * 0.4)
    for index, angle in enumerate(_leaf_angles(orientation_deg, leaves, spread_deg)):
        del index
        theta = math.radians(angle)
        # Leaf centre sits halfway out along its own axis.
        lx = cx + math.cos(theta) * leaf_length * 0.5
        ly = cy + math.sin(theta) * leaf_length * 0.5
        np.maximum(
            alpha,
            _ellipse_alpha(x_m, y_m, lx, ly, leaf_length * 0.5, leaf_width, angle, gsd_m),
            out=alpha,
        )
    # A small solid whorl at the centre, which is what the growing point looks like.
    np.maximum(
        alpha,
        _ellipse_alpha(x_m, y_m, cx, cy, radius * 0.3, radius * 0.3, 0.0, gsd_m),
        out=alpha,
    )
    return alpha


def _plant_window(
    cx: float,
    cy: float,
    reach_m: float,
    gsd_m: float,
    x0_px: int,
    y0_px: int,
    block_w: int,
    block_h: int,
) -> tuple[slice, slice] | None:
    """Pixel slices of a plant's bounding box inside a block, or None if outside."""
    left = int(math.floor((cx - reach_m) / gsd_m)) - x0_px
    right = int(math.ceil((cx + reach_m) / gsd_m)) - x0_px + 1
    top = int(math.floor((cy - reach_m) / gsd_m)) - y0_px
    bottom = int(math.ceil((cy + reach_m) / gsd_m)) - y0_px + 1
    left, right = max(left, 0), min(right, block_w)
    top, bottom = max(top, 0), min(bottom, block_h)
    if left >= right or top >= bottom:
        return None
    return (slice(top, bottom), slice(left, right))


def plant_reach_m(diameter_m: float, params: SceneParams, is_crop: bool) -> float:
    """How far a plant can affect the image from its centre, in metres.

    Canopy radius plus, when shadows are on, the whole shadow streak. Getting
    this wrong stays invisible until it does not: a plant bucketed only into the
    block holding its canopy has its shadow clipped at the block edge, which
    draws a straight line across the scene at the block boundary. The same class
    of mistake as truncating a blob at a window seam, and just as quiet.
    """
    reach = diameter_m * 0.6
    if not params.shadows:
        return reach
    ratio = params.crop_height_ratio if is_crop else params.weed_height_ratio
    tan_elevation = max(math.tan(math.radians(params.sun_elevation_deg)), 0.2)
    return reach + diameter_m * ratio / tan_elevation + params.shadow_softness_m


def _bucket_plants(
    xy: np.ndarray,
    diameters: np.ndarray,
    block_m: float,
    params: SceneParams,
    is_crop: bool,
) -> dict[tuple[int, int], list[int]]:
    """Index plants by render block, including blocks they only spill into."""
    buckets: dict[tuple[int, int], list[int]] = {}
    for index, ((x, y), d) in enumerate(zip(xy, diameters, strict=True)):
        reach = plant_reach_m(float(d), params, is_crop)
        for bx in range(int((x - reach) // block_m), int((x + reach) // block_m) + 1):
            for by in range(int((y - reach) // block_m), int((y + reach) // block_m) + 1):
                buckets.setdefault((bx, by), []).append(index)
    return buckets


def render_blocks(
    scene: Scene, gsd_mm: float, block_px: int = RENDER_BLOCK_PX
) -> Iterator[tuple[int, int, np.ndarray]]:
    """Render a scene block by block, yielding ``(col_px, row_px, block)``.

    Two acres at 5.5 mm/px is 267 megapixels. This module writes rasters that
    large, and the repo's rule against holding a full raster in memory applies to
    the writer as much as to the reader.
    """
    params = scene.params
    gsd_m = gsd_mm / 1000.0
    width_m, height_m = scene.extent_m
    width_px = int(round(width_m / gsd_m))
    height_px = int(round(height_m / gsd_m))
    block_m = block_px * gsd_m

    crop_buckets = _bucket_plants(
        scene.crop_xy_m, scene.crop_diameter_m, block_m, params, is_crop=True
    )
    weed_buckets = _bucket_plants(
        scene.weed_xy_m, scene.weed_diameter_m, block_m, params, is_crop=False
    )

    sun = math.radians(params.sun_azimuth_deg)
    shadow_ux = math.cos(sun)
    shadow_uy = math.sin(sun)
    shadow_tan = max(math.tan(math.radians(params.sun_elevation_deg)), 0.2)

    nx, ny = params.row_normal
    wet_threshold = wet_patch_threshold(params, scene.extent_m) if params.wet_patches else 1.0

    for by, y0 in enumerate(range(0, height_px, block_px)):
        for bx, x0 in enumerate(range(0, width_px, block_px)):
            bw = min(block_px, width_px - x0)
            bh = min(block_px, height_px - y0)
            xs = (np.arange(x0, x0 + bw, dtype=np.float32) + 0.5) * gsd_m
            ys = (np.arange(y0, y0 + bh, dtype=np.float32) + 0.5) * gsd_m
            x_m, y_m = np.meshgrid(xs, ys)

            block = _render_soil(x_m, y_m, params, nx, ny, wet_threshold)
            plants = list(
                _plants_in_block(scene, crop_buckets, weed_buckets, bx, by, with_kind=True)
            )

            # Shadows go down first, as a single coverage layer, so overlapping
            # shadows darken once rather than compounding into black.
            if params.shadows:
                shadow = np.zeros((bh, bw), dtype=np.float32)
                for xy, diam, _orient, _leaves, is_crop in plants:
                    ratio = params.crop_height_ratio if is_crop else params.weed_height_ratio
                    length = diam * ratio / shadow_tan
                    # One soft elongated blob from the plant base along the sun
                    # vector, not a copy of the plant. A crisp silhouette would
                    # put a spurious peak into the projection profile half a row
                    # off the true one.
                    sx = xy[0] + shadow_ux * length * 0.5
                    sy = xy[1] + shadow_uy * length * 0.5
                    semi_major = max(length * 0.5 + diam * 0.3, diam * 0.35)
                    semi_minor = diam * 0.36
                    reach = semi_major + params.shadow_softness_m
                    window = _plant_window(sx, sy, reach, gsd_m, x0, y0, bw, bh)
                    if window is None:
                        continue
                    np.maximum(
                        shadow[window],
                        _ellipse_alpha(
                            x_m[window],
                            y_m[window],
                            sx,
                            sy,
                            semi_major,
                            semi_minor,
                            params.sun_azimuth_deg,
                            gsd_m,
                            softness_m=params.shadow_softness_m,
                        ),
                        out=shadow[window],
                    )
                factor = 1.0 - params.shadow_strength * shadow
                block *= factor[..., None]
                block[..., 2] += params.shadow_strength * shadow * SHADOW_BLUE_LIFT * 255.0

            for xy, diam, orient, leaves, is_crop in plants:
                window = _plant_window(xy[0], xy[1], diam * 0.6, gsd_m, x0, y0, bw, bh)
                if window is None:
                    continue
                alpha = _plant_alpha(
                    x_m[window],
                    y_m[window],
                    xy[0],
                    xy[1],
                    diam,
                    orient,
                    leaves,
                    gsd_m,
                    spread_deg=params.crop_leaf_spread_deg if is_crop else None,
                )[..., None]
                # Per-plant colour jitter, so chromaticity is not degenerate and
                # vegetation.py is tested against a spread rather than one value.
                base = CROP_RGB if is_crop else WEED_RGB
                tint = 1.0 + 0.10 * math.sin(orient * 0.7)
                colour = np.clip(base * np.array([1.0, tint, 1.0]), 0, 255)
                block[window] = block[window] * (1.0 - alpha) + colour * alpha

            yield x0, y0, np.clip(block, 0, 255).astype(np.uint8)


def _plants_in_block(
    scene: Scene,
    crop_buckets: dict,
    weed_buckets: dict,
    bx: int,
    by: int,
    with_kind: bool = False,
) -> Iterator[tuple]:
    params = scene.params
    for index in crop_buckets.get((bx, by), ()):
        item = (
            scene.crop_xy_m[index],
            float(scene.crop_diameter_m[index]),
            float(scene.crop_orientation_deg[index]),
            params.crop_leaves,
        )
        yield (*item, True) if with_kind else item
    for index in weed_buckets.get((bx, by), ()):
        item = (
            scene.weed_xy_m[index],
            float(scene.weed_diameter_m[index]),
            float(scene.weed_orientation_deg[index]),
            params.weed_leaves,
        )
        yield (*item, False) if with_kind else item


def wet_patch_threshold(params: SceneParams, extent_m: tuple[float, float]) -> float:
    """Noise value above which soil counts as wet, for the requested wet fraction.

    Multi-octave noise is bell-shaped, not uniform, so ``1 - fraction`` is not
    its quantile. Sampling the field once on a coarse grid and taking the real
    quantile makes ``wet_patch_fraction`` mean what it says, and makes it mean
    the same thing at every GSD, which a per-block threshold would not.
    """
    xs = np.linspace(0.0, extent_m[0], 256, dtype=np.float32)
    ys = np.linspace(0.0, extent_m[1], 256, dtype=np.float32)
    gx, gy = np.meshgrid(xs, ys)
    noise = _value_noise(gx, gy, params.wet_patch_scale_m, params.seed + 7, octaves=2)
    return float(np.quantile(noise, 1.0 - params.wet_patch_fraction))


def _render_soil(
    x_m: np.ndarray,
    y_m: np.ndarray,
    params: SceneParams,
    nx: float,
    ny: float,
    wet_threshold: float = 0.75,
) -> np.ndarray:
    """Soil background: texture, colour variation, wheel tracks and wet patches."""
    texture = _value_noise(x_m, y_m, params.soil_texture_scale_m, params.seed, octaves=3)
    broad = _value_noise(x_m, y_m, 3.0, params.seed + 101, octaves=2)

    block = np.empty((*x_m.shape, 3), dtype=np.float32)
    for channel in range(3):
        block[..., channel] = (
            SOIL_RGB[channel]
            + (texture - 0.5) * 2.0 * SOIL_VARIATION[channel]
            + (broad - 0.5) * 1.2 * SOIL_VARIATION[channel]
        )

    if params.wheel_tracks:
        across = x_m * nx + y_m * ny
        period = params.wheel_track_every_rows * params.row_spacing_m
        phase = np.abs(((across + period / 2.0) % period) - period / 2.0)
        track = np.clip(1.0 - phase / (params.wheel_track_width_m / 2.0), 0.0, 1.0)
        for channel in range(3):
            block[..., channel] += track * (TRACK_RGB[channel] - SOIL_RGB[channel])

    if params.wet_patches:
        wet_noise = _value_noise(x_m, y_m, params.wet_patch_scale_m, params.seed + 7, octaves=2)
        span = max(1.0 - wet_threshold, 1e-3)
        wet = np.clip((wet_noise - wet_threshold) / span, 0.0, 1.0)
        for channel in range(3):
            block[..., channel] += wet * (WET_SOIL_RGB[channel] - block[..., channel])

    return block


def render(scene: Scene, gsd_mm: float, block_px: int = RENDER_BLOCK_PX) -> np.ndarray:
    """Render a whole scene to one array.

    Convenience for small scenes and tests. For anything field-sized, use
    :func:`render_blocks` or :func:`write_geotiff`, which never hold it all.
    """
    gsd_m = gsd_mm / 1000.0
    width_px = int(round(scene.extent_m[0] / gsd_m))
    height_px = int(round(scene.extent_m[1] / gsd_m))
    canvas = np.zeros((height_px, width_px, 3), dtype=np.uint8)
    for x0, y0, block in render_blocks(scene, gsd_mm, block_px):
        canvas[y0 : y0 + block.shape[0], x0 : x0 + block.shape[1]] = block
    return canvas


def render_ladder(
    scene: Scene, gsds_mm: list[float], block_px: int = RENDER_BLOCK_PX
) -> list[tuple[float, np.ndarray]]:
    """Render the same scene natively at several GSDs.

    Each rung is drawn from the ground truth at its own resolution, so it is what
    a camera at that altitude would have seen rather than a coarser version of a
    finer render. The real altitude ladder comes from real flights; this one
    exists so a detector can be exercised across resolutions on known truth.
    """
    return [(gsd, render(scene, gsd, block_px)) for gsd in gsds_mm]


#: ESRI WKT for the CRSs this module can write a .prj for without pyproj. Only
#: needed on the tifffile path; rasterio resolves the code itself.
PRJ_WKT = {
    "EPSG:32614": (
        'PROJCS["WGS_1984_UTM_Zone_14N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",'
        'SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],'
        'UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],'
        'PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],'
        'PARAMETER["Central_Meridian",-99.0],PARAMETER["Scale_Factor",0.9996],'
        'PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'
    )
}


def rasterio_available() -> bool:
    """Whether rasterio can actually load, not merely whether it is installed.

    On a machine with an Application Control policy the GDAL DLLs are blocked
    and the import fails at runtime, so the question is not answerable from the
    dependency list.
    """
    try:
        import rasterio  # noqa: F401
    except Exception:
        return False
    return True


def _scene_geometry(scene: Scene, gsd_mm: float) -> tuple[int, int, float]:
    gsd_m = gsd_mm / 1000.0
    return (
        int(round(scene.extent_m[0] / gsd_m)),
        int(round(scene.extent_m[1] / gsd_m)),
        gsd_m,
    )


def _tile_stream(scene: Scene, gsd_mm: float, tile_px: int):
    """Render blocks padded to a fixed tile size, in the order a tiled TIFF wants."""
    for _x0, _y0, block in render_blocks(scene, gsd_mm, tile_px):
        if block.shape[0] != tile_px or block.shape[1] != tile_px:
            padded = np.zeros((tile_px, tile_px, 3), dtype=np.uint8)
            padded[: block.shape[0], : block.shape[1]] = block
            block = padded
        yield block


def write_worldfile(scene: Scene, gsd_mm: float, path: Path) -> list[Path]:
    """Write the ``.tfw`` and ``.prj`` sidecars that georeference a plain TIFF.

    A world file plus a projection file is how georeferencing worked before
    GeoTIFF tags, and every GIS still reads it. It is the honest fallback when
    GDAL cannot load: the raster really is georeferenced, just in two files
    instead of one.
    """
    _, _, gsd_m = _scene_geometry(scene, gsd_mm)
    ox, oy = scene.origin_xy_m
    top = oy + scene.extent_m[1]
    tfw = path.with_suffix(".tfw")
    tfw.write_text(
        "\n".join(
            [
                f"{gsd_m:.10f}",
                "0.0000000000",
                "0.0000000000",
                f"{-gsd_m:.10f}",
                f"{ox + gsd_m / 2.0:.4f}",
                f"{top - gsd_m / 2.0:.4f}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    written = [tfw]
    wkt = PRJ_WKT.get(scene.crs)
    if wkt:
        prj = path.with_suffix(".prj")
        prj.write_text(wkt, encoding="utf-8")
        written.append(prj)
    return written


def write_geotiff(
    scene: Scene,
    gsd_mm: float,
    path: Path,
    block_px: int = RENDER_BLOCK_PX,
    backend: str = "auto",
) -> Path:
    """Write a rendered scene as a georeferenced raster, block by block.

    Args:
        backend: ``"rasterio"`` for a true GeoTIFF, ``"tifffile"`` for a tiled
            TIFF plus world file, or ``"auto"`` to use rasterio when it loads.
            ``"auto"`` never fails over silently: :func:`last_raster_backend`
            reports which one ran, and the CLI prints it.

    Raises:
        RuntimeError: If ``backend="rasterio"`` is asked for and cannot load.
    """
    global _LAST_BACKEND
    if backend not in ("auto", "rasterio", "tifffile"):
        raise ValueError(f"unknown backend {backend!r}")
    if backend == "rasterio" and not rasterio_available():
        raise RuntimeError(
            "rasterio cannot load on this machine, so a true GeoTIFF cannot be written. "
            "Use backend='tifffile' for a tiled TIFF plus world file."
        )
    use_rasterio = rasterio_available() if backend == "auto" else backend == "rasterio"
    _LAST_BACKEND = "rasterio" if use_rasterio else "tifffile"
    path.parent.mkdir(parents=True, exist_ok=True)
    if use_rasterio:
        return _write_with_rasterio(scene, gsd_mm, path, block_px)
    return _write_with_tifffile(scene, gsd_mm, path)


_LAST_BACKEND = "none"


def last_raster_backend() -> str:
    """Which backend the last :func:`write_geotiff` actually used."""
    return _LAST_BACKEND


def _write_with_rasterio(scene: Scene, gsd_mm: float, path: Path, block_px: int) -> Path:
    import rasterio
    from rasterio.transform import from_origin
    from rasterio.windows import Window

    width_px, height_px, gsd_m = _scene_geometry(scene, gsd_mm)
    ox, oy = scene.origin_xy_m
    profile = {
        "driver": "GTiff",
        "height": height_px,
        "width": width_px,
        "count": 3,
        "dtype": "uint8",
        "crs": scene.crs,
        "transform": from_origin(ox, oy + scene.extent_m[1], gsd_m, gsd_m),
        "tiled": True,
        "blockxsize": 512,
        "blockysize": 512,
        "compress": "deflate",
        "photometric": "rgb",
    }
    with rasterio.open(path, "w", **profile) as dst:
        for x0, y0, block in render_blocks(scene, gsd_mm, block_px):
            dst.write(
                np.transpose(block, (2, 0, 1)),
                window=Window(x0, y0, block.shape[1], block.shape[0]),
            )
        dst.update_tags(synthetic="true", gsd_mm=str(gsd_mm), note="Synthetic. Not flown.")
    return path


def _write_with_tifffile(scene: Scene, gsd_mm: float, path: Path, tile_px: int = 512) -> Path:
    import tifffile

    width_px, height_px, _ = _scene_geometry(scene, gsd_mm)
    tifffile.imwrite(
        path,
        _tile_stream(scene, gsd_mm, tile_px),
        shape=(height_px, width_px, 3),
        dtype=np.uint8,
        tile=(tile_px, tile_px),
        photometric="rgb",
        compression="zlib",
        description=f"Synthetic. Not flown. gsd_mm={gsd_mm:g}",
    )
    write_worldfile(scene, gsd_mm, path)
    return path


def write_scene(
    scene: Scene,
    out_dir: Path,
    gsd_mm: float,
    name: str = "scene",
    block_px: int = RENDER_BLOCK_PX,
) -> dict[str, Path]:
    """Write imagery, truth, crop positions, boundary and manifest together."""
    out_dir.mkdir(parents=True, exist_ok=True)
    written = {
        "ortho": write_geotiff(scene, gsd_mm, out_dir / f"{name}_{gsd_mm:g}mm.tif", block_px),
        "truth": scene.truth_geojson(out_dir / f"{name}_truth.geojson"),
        "crop": scene.crop_geojson(out_dir / f"{name}_crop.geojson"),
        "boundary": scene.boundary_geojson(out_dir / f"{name}_boundary.geojson"),
    }
    manifest = out_dir / f"{name}_manifest.json"
    payload = scene.manifest()
    payload["rendered_gsd_mm"] = gsd_mm
    payload["raster_backend"] = last_raster_backend()
    manifest.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    written["manifest"] = manifest
    return written


# --------------------------------------------------------------------------
# Looking at it
# --------------------------------------------------------------------------


def green_profile(image: np.ndarray, axis: int = 1) -> np.ndarray:
    """Mean excess-green across one axis: the projection profile, crudely.

    Not the real thing. ``rows.py`` will project a thresholded vegetation mask at
    the Radon angle; this projects a raw index along an image axis and only works
    when the rows are already axis-aligned. It is here because it turns "do the
    rows still look periodic" into something with peaks to count, a step before
    the real measurement exists.
    """
    rgb = image.astype(np.float32)
    total = rgb.sum(axis=2) + 1e-6
    exg = 2 * rgb[..., 1] / total - rgb[..., 0] / total - rgb[..., 2] / total
    return exg.mean(axis=axis)


def degradation_figure(
    scene: Scene, gsds_mm: list[float], out_path: Path, extent_m: float | None = None
) -> Path:
    """Render one scene at several GSDs side by side, with row profiles beneath.

    The cheap version of the step 4 validation: if the rows stop being visibly
    periodic somewhere in the ladder, that is the headline answer arriving a step
    before the curve confirms it.
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    crop_m = extent_m or min(scene.extent_m)
    n = len(gsds_mm)
    fig, axes = plt.subplots(2, n, figsize=(4.6 * n, 9), height_ratios=[3, 1])
    if n == 1:
        axes = axes.reshape(2, 1)

    for column, gsd in enumerate(gsds_mm):
        image = render(scene, gsd)
        gsd_m = gsd / 1000.0
        side_px = int(round(crop_m / gsd_m))
        image = image[:side_px, :side_px]

        ax = axes[0, column]
        ax.imshow(image, extent=(0, crop_m, crop_m, 0), interpolation="nearest")
        weed_px = scene.params.weed_diameter_m * 1000.0 / gsd
        ax.set_title(
            f"{gsd:g} mm/px\n"
            f"{scene.params.weed_diameter_m * 100:g} cm weed = {weed_px:.1f} px across",
            fontsize=11,
        )
        ax.set_xlabel("metres")
        if column == 0:
            ax.set_ylabel("metres")

        profile = green_profile(image, axis=1)
        distance = np.arange(len(profile)) * gsd_m
        pax = axes[1, column]
        pax.plot(distance, profile, linewidth=0.9, color="#2f9e44")
        pax.set_xlim(0, crop_m)
        pax.set_xlabel("metres across the rows")
        if column == 0:
            pax.set_ylabel("mean ExG")
        pax.grid(alpha=0.25)

    fig.suptitle(
        f"Same synthetic scene rendered natively at {len(gsds_mm)} resolutions  |  "
        f"{scene.params.row_spacing_m * 100:g} cm rows  |  SYNTHETIC, NOT FLOWN",
        fontsize=13,
    )
    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=120)
    plt.close(fig)
    return out_path
