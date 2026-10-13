"""Named, reproducible post-processing configurations: refinement then separation.

A config is a dict {"refine": {"method": ..., params}, "separate": {"method": ..., params}}.
`run_config` turns (rgb, prob) into labels and records per-stage timings. The
registry below holds every configuration evaluated in Experiment 5; a run's
name is its key, so results are reproducible from the name alone.
"""

from __future__ import annotations

import time

import numpy as np

from weedlab.detect.classical import DetectionResult
from weedlab.postprocess.refine import REFINERS
from weedlab.postprocess.separate import separate
from scipy import ndimage

CONFIGS: dict[str, dict] = {
    # A. refinement alone (separation = plain components)
    "A1_argmax": {"refine": {"method": "argmax"}, "separate": {"method": "cc"}},
    "A2_exg_l0.03_r8": {"refine": {"method": "exg_hyst", "low": 0.03, "radius": 8}, "separate": {"method": "cc"}},
    "A2_exg_l0.05_r8": {"refine": {"method": "exg_hyst", "low": 0.05, "radius": 8}, "separate": {"method": "cc"}},
    "A2_exg_l0.03_r4": {"refine": {"method": "exg_hyst", "low": 0.03, "radius": 4}, "separate": {"method": "cc"}},
    "A3_prob_t0.30_r8": {"refine": {"method": "prob", "t_low": 0.30, "radius": 8}, "separate": {"method": "cc"}},
    "A3_prob_t0.20_r8": {"refine": {"method": "prob", "t_low": 0.20, "radius": 8}, "separate": {"method": "cc"}},
    "A3_prob_t0.10_r8": {"refine": {"method": "prob", "t_low": 0.10, "radius": 8}, "separate": {"method": "cc"}},
    "A3_prob_t0.05_r8": {"refine": {"method": "prob", "t_low": 0.05, "radius": 8}, "separate": {"method": "cc"}},
    "A3_prob_t0.20_r16": {"refine": {"method": "prob", "t_low": 0.20, "radius": 16}, "separate": {"method": "cc"}},
    "A4_edge_c0.04_e0.35_r8": {"refine": {"method": "edge", "colour_tol": 0.04, "edge_max": 0.35, "radius": 8}, "separate": {"method": "cc"}},
    "A4_edge_c0.06_e0.50_r8": {"refine": {"method": "edge", "colour_tol": 0.06, "edge_max": 0.50, "radius": 8}, "separate": {"method": "cc"}},
    "A5_hybrid_t0.20_l0.03_r8": {"refine": {"method": "hybrid", "t_low": 0.20, "low": 0.03, "colour_tol": 0.04, "edge_max": 0.35, "radius": 8}, "separate": {"method": "cc"}},
    # B. separation alone (refinement = argmax)
    "B2_ws_h2_d5": {"refine": {"method": "argmax"}, "separate": {"method": "watershed", "h": 2.0, "min_dist": 5}},
    "B2_ws_h4_d7": {"refine": {"method": "argmax"}, "separate": {"method": "watershed", "h": 4.0, "min_dist": 7}},
    "B3_adaptive_h2_p3_s0.75": {"refine": {"method": "argmax"}, "separate": {"method": "adaptive", "h": 2.0, "min_dist": 5, "min_peak": 3.0, "min_area": 150, "max_solidity": 0.75}},
    "B3_adaptive_h3_p4_s0.60": {"refine": {"method": "argmax"}, "separate": {"method": "adaptive", "h": 3.0, "min_dist": 5, "min_peak": 4.0, "min_area": 150, "max_solidity": 0.60}},
    "B4_probvalley_h2_p3_s0.75": {"refine": {"method": "argmax"}, "separate": {"method": "probvalley", "h": 2.0, "min_dist": 5, "min_peak": 3.0, "min_area": 150, "max_solidity": 0.75}},
    # S. tightening refiners (second round)
    "S1_probhigh_0.6": {"refine": {"method": "prob_high", "t_high": 0.6}, "separate": {"method": "cc"}},
    "S1_probhigh_0.7": {"refine": {"method": "prob_high", "t_high": 0.7}, "separate": {"method": "cc"}},
    "S1_probhigh_0.8": {"refine": {"method": "prob_high", "t_high": 0.8}, "separate": {"method": "cc"}},
    "S1_probhigh_0.9": {"refine": {"method": "prob_high", "t_high": 0.9}, "separate": {"method": "cc"}},
    "S2_exgtrim_0.00": {"refine": {"method": "exg_trim", "t_exg": 0.0}, "separate": {"method": "cc"}},
    "S2_exgtrim_0.03": {"refine": {"method": "exg_trim", "t_exg": 0.03}, "separate": {"method": "cc"}},
    "S3_erode_1": {"refine": {"method": "erode", "px": 1}, "separate": {"method": "cc"}},
    "S4_probhigh_0.7_exg_0.00": {"refine": {"method": "prob_high_exg", "t_high": 0.7, "t_exg": 0.0}, "separate": {"method": "cc"}},
    # B3 more conservative settings
    "B3_adaptive_h4_p5_s0.50": {"refine": {"method": "argmax"}, "separate": {"method": "adaptive", "h": 4.0, "min_dist": 7, "min_peak": 5.0, "min_area": 200, "max_solidity": 0.50}},
    "B3_adaptive_h3_p4_s0.50": {"refine": {"method": "argmax"}, "separate": {"method": "adaptive", "h": 3.0, "min_dist": 5, "min_peak": 4.0, "min_area": 150, "max_solidity": 0.50}},
    # C. combinations: tightening + conservative separation
    "C1_probhigh0.7_adaptive_h4_p5_s0.50": {"refine": {"method": "prob_high", "t_high": 0.7}, "separate": {"method": "adaptive", "h": 4.0, "min_dist": 7, "min_peak": 5.0, "min_area": 200, "max_solidity": 0.50}},
    "C2_erode1_adaptive_h4_p5_s0.50": {"refine": {"method": "erode", "px": 1}, "separate": {"method": "adaptive", "h": 4.0, "min_dist": 7, "min_peak": 5.0, "min_area": 200, "max_solidity": 0.50}},
    "C3_probhigh0.6_adaptive_h4_p5_s0.50": {"refine": {"method": "prob_high", "t_high": 0.6}, "separate": {"method": "adaptive", "h": 4.0, "min_dist": 7, "min_peak": 5.0, "min_area": 200, "max_solidity": 0.50}},
    # S5. erosion that spares confident pixels
    "S5_erode1_keep0.90": {"refine": {"method": "erode_keep_high", "px": 1, "keep": 0.90}, "separate": {"method": "cc"}},
    "S5_erode1_keep0.95": {"refine": {"method": "erode_keep_high", "px": 1, "keep": 0.95}, "separate": {"method": "cc"}},
    "C4_erode1keep0.95_adaptive_h4_p5_s0.50": {"refine": {"method": "erode_keep_high", "px": 1, "keep": 0.95}, "separate": {"method": "adaptive", "h": 4.0, "min_dist": 7, "min_peak": 5.0, "min_area": 200, "max_solidity": 0.50}},
}


