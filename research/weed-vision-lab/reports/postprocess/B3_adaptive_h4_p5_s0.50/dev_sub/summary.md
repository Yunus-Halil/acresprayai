# Classical baseline `B3_adaptive_h4_p5_s0.50` on `dev_sub`

120 images, 662 reference weed observations, 1256 detections. Generated 2026-10-13T22:58:00+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.390 | 0.740 | 0.511 | 0.413 | 0.530 | 6.38 | 1.43 | 4.78 | 0.58 |
| 0.3 | 0.474 | 0.899 | 0.620 | 0.502 | 0.644 | 5.51 | 0.56 | 4.29 | 0.58 |
| 0.1 | 0.485 | 0.920 | 0.635 | 0.513 | 0.659 | 5.39 | 0.44 | 4.22 | 0.58 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1256 | 0.390 | 0.740 | 0.511 | 0.413 | 0.530 | 0.8254 | 4.78 | 0.58 |
| 4 | 1022 | 0.479 | 0.740 | 0.582 | 0.498 | 0.595 | 0.8254 | 3.24 | 0.32 |
| 10 | 960 | 0.510 | 0.740 | 0.604 | 0.527 | 0.616 | 0.8254 | 2.81 | 0.25 |
| 25 | 866 | 0.566 | 0.740 | 0.641 | 0.583 | 0.652 | 0.8254 | 2.15 | 0.22 |
| 50 | 782 | 0.619 | 0.731 | 0.670 | 0.636 | 0.680 | 0.8254 | 1.67 | 0.17 |
| 100 | 662 | 0.699 | 0.699 | 0.699 | 0.711 | 0.705 | 0.8254 | 1.07 | 0.09 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.831 (172) | 0.765 (17) | 0.889 (117) | 0.809 (162) | 0.451 (51) | 0.771 (35) | 0.454 (108) | 0.402 (132) | 0.788 (392) | 0.932 (133) | 0.800 (5) |
| 0.3 | 0.994 (172) | 0.941 (17) | 0.974 (117) | 0.938 (162) | 0.588 (51) | 0.914 (35) | 0.741 (108) | 0.644 (132) | 0.957 (392) | 0.977 (133) | 1.000 (5) |
| 0.1 | 0.994 (172) | 0.941 (17) | 1.000 (117) | 0.957 (162) | 0.627 (51) | 1.000 (35) | 0.768 (108) | 0.689 (132) | 0.977 (392) | 0.977 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.903 | 0.027 | 0.003 | 0.029 | 0.626 | 0.302 |
| A | 172 | 0.983 | 0.000 | 0.000 | 0.000 | 0.653 | 0.467 |
| B | 17 | 0.941 | 0.000 | 0.000 | 0.000 | 0.625 | 0.424 |
| C | 117 | 0.983 | 0.009 | 0.000 | 0.000 | 0.697 | 0.482 |
| D | 162 | 0.951 | 0.068 | 0.000 | 0.068 | 0.656 | 0.411 |
| partial | 51 | 0.627 | 0.020 | 0.020 | 0.078 | 0.428 | 0.000 |
| touches_border | 35 | 0.914 | 0.029 | 0.029 | 0.086 | 0.728 | 0.318 |
| tiny | 108 | 0.741 | 0.037 | 0.000 | 0.009 | 0.467 | 0.000 |
| band tiny | 132 | 0.674 | 0.038 | 0.008 | 0.008 | 0.426 | 0.000 |
| band small | 392 | 0.954 | 0.020 | 0.000 | 0.031 | 0.625 | 0.431 |
| band medium | 133 | 0.985 | 0.038 | 0.007 | 0.038 | 0.781 | 0.606 |
| band large | 5 | 0.800 | 0.000 | 0.000 | 0.200 | 0.891 | 0.544 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.98, IoU 0.63 (n 148) | found 1.00, IoU 0.78 (n 24) | - |
| B | - | found 0.92, IoU 0.57 (n 12) | found 1.00, IoU 0.78 (n 5) | - |
| C | - | found 0.98, IoU 0.66 (n 93) | found 1.00, IoU 0.80 (n 24) | - |
| D | - | found 0.93, IoU 0.60 (n 100) | found 0.98, IoU 0.77 (n 58) | found 1.00, IoU 0.89 (n 4) |

Weed count error per image (detections minus reference weeds): mean 4.95, median abs 3.0, p90 abs 11.0. Detections per image median 9.0, p95 23.049999999999997, max 38; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.028 (p10 0.004); pixel recall of plants 0.028; pixel precision 0.643.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 11.56 | 14.95 |
| ms_separate | 19.63 | 28.53 |
| ms_measure | 48.39 | 57.93 |
| ms_total | 80.83 | 94.92 |

## Worst images

