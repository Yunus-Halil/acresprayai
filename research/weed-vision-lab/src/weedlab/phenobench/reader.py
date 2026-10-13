"""Discover, load and validate PhenoBench samples without altering label values."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

SPLITS = ("train", "val", "test")
LABELLED_SPLITS = ("train", "val")
ANNOTATION_KINDS = (
    "semantics",
    "plant_instances",
    "leaf_instances",
    "plant_visibility",
    "leaf_visibility",
)
EXPECTED_SHAPE = (1024, 1024)

BACKGROUND, CROP, WEED, PARTIAL_CROP, PARTIAL_WEED = 0, 1, 2, 3, 4
SEMANTIC_NAMES = {
    BACKGROUND: "background",
    CROP: "crop",
    WEED: "weed",
    PARTIAL_CROP: "partial_crop",
    PARTIAL_WEED: "partial_weed",
}
WEED_CLASSES = (WEED, PARTIAL_WEED)
CROP_CLASSES = (CROP, PARTIAL_CROP)
PLANT_CLASSES = CROP_CLASSES + WEED_CLASSES

# Integer-valued PIL modes we accept for annotations. Anything else (a palette
# or RGB mask, say) means the file is not what the format promises.
_INTEGER_MODES = {"I;16", "I;16B", "I;16L", "I", "L"}

# 2020 is the acquisition year stated in the dataset README.
ACQUISITION_YEAR = 2020
_NAME_RE = re.compile(r"^(?P<month>\d{2})-(?P<day>\d{2})_(?P<frame>\d{5})_(?P<plot>P\d+)\.png$")


@dataclass(frozen=True)
class ImageName:
    """What the filename encodes: acquisition date, a frame counter and a plot id."""

    name: str
    date: str  # ISO, e.g. 2020-05-15
    month_day: str  # as written, e.g. 05-15
    frame: int
    plot: str

    @property
    def stem(self) -> str:
        return self.name[:-4]


def parse_image_name(name: str) -> ImageName:
    m = _NAME_RE.match(name)
    if not m:
        raise ValueError(f"unexpected PhenoBench filename: {name!r}")
    month, day = int(m["month"]), int(m["day"])
    return ImageName(
        name=name,
        date=f"{ACQUISITION_YEAR:04d}-{month:02d}-{day:02d}",
        month_day=f"{month:02d}-{day:02d}",
        frame=int(m["frame"]),
        plot=m["plot"],
    )


@dataclass
class SplitInventory:
    split: str
    names: list[str]
    missing: dict[str, list[str]] = field(default_factory=dict)  # kind -> names lacking that file
    extra: dict[str, list[str]] = field(default_factory=dict)  # kind -> files with no image

    @property
    def complete(self) -> bool:
        return not any(self.missing.values()) and not any(self.extra.values())


def inventory_split(root: Path, split: str) -> SplitInventory:
    """List images in a split and check every annotation file exists for each."""
    if split not in SPLITS:
        raise ValueError(f"unknown split {split!r}")
    image_dir = root / split / "images"
    if not image_dir.is_dir():
        raise FileNotFoundError(f"missing {image_dir}")
    names = sorted(p.name for p in image_dir.iterdir() if p.suffix.lower() == ".png")
    inv = SplitInventory(split=split, names=names)
    if split not in LABELLED_SPLITS:
        return inv
    name_set = set(names)
    for kind in ANNOTATION_KINDS:
        kind_dir = root / split / kind
        present = {p.name for p in kind_dir.iterdir()} if kind_dir.is_dir() else set()
        inv.missing[kind] = sorted(name_set - present)
        inv.extra[kind] = sorted(present - name_set)
    return inv


def discover(root: Path) -> dict[str, SplitInventory]:
    return {split: inventory_split(root, split) for split in SPLITS if (root / split).is_dir()}


def read_rgb(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        if im.mode != "RGB":
            raise ValueError(f"{path.name}: expected an RGB image, got mode {im.mode}")
        return np.asarray(im, dtype=np.uint8)


def read_annotation(path: Path) -> np.ndarray:
    """Read an integer mask exactly as stored. Never rescales, never casts narrower."""
    with Image.open(path) as im:
        if im.mode not in _INTEGER_MODES:
            raise ValueError(f"{path.name}: expected an integer mask, got mode {im.mode}")
        arr = np.asarray(im)
    if arr.dtype.kind not in "iu":
        raise ValueError(f"{path.name}: decoded to {arr.dtype}, not an integer array")
    return arr


@dataclass
class Sample:
    """One image with whatever annotations were requested, values untouched."""

    root: Path
    split: str
    meta: ImageName
    image: np.ndarray
    semantics: np.ndarray | None = None
    plant_instances: np.ndarray | None = None
    leaf_instances: np.ndarray | None = None
    plant_visibility: np.ndarray | None = None
    leaf_visibility: np.ndarray | None = None

    @property
    def name(self) -> str:
        return self.meta.name

    def annotation(self, kind: str) -> np.ndarray | None:
        return getattr(self, kind)


def load_sample(root: Path, split: str, name: str, kinds: tuple[str, ...] = ANNOTATION_KINDS) -> Sample:
    meta = parse_image_name(name)
    sample = Sample(root=root, split=split, meta=meta, image=read_rgb(root / split / "images" / name))
    if split in LABELLED_SPLITS:
        for kind in kinds:
            if kind not in ANNOTATION_KINDS:
                raise ValueError(f"unknown annotation kind {kind!r}")
            setattr(sample, kind, read_annotation(root / split / kind / name))
    return sample


@dataclass
class Issue:
    severity: str  # "error" breaks the format contract; "warning" is worth a look
    message: str


def validate_sample(sample: Sample) -> list[Issue]:
    """Check the format contract and the cross-annotation consistency of one sample.

    Errors: wrong shapes, wrong dtypes, semantic ids outside 0..4.
    Warnings: plant pixels without an instance id, instance ids on background,
    leaf pixels outside plant pixels, visibility outside plant pixels.
    """
    issues: list[Issue] = []
    h, w = sample.image.shape[:2]
    if sample.image.ndim != 3 or sample.image.shape[2] != 3:
        issues.append(Issue("error", f"image shape {sample.image.shape} is not HxWx3"))
    if (h, w) != EXPECTED_SHAPE:
        issues.append(Issue("warning", f"image is {h}x{w}, expected {EXPECTED_SHAPE}"))
    for kind in ANNOTATION_KINDS:
        arr = sample.annotation(kind)
        if arr is None:
            continue
        if arr.shape != (h, w):
            issues.append(Issue("error", f"{kind} shape {arr.shape} != image {h}x{w}"))
        if arr.dtype.kind not in "iu":
            issues.append(Issue("error", f"{kind} dtype {arr.dtype} is not integer"))
    sem = sample.semantics
    inst = sample.plant_instances
    if sem is not None:
        bad = np.setdiff1d(np.unique(sem), list(SEMANTIC_NAMES))
        if bad.size:
            issues.append(Issue("error", f"semantic ids outside 0..4: {bad.tolist()}"))
        if sem.shape != (h, w):
            return issues  # the remaining checks need aligned arrays
    if sem is not None and inst is not None and inst.shape == sem.shape:
        plant = np.isin(sem, PLANT_CLASSES)
        n_plant_no_id = int(np.count_nonzero(plant & (inst == 0)))
        n_id_on_bg = int(np.count_nonzero(~plant & (inst != 0)))
        if n_plant_no_id:
            issues.append(Issue("warning", f"{n_plant_no_id} plant pixels have instance id 0"))
        if n_id_on_bg:
            issues.append(Issue("warning", f"{n_id_on_bg} background pixels carry a plant instance id"))
    if sem is not None and sample.leaf_instances is not None and sample.leaf_instances.shape == sem.shape:
        plant = np.isin(sem, PLANT_CLASSES)
        n = int(np.count_nonzero(~plant & (sample.leaf_instances != 0)))
        if n:
            issues.append(Issue("warning", f"{n} leaf-instance pixels lie outside plant pixels"))
    for kind in ("plant_visibility", "leaf_visibility"):
        vis = sample.annotation(kind)
        if vis is None or sem is None or vis.shape != sem.shape:
            continue
        if vis.max() > 255:
            issues.append(Issue("error", f"{kind} exceeds 255 (max {int(vis.max())})"))
        plant = np.isin(sem, PLANT_CLASSES)
        n = int(np.count_nonzero(~plant & (vis != 0)))
        if n:
            issues.append(Issue("warning", f"{n} {kind} pixels are nonzero outside plant pixels"))
    return issues
