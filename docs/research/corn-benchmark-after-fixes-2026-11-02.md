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

## What is left, weakest first

1. Emergence red weed candidates: 21 of 31 decided were wrong, 11 verge or headland stubble and 10 the corn seedling's
   own leaves within 13 cm of the row. Position along the row does not separate them (weeds stand beside corn too).
2. Emergence row ends: 3 of 13 still stop while seedlings go on.
3. Establishment field ends at the frame's right edge on photographs 70 to 72: 3 of 16 declared where the row runs on.
