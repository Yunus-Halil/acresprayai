"""Joins a stage's samples, the verdicts recorded from the contact sheets, the per-photo benchmark and the geometry
into the audit CSV, a gallery and the summary numbers the report is written from. Read-only on everything but the
validation folder.

    python -I scripts/rowCrop/validate_report.py <validation stage folder>
"""
import json, os, sys, csv, statistics as st
from PIL import Image, ImageDraw

d = sys.argv[1]
samples = {s["id"]: s for s in json.load(open(os.path.join(d, "samples.json")))["samples"]}
index = json.load(open(os.path.join(d, "sheets", "index.json")))
verd = json.load(open(os.path.join(d, "verdicts.json")))

# What each class claims, and how a verdict maps to correct / incorrect / indeterminate.
CLAIM = {
    "confirmed": ("a corn plant here", {"P": "correct", "N": "incorrect", "G": "incorrect", "?": "indeterminate"}),
    "strictFound": ("a corn plant here", {"P": "correct", "N": "incorrect", "G": "incorrect", "?": "indeterminate"}),
    "possible": ("weak evidence of a plant here", {"P": "correct", "N": "incorrect", "G": "incorrect", "?": "indeterminate"}),
    "missing": ("no plant here, the photo good enough to say so", {"N": "correct", "P": "incorrect", "G": "correct", "?": "indeterminate"}),
    "uncertain": ("cannot tell", {"P": "indeterminate", "N": "indeterminate", "G": "indeterminate", "?": "indeterminate"}),
    "weed": ("green off the rows: a weed candidate", {"W": "correct", "C": "incorrect", "S": "incorrect", "V": "incorrect", "?": "indeterminate"}),
    "rowRandom": ("the row line passes over the planter line (blind point)", {}),
    "rowEnd": ("the row really ends here", {"C": "correct", "E": "incorrect", "X": "incorrect", "?": "indeterminate"}),
    "gap": ("a stretch of the row with no corn", {"T": "correct", "F": "incorrect", "V": "incorrect", "?": "indeterminate"}),
    "fieldEnd": ("the field ends here", {"C": "correct", "E": "incorrect", "?": "indeterminate"}),
    "seedling": ("a small separate plant (late-flush seedling)", {"P": "correct", "C": "incorrect", "N": "incorrect", "V": "incorrect", "?": "indeterminate"}),
    "smallGreen": ("small off-row green, not called a weed", {"W": "incorrect", "C": "correct", "S": "correct", "V": "correct", "?": "indeterminate"}),
    "escape": ("a large between-row plant", {"W": "correct", "C": "incorrect", "S": "incorrect", "V": "incorrect", "?": "indeterminate"}),
}
STAGE = json.load(open(os.path.join(d, "samples.json")))["stage"]
REASON = {"P": "a plant visible at the point", "N": "bare soil at the point", "G": "green, but grass or a weed, not a corn seedling", "?": "too small, blurred or dim to tell",
          "W": "a green plant off the corn lines", "C": "corn (a seedling or leaf of a row)", "S": "soil, residue or a stone", "V": "verge or headland grass/stubble", "T": "no corn over the stretch", "F": "corn present over the stretch",
          "E": "seedlings continue past the end on the row's line", "X": "the row runs onto ground that is not the field"}

