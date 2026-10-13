# Classical baseline `exg_fixed_t0.08` on `dev_tune`

717 images, 4121 reference weed observations, 1288563 detections. Generated 2026-10-13T21:02:31+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.001 | 0.414 | 0.003 | 0.001 | 0.003 | 1794.78 | 3.37 | 1771.84 | 10.5 |
| 0.3 | 0.002 | 0.576 | 0.004 | 0.002 | 0.004 | 1793.85 | 2.44 | 1771.81 | 10.48 |
| 0.1 | 0.002 | 0.736 | 0.005 | 0.002 | 0.005 | 1792.93 | 1.52 | 1771.8 | 10.39 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1288563 | 0.001 | 0.414 | 0.003 | 0.001 | 0.003 | 0.5608 | 1771.84 | 10.5 |
| 4 | 159130 | 0.011 | 0.414 | 0.021 | 0.011 | 0.022 | 0.5608 | 204.92 | 8.67 |
| 10 | 47335 | 0.036 | 0.414 | 0.066 | 0.041 | 0.075 | 0.5608 | 50.75 | 8.42 |
| 25 | 17121 | 0.098 | 0.409 | 0.159 | 0.149 | 0.219 | 0.5608 | 10.19 | 8.15 |
| 50 | 10634 | 0.151 | 0.391 | 0.218 | 0.311 | 0.346 | 0.5608 | 2.8 | 7.61 |
| 100 | 7510 | 0.181 | 0.330 | 0.234 | 0.500 | 0.397 | 0.5323 | 0.62 | 6.68 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.559 (1107) | 0.581 (86) | 0.589 (632) | 0.125 (1032) | 0.408 (343) | 0.495 (309) | 0.399 (612) | 0.380 (776) | 0.396 (2463) | 0.485 (851) | 0.774 (31) |
| 0.3 | 0.704 (1107) | 0.663 (86) | 0.769 (632) | 0.267 (1032) | 0.563 (343) | 0.637 (309) | 0.629 (612) | 0.607 (776) | 0.553 (2463) | 0.604 (851) | 0.806 (31) |
| 0.1 | 0.892 (1107) | 0.884 (86) | 0.911 (632) | 0.430 (1032) | 0.685 (343) | 0.773 (309) | 0.778 (612) | 0.754 (776) | 0.730 (2463) | 0.732 (851) | 0.871 (31) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4121 | 0.650 | 0.110 | 0.178 | 0.052 | 0.394 | 0.004 |
| A | 1107 | 0.596 | 0.000 | 0.000 | 0.041 | 0.533 | 0.087 |
| B | 86 | 0.616 | 0.000 | 0.000 | 0.140 | 0.644 | 0.048 |
| C | 632 | 0.668 | 0.008 | 0.016 | 0.036 | 0.564 | 0.135 |
| D | 1032 | 0.714 | 0.339 | 0.540 | 0.068 | 0.058 | 0.001 |
| partial | 343 | 0.671 | 0.117 | 0.201 | 0.067 | 0.383 | 0.000 |
| touches_border | 309 | 0.712 | 0.091 | 0.194 | 0.071 | 0.493 | 0.033 |
| tiny | 612 | 0.580 | 0.052 | 0.064 | 0.034 | 0.413 | 0.007 |
| band tiny | 776 | 0.586 | 0.058 | 0.079 | 0.032 | 0.405 | 0.000 |
| band small | 2463 | 0.601 | 0.094 | 0.152 | 0.054 | 0.380 | 0.004 |
| band medium | 851 | 0.840 | 0.203 | 0.338 | 0.067 | 0.452 | 0.012 |
| band large | 31 | 0.903 | 0.161 | 0.387 | 0.000 | 0.749 | 0.076 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.57, IoU 0.51 (n 933) | found 0.75, IoU 0.74 (n 174) | - |
| B | - | found 0.60, IoU 0.58 (n 60) | found 0.65, IoU 0.73 (n 26) | - |
| C | - | found 0.60, IoU 0.49 (n 492) | found 0.91, IoU 0.74 (n 140) | - |
| D | - | found 0.62, IoU 0.03 (n 655) | found 0.87, IoU 0.12 (n 359) | found 0.94, IoU 0.78 (n 18) |

Weed count error per image (detections minus reference weeds): mean 1791.41, median abs 1761.0, p90 abs 2686.6. Detections per image median 1767.0, p95 2951.2, max 3896; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.795 (p10 0.636); pixel recall of plants 0.967; pixel precision 0.821.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 52.29, index_and_threshold_ms 13.02, components_ms 2.46, measure_ms 36.8.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 53.14 | 63.75 |
| index_and_threshold_ms | 13.28 | 15.28 |
| components_ms | 2.5 | 3.27 |
| measure_ms | 35.93 | 43.68 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00051_P0030950.png (6), 05-15_00072_P0030950.png (6), 05-15_00279_P0030688.png (6), 05-15_00176_P0030688.png (5)
- most background false positives: 05-15_00282_P0030688.png (3860), 05-15_00261_P0030688.png (3699), 05-15_00240_P0030688.png (3571), 05-15_00281_P0030688.png (3560)
- most crop false positives: 06-05_00158_P0038053.png (32), 06-05_00137_P0038053.png (31), 06-05_00136_P0038053.png (29), 06-05_00157_P0038053.png (24)
- most merged references: 06-05_00096_P0037987.png (8), 06-05_00198_P0038053.png (7), 06-05_00200_P0038053.png (7), 06-05_00220_P0038053.png (7)
