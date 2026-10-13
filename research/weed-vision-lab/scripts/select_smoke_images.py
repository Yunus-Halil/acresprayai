"""Choose the ten smoke-test images from the train profile by a fixed, documented rule.

Reads <out>/profile/train.csv (from profile_split.py) and writes
configs/smoke10.json with the chosen names, the category each one fills and the
numbers that made it the choice. The rule is deterministic: ties break on the
filename, so the same profile always gives the same ten.

Only images with no validation errors and no mixed-family instances are eligible.

Categories, filled in this order, skipping names already chosen:
  1. isolated-single  : 1..2 full weeds, at least one isolated, fewest plants; two images, different dates if possible
  2. many-weeds       : the most full weeds; two images, different dates if possible
  3. crop-weed-mix    : most weeds whose grown box meets a crop box, with at least two full crops; two images
  4. large-weed       : the largest single weed by pixel area; one image
  5. small-weeds      : the smallest median weed area among images with at least three full weeds; one image
  6. border-weed      : a weed cut by the image border, fewest plants; one image
  7. date-cover       : one image per acquisition date not yet represented, with the median weed count for that date
If fewer than ten are chosen, the list is padded with evenly spaced eligible images by name order.
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
from pathlib import Path

import _bootstrap  # noqa: F401

from weedlab.config import CONFIG_DIR, resolve_output_dir

TARGET = 10


def _num(v):
    if v in ("", None):
        return None
    try:
        return float(v)
    except ValueError:
        return v


def load_profile(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as fh:
        rows = [{k: _num(v) for k, v in r.items()} for r in csv.DictReader(fh)]
    for r in rows:
        r["name"] = str(r["name"])
        r["date"] = str(r["date"])
        r["plot"] = str(r["plot"])
    return rows


def pick(cands: list[dict], k: int, chosen: dict[str, dict], category: str, reason_keys: list[str], used_dates: set[str]) -> None:
    taken = 0
    deferred = []
    for r in cands:
        if taken >= k:
            break
        if r["name"] in chosen:
            continue
        if r["date"] in used_dates and any(c["date"] not in used_dates for c in cands if c["name"] not in chosen):
            deferred.append(r)
            continue
        chosen[r["name"]] = {"category": category, "reason": {key: r[key] for key in reason_keys}, "date": r["date"]}
        used_dates.add(r["date"])
        taken += 1
    for r in deferred:
        if taken >= k:
            break
        if r["name"] in chosen:
            continue
        chosen[r["name"]] = {"category": category, "reason": {key: r[key] for key in reason_keys}, "date": r["date"]}
        taken += 1


def select(rows: list[dict]) -> dict[str, dict]:
    elig = [r for r in rows if r["n_issue_errors"] == 0 and r["n_mixed"] == 0]
    chosen: dict[str, dict] = {}
    all_dates = sorted({r["date"] for r in elig})

    c1 = sorted(
        [r for r in elig if 1 <= r["n_weed_full"] <= 2 and r["n_weed_isolated"] >= 1],
        key=lambda r: (r["n_plants"], r["name"]),
    )
    pick(c1, 2, chosen, "isolated-single", ["n_weed_full", "n_weed_isolated", "n_plants"], set())

    c2 = sorted(elig, key=lambda r: (-r["n_weed_full"], r["name"]))
    pick(c2, 2, chosen, "many-weeds", ["n_weed_full", "n_weed_partial", "n_crop"], set())

    c3 = sorted(
        [r for r in elig if r["n_weed_near_crop"] >= 1 and r["n_crop_full"] >= 2],
        key=lambda r: (-r["n_weed_near_crop"], r["name"]),
    )
    pick(c3, 2, chosen, "crop-weed-mix", ["n_weed_near_crop", "n_weed", "n_crop_full"], set())

    c4 = sorted([r for r in elig if r["weed_area_max"] is not None], key=lambda r: (-r["weed_area_max"], r["name"]))
    pick(c4, 1, chosen, "large-weed", ["weed_area_max", "n_weed"], set())

    c5 = sorted([r for r in elig if r["n_weed_full"] >= 3], key=lambda r: (r["weed_area_median"], r["name"]))
    pick(c5, 1, chosen, "small-weeds", ["weed_area_median", "weed_area_min", "n_weed_full"], set())

    c6 = sorted([r for r in elig if r["n_weed_border"] >= 1], key=lambda r: (r["n_plants"], r["name"]))
    pick(c6, 1, chosen, "border-weed", ["n_weed_border", "n_weed", "n_plants"], set())

    covered = {v["date"] for v in chosen.values()}
    for d in all_dates:
        if d in covered or len(chosen) >= TARGET:
            continue
        rows_d = [r for r in elig if r["date"] == d and r["name"] not in chosen and r["n_weed"] >= 1]
        if not rows_d:
            continue
        med = statistics.median(r["n_weed"] for r in rows_d)
        best = sorted(rows_d, key=lambda r: (abs(r["n_weed"] - med), r["name"]))[0]
        chosen[best["name"]] = {"category": "date-cover", "reason": {"n_weed": best["n_weed"], "date_median_n_weed": med}, "date": d}

    if len(chosen) < TARGET:
        rest = [r for r in elig if r["name"] not in chosen]
        step = max(1, len(rest) // (TARGET - len(chosen)))
        for r in rest[::step]:
            if len(chosen) >= TARGET:
                break
            chosen[r["name"]] = {"category": "pad", "reason": {"n_weed": r["n_weed"]}, "date": r["date"]}
    return dict(list(chosen.items())[:TARGET])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=None, help="output directory holding profile/train.csv")
    ap.add_argument("--profile", default=None, help="explicit path to a profile CSV")
    ap.add_argument("--config", default=str(CONFIG_DIR / "smoke10.json"))
    args = ap.parse_args(argv)
    profile = Path(args.profile) if args.profile else resolve_output_dir(args.out) / "profile" / "train.csv"
    if not profile.exists():
        print(f"profile not found: {profile}. Run scripts/profile_split.py --split train first.", file=sys.stderr)
        return 2
    rows = load_profile(profile)
    chosen = select(rows)
    payload = {
        "purpose": "ten-image PhenoBench smoke test (Milestone 3)",
        "split": "train",
        "rule": __doc__.strip(),
        "profile_source": str(profile),
        "n_profiled": len(rows),
        "images": [{"name": n, **v} for n, v in chosen.items()],
    }
    Path(args.config).write_text(json.dumps(payload, indent=1), encoding="utf-8")
    for n, v in chosen.items():
        print(f"{v['category']:16s} {n}  {v['reason']}")
    print(f"wrote {args.config}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
