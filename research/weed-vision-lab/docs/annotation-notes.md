# PhenoBench annotation notes (what the reader found, 2026-10-13)

Measured on the real v1.1.0 files with `scripts/profile_split.py` over every
train and val image, plus the ten smoke images inspected by eye.

## Format facts that differ from the documentation

1. **Visibility masks are 8-bit.** The README says all annotations are 16-bit PNGs; `plant_visibility` and `leaf_visibility` decode as PIL mode `L` (uint8). Values are 0..255 as documented. The reader keeps the stored dtype.
2. **The README's class list has a typo.** It lists id 4 as "partial-crop" a second time. The devkit maps 3 to crop and 4 to weed; the smoke images confirm 4 is partial weed (orange, dashed outline in panel G).
3. **Semantics decode as uint16** even though values fit in 4 bits. Kept as-is.

## Consistency, measured on all 2,179 labelled images

- No semantic id outside 0..4.
- No plant pixel without an instance id, and no instance id on a background pixel. Instance and semantic masks are perfectly aligned.
- No instance whose pixels fall in both the crop family and the weed family. The lab's majority rule and the devkit's rule (unique ids under weed semantic pixels) give identical weed id sets on every image checked.
- No leaf-instance pixel outside plant pixels; no visibility value outside plant pixels.
- Every image has all five annotation files; no stray files.

## Things to know before scoring anything

4. **Leaf instances exist for crops only.** Over 39 train images, leaf-instance pixels cover 97% of crop pixels and 0.00% of weed pixels; `leaf_visibility` is zero on every weed pixel. Phase 5 leaf diagnostics therefore apply to the crop class; thin-structure analysis on weeds has to use the plant mask itself.
5. **Dense weed patches are one instance.** The largest "weed" in train (144,400 px in `06-05_00090_P0037989`, id 1408) is a mat of many overlapping plants labelled as a single instance. Thirteen train images contain a weed instance over 20,000 px. A segmenter that splits such a patch into plants will be scored as over-splitting even when it is botanically right. These must be reported separately, not hidden in a mean.
6. **Very small instances exist.** The smallest weed instance in train is 1 px; 59 train images have a weed under 10 px and 148 have one under 25 px. Detection recall must be reported by size band; a one-pixel reference instance is not a meaningful detection target and the size-band policy has to say so explicitly.
7. **Crops and weeds look alike at the seedling stage.** In `05-15_00179_P0030688` the seven crop seedlings and nine weed seedlings are all 17 to 100 px specks on soil, distinguishable mainly by row position. Any colour-only method will find both; weed-versus-crop discrimination is a separate problem from vegetation detection.
8. **Partial plants.** Train: 629 of 8,141 weed instances (7.7%) and 2,937 of 11,875 crop instances (24.7%) are partial. Partial plants are mostly cut by the image border. The lab's default keeps them flagged; the detection benchmark will state its policy (proposal: score them as "don't care" at the border, following the devkit's `ignore_partial` option).
9. **Shadows.** Crop shadows fall on bare soil (`05-15_00039_P0030852`) and are background. A dark-blob false positive source for later phases.
10. **Images with no weeds:** 47 in train, 34 in val. Every image has at least one crop instance.

## Leakage and split structure

- Train and val share no plot id (`Pnnnnnnn`). Each date maps to its own set of plots (train: 9 plots on 05-15, 6 on 05-26, 6 on 06-05; val: 6, 3, 3).
- Adjacent frames within a plot overlap. Two train images (`06-05_00182` and `06-05_00203`, both plot P0038053) contain a weed instance with the identical area 26,752 px, which is the same plant seen twice under the version 1.1.0 temporally consistent ids. Internal dev/holdout splits must be made by plot, never by image, or the same plants land on both sides.
- The test split has no labels; the official hidden evaluation is through the benchmark server and is not used for tuning.

## Repeated observations (measured in Phase 2 over both splits)

Overlapping frames carry the same plant with the same (plot, instance id) and
an identical mask. The 12,067 weed instance observations are 3,654 unique
plants (train 2,485, val 1,169), 3.3 frames per plant on average, up to 9.
Instance ids are reused across plots within a split (451 of 756 train ids occur
in more than one plot), so the plant key is (plot, id), never id alone. No
(plot, id) spans two dates. Any count of "weeds" must say whether it counts
observations or plants.

## Background content (seen in the Phase 2 inspection)

Semantic background is soil, but also hard cast shadows from crop rosettes,
white stones, tyre tread, and brown dead-leaf residue. Four soil colours occur
across plots and dates. See `reports/subset/soil_only_v1/inspection.md`.

## Sizes (train, per-image medians)

Per-image median weed area ranges from 13 px to 5,573 px (median of medians 319 px). Weeds grow across the three dates: median weeds per image 4, 5, 7 on 05-15, 05-26, 06-05. The Phase 2 profile will give the per-instance distribution and the size bands.
