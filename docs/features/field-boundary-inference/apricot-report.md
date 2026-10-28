# Cultivated-block boundary: Apricot orchard, first test field (apricot-2021-04-27)

Inferred 2026-10-28 from 13 rows and the photographs; no boundary was drawn by hand.

| | |
|---|---|
| Method | rows and photographs |
| Polygon | 34 vertices (after simplification at 0.3 m) |
| Area | 1.361 ha, plausible range 1.303 to 1.419 ha |
| Extent | 221.5 m along the rows, 69.1 m across |
| Rows used | 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 |
| Rows excluded | 1 (outer row off the pitch: 5.92 m from row 2 against a 4.9 m pitch; the photographs show a hedge, another planting or a track along 94 % of its line) |
| Row pitch, plant spacing | 4.90 m, 3.14 m |
| End-of-row margin beyond the last tree | median 3.9 m (0.0 to 18.0) |
| Side margin beyond the outer rows | median 3.0 m (1.3 to 6.8) |
| Vertices by support | photographs 82 %, bridged 18 %, cap 0 %, coverage 0 %, default 0 % |
| What stopped the probes | foreign 14, cover 14 |
| Trees on the rows inside / outside / in cover / trimmed from row ends | 903 / 0 / 29 / 6 |
| Trees off the rows outside | 102 |
| Ground inside by class | unseen 0 %, soil 79 %, canopy 20 %, cover 0 %, road 0 %, foreign 1 % |
| Row-aligned baseline (half-spacing margins) | 1.304 ha |
| Concave baseline (closing of the on-row trees) | 1.130 ha, overlap 83 % |
| Confidence | 0.892 overall (length-weighted 20th percentile of the edges; mean 0.896): high |
| Edge length by support | photographs 87 %, default 0 %, coverage 0 %, cap 0 %, bridged 13 % |
| Image coverage | 2.797 ha seen by any photograph, 2.394 ha by two or more, 4.8 views on average |
| Stability (10 variants of the rules) | area 1.357 to 1.379 ha; vertices move 0.31 m (median), 4.50 m at most |
| Blocks of rows | 14 rows, 919 trees, score 0.97 (the field) |
| Trees off the rows inside | 6 |
| Fill of the used rows | 100 % of the positions at the plant spacing |
| Processing | sampling 6.2 s (71 photographs), classification 138 ms, inference 179 ms (including the stability ensemble) |
| Evidence raster | 1049 x 522 cells at 0.25 m; in the bundle 525 x 261 at 0.5 m, 28 KB |

## Failure cases

- `ADJACENT_CULTIVATED_BLOCK_DETECTED`: 102 trees off the field's rows stand outside the boundary: a hedge or another planting borders the block and is not included
- `FOREIGN_GROUND_INSIDE`: 6 trees off the field's rows stand inside the boundary: part of a hedge or another planting may be included