rows = []
for i in index:
    s = samples[i["id"]]
    codes = verd.get(i["sheet"], "").split()
    code = codes[i["cell"] - 1] if i["cell"] - 1 < len(codes) else ""
    if not code:
        continue
    cls = s["cls"]
    rd = s.get("reader", {})
    if cls == "rowRandom" and STAGE != "emergence":
        reader_state = "row line"; claim = "the row line lies on a corn row"
        j = {"P": "correct", "N": "incorrect"}.get(code, "indeterminate")
    elif cls == "rowRandom":
        # The reader's state at a blind point: holds a plant (or possible) within 3 cm, or calls it missing/uncertain/gap.
        # Plants stand about 15 cm apart and a plant point is the centre of a seedling's leaves, so any point on a held
        # stretch of row is within about 8 cm of one. The reader holds the ground at a point when a plant or possible
        # seedling is within 9 cm; otherwise the point is in a stretch the reader treats as empty.
        holds = (rd.get("plantCm") is not None and rd["plantCm"] <= 9) or (rd.get("possibleCm") is not None and rd["possibleCm"] <= 9)
        reader_state = "plant" if holds else "empty"
        if code == "?": j = "indeterminate"
        elif code == "P": j = "correct" if holds else "incorrect"  # a plant in a stretch the reader treats as empty: missed
        else: j = "not scored"                                        # soil between the plants of a row is normal
        claim = f"reader: {reader_state}"
    else:
        claim = CLAIM[cls][0]
        j = CLAIM[cls][1].get(code, "indeterminate")
        reader_state = cls
    rows.append({"id": s["id"], "photo": s["photo"], "class": cls, "x": s["x"], "y": s["y"], "reader_claim": claim, "visual_code": code,
                 "judgement": j, "reason": REASON.get(code, ""), "reader_detail": json.dumps(rd) if rd else "", "crop": f"crops/{cls}/{s['id']}.png", "sheet": f"sheets/{i['sheet']}.jpg#{i['cell']}"})

with open(os.path.join(d, "visual-audit.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

summary = {}
for r in rows:
    c = summary.setdefault(r["class"], {"n": 0, "correct": 0, "incorrect": 0, "indeterminate": 0, "not scored": 0, "codes": {}})
    c["n"] += 1; c[r["judgement"]] += 1; c["codes"][r["visual_code"]] = c["codes"].get(r["visual_code"], 0) + 1
for c in summary.values():
    dec = c["correct"] + c["incorrect"]
    c["correctOfDecided"] = round(c["correct"] / dec, 3) if dec else None
rr = [r for r in rows if r["class"] == "rowRandom"]
blind = {"plantsSeen": sum(r["visual_code"] == "P" for r in rr), "plantsHeldByReader": sum(r["visual_code"] == "P" and r["reader_claim"] == "reader: plant" for r in rr),
         "soilSeen": sum(r["visual_code"] == "N" for r in rr), "soilInHeldStretch": sum(r["visual_code"] == "N" and r["reader_claim"] == "reader: plant" for r in rr),
         "soilInEmptyStretch": sum(r["visual_code"] == "N" and r["reader_claim"] == "reader: empty" for r in rr), "indeterminate": sum(r["visual_code"] == "?" for r in rr)}
geo = json.load(open(os.path.join(d, "geometry.json")))
json.dump({"byClass": summary, "blindRowPoints": blind, "audited": len(rows), "geometry": geo}, open(os.path.join(d, "audit-summary.json"), "w"), indent=1)

# Gallery: up to six incorrect and three correct per class, labelled.
pick = []
for cls in summary:
    pick += [r for r in rows if r["class"] == cls and r["judgement"] == "incorrect"][:6]
    pick += [r for r in rows if r["class"] == cls and r["judgement"] == "correct"][:3]
cell = 240
cols = 6
g = Image.new("RGB", (cols * cell, ((len(pick) + cols - 1) // cols) * (cell + 34)), (15, 15, 15))
dr = ImageDraw.Draw(g)
for k, r in enumerate(pick):
    im = Image.open(os.path.join(d, r["crop"])).resize((cell, cell))
    ox, oy = (k % cols) * cell, (k // cols) * (cell + 34)
    g.paste(im, (ox, oy))
    col = (255, 90, 90) if r["judgement"] == "incorrect" else (120, 255, 120)
    dr.text((ox + 4, oy + cell + 3), f"{r['class']} {r['judgement']} ({r['visual_code']})", fill=col)
    dr.text((ox + 4, oy + cell + 17), f"photo {r['photo']} @ {int(r['x'])},{int(r['y'])}", fill=(200, 200, 200))
g.save(os.path.join(d, "gallery.jpg"), quality=88)
print(json.dumps({"audited": len(rows), "blind": blind, "byClass": {k: {kk: v[kk] for kk in ("n", "correct", "incorrect", "indeterminate", "correctOfDecided", "codes")} for k, v in summary.items()}}, indent=1))
