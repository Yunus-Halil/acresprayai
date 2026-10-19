"""RF-DETR Segmentation Large (Experiment 7) as a service algorithm: tiled instance masks with crop / weed classes.

The model (rfdetr package, Apache-2.0; checkpoint fine-tuned in Experiment 7, epoch 75 EMA) predicts one mask per plant
with a class and a confidence. Each tile of the processed image is run through `model.predict`; masks are kept bounding-
box-local; duplicates and seam fragments across overlapping tiles are fused; the fused masks are rasterised into a dense
label image per class so the existing geometry (`extract_instances`) and the existing result schema apply unchanged,
with `class`, `score_kind = "detector_confidence"` and `fused_from_tiles` added per instance.

Fusion rules (same class only, predictions from different tiles only):
  duplicate: mask IoU >= 0.5                              -> union, max score
  seam fragment: intersection >= 0.6 of the smaller mask  -> union (a plant cut by a tile edge is seen as two partial
                                                             masks that overlap only in the tile overlap band)
A GPU (ROCm) or CPU device is chosen by torch; one inference runs at a time (the holder's lock) because the GPU is shared.
Known runtime caveat: under torch 2.9.1+rocm7.2.1 the interpreter hangs at process exit after inference; a service
process is long-lived, so stop it with Stop-Process when Ctrl+C does not return (never os._exit / TerminateProcess).
"""

from __future__ import annotations

import threading
import time
from pathlib import Path

import numpy as np
from PIL import Image

from weedlab.service.instances import extract_instances
from weedlab.service.tiling import plan_tiles

CLASS_NAMES = {0: "crop", 1: "weed"}
DEFAULT_THRESHOLD = 0.5
DUPLICATE_IOU = 0.5
SEAM_CONTAINMENT = 0.6


class RFDetrHolder:
    """Lazy, lock-guarded owner of the RF-DETR model (mirrors ModelHolder for ERFNet)."""

    def __init__(self, ckpt: str, device: str | None = None, threads: int | None = None):
        self.path = Path(ckpt)
        self.device_requested = device
        self.threads = threads  # CPU threads when the model runs on the CPU: 4 measured faster than 12 (6.0 s vs 8.6 s per tile)
        self.device = None
        self.model = None
        self.sha256 = None
        self.error = None
        self.load_ms = None
        self.warmup_ms = None
        self.resolution = None
        self.lock = threading.Lock()  # one inference at a time
        self._load_lock = threading.Lock()

    def load(self) -> None:
        with self._load_lock:
            if self.model is not None or self.error is not None:
                return
            try:
                import torch
                from rfdetr import RFDETRSegLarge

                from weedlab.postprocess.cache import sha256_of

                if not self.path.exists():
                    raise FileNotFoundError(f"checkpoint not found at {self.path}")
                t0 = time.perf_counter()
                kw = {"pretrain_weights": str(self.path)}
                if self.device_requested:
                    kw["device"] = self.device_requested
                model = RFDETRSegLarge(**kw)
                self.resolution = int(model.model_config.resolution)
                self.device = self.device_requested or ("cuda" if torch.cuda.is_available() else "cpu")
                if self.device == "cpu" and self.threads:
                    torch.set_num_threads(self.threads)
                if self.device == "cuda" and torch.cuda.is_available():
                    self.device = f"cuda ({torch.cuda.get_device_name(0)})"
                self.model = model
                self.sha256 = sha256_of(self.path)
                self.load_ms = round((time.perf_counter() - t0) * 1000.0, 1)
            except Exception as e:  # noqa: BLE001
                self.error = f"{type(e).__name__}: {e}"

    def warmup(self, tile: int = 1024) -> None:
        """One throw-away prediction so the first user request does not pay the MIOpen kernel search (~2 s)."""
        if self.model is None:
            return
        t0 = time.perf_counter()
        dummy = Image.fromarray(np.full((tile, tile, 3), 120, np.uint8))
        with self.lock:
            self.model.predict(dummy, threshold=0.9)
        self.warmup_ms = round((time.perf_counter() - t0) * 1000.0, 1)

    def status(self) -> dict:
        return {"loaded": self.model is not None, "checkpoint_path": str(self.path), "checkpoint_sha256": (self.sha256[:16] + "...") if self.sha256 else None, "load_ms": self.load_ms, "warmup_ms": self.warmup_ms,
                "error": self.error, "device": self.device, "resolution": self.resolution, "architecture": "RFDETRSegLarge (rfdetr 1.11.2)", "classes": [CLASS_NAMES[0], CLASS_NAMES[1]],
                "licence_note": "RF-DETR code and base weights Apache-2.0; fine-tuned in Experiment 7 on PhenoBench v1.1.0"}


