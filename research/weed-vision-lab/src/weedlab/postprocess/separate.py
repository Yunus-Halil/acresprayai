"""Instance separation of a weed mask. Input: mask (and optionally probabilities / RGB). Output: int32 labels.

- cc        : 8-connected components (B1).
- watershed : for every component, markers at the h-maxima of its Euclidean
              distance transform (peaks that rise at least `h` px above their
              surroundings and are at least `min_dist` px apart), then a
              watershed of the negative distance map inside the component (B2).
              A component with one marker is left whole.
- adaptive  : watershed only on components that look like more than one plant:
              area >= `min_area`, solidity <= `max_solidity`, and at least two
              markers whose distance-map values are each >= `min_peak` px, so a
              leaf tip never counts as a plant centre (B3).
- probvalley: adaptive, but the watershed surface is the negative distance map
              weighted by P(weed): -dist * p_weed, so the cut prefers low-
              confidence pixels between plants (B4, "probability valley").

The h-maxima step is the marker suppression: it is what stops a lobed rosette
from being cut at every leaf.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage
from skimage.morphology import h_maxima
from skimage.segmentation import watershed

from weedlab.detect.classical import STRUCT8


def components(mask: np.ndarray) -> np.ndarray:
    labels, _ = ndimage.label(mask, structure=STRUCT8)
    return labels.astype(np.int32)


def _markers(dist: np.ndarray, local: np.ndarray, h: float, min_dist: int, min_peak: float) -> np.ndarray:
    """Marker labels from h-maxima of the distance map, suppressed below min_peak and merged within min_dist."""
    hm = h_maxima(dist, h) & local & (dist >= min_peak)
    if not hm.any():
        return np.zeros_like(local, dtype=np.int32)
    if min_dist > 1:
        hm = ndimage.binary_dilation(hm, structure=np.ones((min_dist, min_dist), bool)) & local
    m, _ = ndimage.label(hm, structure=STRUCT8)
    return m.astype(np.int32)


def _solidity(local: np.ndarray) -> float:
    from scipy.spatial import ConvexHull, QhullError

    ys, xs = np.nonzero(local)
    if len(xs) < 3:
        return 1.0
    try:
        hull = ConvexHull(np.stack([xs, ys], 1))
    except QhullError:
        return 1.0
    return min(1.0, len(xs) / max(hull.volume, 1.0))


def separate(mask: np.ndarray, method: str = "cc", prob_weed: np.ndarray | None = None,
             h: float = 2.0, min_dist: int = 5, min_peak: float = 3.0,
             min_area: int = 150, max_solidity: float = 0.75) -> tuple[np.ndarray, dict]:
    """Returns (labels int32, stats: components considered / split / markers)."""
    cc = components(mask)
    n = int(cc.max())
    stats = {"n_components": n, "n_considered": 0, "n_split": 0, "n_pieces_added": 0}
    if method == "cc" or n == 0:
        return cc, stats
    out = cc.copy()
    next_label = n + 1
    objects = ndimage.find_objects(cc, max_label=n)
    for k in range(1, n + 1):
        sl = objects[k - 1]
        if sl is None:
            continue
        ys, xs = sl
        pad = 2
        win = (slice(max(0, ys.start - pad), min(mask.shape[0], ys.stop + pad)), slice(max(0, xs.start - pad), min(mask.shape[1], xs.stop + pad)))
        local = cc[win] == k
        area = int(local.sum())
        if method in ("adaptive", "probvalley"):
            if area < min_area or _solidity(local) > max_solidity:
                continue
        stats["n_considered"] += 1
        dist = ndimage.distance_transform_edt(local)
        markers = _markers(dist, local, h, min_dist, min_peak if method != "watershed" else 0.0)
        nm = int(markers.max())
        if nm < 2:
            continue
        if method == "probvalley" and prob_weed is not None:
            surface = -dist * np.clip(prob_weed[win], 0.05, 1.0)
        else:
            surface = -dist
        ws = watershed(surface, markers, mask=local, connectivity=2)
        pieces = int(ws.max())
        if pieces < 2:
            continue
        stats["n_split"] += 1
        stats["n_pieces_added"] += pieces - 1
        region = out[win]
        for j in range(1, pieces + 1):
            region[(ws == j) & local] = k if j == 1 else next_label
            if j > 1:
                next_label += 1
    # Relabel consecutively so ids are compact.
    uniq = np.unique(out)
    lut = np.zeros(int(uniq.max()) + 1, np.int32)
    lut[uniq] = np.arange(len(uniq))
    return lut[out].astype(np.int32), stats


SEPARATORS = ("cc", "watershed", "adaptive", "probvalley")
