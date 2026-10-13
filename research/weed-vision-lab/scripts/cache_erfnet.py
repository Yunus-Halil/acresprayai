"""Run ERFNet once over a split and cache its softmax probabilities (see weedlab.postprocess.cache).

Writes <out>/cache/<CACHE_VERSION>/<split>/<image>.png and manifest.json.
Also measures the quantisation effect: on every 20th image, the fraction of
pixels whose uint8 argmax differs from the float argmax.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from multiprocessing import Pool
from pathlib import Path

import _bootstrap  # noqa: F401
import numpy as np

from weedlab import LAB_VERSION
from weedlab.config import DatasetNotFound, LAB_DIR, resolve_dataset_root, resolve_output_dir
from weedlab.postprocess.cache import CACHE_VERSION, CacheSpec, argmax_from, load_prob, quantise, save_prob, sha256_of

DEFAULT_CKPT = "D:/swardus-research/checkpoints/phenobench-baselines/semantic-seg-erfnet.ckpt"
_MODEL = None
_ARGS: dict = {}


def _init(args):
    global _MODEL, _ARGS
    import torch
    from weedlab.detect.erfnet import load_model

    _ARGS = args
    torch.set_num_threads(int(args["threads"]))
    _MODEL = load_model(Path(args["ckpt"]))


def work(job):
    import torch
    from weedlab.detect.erfnet import preprocess
    from weedlab.phenobench.reader import read_rgb

    split, name, check_quant = job
    out = Path(_ARGS["cache_root"]) / split / name
    if out.exists() and not _ARGS["force"]:
        return {"name": name, "skipped": True}
    rgb = read_rgb(Path(_ARGS["root"]) / split / "images" / name)
    t0 = time.perf_counter()
    with torch.no_grad():
        logits = _MODEL(preprocess(rgb))
        prob = torch.softmax(logits, dim=1)[0].numpy()
    ms = (time.perf_counter() - t0) * 1000.0
    save_prob(out, prob)
    rec = {"name": name, "ms": round(ms, 1), "bytes": out.stat().st_size}
    if check_quant:
        q = np.transpose(quantise(prob), (2, 0, 1)).astype(np.float32) / 255.0
        rec["argmax_disagreement_fraction"] = float((argmax_from(q) != np.argmax(prob, axis=0)).mean())
    return rec


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--splits", nargs="+", default=["dev_tune", "dev_check"])
    ap.add_argument("--ckpt", default=DEFAULT_CKPT)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--threads", type=int, default=3)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args(argv)
    try:
        root = resolve_dataset_root(args.root)
    except DatasetNotFound as e:
        print(e, file=sys.stderr)
        return 2
    sha = sha256_of(Path(args.ckpt))
    spec = CacheSpec(resolve_output_dir(args.out) / "cache" / CACHE_VERSION, sha)
    splits = json.loads((LAB_DIR / "reports" / "subset" / "soil_only_v1" / "splits.json").read_text(encoding="utf-8"))
    jobs = []
    for sp in args.splits:
        names = splits["images"][sp][: args.limit] if args.limit else splits["images"][sp]
        ds = "val" if sp == "holdout" else "train"
        jobs += [(ds, n, k % 20 == 0) for k, n in enumerate(names)]
    wargs = {"root": str(root), "ckpt": args.ckpt, "threads": args.threads, "cache_root": str(spec.root), "force": args.force}
    t0 = time.perf_counter()
    recs = []
    with Pool(args.workers, initializer=_init, initargs=(wargs,)) as pool:
        for k, r in enumerate(pool.imap(work, jobs, chunksize=4), 1):
            recs.append(r)
            if k % 100 == 0 or k == len(jobs):
                print(f"  {k}/{len(jobs)}  {time.perf_counter() - t0:.0f}s", flush=True)
    done = [r for r in recs if not r.get("skipped")]
    dis = [r["argmax_disagreement_fraction"] for r in done if "argmax_disagreement_fraction" in r]
    manifest_extra = {
        "lab_version": LAB_VERSION,
        "checkpoint": args.ckpt,
        "dataset_root": str(root),
        "splits_source": "reports/subset/soil_only_v1/splits.json",
        "splits": args.splits,
        "n_images_total": len(jobs),
        "n_written_this_run": len(done),
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "wall_seconds": round(time.perf_counter() - t0, 1),
        "workers": args.workers, "threads_per_worker": args.threads,
        "inference_ms_per_image_median": round(float(np.median([r["ms"] for r in done])), 1) if done else None,
        "bytes_per_image_median": int(np.median([r["bytes"] for r in done])) if done else None,
        "total_bytes": int(sum(p.stat().st_size for p in spec.root.rglob("*.png"))),
        "argmax_disagreement_fraction": {"n_checked": len(dis), "mean": round(float(np.mean(dis)), 6) if dis else None, "max": round(float(np.max(dis)), 6) if dis else None},
    }
    spec.write_manifest(manifest_extra)
    print(json.dumps(manifest_extra, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
