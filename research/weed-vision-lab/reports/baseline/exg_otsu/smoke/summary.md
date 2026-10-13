# Classical baseline `exg_otsu` on `smoke`

10 images, 115 reference weed observations, 6009 detections. Generated 2026-10-13T20:55:51+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.002 | 0.122 | 0.005 | 0.002 | 0.005 | 599.5 | 10.1 | 534.8 | 28.8 |
| 0.3 | 0.003 | 0.148 | 0.006 | 0.003 | 0.006 | 599.2 | 9.8 | 534.8 | 28.8 |
| 0.1 | 0.005 | 0.243 | 0.009 | 0.005 | 0.010 | 598.1 | 8.7 | 534.8 | 28.6 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.167 (18) | 0.200 (10) | 0.167 (18) | 0.116 (43) | 0.000 (3) | 0.167 (6) | 0.000 (17) | 0.000 (18) | 0.045 (67) | 0.346 (26) | 0.500 (4) |
| 0.3 | 0.167 (18) | 0.200 (10) | 0.278 (18) | 0.140 (43) | 0.000 (3) | 0.167 (6) | 0.000 (17) | 0.000 (18) | 0.060 (67) | 0.423 (26) | 0.500 (4) |
| 0.1 | 0.167 (18) | 0.300 (10) | 0.500 (18) | 0.256 (43) | 0.000 (3) | 0.167 (6) | 0.059 (17) | 0.056 (18) | 0.164 (67) | 0.538 (26) | 0.500 (4) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 115 | 0.565 | 0.409 | 0.452 | 0.000 | 0.005 | 0.000 |
| A | 18 | 0.667 | 0.500 | 0.500 | 0.000 | 0.002 | 0.000 |
| B | 10 | 0.600 | 0.400 | 0.400 | 0.000 | 0.008 | 0.000 |
| C | 18 | 0.222 | 0.056 | 0.056 | 0.000 | 0.126 | 0.004 |
| D | 43 | 0.651 | 0.442 | 0.535 | 0.000 | 0.007 | 0.000 |
| partial | 3 | 0.667 | 0.667 | 0.667 | 0.000 | 0.000 | 0.000 |
| touches_border | 6 | 0.667 | 0.500 | 0.667 | 0.000 | 0.007 | 0.000 |
| tiny | 17 | 0.529 | 0.529 | 0.529 | 0.000 | 0.000 | 0.000 |
| band tiny | 18 | 0.556 | 0.556 | 0.556 | 0.000 | 0.000 | 0.000 |
| band small | 67 | 0.448 | 0.358 | 0.403 | 0.000 | 0.002 | 0.000 |
| band medium | 26 | 0.808 | 0.385 | 0.462 | 0.000 | 0.153 | 0.002 |
| band large | 4 | 1.000 | 0.750 | 0.750 | 0.000 | 0.311 | 0.028 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.54, IoU 0.00 (n 13) | found 1.00, IoU 0.68 (n 5) | - |
| B | - | found 0.43, IoU 0.00 (n 7) | found 1.00, IoU 0.72 (n 3) | - |
| C | - | found 0.14, IoU 0.07 (n 14) | found 0.50, IoU 0.57 (n 4) | - |
| D | - | found 0.54, IoU 0.00 (n 28) | found 0.83, IoU 0.13 (n 12) | found 1.00, IoU 0.07 (n 3) |

Weed count error per image (detections minus reference weeds): mean 589.4, median abs 402.0, p90 abs 1360.5. Detections per image median 405.0, p95 1438.6499999999999, max 1503; reference weeds per image median 11.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.792 (p10 0.002); pixel recall of plants 0.950; pixel precision 0.949.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 51.49, index_and_threshold_ms 17.78, components_ms 2.8, measure_ms 30.91.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 52.36 | 58.8 |
| index_and_threshold_ms | 16.84 | 17.42 |
| components_ms | 2.51 | 4.84 |
| measure_ms | 32.84 | 37.15 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00072_P0030852.png (12), 06-05_00111_P0037820.png (3), 05-15_00198_P0030949.png (2), 05-26_00058_P0034280.png (2)
- most background false positives: 06-05_00219_P0038053.png (1342), 05-15_00198_P0030949.png (1231), 06-05_00090_P0037989.png (725), 06-05_00111_P0037820.png (672)
- most crop false positives: 05-15_00198_P0030949.png (86), 05-26_00058_P0034280.png (61), 06-05_00111_P0037820.png (45), 06-05_00219_P0038053.png (28)
- most merged references: 05-15_00072_P0030852.png (29), 05-15_00179_P0030688.png (9), 06-05_00111_P0037820.png (4), 06-05_00219_P0038053.png (4)
