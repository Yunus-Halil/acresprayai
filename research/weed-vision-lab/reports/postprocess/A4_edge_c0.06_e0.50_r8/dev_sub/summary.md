# Classical baseline `A4_edge_c0.06_e0.50_r8` on `dev_sub`

120 images, 662 reference weed observations, 1142 detections. Generated 2026-10-13T22:54:55+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.328 | 0.565 | 0.415 | 0.343 | 0.426 | 6.4 | 2.4 | 5.2 | 0.42 |
| 0.3 | 0.485 | 0.837 | 0.614 | 0.507 | 0.632 | 4.9 | 0.9 | 4.03 | 0.42 |
| 0.1 | 0.522 | 0.900 | 0.661 | 0.546 | 0.680 | 4.55 | 0.55 | 3.73 | 0.42 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1142 | 0.328 | 0.565 | 0.415 | 0.343 | 0.426 | 0.6667 | 5.2 | 0.42 |
| 4 | 1042 | 0.359 | 0.565 | 0.439 | 0.372 | 0.448 | 0.6667 | 4.58 | 0.3 |
| 10 | 977 | 0.383 | 0.565 | 0.456 | 0.396 | 0.466 | 0.6667 | 4.1 | 0.27 |
| 25 | 897 | 0.417 | 0.565 | 0.480 | 0.430 | 0.488 | 0.6667 | 3.55 | 0.23 |
| 50 | 814 | 0.456 | 0.560 | 0.503 | 0.468 | 0.510 | 0.6667 | 3.02 | 0.18 |
| 100 | 705 | 0.505 | 0.538 | 0.521 | 0.513 | 0.525 | 0.6667 | 2.4 | 0.09 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.657 (172) | 0.765 (17) | 0.598 (117) | 0.568 (162) | 0.392 (51) | 0.743 (35) | 0.370 (108) | 0.318 (132) | 0.551 (392) | 0.842 (133) | 0.800 (5) |
| 0.3 | 0.983 (172) | 0.941 (17) | 0.914 (117) | 0.821 (162) | 0.549 (51) | 0.943 (35) | 0.630 (108) | 0.545 (132) | 0.898 (392) | 0.940 (133) | 1.000 (5) |
| 0.1 | 0.994 (172) | 0.941 (17) | 0.983 (117) | 0.901 (162) | 0.608 (51) | 1.000 (35) | 0.759 (108) | 0.674 (132) | 0.962 (392) | 0.940 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.909 | 0.057 | 0.003 | 0.024 | 0.538 | 0.185 |
| A | 172 | 0.988 | 0.000 | 0.000 | 0.000 | 0.600 | 0.410 |
| B | 17 | 0.941 | 0.000 | 0.000 | 0.000 | 0.560 | 0.401 |
| C | 117 | 0.983 | 0.034 | 0.000 | 0.000 | 0.538 | 0.317 |
| D | 162 | 0.951 | 0.167 | 0.000 | 0.068 | 0.541 | 0.224 |
| partial | 51 | 0.647 | 0.020 | 0.020 | 0.020 | 0.392 | 0.000 |
| touches_border | 35 | 0.971 | 0.057 | 0.029 | 0.057 | 0.658 | 0.334 |
| tiny | 108 | 0.741 | 0.037 | 0.000 | 0.018 | 0.404 | 0.000 |
| band tiny | 132 | 0.674 | 0.038 | 0.008 | 0.015 | 0.356 | 0.000 |
| band small | 392 | 0.962 | 0.043 | 0.000 | 0.025 | 0.527 | 0.299 |
| band medium | 133 | 0.985 | 0.113 | 0.007 | 0.030 | 0.679 | 0.456 |
| band large | 5 | 1.000 | 0.200 | 0.000 | 0.000 | 0.886 | 0.618 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.99, IoU 0.57 (n 148) | found 1.00, IoU 0.74 (n 24) | - |
| B | - | found 0.92, IoU 0.52 (n 12) | found 1.00, IoU 0.62 (n 5) | - |
| C | - | found 0.98, IoU 0.51 (n 93) | found 1.00, IoU 0.68 (n 24) | - |
| D | - | found 0.93, IoU 0.48 (n 100) | found 0.98, IoU 0.65 (n 58) | found 1.00, IoU 0.89 (n 4) |

Weed count error per image (detections minus reference weeds): mean 4.0, median abs 3.0, p90 abs 8.100000000000009. Detections per image median 8.5, p95 19.049999999999997, max 28; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.028 (p10 0.004); pixel recall of plants 0.028; pixel precision 0.578.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 298.16 | 318.56 |
| ms_separate | 4.12 | 5.28 |
| ms_measure | 49.38 | 56.4 |
| ms_total | 353.32 | 372.8 |

## Worst images