def _mask_iou_and_containment(p: dict, q: dict) -> tuple[float, float]:
    bx, by = p["bbox"], q["bbox"]
    if bx[2] <= by[0] or by[2] <= bx[0] or bx[3] <= by[1] or by[3] <= bx[1]:
        return 0.0, 0.0
    x0, y0 = min(bx[0], by[0]), min(bx[1], by[1])
    x1, y1 = max(bx[2], by[2]), max(bx[3], by[3])
    a = np.zeros((y1 - y0, x1 - x0), bool)
    b = np.zeros_like(a)
    a[bx[1] - y0:bx[3] - y0, bx[0] - x0:bx[2] - x0] = p["mask"]
    b[by[1] - y0:by[3] - y0, by[0] - x0:by[2] - x0] = q["mask"]
    inter = int(np.logical_and(a, b).sum())
    if inter == 0:
        return 0.0, 0.0
    union = int(np.logical_or(a, b).sum())
    smaller = min(int(a.sum()), int(b.sum()))
    return inter / union, inter / smaller


def _union_into(p: dict, q: dict) -> None:
    bx, by = p["bbox"], q["bbox"]
    x0, y0 = min(bx[0], by[0]), min(bx[1], by[1])
    x1, y1 = max(bx[2], by[2]), max(bx[3], by[3])
    m = np.zeros((y1 - y0, x1 - x0), bool)
    m[by[1] - y0:by[3] - y0, by[0] - x0:by[2] - x0] = q["mask"]
    m[bx[1] - y0:bx[3] - y0, bx[0] - x0:bx[2] - x0] |= p["mask"]
    q["mask"] = m
    q["bbox"] = [x0, y0, x1, y1]
    q["score"] = max(q["score"], p["score"])
    q["fused"] += 1
    q["tiles"] = q["tiles"] | p["tiles"]


def fuse(preds: list[dict], iou_thr: float = DUPLICATE_IOU, containment_thr: float = SEAM_CONTAINMENT) -> list[dict]:
    """Greedy, score-descending fusion of same-class predictions from different tiles (see module docstring)."""
    preds = sorted(preds, key=lambda p: -p["score"])
    kept: list[dict] = []
    for p in preds:
        merged = False
        for q in kept:
            if q["class"] != p["class"] or not (p["tiles"] - q["tiles"]):
                continue
            iou, contain = _mask_iou_and_containment(p, q)
            if iou >= iou_thr or contain >= containment_thr:
                _union_into(p, q)
                merged = True
                break
        if not merged:
            kept.append(p)
    return kept


def _detections_to_preds(det, y: int, x: int, W: int, H: int) -> list[dict]:
    out = []
    if det is None or len(det) == 0 or getattr(det, "mask", None) is None:
        return out
    # Each mask's extent from its row and column projections, all masks in one vectorised pass: the same box as
    # np.nonzero over every full-tile mask, without building index arrays for every mask pixel (18% of a photo's
    # service time when it was done per mask; profile 2026-10-19).
    masks = np.asarray(det.mask, bool)
    rows_any = masks.any(axis=2)
    cols_any = masks.any(axis=1)
    for i in range(len(det)):
        r = np.flatnonzero(rows_any[i])
        if r.size == 0:
            continue
        c = np.flatnonzero(cols_any[i])
        tm = masks[i]
        x0, y0, x1, y1 = int(c[0]), int(r[0]), int(c[-1]) + 1, int(r[-1]) + 1
        gx0, gy0 = x + x0, y + y0
        gx1, gy1 = min(x + x1, W), min(y + y1, H)  # clip the reflect padding away
        if gx0 >= gx1 or gy0 >= gy1:
            continue
        local = tm[y0:y0 + (gy1 - gy0), x0:x0 + (gx1 - gx0)].copy()
        if not local.any():
            continue
        out.append({"class": int(det.class_id[i]), "score": float(det.confidence[i]), "mask": local, "bbox": [gx0, gy0, gx1, gy1], "fused": 0, "tiles": {(int(y), int(x))}})
    return out


