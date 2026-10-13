# Classical baseline `S1_probhigh_0.7` on `dev_check`

690 images, 4020 reference weed observations, 6688 detections. Generated 2026-10-13T23:05:41+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.442 | 0.735 | 0.552 | 0.458 | 0.565 | 5.41 | 1.54 | 3.07 | 0.35 |
| 0.3 | 0.519 | 0.863 | 0.648 | 0.538 | 0.663 | 4.66 | 0.8 | 2.95 | 0.35 |
| 0.1 | 0.538 | 0.895 | 0.672 | 0.558 | 0.687 | 4.48 | 0.61 | 2.94 | 0.34 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 6688 | 0.442 | 0.735 | 0.552 | 0.458 | 0.565 | 0.8654 | 3.07 | 0.35 |
| 4 | 5722 | 0.517 | 0.735 | 0.607 | 0.532 | 0.618 | 0.8654 | 2.09 | 0.24 |
| 10 | 5339 | 0.554 | 0.735 | 0.632 | 0.567 | 0.640 | 0.8654 | 1.7 | 0.19 |
| 25 | 4814 | 0.613 | 0.734 | 0.668 | 0.623 | 0.674 | 0.8654 | 1.27 | 0.11 |
| 50 | 4304 | 0.674 | 0.722 | 0.698 | 0.682 | 0.701 | 0.8654 | 0.87 | 0.07 |
| 100 | 3628 | 0.744 | 0.671 | 0.706 | 0.747 | 0.707 | 0.8448 | 0.51 | 0.02 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.872 (1137) | 0.778 (81) | 0.894 (698) | 0.682 (982) | 0.430 (286) | 0.782 (280) | 0.478 (556) | 0.432 (736) | 0.768 (2459) | 0.910 (786) | 0.872 (39) |
| 0.3 | 0.962 (1137) | 0.926 (81) | 0.979 (698) | 0.850 (982) | 0.517 (286) | 0.907 (280) | 0.687 (556) | 0.610 (736) | 0.908 (2459) | 0.957 (786) | 0.923 (39) |
| 0.1 | 0.982 (1137) | 0.926 (81) | 0.990 (698) | 0.884 (982) | 0.570 (286) | 0.939 (280) | 0.759 (556) | 0.685 (736) | 0.936 (2459) | 0.963 (786) | 0.923 (39) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4020 | 0.845 | 0.053 | 0.001 | 0.051 | 0.666 | 0.192 |
| A | 1137 | 0.932 | 0.000 | 0.000 | 0.049 | 0.702 | 0.468 |
| B | 81 | 0.827 | 0.025 | 0.000 | 0.111 | 0.710 | 0.321 |
| C | 698 | 0.951 | 0.011 | 0.000 | 0.032 | 0.735 | 0.495 |
| D | 982 | 0.870 | 0.156 | 0.002 | 0.088 | 0.638 | 0.237 |
| partial | 286 | 0.510 | 0.052 | 0.000 | 0.028 | 0.348 | 0.000 |
| touches_border | 280 | 0.907 | 0.086 | 0.007 | 0.043 | 0.700 | 0.374 |
| tiny | 556 | 0.635 | 0.018 | 0.000 | 0.022 | 0.480 | 0.000 |
| band tiny | 736 | 0.565 | 0.020 | 0.000 | 0.016 | 0.433 | 0.000 |
| band small | 2459 | 0.880 | 0.046 | 0.002 | 0.067 | 0.664 | 0.327 |
| band medium | 786 | 0.991 | 0.099 | 0.000 | 0.037 | 0.810 | 0.526 |
| band large | 39 | 1.000 | 0.154 | 0.000 | 0.000 | 0.922 | 0.485 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.92, IoU 0.68 (n 929) | found 1.00, IoU 0.81 (n 208) | - |
| B | - | found 0.77, IoU 0.68 (n 61) | found 1.00, IoU 0.90 (n 20) | - |
| C | - | found 0.94, IoU 0.71 (n 535) | found 1.00, IoU 0.84 (n 163) | - |
| D | - | found 0.82, IoU 0.58 (n 697) | found 0.98, IoU 0.76 (n 252) | found 1.00, IoU 0.92 (n 33) |

Weed count error per image (detections minus reference weeds): mean 3.87, median abs 3.0, p90 abs 9.0. Detections per image median 9.0, p95 22.0, max 38; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.032 (p10 0.003); pixel recall of plants 0.032; pixel precision 0.761.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 14.64 | 17.58 |
| ms_separate | 4.6 | 5.6 |
| ms_measure | 56.62 | 63.09 |
| ms_total | 75.89 | 83.48 |

## Worst images

