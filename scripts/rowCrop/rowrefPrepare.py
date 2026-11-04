# Plant-labelled reference sets for the plant-row experiments, in one layout:
#   <out>/<set>/images/<stem>.(jpg|png) and <out>/<set>/labels/<stem>.json {"boxes": [[x1, y1, x2, y2], ...], "group": ...}
# Sets: msdd (2022 test, nadir videos only, group = the paper's Table III stage; CC BY-NC-SA, evaluation only),
# matchplant (27 maize frames, COCO boxes), uav-maize / uav-sugarbeet / uav-sunflower (UAVmulticrop plots, COCO
# polygons -> boxes). Every plant in a frame is labelled in all of them. Evaluation only: nothing here is trained on.
#   python -I scripts/rowCrop/rowrefPrepare.py --raw D:/swardus-research/datasets/rowref/raw --msdd D:/swardus-research/datasets/msdd/test --out D:/swardus-research/datasets/rowref
import argparse, json, os, re, shutil, statistics
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
ap = argparse.ArgumentParser(); ap.add_argument("--raw", required=True); ap.add_argument("--msdd", required=True); ap.add_argument("--out", required=True); a = ap.parse_args()
GROUP = {"827": "V2-V4", "876": "V2-V4", "941": "V2-V4", "942": "V2-V4", "943": "V2-V4", "953": "V2-V4", "954": "V2-V4", "955": "V2-V4",
         "870": "V4-V6", "873": "V4-V6", "993": "V4-V6", "994": "V4-V6", "997": "V4-V6", "998": "V4-V6", "023": "V4-V6", "024": "V4-V6",
         "939": "V6-V12", "984": "V6-V10", "054": "V6-V10", "055": "V6-V10", "056": "V6-V10", "061": "V6-V10", "062": "V6-V10", "092": "V6-V10",
         "001": None, "002": None, "021": None, "068": None}
def put(set_, stem, src_img, boxes, group, convert=False):
    d = os.path.join(a.out, set_); os.makedirs(os.path.join(d, "images"), exist_ok=True); os.makedirs(os.path.join(d, "labels"), exist_ok=True)
    if convert: Image.open(src_img).convert("RGB").save(os.path.join(d, "images", stem + ".jpg"), quality=95)
    else: shutil.copyfile(src_img, os.path.join(d, "images", stem + os.path.splitext(src_img)[1].lower()))
    json.dump({"boxes": [[round(v, 1) for v in b] for b in boxes], "group": group}, open(os.path.join(d, "labels", stem + ".json"), "w"))
    return [max(b[2] - b[0], b[3] - b[1]) for b in boxes]
stats = {}
# MSDD
for f in sorted(os.listdir(os.path.join(a.msdd, "images"))):
    m = re.match(r"^\d\d_\d\d_\d\d_(\d+)_", f); g = GROUP.get(m.group(1).zfill(3), "other") if m else "other"
    if g is None: continue
    W, H = Image.open(os.path.join(a.msdd, "images", f)).size; stem = os.path.splitext(f)[0]; lp = os.path.join(a.msdd, "labels", stem + ".txt")
    bx = []
    if os.path.exists(lp):
        for l in open(lp).read().split("\n"):
            if l.strip(): c, cx, cy, w, h = map(float, l.split()); bx.append([(cx - w / 2) * W, (cy - h / 2) * H, (cx + w / 2) * W, (cy + h / 2) * H])
    stats.setdefault("msdd", []).extend(put("msdd", stem, os.path.join(a.msdd, "images", f), bx, g))
# MatchPlant
for f in sorted(os.listdir(os.path.join(a.raw, "Annotation file"))):
    d = json.load(open(os.path.join(a.raw, "Annotation file", f))); img = d["images"][0]
    bx = [[x, y, x + w, y + h] for x, y, w, h in (an["bbox"] for an in d["annotations"])]
    stem = img["file_name"].split(".")[0]
    stats.setdefault("matchplant", []).extend(put("matchplant", stem, os.path.join(a.raw, "image", img["file_name"]), bx, "maize", convert=True))
# UAVmulticrop
for crop in ("maize", "sugarbeet", "sunflower"):
    root = os.path.join(a.raw, "UAVmulticrop", crop)
    for j in sorted(x for x in os.listdir(root) if x.endswith(".json")):
        d = json.load(open(os.path.join(root, j))); field = j[:-5]
        by = {}
        for an in d["annotations"]:
            xs, ys = [], []
            for seg in an.get("segmentation") or []: xs += seg[0::2]; ys += seg[1::2]
            if not xs and an.get("bbox"): x, y, w, h = an["bbox"]; xs, ys = [x, x + w], [y, y + h]
            if xs: by.setdefault(an["image_id"], []).append([min(xs), min(ys), max(xs), max(ys)])
        for im in d["images"]:
            src = os.path.join(root, field, im["file_name"])
            if not os.path.exists(src): continue
            stem = f"{field}__{os.path.splitext(im['file_name'])[0]}"
            stats.setdefault("uav-" + crop, []).extend(put("uav-" + crop, stem, src, by.get(im["id"], []), field))
for k, v in stats.items():
    n = len(os.listdir(os.path.join(a.out, k, "images")))
    print(f"{k}: {n} images, {len(v)} plants, median plant box {statistics.median(v):.0f} px" if v else f"{k}: {n} images, no plants")
