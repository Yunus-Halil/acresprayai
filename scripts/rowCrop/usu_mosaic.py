# USU-Corn-WeedDB (CC BY 4.0, Bhandari and Etienne, Utah State University): the labelled 640 px tiles are cut from
# source images on a 512 px grid (x0..2048, y0..2048), so a source's 25 tiles stitch back into one 2688 x 2688
# image (overlaps are the same pixels). This writes one JPEG per labelled source with its YOLO boxes converted to
# absolute pixels, for the row-crop reader to be scored against.
#   python -I scripts/rowCrop/usu_mosaic.py <Labeled_Dataset dir> <out dir>
import os, re, sys, json, collections
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
tiles = collections.defaultdict(list)
for split in ("train", "val", "test"):
    for n in os.listdir(f"{src}/images/{split}"):
        m = re.match(r"(.*)_x(\d+)_y(\d+)\.jpg$", n)
        if m: tiles[m.group(1)].append((split, int(m.group(2)), int(m.group(3)), n))
names = {0: "CL", 1: "RPW", 2: "GFT"}
index = []
for key, lst in sorted(tiles.items()):
    W = max(x for _, x, _, _ in lst) + 640; H = max(y for _, _, y, _ in lst) + 640
    canvas = np.zeros((H, W, 3), dtype=np.uint8); have = np.zeros((H, W), dtype=bool)
    boxes = []; splits = set()
    for split, x, y, n in lst:
        im = np.array(Image.open(f"{src}/images/{split}/{n}").convert("RGB"))
        canvas[y:y + 640, x:x + 640] = im; have[y:y + 640, x:x + 640] = True; splits.add(split)
        lab = f"{src}/labels/{split}/{n[:-4]}.txt"
        if os.path.exists(lab):
            for line in open(lab):
                p = line.split()
                if len(p) < 5: continue
                c, cx, cy, w, h = int(p[0]), float(p[1]) * 640, float(p[2]) * 640, float(p[3]) * 640, float(p[4]) * 640
                boxes.append({"cls": names.get(c, str(c)), "x": round(x + cx, 1), "y": round(y + cy, 1), "w": round(w, 1), "h": round(h, 1), "tile": n})
    # Boxes in a tile overlap are labelled in each tile that holds them: merge duplicates (same class, centre within 8 px).
    merged = []
    for b in sorted(boxes, key=lambda b: (b["x"], b["y"])):
        if any(m["cls"] == b["cls"] and abs(m["x"] - b["x"]) < 8 and abs(m["y"] - b["y"]) < 8 for m in merged): continue
        merged.append(b)
    safe = re.sub(r"[^A-Za-z0-9]+", "_", key).strip("_")
    Image.fromarray(canvas).save(f"{out}/{safe}.jpg", quality=95)
    json.dump({"source": key, "width": W, "height": H, "tiles": len(lst), "coveredShare": round(float(have.mean()), 3), "splits": sorted(splits), "gsdCm": 0.48, "boxes": merged}, open(f"{out}/{safe}.json", "w"), indent=1)
    index.append({"image": f"{safe}.jpg", "boxes": len(merged), "tiles": len(lst), "splits": sorted(splits)})
    print(safe, W, H, "tiles", len(lst), "boxes", len(boxes), "->", len(merged), sorted(splits))
json.dump(index, open(f"{out}/index.json", "w"), indent=1)
print("sources", len(index), "boxes", sum(i["boxes"] for i in index))
