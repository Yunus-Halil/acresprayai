"""Prepare WeedsGalore (Celikkan et al. 2025, CC BY 4.0) for the crop-profile benchmark.

The dataset ships each 600 x 600 patch as five 16-bit band images (B, G, R, RE, NIR) from a DJI Phantom 4
Multispectral at 5 m (0.25 cm a pixel), with semantic labels 0 background, 1 maize, 2 amaranth, 3 barnyard grass,
4 quickweed, 5 other weed, and the authors' spatial train / val / test split.

This writes, for every patch, an 8-bit RGB composite and an 8-bit label image:
  <out>/<split>/<date>_<id>.png        RGB: R, G, B bands x one common gain, then sRGB-like gamma 1/2.2
  <out>/<split>/<date>_<id>.labels.png labels 0..5 in the red channel (8-bit grey)
  <out>/manifest.json                  the gain, its basis, and the patch list per split and date

The gain is ONE number for all three bands (band ratios, so colour, are kept as measured), set so the 99.5th
percentile of R, G and B over the TRAIN and VAL patches maps to 255. Test patches and every label are unused for it,
so nothing about the held-out set informs the preparation. Gamma mimics a camera's encoding, which the app's
thresholds were set on. These composites are not a consumer RGB camera: P4M bands are narrow, and the benchmark says so.

Run with an isolated interpreter (the data is downloaded):
  python -I scripts/cropProfiles/prep_weedsgalore.py --src D:/swardus-research/datasets/weedsgalore/extracted/weedsgalore-dataset --out D:/swardus-research/datasets/weedsgalore/rgb
"""
import argparse
import json
import os

import numpy as np
from PIL import Image


def read_band(path):
    return np.asarray(Image.open(path), dtype=np.float64)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    splits = {}
    for name in ("train", "val", "test"):
        with open(os.path.join(a.src, "splits", f"{name}.txt"), encoding="utf8") as f:
            splits[name] = [l.strip() for l in f if l.strip()]

    def bands(pid):
        date = pid[:10]
        base = os.path.join(a.src, date, "images", pid)
        return [read_band(f"{base}_{b}.png") for b in ("R", "G", "B")]

    # One common gain from train + val only.
    samples = []
    for pid in splits["train"] + splits["val"]:
        r, g, b = bands(pid)
        samples.append(np.concatenate([r.ravel()[::7], g.ravel()[::7], b.ravel()[::7]]))
    p995 = float(np.percentile(np.concatenate(samples), 99.5))
    gain = 1.0 / p995

    manifest = {"source": "WeedsGalore (Celikkan et al. 2025), CC BY 4.0, https://doidata.gfz.de/weedsgalore_e_celikkan_2024/",
                "gsdCm": 0.25, "rowSpacingM": 0.70, "inRowM": 0.20, "sown": "2023-05-09",
                "statedStages": {"2023-05-25": "V1"},
                "gain": {"value": gain, "p995": p995, "basis": "99.5th percentile of R, G, B over train and val patches"},
                "gamma": 1 / 2.2, "classes": {"0": "background", "1": "maize", "2": "amaranth", "3": "barnyard grass", "4": "quickweed", "5": "other weed"},
                "splits": {}}
    for name, ids in splits.items():
        os.makedirs(os.path.join(a.out, name), exist_ok=True)
        manifest["splits"][name] = ids
        for pid in ids:
            r, g, b = bands(pid)
            rgb = np.stack([r, g, b], axis=-1) * gain
            rgb = np.clip(rgb, 0, 1) ** (1 / 2.2)
            Image.fromarray((rgb * 255 + 0.5).astype(np.uint8), "RGB").save(os.path.join(a.out, name, f"{pid}.png"))
            lab = np.asarray(Image.open(os.path.join(a.src, pid[:10], "semantics", f"{pid}.png")), dtype=np.uint8)
            Image.fromarray(lab, "L").save(os.path.join(a.out, name, f"{pid}.labels.png"))
    with open(os.path.join(a.out, "manifest.json"), "w", encoding="utf8") as f:
        json.dump(manifest, f, indent=1)
    print(json.dumps({k: len(v) for k, v in splits.items()}), "gain", gain)


if __name__ == "__main__":
    main()
