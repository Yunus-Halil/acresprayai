"""Loaders for public datasets, normalised to one internal representation.

STUB. No implementation yet.

There is no drone for this work, so public imagery is the only real imagery
there is. Two sets, deliberately: DRONEWEED as the primary benchmark, and
USU-Corn-WeedDB second so that nothing gets tuned to one collection's soil,
light and camera.

Downloads cache under ``data/``, which is gitignored.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

DATA_ROOT = Path("data")


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
        raise NotImplementedError

    def centroid_m(self, gsd_mm: float) -> tuple[float, float]:
        """Centroid in metres from the frame origin."""
        raise NotImplementedError


@dataclass
class Frame:
    """One image plus its ground truth and its ground sampling.

    ``gsd_mm`` is not optional. Every function that touches imagery takes or
    derives a GSD, and this is where it enters the system.
    """

    image_path: Path
    gsd_mm: float
    annotations: list[Annotation] = field(default_factory=list)
    source: str = ""
    growth_stage: str = ""
    crop: str = ""

    def load(self) -> np.ndarray:
        """Read the image as HxWx3 uint8."""
        raise NotImplementedError

    @property
    def coverage_m(self) -> tuple[float, float]:
        """Ground extent of the frame as ``(width_m, height_m)``.

        Worth checking before anything else: a frame that covers less ground
        than two row spacings cannot support a row model at all, no matter how
        sharp it is.
        """
        raise NotImplementedError


@dataclass
class Dataset:
    """A collection of frames from one source."""

    name: str
    frames: list[Frame] = field(default_factory=list)
    root: Path = DATA_ROOT
    license_note: str = ""

    def __len__(self) -> int:
        raise NotImplementedError

    def labels(self) -> dict[str, int]:
        """Annotation count per label across the dataset."""
        raise NotImplementedError

    def coverage_summary(self) -> dict[str, float]:
        """Per-frame ground coverage statistics, in metres.

        Answers whether a frame contains enough rows to fit a row model, which
        decides whether this dataset can exercise the geometry at all or only
        the vegetation mask.
        """
        raise NotImplementedError


def fetch(
    dataset: str, subset: str | None = None, root: Path = DATA_ROOT, force: bool = False
) -> Path:
    """Download and unpack a dataset into ``root``, returning its directory.

    Args:
        dataset: ``"droneweed"`` or ``"usu-corn-weeddb"``.
        subset: Source-specific subset, e.g. ``"maize"`` for DRONEWEED.
        root: Cache directory. Gitignored.
        force: Re-download even if the cache looks complete.
    """
    raise NotImplementedError


def load_droneweed(root: Path = DATA_ROOT, subset: str = "maize") -> Dataset:
    """Load DRONEWEED, parsing its PASCAL VOC boxes.

    Maize and tomato, 67,558 labelled images at 0.17 cm/px, maize at BBCH14 and
    BBCH17. The maize subset at both growth stages is the part that matters
    here; BBCH14 to BBCH17 brackets the V2 to V6 window this system targets.
    """
    raise NotImplementedError


def load_usu_corn_weeddb(root: Path = DATA_ROOT) -> Dataset:
    """Load USU-Corn-WeedDB, UAV RGB multi-species weed detection in forage corn.

    The second opinion. Its value is being a different camera over different
    soil, not being larger.
    """
    raise NotImplementedError


def parse_voc(xml_path: Path) -> list[Annotation]:
    """Parse one PASCAL VOC annotation file into :class:`Annotation` objects."""
    raise NotImplementedError
