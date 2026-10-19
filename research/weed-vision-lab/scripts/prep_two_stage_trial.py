"""Orchard frames as stand-in field maps for the two-stage trial (2026-10-19).

The real orthomosaic is only reachable through the signed-in app, so each kept orchard frame is placed as a map:
north-up (the frame's heading is ignored), centred on its EXIF GPS position, resampled with a box filter from its
estimated 0.99 cm/px to the Web Mercator pixel of zoom 23 and of zoom 22 at that latitude. The originals are only read.

    python scripts/prep_two_stage_trial.py --out <dir> DJI_0301 DJI_0303 ...

Writes <out>/<frame>/{z23.rgba, z22.rgba, meta.json}; meta carries each raster's global pixel origin and size, the
scale from frame pixels to z23 pixels, and (for DJI_0301) the labelled points in z23 global pixels.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
FRAMES = ROOT / "samplerowtestingimagery"
LABELS = {"DJI_0301": ROOT / "evaluation" / "groundtruth" / "image1" / "DJI_0301.labels.json"}
GSD_M = 0.0099  # evaluation/groundtruth/image1/results/report.md: 36 m above take-off, 8.8 mm, 24 mm equivalent


def dms(v) -> float:
    d, m, s = (float(x) for x in v)
    return d + m / 60 + s / 3600


def mercator_px(lat: float, lng: float, z: int) -> tuple[float, float]:
    s = 256 * 2**z
    r = math.radians(lat)
    return (lng + 180) / 360 * s, (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * s


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("frames", nargs="+")
    a = ap.parse_args()
    out = Path(a.out)
    for name in a.frames:
        src = FRAMES / f"{name}.JPG"
        im = Image.open(src)
        gps = im.getexif().get_ifd(0x8825)
        lat, lng = dms(gps[2]), dms(gps[4])
        if gps.get(1) == "S":
            lat = -lat
        if gps.get(3) == "W":
            lng = -lng
        rgb = im.convert("RGB")
        mpp23 = 156543.03392 * math.cos(math.radians(lat)) / 2**23
        scale = GSD_M / mpp23
        w23, h23 = round(rgb.width * scale), round(rgb.height * scale)
        r23 = rgb.resize((w23, h23), Image.BOX)
        cx, cy = mercator_px(lat, lng, 23)
        X0, Y0 = round(cx - w23 / 2), round(cy - h23 / 2)
        # z22 from z23 on the same pixel grid: the origin even, so the halving lands on pixel edges.
        X0 -= X0 % 2
        Y0 -= Y0 % 2
        r22 = r23.resize((w23 // 2, h23 // 2), Image.BOX)
        d = out / name
        d.mkdir(parents=True, exist_ok=True)
        (d / "z23.rgba").write_bytes(r23.convert("RGBA").tobytes())
        (d / "z22.rgba").write_bytes(r22.convert("RGBA").tobytes())
        meta = {"frame": name, "source": str(src), "lat": lat, "lng": lng, "gsd_m": GSD_M, "mpp23": mpp23, "scale_to_z23": scale,
                "z23": {"X0": X0, "Y0": Y0, "w": w23, "h": h23}, "z22": {"X0": X0 // 2, "Y0": Y0 // 2, "w": w23 // 2, "h": h23 // 2},
                "note": "north-up stand-in map: heading ignored, flat ground, EXIF-estimated pixel size"}
        if name in LABELS:
            labs = json.loads(LABELS[name].read_text())["labels"]
            meta["labels"] = [{"cls": l["cls"], "X": X0 + l["x"] * scale, "Y": Y0 + l["y"] * scale} for l in labs]
        (d / "meta.json").write_text(json.dumps(meta, indent=1))
        print(name, lat, lng, w23, h23, round(scale, 4), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
