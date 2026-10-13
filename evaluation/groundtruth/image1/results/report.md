# Benchmark: image1 (DJI_0301.JPG), the first human-annotated frame

2026-10-13. One frame of the orchard sample set, annotated by a person on 2026-10-13 and
run through the Swardus pipeline unchanged. One image is an initial benchmark, not evidence
of accuracy across fields.

Four kinds of statement appear below and are kept apart:
**human image annotations** (what the annotator clicked, in the photo);
**field-verified ground truth** (none exists for this image: nothing was measured or
identified on the ground);
**model predictions** (what the pipeline produced);
**engineering assumptions** (the matching rule, the pixel size from EXIF, the pass's
settings).

## 1. Inventory

| | |
|---|---|
| image | `DJI_0301.JPG`, 5472 x 3648, DJI FC6310R, nadir |
| pixel size | 0.99 cm/px, estimated from EXIF (36.0 m above take-off, 8.8 mm focal, 35 mm equivalent 24 mm). An engineering assumption: no calibration, no georeferencing, no ground control. Every size below inherits its error |
| annotation file | `DJI_0301.labels.json`, format `swardus-region-labels-v1`, exported 2026-10-13 11:27 UTC from `scripts/annotate/annotate.html` with no predictions loaded (`region: null`, `gsdCmPx: null`), annotator not recorded |
| labels | 518 points: **414 weed, 104 crop, 0 uncertain** |
| coordinates | the photo's native pixels (regionX = x, regionY = y); range x 4.7 to 5439.6, y 18.3 to 3605.3, all in bounds |
| per label | class and position only. **No diameters, no shadow flags, no polygons, no masks, no row lines, no species** |
| coverage | the whole frame; labels in every cell of a 4 x 4 grid (10 to 53 per cell) |
| duplicates | one exact duplicate: L472 and L473 at (2795.2, 97.2), both weed. No other pair within 10 px |
| exhaustive? | **not stated**. The file predates the "every weed labelled" flag. 518 labels were placed in 7.5 minutes; the pipeline finds 509 weed candidates, 283 of which touch no label. Whether those are unlabelled weeds or false candidates cannot be told from this file |

What the annotations can and cannot support: recall of the labelled weeds (supported);
precision (not supported: the labels are not known to be exhaustive); segmentation quality
(not supported: points, no masks); row accuracy (not supported: no row labels); size error
(not supported: no diameters); shadow and size breakdowns (not supported: no flags, no
sizes; the scorer's size and distance buckets below use the prediction's own values and
say nothing about the misses).

## 2. Baseline configuration

The pipeline as committed at 612ab71 and 18748a2, untouched: the photo decoded to a 4,096
px long edge (1.98 cm/px for the pass), `analysePhoto` with row spacing "auto" and 4 m
windows, every off-pattern blob measured at native resolution by the sizer with the default
thresholds, dispositions from `structure/trace.ts` with a 15 cm display floor. No threshold
was changed for this image.

Reproduce from the repository root (the photo is gitignored; the labels, manifest,
predictions, scores and this report are committed):

```
npm run eval:regions -- --manifest evaluation/groundtruth/image1/regions.json --dir evaluation/groundtruth/image1 --out evaluation/groundtruth/image1/results --no-png
npm run eval:detections -- --predictions evaluation/groundtruth/image1/results/predictions.json --labels evaluation/groundtruth/image1 --out evaluation/groundtruth/image1/results
npm run eval:visuals -- --image evaluation/groundtruth/image1/DJI_0301.JPG --labels evaluation/groundtruth/image1/DJI_0301.labels.json --predictions evaluation/groundtruth/image1/results/image1-full.predictions.json --report evaluation/groundtruth/image1/results/detection-report.json --region image1-full --out evaluation/groundtruth/image1/results
```

The pipeline is deterministic; the three commands give the same numbers on every run.

## 3. Methodology

