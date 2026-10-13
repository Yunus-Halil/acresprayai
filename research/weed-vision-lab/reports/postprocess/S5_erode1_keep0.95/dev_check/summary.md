# Classical baseline `S5_erode1_keep0.95` on `dev_check`

690 images, 4020 reference weed observations, 6324 detections. Generated 2026-10-13T23:06:56+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.478 | 0.753 | 0.585 | 0.502 | 0.602 | 4.78 | 1.44 | 2.83 | 0.43 |
| 0.3 | 0.559 | 0.880 | 0.684 | 0.586 | 0.704 | 4.04 | 0.7 | 2.69 | 0.42 |
| 0.1 | 0.580 | 0.912 | 0.709 | 0.608 | 0.730 | 3.85 | 0.51 | 2.67 | 0.42 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 6324 | 0.478 | 0.753 | 0.585 | 0.502 | 0.602 | 0.8842 | 2.83 | 0.43 |
| 4 | 5749 | 0.526 | 0.753 | 0.620 | 0.547 | 0.634 | 0.8842 | 2.27 | 0.32 |
| 10 | 5320 | 0.569 | 0.753 | 0.648 | 0.586 | 0.659 | 0.8842 | 1.86 | 0.22 |
| 25 | 4791 | 0.630 | 0.751 | 0.685 | 0.644 | 0.694 | 0.8842 | 1.38 | 0.16 |
| 50 | 4249 | 0.698 | 0.738 | 0.717 | 0.711 | 0.724 | 0.8842 | 0.92 | 0.11 |
| 100 | 3516 | 0.766 | 0.670 | 0.715 | 0.773 | 0.718 | 0.8571 | 0.53 | 0.04 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.887 (1137) | 0.840 (81) | 0.914 (698) | 0.701 (982) | 0.430 (286) | 0.779 (280) | 0.507 (556) | 0.454 (736) | 0.788 (2459) | 0.916 (786) | 0.872 (39) |
| 0.3 | 0.978 (1137) | 0.951 (81) | 0.984 (698) | 0.863 (982) | 0.545 (286) | 0.907 (280) | 0.725 (556) | 0.652 (736) | 0.922 (2459) | 0.958 (786) | 0.923 (39) |
| 0.1 | 0.990 (1137) | 0.963 (81) | 0.991 (698) | 0.885 (982) | 0.619 (286) | 0.943 (280) | 0.829 (556) | 0.764 (736) | 0.940 (2459) | 0.963 (786) | 0.923 (39) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4020 | 0.870 | 0.062 | 0.001 | 0.030 | 0.669 | 0.250 |
| A | 1137 | 0.959 | 0.000 | 0.000 | 0.013 | 0.707 | 0.490 |
| B | 81 | 0.876 | 0.025 | 0.000 | 0.049 | 0.741 | 0.327 |
| C | 698 | 0.964 | 0.011 | 0.000 | 0.020 | 0.739 | 0.515 |
| D | 982 | 0.891 | 0.179 | 0.002 | 0.063 | 0.632 | 0.244 |
| partial | 286 | 0.514 | 0.056 | 0.000 | 0.028 | 0.374 | 0.000 |
| touches_border | 280 | 0.911 | 0.096 | 0.000 | 0.025 | 0.708 | 0.351 |
| tiny | 556 | 0.692 | 0.036 | 0.000 | 0.016 | 0.505 | 0.000 |
| band tiny | 736 | 0.610 | 0.035 | 0.000 | 0.015 | 0.452 | 0.000 |
| band small | 2459 | 0.907 | 0.054 | 0.001 | 0.037 | 0.667 | 0.346 |
| band medium | 786 | 0.989 | 0.102 | 0.000 | 0.023 | 0.812 | 0.551 |
| band large | 39 | 1.000 | 0.256 | 0.000 | 0.000 | 0.916 | 0.489 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.95, IoU 0.68 (n 929) | found 1.00, IoU 0.82 (n 208) | - |
| B | - | found 0.84, IoU 0.67 (n 61) | found 1.00, IoU 0.87 (n 20) | - |
| C | - | found 0.95, IoU 0.70 (n 535) | found 1.00, IoU 0.84 (n 163) | - |
| D | - | found 0.85, IoU 0.60 (n 697) | found 0.98, IoU 0.76 (n 252) | found 1.00, IoU 0.92 (n 33) |

Weed count error per image (detections minus reference weeds): mean 3.34, median abs 3.0, p90 abs 8.0. Detections per image median 8.0, p95 20.0, max 37; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.032 (p10 0.003); pixel recall of plants 0.032; pixel precision 0.765.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 19.93 | 23.07 |
| ms_separate | 4.51 | 5.6 |
| ms_measure | 56.09 | 62.89 |
| ms_total | 80.56 | 88.73 |

## Worst images

