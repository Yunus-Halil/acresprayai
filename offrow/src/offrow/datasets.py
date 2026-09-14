"""Loaders for public datasets, normalised to one internal representation.

There is no drone for this work, so public imagery is the only real imagery
there is. Two sets, deliberately: DRONEWEED as the primary benchmark, and
USU-Corn-WeedDB second so that nothing gets tuned to one collection's soil,
light and camera.

Both ship **tiles cut out of orthomosaics**, not orthomosaics, and that is the
fact this module exists to make impossible to overlook. A tile that covers less
ground than a row model needs can still exercise the vegetation mask and the
blob features, but it cannot exercise the geometry the whole system rests on.
:func:`row_fit_feasibility` computes that per dataset and every summary reports
it, so the limitation travels with the data instead of being discovered in
step 6.

Downloads cache under ``data/``, which is gitignored.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

DATA_ROOT = Path("data")

#: A row model needs the projection profile to show periodic structure. Two rows
#: define a direction only in the sense that two points define a line: there is
#: no redundancy left to reject noise with. These are priors for reporting, not
#: measurements. Step 6 instruments row fitting with a real confidence, and when
#: it does, these constants should be replaced by what it measures.
MIN_ROWS_FOR_ANGLE = 4.0
MIN_ROWS_FOR_PITCH = 10.0

#: Common planted spacings. 30 inch is the US default; 0.75 m is the European one.
ROW_SPACING_30IN_M = 0.762
ROW_SPACING_75CM_M = 0.75


class DatasetUnavailable(RuntimeError):
    """Raised when a dataset cannot be fetched automatically.

    Carries the manual route. Never a silent fallback to a different dataset:
    substituting one collection for another without saying so is how a benchmark
    stops meaning anything.
    """


@dataclass(frozen=True)
class DatasetSpec:
    """Capture parameters of a public dataset, from its published descriptor.

    The GSD lives here because it has to come from somewhere, and for public
    imagery that somewhere is the paper, not the file. Every :class:`Frame` this
    module produces inherits its GSD from one of these.
    """

    key: str
    name: str
    gsd_mm: float
    altitude_m: float
    camera: str
    crop: str
    tile_px: tuple[int, int] | None
    license: str
    url: str
    source: str
    auto_fetchable: bool
    note: str = ""

    @property
    def tile_coverage_m(self) -> tuple[float, float] | None:
        """Ground extent of one distributed tile, in metres."""
        if self.tile_px is None:
            return None
        w, h = self.tile_px
        return (w * self.gsd_mm / 1000.0, h * self.gsd_mm / 1000.0)


SPECS: dict[str, DatasetSpec] = {
    "droneweed": DatasetSpec(
        key="droneweed",
        name="DRONEWEED / DIWEED",
        gsd_mm=1.7,
        altitude_m=11.0,
        camera="Sony ILCE-6300L, APS-C 23.5 x 15.6 mm, 6000 x 3376 px",
        crop="maize",
        tile_px=(1000, 1000),
        license="see the DIGITAL.CSIC record",
        url="https://doi.org/10.20350/digitalCSIC/16559",
        source="Data in Brief, PMC11719326; DIGITAL.CSIC handle 10261/368094",
        auto_fetchable=False,
        note=(
            "Orthomosaic partitions filed by species, named species + stage + counter. "
            "Tile grid position is not in the filename, so the partitions cannot be "
            "reassembled into the ortho they came from without checking whether the VOC "
            "path field preserved the original tile name. Plants divided by a tile "
            "boundary were deliberately left unlabelled."
        ),
    ),
    "usu-corn-weeddb": DatasetSpec(
        key="usu-corn-weeddb",
        name="USU-Corn-WeedDB",
        gsd_mm=4.8,
        altitude_m=10.0,
        camera="Autel EVO II Dual 640T V2, RGB",
        crop="forage corn",
        tile_px=(640, 640),
        license="CC BY 4.0",
        url="https://doi.org/10.5281/zenodo.20044178",
        source="arXiv 2606.06709; Zenodo record 20044178",
        auto_fetchable=True,
        note="366 full-resolution frames tiled into 8,800 patches; 800 of them annotated.",
    ),
}

ZENODO_RECORDS = {"usu-corn-weeddb": "20044178"}


# --------------------------------------------------------------------------
# Internal representation
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Annotation:
    """One labelled object, in pixel coordinates of its frame.

    Boxes and points are both representable: a point-only source leaves the box
    extent at zero and sets ``is_point``.
    """

    label: str
    x_min: float
    y_min: float
    x_max: float
    y_max: float
    is_point: bool = False

    @property
    def centroid_px(self) -> tuple[float, float]:
        return ((self.x_min + self.x_max) / 2.0, (self.y_min + self.y_max) / 2.0)

    @property
    def width_px(self) -> float:
        return self.x_max - self.x_min

    @property
    def height_px(self) -> float:
        return self.y_max - self.y_min

    def centroid_m(self, gsd_mm: float) -> tuple[float, float]:
        """Centroid in metres from the frame origin."""
        cx, cy = self.centroid_px
        scale = gsd_mm / 1000.0
        return (cx * scale, cy * scale)

    def size_m(self, gsd_mm: float) -> tuple[float, float]:
        """Box extent in metres. The honest measure of how big a plant is."""
        scale = gsd_mm / 1000.0
        return (self.width_px * scale, self.height_px * scale)


@dataclass
class Frame:
    """One image plus its ground truth and its ground sampling.

    ``gsd_mm`` is not optional. Every function that touches imagery takes or
    derives a GSD, and this is where it enters the system.

    ``width_px`` and ``height_px`` come from the annotation file rather than the
    image, so coverage can be reported across tens of thousands of frames
    without decoding one of them.
    """

    image_path: Path
    gsd_mm: float
    width_px: int
    height_px: int
    annotations: list[Annotation] = field(default_factory=list)
    source: str = ""
    growth_stage: str = ""
    crop: str = ""
    annotation_path: Path | None = None

    def load(self) -> np.ndarray:
        """Read the image as HxWx3 uint8."""
        from imageio import v3 as iio

        array = np.asarray(iio.imread(self.image_path))
        if array.ndim == 2:
            array = np.stack([array] * 3, axis=-1)
        return array[:, :, :3]

    @property
    def coverage_m(self) -> tuple[float, float]:
        """Ground extent of the frame as ``(width_m, height_m)``.

        Worth checking before anything else: a frame that covers less ground
        than a row model needs cannot support one, no matter how sharp it is.
        """
        scale = self.gsd_mm / 1000.0
        return (self.width_px * scale, self.height_px * scale)

    @property
    def coverage_m2(self) -> float:
        w, h = self.coverage_m
        return w * h

    @property
    def min_coverage_m(self) -> float:
        """The short edge, which is what limits how many rows can be crossed."""
        return min(self.coverage_m)

    def labels(self) -> set[str]:
        return {a.label for a in self.annotations}


@dataclass
class Dataset:
    """A collection of frames from one source."""

    name: str
    spec: DatasetSpec | None = None
    frames: list[Frame] = field(default_factory=list)
    root: Path = DATA_ROOT
    license_note: str = ""

    def __len__(self) -> int:
        return len(self.frames)

    def __iter__(self) -> Iterator[Frame]:
        return iter(self.frames)

    def labels(self) -> dict[str, int]:
        """Annotation count per label across the dataset."""
        counts: dict[str, int] = {}
        for frame in self.frames:
            for ann in frame.annotations:
                counts[ann.label] = counts.get(ann.label, 0) + 1
        return dict(sorted(counts.items(), key=lambda kv: -kv[1]))

    def coverage_summary(self) -> dict[str, float]:
        """Per-frame ground coverage statistics, in metres.

        Answers whether a frame contains enough rows to fit a row model, which
        decides whether this dataset can exercise the geometry at all or only
        the vegetation mask.
        """
        if not self.frames:
            return {}
        widths = np.array([f.coverage_m[0] for f in self.frames])
        heights = np.array([f.coverage_m[1] for f in self.frames])
        shortest = np.minimum(widths, heights)
        areas = widths * heights
        return {
            "frames": float(len(self.frames)),
            "gsd_mm": float(np.median([f.gsd_mm for f in self.frames])),
            "width_m_median": float(np.median(widths)),
            "height_m_median": float(np.median(heights)),
            "short_edge_m_min": float(shortest.min()),
            "short_edge_m_median": float(np.median(shortest)),
            "short_edge_m_max": float(shortest.max()),
            "area_m2_median": float(np.median(areas)),
            "total_area_acres": float(areas.sum() / 4046.8564224),
        }

    def annotation_size_summary(self) -> dict[str, float]:
        """Labelled object extent in metres. Sanity check on the GSD.

        If maize plants at BBCH17 come out 3 cm across, the assumed GSD is wrong
        by an order of magnitude and every ground-unit threshold downstream
        would inherit the error.
        """
        sizes = [
            max(a.size_m(f.gsd_mm)) for f in self.frames for a in f.annotations if not a.is_point
        ]
        if not sizes:
            return {}
        arr = np.array(sizes)
        return {
            "objects": float(arr.size),
            "max_extent_m_p05": float(np.percentile(arr, 5)),
            "max_extent_m_median": float(np.median(arr)),
            "max_extent_m_p95": float(np.percentile(arr, 95)),
        }


# --------------------------------------------------------------------------
# The architectural question
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class RowFitFeasibility:
    """Whether a frame of this size can support a row model at all.

    Reported as a first-class result rather than derived at the point of
    failure, because the answer decides where ``rows.py`` runs: on a frame, on a
    stitched strip of frames, or only on a real orthomosaic.
    """

    coverage_m: float
    row_spacing_m: float
    rows_spanned: float
    can_fit_angle: bool
    can_fit_pitch: bool
    coverage_needed_for_pitch_m: float

    @property
    def verdict(self) -> str:
        if self.can_fit_pitch:
            return "angle and pitch both fittable"
        if self.can_fit_angle:
            return "angle plausible, pitch not recoverable"
        return "no row model: too few rows to fit"

    def __str__(self) -> str:
        return (
            f"{self.coverage_m:.2f} m across {self.row_spacing_m:.3f} m rows "
            f"= {self.rows_spanned:.1f} rows -> {self.verdict} "
            f"(needs {self.coverage_needed_for_pitch_m:.1f} m for pitch)"
        )


def row_fit_feasibility(
    coverage_m: float, row_spacing_m: float = ROW_SPACING_75CM_M
) -> RowFitFeasibility:
    """How many rows a frame of ``coverage_m`` spans, and whether that is enough.

    Uses the short edge of the frame: rows can run in any direction, so the
    worst case is the one that matters.
    """
    if coverage_m <= 0 or row_spacing_m <= 0:
        raise ValueError("coverage and row spacing must be positive")
    rows_spanned = coverage_m / row_spacing_m
    return RowFitFeasibility(
        coverage_m=coverage_m,
        row_spacing_m=row_spacing_m,
        rows_spanned=rows_spanned,
        can_fit_angle=rows_spanned >= MIN_ROWS_FOR_ANGLE,
        can_fit_pitch=rows_spanned >= MIN_ROWS_FOR_PITCH,
        coverage_needed_for_pitch_m=MIN_ROWS_FOR_PITCH * row_spacing_m,
    )


def spec_feasibility(key: str, row_spacing_m: float = ROW_SPACING_75CM_M) -> RowFitFeasibility:
    """Feasibility for a dataset's distributed tile size, without downloading it.

    The published descriptor is enough to answer this, which is the point: the
    architecture question does not have to wait on a 2 GB download.
    """
    spec = SPECS[key]
    coverage = spec.tile_coverage_m
    if coverage is None:
        raise ValueError(f"{key} does not document a fixed tile size")
    return row_fit_feasibility(min(coverage), row_spacing_m)


# --------------------------------------------------------------------------
# PASCAL VOC
# --------------------------------------------------------------------------


def parse_voc(xml_path: Path) -> tuple[list[Annotation], tuple[int, int]]:
    """Parse one PASCAL VOC annotation file.

    Returns:
        ``(annotations, (width_px, height_px))``. The size comes from the XML so
        callers can report coverage without decoding the image.
    """
    root = ET.parse(xml_path).getroot()
    size = root.find("size")
    if size is None:
        raise ValueError(f"{xml_path} has no <size> element")
    width = int(float(size.findtext("width", "0")))
    height = int(float(size.findtext("height", "0")))

    annotations: list[Annotation] = []
    for obj in root.findall("object"):
        box = obj.find("bndbox")
        if box is None:
            continue
        label = (obj.findtext("name") or "unknown").strip().lower()
        annotations.append(
            Annotation(
                label=label,
                x_min=float(box.findtext("xmin", "0")),
                y_min=float(box.findtext("ymin", "0")),
                x_max=float(box.findtext("xmax", "0")),
                y_max=float(box.findtext("ymax", "0")),
            )
        )
    return annotations, (width, height)


def voc_source_path(xml_path: Path) -> str | None:
    """The ``<path>`` the labelling tool recorded, if any.

    For DRONEWEED this is the one place the original orthomosaic tile name could
    have survived the rename into species folders. If it carries a grid
    position, the partitions can be reassembled; if it does not, they cannot.
    """
    root = ET.parse(xml_path).getroot()
    for tag in ("path", "folder", "filename"):
        value = root.findtext(tag)
        if value:
            return value
    return None


def _pair_images_with_annotations(directory: Path) -> list[tuple[Path, Path]]:
    """Match every image to its VOC sidecar, by stem, anywhere under ``directory``."""
    xml_by_stem = {p.stem: p for p in directory.rglob("*.xml")}
    pairs = []
    for pattern in ("*.jpg", "*.jpeg", "*.JPG", "*.png", "*.PNG"):
        for image in directory.rglob(pattern):
            xml = xml_by_stem.get(image.stem)
            if xml is not None:
                pairs.append((image, xml))
    return sorted(set(pairs))


def _build_dataset(
    spec: DatasetSpec,
    pairs: list[tuple[Path, Path]],
    root: Path,
    stage_from: callable | None = None,
) -> Dataset:
    frames = []
    for image, xml in pairs:
        try:
            annotations, (width, height) = parse_voc(xml)
        except (ET.ParseError, ValueError):
            continue
        if width <= 0 or height <= 0:
            continue
        frames.append(
            Frame(
                image_path=image,
                annotation_path=xml,
                gsd_mm=spec.gsd_mm,
                width_px=width,
                height_px=height,
                annotations=annotations,
                source=spec.key,
                growth_stage=stage_from(xml) if stage_from else "",
                crop=spec.crop,
            )
        )
    return Dataset(name=spec.name, spec=spec, frames=frames, root=root, license_note=spec.license)


# --------------------------------------------------------------------------
# Fetching
# --------------------------------------------------------------------------


def fetch(
    dataset: str, subset: str | None = None, root: Path = DATA_ROOT, force: bool = False
) -> Path:
    """Download and unpack a dataset into ``root``, returning its directory.

    Args:
        dataset: ``"droneweed"`` or ``"usu-corn-weeddb"``.
        subset: Source-specific subset, e.g. ``"maize"`` for DRONEWEED.
        root: Cache directory. Gitignored.
        force: Re-download even if the cache looks complete.

    Raises:
        DatasetUnavailable: If the host does not permit automated download. The
            message carries the manual route rather than the loader quietly
            falling back to a dataset the caller did not ask for.
    """
    if dataset not in SPECS:
        raise KeyError(f"unknown dataset {dataset!r}; known: {sorted(SPECS)}")
    spec = SPECS[dataset]
    target = Path(root) / dataset
    target.mkdir(parents=True, exist_ok=True)

    if not spec.auto_fetchable:
        raise DatasetUnavailable(
            f"{spec.name} cannot be fetched automatically.\n"
            f"  The host at {spec.url} sits behind proof-of-work bot protection, which is\n"
            f"  an access control put up by the operator and not something this tool will\n"
            f"  work around.\n"
            f"  Download it in a browser and unpack it into: {target}\n"
            f"  Then: offrow inspect --dataset {dataset}"
        )

    record = ZENODO_RECORDS[dataset]
    archive = _download_zenodo(record, target, force=force)
    _unpack(archive, target)
    return target


def _download_zenodo(record_id: str, target: Path, force: bool = False) -> Path:
    """Fetch the single archive of a Zenodo record, resuming if interrupted."""
    import requests

    meta = requests.get(f"https://zenodo.org/api/records/{record_id}", timeout=60).json()
    files = meta.get("files", [])
    if not files:
        raise DatasetUnavailable(f"Zenodo record {record_id} lists no files")
    entry = max(files, key=lambda f: f["size"])
    destination = target / entry["key"]
    if destination.exists() and destination.stat().st_size == entry["size"] and not force:
        return destination

    with requests.get(entry["links"]["self"], stream=True, timeout=300) as response:
        response.raise_for_status()
        with open(destination, "wb") as handle:
            for chunk in response.iter_content(chunk_size=1 << 20):
                handle.write(chunk)
    return destination


def _unpack(archive: Path, target: Path) -> None:
    if not zipfile.is_zipfile(archive):
        return
    marker = target / ".unpacked"
    if marker.exists():
        return
    with zipfile.ZipFile(archive) as zf:
        zf.extractall(target)
    marker.touch()


# --------------------------------------------------------------------------
# Loaders
# --------------------------------------------------------------------------


def _droneweed_stage(xml_path: Path) -> str:
    """BBCH14 or BBCH17, from the ``MAIZE_1`` / ``MAIZE_2`` folder it sits under."""
    for part in xml_path.parts:
        upper = part.upper()
        if upper.startswith("MAIZE_1") or upper.startswith("TOMATO_1"):
            return "early"
        if upper.startswith("MAIZE_2") or upper.startswith("TOMATO_2"):
            return "advanced"
    return ""


def load_droneweed(root: Path = DATA_ROOT, subset: str = "maize") -> Dataset:
    """Load DRONEWEED, parsing its PASCAL VOC boxes.

    Maize and tomato, 67,558 labelled images at 0.17 cm/px, maize at BBCH14 and
    BBCH17. The maize subset at both growth stages is the part that matters
    here; BBCH14 to BBCH17 brackets the V2 to V6 window this system targets.

    Layout is ``MAIZE_<stage>_<species>/``, so the subset filter is a prefix
    match on the top-level folder name.
    """
    spec = SPECS["droneweed"]
    directory = Path(root) / "droneweed"
    if not directory.exists():
        raise DatasetUnavailable(
            f"{directory} does not exist. DRONEWEED is not auto-fetchable; "
            f"download it from {spec.url} and unpack it there."
        )
    wanted = subset.upper()
    pairs = [
        (image, xml)
        for image, xml in _pair_images_with_annotations(directory)
        if any(part.upper().startswith(wanted) for part in xml.relative_to(directory).parts)
    ]
    if not pairs:
        pairs = _pair_images_with_annotations(directory)
    return _build_dataset(spec, pairs, Path(root), stage_from=_droneweed_stage)


def load_usu_corn_weeddb(root: Path = DATA_ROOT) -> Dataset:
    """Load USU-Corn-WeedDB, UAV RGB multi-species weed detection in forage corn.

    The second opinion. Its value is being a different camera over different
    soil, not being larger.
    """
    spec = SPECS["usu-corn-weeddb"]
    directory = Path(root) / "usu-corn-weeddb"
    if not directory.exists():
        raise DatasetUnavailable(
            f"{directory} does not exist. Run: offrow fetch --dataset usu-corn-weeddb"
        )
    pairs = _pair_images_with_annotations(directory)
    return _build_dataset(spec, pairs, Path(root))


LOADERS = {"droneweed": load_droneweed, "usu-corn-weeddb": load_usu_corn_weeddb}


def load(dataset: str, root: Path = DATA_ROOT, subset: str | None = None) -> Dataset:
    """Load a dataset by key."""
    if dataset not in LOADERS:
        raise KeyError(f"unknown dataset {dataset!r}; known: {sorted(LOADERS)}")
    loader = LOADERS[dataset]
    if dataset == "droneweed" and subset:
        return loader(root=root, subset=subset)
    return loader(root=root)


# --------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------


def draw_boxes(frame: Frame, out_path: Path, scale_bar_m: float = 0.5) -> Path:
    """Render a frame with its boxes drawn and a ground scale bar.

    The scale bar is the point of the picture. A tile of weeds looks the same at
    any resolution until something in the frame is labelled in metres.
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.patches as mpatches
    import matplotlib.pyplot as plt

    image = frame.load()
    width_m, height_m = frame.coverage_m
    fig, ax = plt.subplots(figsize=(7, 7 * height_m / width_m))
    ax.imshow(image, extent=(0, width_m, height_m, 0))

    palette = ["#e8590c", "#1971c2", "#2f9e44", "#9c36b5", "#c92a2a", "#0c8599", "#f08c00"]
    seen: dict[str, str] = {}
    scale = frame.gsd_mm / 1000.0
    for ann in frame.annotations:
        colour = seen.setdefault(ann.label, palette[len(seen) % len(palette)])
        ax.add_patch(
            mpatches.Rectangle(
                (ann.x_min * scale, ann.y_min * scale),
                ann.width_px * scale,
                ann.height_px * scale,
                fill=False,
                edgecolor=colour,
                linewidth=1.4,
            )
        )

    bar_y = height_m * 0.95
    ax.plot([0.05, 0.05 + scale_bar_m], [bar_y, bar_y], color="white", linewidth=4)
    ax.plot([0.05, 0.05 + scale_bar_m], [bar_y, bar_y], color="black", linewidth=2)
    ax.text(
        0.05,
        bar_y - height_m * 0.02,
        f"{scale_bar_m:g} m",
        color="white",
        fontsize=9,
        bbox={"facecolor": "black", "alpha": 0.6, "pad": 1.5, "edgecolor": "none"},
    )

    handles = [mpatches.Patch(color=c, label=lbl) for lbl, c in seen.items()]
    if handles:
        ax.legend(handles=handles, loc="lower right", fontsize=8, framealpha=0.85)
    ax.set_xlabel("metres")
    ax.set_ylabel("metres")
    ax.set_title(
        f"{frame.source} {frame.growth_stage} | {width_m:.2f} x {height_m:.2f} m "
        f"@ {frame.gsd_mm:g} mm/px",
        fontsize=10,
    )
    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=130)
    plt.close(fig)
    return out_path


