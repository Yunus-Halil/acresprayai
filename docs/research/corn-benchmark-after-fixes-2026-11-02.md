# Corn emergence and establishment readers, benchmarked after the validation fixes (2026-11-02, night)

Only the two stages Yunus counts are benchmarked here: emergence (VE to V2, `veryearlystage`, 23 photographs) and
establishment (V2 to V7, `estabilishmentphase`, 15 photographs). Mid and late are left out at his request (their
readers are unchanged in the code).

Run on this machine (Ryzen 5 9600X, Node 24) at 46b8fe4, each stage on its own, twice
(`directtestimagery/benchmark-46b8fe4-run1` and `-run2`, gitignored). "Before" is the validation run at f1eb613,
before the fixes (`directtestimagery/validation-2026-11-02`). Photographs are 5280 × 3956 with EXIF stripped, so every
metre rests on the assumed 76.2 cm row spacing. There are no counted plants or drawn weeds for any of them: the counts
are the reader's, and the accuracy figures are Claude's eye on sampled crops, provisional, not field truth.

## Repeatability

Both runs gave the same result on every photograph, number for number. Time varied by 2 % or less on the totals.

## Emergence, 23 photographs

| Measure | Before | After |
|---|---|---|
| Errors | 0 | 0 |
| Rows | 659 | 659 |
| Row length | 12,409 m | 12,513 m |
| Plants counted | 70,362 | 70,501 |
| Possible seedlings (weak evidence on the row) | 1,720 | 2,032 |
| Missing plants the photo supports | 3,010 | 3,010 |
| Uncertain positions | 372 | 372 |
| Weed candidates (red) | 2,298 | 191 |
| Small green off the rows, counted apart (grey) | none | 2,082 |
| Gaps | 972 (456 m) | 1,011 (474 m) |
| Row coherence, median | 0.907 | 0.907 |
| Row spacing CV, median | 1.8 % | 1.8 % |
| Time a photograph, median (max) | 1.59 s (1.83 s) | 1.56 to 1.59 s (1.86 to 2.06 s) |
| Time, all 23 | 35.8 s | 36.0 to 36.6 s |

More gaps after the fixes is expected: the rows now run on into the dim corners, where more of the row is seen.

## Establishment, 15 photographs

| Measure | Before | After |
|---|---|---|
| Errors | 0 | 0 |
| Rows | 513 | 531 |
| Row length | 9,220 m | 9,338 m |
| Weed candidates | 64 | 20 |
| Gaps | 99 (53.9 m) | 56 (31.9 m) |
| Field ends inside the photo | 210 | 204 |
| Row coherence, median | 0.553 | 0.553 |
| Time a photograph, median (max) | 0.86 s (1.02 s) | 0.88 to 0.90 s (1.02 to 1.10 s) |
| Time, all 15 | 12.7 s | 12.9 to 13.3 s |

## Accuracy by eye, fresh sample (seed 777)

| Claim | Before | After |
|---|---|---|
| Emergence: plant on a row is a plant | 98 % | 100 % (46 of 46) |
| Emergence: possible seedling shows a plant | 83 % | 100 % (39 of 39) |
| Emergence: supported missing plant is empty | 100 % | 100 % (42 of 42) |
| Emergence: row ends where the row ends | 29 % | 77 % (10 of 13) |
| Emergence: red weed candidate is a weed | 24 % | 32 % (10 of 31) |
| Emergence: grey small green is not a weed | none | 96 % (24 of 25) |
| Establishment: row line on corn | 100 % | 100 % (44 of 44) |
| Establishment: weed candidate is a weed | 48 % | 73 % (11 of 15) |
| Establishment: gap has no corn | 77 % | 89 % (16 of 18) |
| Establishment: field end is where the field ends | 80 % | 81 % (13 of 16) |

## The field's edge: a higher bar (Yunus, the same night)

Looking at the pictures, Yunus: "all of the false ones are near the edge of the field ... the threshold to be a weed
is higher so little things like this do not get caught up". Built (`EMERGENCE.edgeZoneM` 1 m, `edgeFactor` 3): within a
metre of left-out verge or lawn, or of a row's end inside the photo (the headland), a patch must be three times the
stand's 90th-percentile seedling to be drawn red; smaller is counted apart in grey.

| Measure (emergence, 23 photographs) | Without | With the edge rule |
|---|---|---|
| Red weed candidates | 191 | 108 |
| Of the 11 decided verge or stubble red marks in the fresh sample | red | 10 grey, 1 red |
| Of the 10 decided real weeds | red | 6 red, 4 grey (all four at the verge, 70 to 130 cm², the stubble's size) |
| Of the 10 decided corn leaves near the row | red | 9 red, 1 grey |
| Red marks that are weeds, decided | 32 % | 38 % (6 of 16) |
| Time a photograph, median | 1.56 to 1.59 s | 1.62 s |

The trade is the one asked for: small green at the edge is no longer called a weed, real weeds there included (they
stay counted, in grey). What now dominates the red marks is the corn seedling's own leaves within 13 cm of the row.

## Straw is not green, and green touching the row is the crop (Yunus, the same night)

On the pictures with the edge rule, Yunus: straw at the headland still drawn red ("it obviously looks like straw ...
it's not even green") and patches touching the row line ("it is literally in the row ... it obviously is the crop").

Why straw passed: the seedling test judges each pixel against the soil right beside it, and pale straw with a few
grass blades is lighter and a little tinted against brown soil. Measured inside every audited off-row patch, the mean
G - R of its pixels: every real weed over 70 cm² above 0, the straw and stubble red marks below it.

Built (`EMERGENCE.minGreenOverRed` 0, `edgeMinGreenOverRed` 5, `edgeMinStrongShare` 0.6, `touchRowIsCrop`,
`touchRowFactor` 3): a patch with no more green than red is not a plant and is not counted; at the field's edge a red
mark must also be clearly green over most of its pixels; a patch any part of which lies within the row's 6 cm band is
the crop's own leaf, unless clearly green and over three times the stand's large seedlings.

| Measure (emergence, 23 photographs) | Edge rule only | With colour and row rules |
|---|---|---|
| Red weed candidates | 108 | 49 |
| Grey small green | 2,165 | 623 |
| Audited red marks, both samples, decided | 32 to 38 % weeds | 5 of 7 red marks are weeds |
| Of the 17 decided real weeds | 6 red, 4 grey, rest red or grey by size | 5 red, 6 grey, 6 not counted (4 tiny and not green, 2 touching the row) |
| Straw, stubble, soil marks (25 decided) | 1 red | 0 red |
| Time a photograph, median (max) | 1.62 s | 1.73 s (2.01 s) |

All 49 remaining red marks looked at on the photographs: about 40 are clearly leafy weeds in the middle of the alleys,
about 9 are small, faint marks that cannot be told; none sits in the straw, none touches a row.

## What is left, weakest first

1. Emergence: the price of the rules is recall. Weeds at the verge are grey, weeds touching the row are counted as the
   crop. About 9 of the 49 red marks are too small and faint to judge.
2. Emergence row ends: 3 of 13 still stop while seedlings go on.
3. Establishment field ends at the frame's right edge on photographs 70 to 72: 3 of 16 declared where the row runs on.
