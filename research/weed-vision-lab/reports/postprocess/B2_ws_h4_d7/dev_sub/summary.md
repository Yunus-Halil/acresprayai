# Classical baseline `B2_ws_h4_d7` on `dev_sub`

120 images, 662 reference weed observations, 1325 detections. Generated 2026-10-13T22:55:20+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.358 | 0.716 | 0.477 | 0.378 | 0.494 | 7.09 | 1.57 | 4.82 | 0.58 |
| 0.3 | 0.451 | 0.902 | 0.601 | 0.476 | 0.623 | 6.07 | 0.54 | 4.33 | 0.58 |
| 0.1 | 0.461 | 0.923 | 0.615 | 0.487 | 0.637 | 5.95 | 0.42 | 4.26 | 0.58 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1325 | 0.358 | 0.716 | 0.477 | 0.378 | 0.494 | 0.7937 | 4.82 | 0.58 |
| 4 | 1091 | 0.434 | 0.716 | 0.541 | 0.450 | 0.553 | 0.7937 | 3.28 | 0.32 |
| 10 | 1029 | 0.461 | 0.716 | 0.561 | 0.474 | 0.571 | 0.7937 | 2.85 | 0.25 |
| 25 | 935 | 0.507 | 0.716 | 0.594 | 0.521 | 0.603 | 0.7937 | 2.19 | 0.22 |
| 50 | 851 | 0.550 | 0.707 | 0.619 | 0.564 | 0.627 | 0.7937 | 1.71 | 0.17 |
| 100 | 724 | 0.617 | 0.675 | 0.645 | 0.627 | 0.650 | 0.7937 | 1.1 | 0.09 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.808 (172) | 0.647 (17) | 0.863 (117) | 0.778 (162) | 0.431 (51) | 0.743 (35) | 0.454 (108) | 0.402 (132) | 0.758 (392) | 0.902 (133) | 0.800 (5) |
| 0.3 | 0.994 (172) | 0.941 (17) | 0.974 (117) | 0.944 (162) | 0.608 (51) | 0.914 (35) | 0.741 (108) | 0.651 (132) | 0.957 (392) | 0.985 (133) | 1.000 (5) |
| 0.1 | 0.994 (172) | 0.941 (17) | 1.000 (117) | 0.963 (162) | 0.647 (51) | 1.000 (35) | 0.768 (108) | 0.697 (132) | 0.977 (392) | 0.985 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.891 | 0.024 | 0.003 | 0.089 | 0.611 | 0.306 |
| A | 172 | 0.971 | 0.000 | 0.000 | 0.035 | 0.639 | 0.465 |
| B | 17 | 0.941 | 0.000 | 0.000 | 0.176 | 0.618 | 0.419 |
| C | 117 | 0.974 | 0.009 | 0.000 | 0.043 | 0.677 | 0.458 |
| D | 162 | 0.932 | 0.056 | 0.000 | 0.185 | 0.622 | 0.405 |
| partial | 51 | 0.608 | 0.020 | 0.020 | 0.118 | 0.408 | 0.000 |
| touches_border | 35 | 0.886 | 0.029 | 0.029 | 0.229 | 0.618 | 0.318 |
| tiny | 108 | 0.741 | 0.037 | 0.000 | 0.009 | 0.467 | 0.000 |
| band tiny | 132 | 0.674 | 0.038 | 0.008 | 0.008 | 0.426 | 0.000 |
| band small | 392 | 0.941 | 0.020 | 0.000 | 0.071 | 0.618 | 0.412 |
| band medium | 133 | 0.962 | 0.023 | 0.007 | 0.210 | 0.752 | 0.511 |
| band large | 5 | 0.800 | 0.000 | 0.000 | 0.400 | 0.587 | 0.433 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.97, IoU 0.62 (n 148) | found 0.96, IoU 0.77 (n 24) | - |
| B | - | found 0.92, IoU 0.53 (n 12) | found 1.00, IoU 0.78 (n 5) | - |
| C | - | found 0.97, IoU 0.66 (n 93) | found 1.00, IoU 0.79 (n 24) | - |
| D | - | found 0.91, IoU 0.58 (n 100) | found 0.97, IoU 0.70 (n 58) | found 1.00, IoU 0.62 (n 4) |

Weed count error per image (detections minus reference weeds): mean 5.53, median abs 4.0, p90 abs 13.0. Detections per image median 9.5, p95 24.049999999999997, max 38; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.028 (p10 0.004); pixel recall of plants 0.028; pixel precision 0.643.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 10.95 | 13.58 |
| ms_separate | 18.33 | 32.96 |
| ms_measure | 47.69 | 55.14 |
| ms_total | 78.14 | 91.5 |

## Worst images

