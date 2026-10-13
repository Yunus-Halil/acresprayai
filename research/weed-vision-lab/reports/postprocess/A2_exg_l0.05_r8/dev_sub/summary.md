# Classical baseline `A2_exg_l0.05_r8` on `dev_sub`

120 images, 662 reference weed observations, 1128 detections. Generated 2026-10-13T22:53:45+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.400 | 0.681 | 0.504 | 0.414 | 0.515 | 5.64 | 1.76 | 4.66 | 0.32 |
| 0.3 | 0.512 | 0.873 | 0.646 | 0.530 | 0.660 | 4.58 | 0.7 | 3.9 | 0.32 |
| 0.1 | 0.535 | 0.912 | 0.675 | 0.554 | 0.690 | 4.37 | 0.48 | 3.75 | 0.32 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1128 | 0.400 | 0.681 | 0.504 | 0.414 | 0.515 | 0.8254 | 4.66 | 0.32 |
| 4 | 1042 | 0.433 | 0.681 | 0.529 | 0.446 | 0.539 | 0.8254 | 4.06 | 0.26 |
| 10 | 1000 | 0.451 | 0.681 | 0.543 | 0.463 | 0.551 | 0.8254 | 3.76 | 0.22 |
| 25 | 919 | 0.491 | 0.681 | 0.571 | 0.504 | 0.579 | 0.8254 | 3.16 | 0.2 |
| 50 | 830 | 0.541 | 0.678 | 0.602 | 0.555 | 0.611 | 0.8254 | 2.53 | 0.17 |
| 100 | 698 | 0.613 | 0.646 | 0.629 | 0.624 | 0.635 | 0.8254 | 1.79 | 0.1 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.831 (172) | 0.765 (17) | 0.829 (117) | 0.605 (162) | 0.490 (51) | 0.743 (35) | 0.454 (108) | 0.402 (132) | 0.714 (392) | 0.850 (133) | 1.000 (5) |
| 0.3 | 0.994 (172) | 0.941 (17) | 0.966 (117) | 0.858 (162) | 0.588 (51) | 0.943 (35) | 0.704 (108) | 0.614 (132) | 0.939 (392) | 0.932 (133) | 1.000 (5) |
| 0.1 | 0.994 (172) | 0.941 (17) | 1.000 (117) | 0.920 (162) | 0.627 (51) | 1.000 (35) | 0.778 (108) | 0.697 (132) | 0.975 (392) | 0.940 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.914 | 0.042 | 0.003 | 0.020 | 0.582 | 0.211 |
| A | 172 | 0.988 | 0.000 | 0.000 | 0.000 | 0.633 | 0.465 |
| B | 17 | 0.941 | 0.000 | 0.000 | 0.000 | 0.626 | 0.419 |
| C | 117 | 0.983 | 0.009 | 0.000 | 0.000 | 0.616 | 0.466 |
| D | 162 | 0.951 | 0.130 | 0.000 | 0.062 | 0.564 | 0.238 |
| partial | 51 | 0.647 | 0.020 | 0.020 | 0.020 | 0.431 | 0.000 |
| touches_border | 35 | 0.971 | 0.029 | 0.029 | 0.057 | 0.632 | 0.333 |
| tiny | 108 | 0.768 | 0.037 | 0.000 | 0.000 | 0.477 | 0.000 |
| band tiny | 132 | 0.697 | 0.038 | 0.008 | 0.000 | 0.430 | 0.000 |
| band small | 392 | 0.962 | 0.025 | 0.000 | 0.023 | 0.583 | 0.380 |
| band medium | 133 | 0.985 | 0.098 | 0.007 | 0.030 | 0.706 | 0.431 |
| band large | 5 | 1.000 | 0.000 | 0.000 | 0.000 | 0.808 | 0.715 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.99, IoU 0.62 (n 148) | found 1.00, IoU 0.76 (n 24) | - |
| B | - | found 0.92, IoU 0.56 (n 12) | found 1.00, IoU 0.75 (n 5) | - |
| C | - | found 0.98, IoU 0.58 (n 93) | found 1.00, IoU 0.76 (n 24) | - |
| D | - | found 0.93, IoU 0.51 (n 100) | found 0.98, IoU 0.62 (n 58) | found 1.00, IoU 0.81 (n 4) |

Weed count error per image (detections minus reference weeds): mean 3.88, median abs 3.0, p90 abs 10.0. Detections per image median 8.0, p95 19.049999999999997, max 30; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.028 (p10 0.004); pixel recall of plants 0.029; pixel precision 0.599.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 99.63 | 118.74 |
| ms_separate | 4.18 | 5.24 |
| ms_measure | 52.24 | 69.81 |
| ms_total | 156.32 | 191.44 |

## Worst images

