# Classical baseline `hsv_band` on `dev_tune`

717 images, 4121 reference weed observations, 158746 detections. Generated 2026-10-13T21:00:23+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.003 | 0.108 | 0.005 | 0.004 | 0.008 | 220.78 | 5.13 | 133.07 | 69.96 |
| 0.3 | 0.005 | 0.196 | 0.010 | 0.007 | 0.014 | 220.28 | 4.62 | 133.06 | 69.93 |
| 0.1 | 0.010 | 0.389 | 0.020 | 0.015 | 0.028 | 219.17 | 3.51 | 133.06 | 69.87 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 158746 | 0.003 | 0.108 | 0.005 | 0.004 | 0.008 | 0.1006 | 133.07 | 69.96 |
| 4 | 37338 | 0.012 | 0.108 | 0.021 | 0.033 | 0.050 | 0.1006 | 9.52 | 33.21 |
| 10 | 23526 | 0.019 | 0.108 | 0.032 | 0.077 | 0.090 | 0.1006 | 1.36 | 24.81 |
| 25 | 16832 | 0.026 | 0.106 | 0.042 | 0.134 | 0.118 | 0.1006 | 0.15 | 18.93 |
| 50 | 13566 | 0.031 | 0.103 | 0.048 | 0.188 | 0.133 | 0.1006 | 0.04 | 15.79 |
| 100 | 11274 | 0.036 | 0.100 | 0.053 | 0.275 | 0.146 | 0.1006 | 0.02 | 13.64 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.100 (1107) | 0.105 (86) | 0.187 (632) | 0.083 (1032) | 0.140 (343) | 0.201 (309) | 0.016 (612) | 0.031 (776) | 0.061 (2463) | 0.294 (851) | 0.645 (31) |
| 0.3 | 0.177 (1107) | 0.198 (86) | 0.286 (632) | 0.172 (1032) | 0.283 (343) | 0.311 (309) | 0.069 (612) | 0.089 (776) | 0.143 (2463) | 0.427 (851) | 0.677 (31) |
| 0.1 | 0.345 (1107) | 0.442 (86) | 0.464 (632) | 0.372 (1032) | 0.484 (343) | 0.518 (309) | 0.292 (612) | 0.303 (776) | 0.316 (2463) | 0.666 (851) | 0.677 (31) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4121 | 0.199 | 0.025 | 0.074 | 0.020 | 0.032 | 0.000 |
| A | 1107 | 0.106 | 0.000 | 0.000 | 0.010 | 0.028 | 0.000 |
| B | 86 | 0.105 | 0.000 | 0.000 | 0.023 | 0.049 | 0.000 |
| C | 632 | 0.190 | 0.000 | 0.000 | 0.000 | 0.064 | 0.000 |
| D | 1032 | 0.340 | 0.073 | 0.220 | 0.035 | 0.025 | 0.000 |
| partial | 343 | 0.268 | 0.047 | 0.111 | 0.050 | 0.062 | 0.000 |
| touches_border | 309 | 0.330 | 0.039 | 0.117 | 0.016 | 0.114 | 0.000 |
| tiny | 612 | 0.049 | 0.003 | 0.010 | 0.018 | 0.011 | 0.000 |
| band tiny | 776 | 0.073 | 0.009 | 0.021 | 0.015 | 0.003 | 0.000 |
| band small | 2463 | 0.125 | 0.014 | 0.055 | 0.018 | 0.014 | 0.000 |
| band medium | 851 | 0.508 | 0.069 | 0.176 | 0.031 | 0.223 | 0.010 |
| band large | 31 | 0.774 | 0.161 | 0.194 | 0.000 | 0.735 | 0.067 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.06, IoU 0.01 (n 933) | found 0.37, IoU 0.27 (n 174) | - |
| B | - | found 0.07, IoU 0.02 (n 60) | found 0.19, IoU 0.11 (n 26) | - |
| C | - | found 0.09, IoU 0.03 (n 492) | found 0.56, IoU 0.54 (n 140) | - |
| D | - | found 0.22, IoU 0.01 (n 655) | found 0.54, IoU 0.15 (n 359) | found 0.83, IoU 0.72 (n 18) |

Weed count error per image (detections minus reference weeds): mean 215.66, median abs 198.0, p90 abs 410.0. Detections per image median 202.0, p95 484.1999999999996, max 637; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.744 (p10 0.453); pixel recall of plants 0.749; pixel precision 0.990.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 93.51, index_and_threshold_ms 58.57, components_ms 2.45, measure_ms 32.49.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 87.64 | 90.85 |
| index_and_threshold_ms | 55.17 | 56.7 |
| components_ms | 2.12 | 2.38 |
| measure_ms | 30.34 | 31.45 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00193_P0030688.png (8), 05-15_00279_P0030688.png (8), 05-26_00197_P0034018.png (8), 05-15_00051_P0030950.png (7)
- most background false positives: 06-05_00160_P0038053.png (551), 06-05_00174_P0038053.png (540), 06-05_00241_P0038053.png (529), 06-05_00244_P0038053.png (524)
- most crop false positives: 05-15_00222_P0030853.png (283), 05-15_00139_P0030853.png (278), 05-15_00201_P0030853.png (278), 05-15_00181_P0030853.png (275)
- most merged references: 06-05_00046_P0037818.png (5), 06-05_00060_P0037987.png (5), 06-05_00096_P0037987.png (5), 06-05_00179_P0038053.png (5)