def run_config(name: str, rgb: np.ndarray, prob: np.ndarray, cfg: dict | None = None) -> tuple[DetectionResult, dict]:
    cfg = cfg or CONFIGS[name]
    t: dict[str, float] = {}
    t0 = time.perf_counter()
    rp = dict(cfg["refine"])
    refiner = REFINERS[rp.pop("method")]
    mask = refiner(rgb, prob, **rp)
    t["refine"] = (time.perf_counter() - t0) * 1000.0
    t1 = time.perf_counter()
    sp = dict(cfg["separate"])
    labels, sstats = separate(mask, method=sp.pop("method"), prob_weed=prob[2], **sp)
    t["separate"] = (time.perf_counter() - t1) * 1000.0
    t2 = time.perf_counter()
    n = int(labels.max())
    records = []
    if n:
        objects = ndimage.find_objects(labels, max_label=n)
        areas = np.bincount(labels.ravel(), minlength=n + 1)
        sums = ndimage.sum_labels(prob[2], labels, index=np.arange(1, n + 1))
        cy, cx = zip(*ndimage.center_of_mass(labels > 0, labels, index=np.arange(1, n + 1)))
        for k in range(1, n + 1):
            ys, xs = objects[k - 1]
            records.append({"det_id": k, "area_px": int(areas[k]), "bbox_x0": int(xs.start), "bbox_y0": int(ys.start), "bbox_x1": int(xs.stop), "bbox_y1": int(ys.stop),
                            "centroid_x": float(cx[k - 1]), "centroid_y": float(cy[k - 1]), "score": float(sums[k - 1] / areas[k])})
    t["measure"] = (time.perf_counter() - t2) * 1000.0
    t["total"] = (time.perf_counter() - t0) * 1000.0
    res = DetectionResult(method=name, closing=False, labels=labels, n=n, records=records, timings_ms={k: round(v, 3) for k, v in t.items()}, threshold=None, vegetation_fraction=float(mask.mean()))
    return res, sstats
