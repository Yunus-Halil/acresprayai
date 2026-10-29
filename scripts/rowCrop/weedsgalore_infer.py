# WeedsGalore DeepLabv3+ (GFZ, Apache-2.0 code; checkpoints from doidata.gfz.de, licence unstated) run over
# photographs, writing a class mask and a colour overlay per photograph. CPU only.
#   python -I scripts/rowCrop/weedsgalore_infer.py --src <weedsgalore src dir> --ckpt <dlv3p_rgb_6.pth>
#       --out <dir> --classes 6 [--wg-scene <dataset dir> <scene id>] [--photos a.jpg b.jpg ...]
#       [--scale 2] [--input srgb|linear] [--crop W H] [--mean-match]
# The model was trained on 600 x 600 patches of 16-bit P4 Multispectral bands at 0.25 cm a pixel, fed as
# band / 65535 with no other normalisation (datasets/weedsgalore/weedsgalore.py). A consumer RGB JPEG is 8-bit
# sRGB at about 0.5 cm, so the script can upsample (--scale), linearise (--input linear) and match the per-band
# means of the training data (--mean-match) before the model sees it. Classes (6): 0 background, 1 maize,
# 2 amaranth, 3 barnyard grass, 4 quickweed, 5 other weed; (3): 0 background, 1 crop, 2 weed.
import argparse, os, sys, time, json
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("--src", required=True)
ap.add_argument("--ckpt", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--classes", type=int, default=6)
ap.add_argument("--wg-scene", nargs=2, metavar=("DATASET", "SCENE"))
ap.add_argument("--photos", nargs="*", default=[])
ap.add_argument("--scale", type=float, default=2.0)
ap.add_argument("--input", choices=["srgb", "linear"], default="srgb")
ap.add_argument("--crop", nargs=2, type=int, metavar=("W", "H"))
ap.add_argument("--mean-match", action="store_true")
ap.add_argument("--tile", type=int, default=1200)
args = ap.parse_args()

sys.path.insert(0, args.src)
import torch, torch.nn as nn
from nets import deeplabv3plus_resnet50

device = torch.device("cpu")
net = deeplabv3plus_resnet50(num_classes=args.classes)
net.backbone.conv1 = nn.Conv2d(3, net.backbone.conv1.out_channels, kernel_size=7, stride=2, padding=3, bias=False)
sd = torch.load(args.ckpt, map_location=device)
missing, unexpected = net.load_state_dict(sd, strict=False)
print("loaded", args.ckpt, "missing", len(missing), "unexpected", len(unexpected))
net.eval()
os.makedirs(args.out, exist_ok=True)

PALETTE = {0: (0, 0, 0, 0), 1: (0, 200, 255, 110), 2: (255, 40, 40, 170), 3: (255, 160, 0, 170), 4: (255, 0, 255, 170), 5: (255, 255, 0, 170)}
TRAIN_MEANS = (0.516, 0.555, 0.523)  # R, G, B of one 2023-06-15 patch, band / 65535

def predict(img):  # img float32 (3, H, W) in 0..1
    H, W = img.shape[1:]
    out = np.zeros((args.classes, H, W), dtype=np.float32)
    cnt = np.zeros((H, W), dtype=np.float32)
    T = args.tile; step = T - 200
    ys = list(range(0, max(1, H - T + 1), step)) + ([H - T] if H > T else [0]); xs = list(range(0, max(1, W - T + 1), step)) + ([W - T] if W > T else [0])
    with torch.no_grad():
        for y in sorted(set(ys)):
            for x in sorted(set(xs)):
                y0, x0 = max(0, y), max(0, x); patch = img[:, y0:y0 + T, x0:x0 + T]
                t = torch.from_numpy(patch[None])
                o = torch.nn.functional.softmax(net(t), dim=1)[0].numpy()
                out[:, y0:y0 + o.shape[1], x0:x0 + o.shape[2]] += o; cnt[y0:y0 + o.shape[1], x0:x0 + o.shape[2]] += 1
    out /= np.maximum(cnt, 1)
    return out.argmax(0).astype(np.uint8), out

def overlay(rgb8, pred, path):
    base = Image.fromarray(rgb8).convert("RGBA")
    ov = np.zeros((pred.shape[0], pred.shape[1], 4), dtype=np.uint8)
    for k, c in PALETTE.items(): ov[pred == k] = c
    base.alpha_composite(Image.fromarray(ov)); base.convert("RGB").save(path, quality=88)

results = []
if args.wg_scene:
    ds, scene = args.wg_scene
    day = scene[:10]
    bands = [np.array(Image.open(f"{ds}/{day}/images/{scene}_{b}.png")).astype(np.float32) / 65535.0 for b in ("R", "G", "B")]
    img = np.stack(bands)
    print("wg bands mean", [round(float(b.mean()), 3) for b in bands])
    t0 = time.time(); pred, _ = predict(img); dt = time.time() - t0
    lab = np.array(Image.open(f"{ds}/{day}/semantics/{scene}.png"))
    if args.classes == 3: lab = np.where(lab > 1, 2, lab)
    ious = {}
    for k in range(args.classes):
        inter = int(((pred == k) & (lab == k)).sum()); uni = int(((pred == k) | (lab == k)).sum()); ious[k] = round(inter / uni, 3) if uni else None
    disp = (np.clip(np.stack(bands, -1) / 0.77, 0, 1) ** 0.4545 * 255).astype(np.uint8)
    overlay(disp, pred, f"{args.out}/wg-{scene}-pred.jpg"); overlay(disp, lab.astype(np.uint8), f"{args.out}/wg-{scene}-truth.jpg")
    results.append({"scene": scene, "seconds": round(dt, 1), "iou": ious, "pixelAcc": round(float((pred == lab).mean()), 3)})
    print("wg scene", scene, "IoU per class", ious, "acc", results[-1]["pixelAcc"], f"{dt:.1f}s")

for p in args.photos:
    im = Image.open(p).convert("RGB")
    if args.crop:
        W, H = im.size; cw, ch = args.crop; im = im.crop((W // 2 - cw // 2, H // 2 - ch // 2, W // 2 + cw // 2, H // 2 + ch // 2))
    if args.scale != 1: im = im.resize((int(im.width * args.scale), int(im.height * args.scale)), Image.BICUBIC)
    rgb8 = np.array(im)
    x = rgb8.astype(np.float32) / 255.0
    if args.input == "linear": x = x ** 2.2
    if args.mean_match:
        for c in range(3): x[..., c] *= TRAIN_MEANS[c] / max(1e-6, float(x[..., c].mean()))
        x = np.clip(x, 0, 1)
    img = np.transpose(x, (2, 0, 1)).astype(np.float32)
    t0 = time.time(); pred, prob = predict(img); dt = time.time() - t0
    name = os.path.splitext(os.path.basename(p))[0]
    tag = f"{args.input}{'-mm' if args.mean_match else ''}-x{args.scale:g}"
    overlay(rgb8, pred, f"{args.out}/{name}-{tag}.jpg")
    Image.fromarray(pred).save(f"{args.out}/{name}-{tag}-mask.png")
    shares = {int(k): round(float((pred == k).mean()), 4) for k in range(args.classes)}
    results.append({"photo": p, "tag": tag, "size": [int(im.width), int(im.height)], "seconds": round(dt, 1), "classShares": shares})
    print(name, tag, "class shares", shares, f"{dt:.1f}s")

with open(f"{args.out}/results-{int(time.time())}.json", "w") as f: json.dump(results, f, indent=1)
