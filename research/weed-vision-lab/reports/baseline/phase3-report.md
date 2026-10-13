# Phase 3: classical autonomous weed detection baseline

Date 2026-10-13. Lab weedlab-0.1.0, branch `research/weed-vision-lab`. PhenoBench
v1.1.0 at native 1024 x 1024. Hardware: AMD Ryzen 5 9600X, 31 GB RAM, Windows 11,
Python 3.12.10, CPU only. Per-run tables: `reports/baseline/<run>/<split>/summary.md`;
comparisons: `comparison_dev_tune.md`, `comparison_dev_check.md`. Panels and
predictions: `D:\swardus-research\weed-vision-lab-outputs\baseline\<run>\<split>\`.

## Protocol

- **Inference** sees the RGB image only: colour index, fixed decision rule, 8-connected components, no opening, no size floor, no hole filling. Every component is a detection, down to one pixel.
- **Scoring** uses the reference masks and the frozen `soil_only_v1` table (categories A to D, size bands). One-to-one greedy IoU matching against weed instances at 0.5, 0.3 and 0.1. Crop instances are never matched; an unmatched detection is classified by the majority of its pixels as a crop, weed-overlap or background false positive. "Found" means one component covers at least half the reference; "merged" means that component also covers half of another plant; "split" means two or more components each cover a fifth. Full definitions in `weedlab.eval.matching`.
- **Splits**: dev_tune (717 train images, 11 plots, 4,121 reference weed observations) for iteration; dev_check (690 train images, 10 other plots, 4,020 observations) run once per chosen configuration. The holdout (val) was not touched.
- **Methods**: `exg_exr` (ExG minus ExR on chromaticity, threshold 0), `exg_otsu` (ExG, Otsu per image), `hsv_band` (hue 60 to 160, S at least 0.15, V at least 0.08), and `exg_fixed` (ExG on chromaticity above a declared constant t). The first three are parameter-free. `exg_fixed` has one parameter; t was chosen on dev_tune from the declared grid {0.05, 0.08, 0.10, 0.15} by crop-aware F1 at the 25 px scoring floor, then confirmed on dev_check.

## Why the recommended rule was replaced

The Phase 2 recommendation was ExG minus ExR above zero. Measured on 60 dev_tune images, that index is negative for most small weeds (median minus 0.09, 95th percentile 0.17) because the 05-15 and 05-26 seedlings are yellow-green, not green. Plain ExG separates them: background 95th percentile 0.04, small-weed median 0.12. The data overruled the recommendation before any detector was scored; the replacement and its grid were declared before the runs.

## Results

Precision in the raw column counts every one-pixel speck. The 25 px floor is a scoring view (detections under 25 px set aside; a reference counts as hit only if its match survives), not an inference filter.

| run | split | dets/img | raw P | R | raw F1 | floor 25: P raw | P crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|---|---|
| exg_exr | dev_tune | 711 | 0.001 | 0.113 | 0.002 | 0.039 | 0.130 | 0.121 | 0.112 | 0.6 | 11.6 |
| exg_otsu | dev_tune | 790 | 0.001 | 0.119 | 0.002 | 0.045 | 0.115 | 0.116 | 0.129 | 2.3 | 9.2 |
| hsv_band | dev_tune | 202 | 0.003 | 0.108 | 0.005 | 0.026 | 0.134 | 0.118 | 0.101 | 0.2 | 18.9 |
| exg_fixed t 0.15 | dev_tune | 1,014 | 0.001 | 0.143 | 0.002 | 0.047 | 0.101 | 0.118 | 0.175 | 3.1 | 9.3 |
| exg_fixed t 0.10 | dev_tune | 1,431 | 0.001 | 0.332 | 0.003 | 0.089 | 0.150 | 0.205 | 0.452 | 7.2 | 8.6 |
| **exg_fixed t 0.08** | dev_tune | 1,767 | 0.001 | 0.414 | 0.003 | 0.098 | 0.149 | **0.219** | 0.561 | 10.2 | 8.2 |
| exg_fixed t 0.05 | dev_tune | 3,079 | 0.001 | 0.496 | 0.002 | 0.082 | 0.105 | 0.174 | 0.677 | 21.4 | 7.6 |
| exg_exr | dev_check | 616 | 0.001 | 0.112 | 0.002 | 0.039 | 0.129 | 0.120 | 0.126 | 0.6 | 11.8 |
| **exg_fixed t 0.08** | dev_check | 1,501 | 0.002 | 0.383 | 0.003 | 0.096 | 0.149 | **0.214** | 0.477 | 9.3 | 8.2 |
| exg_fixed t 0.05 | dev_check | 2,491 | 0.001 | 0.485 | 0.002 | 0.088 | 0.116 | 0.187 | 0.620 | 18.4 | 7.6 |

The ranking and the numbers carry from dev_tune to dev_check (different plots): t 0.08 keeps the best crop-aware F1, t 0.05 the best recall. The three parameter-free rules find about one weed in nine.

### Recall by category and size band, IoU 0.5 (dev_check, n in brackets)

| run | A | B | C | D | tiny | small | medium | large |
|---|---|---|---|---|---|---|---|---|
| exg_fixed t 0.08 | 0.485 (1,137) | 0.370 (81) | 0.544 (698) | 0.124 (982) | 0.383 (736) | 0.338 (2,459) | 0.509 (786) | 0.667 (39) |
| exg_fixed t 0.05 | 0.629 | 0.494 | 0.653 | 0.162 | 0.531 | 0.443 | 0.565 | 0.667 |
| exg_exr | 0.128 | 0.099 | 0.192 | 0.060 | 0.025 | 0.063 | 0.322 | 0.615 |

At IoU 0.3 and 0.1, t 0.08 reaches A recall 0.703 and 0.895: most A weeds are touched by a component, but under-delineated.

### Found, merged, split (dev_tune, exg_fixed t 0.08)

| group | n | found | merged with weed | merged with crop | split | median best IoU |
|---|---|---|---|---|---|---|
| A | 1,107 | 0.596 | 0.000 | 0.000 | 0.041 | 0.533 |
| B | 86 | 0.616 | 0.000 | 0.000 | 0.140 | 0.644 |
| C | 632 | 0.668 | 0.008 | 0.016 | 0.036 | 0.564 |
| D | 1,032 | 0.714 | 0.339 | 0.540 | 0.068 | 0.058 |
| band tiny | 776 | 0.586 | 0.058 | 0.079 | 0.032 | 0.405 |
| band small | 2,463 | 0.601 | 0.094 | 0.152 | 0.054 | 0.380 |
| band medium | 851 | 0.840 | 0.203 | 0.338 | 0.067 | 0.452 |

Connected components do not merge neighbouring weeds in A, B or C (merged with weed 0 to 0.8%); they merge weeds that touch or sit under crops: 54% of D weeds share a component with a crop and 34% with another weed. B shows the highest split rate (14%): the 8 to 32 px gaps between neighbouring seedlings are also where leaves break into pieces.

### Scoring-time floor (dev_check, t 0.08, IoU 0.5)

| floor px | detections kept | P raw | R | P crop-aware | F1 crop-aware | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|
| 1 | 1,009,398 | 0.002 | 0.383 | 0.002 | 0.003 | 1,437 | 10.7 |
| 10 | 41,653 | 0.037 | 0.382 | 0.043 | 0.077 | 45 | 8.5 |
| 25 | 15,940 | 0.096 | 0.381 | 0.149 | 0.214 | 9.3 | 8.2 |
| 50 | 10,263 | 0.143 | 0.365 | 0.296 | 0.327 | 2.6 | 7.7 |
| 100 | 7,301 | 0.171 | 0.310 | 0.465 | 0.372 | 0.6 | 6.7 |

Below 25 px the false positives are soil specks; above 50 px they are mostly crops.

### Runtime

Single process, sequential, image decode excluded, native resolution: median 46 to 53 ms per image for every ExG method (index and threshold about 25 ms, components about 4 ms, per-component measurement the rest, growing with the component count); cold first image 51 to 57 ms; hsv_band 88 ms. A full 717-image split with detection, scoring and prediction PNGs took 27 s of wall time on 11 worker processes.

## Failures, with the evidence

1. **Pale seedlings are under-covered, not missed outright.** Of the 385 A+B misses at t 0.05 on dev_tune, 76% have a best component covering 10 to 50% of the weed and only 13% are untouched. Misses concentrate on 05-15 (251 of 545 A+B weeds) against 24 of 229 on 06-05. The threshold that admits the pale leaf margin also admits soil specks.
2. **Soil specks.** At t 0.08, 1,437 background components per image survive at one pixel and 9 at 25 px; their median area is 36 px and their median score 0.12, just over the threshold. They are more numerous on the dark 06-05 soil (33 per image at t 0.05 against 17 on 05-15).
3. **Crops are detected as vegetation**, 8 per image after the floor, because the detector has no notion of crop. A rosette often yields several components (leaf tips), and on 06-05 adjacent rosettes merge into one component that also swallows the weeds between them (`06-05_00158_P0038053`: 2 crops and 9 weeds in two components).
4. **Shadow halos.** Pixels at the shadowed edge of a crop have unstable chromaticity and are included, visible as a red fringe in the error panels. They inflate crop components rather than creating new false positives.
5. **Thin grass-like weeds** (solidity under 0.2) are broken into pieces or missed; visible in the top-right of `06-05_00158` and consistent with the B split rate.
6. **The parameter-free rules fail on this soil and these weeds** for the reason measured above; Otsu additionally collapses on sparse images (p10 vegetation IoU 0.01).

## What exists upstream (summary of `docs/pretrained-models.md`)

All plant-level PhenoBench baselines label weed against crop; Mask R-CNN, Panoptic-DeepLab and Mask2Former give individual weed instances. Checkpoints are downloadable from the IPB server (25 MB to 526 MB). None ships a CPU or Windows path; the pure-PyTorch ones can be run on CPU by bypassing their training wrappers, Mask2Former cannot (detectron2 plus compiled CUDA ops). The official evaluator accepts our uint16 PNG layout directly. Best candidate for a fair comparison: the ERFNet semantic checkpoint (25 MB, weed pixel IoU 64.4 on the test set) plus our connected components, scored by the same protocol; second, the torchvision Mask R-CNN checkpoint (526 MB, weed PQ 31.3).

## Limitations of this benchmark

- Every number is per observation; overlapping frames repeat plants about 3.3 times, so effective sample sizes are a third of the n shown.
- t was chosen on dev_tune; dev_check is a different set of plots but the same field and season. No claim beyond this field follows.
- IoU against references whose outlines are loose at leaf tips has an unmeasured floor; recall at IoU 0.3 is also reported for that reason.
- The crop-aware column uses reference crop masks at scoring time only. The detector cannot do this itself; the column says what a crop-removal step would be worth.

## Recommended next experiment

Run the **ERFNet semantic checkpoint** (25 MB; CPU torch wheel of roughly 200 MB also needed; both require approval) through the identical protocol on dev_tune and dev_check: argmax semantic map, weed class to 8-connected components, scored with the same matching, bands and categories. It answers the open question directly: is the 05-15 seedling gap a colour-threshold problem or a learned-texture problem, and does a weed-labelled output remove the 8 crop false positives per image. In parallel, one cheap classical variant is worth a run: two-threshold hysteresis (seed components at ExG 0.10, grow them to 0.03) to recover the pale margins of found seedlings without admitting specks that have no seed. Both runs leave the holdout untouched.
