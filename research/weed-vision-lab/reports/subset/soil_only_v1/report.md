# Dataset profile and soil-only subset `soil_only_v1`

PhenoBench v1.1.0, splits train + val, 2179 images, 12067 weed instances. Profiled 2026-10-13T18:30:29+00:00 in 57.8 s with 11 workers; lab weedlab-0.1.0. Pixel units at native 1024 x 1024; no physical size is implied anywhere in this report.

## Inventory

| | images | weed instances |
|---|---|---|
| train | 1407 | 8141 |
| val | 772 | 3926 |
| 2020-05-15 | 1012 | 4111 |
| 2020-05-26 | 566 | 3507 |
| 2020-06-05 | 601 | 4449 |
| images with no weeds | 81 | |

Quantiles are min / p05 / p25 / p50 / p75 / p95 / max.

| measure | quantiles |
|---|---|
| weeds_per_image | min 0 / p05 1 / p25 3 / p50 5 / p75 8 / p95 13 / max 29 |
| crops_per_image | min 1 / p05 4 / p25 7 / p50 8 / p75 10 / p95 13 / max 17 |
| area_px | min 1 / p05 46 / p25 145 / p50 358 / p75 876 / p95 3747 / max 144400 |
| max_span_px | min 0.0 / p05 11.402 / p25 22.847 / p50 39.459 / p75 64.07 / p95 130.863 / max 758.673 |
| obb_length_px | min 0.0 / p05 10.989 / p25 21.466 / p50 36.739 / p75 58.977 / p95 120.092 / max 692.0 |
| obb_width_px | min 0.0 / p05 4.642 / p25 11.191 / p50 22.0 / p75 39.503 / p95 86.174 / max 421.566 |
| dist_to_crop_px | min 1.0 / p05 1.0 / p25 15.556 / p50 74.632 / p75 158.256 / p95 316.512 / max 929.796 |
| dist_to_other_plant_px | min 1.0 / p05 1.0 / p25 7.0 / p50 48.01 / p75 108.853 / p95 128.0 / max 204.044 |
| ring_background | min 0.0 / p05 0.544 / p25 0.918 / p50 1.0 / p75 1.0 / p95 1.0 / max 1.0 |
| border_dist_px | min 0 / p05 0 / p25 29 / p50 115 / p75 225 / p95 370 / max 495 |

Weed instances touching another plant: 2493 (weed-weed touching pairs 279, weeds touching a crop 2100). Fragmented instances (two or more pieces, at least 5% of the area outside the largest): 1448.

## Size bands (area in pixels, half-open)

| band | range | n | fraction |
|---|---|---|---|
| tiny | [0, 100) | 2007 | 0.166 |
| small | [100, 1000) | 7362 | 0.610 |
| medium | [1000, 10000) | 2582 | 0.214 |
| large | [10000, inf) | 116 | 0.010 |

| date | tiny | small | medium | large |
|---|---|---|---|---|
| 2020-05-15 | 1131 | 2593 | 383 | 4 |
| 2020-05-26 | 580 | 2468 | 453 | 6 |
| 2020-06-05 | 296 | 2301 | 1746 | 106 |

Per plot: see stats.json `size_bands_by_plot`.

## Exclusions and categories (instance level)

Order of the rules: partial, border, tiny are excluded first; then D if any D rule fires; then A; then B; then C.

| group | n |
|---|---|
| excluded: partial | 954 |
| excluded: touches_border | 913 |
| excluded: tiny | 1510 |
| category A | 3428 |
| category B | 293 |
| category C | 1990 |
| category D | 2979 |
| category unassigned | 0 |

D reasons (an instance can have several): {'fragmented': 941, 'touching': 1969, 'low_background': 354, 'near_touching': 464, 'large_patch': 82}.
Tiny instances, had they not been excluded, would fall into: {'A': 986, 'C': 292, 'D': 176, 'B': 56}.

| category | tiny | small | medium | large |
|---|---|---|---|---|
| A | 0 | 2822 | 606 | 0 |
| B | 0 | 215 | 78 | 0 |
| C | 0 | 1508 | 482 | 0 |
| D | 0 | 1948 | 949 | 82 |

| category | 2020-05-15 | 2020-05-26 | 2020-06-05 |
|---|---|---|---|
| A | 1517 | 1122 | 789 |
| B | 124 | 60 | 109 |
| C | 465 | 637 | 888 |
| D | 555 | 792 | 1632 |

## Image level

A image: at least one A instance. B image: at least two instances in A or B. C and D images: at least one such instance.

| split | images | A | B | C | D |
|---|---|---|---|---|---|
| dev_tune | 717 | 501 | 330 | 372 | 424 |
| dev_check | 690 | 505 | 314 | 367 | 373 |
| holdout | 772 | 557 | 346 | 384 | 399 |
| all | 2179 | 1563 | 990 | 1123 | 1196 |

## Plot-aware splits

val = holdout (all plots). train plots sorted within each date and alternated tune, check, tune, ...

- dev_tune: 717 images, plots P0030688, P0030692, P0030853, P0030947, P0030950, P0034018, P0034117, P0034279, P0037818, P0037987, P0038053
- dev_check: 690 images, plots P0030690, P0030852, P0030855, P0030949, P0034020, P0034119, P0034280, P0037820, P0037989, P0038055
- holdout: 772 images, plots P0030686, P0030695, P0030792, P0030859, P0030943, P0030953, P0034016, P0034121, P0034282, P0037822, P0037991, P0038051

| split | A | B | C | D | unassigned |
|---|---|---|---|---|---|
| dev_tune | 1107 | 86 | 632 | 1032 | 0 |
| dev_check | 1137 | 81 | 698 | 982 | 0 |
| holdout | 1184 | 126 | 660 | 965 | 0 |

## Repeated observations (the same plant in overlapping frames)

A plant is a (plot, instance id) pair; overlapping frames repeat it with an identical mask. 12067 instance observations are 3654 unique plants (train 2485, val 1169), 3.3 frames per plant on average. Frames per plant: {1: 323, 2: 1009, 3: 190, 4: 1834, 5: 17, 6: 260, 7: 1, 8: 12, 9: 8}. Plants whose category differs between frames: 19.

| split | A plants | B plants | C plants | D plants |
|---|---|---|---|---|
| dev_tune | 396 | 32 | 215 | 356 |
| dev_check | 401 | 32 | 236 | 352 |
| holdout | 420 | 43 | 223 | 333 |

## Threshold sensitivity (instances in A, before any inspection)

- A_count_vs_dist_other_plant: 16: 3631, 24: 3531, 32: 3428, 48: 3221, 64: 2955, 96: 1984
- A_count_vs_ring_background: 0.5: 3428, 0.7: 3428, 0.8: 3428, 0.9: 3428, 0.95: 3428, 0.99: 3428
- primary_count_vs_min_area: 25: 4735, 50: 4513, 100: 3721, 200: 2840, 400: 1728

## Contact sheets

36 candidates and 20 rejected or ambiguous examples were chosen by the rule in build_soil_subset.select_for_sheets (train split only) and are listed in sheet_selection.json. Rendered by scripts/render_subset_sheets.py under the output directory.
