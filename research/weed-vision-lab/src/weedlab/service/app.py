"""The local research inference HTTP service (Flask), bound to 127.0.0.1 only.

Endpoints (all under /weed-vision):
  GET  /health                 service, model and limits
  GET  /algorithms             the registry (weedlab.service.algorithms)
  POST /detect                 multipart: image, algorithm, scale, tile, overlap, include_rle, include_crop, async
                               -> result JSON, or {"job_id"} when async=1
  GET  /jobs/<id>              {"state": queued|running|done|error, "progress": {...}, "result": ...}
  POST /evaluate               multipart: image, reference (PNG: uint16 instance ids or 8-bit mask), algorithm, scale
                               -> prediction result plus metrics against the supplied reference (scoring only)

Result schema: see docs/research-preview.md (also returned by GET /schema).
No CORS headers are set: the Vite dev server proxies /weed-vision-api to this
process, so the browser never talks cross-origin. Imagery stays in memory and
is never written to disk by the service.
"""

from __future__ import annotations

import ctypes
import io
import json
import os
import threading
import time
import traceback
import uuid
from pathlib import Path

import numpy as np
from flask import Flask, jsonify, request
from PIL import Image, ImageOps

from weedlab import LAB_VERSION
from weedlab.service import SERVICE_VERSION
from weedlab.service.algorithms import ALGORITHMS, SELECTED, run_algorithm
from weedlab.service.instances import extract_instances, polygons_of
from weedlab.service.rfdetr import DEFAULT_THRESHOLD, RFDetrHolder, run_rfdetr
from weedlab.service.tiling import OVERLAP_DEFAULT, TILE_DEFAULT, rescale_image

DEFAULT_CKPT = os.environ.get("WEEDLAB_ERFNET_CKPT", "D:/swardus-research/checkpoints/phenobench-baselines/semantic-seg-erfnet.ckpt")
DEFAULT_RFDETR_CKPT = os.environ.get("WEEDLAB_RFDETR_CKPT", "D:/swardus-research/rfdetr-exp7/runs/seg_large/checkpoint_best_total.pth")
MAX_PIXELS = 120_000_000
MAX_BYTES = 120 * 1024 * 1024
MIN_SIDE = 64
Image.MAX_IMAGE_PIXELS = MAX_PIXELS + 1


def peak_working_set_mb() -> float | None:
    if os.name != "nt":
        return None

    class PMC(ctypes.Structure):
        _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong), ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t), ("a", ctypes.c_size_t), ("b", ctypes.c_size_t), ("c", ctypes.c_size_t), ("d", ctypes.c_size_t), ("e", ctypes.c_size_t), ("f", ctypes.c_size_t)]

    k = ctypes.windll.kernel32
    fn = getattr(k, "K32GetProcessMemoryInfo", None)
    if fn is None:
        return None
    fn.argtypes = [ctypes.c_void_p, ctypes.POINTER(PMC), ctypes.c_ulong]
    fn.restype = ctypes.c_int
    k.GetCurrentProcess.restype = ctypes.c_void_p
    p = PMC()
    p.cb = ctypes.sizeof(PMC)
    return round(p.PeakWorkingSetSize / 1048576, 1) if fn(k.GetCurrentProcess(), ctypes.byref(p), p.cb) else None


class ModelHolder:
    def __init__(self, ckpt: str, threads: int):
        self.path = Path(ckpt)
        self.threads = threads
        self.model = None
        self.sha256 = None
        self.error = None
        self.load_ms = None
        self.lock = threading.Lock()

    def load(self) -> None:
        with self.lock:
            if self.model is not None or self.error is not None:
                return
            try:
                import torch

                from weedlab.detect.erfnet import load_model
                from weedlab.postprocess.cache import sha256_of

                if not self.path.exists():
                    raise FileNotFoundError(f"checkpoint not found at {self.path}")
                t0 = time.perf_counter()
                torch.set_num_threads(self.threads)
                self.model = load_model(self.path)
                self.sha256 = sha256_of(self.path)
                self.load_ms = round((time.perf_counter() - t0) * 1000.0, 1)
            except Exception as e:  # noqa: BLE001
                self.error = f"{type(e).__name__}: {e}"

    def status(self) -> dict:
        return {"loaded": self.model is not None, "checkpoint_path": str(self.path), "checkpoint_sha256": (self.sha256[:16] + "...") if self.sha256 else None, "load_ms": self.load_ms, "error": self.error, "threads": self.threads,
                "licence_note": "PhenoBench-trained ERFNet checkpoint: research use only; see docs/license-inventory.md"}


