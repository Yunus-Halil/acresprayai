# Boundary engine benchmark: Apricot orchard, first test field (apricot-2021-04-27), 2026-10-28

71 photographs, 1040 reconciled trees, 14 kept rows; ground measured at 0.25 m (1049 × 522 cells, sampled in 6.2 s once, reused here). No orthomosaic anywhere in this pass.

## The inferred block

| | |
|---|---|
| Area | 1.361 ha ± 0.058 (34 vertices, 13 rows) |
| Confidence | 0.892 (high; length-weighted 20th percentile of the edges, mean 0.896) |
| Edge length by support | photographs 86.8 %, default 0.0 %, coverage 0.0 %, cap 0.0 %, bridged 13.2 % |
| Failure codes | `ADJACENT_CULTIVATED_BLOCK_DETECTED`, `FOREIGN_GROUND_INSIDE` |
| Ground inside by class | unseen 0.0 %, soil 79.0 %, canopy 20.4 %, cover 0.1 %, road 0.0 %, foreign 0.5 % |
| Image coverage | 2.797 ha by any photograph, 2.394 ha by two or more, 4.76 views on average |
| Stability (10 rule variants) | area 1.3565 to 1.3786 ha; vertices move 0.31 m (median), 4.5 m at most |
| Blocks of rows | 14 rows, 919 trees, score 0.971 (the field) |

## Acceptance targets (the brief's; measured where a reference exists)

