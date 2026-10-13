# Classical baseline `exg_hyst_h0.10_l0.03` on `dev_check`

690 images, 4020 reference weed observations, 481863 detections. Generated 2026-10-13T21:55:12+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.004 | 0.508 | 0.008 | 0.004 | 0.009 | 695.39 | 2.86 | 685.81 | 6.99 |
| 0.3 | 0.006 | 0.679 | 0.011 | 0.006 | 0.011 | 694.4 | 1.87 | 685.61 | 6.98 |
| 0.1 | 0.006 | 0.761 | 0.013 | 0.006 | 0.013 | 693.92 | 1.39 | 685.53 | 6.91 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 481863 | 0.004 | 0.508 | 0.008 | 0.004 | 0.009 | 0.7184 | 685.81 | 6.99 |
| 4 | 182758 | 0.011 | 0.508 | 0.022 | 0.011 | 0.022 | 0.7184 | 252.46 | 6.96 |
| 10 | 88556 | 0.023 | 0.508 | 0.044 | 0.024 | 0.046 | 0.7184 | 116.13 | 6.93 |
| 25 | 29002 | 0.070 | 0.505 | 0.123 | 0.084 | 0.144 | 0.7184 | 30.07 | 6.9 |
| 50 | 14418 | 0.139 | 0.498 | 0.217 | 0.206 | 0.291 | 0.7184 | 9.42 | 6.8 |
| 100 | 9133 | 0.199 | 0.451 | 0.276 | 0.386 | 0.416 | 0.7028 | 2.97 | 6.42 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.729 (1137) | 0.568 (81) | 0.672 (698) | 0.158 (982) | 0.427 (286) | 0.507 (280) | 0.505 (556) | 0.481 (736) | 0.499 (2459) | 0.558 (786) | 0.615 (39) |
| 0.3 | 0.897 (1137) | 0.716 (81) | 0.835 (698) | 0.290 (982) | 0.559 (286) | 0.636 (280) | 0.800 (556) | 0.734 (736) | 0.666 (2459) | 0.662 (786) | 0.821 (39) |
| 0.1 | 0.975 (1137) | 0.876 (81) | 0.903 (698) | 0.380 (982) | 0.643 (286) | 0.775 (280) | 0.854 (556) | 0.796 (736) | 0.754 (2459) | 0.739 (786) | 0.923 (39) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4020 | 0.823 | 0.141 | 0.204 | 0.074 | 0.509 | 0.003 |
| A | 1137 | 0.783 | 0.000 | 0.000 | 0.095 | 0.603 | 0.289 |
| B | 81 | 0.617 | 0.049 | 0.000 | 0.185 | 0.611 | 0.116 |
| C | 698 | 0.850 | 0.054 | 0.095 | 0.054 | 0.609 | 0.128 |
| D | 982 | 0.872 | 0.435 | 0.613 | 0.085 | 0.036 | 0.002 |
| partial | 286 | 0.759 | 0.084 | 0.196 | 0.052 | 0.394 | 0.000 |
| touches_border | 280 | 0.839 | 0.189 | 0.236 | 0.068 | 0.506 | 0.018 |
| tiny | 556 | 0.838 | 0.034 | 0.056 | 0.032 | 0.504 | 0.001 |
| band tiny | 736 | 0.802 | 0.041 | 0.065 | 0.035 | 0.480 | 0.000 |
| band small | 2459 | 0.793 | 0.135 | 0.204 | 0.089 | 0.499 | 0.003 |
| band medium | 786 | 0.927 | 0.249 | 0.317 | 0.065 | 0.561 | 0.015 |
| band large | 39 | 1.000 | 0.154 | 0.564 | 0.000 | 0.732 | 0.206 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.76, IoU 0.59 (n 929) | found 0.88, IoU 0.69 (n 208) | - |
| B | - | found 0.54, IoU 0.40 (n 61) | found 0.85, IoU 0.69 (n 20) | - |
| C | - | found 0.82, IoU 0.60 (n 535) | found 0.96, IoU 0.67 (n 163) | - |
| D | - | found 0.84, IoU 0.01 (n 697) | found 0.94, IoU 0.08 (n 252) | found 1.00, IoU 0.73 (n 33) |

Weed count error per image (detections minus reference weeds): mean 692.53, median abs 661.0, p90 abs 1139.1. Detections per image median 665.5, p95 1263.0, max 1652; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.728 (p10 0.600); pixel recall of plants 0.989; pixel precision 0.735.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 61.72, index_and_threshold_ms 23.38, components_ms 2.51, measure_ms 35.83.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 51.53 | 55.34 |
| index_and_threshold_ms | 16.39 | 17.42 |
| components_ms | 2.31 | 2.58 |
| measure_ms | 32.71 | 35.51 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00072_P0030852.png (6), 05-15_00136_P0030949.png (5), 05-15_00051_P0030852.png (4), 05-15_00073_P0030852.png (4)
- most background false positives: 05-15_00262_P0030690.png (1633), 05-15_00245_P0030690.png (1562), 05-15_00199_P0030690.png (1506), 05-15_00133_P0030690.png (1443)
- most crop false positives: 05-26_00139_P0034280.png (15), 05-26_00215_P0034119.png (15), 05-26_00160_P0034280.png (14), 06-05_00161_P0037989.png (14)
- most merged references: 06-05_00112_P0038055.png (11), 06-05_00113_P0038055.png (10), 06-05_00130_P0037820.png (10), 06-05_00151_P0037820.png (10)
