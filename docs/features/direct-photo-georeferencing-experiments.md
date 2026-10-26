# Direct photo georeferencing: experiments 1 to 3 (2026-10-26)

Follow-up to [direct-photo-georeferencing.md](direct-photo-georeferencing.md), approved by Yunus in this order. Same
71 apricot photographs (Phantom 4 RTK, 36 m, RTK fixed). Every number below comes from the scripts in
`scripts/directGeoref/`; the outputs sit in `data/direct-georef/apricot/exp1..3/` (gitignored), and the viewer
(`data/direct-georef/apricot/index.html`) shows all three.

New code in `src/lib/directGeoref/`:

- `fft.ts` does phase correlation.
- `soilTies.ts` finds soil-texture ties between photographs.
- `adjust.ts` is a light block adjustment over those ties. It holds global camera numbers, an optional terrain
  grid, and per-photo position and attitude corrections, each with a prior.
- The DJI reader now also returns the aircraft's velocity.

## How alignment is measured

- **A soil tie** is the same 2.5 m patch of bare soil found in two overlapping photographs by phase correlation. The
  matching runs coarse to fine: the whole overlap at 16 cm, then 2.5 m windows at 4 cm.
- **A window is kept only when it passes every check.** It must be under 5 % green in both photographs, so no plant
  relief. It must be textured, and not just parallel tyre tracks. It must have a single clear correlation peak, and
  it must correlate back to itself within 2 cm.
- **A tie is stored as a pixel-to-pixel correspondence**, so no camera model can bias it.
- **Yield.** The 71 photographs gave 14,917 ties in 505 of 635 overlapping pairs. Within one pair the ties scatter by
  3 to 5 cm. A tie is therefore a precise measurement, and a pair-wide offset is real misalignment.
- **The held-out test.** Every model is fitted on 70 % of the photo PAIRS. It is scored on the other 30 %, which no
  fit ever sees: 4,466 ties in 147 pairs. The score is how far apart the two photographs put the same soil.

## Experiment 1: cross-photo alignment

| Model (fitted on 70 % of pairs) | Parameters | Held-out median | p90 | Same heading | Opposite legs |
|---|---|---|---|---|---|
| Header only | 0 | 2.09 m | 3.46 m | 0.52 m | 2.84 m |
| 4 global numbers (tilt across, tilt along, spin, ground) | 4 | 0.50 m | 1.05 m | 0.38 m | 0.54 m |
| Global, shutter timing in place of tilt along | 4 | 0.50 m | 1.06 m | 0.38 m | 0.53 m |
| Global 5 (tilt along and timing) | 5 | 0.50 m | 1.05 m | 0.38 m | 0.53 m |
| Global + terrain grid (25 m, smooth) | 146 | 0.49 m | 1.03 m | 0.37 m | 0.54 m |
| Global + per-photo position, tight (5 cm, 0.2 deg yaw) | 217 | 0.44 m | 0.93 m | 0.35 m | 0.46 m |
| Global + per-photo position, loose (25 cm, 0.5 deg yaw) | 217 | 0.16 m | 0.42 m | 0.15 m | 0.15 m |
| Global + per-photo **attitude**, 0.25 deg prior | 359 | 0.33 m | 0.77 m | 0.28 m | 0.33 m |
| Global + per-photo **attitude**, 0.5 deg prior | 359 | 0.12 m | 0.29 m | 0.09 m | 0.12 m |
| **Global + per-photo attitude, 1 deg prior** | 359 | **0.07 m** | **0.17 m** | 0.05 m | 0.08 m |
| Global + per-photo attitude, 2 deg prior | 359 | 0.065 m | 0.15 m | | |

"Per-photo attitude" means yaw plus camera tilt across and along, with positions held at RTK quality (3 cm prior).

Findings:

- **The four global numbers, fitted on soil, agree with the green-patch calibration of v0.** Tilt across the image
  is 1.94 deg, along it -0.15 deg, spin -0.76 deg, and the ground sits 0.60 m above take-off. They take the
  held-out misalignment from 2.09 m to 0.50 m.
- **The along-track question.** Shutter timing (fitted at -30 ms) and a fixed pitch tilt (-0.15 deg) fit
  identically. On a flight at constant speed and height they are the same correction: a timing error scales with
  speed, a pitch error with height, and neither varies here. Telling them apart needs a flight at two speeds or two
  heights. Neither one removes the 0.23 m along-track residual on opposite legs; per-photo attitude does.
