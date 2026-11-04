# The MaSC maize seedling detector (Kharismawati & Kazic 2026, zenodo.org/records/22219350, weights CC BY 4.0: a
# YOLOv9-c trained on MSDD, nadir drone video at 1-18 m, V2-V10, classes single / double / triple plant) run over our
# photographs, so its boxes can be compared with the corn readers' rows and plant points. Research only: the detector
# code is github.com/WongKinYiu/yolov9 (GPL-3.0), imported from a local clone, never vendored into Swardus.
# The checkpoint is a pickle; it is loaded with weights_only=True and an allow-list of the yolov9 classes it names
# (checked with pickletools: torch, collections, set and models.common / models.yolo only), so nothing else can run.
# MSDD frames are 1920 px squares shrunk to 640, so the model sees about 3x its source pixel: --factors sweeps how
# many photo pixels go into one model pixel.
#   D:/swardus-research/yolov9-venv/Scripts/python.exe scripts/rowCrop/masc_detect.py --photos <dir|file> ... --out <dir> [--factors 2,3,4,6] [--conf 0.3]
# Output per photo and factor: <out>/<stem>.f<factor>.json {width,height,factor,boxes:[[x1,y1,x2,y2,conf,cls],...]}
# (photo pixels) and, with --draw, <out>/<stem>.f<factor>.jpg.
import argparse, json, os, sys, time
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("--photos", nargs="+", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--factors", default="3")
ap.add_argument("--conf", type=float, default=0.3)
ap.add_argument("--iou", type=float, default=0.5)
ap.add_argument("--overlap", type=float, default=0.2, help="tile overlap share")
ap.add_argument("--draw", action="store_true")
ap.add_argument("--yolov9", default="D:/swardus-research/models/yolov9")
ap.add_argument("--weights", default="D:/swardus-research/datasets/masc/models/yolov9_models/best.pt")
args = ap.parse_args()

sys.path.insert(0, args.yolov9)
import torch, torchvision
from PIL import Image, ImageDraw
import models.common as C, models.yolo as Y
torch.set_num_threads(max(1, (os.cpu_count() or 4) - 2))

def pickle_globals(path):
    """Every global the checkpoint's pickle names, read with pickletools (nothing is executed)."""
    import zipfile, pickletools, io
    z = zipfile.ZipFile(path); data = z.read(next(n for n in z.namelist() if n.endswith("data.pkl")))
    names, strs = set(), []
    for op, arg, _ in pickletools.genops(io.BytesIO(data)):
        if op.name in ("SHORT_BINUNICODE", "BINUNICODE", "UNICODE"): strs.append(arg)
        elif op.name == "GLOBAL": names.add(tuple(arg.split(" ")))
        elif op.name == "STACK_GLOBAL": names.add((strs[-2], strs[-1]))
    return names

ALLOWED = []
for mod, name in sorted(pickle_globals(args.weights)):
    if mod in ("models.common", "models.yolo") or mod.startswith("torch.nn.modules."):
        ALLOWED.append(getattr(sys.modules[mod] if mod in sys.modules else __import__(mod, fromlist=[name]), name))
    elif (mod, name) in (("__builtin__", "set"), ("builtins", "set")): ALLOWED.append(set)
    elif mod.startswith("torch") or mod == "collections": pass   # tensor rebuilds, dtypes, OrderedDict: torch allows these itself
    else: sys.exit(f"refusing checkpoint: it names {mod}.{name}")
with torch.serialization.safe_globals(ALLOWED):
    ck = torch.load(args.weights, map_location="cpu", weights_only=True)
model = (ck.get("ema") or ck["model"]).float().eval()
if hasattr(model, "fuse"): model = model.fuse()
NAMES = {0: "single", 1: "double", 2: "triple"}
S = 640

def photos():
    for p in args.photos:
        if os.path.isdir(p):
            for f in sorted(os.listdir(p)):
                if f.lower().endswith((".jpg", ".jpeg", ".png")): yield os.path.join(p, f)
        else: yield p

@torch.no_grad()
def detect(rgb, factor):
    H, W = rgb.shape[:2]
    T = int(round(S * factor)); step = max(1, int(T * (1 - args.overlap)))
    xs = list(range(0, max(1, W - T) + 1, step)); ys = list(range(0, max(1, H - T) + 1, step))
    if xs[-1] + T < W: xs.append(max(0, W - T))
    if ys[-1] + T < H: ys.append(max(0, H - T))
    out = []
    img = Image.fromarray(rgb)
    for y0 in ys:
        for x0 in xs:
            tile = img.crop((x0, y0, x0 + T, y0 + T)).resize((S, S), Image.BILINEAR)
            x = torch.from_numpy(np.asarray(tile, dtype=np.float32).transpose(2, 0, 1) / 255.0)[None]
            p = model(x)
            p = p[0][1] if isinstance(p[0], (list, tuple)) else p[0]   # DualDDetect: main branch, as detect_dual.py
            p = p[0].T                                                  # (anchors, 4 + nc): cx cy w h, class scores
            conf, cls = p[:, 4:].max(1)
            k = conf >= args.conf
            if not k.any(): continue
            b = p[k, :4]; s = T / S
            xyxy = torch.stack([b[:, 0] - b[:, 2] / 2, b[:, 1] - b[:, 3] / 2, b[:, 0] + b[:, 2] / 2, b[:, 1] + b[:, 3] / 2], 1) * s
            xyxy[:, [0, 2]] += x0; xyxy[:, [1, 3]] += y0
            out.append(torch.cat([xyxy, conf[k, None], cls[k, None].float()], 1))
    if not out: return np.zeros((0, 6), np.float32)
    d = torch.cat(out)
    keep = torchvision.ops.nms(d[:, :4], d[:, 4], args.iou)
    return d[keep].numpy()

os.makedirs(args.out, exist_ok=True)
factors = [float(f) for f in args.factors.split(",")]
for path in photos():
    stem = os.path.splitext(os.path.basename(path))[0]
    rgb = np.asarray(Image.open(path).convert("RGB"))
    for f in factors:
        t = time.time(); d = detect(rgb, f)
        rec = {"photo": path.replace("\\", "/"), "width": rgb.shape[1], "height": rgb.shape[0], "factor": f, "conf": args.conf,
               "boxes": [[round(float(v), 1) for v in r[:4]] + [round(float(r[4]), 3), int(r[5])] for r in d], "ms": int((time.time() - t) * 1000)}
        json.dump(rec, open(os.path.join(args.out, f"{stem}.f{f:g}.json"), "w"))
        if args.draw:
            im = Image.fromarray(rgb).copy(); dr = ImageDraw.Draw(im); lw = max(2, rgb.shape[1] // 1200)
            for x1, y1, x2, y2, c, k in d: dr.rectangle([x1, y1, x2, y2], outline=(0, 200, 255) if k == 0 else (255, 200, 0), width=lw)
            im.save(os.path.join(args.out, f"{stem}.f{f:g}.jpg"), quality=82)
        print(f"{stem} factor {f:g}: {len(d)} boxes, {rec['ms']} ms", flush=True)
