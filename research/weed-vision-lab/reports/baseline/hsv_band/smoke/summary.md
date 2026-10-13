# Classical baseline `hsv_band` on `smoke`

10 images, 115 reference weed observations, 2623 detections. Generated 2026-10-13T20:55:59+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.006 | 0.148 | 0.012 | 0.008 | 0.016 | 260.6 | 9.8 | 150.2 | 57.9 |
| 0.3 | 0.008 | 0.174 | 0.015 | 0.010 | 0.018 | 260.3 | 9.5 | 150.2 | 57.9 |
| 0.1 | 0.019 | 0.444 | 0.037 | 0.025 | 0.047 | 257.2 | 6.4 | 150.2 | 57.7 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.167 (18) | 0.200 (10) | 0.278 (18) | 0.140 (43) | 0.000 (3) | 0.167 (6) | 0.000 (17) | 0.000 (18) | 0.045 (67) | 0.462 (26) | 0.500 (4) |
| 0.3 | 0.167 (18) | 0.400 (10) | 0.333 (18) | 0.140 (43) | 0.000 (3) | 0.167 (6) | 0.000 (17) | 0.000 (18) | 0.090 (67) | 0.462 (26) | 0.500 (4) |
| 0.1 | 0.444 (18) | 0.500 (10) | 0.556 (18) | 0.512 (43) | 0.000 (3) | 0.500 (6) | 0.176 (17) | 0.167 (18) | 0.358 (67) | 0.808 (26) | 0.750 (4) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 115 | 0.217 | 0.043 | 0.078 | 0.026 | 0.069 | 0.000 |
| A | 18 | 0.167 | 0.000 | 0.000 | 0.000 | 0.033 | 0.000 |
| B | 10 | 0.200 | 0.000 | 0.000 | 0.000 | 0.117 | 0.000 |
| C | 18 | 0.278 | 0.000 | 0.000 | 0.056 | 0.138 | 0.000 |
| D | 43 | 0.302 | 0.093 | 0.163 | 0.046 | 0.111 | 0.000 |
| partial | 3 | 0.333 | 0.000 | 0.333 | 0.000 | 0.005 | 0.002 |
| touches_border | 6 | 0.167 | 0.167 | 0.167 | 0.000 | 0.098 | 0.007 |
| tiny | 17 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| band tiny | 18 | 0.000 | 0.000 | 0.000 | 0.000 | 0.007 | 0.000 |
| band small | 67 | 0.119 | 0.015 | 0.060 | 0.030 | 0.030 | 0.000 |
| band medium | 26 | 0.538 | 0.077 | 0.115 | 0.038 | 0.207 | 0.063 |
| band large | 4 | 0.750 | 0.500 | 0.500 | 0.000 | 0.343 | 0.086 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.00, IoU 0.00 (n 13) | found 0.60, IoU 0.70 (n 5) | - |
| B | - | found 0.00, IoU 0.08 (n 7) | found 0.67, IoU 0.58 (n 3) | - |
| C | - | found 0.14, IoU 0.11 (n 14) | found 0.75, IoU 0.65 (n 4) | - |
| D | - | found 0.18, IoU 0.04 (n 28) | found 0.50, IoU 0.19 (n 12) | found 0.67, IoU 0.13 (n 3) |

Weed count error per image (detections minus reference weeds): mean 250.8, median abs 260.0, p90 abs 492.69999999999993. Detections per image median 271.0, p95 567.2499999999999, max 628; reference weeds per image median 11.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.774 (p10 0.148); pixel recall of plants 0.777; pixel precision 0.986.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 87.76, index_and_threshold_ms 54.33, components_ms 2.33, measure_ms 31.09.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 88.48 | 89.14 |
| index_and_threshold_ms | 54.92 | 55.67 |
| components_ms | 2.23 | 2.81 |
| measure_ms | 31.07 | 31.48 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00072_P0030852.png (12), 06-05_00111_P0037820.png (3), 05-15_00198_P0030949.png (2), 05-26_00058_P0034280.png (2)
- most background false positives: 06-05_00219_P0038053.png (447), 06-05_00090_P0037989.png (290), 06-05_00061_P0037989.png (258), 06-05_00111_P0037820.png (198)
- most crop false positives: 05-15_00198_P0030949.png (319), 05-15_00072_P0030852.png (68), 05-26_00058_P0034280.png (55), 06-05_00219_P0038053.png (43)
- most merged references: 06-05_00111_P0037820.png (4), 06-05_00090_P0037989.png (3), 06-05_00219_P0038053.png (2), 05-15_00039_P0030852.png (0)