- **What is left is per-photo attitude error, not position and not terrain.** Inside one pair the ties agree to
  3-5 cm, but each pair as a whole is offset by 0.3 to 0.55 m, and the positions are RTK.
  - With per-photo attitude free (1 deg prior), the corrections come out at a median of 0.59 deg, 90th percentile
    1.26 deg.
  - They are correlated between consecutive photographs (lag-1 correlation 0.46 to 0.51): a slowly wandering
    gimbal, not random shake.
  - They are not correlated with the aircraft's roll or pitch (|r| < 0.2).
  - A small part depends on the heading: about 0.1 deg of along tilt and 0.17 deg of yaw differ between the NE and
    SW legs. That looks like a wind-dependent gimbal error; neither timing nor a fixed tilt behaves like it.
- **The per-photo corrections are modest and do not drift.** Camera positions move at most 3 mm. The mean
  correction is 0 by construction of the prior, so the block cannot wander off its RTK positions. Training and
  held-out errors match (0.068 against 0.072 m), and a looser 2 deg prior gains only 7 mm, so this is not
  overfitting.
- **Terrain is not the problem on this field.** A smooth 25 m terrain grid moved heights by -1.0 to +1.3 m and
  gained 1 cm. Per-photo position corrections help only when they are allowed to be large (25 cm), because they
  then imitate the attitude error at ground level.

Kept as the reference cameras for experiments 2 and 3: global 4 + per-photo attitude, 1 deg prior.

## Experiment 2: without RTK

Each scenario starts from the reference cameras and adds simulated GPS error to the 71 positions, plus a barometric
height wander of 0.2 m.

- **What a non-RTK pipeline would do.** It finds soil ties again from scratch under the noisy cameras: coarse to
  fine, so metre-scale offsets are caught. It then adjusts the global numbers, per-photo position (with a prior the
  size of the GPS error), height (0.3 m) and attitude (1 deg). Finally it finds ties again under that fit and
  adjusts once more.
- **What is measured.** The ground error on a 5 x 5 pixel grid in every photo, against the reference cameras, is
  split into the common offset of the whole block and what is left once that is removed.

| GPS error added | Ground error before | After | After, common offset removed | Common offset left (mean of injected error) | Held-out tie agreement after |
|---|---|---|---|---|---|
| None (RTK control) | 0.48 m | 0.01 m | 0.01 m | 0.00 m | 0.07 m |
| Random, 1 m per photo | 1.38 m | 0.21 m | 0.23 m | 0.18 m (0.26 m) | 0.06 m |
| Random, 3 m per photo | 3.21 m | 1.20 m | 0.93 m | 0.89 m (0.84 m) | 0.06 m |
| Common 2.5 m + random 0.5 m | 2.55 m | 2.35 m | 0.30 m | 2.39 m (2.46 m) | 0.06 m |
| Slow drift 2 m (over ~15 photos) + 1.4 m offset | 2.62 m | 1.94 m | 0.31 m | 1.97 m (1.96 m) | 0.06 m |

Repeats with other random draws (seeds 7 and 99), ground error after adjustment, median:

| GPS error added | Draw | After | After, common offset removed | Common offset left (injected mean) |
|---|---|---|---|---|
| Random 1 m | default | 0.21 m | 0.23 m | 0.18 m (0.26 m) |
| Random 1 m | seed 7 | 0.27 m | 0.29 m | 0.13 m (0.08 m) |
| Random 1 m | seed 99 | 0.41 m | 0.22 m | 0.34 m (0.25 m) |
| Random 3 m | default | 1.20 m | 0.93 m | 0.89 m (0.84 m) |
| Random 3 m | seed 7 | 0.49 m | 0.52 m | 0.17 m (0.27 m) |
| Random 3 m | seed 99 | 0.88 m | 0.80 m | 0.59 m (0.65 m) |

Re-running a draw reproduces it exactly. The spread between draws is real, so the ranges below are the result,
not any one row.

Findings:

- **The photographs always come back into agreement with each other.** Held-out ties land at 6 cm in every
  scenario, as with RTK. Tie finding survived 3 m of random error: the coarse level caught the offsets, and the
  second pass found 15,602 ties against 16,063 with RTK.
- **The common offset is untouched.** The block ends up off by almost exactly the mean of the injected GPS error,
  as expected: ties only see relative positions. Removing it needs one external reference:
  - one surveyed or RTK-measured ground mark;
  - a previous survey of the same field;
  - or registering the block to a basemap, which is only as good as the basemap.
- **Relative accuracy follows the GPS's random error.** Random 1 m per photo leaves 0.22 to 0.29 m of distortion
  across the field; random 3 m leaves 0.52 to 0.93 m. The ties fix photo-to-photo error but cannot fix the block's large-scale shape, which
  is pinned only by the average of many noisy positions. Correlated drift and a common offset both reduce to
  0.30 m of relative error. A drift slower than the ties' reach would stay as a smooth bend, and this flight is too
  small to show one.
