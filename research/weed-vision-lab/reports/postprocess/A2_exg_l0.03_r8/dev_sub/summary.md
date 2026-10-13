# Classical baseline `A2_exg_l0.03_r8` on `dev_sub`

120 images, 662 reference weed observations, 1074 detections. Generated 2026-10-13T22:53:36+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.376 | 0.610 | 0.465 | 0.387 | 0.474 | 5.58 | 2.15 | 4.77 | 0.25 |
| 0.3 | 0.530 | 0.860 | 0.655 | 0.545 | 0.667 | 4.21 | 0.78 | 3.72 | 0.25 |
| 0.1 | 0.560 | 0.908 | 0.692 | 0.576 | 0.705 | 3.94 | 0.51 | 3.49 | 0.25 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1074 | 0.376 | 0.610 | 0.465 | 0.387 | 0.474 | 0.8148 | 4.77 | 0.25 |
| 4 | 1023 | 0.395 | 0.610 | 0.479 | 0.405 | 0.487 | 0.8148 | 4.42 | 0.21 |
| 10 | 997 | 0.405 | 0.610 | 0.487 | 0.414 | 0.494 | 0.8148 | 4.23 | 0.18 |
| 25 | 942 | 0.429 | 0.610 | 0.504 | 0.438 | 0.510 | 0.8148 | 3.84 | 0.17 |
| 50 | 853 | 0.472 | 0.609 | 0.532 | 0.483 | 0.538 | 0.8148 | 3.18 | 0.15 |
| 100 | 723 | 0.534 | 0.583 | 0.557 | 0.542 | 0.562 | 0.8148 | 2.39 | 0.09 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.820 (172) | 0.765 (17) | 0.709 (117) | 0.525 (162) | 0.392 (51) | 0.743 (35) | 0.333 (108) | 0.295 (132) | 0.635 (392) | 0.835 (133) | 1.000 (5) |
| 0.3 | 0.994 (172) | 0.941 (17) | 0.957 (117) | 0.821 (162) | 0.588 (51) | 0.914 (35) | 0.694 (108) | 0.606 (132) | 0.921 (392) | 0.925 (133) | 1.000 (5) |
| 0.1 | 0.994 (172) | 0.941 (17) | 0.983 (117) | 0.914 (162) | 0.627 (51) | 1.000 (35) | 0.778 (108) | 0.697 (132) | 0.969 (392) | 0.932 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.914 | 0.051 | 0.003 | 0.021 | 0.550 | 0.176 |
| A | 172 | 0.988 | 0.000 | 0.000 | 0.000 | 0.618 | 0.448 |
| B | 17 | 0.941 | 0.000 | 0.000 | 0.000 | 0.629 | 0.431 |
| C | 117 | 0.983 | 0.026 | 0.000 | 0.000 | 0.571 | 0.384 |
| D | 162 | 0.951 | 0.154 | 0.000 | 0.062 | 0.509 | 0.216 |
| partial | 51 | 0.647 | 0.020 | 0.020 | 0.020 | 0.427 | 0.000 |
| touches_border | 35 | 0.971 | 0.029 | 0.029 | 0.057 | 0.607 | 0.325 |
| tiny | 108 | 0.768 | 0.037 | 0.000 | 0.009 | 0.438 | 0.000 |
| band tiny | 132 | 0.697 | 0.038 | 0.008 | 0.008 | 0.414 | 0.000 |
| band small | 392 | 0.962 | 0.031 | 0.000 | 0.023 | 0.558 | 0.340 |
| band medium | 133 | 0.985 | 0.105 | 0.007 | 0.030 | 0.657 | 0.402 |
| band large | 5 | 1.000 | 0.600 | 0.000 | 0.000 | 0.694 | 0.616 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.99, IoU 0.60 (n 148) | found 1.00, IoU 0.71 (n 24) | - |
| B | - | found 0.92, IoU 0.56 (n 12) | found 1.00, IoU 0.71 (n 5) | - |
| C | - | found 0.98, IoU 0.53 (n 93) | found 1.00, IoU 0.71 (n 24) | - |
| D | - | found 0.93, IoU 0.46 (n 100) | found 0.98, IoU 0.56 (n 58) | found 1.00, IoU 0.69 (n 4) |

Weed count error per image (detections minus reference weeds): mean 3.43, median abs 3.0, p90 abs 8.100000000000009. Detections per image median 8.0, p95 18.049999999999997, max 30; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.028 (p10 0.004); pixel recall of plants 0.029; pixel precision 0.565.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 103.22 | 122.2 |
| ms_separate | 4.46 | 5.43 |
| ms_measure | 53.66 | 64.98 |
| ms_total | 161.2 | 189.72 |

## Worst images