| Metric | Target | Measured |
|---|---|---|
| Polygon IoU against a hand-drawn reference | ≥ 0.93 | no reference drawn yet: pass one with --reference |
| Mean boundary distance (both ways) | ≤ 1.0 m | no reference |
| 95th-percentile boundary error | ≤ 2.0 m | no reference |
| Area bias | < 3 % | no reference |
| Crop inclusion recall (the field's trees inside) | ≥ 98.5 % | 100.0 % of 903 trees the engine counts as the field's; 96.6 % of all 936 objects with a used row's id (29 standing in dense cover and 6 trimmed from row ends are judged not the field's: see the notes) ✓ |
| Included-object precision (trees inside that are the field's) | ≥ 99 % | 99.3 % (6 off-row trees inside: the second planting's trees that cross the rows' ends) ✓ |
| Neighbouring cultivated area included (ground inside classed cover, road or trees off the rows) | < 1 % | 0.6 % ✓ |
| Repeatability | identical polygon | two runs identical (ring, confidence, codes) ✓ |
| Boundary runtime, rows already reconstructed, CPU only | < 2 s here | inference 170 / 144 ms including the stability ensemble; classification 107 / 81 ms; the whole pass 277 / 225 ms ✓ |
| Works without an orthomosaic | must | ✓ (nothing here reads one) |

A reference boundary is the one thing not in this table: nobody has drawn one for this field. When one exists, `--reference file.geojson` fills the first four rows; the Field Twin's Adjust tool can draw it and the dev API (`window.__fieldTwin.boundary().corrected`) hands the ring back.

## Ablations: less confident before absurd

| Ablation | Area | Confidence | Boundary shift (mean / 95th / max) | Crop recall | New codes | Graceful |
|---|---|---|---|---|---|---|
| remove 10 % of the trees | 1.427 ha (+4.9 %) | 0.626 (medium, -0.266) | 1.58 / 6.13 / 6.13 m | 99.8 % | `SPARSE_OR_IRREGULAR_PLANTING` | yes |
| remove 25 % of the trees | 1.422 ha (+4.5 %) | 0.6 (medium, -0.292) | 2.22 / 6.14 / 20.3 m | 99.4 % | `SPARSE_OR_IRREGULAR_PLANTING` | yes |
| remove 40 % of the trees | 1.384 ha (+1.7 %) | 0.58 (medium, -0.312) | 2.76 / 7.32 / 20.31 m | 98.5 % | `SPARSE_OR_IRREGULAR_PLANTING` | yes |
| neighbouring block, 3 pitches away | 1.361 ha (+0.0 %) | 0.892 (high, +0.000) | 0 / 0 / 0 m | 100.0 % | none | yes |
| neighbouring block, 2 pitches away, a track between | 1.356 ha (-0.3 %) | 0.892 (high, +0.000) | 0.13 / 0.85 / 3.43 m | 100.0 % | none | yes |
| neighbouring block, 2 pitches away, nothing between | 1.653 ha (+21.5 %) | 0.514 (medium, -0.378) | 5.89 / 23.28 / 26.03 m | 99.9 % | `BOUNDARY_EXTENDS_BEYOND_IMAGE_COVERAGE` | yes |
| neighbouring block, 1 pitch away | 1.586 ha (+16.5 %) | 0.625 (medium, -0.267) | 4.73 / 18.6 / 24.73 m | 99.9 % | `BOUNDARY_EXTENDS_BEYOND_IMAGE_COVERAGE` | yes |
| hedge-like line of trees across the row ends | 1.361 ha (-0.0 %) | 0.892 (high, +0.000) | 0.03 / 0.15 / 0.66 m | 100.0 % | none | yes |
| plants removed near the row ends | 1.347 ha (-1.0 %) | 0.755 (high, -0.137) | 0.19 / 0.68 / 6.65 m | 100.0 % | none | yes |
| image coverage cut short | 1.306 ha (-4.0 %) | 0.728 (medium, -0.164) | 1.01 / 5.63 / 8.09 m | 98.4 % | `BOUNDARY_EXTENDS_BEYOND_IMAGE_COVERAGE`, `INSUFFICIENT_CROP_SUPPORT` | yes |
| tree positions jittered 10 cm | 1.356 ha (-0.4 %) | 0.888 (high, -0.004) | 0.14 / 0.41 / 0.49 m | 100.0 % | none | yes |

"Graceful" means: the area changed by at most 10 %, or the confidence fell by at least 0.05, or a failure code was raised. Boundary shift is from the ablated ring to the nominal one, sampled every 0.25 m.

### remove 10 % of the trees
What: every tree whose id hashes into the lowest tenth is dropped. Expected: the block holds within a few percent; confidence may fall.
- last-end margins: median 7.5 m, supports photographs
- codes: `ADJACENT_CULTIVATED_BLOCK_DETECTED`, `FOREIGN_GROUND_INSIDE`, `SPARSE_OR_IRREGULAR_PLANTING`; precision 99.5 %; 0.17 s

### remove 25 % of the trees
What: a quarter dropped the same way. Expected: the block holds; the ends rest on fewer trees.
- last-end margins: median 12.5 m, supports photographs/cap
- codes: `ADJACENT_CULTIVATED_BLOCK_DETECTED`, `FOREIGN_GROUND_INSIDE`, `SPARSE_OR_IRREGULAR_PLANTING`; precision 99.4 %; 0.16 s

### remove 40 % of the trees
What: two fifths dropped. Expected: SPARSE_OR_IRREGULAR_PLANTING; no catastrophic expansion.
- another block: 1 rows, 4 trees, score 0.41, separated by null
- last-end margins: median 12.8 m, supports photographs/cap
- codes: `ADJACENT_CULTIVATED_BLOCK_DETECTED`, `FOREIGN_GROUND_INSIDE`, `SPARSE_OR_IRREGULAR_PLANTING`; precision 99.6 %; 0.14 s

### neighbouring block, 3 pitches away
What: 4 rows of 32 trees at the pitch, beyond the last side, a gap of 3 pitches. Expected: another block, separated by a gap of rows; ADJACENT_CULTIVATED_BLOCK_DETECTED; not merged.
- another block: 4 rows, 80 trees, score 0.82, separated by gap
- 0 of 128 inserted trees inside the block
- last-end margins: median 6.5 m, supports photographs
- codes: `ADJACENT_CULTIVATED_BLOCK_DETECTED`, `FOREIGN_GROUND_INSIDE`; precision 99.3 %; 0.21 s

### neighbouring block, 2 pitches away, a track between
What: the same 4 rows 2 pitches away with a 3 m track painted between. Expected: another block, separated by the ground between; not merged.
- another block: 4 rows, 71 trees, score 0.82, separated by ground
- 0 of 128 inserted trees inside the block
- last-end margins: median 6.5 m, supports photographs
- codes: `ADJACENT_CULTIVATED_BLOCK_DETECTED`, `FOREIGN_GROUND_INSIDE`; precision 99.3 %; 0.22 s

### neighbouring block, 2 pitches away, nothing between
What: the same 4 rows 2 pitches away, the real ground between (the second planting's trees and its cover). Expected: whatever the photographs show between decides; reported either way.
- rows used 17 (nominal 13)
- 114 of 128 inserted trees inside the block
- last-end margins: median 4.5 m, supports photographs/cap/coverage
- codes: `BOUNDARY_EXTENDS_BEYOND_IMAGE_COVERAGE`, `ADJACENT_CULTIVATED_BLOCK_DETECTED`, `FOREIGN_GROUND_INSIDE`; precision 86.2 %; 0.28 s

### neighbouring block, 1 pitch away
What: the same 4 rows continuing the planting at its own pitch. Expected: indistinguishable from the field by geometry: merged, and said so here.
- rows used 17 (nominal 13)
- 114 of 128 inserted trees inside the block
- last-end margins: median 6.5 m, supports photographs/cap
- codes: `BOUNDARY_EXTENDS_BEYOND_IMAGE_COVERAGE`, `ADJACENT_CULTIVATED_BLOCK_DETECTED`, `FOREIGN_GROUND_INSIDE`; precision 86.5 %; 0.3 s

### hedge-like line of trees across the row ends
What: 21 trees off the rows every 3 m, 3 m beyond the last trees of the rows. Expected: the row ends stop at the hedge (foreign); none of its trees inside.
- 0 of 21 inserted trees inside the block
- last-end margins: median 6.3 m, supports photographs
- codes: `ADJACENT_CULTIVATED_BLOCK_DETECTED`, `FOREIGN_GROUND_INSIDE`; precision 99.3 %; 0.26 s

### plants removed near the row ends
What: the last 3 trees of every used row dropped (39 trees). Expected: the end edge must not collapse to the last tree: the probes reach the same edge in the photographs.
- last-end margins: median 14.7 m, supports cap/photographs
- codes: `ADJACENT_CULTIVATED_BLOCK_DETECTED`, `FOREIGN_GROUND_INSIDE`; precision 99.3 %; 0.24 s

### image coverage cut short
What: nothing seen beyond along 97 m (15 m before the last trees). Expected: coverage support at the ends, BOUNDARY_EXTENDS_BEYOND_IMAGE_COVERAGE, no vertex beyond the cut.
- last-end margins: median 0.0 m, supports coverage
- codes: `BOUNDARY_EXTENDS_BEYOND_IMAGE_COVERAGE`, `INSUFFICIENT_CROP_SUPPORT`, `ADJACENT_CULTIVATED_BLOCK_DETECTED`, `FOREIGN_GROUND_INSIDE`; precision 99.3 %; 0.24 s

### tree positions jittered 10 cm
What: every tree moved up to 10 cm along and across (deterministic). Expected: the boundary moves a few centimetres.
- last-end margins: median 6.8 m, supports photographs
- codes: `ADJACENT_CULTIVATED_BLOCK_DETECTED`, `FOREIGN_GROUND_INSIDE`; precision 99.3 %; 0.21 s