def decode_upload(file_storage) -> tuple[np.ndarray, dict]:
    raw = file_storage.read()
    if not raw:
        raise ValueError("empty upload")
    if len(raw) > MAX_BYTES:
        raise ValueError(f"file is {len(raw) / 1048576:.0f} MB; the limit is {MAX_BYTES // 1048576} MB")
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"not a decodable image: {type(e).__name__}") from e
    fmt = im.format
    im = ImageOps.exif_transpose(im)
    if im.width * im.height > MAX_PIXELS:
        raise ValueError(f"{im.width} x {im.height} exceeds the {MAX_PIXELS // 1_000_000} megapixel limit")
    if im.width < MIN_SIDE or im.height < MIN_SIDE:
        raise ValueError(f"image must be at least {MIN_SIDE} px on each side")
    if im.mode != "RGB":
        im = im.convert("RGB")
    exif = {}
    try:
        ex = im.getexif()
        exif = {"make": ex.get(271), "model": ex.get(272), "datetime": ex.get(306)}
    except Exception:  # noqa: BLE001
        pass
    return np.asarray(im, dtype=np.uint8), {"filename": file_storage.filename, "format": fmt, "bytes": len(raw), "width": im.width, "height": im.height, "exif": exif}


def parse_params(form) -> dict:
    alg = form.get("algorithm", "selected")
    if alg not in ALGORITHMS:
        raise ValueError(f"unknown algorithm {alg!r}; one of {sorted(ALGORITHMS)}")
    scale = float(form.get("scale", "1.0"))
    if not 0.05 <= scale <= 1.0:
        raise ValueError("scale must be between 0.05 and 1.0")
    tile = int(form.get("tile", TILE_DEFAULT))
    overlap = int(form.get("overlap", OVERLAP_DEFAULT))
    if tile % 8 or tile < 256 or tile > 2048:
        raise ValueError("tile must be a multiple of 8 between 256 and 2048")
    if not 0 <= overlap < tile:
        raise ValueError("overlap must be between 0 and tile - 1")
    resolved = SELECTED if alg == "selected" else alg
    threshold = float(form.get("threshold", ALGORITHMS[resolved].get("default_threshold", DEFAULT_THRESHOLD)))
    if not 0.05 <= threshold <= 0.95:
        raise ValueError("threshold must be between 0.05 and 0.95")
    return {"algorithm": alg, "scale": scale, "tile": tile, "overlap": overlap, "threshold": threshold,
            "include_rle": form.get("include_rle", "0") in ("1", "true"), "include_crop": form.get("include_crop", "1") in ("1", "true"),
            "polygon_tolerance": float(form.get("polygon_tolerance", "0.8"))}


def holder_for(name: str, holders: dict):
    """The model holder an algorithm needs (None for colour algorithms). `holders` maps "erfnet" / "rfdetr" to holders;
    a bare ModelHolder is accepted for backward compatibility and treated as the ERFNet holder."""
    key = ALGORITHMS[name].get("model")
    if key is None:
        return None
    if isinstance(holders, dict):
        return holders.get(key)
    return holders if key == "erfnet" else None


