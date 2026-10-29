# Hybrid weed candidates: the segmenter decides what is corn, colour decides what is green; green that the model does
# not call crop, standing at least `--gap-px` from any crop pixel, is a weed candidate. Reads a photo and the
# segmenter's mask (seg_train.py predict, any scale; resized to the photo) and writes an overlay + JSON per photo.
#   python -I scripts/rowCrop/seg_hybrid.py --photos a.jpg ... --masks <dir with <name>-mask.png> --out <dir>
#       [--min-px 12] [--gap-px 3] [--exgr 0.05]
import argparse, os, json
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("--photos", nargs="+", required=True); ap.add_argument("--masks", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--min-px", type=int, default=12); ap.add_argument("--gap-px", type=int, default=3); ap.add_argument("--exgr", type=float, default=0.15)
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)

def dilate(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy > r * r: continue
            sh = np.zeros_like(m)
            ys, yd = (slice(dy, None), slice(None, -dy or None)) if dy >= 0 else (slice(None, dy), slice(-dy, None))
            xs, xd = (slice(dx, None), slice(None, -dx or None)) if dx >= 0 else (slice(None, dx), slice(-dx, None))
            sh[ys, xs] = m[yd, xd]; out |= sh
    return out

def components(mask):
    from collections import deque
    H, W = mask.shape; lab = np.zeros((H, W), dtype=np.int32); comps = []; n = 0
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]: continue
        n += 1; q = deque([(y0, x0)]); lab[y0, x0] = n; pts = []
        while q:
            y, x = q.popleft(); pts.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < H and 0 <= xx < W and mask[yy, xx] and not lab[yy, xx]: lab[yy, xx] = n; q.append((yy, xx))
        comps.append(pts)
    return comps

summary = []
for p in args.photos:
    name = os.path.splitext(os.path.basename(p))[0]
    im = Image.open(p).convert("RGB"); W, H = im.size
    # Work at half size for speed (about 1 cm a pixel on these photographs).
    w2, h2 = W // 2, H // 2
    rgb = np.array(im.resize((w2, h2), Image.BOX)).astype(np.float32)
    seg = np.array(Image.open(f"{args.masks}/{name}-mask.png").resize((w2, h2), Image.NEAREST))
    s = rgb.sum(-1) + 1e-6; r, g, b = rgb[..., 0] / s, rgb[..., 1] / s, rgb[..., 2] / s
    exgr = 2 * g - r - b - (1.4 * r - g)
    # Soil-relative, as the row reader's green: per 64 px tile, the soil level is the tile's 25th percentile (capped at
    # the photo's own 25th percentile + 0.05 so a tile of solid canopy does not call itself soil), and green stands
    # `--exgr` above it (default 0.15, the reader's margin).
    T = 64; soil_g = np.percentile(exgr, 25); lvl = np.zeros_like(exgr)
    for y in range(0, h2, T):
        for x in range(0, w2, T):
            t = exgr[y:y + T, x:x + T]; lvl[y:y + T, x:x + T] = min(np.percentile(t, 25), soil_g + 0.05)
    green = exgr > np.maximum(-0.1, lvl + args.exgr)
    crop = seg == 1
    near_crop = dilate(crop, args.gap_px)
    cand = green & ~near_crop
    comps = [c for c in components(cand) if len(c) >= args.min_px]
    ov = Image.fromarray(rgb.astype(np.uint8)).convert("RGBA"); layer = np.zeros((h2, w2, 4), dtype=np.uint8)
    layer[crop] = (0, 200, 255, 70)
    for c in comps:
        ys = np.array([q[0] for q in c]); xs = np.array([q[1] for q in c])
        layer[ys, xs] = (255, 30, 30, 230)
        # A ring so small weeds are visible at a glance.
        cy, cx, rad = int(ys.mean()), int(xs.mean()), int(max(6, np.sqrt(len(c)) * 1.5))
        for t in np.linspace(0, 2 * np.pi, 48):
            yy, xx = int(cy + rad * np.sin(t)), int(cx + rad * np.cos(t))
            if 0 <= yy < h2 and 0 <= xx < w2: layer[yy, xx] = (255, 255, 0, 255)
    ov.alpha_composite(Image.fromarray(layer)); ov.convert("RGB").save(f"{args.out}/{name}-hybrid.jpg", quality=88)
    summary.append({"photo": p, "weedCandidates": len(comps), "weedPx": int(sum(len(c) for c in comps)), "cropShare": round(float(crop.mean()), 3), "greenShare": round(float(green.mean()), 3)})
    print(name, summary[-1])
json.dump(summary, open(f"{args.out}/summary.json", "w"), indent=1)
