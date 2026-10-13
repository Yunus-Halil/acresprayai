# Classical baseline `A1_argmax` on `dev_sub`

120 images, 662 reference weed observations, 1248 detections. Generated 2026-10-13T22:53:26+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.389 | 0.733 | 0.508 | 0.412 | 0.527 | 6.36 | 1.48 | 4.78 | 0.58 |
| 0.3 | 0.474 | 0.893 | 0.619 | 0.502 | 0.642 | 5.47 | 0.59 | 4.29 | 0.58 |
| 0.1 | 0.485 | 0.914 | 0.633 | 0.514 | 0.658 | 5.36 | 0.47 | 4.22 | 0.58 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1248 | 0.389 | 0.733 | 0.508 | 0.412 | 0.527 | 0.8254 | 4.78 | 0.58 |
| 4 | 1014 | 0.478 | 0.733 | 0.579 | 0.497 | 0.592 | 0.8254 | 3.24 | 0.32 |
| 10 | 952 | 0.509 | 0.733 | 0.601 | 0.526 | 0.612 | 0.8254 | 2.81 | 0.25 |
| 25 | 858 | 0.565 | 0.733 | 0.638 | 0.583 | 0.649 | 0.8254 | 2.15 | 0.22 |
| 50 | 774 | 0.619 | 0.724 | 0.667 | 0.636 | 0.677 | 0.8254 | 1.67 | 0.17 |
| 100 | 654 | 0.700 | 0.692 | 0.696 | 0.712 | 0.702 | 0.8254 | 1.07 | 0.09 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.831 (172) | 0.765 (17) | 0.889 (117) | 0.772 (162) | 0.451 (51) | 0.800 (35) | 0.454 (108) | 0.402 (132) | 0.788 (392) | 0.887 (133) | 1.000 (5) |
| 0.3 | 0.994 (172) | 0.941 (17) | 0.974 (117) | 0.914 (162) | 0.588 (51) | 0.914 (35) | 0.741 (108) | 0.644 (132) | 0.957 (392) | 0.947 (133) | 1.000 (5) |
| 0.1 | 0.994 (172) | 0.941 (17) | 1.000 (117) | 0.932 (162) | 0.627 (51) | 1.000 (35) | 0.768 (108) | 0.689 (132) | 0.977 (392) | 0.947 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.905 | 0.036 | 0.003 | 0.027 | 0.625 | 0.273 |
| A | 172 | 0.983 | 0.000 | 0.000 | 0.000 | 0.653 | 0.467 |
| B | 17 | 0.941 | 0.000 | 0.000 | 0.000 | 0.625 | 0.424 |
| C | 117 | 0.983 | 0.009 | 0.000 | 0.000 | 0.697 | 0.482 |
| D | 162 | 0.951 | 0.105 | 0.000 | 0.068 | 0.643 | 0.342 |
| partial | 51 | 0.627 | 0.020 | 0.020 | 0.078 | 0.428 | 0.000 |
| touches_border | 35 | 0.943 | 0.029 | 0.029 | 0.057 | 0.728 | 0.380 |
| tiny | 108 | 0.741 | 0.037 | 0.000 | 0.009 | 0.467 | 0.000 |
| band tiny | 132 | 0.674 | 0.038 | 0.008 | 0.008 | 0.426 | 0.000 |
| band small | 392 | 0.954 | 0.020 | 0.000 | 0.031 | 0.625 | 0.431 |
| band medium | 133 | 0.985 | 0.083 | 0.007 | 0.038 | 0.770 | 0.494 |
| band large | 5 | 1.000 | 0.000 | 0.000 | 0.000 | 0.891 | 0.773 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.98, IoU 0.63 (n 148) | found 1.00, IoU 0.78 (n 24) | - |
| B | - | found 0.92, IoU 0.57 (n 12) | found 1.00, IoU 0.78 (n 5) | - |
| C | - | found 0.98, IoU 0.66 (n 93) | found 1.00, IoU 0.80 (n 24) | - |
| D | - | found 0.93, IoU 0.60 (n 100) | found 0.98, IoU 0.72 (n 58) | found 1.00, IoU 0.89 (n 4) |

Weed count error per image (detections minus reference weeds): mean 4.88, median abs 3.0, p90 abs 11.0. Detections per image median 9.0, p95 23.049999999999997, max 35; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.028 (p10 0.004); pixel recall of plants 0.028; pixel precision 0.643.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 13.92 | 16.54 |
| ms_separate | 4.95 | 6.24 |
| ms_measure | 64.35 | 75.3 |
| ms_total | 82.84 | 94.48 |

## Worst images

