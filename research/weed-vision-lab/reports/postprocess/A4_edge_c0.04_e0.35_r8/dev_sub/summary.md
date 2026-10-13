# Classical baseline `A4_edge_c0.04_e0.35_r8` on `dev_sub`

120 images, 662 reference weed observations, 1199 detections. Generated 2026-10-13T22:54:42+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.381 | 0.690 | 0.491 | 0.401 | 0.507 | 6.18 | 1.71 | 4.73 | 0.5 |
| 0.3 | 0.485 | 0.879 | 0.625 | 0.511 | 0.646 | 5.14 | 0.67 | 4.08 | 0.5 |
| 0.1 | 0.504 | 0.912 | 0.649 | 0.530 | 0.671 | 4.96 | 0.48 | 3.94 | 0.5 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1199 | 0.381 | 0.690 | 0.491 | 0.401 | 0.507 | 0.7937 | 4.73 | 0.5 |
| 4 | 1051 | 0.435 | 0.690 | 0.534 | 0.451 | 0.546 | 0.7937 | 3.82 | 0.32 |
| 10 | 970 | 0.471 | 0.690 | 0.560 | 0.487 | 0.571 | 0.7937 | 3.21 | 0.27 |
| 25 | 885 | 0.516 | 0.690 | 0.591 | 0.532 | 0.601 | 0.7937 | 2.63 | 0.22 |
| 50 | 798 | 0.565 | 0.681 | 0.618 | 0.580 | 0.627 | 0.7937 | 2.12 | 0.17 |
| 100 | 674 | 0.641 | 0.653 | 0.647 | 0.652 | 0.652 | 0.7937 | 1.44 | 0.09 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.796 (172) | 0.765 (17) | 0.803 (117) | 0.704 (162) | 0.471 (51) | 0.800 (35) | 0.435 (108) | 0.386 (132) | 0.727 (392) | 0.872 (133) | 1.000 (5) |
| 0.3 | 0.994 (172) | 0.941 (17) | 0.957 (117) | 0.883 (162) | 0.588 (51) | 0.943 (35) | 0.713 (108) | 0.621 (132) | 0.944 (392) | 0.940 (133) | 1.000 (5) |
| 0.1 | 0.994 (172) | 0.941 (17) | 1.000 (117) | 0.926 (162) | 0.627 (51) | 1.000 (35) | 0.768 (108) | 0.689 (132) | 0.977 (392) | 0.940 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.908 | 0.039 | 0.003 | 0.026 | 0.600 | 0.216 |
| A | 172 | 0.983 | 0.000 | 0.000 | 0.000 | 0.635 | 0.452 |
| B | 17 | 0.941 | 0.000 | 0.000 | 0.000 | 0.626 | 0.417 |
| C | 117 | 0.983 | 0.009 | 0.000 | 0.000 | 0.632 | 0.431 |
| D | 162 | 0.951 | 0.117 | 0.000 | 0.068 | 0.604 | 0.292 |
| partial | 51 | 0.647 | 0.020 | 0.020 | 0.059 | 0.435 | 0.000 |
| touches_border | 35 | 0.971 | 0.029 | 0.029 | 0.057 | 0.729 | 0.379 |
| tiny | 108 | 0.741 | 0.037 | 0.000 | 0.009 | 0.452 | 0.000 |
| band tiny | 132 | 0.674 | 0.038 | 0.008 | 0.008 | 0.394 | 0.000 |
| band small | 392 | 0.959 | 0.020 | 0.000 | 0.028 | 0.593 | 0.404 |
| band medium | 133 | 0.985 | 0.098 | 0.007 | 0.038 | 0.766 | 0.475 |
| band large | 5 | 1.000 | 0.000 | 0.000 | 0.000 | 0.890 | 0.709 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.98, IoU 0.62 (n 148) | found 1.00, IoU 0.78 (n 24) | - |
| B | - | found 0.92, IoU 0.56 (n 12) | found 1.00, IoU 0.78 (n 5) | - |
| C | - | found 0.98, IoU 0.58 (n 93) | found 1.00, IoU 0.79 (n 24) | - |
| D | - | found 0.93, IoU 0.57 (n 100) | found 0.98, IoU 0.70 (n 58) | found 1.00, IoU 0.89 (n 4) |

Weed count error per image (detections minus reference weeds): mean 4.47, median abs 3.0, p90 abs 10.0. Detections per image median 9.0, p95 22.049999999999997, max 31; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.028 (p10 0.004); pixel recall of plants 0.028; pixel precision 0.638.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 296.95 | 327.62 |
| ms_separate | 4.01 | 4.95 |
| ms_measure | 49.03 | 57.48 |
| ms_total | 348.29 | 384.83 |

## Worst images

