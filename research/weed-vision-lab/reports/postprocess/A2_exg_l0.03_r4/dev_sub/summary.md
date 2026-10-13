# Classical baseline `A2_exg_l0.03_r4` on `dev_sub`

120 images, 662 reference weed observations, 1094 detections. Generated 2026-10-13T22:53:53+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.394 | 0.651 | 0.491 | 0.407 | 0.501 | 5.53 | 1.93 | 4.55 | 0.29 |
| 0.3 | 0.530 | 0.876 | 0.661 | 0.548 | 0.674 | 4.28 | 0.68 | 3.68 | 0.29 |
| 0.1 | 0.551 | 0.911 | 0.687 | 0.569 | 0.701 | 4.09 | 0.49 | 3.52 | 0.29 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1094 | 0.394 | 0.651 | 0.491 | 0.407 | 0.501 | 0.8148 | 4.55 | 0.29 |
| 4 | 1043 | 0.413 | 0.651 | 0.506 | 0.425 | 0.515 | 0.8148 | 4.21 | 0.25 |
| 10 | 1015 | 0.425 | 0.651 | 0.514 | 0.436 | 0.522 | 0.8148 | 4.0 | 0.23 |
| 25 | 939 | 0.459 | 0.651 | 0.538 | 0.472 | 0.547 | 0.8148 | 3.43 | 0.21 |
| 50 | 839 | 0.512 | 0.649 | 0.573 | 0.526 | 0.581 | 0.8148 | 2.71 | 0.17 |
| 100 | 691 | 0.595 | 0.621 | 0.608 | 0.605 | 0.613 | 0.8148 | 1.81 | 0.1 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.820 (172) | 0.765 (17) | 0.795 (117) | 0.586 (162) | 0.451 (51) | 0.771 (35) | 0.361 (108) | 0.318 (132) | 0.691 (392) | 0.850 (133) | 1.000 (5) |
| 0.3 | 0.994 (172) | 0.941 (17) | 0.974 (117) | 0.864 (162) | 0.588 (51) | 0.914 (35) | 0.713 (108) | 0.621 (132) | 0.944 (392) | 0.925 (133) | 1.000 (5) |
| 0.1 | 0.994 (172) | 0.941 (17) | 1.000 (117) | 0.914 (162) | 0.627 (51) | 1.000 (35) | 0.778 (108) | 0.697 (132) | 0.975 (392) | 0.932 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.914 | 0.045 | 0.003 | 0.021 | 0.574 | 0.228 |
| A | 172 | 0.988 | 0.000 | 0.000 | 0.000 | 0.620 | 0.450 |
| B | 17 | 0.941 | 0.000 | 0.000 | 0.000 | 0.629 | 0.417 |
| C | 117 | 0.983 | 0.009 | 0.000 | 0.000 | 0.602 | 0.469 |
| D | 162 | 0.951 | 0.142 | 0.000 | 0.062 | 0.554 | 0.271 |
| partial | 51 | 0.647 | 0.020 | 0.020 | 0.020 | 0.460 | 0.000 |
| touches_border | 35 | 0.971 | 0.029 | 0.029 | 0.057 | 0.633 | 0.333 |
| tiny | 108 | 0.768 | 0.037 | 0.000 | 0.009 | 0.461 | 0.000 |
| band tiny | 132 | 0.697 | 0.038 | 0.008 | 0.008 | 0.427 | 0.000 |
| band small | 392 | 0.962 | 0.025 | 0.000 | 0.023 | 0.576 | 0.381 |
| band medium | 133 | 0.985 | 0.105 | 0.007 | 0.030 | 0.690 | 0.445 |
| band large | 5 | 1.000 | 0.200 | 0.000 | 0.000 | 0.793 | 0.650 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.99, IoU 0.60 (n 148) | found 1.00, IoU 0.73 (n 24) | - |
| B | - | found 0.92, IoU 0.56 (n 12) | found 1.00, IoU 0.72 (n 5) | - |
| C | - | found 0.98, IoU 0.57 (n 93) | found 1.00, IoU 0.72 (n 24) | - |
| D | - | found 0.93, IoU 0.50 (n 100) | found 0.98, IoU 0.61 (n 58) | found 1.00, IoU 0.79 (n 4) |

Weed count error per image (detections minus reference weeds): mean 3.6, median abs 3.0, p90 abs 9.0. Detections per image median 8.0, p95 18.049999999999997, max 30; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.028 (p10 0.004); pixel recall of plants 0.029; pixel precision 0.588.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 93.14 | 112.65 |
| ms_separate | 3.96 | 4.84 |
| ms_measure | 48.7 | 57.66 |
| ms_total | 145.42 | 169.63 |

## Worst images

