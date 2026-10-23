# Corn (Zea mays) crop profile

**Status:** experimental, version 1.0.0. The profile is wired into the engine and benchmarked. It is not validated:
vegetation segmentation and between-row cover at 2 cm miss their acceptance criteria (`10_validation/validation.json`),
and no independent corn field with row truth exists yet.

## What it knows (reference knowledge, 01 to 07)

- **Planting.** 30 in (76.2 cm) rows on about 86% of US and Canadian acres; 36 to 38 in in the South, 20 to 22 in in
  the north, 15 in rare, twin rows under 1%. Europe 70 to 80 cm, Turkey 70 cm, Brazil 45 to 50 cm, Malawi 75 to 92 cm
  (measured), China 60 to 65 cm. In-row spacing 10 to 27 cm. Skips 5 to 18%, doubles 2 to 11% of spacings. Guess rows
  5 to 15 cm off between planter passes. No-till on 36% of US corn (2021).
- **Growth.** The leaf-collar system, VE to R6, each stage with its GDD window (three tables that disagree, kept as
  ranges) and day windows. Closure about V10 in 30 in rows. Critical period by nitrogen rate (V1 to V11 down to V6 to
  V9). The stage is estimated from the planting date, never observed; the calendar is often off by one to three leaves.
- **Morphology.** Leaves in one plane, so from above a plant is a line of leaves, not a disc. A V3 plant covers 24 to
  230 cm². It is 25 to 230 px at 1 cm a pixel and 1 to 9 px at 5 cm. Neighbours touch along the row from about V4 to
  V5. Counting is published down to 1.5 cm a pixel; nothing counts corn at 3 to 5 cm.
- **Visual.** ExG with Otsu is the least stable index over a day and calls straw green. ExGR at zero separates straw
  (-0.14) and soil (-0.24) from leaves. There are 21 failure conditions, each with whether the image can reveal it and
  the uncertainty code it raises.
- **Weeds.** Ranked lists for eight regions (WSSA 2020 survey, Georgia, Virginia, Northeast, Plains, Turkey, Germany),
  with emergence windows by corn stage. Nine disambiguation rules, each with its limits. The first rule is position
  before appearance; the last is never a species name from the map.
- **Imagery.** The pixel size each analysis needs: rows 5 cm, cover between rows 3 cm, single weeds 2.5 cm, weed size
  1 cm, stand count 1.5 cm. Altitude for each camera. Count and measure in the original frames, not the mosaic
  (R² 0.906 against 0.616).

## What the engine does with it (08 to 09)

| Setting | Value | Why |
|---|---|---|
| Planted spacings searched beside the crop-neutral ones | 38, 51, 70, 76, 91 cm | Every corn spacing from 23 cm to 1.46 m within the fit's 60 to 160% band |
| Green gate | ExGR above 0 | Bright straw passes ExG and Otsu; it does not pass ExGR |
| Pitch rule | Only a measured pitch, never a candidate's | A dark-soil scene read straw stripes through a candidate's band |
| Prior-and-evidence rule | A fit under the 0.35 bar stands if its pitch is planted and its green coherence is at least 0.5 | A 4 m photo of five rows gives the autocorrelation too little to measure confidently |
| Brightness check | Rows found from brightness are re-placed on the green when it is in step | No-till straw stripes are bright |
| Cover classes | 1, 5, 10, 20%, marked provisional | US guidance acts on weed height (10 cm) and stage (by V4), not cover |
| Grade window | V1 to V9 | The alley closes about V10 |
| Corn rows on the field map | The map pattern pass with this profile, read at 3 cm, band 15 cm each side | At 5.7 cm the thin leaves became mixed pixels and the rows fell onto the straw |
| Map grade and hotspots | Experimental, only on rows the operator confirmed on the map | A wrong spacing is a wrong grade; no real corn map has been graded yet |

Every capability, its status, its pixel limit and its stage window are in `08_algorithms/algorithms.json`. The code and
message for every condition are in `09_uncertainty/uncertainty.json`.

## What testing showed (10)

These results come from running `npm run bench:crop-profile`; see `10_validation/results/*.md` for the tables.

- **Rendered stands** (60 held-out scenes, run once after the last change). Correct rows rise from 0.78 without the
  profile to 0.90 with it, and wrong rows fall from 0.22 to 0.08. With straw stripes, correct rows rise from 0.56 to
  0.80. No scene went from correct to wrong. These scenes are synthetic: they test geometry and known failures, not
  field accuracy.
- **Three real early-corn photos** (development data, no labels). Rows are found on all three. Without the profile they are
  found on two, one of them on the straw. On the red-soil no-till photo the row lines move from the straw onto the corn: the share of
  green on the lines, against mid-alley, goes from 0.39 to 12.
- **WeedsGalore** (one German maize field, 26 held-out patches, the authors' labels). With rows taken from the maize
  labels:
  - between-row weed cover error falls from 0.37 to 0.014 at 0.25 cm and from 0.15 to 0.02 at 1 cm;
  - it is 0.031 against 0.013 without the profile at 2 cm, because the gate drops mixed edge pixels;
  - the 30 cm row band holds 95 to 97% of the maize;
  - a third of the weed area sits inside the band and is out of reach, as expected.
- **Stage estimate.** The authors' V1 falls inside the estimated range. The ranges are wide (VE to V9 at 28 days).

## Known weaknesses

- No corn field with row-line truth or hand-measured weeds. The rows' real-field accuracy is unknown beyond three photos.
- Vegetation IoU on the WeedsGalore band composites is 0.41 against a target of 0.70. The composites are not a
  consumer camera, which limits what this says about our imagery.
- The calendar stage estimate is wide; no daily weather is read, so there is no GDD estimate.
- Purple (cold or phosphorus) seedlings fall below the ExGR gate at V2 to V5 and read as skips.
- Weeds inside the row, grass weeds and volunteer corn are not separable from the crop at 1 cm or coarser.
- The map grade and hotspots are experimental: they run on confirmed rows, but only on stand-in maps so far. Stand
  count is unsupported.
