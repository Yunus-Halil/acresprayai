# Training tiles for the corn weed segmenter from licensed public data, at 0.5 cm a pixel, 448 px:
#   USU-Corn-WeedDB (CC BY 4.0): 640 px tiles at 0.48 cm with weed boxes -> green inside a box is weed, green
#     outside every box is crop, the rest background. Sources whose number ends in 0 or 5 are held out.
#   WeedsGalore (CC BY 4.0): the prepared RGB composites and semantic masks at 0.25 cm, resampled by 2 to 0.5 cm
#     (600 -> 300 px, padded to 448 with ignore); maize -> crop, every weed class -> weed. Its own test split is held out.
#   python -I scripts/rowCrop/seg_prepare.py --usu <Labeled_Dataset> --wg <weedsgalore/rgb> --out <dir>
import argparse, os, re, json, collections
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("--usu", required=True); ap.add_argument("--wg", required=True); ap.add_argument("--out", required=True)
args = ap.parse_args()
T = 448
os.makedirs(f"{args.out}/tiles", exist_ok=True); os.makedirs(f"{args.out}/masks", exist_ok=True)
man = []

def exgr_green(rgb):
    x = rgb.astype(np.float32); s = x.sum(-1) + 1e-6; r, g, b = x[..., 0] / s, x[..., 1] / s, x[..., 2] / s
    return (2 * g - r - b - (1.4 * r - g)) > 0.02

def save(stem, tile, mask, domain, split, extra=None):
    Image.fromarray(tile).save(f"{args.out}/tiles/{stem}.jpg", quality=92)
    Image.fromarray(mask).save(f"{args.out}/masks/{stem}.png")
    n = mask.size; man.append({"tile": f"tiles/{stem}.jpg", "mask": f"masks/{stem}.png", "domain": domain, "split": split, "shares": [round(float((mask == k).sum() / n), 3) for k in (0, 1, 2, 255)], **(extra or {})})

# ---- USU
n_usu = 0
for split in ("train", "val", "test"):
    d = f"{args.usu}/images/{split}"
    for n in sorted(os.listdir(d)):
        m = re.match(r"(.*)\((\d+)\)_x(\d+)_y(\d+)\.jpg$", n)
        if not m: continue
        src = int(m.group(2)); hold = src % 5 == 0
        rgb = np.array(Image.open(f"{d}/{n}").convert("RGB"))
        boxes = []
        lab = f"{args.usu}/labels/{split}/{n[:-4]}.txt"
        if os.path.exists(lab):
            for line in open(lab):
                p = line.split()
                if len(p) >= 5: boxes.append((int(p[0]), float(p[1]) * 640, float(p[2]) * 640, float(p[3]) * 640, float(p[4]) * 640))
        green = exgr_green(rgb)
        inbox = np.zeros(green.shape, dtype=bool)
        for _, cx, cy, w, h in boxes:
            x0, y0, x1, y1 = int(max(0, cx - w / 2 - 2)), int(max(0, cy - h / 2 - 2)), int(min(640, cx + w / 2 + 2)), int(min(640, cy + h / 2 + 2)); inbox[y0:y1, x0:x1] = True
        mask = np.zeros(green.shape, dtype=np.uint8); mask[green] = 1; mask[green & inbox] = 2
        for (ox, oy) in ((0, 0), (192, 192)):
            save(f"usu_{src}_{m.group(3)}_{m.group(4)}_{ox}", rgb[oy:oy + T, ox:ox + T], mask[oy:oy + T, ox:ox + T], "usu", "heldout" if hold else "train", {"source": src, "boxes": len(boxes)})
            n_usu += 1
print("usu tiles", n_usu)

# ---- WeedsGalore
n_wg = 0
for split in ("train", "val", "test"):
    d = f"{args.wg}/{split}"
    if not os.path.isdir(d): continue
    for n in sorted(os.listdir(d)):
        if not n.endswith(".png") or n.endswith(".labels.png"): continue
        stem = n[:-4]
        cands = [f"{d}/{stem}.labels.png"]
        sem = next((c for c in cands if os.path.exists(c)), None)
        if sem is None: continue
        rgb = Image.open(f"{d}/{n}").convert("RGB"); lab = Image.open(sem)
        w, h = rgb.size
        rgb2 = np.array(rgb.resize((w // 2, h // 2), Image.BILINEAR)); lab2 = np.array(lab.resize((w // 2, h // 2), Image.NEAREST))
        mask = np.full(lab2.shape, 255, dtype=np.uint8); mask[lab2 == 0] = 0; mask[lab2 == 1] = 1; mask[lab2 >= 2] = 2
        tile = np.zeros((T, T, 3), dtype=np.uint8); full = np.full((T, T), 255, dtype=np.uint8)
        hh, ww = min(T, rgb2.shape[0]), min(T, rgb2.shape[1]); tile[:hh, :ww] = rgb2[:hh, :ww]; full[:hh, :ww] = mask[:hh, :ww]
        save(f"wg_{stem}", tile, full, "wg", "heldout" if split == "test" else "train")
        n_wg += 1
print("weedsgalore tiles", n_wg)
json.dump({"tile": T, "gsdCm": 0.5, "classes": {0: "background", 1: "crop", 2: "weed", 255: "ignore"}, "tiles": man}, open(f"{args.out}/manifest.json", "w"), indent=1)
print("wrote", len(man), "tiles to", args.out)
