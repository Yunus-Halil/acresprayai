# Open-row weed detection: the audit, the benchmark, and what is still unknown

2026-10-13. The reference the founder used was the vineyard photo (DJI_0002) in run 3 of the
measurement demo. The question: which weeds does Swardus detect, which does it miss, which
crop does it call a weed, and why. This document is the audit, the benchmark that lets a
person answer the question with labels, and the honest state of the numbers.

How it finds weeds is a trade secret. This document is for the team and never for the site.

## The baseline audit (no labels: what the trace and the eye say)

Seven regions were cut from three photos (`scripts/bench/evalRegions.json`) and the trace of
612ab71 run over each (`npm run eval:regions`). The counts, then what the eye adds:

| region | conditions | components | measured | refused | crop | uncertain | fragments |
|---|---|---|---|---|---|---|---|
| vine-centre | isolated, large, touching the row, bright soil | 24 | 15 | 3 | 6 | 0 | 424 |
| vine-right | small, near a row, sparse, shadow | 11 | 7 | 1 | 3 | 0 | 254 |
| vine-bottom-left | many small, touching, dense | 40 | 26 | 6 | 8 | 0 | 212 |
| vine-top-right | sparse, headland | 69 | 2 | 5 | 1 | 61 | 1,760 |
| orchard-centre | isolated, small, shadows, under the crop | 42 | 18 | 16 | 7 | 0 | 527 |
| orchard-track | touching, large, wheel track, dark soil | 34 | 20 | 6 | 4 | 0 | 52 |
| orchard-sparse | sparse, small, shadows | 11 | 3 | 1 | 5 | 0 | 163 |

What is working, by eye against the diagnostic cuts:

- Isolated weeds in the inter-row at 8 cm and over are found, outlined on their leaves, and
  measured; large clumps (40 to 60 cm) are outlined whole.
- Touching weeds along the wheel track come apart or are reported as touching, never as one
  plant with one diameter.
- Trees and vine rows are crop and are never measured as weeds.
- The headland and the field edge are "uncertain: no trusted rows", visibly grey, not silently
  dropped.

What is failing, with the mechanism:

1. **Weeds that touch a crop row are the crop.** The mask joins a weed hugging a vine row or a
   tree skirt to the row's component; the row is "on pattern", so the weed is crop. The
   vine-centre and vine-right cuts show a weedy fringe along every row with no candidate on
   it. This is the largest source of misses in the vineyard and it is a classification
   limit of the mask, not a segmentation miss: the pixels are green and accounted as crop.
2. **Weeds under about 6 cm are fragments.** The pass reads the photo at a 4,096 px long edge
   (2.2 cm/px here), where its component floor (6 px) is about 6 cm; smaller weeds are counted
   per square metre as coverage and never become candidates. The vine-top-right region alone
   holds 1,760 of them. The sizer reads at native, but only where the pass gave it a
   candidate. This is a scale limit of the decode budget, stated, not a bug.
3. **Candidates of 6 to 7 px at native are refused** for confidence under 0.3 (resolution
   term): 16 of 34 candidates in orchard-centre. They are real small weeds; their number
   would carry 25 to 35% error from edge pixels alone. They are preserved as refused with the
   reason and shown in the diagnostic view; whether to show a low-confidence number instead
   is a product decision the labels should inform.
4. **Shade.** Weeds in a tree's shadow are darker and the chromaticity index holds up on most,
   but the cyan "just under the threshold" tint in the orchard cuts sits mostly on shaded
   leaves: some shaded canopy is under-segmented. Unquantified without labels.
5. **Row-adjacent classification.** On a continuous vine row the on-row tolerance is a quarter
   of the row spacing (1.1 m here), so a weed within that of the row line and not touching it
   is "on pattern" with no seed fit to say otherwise: crop. The orchard, with a seed fit,
   catches these as "between plants".

Not failing but worth knowing: the 15 cm linkage never chains; the boundary strip is a
strip; the large clump in vine-centre is one component whose single diameter stands for a
clump the sizer saw as one plant with no neck.

## The benchmark