Matching (`src/lib/weedScout/sizing/detectionEval.ts`): each label to the nearest unused
component whose centre lies within the larger of **25 px** and the component's own radius
(equivalent diameter at the pass's scale over two); nearest pairs first; a component is
used once, so one large component never counts as several weeds. A weed label matched by
any component is "segmented"; matched by a weed candidate (measured, refused, not measured,
or hidden under the display floor) it is a hit. A weed label matched by nothing is missed
by segmentation; matched by a non-candidate it is lost to that disposition.

The 25 px reach is an engineering choice. Its effect is reported in section 5; it was not
changed.

## 4. Pipeline output on this frame

639 components: 91 crop, 323 candidates measured, 186 candidates refused, 39 cut by the
edge; 4,661 fragments under the component floor counted as coverage. One row block at 169
degrees and 5.13 m, trusted in all 117 windows, 92 crop plants placed.

## 5. Results

### A. Weed detection (supported in part)

| | |
|---|---|
| weed labels | 414 (413 distinct points) |
| segmented: matched by any component | **223 of 414, 54%** |
| hits: matched by a weed candidate | **221 of 414, recall 53%** |
| lost after segmentation | 1 to crop (a weed label on a tree's component), 1 to the edge filter |
| missed by segmentation (no component within reach) | 191 |
| crop labels a candidate landed on | 5 of 104 |
| candidates touching no label | 283 of 509 |
| precision, F1, false positives | **unavailable**: the labels are not known to be exhaustive |
| matched label to component centre | median 9 px, 90th percentile 30 px |

Where the 191 unmatched weed labels are, by what the mask and the index say at each one
(`unmatched-weed-labels.tsv`):

| | count | what it is |
|---|---|---|
| a component within 60 px but past the 25 px reach | 81 (3 of them crop components) | a candidate exists nearby; the label and the component centre disagree by 25 to 60 px. Partly click placement at the annotator's speed, partly components whose centroid sits off the labelled plant (a clump the pipeline holds as one object with two labels on it: 14 labels fall inside a measured outline, 11 of those inside one already matched to another label) |
| mask on at the label, no component | 63 | **a fragment under the component floor**: at 1.98 cm/px the pass drops components under 6 px (about 6 cm), and these labelled weeds are under it |
| index within 30% of the threshold but under it | 43 | **not segmented**: green by the index but under Otsu's split, most of them small or pale plants; shade cannot be separated out without shadow labels |
| not green by the index | 1 | the annotator saw something the index does not |

Sensitivity of the reach (engineering, reported, not adopted): at 40 px segmented 236 and
recall 57%; at 60 px 246 and 59%; at 80 px 254 and 61%. Crop called weed stays at 5 to 6.
So about a third of the unmatched labels are a matching-distance question and two thirds are
plants the pipeline has no component for.

The 283 candidates with no label, by size: 38 under 6 cm, 114 of 6 to 10 cm, 92 of 10 to 20
cm, 39 over 20 cm; 145 of them were refused by the sizer. The size skew towards small
plants suggests the annotator skipped small weeds, which would make the file non-exhaustive
by design; it cannot be settled from the file.

Intra-row versus inter-row: not supported. The labels carry no row distance and there is
no row reference; the scorer's "distance to row" buckets use the pipeline's own distances
for the matched plants only (5 within 30 cm of a row, 4 hits; 211 over 1 m, all hits), and
say nothing about the 191 unmatched.

### B. Weed segmentation (not quantified)

The labels are points. Mask IoU, boundary quality, plant separation and crop/weed mask
overlap cannot be computed. Visual evidence only: `miss-1` to `miss-3` show unmatched
labels beside the measured outlines, `3-labels-vs-predictions.png` shows every outline and
every label. The 11 labels inside an already-matched outline are the one quantitative hint
that some measured outlines hold two plants.

### C. Crop rows and crop versus weed (not a row evaluation)

No row geometry was labelled, so the pass's fitted lines have no reference and are not
scored. What the crop points allow: the pass placed 92 crop plants against 104 crop labels;
the nearest placed plant to each crop label is at a median of 28 px, 90th percentile 306 px,
26 labels further than 60 px from any placed plant (`5-rows.json`). So about a quarter of
the labelled trees have no placed plant near them, either unplaced or placed on a
neighbour. Crop called weed: 5 of 104 crop labels sit on a weed candidate. Weed called crop:
1 of 414. On this frame, with discrete young trees, crop/weed confusion is small in both
directions; the vineyard's continuous rows are the harder case and are not in this file.

## 6. The largest confirmed failure mechanisms

1. **Small weeds under the pass's component floor** (63 labels, 15% of all weed labels,
   a third of the misses): the mask is on at the label but the component is under 6 px at
   the 1.98 cm/px decode. Confirmed by the mask itself. The sizer reads at native but is
   only asked about the pass's candidates.
2. **Pale or small plants under the vegetation threshold** (43 labels, 10%): the index at
   the label is within 30% of the class separation of the threshold and below it. Confirmed
   by the index. Shade is the likely driver on the shaded side of trees but the labels carry
   no shadow flag, so it is not confirmed as shade.
3. **Components whose centre disagrees with the label by 25 to 60 px** (81 labels, 20%):
   a mixture of annotation placement and one component standing for two labelled plants.
   Confirmed as a disagreement; not confirmed as a pipeline error, since the file cannot say
   which side is right.

Not confirmed on this frame: weeds lost to touching crop rows (1 of 414), shade misses as
such, small candidates refused for confidence as a cause of misses (the refused ones still
match as candidates).

## 7. Visual evidence

In this folder (PNGs are gitignored; regenerate with the commands above):
`1-labels.png` the human labels (red weed, green crop); `2-predictions.png` every component
by disposition; `3-labels-vs-predictions.png` both with a line from each label to its match;
`4-hits-misses.png` green hits, yellow weeds lost after segmentation, red crosses missed by
segmentation, magenta crop labels under a candidate, grey candidates with no label;
`5-rows-vs-crop-labels.png` the pass's row lines and placed plants (cyan) with the crop
labels (green), a comparison of plant positions, not a row evaluation; `6-refused-uncertain.png`
refused (magenta) and filtered components, with the weed labels on them; `miss-N-*.png`
native cuts around unmatched labels by kind.

## 8. What additional annotations are needed

- An "every weed labelled" declaration on a region (the tool now has the checkbox), or a
  second pass over one or two 1,200 x 900 regions done exhaustively, so precision can be
  computed. Thirty minutes of careful work on two regions beats another fast whole frame.
- Shadow flags on the weed labels, so the threshold misses can be separated by shade.
- Polygons or masks for twenty plants, including two clumps, for IoU and separation.
- Row lines or row endpoints, for row displacement; without them the rows cannot be scored.
- Diameters on twenty plants measured on the ground (`docs/operations/ground-truth.md`),
  for size error.
- A note of what "weed" means at the small end: whether the 38 to 114 small unlabelled
  candidates were skipped on purpose.

## 9. Recommendation: what to fix first

The pass's component floor at the decode scale. It is the largest confirmed mechanism, it
is a scale limit rather than a judgement, and the remedy is already in the architecture:
the sizer measures at native resolution, where a 6 cm plant is 6 px, not 3. Reading the
pass's fragments as candidates (or re-reading the inter-row at native) would address the 63
confirmed misses and some of the 43 near-threshold ones; the cost is more small candidates,
some of them not weeds, which only exhaustive labels can price. Do it on a held-out region
with exhaustive labels, before and after, with precision in hand. Do not touch the threshold
or the matching reach until then.
