"""Tiled ERFNet inference for images larger than the network's training size.

Why tiles: ERFNet is fully convolutional, but its receptive field, its dropout
schedule and its per-image normalisation were all set on 1024 x 1024 crops.
Feeding a 50-megapixel frame whole would change the normalisation statistics
and cost memory; shrinking it to 1024 px would turn a median PhenoBench weed
into a handful of pixels. So the (optionally rescaled) image is cut into
`tile` x `tile` windows with `overlap` px of overlap, each window is
normalised and run exactly as a PhenoBench image, and the softmax
probabilities are blended back into one full-size map with a linear ramp in
the overlap so no seam is visible. Components are then extracted ONCE from the
blended map, which is what makes a weed crossing a tile edge one instance
instead of two: duplicates cannot arise because no per-tile instances exist.

Edges: an image smaller than a tile in either direction is reflect-padded up to
the tile; the last row and column of tiles are shifted back to end exactly at
the image edge, so every pixel is covered by at least one full tile.

Processing scale: `scale` < 1 area-downsamples the image first (the resolution
ladder decides what is sensible); all outputs record `processing_scale` and
every coordinate returned to the caller is mapped back to the original image.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np
from PIL import Image

TILE_DEFAULT = 1024
OVERLAP_DEFAULT = 128


@dataclass
class TilePlan:
    height: int
    width: int
    tile: int
    overlap: int
    pad_bottom: int
    pad_right: int
    origins: list[tuple[int, int]]  # (y, x) in the padded image

    @property
    def n_tiles(self) -> int:
        return len(self.origins)


def plan_tiles(height: int, width: int, tile: int = TILE_DEFAULT, overlap: int = OVERLAP_DEFAULT) -> TilePlan:
    if tile % 8:
        raise ValueError("tile must be a multiple of 8")
    if not 0 <= overlap < tile:
        raise ValueError("overlap must be in [0, tile)")
    pad_b = max(0, tile - height)
    pad_r = max(0, tile - width)
    H, W = height + pad_b, width + pad_r
    step = tile - overlap

    def starts(n: int) -> list[int]:
        if n <= tile:
            return [0]
        s = list(range(0, n - tile, step))
        if s[-1] + tile < n:
            s.append(n - tile)
        return s

    origins = [(y, x) for y in starts(H) for x in starts(W)]
    return TilePlan(height, width, tile, overlap, pad_b, pad_r, origins)


def ramp_weight(tile: int, overlap: int) -> np.ndarray:
    """2-D weight: 1 in the interior, linear to ~0 across the overlap band on each side."""
    if overlap == 0:
        return np.ones((tile, tile), np.float32)
    r = np.ones(tile, np.float32)
    ramp = (np.arange(1, overlap + 1, dtype=np.float32)) / float(overlap + 1)
    r[:overlap] = ramp
    r[-overlap:] = ramp[::-1]
    return np.outer(r, r).astype(np.float32)


def rescale_image(rgb: np.ndarray, scale: float) -> np.ndarray:
    if scale == 1.0:
        return rgb
    h, w = rgb.shape[:2]
    nh, nw = max(8, int(round(h * scale))), max(8, int(round(w * scale)))
    return np.asarray(Image.fromarray(rgb).resize((nw, nh), Image.BOX), dtype=np.uint8)


def infer_tiled(model, rgb: np.ndarray, tile: int = TILE_DEFAULT, overlap: int = OVERLAP_DEFAULT, progress=None) -> tuple[np.ndarray, TilePlan, dict]:
    """Return (prob (3, H, W) float32 at the input's resolution, plan, timings_ms)."""
    import torch

    from weedlab.detect.erfnet import preprocess

    t: dict[str, float] = {}
    t0 = time.perf_counter()
    h, w = rgb.shape[:2]
    plan = plan_tiles(h, w, tile, overlap)
    padded = np.pad(rgb, ((0, plan.pad_bottom), (0, plan.pad_right), (0, 0)), mode="reflect") if (plan.pad_bottom or plan.pad_right) else rgb
    H, W = padded.shape[:2]
    acc = np.zeros((3, H, W), np.float32)
    wsum = np.zeros((H, W), np.float32)
    wt = ramp_weight(tile, overlap)
    t["tiling_setup"] = (time.perf_counter() - t0) * 1000.0
    t_pre = t_fwd = t_blend = 0.0
    with torch.no_grad():
        for k, (y, x) in enumerate(plan.origins):
            a = time.perf_counter()
            xt = preprocess(padded[y:y + tile, x:x + tile])
            t_pre += time.perf_counter() - a
            a = time.perf_counter()
            prob = torch.softmax(model(xt), dim=1)[0].numpy()
            t_fwd += time.perf_counter() - a
            a = time.perf_counter()
            acc[:, y:y + tile, x:x + tile] += prob * wt
            wsum[y:y + tile, x:x + tile] += wt
            t_blend += time.perf_counter() - a
            if progress:
                progress(k + 1, plan.n_tiles)
    a = time.perf_counter()
    acc /= np.maximum(wsum, 1e-6)[None]
    prob_full = acc[:, :h, :w]
    t["preprocess"] = t_pre * 1000.0
    t["forward"] = t_fwd * 1000.0
    t["blend"] = (t_blend + time.perf_counter() - a) * 1000.0
    t["total"] = (time.perf_counter() - t0) * 1000.0
    return prob_full, plan, {k: round(v, 1) for k, v in t.items()}
