# Corn check v1: a trained "what corn looks like" model beside the corn readers (2026-11-04)

Yunus's plan (2026-11-03): gather corn models and at least 1,000 images per growth stage, train what corn looks like,
use it to confirm where the corn is, then draw the rows and take only the green that is neither corn nor a corn leaf
as weed candidates. Goal: never guess whether something is corn. This note records the first pass: what exists, what
was built, and what was measured. Nothing here is wired into the app.

## What exists publicly

- **Models.** Almost no corn model publishes weights. Three nadir-drone maize checkpoints download at all; only
  **MaSC** (Kharismawati & Kazic, Missouri, zenodo.org/records/22219350) is licensed for commercial use (CC BY 4.0,
  licence file read): a YOLOv9-c seedling detector, V2-V10, ~1 cm/px. Its checkpoint matches the Zenodo checksum and
  its pickle names only torch and YOLOv9 classes, but running it (external code + pickle) was blocked by the session's
  safety check; `scripts/rowCrop/masc_detect.py` is ready for when it is allowed. General zero-shot detectors cannot
  tell crop from weed (published: Grounding DINO 12.6 mAP on PhenoBench; OWLv2 failed on maize seedlings).
- **Datasets** (on D:\swardus-research\datasets): UAV3DCrop nadir frames 2023-2025 (CC BY, 36 GB, the same Mavic 3M
  camera as our test photos), Texas A&M CS19 (public domain, 41 GB, VE to VT), Cornell NLB drone close-ups (CC0, 7,669
  frames, late), MSDD (163,921 hand-checked corn boxes, **CC BY-NC-SA: evaluation only**), USU-Corn-WeedDB (CC BY,
  weed boxes), plus tassel, MatchPlant, UAVmulticrop and DIWEED extras.
- **Leakage.** Our establishment test set is byte-identical to UAV3DCrop 2025 Day019; the holdout and Corn2 come from
  2024-2025 UAV3DCrop flights. Training uses only 2023-2024 scenes; no 2025 scene is ever trained on.

## The independent test that came first