def infer_rfdetr(model, rgb: np.ndarray, tile: int, overlap: int, threshold: float, progress=None, lock: threading.Lock | None = None) -> tuple[list[dict], object, dict]:
    """Tiled prediction at processing scale. Returns (fused bbox-local predictions, tile plan, timings_ms)."""
    H, W = rgb.shape[:2]
    t0 = time.perf_counter()
    plan = plan_tiles(H, W, tile, overlap)
    padded = np.pad(rgb, ((0, plan.pad_bottom), (0, plan.pad_right), (0, 0)), mode="reflect") if (plan.pad_bottom or plan.pad_right) else rgb
    t = {"tiling_setup": round((time.perf_counter() - t0) * 1000.0, 1)}
    preds: list[dict] = []
    fwd = 0.0
    n_raw = 0
    for k, (y, x) in enumerate(plan.origins, 1):
        tile_rgb = padded[y:y + tile, x:x + tile]
        a = time.perf_counter()
        if lock is not None:
            with lock:
                det = model.predict(Image.fromarray(tile_rgb), threshold=threshold)
        else:
            det = model.predict(Image.fromarray(tile_rgb), threshold=threshold)
        fwd += time.perf_counter() - a
        new = _detections_to_preds(det, y, x, W, H)
        n_raw += len(new)
        preds.extend(new)
        if progress:
            progress(k, plan.n_tiles)
    t["forward"] = round(fwd * 1000.0, 1)
    a = time.perf_counter()
    fused = fuse(preds)
    t["fusion"] = round((time.perf_counter() - a) * 1000.0, 1)
    t["total"] = round((time.perf_counter() - t0) * 1000.0, 1)
    t["raw_predictions"] = n_raw
    return fused, plan, t


def rasterize(preds: list[dict], cls: int, shape: tuple[int, int]) -> tuple[np.ndarray, np.ndarray, list[dict]]:
    """Dense int32 label image and float32 confidence image for one class; higher scores are painted first and win overlaps.
    Returns (labels, score_img, the predictions in label order, label k = index k-1)."""
    sel = sorted([p for p in preds if p["class"] == cls], key=lambda p: -p["score"])
    labels = np.zeros(shape, np.int32)
    score = np.zeros(shape, np.float32)
    for k, p in enumerate(sel, 1):
        x0, y0, x1, y1 = p["bbox"]
        region = labels[y0:y1, x0:x1]
        free = p["mask"] & (region == 0)
        region[free] = k
        score[y0:y1, x0:x1][free] = p["score"]
    return labels, score, sel


def run_rfdetr(rgb_p: np.ndarray, holder: RFDetrHolder, *, tile: int, overlap: int, threshold: float, scale: float, tolerance: float, include_rle: bool, progress=None, geometry: str = "full") -> dict:
    """Everything run_detection needs: weed instances (+ labels for evaluation), crop instances and regions, info."""
    import torch

    if holder.model is None:
        raise RuntimeError(f"RF-DETR checkpoint unavailable: {holder.error}")
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()
    preds, plan, t = infer_rfdetr(holder.model, rgb_p, tile, overlap, threshold, progress=progress, lock=holder.lock)
    a = time.perf_counter()
    weed_labels, weed_score, weed_sel = rasterize(preds, 1, rgb_p.shape[:2])
    crop_labels, crop_score, crop_sel = rasterize(preds, 0, rgb_p.shape[:2])
    t["rasterize"] = round((time.perf_counter() - a) * 1000.0, 1)
    a = time.perf_counter()
    weeds, warn_w = extract_instances(weed_labels, weed_score, scale, tolerance=tolerance, include_rle=include_rle, score_name="detector_confidence", geometry=geometry)
    crops, warn_c = extract_instances(crop_labels, crop_score, scale, tolerance=tolerance, include_rle=False, score_name="detector_confidence", geometry=geometry)
    for recs, sel, cname in ((weeds, weed_sel, "weed"), (crops, crop_sel, "crop")):
        for r in recs:
            r["class"] = cname
            src = sel[r["id"] - 1]
            r["fused_from_tiles"] = src["fused"] + 1
            r["score"] = round(src["score"], 4)  # the detector's confidence, not the painted mean (identical unless overpainted)
    t["geometry_and_polygons"] = round((time.perf_counter() - a) * 1000.0, 1)
    crop_regions = [r["polygons_px"][0] for r in crops if r["polygons_px"]]
    info = {
        "algorithm": "rfdetr_seg_large", "timings_ms": {f"inference_{k}": v for k, v in t.items() if k != "raw_predictions"} | {"rasterize": t["rasterize"], "geometry_and_polygons": t["geometry_and_polygons"]},
        "tiles": plan.n_tiles, "tile_px": tile, "overlap_px": overlap, "score_kind": "detector_confidence", "crop_mask": crop_labels > 0,
        "weed_pixel_fraction": round(float((weed_labels > 0).mean()), 5), "crop_pixel_fraction": round(float((crop_labels > 0).mean()), 5),
        "raw_predictions": t["raw_predictions"], "fused_instances": len(preds), "threshold": threshold, "model_resolution": holder.resolution, "device": holder.device,
        "peak_gpu_mb": round(torch.cuda.max_memory_allocated() / 1e6, 1) if torch.cuda.is_available() else None,
    }
    return {"labels": weed_labels, "score_img": weed_score, "instances": weeds, "crop_instances": crops, "crop_regions_px": crop_regions, "warnings": warn_w + [w.replace("instances", "crop instances") for w in warn_c], "info": info}
