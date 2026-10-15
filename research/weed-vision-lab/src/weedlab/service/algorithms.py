"""The algorithms the research preview can run, each a function (rgb, context) -> (labels, score image, info).

Every entry is one of the configurations evaluated in Phases 3 to 5, by name,
so a number shown in the preview can be traced to a benchmark table. The
`selected` entry is the Experiment 5 pipeline.

ERFNet entries run tiled (weedlab.service.tiling) and need the checkpoint; the
colour entries need nothing and run on the whole image at processing scale.
"""

from __future__ import annotations

import time

import numpy as np
from scipy import ndimage

from weedlab.detect.classical import STRUCT8, index_exg, vegetation_mask
from weedlab.postprocess.refine import refine_erode, seed_and_argmax
from weedlab.postprocess.separate import separate
from weedlab.service.tiling import infer_tiled

ERODE_STRUCT = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool)

ALGORITHMS: dict[str, dict] = {
    "exg_fixed_0.08": {"label": "ExG > 0.08 (colour baseline, Phase 3)", "family": "colour", "needs_model": False, "model": None, "benchmark": "reports/baseline/exg_fixed_t0.08", "description": "Excess green on chromaticity above 0.08, 8-connected components. Finds vegetation, not weeds: crops are reported too."},
    "exg_hyst_0.10_0.03": {"label": "ExG hysteresis 0.10 / 0.03 (colour, Experiment 4B)", "family": "colour", "needs_model": False, "model": None, "benchmark": "reports/baseline/exg_hyst_h0.10_l0.03", "description": "Seeds above 0.10 grown through pixels above 0.03. Better coverage, three times the soil false positives."},
    "erfnet_argmax": {"label": "ERFNet (plain argmax, Experiment 4A)", "family": "erfnet", "needs_model": True, "model": "erfnet", "benchmark": "reports/postprocess/A1_argmax", "description": "Official PhenoBench ERFNet checkpoint, weed class components, no post-processing."},
    "erfnet_erode1": {"label": "ERFNet + 1 px erosion (selected, Experiment 5)", "family": "erfnet", "needs_model": True, "model": "erfnet", "benchmark": "reports/postprocess/S3_erode_1", "description": "Weed class, one-pixel erosion of the halo, 8-connected components, no size floor. The selected research pipeline."},
    "erfnet_erode1_watershed": {"label": "ERFNet + erosion + adaptive watershed (optional, Experiment 5 C2)", "family": "erfnet", "needs_model": True, "model": "erfnet", "benchmark": "reports/postprocess/C2_erode1_adaptive_h4_p5_s0.50", "description": "As selected, then distance-transform watershed on low-solidity components. Fewer merges with crops, cuts some grass-like plants."},
    "rfdetr_seg_large": {"label": "RF-DETR Seg-Large instance masks (Experiment 7)", "family": "rfdetr", "needs_model": True, "model": "rfdetr", "benchmark": "research/rfdetr-exp7/reports/evaluation_final", "default_threshold": 0.5,
                         "description": "One mask per plant with a crop / weed class and a confidence; tiled on the GPU, seam fragments fused. PhenoBench val, IoU 0.5: weed precision 0.54 / recall 0.58 at threshold 0.3 (0.63 / 0.56 at 0.5), tiny weeds 0.16, crop-as-weed 0.27 per image; a quarter of ERFNet's false alarms, fewer small weeds found. Threshold is adjustable per run."},
}
SELECTED = "erfnet_erode1"
ALGORITHMS["selected"] = dict(ALGORITHMS[SELECTED], label=f"Selected pipeline = {ALGORITHMS[SELECTED]['label']}", alias_of=SELECTED)


def _components(mask: np.ndarray) -> np.ndarray:
    labels, _ = ndimage.label(mask, structure=STRUCT8)
    return labels.astype(np.int32)


def run_algorithm(name: str, rgb: np.ndarray, model, tile: int, overlap: int, progress=None) -> tuple[np.ndarray, np.ndarray, dict]:
    """rgb at processing scale. Returns (labels int32, score image float32, info with timings and crop mask when available)."""
    if name == "selected":
        name = SELECTED
    if name not in ALGORITHMS:
        raise KeyError(name)
    info: dict = {"algorithm": name, "timings_ms": {}}
    t0 = time.perf_counter()
    if ALGORITHMS[name]["family"] == "colour":
        method = "exg_fixed" if name == "exg_fixed_0.08" else "exg_hyst"
        mask, score, _ = vegetation_mask(rgb, method, exg_t=0.08, hyst=(0.10, 0.03))
        info["timings_ms"]["index"] = round((time.perf_counter() - t0) * 1000.0, 1)
        a = time.perf_counter()
        labels = _components(mask)
        info["timings_ms"]["components"] = round((time.perf_counter() - a) * 1000.0, 1)
        info["score_kind"] = "mean_exg"
        info["crop_mask"] = None
        return labels, score.astype(np.float32), info
    if ALGORITHMS[name]["family"] == "rfdetr":
        raise RuntimeError("rfdetr algorithms are run by weedlab.service.rfdetr.run_rfdetr (instances, not a label image)")
    if model is None:
        raise RuntimeError("ERFNet checkpoint not loaded")
    prob, plan, t = infer_tiled(model, rgb, tile=tile, overlap=overlap, progress=progress)
    info["timings_ms"].update({f"inference_{k}": v for k, v in t.items()})
    info["tiles"] = plan.n_tiles
    info["tile_px"] = tile
    info["overlap_px"] = overlap
    a = time.perf_counter()
    seed, cls = seed_and_argmax(prob)
    if name == "erfnet_argmax":
        mask = seed
    else:
        mask = ndimage.binary_erosion(seed, structure=ERODE_STRUCT, iterations=1, border_value=0)
    info["timings_ms"]["postprocess_mask"] = round((time.perf_counter() - a) * 1000.0, 1)
    a = time.perf_counter()
    if name == "erfnet_erode1_watershed":
        labels, sstats = separate(mask, method="adaptive", prob_weed=prob[2], h=4.0, min_dist=7, min_peak=5.0, min_area=200, max_solidity=0.50)
        info["separation"] = sstats
    else:
        labels = _components(mask)
    info["timings_ms"]["components"] = round((time.perf_counter() - a) * 1000.0, 1)
    info["score_kind"] = "mean_weed_probability"
    info["crop_mask"] = cls == 1
    info["weed_pixel_fraction"] = round(float(seed.mean()), 5)
    info["crop_pixel_fraction"] = round(float((cls == 1).mean()), 5)
    return labels, prob[2], info
