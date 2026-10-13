# Classical baseline `C4_erode1keep0.95_adaptive_h4_p5_s0.50` on `dev_check`

690 images, 4020 reference weed observations, 6462 detections. Generated 2026-10-13T23:07:21+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.466 | 0.750 | 0.575 | 0.489 | 0.592 | 5.0 | 1.46 | 2.84 | 0.43 |
| 0.3 | 0.550 | 0.885 | 0.679 | 0.577 | 0.698 | 4.21 | 0.67 | 2.7 | 0.43 |
| 0.1 | 0.571 | 0.918 | 0.704 | 0.598 | 0.724 | 4.02 | 0.48 | 2.68 | 0.42 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 6462 | 0.466 | 0.750 | 0.575 | 0.489 | 0.592 | 0.8826 | 2.84 | 0.43 |
| 4 | 5887 | 0.512 | 0.750 | 0.608 | 0.532 | 0.622 | 0.8826 | 2.28 | 0.32 |
| 10 | 5458 | 0.552 | 0.750 | 0.636 | 0.568 | 0.646 | 0.8826 | 1.87 | 0.23 |
| 25 | 4929 | 0.610 | 0.748 | 0.672 | 0.624 | 0.680 | 0.8826 | 1.39 | 0.16 |
| 50 | 4387 | 0.673 | 0.735 | 0.703 | 0.686 | 0.709 | 0.8826 | 0.93 | 0.12 |
| 100 | 3654 | 0.734 | 0.667 | 0.699 | 0.741 | 0.702 | 0.8555 | 0.54 | 0.05 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.886 (1137) | 0.840 (81) | 0.905 (698) | 0.716 (982) | 0.413 (286) | 0.725 (280) | 0.507 (556) | 0.454 (736) | 0.792 (2459) | 0.892 (786) | 0.795 (39) |
| 0.3 | 0.978 (1137) | 0.951 (81) | 0.984 (698) | 0.885 (982) | 0.545 (286) | 0.904 (280) | 0.725 (556) | 0.652 (736) | 0.926 (2459) | 0.973 (786) | 0.897 (39) |
| 0.1 | 0.990 (1137) | 0.963 (81) | 0.991 (698) | 0.907 (982) | 0.619 (286) | 0.943 (280) | 0.829 (556) | 0.764 (736) | 0.945 (2459) | 0.976 (786) | 0.923 (39) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4020 | 0.862 | 0.052 | 0.001 | 0.043 | 0.666 | 0.264 |
| A | 1137 | 0.958 | 0.000 | 0.000 | 0.016 | 0.707 | 0.489 |
| B | 81 | 0.876 | 0.025 | 0.000 | 0.049 | 0.741 | 0.327 |
| C | 698 | 0.959 | 0.011 | 0.000 | 0.034 | 0.732 | 0.504 |
| D | 982 | 0.880 | 0.144 | 0.002 | 0.082 | 0.632 | 0.282 |
| partial | 286 | 0.503 | 0.056 | 0.000 | 0.042 | 0.374 | 0.000 |
| touches_border | 280 | 0.864 | 0.082 | 0.000 | 0.082 | 0.683 | 0.346 |
| tiny | 556 | 0.692 | 0.036 | 0.000 | 0.020 | 0.505 | 0.000 |
| band tiny | 736 | 0.610 | 0.035 | 0.000 | 0.018 | 0.452 | 0.000 |
| band small | 2459 | 0.907 | 0.048 | 0.001 | 0.037 | 0.667 | 0.358 |
| band medium | 786 | 0.952 | 0.071 | 0.000 | 0.084 | 0.810 | 0.480 |
| band large | 39 | 0.923 | 0.256 | 0.000 | 0.077 | 0.916 | 0.362 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.95, IoU 0.68 (n 929) | found 1.00, IoU 0.82 (n 208) | - |
| B | - | found 0.84, IoU 0.67 (n 61) | found 1.00, IoU 0.87 (n 20) | - |
| C | - | found 0.95, IoU 0.70 (n 535) | found 0.98, IoU 0.83 (n 163) | - |
| D | - | found 0.85, IoU 0.60 (n 697) | found 0.94, IoU 0.75 (n 252) | found 0.97, IoU 0.92 (n 33) |

Weed count error per image (detections minus reference weeds): mean 3.54, median abs 3.0, p90 abs 8.0. Detections per image median 8.0, p95 21.0, max 37; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.032 (p10 0.003); pixel recall of plants 0.032; pixel precision 0.765.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 19.89 | 22.87 |
| ms_separate | 22.05 | 36.0 |
| ms_measure | 55.31 | 61.39 |
| ms_total | 97.72 | 114.17 |

## Worst images