- **A photograph displaced more than about 10 m is not recovered.** One such photo in the default 3 m draw was 9.7 m
  off and stayed 9.9 m off. The coarse correlation reaches about +-10 m, so this photo never tied to its neighbours.
  A wider coarse search, or flagging photos that tie to nothing, would catch it.
- **Practical reading for cheap drones.** A consumer GPS (1 to 3 m) plus the overlap gives a map that is internally
  consistent to centimetres: every photograph, weed patch and tree agrees with its neighbours. It is a fraction of
  a metre from the truth in shape, and off by the GPS's mean error as a whole. Spot spraying from the same flight
  needs the internal consistency. Returning to the same spot later with a different GPS needs the absolute fix.

## Experiment 3: the app's detectors on every photograph

The detectors are app code, unchanged: the chain `scripts/bench/layoutTrial.ts --propose` already runs on a
stand-in map.

- ExGR vegetation, shadow and cover masks.
- The tree-row reader (`fieldRowsFromPixels`).
- Its three-plant seed (`proposeFromRows`).
- The planting layout Yunus accepted on this field (`fitLayoutAll`, `mergeLayouts`, `layoutsToFieldRows`).

Each photograph is read in its own pixels at quarter size (3.9 cm). Crowns and row lines are projected with the
reference cameras. Crowns seen in several photographs are matched, triangulated and clustered into one tree each;
row lines are grouped into field rows.

| | |
|---|---|
| Photographs read by the detectors | 49 of 71 |
| Tree crowns found (all photographs) | 3,822 |
| Trees reconciled from 2+ photographs | 751 (median 4 photographs, up to 14) |
| Crowns seen in only one photograph | 602 |
| Ray miss between two views of a tree | median 0.066 m, p90 0.30 m |
| One view's distance to its tree, projected to the soil | median 0.46 m, p90 0.83 m |
| The same, projected at the tree's own triangulated height | **median 0.08 m**, p90 0.29 m |
| Pair triangulations of one tree, spread | median 0.07 m |
| Tree height above the ground plane | median 1.04 m (p10 0.56, p90 1.44) |
| Crown radius, variation across views | median 6 % |
| Field rows | 17, of which 14 seen in 2+ photographs (median 20) |
| One field row across photographs: across-row spread | median 0.22 m, angle 0.8 deg |
| Spacing between field rows | 4.91 m (detector per photo: 5.03 m; plants along a row 3.14 m) |
| **DJI_0301 hand labels vs trees reconciled from the OTHER photographs only** | **96 of 104 within 0.6 m, 102 within 1.0 m**, median 0.25 m |

Findings:

- **The same tree seen from several photographs reconciles into one object.**
  - Projected to the soil, each view of a tree sits 0.46 m from the others: the tree is about 1 m tall, and each
    camera sees it from a different side.
  - Placed at its triangulated height, every view lands within 8 cm.
  - The crown sizes agree to 6 %.
  - The rows agree to about 0.2 m across the field.
- **An independent check: the hand labels.** DJI_0301's labelled trees are found by trees built only from OTHER
  photographs: 96 of 104 within 0.6 m. That equals the single-photo layout's own result on that frame (96 to 97 of
  104), which means projection and reconciliation lose nothing. Labels mark trunks and rings mark crown centres; the
  earlier audit put the two within 1.2 m for 97 of 104.
- **The row reader is the weak link per photograph.** It found no rows in 22 of 71 photographs.
  - Some are photographs where half the frame is the neighbouring wheat (DJI_0357): the same wheat-edge problem as
    on the orthomosaic.
  - Others are plain orchard views where the reader still failed (DJI_0337, not diagnosed yet).
  - In a shared map this is recoverable: the rows and trees found in the 49 photographs that read are already in
    map coordinates and cover the photographs that did not.
- **Not run:** the RF-DETR / ERFNet weed models. They need the research service running on the GPU; the ExGR
  patches stand in as the vegetation detector here.

## What this means

- **On an RTK drone the pipeline needs no orthomosaic.** Photographs agree with each other to 7 cm (held out), and
  trees reconcile across views to 8 cm with a height each.
  - Cost: two passes of soil ties (about 20 s each for 71 photographs) and an adjustment of a few seconds.
- **On a cheap drone the same overlap gives internal consistency.** The relative error left is about a fifth to a
  third of the GPS's random error. The absolute position is still the GPS's average error until one external reference is
  added.

## Next, not built (each needs a go-ahead)

- Find out why the row reader fails on clean orchard photographs like DJI_0337. Then fill rows into failed
  photographs from the shared map.
- Remove the common offset with one reference, comparing a basemap registration against one RTK-measured ground
  mark.
- A two-speed or two-height flight, to separate shutter timing from pitch.
- Run the weed models per photograph and reconcile their detections the way the trees are reconciled here.
- Bring the viewer into the app.
