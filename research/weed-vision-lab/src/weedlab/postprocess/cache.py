"""Probability cache for ERFNet outputs.

One PNG per image, RGB uint8: channel 0 = P(background), 1 = P(crop), 2 = P(weed),
each quantised to 1/255 after softmax. The argmax of the quantised channels can
differ from the float argmax only where two probabilities lie within 1/255 of
each other; the cache manifest records how often that happens on a sample so the
approximation is known, not assumed. A cache is identified by CACHE_VERSION, the
checkpoint SHA-256 and the preprocessing description; a mismatch is an error.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

CACHE_VERSION = "erfnet-prob-u8-v1"
PREPROCESSING = "ToTensor /255; per-image per-channel z-score (unbiased std + 1e-17); native 1024x1024; forward; softmax over 3 classes"


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class CacheSpec:
    root: Path
    checkpoint_sha256: str

    @property
    def manifest_path(self) -> Path:
        return self.root / "manifest.json"

    def path_for(self, split: str, name: str) -> Path:
        return self.root / split / name

    def write_manifest(self, extra: dict) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        payload = {"cache_version": CACHE_VERSION, "checkpoint_sha256": self.checkpoint_sha256, "preprocessing": PREPROCESSING, **extra}
        self.manifest_path.write_text(json.dumps(payload, indent=1), encoding="utf-8")

    def check(self) -> dict:
        if not self.manifest_path.exists():
            raise FileNotFoundError(f"no cache manifest at {self.manifest_path}")
        m = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        if m.get("cache_version") != CACHE_VERSION or m.get("checkpoint_sha256") != self.checkpoint_sha256:
            raise RuntimeError(f"cache at {self.root} was built with {m.get('cache_version')} / {m.get('checkpoint_sha256', '')[:12]}, expected {CACHE_VERSION} / {self.checkpoint_sha256[:12]}")
        return m


def quantise(prob: np.ndarray) -> np.ndarray:
    """prob: (3, H, W) float in [0, 1] -> (H, W, 3) uint8."""
    q = np.rint(np.clip(prob, 0.0, 1.0) * 255.0).astype(np.uint8)
    return np.transpose(q, (1, 2, 0))


def save_prob(path: Path, prob: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(quantise(prob), mode="RGB").save(path, compress_level=6)


def load_prob(path: Path) -> np.ndarray:
    """Returns (3, H, W) float32 probabilities in [0, 1]."""
    with Image.open(path) as im:
        if im.mode != "RGB":
            raise ValueError(f"{path.name}: cache file is not RGB")
        q = np.asarray(im)
    return np.transpose(q, (2, 0, 1)).astype(np.float32) / 255.0


def argmax_from(prob: np.ndarray) -> np.ndarray:
    """Class map uint8 from (3, H, W) probabilities; ties go to the lower class index like torch.argmax."""
    return np.argmax(prob, axis=0).astype(np.uint8)
