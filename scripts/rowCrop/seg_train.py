# A corn weed segmenter on frozen DINOv2 features (facebook/dinov2-small, Apache-2.0): background / crop / weed at
# 0.5 cm a pixel. The backbone is frozen and its patch features cached once, so training is a small convolutional head
# and runs on a CPU in minutes. Tiles are 448 px -> 32 x 32 patches of 14 px (7 cm on the ground), the head's output
# is upsampled to the pixels for the loss and the pictures.
#   python -I scripts/rowCrop/seg_train.py features --sets <dir> [<dir> ...] --cache <dir>
#   python -I scripts/rowCrop/seg_train.py train --sets ... --cache <dir> --out <model dir> [--epochs 20] [--weed-weight 3]
#   python -I scripts/rowCrop/seg_train.py eval --sets ... --cache <dir> --model <model dir>
#   python -I scripts/rowCrop/seg_train.py predict --model <model dir> --photos a.jpg ... --out <dir> [--scale 1]
# Each set dir holds manifest.json + tiles/ + masks/ (seg_prepare.py or weakLabels.ts).
import argparse, os, sys, json, time, hashlib
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("mode", choices=["features", "train", "eval", "predict"])
ap.add_argument("--sets", nargs="*", default=[])
ap.add_argument("--cache", default="D:/swardus-research/datasets/corn-seg/features")
ap.add_argument("--out", default="D:/swardus-research/checkpoints/corn-seg-dinov2")
ap.add_argument("--model", default="D:/swardus-research/checkpoints/corn-seg-dinov2")
ap.add_argument("--epochs", type=int, default=20)
ap.add_argument("--weed-weight", type=float, default=3.0)
ap.add_argument("--photos", nargs="*", default=[])
ap.add_argument("--scale", type=float, default=1.0)
ap.add_argument("--backbone", default="facebook/dinov2-small")
ap.add_argument("--domain-weights", default="usu:1,wg:1,mid:1")
args = ap.parse_args()

import torch, torch.nn as nn, torch.nn.functional as F
torch.set_num_threads(max(1, os.cpu_count() - 2))
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32); STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
T = 448; P = 14; G = T // P

def load_manifests():
    items = []
    for s in args.sets:
        m = json.load(open(f"{s}/manifest.json"))
        for t in m["tiles"]:
            dom = t.get("domain") or ("mid" if "photo" in t else "unknown")
            items.append({**t, "domain": dom, "split": t.get("split", "train"), "tilePath": f"{s}/{t['tile']}", "maskPath": f"{s}/{t['mask']}", "key": hashlib.md5(f"{s}/{t['tile']}".encode()).hexdigest()})
    return items

_backbone = None
def backbone():
    global _backbone
    if _backbone is None:
        from transformers import AutoModel
        _backbone = AutoModel.from_pretrained(args.backbone).eval()
    return _backbone

@torch.no_grad()
def feats_of(rgb8):  # (H, W, 3) uint8 with H, W multiples of 14 -> (C, H/14, W/14) float32
    x = (rgb8.astype(np.float32) / 255 - MEAN) / STD
    t = torch.from_numpy(np.transpose(x, (2, 0, 1))[None])
    out = backbone()(pixel_values=t).last_hidden_state[0, 1:, :]  # patch tokens (no CLS; register tokens absent in dinov2-small)
    h, w = rgb8.shape[0] // P, rgb8.shape[1] // P
    return out.reshape(h, w, -1).permute(2, 0, 1).contiguous().numpy()

class Head(nn.Module):
    def __init__(self, c_in, hidden=128, n_cls=3):
        super().__init__()
        self.net = nn.Sequential(nn.Conv2d(c_in, hidden, 3, padding=1), nn.BatchNorm2d(hidden), nn.ReLU(), nn.Conv2d(hidden, hidden, 3, padding=1), nn.BatchNorm2d(hidden), nn.ReLU(), nn.Conv2d(hidden, n_cls, 1))
    def forward(self, f): return self.net(f)

if args.mode == "features":
    os.makedirs(args.cache, exist_ok=True)
    items = load_manifests(); t0 = time.time(); done = 0
    for it in items:
        path = f"{args.cache}/{it['key']}.npy"
        if os.path.exists(path): continue
        rgb = np.array(Image.open(it["tilePath"]).convert("RGB"))
        np.save(path, feats_of(rgb).astype(np.float16)); done += 1
        if done % 100 == 0: print(f"{done} tiles, {time.time() - t0:.0f} s", flush=True)
    print(f"features for {len(items)} tiles ({done} new) in {time.time() - t0:.0f} s")

