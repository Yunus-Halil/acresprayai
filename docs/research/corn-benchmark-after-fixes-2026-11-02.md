# Corn stage readers benchmarked after the validation fixes (2026-11-02, night)

All four readers re-run on every photograph Yunus gave (91 photographs, 5280 × 3956, EXIF stripped, so every metre
rests on the assumed 76.2 cm row spacing) on this machine (Ryzen 5 9600X, Node 24), one stage at a time. "Before" is
the validation run at f1eb613 (`directtestimagery/validation-2026-11-02/<stage>/per-photo.csv`); "after" is the code
of 0562003 plus the one fix below (`directtestimagery/benchmark-0562003/`). Both folders are gitignored. Accuracy by eye
on sampled crops is in [../features/corn-row-reader.md](../features/corn-row-reader.md); there are still no counted
plants, so nothing here is accuracy against field truth.

## A regression the benchmark caught, and fixed

At 0562003 mid photograph 17 read no rows at all (24 before): the rule that keeps the lens's black corners out of the
green took the corners' row signal on a frame whose rows run on the diagonal, and the pitch was lost. The rule came from
an establishment finding, so it now applies at establishment only (mid already leaves patches cut by the frame
unjudged). Photograph 17 reads its 24 rows again; 16 (two plantings) reads 8 short rows, 6 before.

## Results

| Stage | Photos | Errors | Rows | Time a photo, median (max) | What changed in the counts |
|---|---|---|---|---|---|
| Emergence | 23 | 0 | 632, unchanged | 1.59 s to 1.61 s (1.83 to 1.88) | Plants 67,228 to 67,360; possible 1,659 to 1,964 (the rows followed to the frame); weed candidates 2,230 to 188, with 2,017 small green counted apart; gaps 928 to 965 (the longer rows hold more); row length +100 m; coherence and row-spacing CV unchanged |
| Establishment | 15 | 0 | 513 to 531 | 0.86 s to 0.88 s (1.02 to 0.95) | Weed candidates 64 to 20; gaps 99 (53.9 m) to 56 (31.9 m); field ends 210 to 204; row length +118 m |
| Mid | 40 | 0 | 970 to 979 | 4.33 s to 4.82 s (5.24 to 5.26) | Seedling layer 91,793 to 42,190; weeds 705 unchanged; escapes 3 unchanged; 1 and 2 still read no rows, as before |
| Late | 13 | 0 | 239 to 296 | 4.29 s to 1.02 s (4.74 to 1.07) | Its own reader now: row length 1,363 to 5,241 m; nothing judged between the rows (weeds 1 to 0, seedling layer 967 to 0, no plant count) |

Mid is 11 % slower (the leaf-piece test grows the corn through looser leaf at the photo's own pixel). Late is four
times faster: it no longer runs the mid seedling pass, which has nothing to find under a closed canopy.

Late rows changed by three or more on 8 of 13 photographs (for example 38: 9 to 25, 68: 7 to 23, 10: 21 to 17), the
expected effect of reading the canopy's green instead of a 0/1 mask; by eye the lines follow the leaf bands with shaded
alleys between. No per-point check is possible under a closed canopy.

## Accuracy by eye on a fresh sample (seed 777), for reference

| Claim | Before | After |
|---|---|---|
| Emergence red weed candidate is a weed | 24 % | 32 % |
| Emergence row end is where the row ends | 29 % | 77 % |
| Establishment weed candidate is a weed | 48 % | 73 % |
| Establishment gap has no corn | 77 % | 89 % |
| Mid seedling mark is a seedling | 14 % | 15 % |

Still open, weakest first: emergence red candidates (verge stubble and the crop's own leaves), the mid seedling layer,
late rows unverifiable per point.