def run_detection(rgb: np.ndarray, meta: dict, params: dict, holders, progress=None) -> dict:
    t: dict[str, float] = {}
    warnings: list[str] = []
    t0 = time.perf_counter()
    rgb_p = rescale_image(rgb, params["scale"])
    t["rescale"] = round((time.perf_counter() - t0) * 1000.0, 1)
    name = SELECTED if params["algorithm"] == "selected" else params["algorithm"]
    holder = holder_for(name, holders)
    model = None
    if ALGORITHMS[name]["needs_model"]:
        if holder is None:
            raise RuntimeError(f"{ALGORITHMS[name]['model']} checkpoint unavailable: no model holder configured")
        holder.load()
        if holder.model is None:
            raise RuntimeError(f"{ALGORITHMS[name]['model']} checkpoint unavailable: {holder.error}")
        model = holder.model
    a = time.perf_counter()
    crop_instances = None
    if ALGORITHMS[name]["family"] == "rfdetr":
        rf = run_rfdetr(rgb_p, holder, tile=params["tile"], overlap=params["overlap"], threshold=params["threshold"], scale=params["scale"], tolerance=params["polygon_tolerance"], include_rle=params["include_rle"], progress=progress)
        labels, score_img, info, instances, crop_instances = rf["labels"], rf["score_img"], rf["info"], rf["instances"], rf["crop_instances"]
        warnings += rf["warnings"]
        t.update(info["timings_ms"])
        t["algorithm_total"] = round((time.perf_counter() - a) * 1000.0, 1)
        crop_regions = rf["crop_regions_px"] if params["include_crop"] else None
        info["crop_mask"] = None  # regions already come from the crop instances
    else:
        labels, score_img, info = run_algorithm(name, rgb_p, model, params["tile"], params["overlap"], progress=progress)
        t.update(info["timings_ms"])
        t["algorithm_total"] = round((time.perf_counter() - a) * 1000.0, 1)
        a = time.perf_counter()
        instances, w2 = extract_instances(labels, score_img, params["scale"], tolerance=params["polygon_tolerance"], include_rle=params["include_rle"], score_name=info.get("score_kind", "score"))
        warnings += w2
        t["geometry_and_polygons"] = round((time.perf_counter() - a) * 1000.0, 1)
        crop_regions = None
    if params["include_crop"] and info.get("crop_mask") is not None and info["crop_mask"].any():
        a = time.perf_counter()
        from scipy import ndimage

        cl, n = ndimage.label(info["crop_mask"], structure=np.ones((3, 3), bool))
        inv = 1.0 / params["scale"]
        crop_regions = []
        for k, sl in enumerate(ndimage.find_objects(cl, max_label=n), 1):
            if sl is None:
                continue
            ys, xs = sl
            m = cl[sl] == k
            if m.sum() < 50:
                continue
            for poly in polygons_of(m, (0, 0, m.shape[1], m.shape[0]), 1.5)[:1]:
                crop_regions.append([[round((x + xs.start) * inv, 1), round((y + ys.start) * inv, 1)] for x, y in poly])
        t["crop_regions"] = round((time.perf_counter() - a) * 1000.0, 1)
    if ALGORITHMS[name]["family"] == "colour":
        warnings.append("colour algorithm: it finds vegetation, so crops are reported as instances too")
    if params["scale"] < 1.0:
        warnings.append(f"processed at {params['scale']:.3f} of native resolution; a 1 px erosion there is {1 / params['scale']:.1f} px in the original, and weeds under ~{int(100 / params['scale'] ** 2)} px² original may not survive")
    if meta["width"] * meta["height"] > 30_000_000 and params["scale"] == 1.0 and ALGORITHMS[name]["family"] != "rfdetr":
        warnings.append("large image at native scale: expect tens of seconds on CPU")
    t["total"] = round((time.perf_counter() - t0) * 1000.0, 1)
    family = ALGORITHMS[name]["family"]
    result = {
        "schema_version": "weed-vision-preview-result-1",
        "run_id": uuid.uuid4().hex[:12],
        "research_only": True,
        "image": {**meta, "coordinate_system": "original image pixels, x right, y down, pixel centres at integers"},
        "processing": {"scale": params["scale"], "width": rgb_p.shape[1], "height": rgb_p.shape[0], "tiles": info.get("tiles"), "tile_px": info.get("tile_px"), "overlap_px": info.get("overlap_px"), "effective_px_per_original_px": params["scale"],
                       "threshold": params["threshold"] if family == "rfdetr" else None, "model_resolution": info.get("model_resolution"), "device": info.get("device")},
        "algorithm": {"name": name, **{k: v for k, v in ALGORITHMS[name].items() if k != "alias_of"}, "requested": params["algorithm"], "separation": info.get("separation")},
        "model": holder.status() if ALGORITHMS[name]["needs_model"] else None,
        "versions": {"service": SERVICE_VERSION, "lab": LAB_VERSION},
        "classes": ["crop", "weed"] if family == "rfdetr" else (["weed"] if family == "erfnet" else ["vegetation"]),
        "count": len(instances),
        "instances": instances,
        "crop_instances": crop_instances,
        "crop_regions_px": crop_regions,
        "pixel_fractions": {"weed": info.get("weed_pixel_fraction"), "crop": info.get("crop_pixel_fraction")},
        "timings_ms": t,
        "memory": {"peak_working_set_mb": peak_working_set_mb(), "peak_gpu_mb": info.get("peak_gpu_mb")},
        "warnings": warnings,
        "measurement_note": "pixel units only; no physical calibration was applied; definitions in weedlab.service.instances",
    }
    return result, labels


