"""Encode the Field Twin captures (scripts/site/captureTwin.mjs) for the website.

    python -I scripts/site/encodeFrames.py <dir with desktop/, mobile/, plant/>

Writes public/site/twin/{desktop,mobile}/f-NN.webp + sel.webp and public/site/plant/plant-{wide,tall}.webp.
The frames are flat vector drawings on a dark ground, so WebP at quality 72 keeps the outlines clean at a
fraction of PNG's size; the page scrubs through them, so every frame is a full picture, not a delta.
"""
import os
import sys

from PIL import Image

src = sys.argv[1]
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "site")
total = 0
for sub, dest in (("desktop", "twin/desktop"), ("mobile", "twin/mobile"), ("plant", "plant")):
    out = os.path.join(root, dest)
    os.makedirs(out, exist_ok=True)
    for name in sorted(os.listdir(os.path.join(src, sub))):
        if not name.endswith(".png"):
            continue
        im = Image.open(os.path.join(src, sub, name)).convert("RGB")
        path = os.path.join(out, name[:-4] + ".webp")
        im.save(path, "WEBP", quality=72, method=6)
        total += os.path.getsize(path)
print(f"{total / 1e6:.2f} MB written under public/site")