MSDD's 2022 test set (696 nadir 1920 px tiles, Missouri nursery fields, every corn plant boxed) showed the adaptive
reader read no rows on 73 % of tiles: the assessment's cells and pitch search were shares of the frame, built for
26 m frames. Fixed in e68fb95 (cells sized from the frame's own row spacing when it spans under 12 rows); our 154
photos read identically. After the fix: rows on 54 % of tiles, 48 % of boxed corn under our rows, 86 % of our plant
points on a boxed plant, 19 % of weed candidates on boxed corn. Still failing: dark V2-V4 seedlings under cloud
(the colour mask) and corn leaf fragments beside rows called weeds.

## The model

Frozen DINOv2-small (Apache-2.0) + a small convolutional head, three classes (soil, corn, weed), trained on 8,442
tiles of 448 px: 7,056 **self-labels** from the adaptive reader's sure results on UAV3DCrop 2023-2024
(`scripts/rowCrop/cornLabels.ts`: corn = green in strongly held row bands; weed = small alley weeds bracketed by two
held rows; every label rule eye-checked on sheets, a cover rule that called corn canopy "not corn" was dropped),
1,256 USU training tiles (real weed outlines, including in-row weeds the self-labels call corn) and 130 WeedsGalore
tiles. Checkpoint: D:\swardus-research\checkpoints\corn-check-v1.

The check acts on a read in two ways (`scripts/rowCrop/cornCheck.ts`): it **clears** a weed candidate whose plant
pixels it calls corn, and it **adds** patches it calls weed that no candidate covers.

## Measured

| Test | Before | With the check |
|---|---|---|
| MSDD (Missouri, never seen): weed candidates on real corn | 137 of 713 | 68 (clearing removes half) |
| MSDD: candidates cleared away from every corn box (weed or missed plant, unjudged) | - | 177 |
| MSDD: model additions that land on real corn (p >= 0.8, >= 5 cm) | - | 20 % of 599 |
| USU, 13 held-out fields (same Utah flight as its training tiles): labelled weeds found | 4 % | 49 % (p >= 0.8, 5 cm), 73 % (any) |
| USU: additions on a labelled weed | - | 92 % (p >= 0.8, 5 cm) |
| USU: real weeds wrongly cleared | - | 1 of 68 |
| Our establishment photos (clean V5-V7): additions | - | 16 of 16 sampled are corn rows |
| Our mid photos: cleared candidates judged by eye | - | ~8 of 12 corn leaf tips, 2 alley seedlings |
| Our emergence photos: cleared candidates judged by eye | - | ~5 of 12 on corn, 2 real weeds, 5 unclear |

## Verdict

- **Clearing carries to new fields** and halves "corn leaf called weed" on MSDD; on our photos it is mostly right at
  mid and mixed at emergence (it clears some real weed seedlings).
- **Adding does not carry.** Within the Utah flight it finds in-row weeds the position rules cannot (4 % -> 49-73 %);
  on any other field it marks corn. The weed side has learned one flight's weeds, not weeds.
- So v1 is not ready for the app. The pictures are in the results hub (reader "Corn check"), with adding switched off
  except on the Utah fields, and the evidence sheet of additions on corn.

## MaSC run (same day, once Yunus allowed it)

`masc_detect.py` (checkpoint loaded with an allow-list, weights_only) reproduces MSDD's own test labels exactly on three
tiles (5/5, 1/1, 67/67 boxes), so it is loaded right. Run at factor 3 (3 photo pixels per model pixel, chosen by eye
from a 1-4 sweep), NMS IoU 0.3, confidence >= 0.3; `scripts/rowCrop/mascCompare.ts` sets it beside the adaptive reader.
MaSC never saw our photos or Utah.

| Set | MaSC plants | on a read row | weed candidates inside a MaSC box | by eye |
|---|---|---|---|---|
| Emergence (veryearlystage) | 74,686 | 98.1 % | 117 of 664 | ~15/16 sampled are corn seedlings (blurred frame edges); off-row plants are corn at frame edges and the later planting of photo 100 |
| Corn2 emergence | 59,494 | 98.9 % | 20 of 88 | ~14/16 plainly corn (lodged plants), 2 dark corners unjudged |
| Establishment | 40,811 | 99.6 % | 0 of 20 | off-row plants: ~12/16 corn at row ends past the field-edge cut, 4 verge or bare soil |
| Mid | 4,367 | 31 % | 5 of 705 | off-row plants are mostly a **broadleaf (soybean) planting** beside the corn: MaSC boxes it as corn |
| Late | 0 | - | 0 | past V10: MaSC sees nothing |
| USU, all 53 fields (Utah, never seen) | 5,975 | - | clears 318 of 2,802 | 2.2 % of its plants centred on a labelled weed; 13 of 374 candidates on real weeds wrongly cleared (3.5 %) |

Against the corn check v1 on the same candidates (both / v1 only / MaSC only): emergence 29 / 144 / 88, Corn2
17 / 20 / 3, mid 2 / 208 / 3. They are different signals: v1 clears leaf fragments at mid, MaSC clears whole seedlings at
emergence.

**Verdict.** MaSC is the best "is this a corn-row seedling" signal we have from V2 to V10: it puts 98-99.6 % of its
plants on our rows, the candidates it calls corn are corn, and it finds rows our colour reader misses (frame edges, row
ends, a dark later planting). It is **not** a crop-identity check: it boxes soybean seedlings in rows as corn, so it
cannot tell a corn field from a soybean one. Licence: weights CC BY 4.0; the YOLOv9 code is GPL-3.0, so in a product it
would need its own runtime (ONNX export of the weights) rather than the YOLOv9 repository. Not in the app.

## Next

1. Use the corn map to **find the rows** (Yunus's plan: confirm where the corn is, then draw the lines), not only to
   check candidates: the colour mask misses dark seedlings (75 % of MSDD V2-V4 tiles read no rows).
2. Weed diversity: weed labels from more than one flight (CS19 dates, DIWEED once its licence is confirmed, our own
   alley weeds across 2023-2024), then retest additions on MSDD and our photos.
3. MaSC: run (see above). Its boxes are the natural input to item 1 (row-planted seedlings, dark ones included); crop
   identity (corn vs soybean) still needs its own check.
4. A seedling-stage corn check from the CS19 VE-V2 frames.

Benches: `npm run bench:msdd -- --corn-prob <dir> [--add-grid p:cm,...]`, `npm run bench:usu-check -- --heldout-only
--min-tiles 6 --corn-prob <dir>`; probability maps from `seg_train.py predict --save-prob`; pictures from
`scripts/rowCrop/cornCheckDraw.ts`; hub with `npm run hub:results`. MaSC: `masc_detect.py --factors 3 --iou 0.3 --draw`
(venv D:/swardus-research/yolov9-venv), then `mascCompare.ts --photos --masc --out [--prob]`, and `bench:usu-check --
--min-tiles 6 --masc <dir>`.