Notes: 
- 20 side probes met no edge; the edge most of that side met is taken to continue through (bridged, last side)
- 29 trees on the field's rows stand in dense cover in the photographs (wheat, a hedge): not used, and the rows' ends were taken from the trees before them
- row 2: 1 tree at its start lie beyond a gap of 15 m and off the row's line: not taken as the row's end (another planting's trees crossing it)
- row 14: 5 trees at its start lie beyond a gap of 16 m and off the row's line: not taken as the row's end (another planting's trees crossing it)
- 102 trees off the field's rows stand outside the boundary: a hedge or another planting borders the block and is not included
- 6 trees off the field's rows stand inside the boundary: part of a hedge or another planting may be included
- row 1 excluded: outer row off the pitch: 5.92 m from row 2 against a 4.9 m pitch; the photographs show a hedge, another planting or a track along 94 % of its line
- the concave baseline of the trees overlaps the boundary by only 83 %

## Polygon (latitude, longitude)

1. 33.8837392, -5.41877506 (photographs: foreign, margin 13.75 m, ± 0.5 m, confidence 0.855)
2. 33.88425514, -5.41932587 (photographs: cover, margin 3 m, ± 0.5 m, confidence 0.928)
3. 33.88468226, -5.41977296 (photographs: cover, margin 3 m, ± 0.5 m, confidence 0.929)
4. 33.88509381, -5.420193 (photographs: cover, margin 6.5 m, ± 0.5 m, confidence 0.861)
5. 33.88497007, -5.4203273 (photographs: cover, margin 3.75 m, ± 0.5 m, confidence 0.946)
6. 33.88484322, -5.42047417 (photographs: cover, margin 6.75 m, ± 0.5 m, confidence 0.912)
7. 33.88480725, -5.42050681 (photographs: cover, margin 6.75 m, ± 0.5 m, confidence 0.912)
8. 33.88471828, -5.42055419 (photographs: cover, margin 4 m, ± 0.5 m, confidence 0.954)
9. 33.88473657, -5.42064516 (photographs: cover, margin 18 m, ± 0.5 m, confidence 0.907)
10. 33.88470684, -5.42072127 (photographs: cover, margin 1.25 m, ± 0.5 m, confidence 0.884)
11. 33.88457085, -5.42057893 (photographs: cover, margin 2.75 m, ± 0.5 m, confidence 0.891)
12. 33.88455255, -5.4205526 (bridged, margin 2.25 m, ± 5.1 m, confidence 0.773)
13. 33.88442503, -5.42041913 (bridged, margin 2.25 m, ± 5.1 m, confidence 0.807)
14. 33.88439789, -5.42040505 (photographs: foreign, margin 3.25 m, ± 0.5 m, confidence 0.909)
15. 33.88436128, -5.42035239 (photographs: foreign, margin 2.25 m, ± 0.5 m, confidence 0.921)
16. 33.88406375, -5.42004095 (photographs: foreign, margin 2.25 m, ± 0.5 m, confidence 0.944)
17. 33.8840425, -5.42001871 (bridged, margin 2.25 m, ± 5.1 m, confidence 0.766)
18. 33.88389374, -5.41986299 (bridged, margin 2.25 m, ± 5.1 m, confidence 0.739)
19. 33.88387838, -5.41983257 (photographs: foreign, margin 1.25 m, ± 0.5 m, confidence 0.891)
20. 33.88362335, -5.41956563 (photographs: foreign, margin 1.25 m, ± 0.5 m, confidence 0.924)
21. 33.88359621, -5.41955155 (bridged, margin 2.25 m, ± 5.1 m, confidence 0.799)
22. 33.8835112, -5.41946257 (bridged, margin 2.25 m, ± 5.1 m, confidence 0.731)
23. 33.88346344, -5.41947708 (photographs: foreign, margin 6.75 m, ± 0.5 m, confidence 0.783)
24. 33.8834224, -5.41943055 (photographs: foreign, margin 6.5 m, ± 0.5 m, confidence 0.811)
25. 33.88341294, -5.41939196 (photographs: foreign, margin 4.5 m, ± 0.5 m, confidence 0.869)
26. 33.88339316, -5.41936768 (photographs: foreign, margin 4.25 m, ± 0.5 m, confidence 0.878)
27. 33.8833778, -5.41933726 (photographs: foreign, margin 3.25 m, ± 0.5 m, confidence 0.906)
28. 33.8832053, -5.4191567 (photographs: foreign, margin 3.5 m, ± 0.5 m, confidence 0.907)
29. 33.88325699, -5.4190964 (photographs: cover, margin 3.5 m, ± 0.5 m, confidence 0.955)
30. 33.88332686, -5.41902751 (photographs: foreign, margin 0.25 m, ± 0.5 m, confidence 0.978)
31. 33.88337552, -5.41900814 (photographs: foreign, margin 0 m, ± 0.5 m, confidence 0.988)
32. 33.8833997, -5.41896316 (photographs: cover, margin 1.5 m, ± 0.5 m, confidence 0.99)
33. 33.88354821, -5.41883896 (photographs: cover, margin 3.5 m, ± 0.5 m, confidence 0.956)
34. 33.88361734, -5.41877147 (photographs: cover, margin 4.5 m, ± 0.5 m, confidence 0.939)