`scripts/bench/evalRegions.json` names seven regions by photo, native pixel box and the
conditions they show. `npm run eval:regions` writes to `data/bench/eval/` for each: the
region at native resolution with nothing drawn (what a person labels), the same with every
component in the colour of its disposition, and a predictions file with every component's
pixel, size, disposition, reason, measured size and the photo, box and pixel size. The
pipeline's own output is never a label.

**Labelling.** Open `scripts/annotate/annotate.html` in a browser, load a region PNG and its
predictions JSON (for the photo, the box and the pixel size), click each plant's centre and
give it a class: weed, crop, or uncertain (what the imagery cannot settle); mark shade and a
diameter in cm when known. Predictions can be shown faintly for context and are never
pre-filled. Export writes `<region>.labels.json` with the photo, the region, the pixel size,
the annotator, and each label's native pixel, region pixel and time. Put the exports in
`data/bench/eval/labels/`.

**Scoring.** `npm run eval:detections` matches labels to predictions one to one, nearest
first, within the larger of 25 px and the prediction's own radius, so one large prediction
never counts as several weeds (`sizing/detectionEval.ts`). It reports, per region and
together: how many weed labels any component found (segmentation), and of those how many a
weed candidate found (classification): precision, recall, F1, false candidates, weeds lost
to each disposition, crop labels a candidate landed on, candidates on uncertain plants,
recall by size, by distance to the row and by shade, and the diameter error where labels
carry one. Under twenty weed labels the verdict says the rates establish nothing.

## The first annotated frame (2026-10-13)

`evaluation/groundtruth/image1/`: DJI_0301.JPG labelled by a person, 414 weed and 104 crop
points over the whole frame, no diameters, masks or rows, not declared exhaustive. Recall
of the labelled weeds 53% (221 of 414 found by a candidate; 223 by any component);
precision unsupported. The misses: 63 under the pass's component floor at the decode
scale, 43 under the vegetation threshold, 81 with a component 25 to 60 px away. Crop called
weed 5 of 104, weed called crop 1 of 414. Report and reproduction commands in
`evaluation/groundtruth/image1/results/report.md`. The scorer now takes an `exhaustive`
flag (set by the labelling tool) and computes precision only when it is set; whole-image
label files are split over the regions of their photo.

## The numbers

**None.** No independently verified labels exist for any region. The seven regions are
exported and the tool and the scorer are built and tested on synthetic cases; the first
labelled region will give the first number. Detection precision, recall, crop-to-weed
confusion and measurement error for open-row weeds are therefore unverified, and nothing in
this document or the app claims otherwise.

## Changes made in this sprint, each tied to an observed failure

- **The map's three views** (`VegetationLayer` modes, `WeedScoutTab`): the default clean view
  shows vegetation highlights, plants, clusters and zones with numbers on hover only;
  measurement shows the canopy outlines with size, box and confidence on hover and keeps the
  selected spot's label; diagnostic adds the refused spots (dashed magenta, reason on hover)
  and keeps the uncertain vegetation grey. Observed failure: the permanent labels and large
  numbers hid the imagery; refused spots were invisible outside the closer look.
- **The demo's crop outlines** were indexed against a filtered list and drew the wrong tree's
  outline on the wrong tree in the diagnostic image. Fixed.
- **No detection threshold was changed.** Failures 1 to 3 are each a stated limit with a
  candidate remedy whose cost in false positives cannot be measured without labels; tuning
  them now would be fitting to screenshots.

## Regression

`detectionEval.test.ts` (matching, the report, the verdict), `vegetationLayer.test.ts` (the
modes), and the fixtures of `vegetationTrace.test.ts` (isolated, touching, strip, edge,
crop-row merger, fragments, boundary) and `weedSizing.test.ts` (refusals, uncertain).
Saved-run compatibility: `sizeValidation.test.ts`. Large counts: `vegetationStructure.test.ts`.

## Remaining limitations

Crop/weed confusion where a weed touches or sits within a quarter spacing of a continuous
row; weeds under the pass's component floor at the decode scale; candidates at 6 to 7 px
refused; shaded canopy under-segmented; every number above unverified against the ground.
