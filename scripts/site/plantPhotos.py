"""Cut the website's specimen (weed 1678 of the apricot twin) out of the original photographs.

    python -I scripts/site/plantPhotos.py

Reads data/direct-georef/apricot/m1/weeds.json (each sighting's centre and outline in the photograph's own
pixels) and directtestimagery/DJI_*.JPG. Writes public/site/plant/photo-1..4.jpg (file names carry no camera maker), square crops at the
photograph's native resolution, and prints the outline of each sighting in crop pixels for
src/components/landing/specimen.ts. Nothing is resampled or retouched: the crop is the photograph.
"""
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(HERE, "..", "..")
WEED = 1678
FRAMES = ["DJI_0303", "DJI_0307", "DJI_0317", "DJI_0308"]  # saved as photo-1..4.jpg, in this order
SIZE = 320

weeds = json.load(open(os.path.join(REPO, "data/direct-georef/apricot/m1/weeds.json")))
weed = next(w for w in weeds if w["id"] == WEED)
out_dir = os.path.join(REPO, "public/site/plant")
os.makedirs(out_dir, exist_ok=True)
result = []
for m in weed["members"]:
    if m["frame"] not in FRAMES:
        continue
    im = Image.open(os.path.join(REPO, "directtestimagery", m["frame"] + ".JPG"))
    x0, y0 = round(m["u"] - SIZE / 2), round(m["v"] - SIZE / 2)
    x0 = max(0, min(im.width - SIZE, x0))
    y0 = max(0, min(im.height - SIZE, y0))
    im.crop((x0, y0, x0 + SIZE, y0 + SIZE)).save(os.path.join(out_dir, f"photo-{FRAMES.index(m['frame']) + 1}.jpg"), quality=86)
    poly = [[round(p[0] - x0, 1), round(p[1] - y0, 1)] for p in m["poly"]]
    result.append({"frame": m["frame"], "sizeM": round(m["sizeM"], 3), "poly": poly})
result.sort(key=lambda r: FRAMES.index(r["frame"]))
print(json.dumps({"id": WEED, "diameterM": weed["diameterM"], "areaM2": weed["areaM2"], "seenBy": weed["seenBy"],
                  "coveredBy": weed["coveredBy"], "viewSpreadM": weed["viewSpreadM"], "photos": result}))
