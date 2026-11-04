"""Results hub: every corn result picture under directtestimagery, newest run first, in one local page.

    npm run hub:results            (python -I scripts/rowCrop/resultsHub/build.py)
    options: --root directtestimagery  --cache D:/swardus-results-hub  --workers 10

Writes <root>/hub/index.html and <root>/hub/data.js. Previews (at most 2640 px wide, JPEG) and thumbnails go to
--cache, because the C drive is nearly full; the page loads them by file:/// address. Re-run any time: only new or
changed pictures are converted, and new result folders appear on their own. A run's reader, date, code and photo set
come from the note the bench wrote beside it (<folder>.md, summary.md, results.md); the time shown is when its
pictures were written."""
import argparse, json, os, re, shutil, sys, time
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
HERE = Path(__file__).resolve().parent
IMG = re.compile(r"\.(png|jpe?g)$", re.I)
SKIP = {"seg-weak", "crops", "viewer", "hub", "masks", "tiles"}
PREVIEW_MAX, THUMB_W = 2640, 360

SET_LABELS = {
    "veryearlystage": "Emergence photos",
    "estabilishmentphase": "Establishment photos",
    "midphase": "Mid photos",
    "verylatestagecorn": "Late photos",
    "2024corn2/emergence": "Corn2 (UAV3DCrop 2024 Day001)",
}
STAGE_SET = {"emergence": "veryearlystage", "establishment": "estabilishmentphase", "mid": "midphase", "late": "verylatestagecorn"}
BENCH_SET = {**STAGE_SET, "corn2": "2024corn2/emergence"}  # a bench's set name when its summary does not list it

# Plain-language notes for runs whose folder name only meant something during the work:
# (pattern on the run's relative path, reader override or None, note). First match wins.
NOTES = [
    (r"^benchmark-msdd-4f24440/", None, "MSDD's hand-checked corn boxes (cyan), Missouri 2022, never seen: before the small-frame fix, 73 % of tiles read no rows"),
    (r"^benchmark-msdd-cd54c7e/", None, "MSDD's hand-checked corn boxes (cyan), Missouri 2022, never seen: after the small-frame fix (code e68fb95); magenta = a weed candidate on real corn"),
    (r"^benchmark-msdd-", None, "MSDD's hand-checked corn boxes (cyan); magenta = a weed candidate on real corn"),
    (r"^benchmark-adaptive-holdout-8fcec20/", None, "48 photos no part of the work had seen, run once on the committed code (8fcec20)"),
    (r"^benchmark-adaptive-v4b/", None, "last development run before the commit: both plantings read, Corn2 weeds 723 to 88"),
    (r"^benchmark-adaptive-v[234]/", None, "development run of the adaptive reader (whole-frame plans)"),
    (r"/b1102-verylate-(establishment|mid)$", None, "late photos read by an earlier stage's reader, before a late reader existed"),
    (r"/b1102-", None, "before the 2 November validation fixes"),
    (r"/fixes-2026-11-02$", None, "after the 2 November validation fixes"),
    (r"/baseline-f7f77b8$", None, "the frozen reader the adaptive reader is measured against"),
    (r"/unseen-field-f7f77b8$", None, "Corn2 read by the emergence reader, chosen by the folder name: the failure that started the adaptive work"),
    (r"/unseen-field-establishment-f7f77b8$", None, "Corn2 read by the establishment reader: one row spacing for two plantings, so corn in the dropped rows became weeds"),
    (r"/adaptive-(sample|probe)$", None, "first adaptive design: regions cut out and read separately; abandoned, it broke the lens and field-edge logic"),
    (r"/assess/assess-v1$", None, "each cell's state: seedlings, rows, canopy, closed, cover, bare or unknown"),
    (r"/assess/probe$", None, "first look at the field assessment on a few photos"),
    (r"/field-edge$", None, "the field-edge rule added (white line where the field ends)"),
    (r"/late-v1$", None, "the first late-stage reader"),
    (r"/row-crop/verylate$", None, "the row reader before stage variants existed"),
    (r"/row-crop/current-establishment$", None, "seedling photos read by the establishment reader"),
    (r"/emergence-v2/V1$", "emergence", "emergence V1, before the second look"),
    (r"/emergence-v2/V2A$", "emergence", "emergence V2: rows, with the later planting set apart"),
    (r"/emergence-v2/V2B$", "emergence", "emergence V2: every gap classed as possible seedling, missing or uncertain"),
    (r"/emergence-v2/sheets$", "sheets", "emergence V2 sample sheets"),
    (r"/emergence-audit$", "probe", "emergence audit crops"),
    (r"/seedling-mask$", "probe", "seedling mask probe crops"),
    (r"^veryearlystage/outputs/probe$", "probe", "early emergence probe crops"),
    (r"/weedsgalore-model", "model", "WeedsGalore public weed model on mid photos: did not transfer"),
    (r"/corn-seg-", "model", "corn segmentation trial"),
    (r"^validation-2026-11-02-after/", "sheets", "validation after the fixes: a fresh sample, judged by eye"),
    (r"^validation-2026-11-02/", "sheets", "first validation: a sample judged by eye"),
]
READER_NAME = {"auto": "Adaptive reader (auto)", "emergence": "Emergence reader", "establishment": "Establishment reader",
               "mid": "Mid reader", "late": "Late reader", "assess": "Field assessment", "model": "Model trial",
               "probe": "Probe", "sheets": "Sample sheets"}