def evaluate_against(labels: np.ndarray, scale: float, ref_arr: np.ndarray, native_shape: tuple[int, int]) -> dict:
    """Score prediction labels (at processing scale) against a supplied reference instance mask at native resolution."""
    from skimage.transform import resize

    from weedlab.eval.matching import score_image
    from weedlab.phenobench.instances import extract_plant_instances

    h, w = native_shape
    if ref_arr.shape != (h, w):
        raise ValueError(f"reference is {ref_arr.shape[1]} x {ref_arr.shape[0]} but the image is {w} x {h}")
    if ref_arr.dtype == np.bool_ or ref_arr.max() <= 1:
        from scipy import ndimage

        ref_inst, _ = ndimage.label(ref_arr > 0, structure=np.ones((3, 3), bool))
        ref_inst = ref_inst.astype(np.uint16)
    else:
        ref_inst = ref_arr.astype(np.uint16)
    sem = np.where(ref_inst > 0, 2, 0).astype(np.uint16)  # every reference instance is a weed
    lab_n = labels if scale == 1.0 else resize(labels, (h, w), order=0, anti_aliasing=False, preserve_range=True).astype(np.int32)
    n = int(lab_n.max())
    recs = [{"det_id": k, "score": 0.0} for k in range(1, n + 1)]
    plants = extract_plant_instances(sem, ref_inst)
    sc = score_image(lab_n, n, recs, sem, ref_inst, plants, {}, "upload")
    refs, dets = sc.references, sc.detections
    tp = sum(1 for d in dets if d["matched@0.5"])
    fp = n - tp
    fn = sum(1 for r in refs if not r["matched@0.5"])
    pred = lab_n > 0
    refm = ref_inst > 0
    inter = int((pred & refm).sum())
    out = {
        "reference_instances": len(refs), "predicted_instances": n,
        "detection": {"iou_0.5": {"tp": tp, "fp": fp, "fn": fn, "precision": round(tp / max(1, tp + fp), 4), "recall": round(tp / max(1, len(refs)), 4)},
                      "iou_0.3": {"recall": round(sum(1 for r in refs if r["matched@0.3"]) / max(1, len(refs)), 4)}},
        "count_error": n - len(refs),
        "mask_iou": round(inter / max(1, int((pred | refm).sum())), 4),
        "pixel_precision": round(inter / max(1, int(pred.sum())), 4), "pixel_recall": round(inter / max(1, int(refm.sum())), 4),
        "instance_iou_median": round(float(np.median([r["best_iou"] for r in refs])), 4) if refs else None,
        "per_reference": [{k: r[k] for k in ("instance_id", "area_px", "found", "matched@0.5", "matched@0.3", "best_iou", "best_det", "merged_with_weed", "split", "q_dice", "q_boundary_f1", "q_fp_px", "q_fn_px")} for r in refs],
        "per_detection": [{k: d[k] for k in ("det_id", "area_px", "matched@0.5", "matched@0.3")} for d in dets],
        "regions_px": {
            "false_positive": [p for p in polygons_of(pred & ~refm, (0, 0, w, h), 1.0)[:400]],
            "missed": [p for p in polygons_of(refm & ~pred, (0, 0, w, h), 1.0)[:400]],
            "true_positive": [p for p in polygons_of(pred & refm, (0, 0, w, h), 1.0)[:400]],
        },
        "note": "the reference was used for scoring only, after inference; every reference instance was treated as a weed",
    }
    return out


