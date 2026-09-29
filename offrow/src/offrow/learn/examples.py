"""The ground-truth store: one format for every labelled chip.

An :class:`Example` is a square chip of real or rendered pixels centred on one
thing, with the label a person (or exact synthetic truth) gave it and enough
provenance to argue with later. A :class:`Manifest` is a JSONL file of them
next to a ``chips/`` directory, one manifest per source, so a source can be
rebuilt or dropped without touching the others.

Three rules, each of which was worth a bug somewhere else:

**Chips are stored at native resolution and a fixed ground span.** The span is
a multiple of the object's diameter (clamped), not a fixed pixel count, so a
3 cm seedling and a 30 cm broadleaf both fill their chip the same way and the
model learns shape and colour rather than how big the annotator's box was.
Resizing to the model's input happens at train time.

**Splits are assigned by group, deterministically.** Two chips cut from the
same frame, scene or field share soil, light and camera; putting one in train
and the other in test measures memorisation. The split is a hash of the group
name, so it is the same on every machine and every run, and adding a source
never moves an existing example between splits.

**The label carries its basis.** "annotated box", "synthetic truth", "operator
verdict", "derived: vegetation away from boxes" are different kinds of truth.
A scorecard that pools them hides which one the model actually learned.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from offrow.datasets import WEED_DIAMETER_BINS_M, diameter_bin, diameter_bin_labels

#: The classes the classifier predicts. "other" is soil, residue, shadow, a
#: clod: vegetation-shaped things that are not a plant.
LABELS = ("weed", "crop", "other")
SPLITS = ("train", "val", "test")

#: Changing this re-deals every split. Bump it only with a new test set on purpose.
SPLIT_SEED = "offrow-learn-v1"
VAL_FRACTION = 0.15
TEST_FRACTION = 0.15

#: Chip ground span as a multiple of the object's canopy diameter, clamped.
#: The same rule the app's chip renderer satisfies (it renders at least 4x the
#: diameter), so a training chip and a scout chip cover the same ground.
SPAN_PER_DIAMETER = 4.0
MIN_SPAN_M = 0.24
MAX_SPAN_M = 1.20

#: A negative chip with no annotated object has no diameter; it is cut at the
#: span of a typical weed so the model sees the same framing.
DEFAULT_NEGATIVE_DIAMETER_M = 0.15

MANIFEST_NAME = "manifest.jsonl"
CHIP_DIR = "chips"


def object_span_m(diameter_m: float) -> float:
    """Ground span of the chip around an object of this canopy diameter."""
    return float(min(MAX_SPAN_M, max(MIN_SPAN_M, SPAN_PER_DIAMETER * float(diameter_m))))


def split_for(
    group: str,
    seed: str = SPLIT_SEED,
    val_fraction: float = VAL_FRACTION,
    test_fraction: float = TEST_FRACTION,
) -> str:
    """The split a group lands in. A pure function of the group name and the seed."""
    digest = hashlib.sha1(f"{seed}:{group}".encode()).hexdigest()
    u = int(digest[:8], 16) / 0xFFFFFFFF
    if u < test_fraction:
        return "test"
    if u < test_fraction + val_fraction:
        return "val"
    return "train"


def example_id(source: str, source_ref: str, cx_px: float, cy_px: float, label: str) -> str:
    """Stable id: the same object cut from the same frame gets the same id."""
    key = f"{source}|{source_ref}|{cx_px:.1f}|{cy_px:.1f}|{label}"
    return hashlib.sha1(key.encode()).hexdigest()[:16]


@dataclass(frozen=True)
class Example:
    """One labelled chip and everything needed to trust it."""

    id: str
    source: str
    source_ref: str
    #: Path of the chip PNG, relative to the manifest's directory.
    chip: str
    gsd_m: float
    #: Ground metres across the stored chip.
    span_m: float
    label: str
    #: What kind of truth the label is.
    label_basis: str
    #: The split unit: a frame, a scene, a field. Never a chip.
    group: str
    split: str
    crop: str = ""
    growth_stage: str = ""
    species: str | None = None
    diameter_m: float | None = None
    license: str = ""
    #: True when the chip ran off the edge of its frame and was padded.
    padded: bool = False

    def __post_init__(self) -> None:
        if self.label not in LABELS:
            raise ValueError(f"label {self.label!r} is not one of {LABELS}")
        if self.split not in SPLITS:
            raise ValueError(f"split {self.split!r} is not one of {SPLITS}")
        if not (self.gsd_m > 0):
            raise ValueError("gsd_m must be positive: a chip without a GSD is not a measurement")
        if not (self.span_m > 0):
            raise ValueError("span_m must be positive")

    @property
    def diameter_bin_label(self) -> str | None:
        if self.diameter_m is None:
            return None
        return diameter_bin_labels()[diameter_bin(self.diameter_m, WEED_DIAMETER_BINS_M)]

    def to_json(self) -> str:
        return json.dumps(asdict(self), separators=(",", ":"), sort_keys=True)

    @classmethod
    def from_json(cls, line: str) -> Example:
        return cls(**json.loads(line))


class Manifest:
    """The examples of one source, and where their chips live."""

    def __init__(self, directory: Path, examples: Iterable[Example] = ()) -> None:
        self.directory = Path(directory)
        self.examples: list[Example] = list(examples)

    @property
    def path(self) -> Path:
        return self.directory / MANIFEST_NAME

    @property
    def chip_dir(self) -> Path:
        return self.directory / CHIP_DIR

    def chip_path(self, example: Example) -> Path:
        return self.directory / example.chip

    def add(self, example: Example) -> None:
        self.examples.append(example)

    def __len__(self) -> int:
        return len(self.examples)

    def __iter__(self) -> Iterator[Example]:
        return iter(self.examples)

    def filter(
        self, split: str | None = None, label: str | None = None, source: str | None = None
    ) -> list[Example]:
        out = self.examples
        if split is not None:
            out = [e for e in out if e.split == split]
        if label is not None:
            out = [e for e in out if e.label == label]
        if source is not None:
            out = [e for e in out if e.source == source]
        return list(out)

    def write(self) -> Path:
        self.directory.mkdir(parents=True, exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as handle:
            for example in self.examples:
                handle.write(example.to_json() + "\n")
        return self.path

    @classmethod
    def read(cls, directory: Path) -> Manifest:
        directory = Path(directory)
        path = directory / MANIFEST_NAME
        if not path.exists():
            raise FileNotFoundError(f"no {MANIFEST_NAME} in {directory}")
        with open(path, encoding="utf-8") as handle:
            examples = [Example.from_json(line) for line in handle if line.strip()]
        return cls(directory, examples)

    def summary(self) -> dict:
        """Counts a person can read before trusting a training run."""
        by = lambda key: _count(getattr(e, key) for e in self.examples)  # noqa: E731
        bins = _count(
            e.diameter_bin_label
            for e in self.examples
            if e.label == "weed" and e.diameter_m is not None
        )
        return {
            "examples": len(self.examples),
            "by_source": by("source"),
            "by_label": by("label"),
            "by_split": by("split"),
            "by_label_basis": by("label_basis"),
            "groups": len({e.group for e in self.examples}),
            "weed_diameter_bins": bins,
            "gsd_m": {
                "min": min((e.gsd_m for e in self.examples), default=None),
                "max": max((e.gsd_m for e in self.examples), default=None),
            },
        }


def _count(values: Iterable) -> dict:
    out: dict = {}
    for v in values:
        key = "null" if v is None else str(v)
        out[key] = out.get(key, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: (-kv[1], kv[0])))


def read_all(examples_dir: Path) -> list[Manifest]:
    """Every source manifest under a directory. Sources are subdirectories."""
    root = Path(examples_dir)
    out: list[Manifest] = []
    for sub in sorted(p for p in root.iterdir() if p.is_dir()) if root.exists() else []:
        if (sub / MANIFEST_NAME).exists():
            out.append(Manifest.read(sub))
    return out


def combined_summary(manifests: Iterable[Manifest]) -> dict:
    manifests = list(manifests)
    merged = Manifest(Path("."), [e for m in manifests for e in m.examples])
    summary = merged.summary()
    summary["sources"] = [str(m.directory) for m in manifests]
    return summary


# ---------------------------------------------------------------------------
# Cutting chips
# ---------------------------------------------------------------------------


def cut_chip(
    image: np.ndarray, cx_px: float, cy_px: float, span_px: int
) -> tuple[np.ndarray, bool]:
    """A square ``span_px`` chip centred on a pixel, edge-padded where it runs off.

    Returns the chip and whether any padding was needed. Padding replicates the
    edge rather than filling black, because a black border is a strong feature
    that no real chip has, and the model must not learn it.
    """
    span_px = max(2, int(span_px))
    half = span_px // 2
    x0 = int(round(cx_px)) - half
    y0 = int(round(cy_px)) - half
    x1, y1 = x0 + span_px, y0 + span_px
    h, w = image.shape[:2]
    pad_left, pad_top = max(0, -x0), max(0, -y0)
    pad_right, pad_bottom = max(0, x1 - w), max(0, y1 - h)
    padded = bool(pad_left or pad_top or pad_right or pad_bottom)
    if padded:
        image = np.pad(image, ((pad_top, pad_bottom), (pad_left, pad_right), (0, 0)), mode="edge")
        x0 += pad_left
        y0 += pad_top
        x1, y1 = x0 + span_px, y0 + span_px
    chip = np.ascontiguousarray(image[y0:y1, x0:x1, :3])
    return chip, padded


def save_chip(chip: np.ndarray, path: Path) -> None:
    from imageio import v3 as iio

    path.parent.mkdir(parents=True, exist_ok=True)
    iio.imwrite(path, np.ascontiguousarray(chip.astype(np.uint8)), extension=".png")


def load_chip(path: Path) -> np.ndarray:
    from imageio import v3 as iio

    array = np.asarray(iio.imread(path))
    if array.ndim == 2:
        array = np.stack([array] * 3, axis=-1)
    return np.ascontiguousarray(array[:, :, :3])


def centre_vegetation_fraction(
    chip: np.ndarray, gsd_m: float, centre_fraction: float = 0.5
) -> float:
    """Vegetation fraction of the chip's central square, by the repo's own mask.

    Used to turn an unlabelled negative into "crop" or "other": the same mask
    the detector uses, so a chip the mask calls vegetation is one the detector
    would have handed the model as a plant.
    """
    from offrow.vegetation import vegetation_mask

    h, w = chip.shape[:2]
    ch, cw = max(2, int(h * centre_fraction)), max(2, int(w * centre_fraction))
    y0, x0 = (h - ch) // 2, (w - cw) // 2
    mask = vegetation_mask(chip, gsd_m)
    centre = mask[y0 : y0 + ch, x0 : x0 + cw]
    return float(np.count_nonzero(centre)) / float(centre.size)
