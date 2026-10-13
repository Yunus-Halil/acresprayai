# Milestone 3: ten-image PhenoBench smoke test

Date: 2026-10-13. Lab version weedlab-0.1.0. Dataset PhenoBench v1.1.0 at
`D:\Drive2downloads\PhenoBench-v110\PhenoBench`, split `train`. Python 3.12.10,
AMD Ryzen 5 9600X, Windows 11. Config: `configs/smoke10.json` (selected by
`scripts/select_smoke_images.py` from the full train profile, rule in that file).

## What was checked

| Check | Result |
|---|---|
| Train / val / test image counts | 1407 / 772 / 693, matching the paper |
| Every train and val image has all five annotation files | yes, no missing or stray files |
| 16-bit instance ids preserved (uint16, ids up to 65535 in synthetic tests; real ids up to 1551 seen) | yes |
| Semantic ids within 0..4 on all 2,179 labelled images | yes |
| Instance mask aligned with semantic mask (no plant pixel without an id, no id on background) | yes, on all 2,179 |
| Weed instances told from crop instances by the semantic mask | yes; lab rule and devkit rule give identical id sets on all ten images, purity 1.0 on every weed instance |
| Any instance straddling crop and weed classes | none, on all 2,179 images |
| Visual check of panels A..G on the ten images | done by eye; crop rosettes green, weeds red, outlines sit on the plants |

## The ten images

See `summary.md` for the table. Categories covered: isolated single weed (2,
two dates), many weeds (2, two dates), crop and weed mix (2), the largest weed
instance in train, the smallest-median weeds, a border-cut weed, and the
05-26 date. Weed instances in the ten: 115; areas 10th/50th/90th percentile
67 / 414 / 3,503 px.

## Pictures

Rendered under the output directory, not in the repository (they are derived
from CC BY-NC-SA content and are large):

```
D:\swardus-research\weed-vision-lab-outputs\smoke10\contact-sheet.png      1200 x 3242, one row per image
D:\swardus-research\weed-vision-lab-outputs\smoke10\panels\<name>.png     seven panels + stats, 2200 x 1144 each
```

Regenerate with `python scripts/smoke_test.py`.

## Ambiguities found (detail in `docs/annotation-notes.md`)

- Leaf instances and leaf visibility are annotated for crops only; weeds have none.
- Dense weed patches are labelled as one instance (144,400 px in `06-05_00090_P0037989`).
- Instances as small as 1 px exist; 148 train images have a weed under 25 px.
- Visibility masks are 8-bit, contrary to the README.
- Dataset license in the shipped README is CC BY-NC-SA 4.0, not CC BY-SA 4.0.

## Timing

Loading one image with all five annotations: about 20 ms. Instance extraction
and validation: about 25 ms more. Rendering the eight-panel figure: about 2 to
3 s per image (matplotlib, not optimised; inspection only). Whole smoke test:
under one minute.

## Verdict

The reader is correct against the documented format and the devkit; the
ten-image visualisation test passed. Milestone 3 is done. No detection,
segmentation or measurement result exists yet.
