# Classical baseline `exg_exr` on `smoke`

10 images, 115 reference weed observations, 7057 detections. Generated 2026-10-13T20:54:50+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.002 | 0.122 | 0.004 | 0.002 | 0.004 | 704.3 | 10.1 | 624.0 | 23.4 |
| 0.3 | 0.003 | 0.165 | 0.005 | 0.003 | 0.005 | 703.8 | 9.6 | 624.0 | 23.4 |
| 0.1 | 0.007 | 0.426 | 0.014 | 0.007 | 0.014 | 700.8 | 6.6 | 624.0 | 23.3 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.167 (18) | 0.200 (10) | 0.167 (18) | 0.116 (43) | 0.000 (3) | 0.167 (6) | 0.000 (17) | 0.000 (18) | 0.030 (67) | 0.385 (26) | 0.500 (4) |
| 0.3 | 0.167 (18) | 0.300 (10) | 0.222 (18) | 0.163 (43) | 0.000 (3) | 0.167 (6) | 0.059 (17) | 0.056 (18) | 0.060 (67) | 0.462 (26) | 0.500 (4) |
| 0.1 | 0.333 (18) | 0.400 (10) | 0.500 (18) | 0.535 (43) | 0.333 (3) | 0.333 (6) | 0.235 (17) | 0.278 (18) | 0.313 (67) | 0.769 (26) | 0.750 (4) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 115 | 0.200 | 0.043 | 0.087 | 0.026 | 0.071 | 0.000 |
| A | 18 | 0.167 | 0.000 | 0.000 | 0.000 | 0.055 | 0.000 |
| B | 10 | 0.200 | 0.000 | 0.000 | 0.000 | 0.096 | 0.000 |
| C | 18 | 0.167 | 0.000 | 0.000 | 0.056 | 0.124 | 0.000 |
| D | 43 | 0.302 | 0.093 | 0.186 | 0.046 | 0.107 | 0.000 |
| partial | 3 | 0.333 | 0.000 | 0.333 | 0.000 | 0.002 | 0.000 |
| touches_border | 6 | 0.167 | 0.167 | 0.167 | 0.000 | 0.053 | 0.018 |
| tiny | 17 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| band tiny | 18 | 0.000 | 0.000 | 0.000 | 0.000 | 0.005 | 0.000 |
| band small | 67 | 0.119 | 0.015 | 0.075 | 0.030 | 0.030 | 0.000 |
| band medium | 26 | 0.462 | 0.077 | 0.115 | 0.038 | 0.235 | 0.046 |
| band large | 4 | 0.750 | 0.500 | 0.500 | 0.000 | 0.355 | 0.093 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.00, IoU 0.01 (n 13) | found 0.60, IoU 0.66 (n 5) | - |
| B | - | found 0.00, IoU 0.09 (n 7) | found 0.67, IoU 0.70 (n 3) | - |
| C | - | found 0.07, IoU 0.09 (n 14) | found 0.50, IoU 0.57 (n 4) | - |
| D | - | found 0.21, IoU 0.02 (n 28) | found 0.42, IoU 0.19 (n 12) | found 0.67, IoU 0.16 (n 3) |

Weed count error per image (detections minus reference weeds): mean 694.2, median abs 696.0, p90 abs 1160.6. Detections per image median 713.5, p95 1170.3, max 1173; reference weeds per image median 11.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.844 (p10 0.099); pixel recall of plants 0.862; pixel precision 0.973.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 70.59, index_and_threshold_ms 24.28, components_ms 4.04, measure_ms 42.26.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 52.31 | 59.27 |
| index_and_threshold_ms | 14.79 | 17.5 |
| components_ms | 2.89 | 3.26 |
| measure_ms | 35.06 | 39.04 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00072_P0030852.png (12), 06-05_00111_P0037820.png (3), 05-15_00198_P0030949.png (2), 05-26_00058_P0034280.png (2)
- most background false positives: 05-15_00227_P0030688.png (1156), 05-15_00198_P0030949.png (1072), 05-15_00179_P0030688.png (1067), 05-15_00072_P0030852.png (801)
- most crop false positives: 05-15_00198_P0030949.png (73), 06-05_00111_P0037820.png (54), 06-05_00219_P0038053.png (24), 05-26_00058_P0034280.png (23)
- most merged references: 06-05_00111_P0037820.png (4), 06-05_00090_P0037989.png (3), 06-05_00219_P0038053.png (2), 05-15_00198_P0030949.png (1)
