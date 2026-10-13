# Classical baseline `C1_probhigh0.7_adaptive_h4_p5_s0.50` on `dev_tune`

717 images, 4121 reference weed observations, 6835 detections. Generated 2026-10-13T23:01:21+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.457 | 0.757 | 0.570 | 0.471 | 0.581 | 5.18 | 1.39 | 3.02 | 0.29 |
| 0.3 | 0.520 | 0.863 | 0.649 | 0.537 | 0.662 | 4.57 | 0.79 | 2.92 | 0.29 |
| 0.1 | 0.542 | 0.899 | 0.676 | 0.559 | 0.689 | 4.37 | 0.58 | 2.9 | 0.29 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 6835 | 0.457 | 0.757 | 0.570 | 0.471 | 0.581 | 0.8759 | 3.02 | 0.29 |
| 4 | 5929 | 0.526 | 0.757 | 0.621 | 0.539 | 0.630 | 0.8759 | 2.12 | 0.2 |
| 10 | 5558 | 0.561 | 0.757 | 0.645 | 0.573 | 0.652 | 0.8759 | 1.77 | 0.15 |
| 25 | 5048 | 0.617 | 0.756 | 0.679 | 0.627 | 0.685 | 0.8759 | 1.31 | 0.11 |
| 50 | 4477 | 0.681 | 0.740 | 0.710 | 0.689 | 0.714 | 0.8759 | 0.86 | 0.07 |
| 100 | 3756 | 0.758 | 0.691 | 0.723 | 0.764 | 0.726 | 0.8701 | 0.46 | 0.04 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.882 (1107) | 0.802 (86) | 0.921 (632) | 0.782 (1032) | 0.443 (343) | 0.799 (309) | 0.471 (612) | 0.421 (776) | 0.806 (2463) | 0.915 (851) | 0.935 (31) |
| 0.3 | 0.960 (1107) | 0.954 (86) | 0.981 (632) | 0.899 (1032) | 0.569 (343) | 0.883 (309) | 0.647 (612) | 0.575 (776) | 0.915 (2463) | 0.971 (851) | 1.000 (31) |
| 0.1 | 0.978 (1107) | 0.965 (86) | 0.989 (632) | 0.939 (1032) | 0.633 (343) | 0.939 (309) | 0.714 (612) | 0.642 (776) | 0.951 (2463) | 0.978 (851) | 1.000 (31) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4121 | 0.842 | 0.036 | 0.002 | 0.050 | 0.667 | 0.157 |
| A | 1107 | 0.925 | 0.000 | 0.000 | 0.017 | 0.701 | 0.473 |
| B | 86 | 0.895 | 0.000 | 0.000 | 0.058 | 0.711 | 0.400 |
| C | 632 | 0.953 | 0.003 | 0.000 | 0.033 | 0.736 | 0.521 |
| D | 1032 | 0.900 | 0.095 | 0.000 | 0.105 | 0.667 | 0.313 |
| partial | 343 | 0.557 | 0.029 | 0.015 | 0.102 | 0.465 | 0.000 |
| touches_border | 309 | 0.841 | 0.029 | 0.010 | 0.052 | 0.715 | 0.280 |
| tiny | 612 | 0.629 | 0.046 | 0.000 | 0.002 | 0.470 | 0.000 |
| band tiny | 776 | 0.563 | 0.039 | 0.003 | 0.005 | 0.418 | 0.000 |
| band small | 2463 | 0.884 | 0.025 | 0.001 | 0.058 | 0.668 | 0.343 |
| band medium | 851 | 0.967 | 0.062 | 0.004 | 0.068 | 0.805 | 0.525 |
| band large | 31 | 0.968 | 0.065 | 0.000 | 0.032 | 0.890 | 0.720 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.92, IoU 0.68 (n 933) | found 0.97, IoU 0.81 (n 174) | - |
| B | - | found 0.85, IoU 0.66 (n 60) | found 1.00, IoU 0.81 (n 26) | - |
| C | - | found 0.94, IoU 0.70 (n 492) | found 1.00, IoU 0.84 (n 140) | - |
| D | - | found 0.86, IoU 0.63 (n 655) | found 0.96, IoU 0.78 (n 359) | found 1.00, IoU 0.91 (n 18) |

Weed count error per image (detections minus reference weeds): mean 3.79, median abs 3.0, p90 abs 9.0. Detections per image median 8.0, p95 22.0, max 42; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.030 (p10 0.003); pixel recall of plants 0.030; pixel precision 0.755.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 14.9 | 18.25 |
| ms_separate | 22.6 | 39.46 |
| ms_measure | 57.28 | 70.17 |
| ms_total | 95.4 | 121.07 |

## Worst images

