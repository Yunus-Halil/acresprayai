"""Where the time goes in the RF-DETR service path, and what the Stage 1 candidates cost (two-stage investigation, 2026-10-19).

    gpu mode (run through run_gpu_job.ps1, ROCm exit hang):
        python scripts/profile_two_stage.py --mode gpu --out <dir>
    cpu mode (no GPU touched):
        python scripts/profile_two_stage.py --mode cpu --out <dir>

GPU mode runs the service's own run_detection on:
  A  DJI_0301 full frame, the photos path (tile 1024, overlap 256, threshold 0.5, scale 1)
  B  a 1728 px map-chunk-shaped crop enlarged 2x and JPEG q95 round-tripped, as mapRun.ts sends it (tile 1024 / 256)
  C  the same crop at 1x, tile 512 / 128 (same model input sampling as B, a quarter of the mask pixels)
  D  the same crop at 1x, tile 1024 / 256 (half the model input sampling)
with every stage wrapped in a timer, then probes batching and include_source_image on photo tiles.

CPU mode times RF-DETR per tile on the CPU, the Stage 1 candidates (ExG, ERFNet, an untrained LR-ASPP MobileNetV3 for the
student's compute cost only), and scores each candidate's cell ranking against the labelled weed points of DJI_0301.
That score is a smoke check on one non-exhaustive frame of the development field, not a validation.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FRAME = ROOT / "evaluation" / "groundtruth" / "image1" / "DJI_0301.JPG"
LABELS = ROOT / "evaluation" / "groundtruth" / "image1" / "DJI_0301.labels.json"
RFDETR_CKPT = "D:/swardus-research/rfdetr-exp7/runs/seg_large/checkpoint_best_total.pth"
ERFNET_CKPT = "D:/swardus-research/checkpoints/phenobench-baselines/semantic-seg-erfnet.ckpt"
GSD_CM = 0.99  # DJI_0301, estimated from EXIF (evaluation/groundtruth/image1/results/report.md)


def ms(t0: float) -> float:
    return round((time.perf_counter() - t0) * 1000.0, 1)


# ------------------------------------------------------------------------------------------------ GPU mode

def gpu_mode(out: Path) -> None:
    import _bootstrap  # noqa: F401
    import numpy as np
    import torch
    from PIL import Image

    import weedlab.service.app as A
    import weedlab.service.instances as I
    import weedlab.service.rfdetr as R

    T: dict[str, float] = defaultdict(float)
    N: dict[str, int] = defaultdict(int)

    def wrap(mod, name, key, sync=False):
        f = getattr(mod, name)

        def g(*a, **k):
            t = time.perf_counter()
            try:
                return f(*a, **k)
            finally:
                if sync and torch.cuda.is_available():
                    torch.cuda.synchronize()
                T[key] += (time.perf_counter() - t) * 1000.0
                N[key] += 1

        setattr(mod, name, g)

    wrap(R, "_detections_to_preds", "masks_to_bbox_local")
    wrap(R, "fuse", "fusion")
    wrap(R, "rasterize", "rasterize")
    wrap(R, "extract_instances", "extract_instances")
    wrap(I, "measure_mask", "  measure_mask (span, OBB, hull)")
    wrap(I, "polygons_of", "  polygons_of (contours)")

    holder = R.RFDetrHolder(RFDETR_CKPT)
    t = time.perf_counter()
    holder.load()
    if holder.model is None:
        raise SystemExit(f"RF-DETR did not load: {holder.error}")
    load_ms = ms(t)
    holder.warmup()
    predict = holder.model.predict

    def timed_predict(*a, **k):
        t0 = time.perf_counter()
        try:
            return predict(*a, **k)
        finally:
            T["model.predict"] += (time.perf_counter() - t0) * 1000.0
            N["model.predict"] += 1

    holder.model.predict = timed_predict
    holders = {"rfdetr": holder, "erfnet": None}

    raw = FRAME.read_bytes()
    t = time.perf_counter()
    im = Image.open(io.BytesIO(raw))
    im.load()
    decode_ms = ms(t)
    rgb = np.asarray(im.convert("RGB"), dtype=np.uint8)
    H, W = rgb.shape[:2]

    def chunk_input(upscale: float) -> tuple[np.ndarray, dict]:
        s = 1728
        y0, x0 = (H - s) // 2, (W - s) // 2
        crop = Image.fromarray(rgb[y0:y0 + s, x0:x0 + s])
        info = {"crop_origin_px": [x0, y0], "crop_px": s}
        t0 = time.perf_counter()
        if upscale != 1:
            crop = crop.resize((int(s * upscale), int(s * upscale)), Image.BICUBIC)
        info["upscale_ms"] = ms(t0)
        t0 = time.perf_counter()
        buf = io.BytesIO()
        crop.save(buf, "JPEG", quality=95)
        info["jpeg_encode_ms"] = ms(t0)
        info["jpeg_bytes"] = buf.tell()
        t0 = time.perf_counter()
        dec = Image.open(io.BytesIO(buf.getvalue()))
        dec.load()
        arr = np.asarray(dec.convert("RGB"), dtype=np.uint8)
        info["jpeg_decode_ms"] = ms(t0)
        return arr, info

    def run(label: str, arr: np.ndarray, tile: int, overlap: int, extra: dict) -> dict:
        T.clear()
        N.clear()
        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
        meta = {"filename": label, "format": "JPEG", "bytes": 0, "width": arr.shape[1], "height": arr.shape[0], "exif": {}}
        params = {"algorithm": "rfdetr_seg_large", "scale": 1.0, "tile": tile, "overlap": overlap, "threshold": 0.5, "include_rle": False, "include_crop": True, "polygon_tolerance": 0.8}
        t0 = time.perf_counter()
        result, _ = A.run_detection(arr, meta, params, holders)
        total = ms(t0)
        t0 = time.perf_counter()
        body = json.dumps(result)
        dumps_ms = ms(t0)
        verts = sum(len(p) for r in result["instances"] + (result["crop_instances"] or []) for p in r["polygons_px"])
        rec = {
            "label": label, "input_px": [arr.shape[1], arr.shape[0]], "tile": tile, "overlap": overlap, "tiles": result["processing"]["tiles"],
            "model_resolution": result["processing"]["model_resolution"], "model_px_per_input_px": round(result["processing"]["model_resolution"] / tile, 3),
            "run_detection_ms": total, "service_timings_ms": result["timings_ms"],
            "stage_ms": {k: round(v, 1) for k, v in sorted(T.items(), key=lambda kv: -kv[1])}, "stage_calls": dict(N),
            "weeds": result["count"], "crops": len(result["crop_instances"] or []),
            "polygon_vertices": verts, "result_json_bytes": len(body), "json_dumps_ms": dumps_ms,
            "peak_gpu_mb": result["memory"].get("peak_gpu_mb"), "peak_working_set_mb": A.peak_working_set_mb(), **extra,
        }
        print(json.dumps({k: rec[k] for k in ("label", "tiles", "run_detection_ms", "weeds", "crops", "result_json_bytes")}), flush=True)
        return rec, result

    report = {"device": holder.device, "rfdetr_load_ms": load_ms, "warmup_ms": holder.warmup_ms, "model_resolution": holder.resolution, "frame": str(FRAME), "frame_px": [W, H],
              "frame_jpeg_bytes": len(raw), "frame_decode_ms": decode_ms, "torch": torch.__version__, "runs": []}

    # A: photos path, twice (the second is the steady state)
    recA = None
    for rep in range(2):
        recA, resA = run(f"A_photo_t1024_rep{rep}", rgb, 1024, 256, {})
        report["runs"].append(recA)
    weeds = [{"c": r["centroid_px"], "a": r["area_px"], "s": r["score"]} for r in resA["instances"]]
    crops = [{"c": r["centroid_px"], "a": r["area_px"], "s": r["score"]} for r in resA["crop_instances"] or []]
    (out / "rfdetr_DJI_0301_instances.json").write_text(json.dumps({"weeds": weeds, "crops": crops, "threshold": 0.5, "tile": 1024, "overlap": 256}))

    arrB, infoB = chunk_input(2.0)
    recB, _ = run("B_mapchunk_up2_t1024", arrB, 1024, 256, infoB)
    report["runs"].append(recB)
    arrC, infoC = chunk_input(1.0)
    recC, _ = run("C_mapchunk_up1_t512", arrC, 512, 128, infoC)
    report["runs"].append(recC)
    recD, _ = run("D_mapchunk_up1_t1024", arrC, 1024, 256, infoC)
    report["runs"].append(recD)

    # Batching and include_source_image probes on 8 photo tiles
    tiles = [Image.fromarray(np.ascontiguousarray(rgb[y:y + 1024, x:x + 1024])) for y in (0, 1024, 2048) for x in (0, 1024, 2048)][:8]
    probe = {}

    def per_tile(fn, reps=2):
        best = None
        for _ in range(reps):
            t0 = time.perf_counter()
            fn()
            if torch.cuda.is_available():
                torch.cuda.synchronize()
            v = (time.perf_counter() - t0) * 1000.0 / len(tiles)
            best = v if best is None else min(best, v)
        return round(best, 1)

    probe["batch1_default_ms_per_tile"] = per_tile(lambda: [predict(t, threshold=0.5) for t in tiles])
    probe["batch1_no_source_image_ms_per_tile"] = per_tile(lambda: [predict(t, threshold=0.5, include_source_image=False) for t in tiles])
    try:
        probe["batch4_no_source_image_ms_per_tile"] = per_tile(lambda: [predict(tiles[i:i + 4], threshold=0.5, include_source_image=False) for i in range(0, 8, 4)])
    except Exception as e:  # noqa: BLE001
        probe["batch4_error"] = f"{type(e).__name__}: {e}"
    probe["batch1_threshold0.9_ms_per_tile"] = per_tile(lambda: [predict(t, threshold=0.9, include_source_image=False) for t in tiles])
    # Model forward alone on a preprocessed tensor, to separate network time from mask decoding
    try:
        net = holder.model.model.model
        x = torch.rand(1, 3, holder.resolution, holder.resolution, device=next(net.parameters()).device)
        with torch.no_grad():
            net(x)
            if torch.cuda.is_available():
                torch.cuda.synchronize()
            t0 = time.perf_counter()
            for _ in range(8):
                net(x)
            if torch.cuda.is_available():
                torch.cuda.synchronize()
        probe["network_forward_only_ms"] = round((time.perf_counter() - t0) * 1000.0 / 8, 1)
    except Exception as e:  # noqa: BLE001
        probe["network_forward_error"] = f"{type(e).__name__}: {e}"
    report["predict_probes"] = probe
    print(json.dumps(probe), flush=True)

    (out / "gpu_profile.json").write_text(json.dumps(report, indent=1))
    (out / "gpu_done.txt").write_text("done")  # sentinel, written last


# ------------------------------------------------------------------------------------------------ CPU mode

def cpu_mode(out: Path, threads_list: list[int]) -> None:
    os.environ["HIP_VISIBLE_DEVICES"] = "-1"
    os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
    import _bootstrap  # noqa: F401
    import numpy as np
    import torch
    from PIL import Image
    from scipy import ndimage

    from weedlab.detect.classical import index_exg
    from weedlab.detect.erfnet import load_model
    from weedlab.service.app import peak_working_set_mb
    from weedlab.service.tiling import infer_tiled, rescale_image

    rgb = np.asarray(Image.open(FRAME).convert("RGB"), dtype=np.uint8)
    H, W = rgb.shape[:2]
    report: dict = {"frame_px": [W, H], "gsd_cm": GSD_CM, "torch": torch.__version__, "cuda_visible": torch.cuda.is_available(), "cpu_count": os.cpu_count()}

    # ---- RF-DETR on the CPU, per 1024 tile
    rf = {}
    try:
        from rfdetr import RFDETRSegLarge

        model = RFDETRSegLarge(pretrain_weights=RFDETR_CKPT, device="cpu")
        tiles = [Image.fromarray(np.ascontiguousarray(rgb[y:y + 1024, x:x + 1024])) for y, x in ((1024, 1024), (1024, 2048), (2048, 2048))]
        for th in threads_list:
            torch.set_num_threads(th)
            model.predict(tiles[0], threshold=0.5)
            v = []
            for tl in tiles:
                t0 = time.perf_counter()
                model.predict(tl, threshold=0.5, include_source_image=False)
                v.append((time.perf_counter() - t0) * 1000.0)
            rf[f"threads_{th}_ms_per_1024_tile"] = round(statistics.median(v), 1)
        del model
    except Exception as e:  # noqa: BLE001
        rf["error"] = f"{type(e).__name__}: {e}"
    report["rfdetr_cpu"] = rf
    print(json.dumps(rf), flush=True)

    # ---- Stage 1 candidate 1: ExG vegetation, at three processing scales, aggregated to 1 m cells
    exg = {}
    cell_native = int(round(100 / GSD_CM))  # 1 m
    grids: dict[str, np.ndarray] = {}
    for s in (1.0, 0.5, 0.25):
        t0 = time.perf_counter()
        img = rescale_image(rgb, s)
        t_res = ms(t0)
        t0 = time.perf_counter()
        veg = index_exg(img) > 0.08
        t_idx = ms(t0)
        t0 = time.perf_counter()
        c = max(1, int(round(cell_native * s)))
        gh, gw = img.shape[0] // c, img.shape[1] // c
        frac = veg[:gh * c, :gw * c].reshape(gh, c, gw, c).mean(axis=(1, 3))
        t_grid = ms(t0)
        t0 = time.perf_counter()
        lab, n = ndimage.label(veg, structure=np.ones((3, 3), bool))
        t_cc = ms(t0)
        exg[f"scale_{s}"] = {"rescale_ms": t_res, "index_ms": t_idx, "cell_grid_ms": t_grid, "components_ms": t_cc, "components": int(n), "processed_px": [img.shape[1], img.shape[0]]}
        grids[f"exg_s{s}"] = frac
    report["exg"] = exg
    print(json.dumps(exg), flush=True)

    # ---- Stage 1 candidate 2: ERFNet (small semantic network) at reduced scales, weed probability to 1 m cells
    er = {}
    try:
        for th in threads_list:
            torch.set_num_threads(th)
            model = load_model(Path(ERFNET_CKPT))
            for s in (1.0, 0.5, 0.25):
                img = rescale_image(rgb, s)
                t0 = time.perf_counter()
                prob, plan, t = infer_tiled(model, img, tile=1024, overlap=128)
                total = ms(t0)
                t0 = time.perf_counter()
                c = max(1, int(round(cell_native * s)))
                gh, gw = img.shape[0] // c, img.shape[1] // c
                weed = (prob.argmax(0) == 2)
                frac = weed[:gh * c, :gw * c].reshape(gh, c, gw, c).mean(axis=(1, 3))
                pmean = prob[2][:gh * c, :gw * c].reshape(gh, c, gw, c).mean(axis=(1, 3))
                t_grid = ms(t0)
                er[f"threads_{th}_scale_{s}"] = {"tiles": plan.n_tiles, "total_ms": total, "forward_ms": t["forward"], "grid_ms": t_grid, "peak_working_set_mb": peak_working_set_mb()}
                if th == threads_list[-1]:
                    grids[f"erfnet_weedfrac_s{s}"] = frac
                    grids[f"erfnet_pweed_s{s}"] = pmean
            del model
    except Exception as e:  # noqa: BLE001
        er["error"] = f"{type(e).__name__}: {e}"
    report["erfnet_cpu"] = er
    print(json.dumps(er), flush=True)

    # ---- Stage 1 candidate 3 (compute cost only): an untrained LR-ASPP MobileNetV3-Large, the size of a plausible student
    st = {}
    try:
        from torchvision.models.segmentation import lraspp_mobilenet_v3_large

        net = lraspp_mobilenet_v3_large(weights=None, weights_backbone=None, num_classes=3).eval()
        st["parameters_m"] = round(sum(p.numel() for p in net.parameters()) / 1e6, 2)
        for th in threads_list:
            torch.set_num_threads(th)
            for side in (512, 1024):
                x = torch.rand(1, 3, side, side)
                with torch.no_grad():
                    net(x)
                    v = []
                    for _ in range(4):
                        t0 = time.perf_counter()
                        net(x)
                        v.append((time.perf_counter() - t0) * 1000.0)
                st[f"threads_{th}_ms_per_{side}_tile"] = round(statistics.median(v), 1)
    except Exception as e:  # noqa: BLE001
        st["error"] = f"{type(e).__name__}: {e}"
    report["student_proxy_cpu"] = st
    print(json.dumps(st), flush=True)

    # ---- Smoke ranking check: cells holding labelled weed points, caught at a fixed review budget
    smoke = {}
    try:
        labels = json.loads(LABELS.read_text())["labels"]
        wpts = [(l["x"], l["y"]) for l in labels if l["cls"] == "weed"]
        rfi = json.loads((out / "rfdetr_DJI_0301_instances.json").read_text())
        gh, gw = H // cell_native, W // cell_native

        def cell_of(x, y):
            return int(y // cell_native), int(x // cell_native)

        truth = np.zeros((gh, gw), np.int32)
        for x, y in wpts:
            i, j = cell_of(x, y)
            if i < gh and j < gw:
                truth[i, j] += 1
        rfgrid = np.zeros((gh, gw), np.float64)
        for w in rfi["weeds"]:
            i, j = cell_of(*w["c"])
            if i < gh and j < gw:
                rfgrid[i, j] += w["a"]
        cand = {"rfdetr_full_detail_weed_area": rfgrid}
        for k, g in grids.items():
            # every candidate grid back to the native 1 m grid shape (cells match up to rounding at reduced scales)
            gg = np.zeros((gh, gw))
            hh, ww = min(gh, g.shape[0]), min(gw, g.shape[1])
            gg[:hh, :ww] = g[:hh, :ww]
            cand[k] = gg
        rng = np.random.default_rng(0)
        cand["random"] = rng.random((gh, gw))
        pos = truth > 0
        smoke = {"cells": int(gh * gw), "cell_m": 1.0, "cells_with_labelled_weeds": int(pos.sum()), "labelled_weeds": len(wpts), "budgets": {}}
        for budget in (0.1, 0.2, 0.3, 0.5):
            k = int(round(budget * gh * gw))
            row = {}
            for name, g in cand.items():
                order = np.argsort(-g.ravel(), kind="stable")[:k]
                flagged = np.zeros(gh * gw, bool)
                flagged[order] = True
                flagged = flagged.reshape(gh, gw)
                row[name] = {"cell_recall": round(float((flagged & pos).sum() / max(1, pos.sum())), 3), "point_recall": round(float(truth[flagged].sum() / max(1, truth.sum())), 3)}
            smoke["budgets"][f"{int(budget * 100)}%"] = row
        smoke["note"] = "one frame of the development field; labels are NOT exhaustive (414 weed points); recall of labelled weed cells only; no precision or false-hotspot rate is supported; ExG without row geometry (rows are read from the map, not this photo)"
    except Exception as e:  # noqa: BLE001
        smoke["error"] = f"{type(e).__name__}: {e}"
    report["smoke_ranking"] = smoke
    print(json.dumps(smoke)[:3000], flush=True)

    (out / "cpu_profile.json").write_text(json.dumps(report, indent=1))
    (out / "cpu_done.txt").write_text("done")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=("gpu", "cpu"), required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--threads", default="4,12")
    a = ap.parse_args()
    o = Path(a.out)
    o.mkdir(parents=True, exist_ok=True)
    if a.mode == "gpu":
        gpu_mode(o)
    else:
        cpu_mode(o, [int(x) for x in a.threads.split(",")])
