# The final pre-field-test sprint on image1: stopped at the gate

2026-10-13. The sprint authorised one algorithm change (recovering small weeds lost to the
pass's component floor) on condition that exhaustively labelled regions existed first. They
do not. No detector change was made or tested. What was done is everything up to the gate.

## Phase 1: the benchmark made ready for exhaustive labelling

Two regions of DJI_0301.JPG, 1,200 x 900 native pixels each, chosen by the existing
labels and the first pass's miss kinds, not by the pipeline's output
(`regions-exhaustive.json`):

| region | box (native px) | existing labels | of which on fragments under the floor | under the threshold | content |
|---|---|---|---|---|---|
| image1-A | 3600, 2400 | 61 weed, 6 crop | 7 | 10 | two tree rows with long shadows, a weedy inter-row with large and small weeds, a clump |
| image1-B | 150, 150 | 35 weed, 4 crop | 11 | 3 | tree row, shadowed inter-row, many small weeds; 150 px in from the photo's edge so nothing is edge-cut |

Alignment: the existing labels drawn on both regions at native resolution sit on plants
(checked by eye); coordinates are the photo's native pixels throughout.

The duplicate (L473, an exact repeat of L472) is reported by the scorer and scored once;
the label file is untouched.

The labelling tool now loads a person's earlier labels into a region as a starting point
(their own clicks, never predictions, exact duplicates loaded once), and the export carries
the "every weed labelled" flag the scorer requires before computing precision.

## Phase 2: the baseline, locked

The unchanged detector on both regions, outputs in `baseline/` (predictions with measured
outlines, the region PNGs, the scores against the existing non-exhaustive labels):

| | image1-A | image1-B |
|---|---|---|
| components | 42 (25 measured, 12 refused, 5 crop) | 35 (18 measured, 13 refused, 4 crop) |
| fragments under the floor | 272 | 259 |
| weed candidates | 37 | 31 |
| existing weed labels found by a candidate | 28 of 61 (46%) | 14 of 35 (40%) |
| candidates touching no existing label | 9 | 17 |
| crop called weed | 0 of 6 | 0 of 4 |
| runtime, whole frame | pass 3.4 s; sizer per candidate on the two regions included in total | |

These recall figures are against non-exhaustive labels and are the pre-labelling baseline
only. Precision is not computed. Once the exhaustive labels exist, the same two commands
give the locked baseline with precision, and the experimental run is scored by the same
rule (25 px or the component's radius, one to one; unchanged).

## Phase 3 to 5: not run

No candidate-recovery approach was implemented. The approach that fits the architecture,
for the record: the pass already keeps its fragments per square metre; the simplest change
is to pass fragment positions inside the field, above a ground-area floor, to the sizer as
low-confidence candidates at native resolution, deduplicated against existing candidates by
the 40 cm rule the photo pass already uses, with "recovered fragment" as the disposition
and the sizer's confidence and refusal reasons unchanged. It is not built, because it
cannot be judged without precision.

## Phase 6: readiness

`docs/operations/field-testing-readiness.md`: the checklist and the three blockers (no
end-to-end browser run on a flown field; the Air 3S planner enum; projection accuracy
unverified).

## What to label, exactly

1. Open `scripts/annotate/annotate.html`.
2. Load `baseline/image1-A.png` as the region image and `baseline/image1-A.predictions.json`
   as the predictions file (for the box and pixel size; leave "show predictions" off).
3. Load `DJI_0301.labels.json` as "earlier labels": your 67 clicks in this region appear.
4. Check each, move or delete the wrong ones, add every weed still unlabelled, however small,
   including the ones in shadow; mark "in shadow" on those; use "uncertain" for anything you
   cannot call.
5. Tick "every weed labelled", put your initials in Annotator, export. Save as
   `evaluation/groundtruth/image1/labels/image1-A.labels.json`.
6. Repeat for image1-B.

Then one command scores the locked baseline with precision, and the sprint's one experiment
can be built and scored against the same files.