def create_app(ckpt: str = DEFAULT_CKPT, threads: int | None = None, preload: bool = False, rfdetr_ckpt: str | None = DEFAULT_RFDETR_CKPT, rfdetr_device: str | None = None) -> Flask:
    app = Flask("weed-vision-preview")
    app.config["MAX_CONTENT_LENGTH"] = MAX_BYTES + 1024 * 1024
    holder = ModelHolder(ckpt, threads or max(1, (os.cpu_count() or 2)))
    holders = {"erfnet": holder, "rfdetr": RFDetrHolder(rfdetr_ckpt, rfdetr_device) if rfdetr_ckpt else None}
    jobs: dict[str, dict] = {}
    jobs_lock = threading.Lock()
    if preload:
        holder.load()
        if holders["rfdetr"] is not None:
            holders["rfdetr"].load()
            holders["rfdetr"].warmup()

    def models_status() -> dict:
        return {k: (h.status() if h is not None else {"loaded": False, "error": "not configured"}) for k, h in holders.items()}

    @app.get("/weed-vision/health")
    def health():
        return jsonify({"ok": True, "service": SERVICE_VERSION, "lab": LAB_VERSION, "research_only": True, "model": holder.status(), "models": models_status(),
                        "limits": {"max_megapixels": MAX_PIXELS // 1_000_000, "max_mb": MAX_BYTES // 1048576, "min_side_px": MIN_SIDE},
                        "defaults": {"algorithm": "selected", "selected": SELECTED, "scale": 1.0, "tile": TILE_DEFAULT, "overlap": OVERLAP_DEFAULT, "threshold": DEFAULT_THRESHOLD}})

    @app.get("/weed-vision/algorithms")
    def algorithms():
        return jsonify({"selected": SELECTED, "algorithms": {k: {kk: vv for kk, vv in v.items()} for k, v in ALGORITHMS.items()}})

    def _job_run(job_id: str, rgb, meta, params):
        def progress(done, total):
            with jobs_lock:
                jobs[job_id]["progress"] = {"tiles_done": done, "tiles_total": total}

        try:
            with jobs_lock:
                jobs[job_id]["state"] = "running"
            result, _ = run_detection(rgb, meta, params, holders, progress=progress)
            with jobs_lock:
                jobs[job_id].update({"state": "done", "result": result})
        except Exception as e:  # noqa: BLE001
            with jobs_lock:
                jobs[job_id].update({"state": "error", "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-2000:]})

    @app.post("/weed-vision/detect")
    def detect():
        t0 = time.perf_counter()
        try:
            if "image" not in request.files:
                return jsonify({"error": "multipart field 'image' is required"}), 400
            rgb, meta = decode_upload(request.files["image"])
            meta["decode_ms"] = round((time.perf_counter() - t0) * 1000.0, 1)
            params = parse_params(request.form)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        if request.form.get("async", "0") in ("1", "true"):
            job_id = uuid.uuid4().hex[:12]
            with jobs_lock:
                jobs[job_id] = {"state": "queued", "progress": {"tiles_done": 0, "tiles_total": None}, "created": time.time()}
            threading.Thread(target=_job_run, args=(job_id, rgb, meta, params), daemon=True).start()
            return jsonify({"job_id": job_id, "state": "queued"}), 202
        try:
            result, _ = run_detection(rgb, meta, params, holders)
        except RuntimeError as e:
            return jsonify({"error": str(e), "model": holder.status(), "models": models_status()}), 503
        except Exception as e:  # noqa: BLE001
            return jsonify({"error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-2000:]}), 500
        result["timings_ms"]["decode"] = meta["decode_ms"]
        result["timings_ms"]["request_total"] = round((time.perf_counter() - t0) * 1000.0, 1)
        return jsonify(result)

    @app.get("/weed-vision/jobs/<job_id>")
    def job(job_id: str):
        with jobs_lock:
            j = jobs.get(job_id)
            if j is None:
                return jsonify({"error": "unknown job"}), 404
            payload = {"job_id": job_id, "state": j["state"], "progress": j.get("progress")}
            if j["state"] == "done":
                payload["result"] = j["result"]
                jobs.pop(job_id, None)
            elif j["state"] == "error":
                payload["error"] = j["error"]
                payload["trace"] = j.get("trace")
                jobs.pop(job_id, None)
        return jsonify(payload), (503 if payload["state"] == "error" and "checkpoint" in payload.get("error", "") else 200)

    @app.post("/weed-vision/evaluate")
    def evaluate():
        t0 = time.perf_counter()
        try:
            if "image" not in request.files or "reference" not in request.files:
                return jsonify({"error": "multipart fields 'image' and 'reference' are required"}), 400
            rgb, meta = decode_upload(request.files["image"])
            params = parse_params(request.form)
            ref_im = Image.open(io.BytesIO(request.files["reference"].read()))
            ref_im.load()
            if ref_im.mode not in ("I;16", "I;16B", "I;16L", "I", "L", "1"):
                ref_im = ref_im.convert("L")
            ref_arr = np.asarray(ref_im)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:  # noqa: BLE001
            return jsonify({"error": f"reference could not be read: {type(e).__name__}: {e}"}), 400
        try:
            result, labels = run_detection(rgb, meta, params, holders)
            a = time.perf_counter()
            result["evaluation"] = evaluate_against(labels, params["scale"], ref_arr, rgb.shape[:2])
            result["timings_ms"]["evaluation"] = round((time.perf_counter() - a) * 1000.0, 1)
            result["timings_ms"]["request_total"] = round((time.perf_counter() - t0) * 1000.0, 1)
        except RuntimeError as e:
            return jsonify({"error": str(e), "model": holder.status(), "models": models_status()}), 503
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:  # noqa: BLE001
            return jsonify({"error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-2000:]}), 500
        return jsonify(result)

    @app.get("/weed-vision/schema")
    def schema():
        doc = Path(__file__).resolve().parents[3] / "docs" / "research-preview.md"
        return jsonify({"doc": str(doc), "exists": doc.exists()})

    @app.errorhandler(413)
    def too_large(_e):
        return jsonify({"error": f"upload exceeds {MAX_BYTES // 1048576} MB"}), 413

    app.holder = holder  # type: ignore[attr-defined]
    app.holders = holders  # type: ignore[attr-defined]
    return app


def main(argv=None) -> int:
    import argparse

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="127.0.0.1", help="loopback only; anything else is refused")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--ckpt", default=DEFAULT_CKPT, help="ERFNet checkpoint")
    ap.add_argument("--rfdetr-ckpt", default=DEFAULT_RFDETR_CKPT, help="RF-DETR Seg-Large checkpoint (Experiment 7); '' disables the algorithm")
    ap.add_argument("--rfdetr-device", default=None, help="cuda or cpu; default: cuda when available")
    ap.add_argument("--threads", type=int, default=None, help="CPU threads for torch; default: a third of the machine's, so the desktop stays usable while a scan runs")
    ap.add_argument("--no-preload", action="store_true")
    ap.add_argument("--normal-priority", action="store_true", help="keep normal process priority (default: below normal on Windows)")
    args = ap.parse_args(argv)
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print("refusing to bind a non-loopback address: this service is research-only and must not be exposed", flush=True)
        return 2
    # A model service beside a person's work: a third of the cores for CPU-side work (ERFNet, the assignment and mask
    # steps of RF-DETR) and below-normal priority, so the browser and the desktop keep their share of the machine.
    if args.threads is None:
        args.threads = max(2, (os.cpu_count() or 4) // 3)
    if os.name == "nt" and not args.normal_priority:
        import ctypes

        BELOW_NORMAL_PRIORITY_CLASS = 0x00004000
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), BELOW_NORMAL_PRIORITY_CLASS)
    app = create_app(args.ckpt, args.threads, preload=not args.no_preload, rfdetr_ckpt=args.rfdetr_ckpt or None, rfdetr_device=args.rfdetr_device)
    st = {k: (h.status() if h is not None else None) for k, h in app.holders.items()}  # type: ignore[attr-defined]
    print(json.dumps({"service": SERVICE_VERSION, "listening": f"http://{args.host}:{args.port}/weed-vision/health", "models": st}, indent=1), flush=True)
    app.run(host=args.host, port=args.port, threaded=True, debug=False, use_reloader=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