def coverage_report(dataset: Dataset, row_spacing_m: float = ROW_SPACING_75CM_M) -> str:
    """Human-readable coverage and row-fit verdict for a loaded dataset."""
    lines = [f"{dataset.name}: {len(dataset)} frames"]
    if dataset.spec:
        lines.append(f"  {dataset.spec.camera}")
        lines.append(f"  {dataset.spec.altitude_m:g} m AGL, {dataset.spec.gsd_mm:g} mm/px")
        lines.append(f"  licence: {dataset.spec.license}")

    coverage = dataset.coverage_summary()
    if not coverage:
        lines.append("  no frames loaded")
        return "\n".join(lines)

    lines.append("")
    lines.append(
        f"  frame coverage: {coverage['width_m_median']:.2f} x "
        f"{coverage['height_m_median']:.2f} m median"
    )
    lines.append(
        f"  short edge: min {coverage['short_edge_m_min']:.2f} m, "
        f"median {coverage['short_edge_m_median']:.2f} m, "
        f"max {coverage['short_edge_m_max']:.2f} m"
    )
    lines.append(f"  total labelled ground: {coverage['total_area_acres']:.2f} acres")

    sizes = dataset.annotation_size_summary()
    if sizes:
        lines.append(
            f"  labelled object extent: p05 {sizes['max_extent_m_p05'] * 100:.1f} cm, "
            f"median {sizes['max_extent_m_median'] * 100:.1f} cm, "
            f"p95 {sizes['max_extent_m_p95'] * 100:.1f} cm"
        )

    lines.append("")
    feasibility = row_fit_feasibility(coverage["short_edge_m_median"], row_spacing_m)
    lines.append(f"  row fit: {feasibility}")

    counts = dataset.labels()
    if counts:
        lines.append("")
        lines.append("  labels:")
        for label, count in list(counts.items())[:15]:
            lines.append(f"    {label:<28} {count:>7}")
    return "\n".join(lines)