def natkey(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def read(p):
    try:
        return Path(p).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def input_sets(root):
    sets = dict(SET_LABELS)
    h = root / "holdout"
    if h.is_dir():
        for d in sorted(h.iterdir()):
            if d.is_dir():
                sets[f"holdout/{d.name}"] = "Holdout: " + d.name.replace("_", " ")
    return {k: v for k, v in sets.items() if (root / k).is_dir()}


def meta_for(root, rel, sets):
    """Reader, code, set and source note of a result folder, from the notes the benches wrote."""
    parts = rel.split("/")
    reader = code = setdir = title = None
    md = root / (rel + ".md")
    text = read(md) if md.is_file() else ""
    if text:
        first = text.splitlines()[0]
        title = first.lstrip("# ").strip()
        m = re.search(r"\((\w+) stage\)", first)
        if m:
            reader = m.group(1)
        elif first.startswith("# Adaptive"):
            reader = "auto"
        elif first.startswith("# Field assessment"):
            reader = "assess"
        elif first.startswith("# Continuous-row reader"):
            reader = "establishment"
        m = re.search(r"code (\w+)", text)
        code = m and m.group(1)
        m = re.search(r"photos from directtestimagery/(\S+?)\.(\s|$)", text)
        setdir = m and m.group(1)
    elif parts[0].startswith("benchmark-") and (root / parts[0] / "summary.md").is_file():
        md = root / parts[0] / "summary.md"
        s = read(md)
        m = re.search(r"Code (\S+?),", s)
        code = m and m.group(1)
        if len(parts) > 1:
            m = re.search(r"^## " + re.escape(parts[1]) + r": \d+ photographs from directtestimagery/(\S+)", s, re.M)
            setdir = (m and m.group(1)) or BENCH_SET.get(parts[1])
        reader = "auto" if "adaptive" in parts[0] or "msdd" in parts[0] else None
        if "msdd" in parts[0] and len(parts) > 1:
            setdir = f"MSDD 2022 test, {parts[1]}"
    elif len(parts) > 1 and (root / "/".join(parts[:-1]) / "results.md").is_file():
        md = root / "/".join(parts[:-1]) / "results.md"
        m = re.search(r"code (\w+)", read(md))
        code = m and m.group(1)
    else:
        md = None
    if parts[0].startswith("validation-"):
        for p in ("VALIDATION-REPORT.md", "AFTER-FIXES.md"):
            if (root / parts[0] / p).is_file():
                md = root / parts[0] / p
        setdir = STAGE_SET.get(parts[1]) if len(parts) > 1 else None
    if not setdir:
        best = ""
        for k in sets:
            if (rel + "/").startswith(k + "/") and len(k) > len(best):
                best = k
        setdir = best or None
    note = None
    for pat, r, n in NOTES:
        if re.search(pat, rel):
            note, reader = n, (r or reader)
            break
    note_file = str(Path(md).relative_to(root)).replace("\\", "/") if md and Path(md).is_file() else None
    return {"reader": reader or "probe", "code": code, "set": setdir, "note": note, "noteFile": note_file, "benchTitle": title}


def photo_of(stem):
    if re.match(r"^\d\d_\d\d_\d\d_\d+_Frame", stem):  # an MSDD tile: its own name
        return stem
    m = re.match(r"^(\d+(?:young)?)(?!\d)", stem)
    return m.group(1) if m else None


def convert(job):
    src, prev, thumb = job
    try:
        im = Image.open(src)
        im.draft("RGB", (PREVIEW_MAX, PREVIEW_MAX))
        im = im.convert("RGB")
        if not (prev.exists() and prev.stat().st_mtime >= src.stat().st_mtime):
            w = min(PREVIEW_MAX, im.width)
            p = im if w == im.width else im.resize((w, round(w * im.height / im.width)), Image.LANCZOS)
            prev.parent.mkdir(parents=True, exist_ok=True)
            p.save(prev, quality=82)
        t = im.resize((THUMB_W, max(1, round(THUMB_W * im.height / im.width))), Image.BILINEAR)
        thumb.parent.mkdir(parents=True, exist_ok=True)
        t.save(thumb, quality=78)
        return None
    except Exception as e:  # noqa: BLE001 - one broken picture must not stop the hub
        return f"{src}: {e}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="directtestimagery")
    ap.add_argument("--cache", default="D:/swardus-results-hub")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 2))
    ap.add_argument("--list", action="store_true", help="print the runs found and stop, converting nothing")
    a = ap.parse_args()
    root, cache = Path(a.root).resolve(), Path(a.cache).resolve()
    sets = input_sets(root)
    runs, jobs = [], []

    def items_of(folder, run_id, kind):
        out = []
        for f in sorted((f for f in os.listdir(folder) if IMG.search(f)), key=natkey):
            src = Path(folder) / f
            stem = src.stem
            prev = cache / kind / run_id / (stem + ".jpg")
            thumb = cache / "thumbs" / kind / run_id / (stem + ".jpg")
            if not (thumb.exists() and prev.exists() and thumb.stat().st_mtime >= src.stat().st_mtime):
                jobs.append((src, prev, thumb))
            out.append({"name": stem, "photo": photo_of(stem), "img": prev.as_uri(), "thumb": thumb.as_uri(),
                        "full": "../" + str(src.relative_to(root)).replace("\\", "/"), "t": src.stat().st_mtime})
        return out

    originals = {}
    for k, label in sets.items():
        its = items_of(root / k, k.replace("/", "__"), "originals")
        originals[k] = {"label": label, "count": len(its), "items": its}

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP)
        rel = str(Path(dirpath).relative_to(root)).replace("\\", "/")
        if rel == "." or rel in sets or not any(IMG.search(f) for f in filenames):
            continue
        rid = rel.replace("/", "__")
        its = items_of(dirpath, rid, "previews")
        m = meta_for(root, rel, sets)
        t = max(i["t"] for i in its)
        runs.append({"id": rid, "path": rel, "t": t, "when": datetime.fromtimestamp(t).isoformat(timespec="minutes"),
                     "reader": m["reader"], "readerName": READER_NAME.get(m["reader"], m["reader"]), "code": m["code"],
                     "set": m["set"], "setLabel": sets.get(m["set"], m["set"] or "other pictures"), "note": m["note"],
                     "benchTitle": m["benchTitle"], "noteFile": m["noteFile"], "items": its})

    runs.sort(key=lambda r: -r["t"])
    seen = set()
    for r in runs:  # the newest run of each reader on each photo set
        key = (r["reader"], r["set"])
        r["latest"] = r["reader"] not in ("probe", "sheets", "model") and key not in seen
        seen.add(key)

    n_res = sum(len(r["items"]) for r in runs)
    n_orig = sum(o["count"] for o in originals.values())
    print(f"{len(runs)} runs, {n_res} result pictures, {n_orig} originals; converting {len(jobs)}", flush=True)
    if a.list:
        for r in runs:
            print(f"  {r['when']}  {r['readerName']:24} {str(r['code']):14} {r['setLabel'][:30]:30} {len(r['items']):3}  {'LATEST ' if r['latest'] else ''}{r['path']}  | {r['note'] or ''}")
        return 0
    t0, errors = time.time(), []
    if jobs:
        with ProcessPoolExecutor(a.workers) as ex:
            for i, err in enumerate(ex.map(convert, jobs, chunksize=2), 1):
                if err:
                    errors.append(err)
                if i % 50 == 0 or i == len(jobs):
                    print(f"  {i}/{len(jobs)} in {time.time() - t0:.0f} s", flush=True)
    for e in errors:
        print("  failed:", e)

    hub = root / "hub"
    hub.mkdir(exist_ok=True)
    data = {"generated": datetime.now().isoformat(timespec="minutes"), "cache": str(cache), "runs": runs, "originals": originals}
    (hub / "data.js").write_text("window.HUB = " + json.dumps(data, separators=(",", ":")) + ";\n", encoding="utf-8")
    shutil.copyfile(HERE / "index.html", hub / "index.html")
    print(f"hub: {(hub / 'index.html').as_uri()}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
