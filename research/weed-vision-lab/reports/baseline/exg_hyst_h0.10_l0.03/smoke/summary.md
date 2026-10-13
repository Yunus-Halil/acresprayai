# Classical baseline `exg_hyst_h0.10_l0.03` on `smoke`

10 images, 115 reference weed observations, 8600 detections. Generated 2026-10-13T21:33:43+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.006 | 0.417 | 0.011 | 0.006 | 0.011 | 855.2 | 6.7 | 843.8 | 5.5 |
| 0.3 | 0.007 | 0.556 | 0.015 | 0.007 | 0.015 | 853.6 | 5.1 | 843.5 | 5.5 |
| 0.1 | 0.009 | 0.704 | 0.019 | 0.009 | 0.019 | 851.9 | 3.4 | 842.9 | 5.5 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 8600 | 0.006 | 0.417 | 0.011 | 0.006 | 0.011 | 0.6786 | 843.8 | 5.5 |
| 4 | 3405 | 0.014 | 0.417 | 0.027 | 0.014 | 0.028 | 0.6786 | 324.6 | 5.5 |
| 10 | 1598 | 0.030 | 0.417 | 0.056 | 0.031 | 0.058 | 0.6786 | 144.3 | 5.4 |
| 25 | 500 | 0.096 | 0.417 | 0.156 | 0.108 | 0.171 | 0.6786 | 35.0 | 5.4 |
| 50 | 242 | 0.194 | 0.409 | 0.263 | 0.247 | 0.308 | 0.6786 | 10.1 | 5.2 |
| 100 | 144 | 0.299 | 0.374 | 0.332 | 0.453 | 0.409 | 0.6429 | 2.3 | 4.9 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.667 (18) | 0.700 (10) | 0.833 (18) | 0.163 (43) | 0.667 (3) | 0.167 (6) | 0.235 (17) | 0.278 (18) | 0.388 (67) | 0.538 (26) | 0.750 (4) |
| 0.3 | 0.778 (18) | 0.900 (10) | 0.889 (18) | 0.233 (43) | 0.667 (3) | 0.667 (6) | 0.529 (17) | 0.556 (18) | 0.507 (67) | 0.654 (26) | 0.750 (4) |
| 0.1 | 0.944 (18) | 1.000 (10) | 0.944 (18) | 0.395 (43) | 0.667 (3) | 0.833 (6) | 0.765 (17) | 0.778 (18) | 0.642 (67) | 0.808 (26) | 0.750 (4) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 115 | 0.765 | 0.261 | 0.235 | 0.148 | 0.383 | 0.002 |
| A | 18 | 0.667 | 0.000 | 0.000 | 0.222 | 0.580 | 0.206 |
| B | 10 | 0.700 | 0.000 | 0.000 | 0.200 | 0.639 | 0.347 |
| C | 18 | 0.889 | 0.056 | 0.056 | 0.056 | 0.626 | 0.360 |
| D | 43 | 0.837 | 0.581 | 0.512 | 0.116 | 0.063 | 0.001 |
| partial | 3 | 1.000 | 0.333 | 0.333 | 0.000 | 0.598 | 0.121 |
| touches_border | 6 | 0.667 | 0.333 | 0.333 | 0.500 | 0.377 | 0.156 |
| tiny | 17 | 0.588 | 0.059 | 0.059 | 0.118 | 0.306 | 0.000 |
| band tiny | 18 | 0.611 | 0.056 | 0.056 | 0.111 | 0.345 | 0.000 |
| band small | 67 | 0.746 | 0.284 | 0.254 | 0.179 | 0.266 | 0.001 |
| band medium | 26 | 0.885 | 0.308 | 0.269 | 0.115 | 0.575 | 0.108 |
| band large | 4 | 1.000 | 0.500 | 0.500 | 0.000 | 0.634 | 0.199 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.62, IoU 0.57 (n 13) | found 0.80, IoU 0.69 (n 5) | - |
| B | - | found 0.57, IoU 0.59 (n 7) | found 1.00, IoU 0.69 (n 3) | - |
| C | - | found 0.86, IoU 0.61 (n 14) | found 1.00, IoU 0.67 (n 4) | - |
| D | - | found 0.79, IoU 0.01 (n 28) | found 0.92, IoU 0.22 (n 12) | found 1.00, IoU 0.75 (n 3) |

Weed count error per image (detections minus reference weeds): mean 848.5, median abs 822.0, p90 abs 1552.1. Detections per image median 829.5, p95 1660.6499999999999, max 1761; reference weeds per image median 11.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.767 (p10 0.185); pixel recall of plants 0.990; pixel precision 0.773.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 55.82, index_and_threshold_ms 17.8, components_ms 2.48, measure_ms 35.53.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 51.86 | 55.37 |
| index_and_threshold_ms | 16.5 | 18.57 |
| components_ms | 2.41 | 3.29 |
| measure_ms | 32.99 | 34.23 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00072_P0030852.png (6), 05-15_00179_P0030688.png (1), 06-05_00061_P0037989.png (1), 06-05_00111_P0037820.png (1)
- most background false positives: 05-15_00227_P0030688.png (1756), 05-15_00179_P0030688.png (1525), 05-15_00198_P0030949.png (1137), 05-15_00072_P0030852.png (1064)
- most crop false positives: 05-26_00058_P0034280.png (12), 05-15_00198_P0030949.png (9), 05-15_00179_P0030688.png (7), 05-15_00072_P0030852.png (6)
- most merged references: 06-05_00219_P0038053.png (11), 05-15_00072_P0030852.png (7), 05-15_00198_P0030949.png (6), 06-05_00090_P0037989.png (6)