elif args.mode == "train":
    os.makedirs(args.out, exist_ok=True)
    items = [it for it in load_manifests() if it["split"] == "train"]
    missing = [it for it in items if not os.path.exists(f"{args.cache}/{it['key']}.npy")]
    if missing: print(f"{len(missing)} train tiles have no cached features yet and are left out")
    items = [it for it in items if os.path.exists(f"{args.cache}/{it['key']}.npy")]
    dw = {k: float(v) for k, v in (p.split(":") for p in args.domain_weights.split(","))}
    X, Y, Wd = [], [], []
    for it in items:
        X.append(np.load(f"{args.cache}/{it['key']}.npy").astype(np.float32))
        m = np.array(Image.open(it["maskPath"]).convert("L")); Y.append(m); Wd.append(dw.get(it["domain"], 1.0))
    X = torch.from_numpy(np.stack(X)); Y = torch.from_numpy(np.stack(Y)).long(); Wd = torch.tensor(Wd)
    print("train tiles", len(items), "by domain", {d: sum(1 for it in items if it["domain"] == d) for d in dw})
    head = Head(X.shape[1]); opt = torch.optim.AdamW(head.parameters(), lr=2e-3, weight_decay=1e-4)
    cw = torch.tensor([1.0, 1.0, args.weed_weight])
    n = len(items); bs = 16; t0 = time.time()
    for ep in range(args.epochs):
        head.train(); perm = torch.randperm(n); tot = 0.0
        for i in range(0, n, bs):
            idx = perm[i:i + bs]
            logits = F.interpolate(head(X[idx]), size=(T, T), mode="bilinear", align_corners=False)
            loss = F.cross_entropy(logits, Y[idx], weight=cw, ignore_index=255, reduction="none").mean(dim=(1, 2))
            loss = (loss * Wd[idx]).mean()
            opt.zero_grad(); loss.backward(); opt.step(); tot += loss.item() * len(idx)
        print(f"epoch {ep + 1}/{args.epochs} loss {tot / n:.4f} {time.time() - t0:.0f} s", flush=True)
    torch.save({"head": head.state_dict(), "c_in": X.shape[1], "backbone": args.backbone, "classes": ["background", "crop", "weed"]}, f"{args.out}/head.pt")
    json.dump({"trainTiles": len(items), "epochs": args.epochs, "weedWeight": args.weed_weight, "domainWeights": dw, "backbone": args.backbone, "sets": args.sets}, open(f"{args.out}/train.json", "w"), indent=1)
    print("saved", f"{args.out}/head.pt")

elif args.mode == "eval":
    ck = torch.load(f"{args.model}/head.pt"); head = Head(ck["c_in"]); head.load_state_dict(ck["head"]); head.eval()
    items = load_manifests()
    res = {}
    with torch.no_grad():
        for split in ("heldout", "train"):
            for dom in sorted({it["domain"] for it in items}):
                sel = [it for it in items if it["split"] == split and it["domain"] == dom and os.path.exists(f"{args.cache}/{it['key']}.npy")]
                if not sel: continue
                inter = np.zeros(3); union = np.zeros(3); boxes_total = boxes_hit = 0; weed_comp = weed_comp_in = 0
                for it in sel:
                    f = torch.from_numpy(np.load(f"{args.cache}/{it['key']}.npy").astype(np.float32))[None]
                    pred = F.interpolate(head(f), size=(T, T), mode="bilinear", align_corners=False)[0].argmax(0).numpy()
                    gt = np.array(Image.open(it["maskPath"]).convert("L")); valid = gt != 255
                    for k in range(3): inter[k] += ((pred == k) & (gt == k) & valid).sum(); union[k] += (((pred == k) | (gt == k)) & valid).sum()
                res[f"{split}/{dom}"] = {"tiles": len(sel), "iou": {c: round(float(inter[k] / union[k]), 3) if union[k] else None for k, c in enumerate(("background", "crop", "weed"))}}
                print(split, dom, res[f"{split}/{dom}"])
    json.dump(res, open(f"{args.model}/eval.json", "w"), indent=1)

elif args.mode == "predict":
    ck = torch.load(f"{args.model}/head.pt"); head = Head(ck["c_in"]); head.load_state_dict(ck["head"]); head.eval()
    os.makedirs(args.out, exist_ok=True)
    PAL = {1: (0, 200, 255, 100), 2: (255, 40, 40, 180)}
    for p in args.photos:
        im = Image.open(p).convert("RGB")
        if args.scale != 1: im = im.resize((int(im.width * args.scale), int(im.height * args.scale)), Image.BICUBIC)
        rgb = np.array(im); H, W = rgb.shape[:2]
        step = T - 56; prob = np.zeros((3, H, W), dtype=np.float32); cnt = np.zeros((H, W), dtype=np.float32); t0 = time.time()
        ys = sorted(set(list(range(0, max(1, H - T + 1), step)) + [max(0, H - T)])); xs = sorted(set(list(range(0, max(1, W - T + 1), step)) + [max(0, W - T)]))
        with torch.no_grad():
            for y in ys:
                for x in xs:
                    tile = rgb[y:y + T, x:x + T]
                    if tile.shape[0] < T or tile.shape[1] < T: pad = np.zeros((T, T, 3), dtype=np.uint8); pad[:tile.shape[0], :tile.shape[1]] = tile; tile = pad
                    f = torch.from_numpy(feats_of(tile))[None]
                    pr = F.softmax(F.interpolate(head(f), size=(T, T), mode="bilinear", align_corners=False), dim=1)[0].numpy()
                    h, w = min(T, H - y), min(T, W - x); prob[:, y:y + h, x:x + w] += pr[:, :h, :w]; cnt[y:y + h, x:x + w] += 1
        pred = (prob / np.maximum(cnt, 1)).argmax(0).astype(np.uint8)
        name = os.path.splitext(os.path.basename(p))[0]
        base = Image.fromarray(rgb).convert("RGBA"); ov = np.zeros((H, W, 4), dtype=np.uint8)
        for k, c in PAL.items(): ov[pred == k] = c
        base.alpha_composite(Image.fromarray(ov)); base.convert("RGB").save(f"{args.out}/{name}-seg.jpg", quality=88)
        Image.fromarray(pred).save(f"{args.out}/{name}-mask.png")
        shares = {c: round(float((pred == k).mean()), 4) for k, c in enumerate(("background", "crop", "weed"))}
        print(name, shares, f"{time.time() - t0:.1f}s", flush=True)
