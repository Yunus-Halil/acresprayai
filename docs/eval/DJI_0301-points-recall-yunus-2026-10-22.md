# DJI_0301: recall of labelled weed points (2026-10-22)

**What this measures, and what it does not.** Recall of labelled weed points only: of the weeds a person marked, how many the grade saw, and where the rest went. There is no precision (nothing here says how many of the grade's weeds are real), no cover error (the labels have no size, and none was invented), and no act / don't act verdict. The labels are not a complete census of the frame's weeds, and that does not affect these numbers: every label is a real weed, and an unlabelled weed cannot be a miss; it can only go uncounted.

Inputs: the 301 weed points of `evaluation/groundtruth/image1/DJI_0301.labels-2026-10-22.json` (113 other labels ignored), placed on the trial's stand-in map of DJI_0301 with the trial's own transform (photo pixel times 0.6390 onto zoom 23, north-up, flat ground, EXIF pixel size); the frame's fitted planting layout (`layout-rows.json`, 108 crowns); the saved RF-DETR results of 2026-10-19 (`window-cache-layout.json`, 503 weed objects, the crop painted out before the model ran); Stage 1 and the grade as the app runs them (0.5 m cells, grade pressure-v1, no parameter changed). Of the objects the grade counted 355, set 63 under its floor and 85 aside on a crop row. A label is "seen" when a counted object's centre is within 0.25 m.

The label file (exported 2026-10-22T14:02:49.036Z) is marked "every weed labelled". Recall does not depend on whether that is so; precision would, and it is not computed here.

## Where the labelled weeds went

| Class | Labels | Share | Meaning |
|---|---|---|---|
| seen | 170 | 56.5% | a counted object within 0.25 m (any tier) |
| below-floor | 5 | 1.7% | the nearest object within the radius was set apart under the detection floor |
| in-band | 25 | 8.3% | inside the ground the grade cuts away (row band, or a crown and its margin) |
| not-assessed | 2 | 0.7% | in a cell the grade did not judge, or outside its grid |
| missed | 99 | 32.9% | an assessed cell and no object within 0.25 m |
| total | 301 | 100% | |

Not assessed, by reason:

| Reason | Labels |
|---|---|
| too little ground | 2 |

## The cells of the seen labels

The class the grade gave the cell each seen label stands in (judged over the 2.5 m treatment unit):

| Class | Seen labels |
|---|---|
| low | 128 |
| moderate | 24 |
| action | 10 |
| not assessed | 8 |

Of the seen labels, 85 stand in confirmed cells and 77 in possible ones; 21 are in cells near the crop.

## The row band and the floor

In-band plus below-floor: 30 of 301 labels, 10.0%. Under the 30% bar. The widths, for the record:

- Row band half-width: 0.50 m each side of a row line.
- Crown cut: a confirmed or operator crown at its painted radius plus 0.3 m (typical confirmed crown radius 1.07 m, so about 1.37 m from the trunk); an expected crown at half the typical radius, 0.53 m, with no margin.
- Detection floor: 4 pixels, 12.4 cm at this map's 3.1 cm a pixel.

Every label with its class is in `DJI_0301-points-recall-yunus-2026-10-22.csv` beside this report: id, photo pixel, position, class, reason, distance to the nearest counted and below-floor object, cell, the cell's class, tier and near-crop flag.
