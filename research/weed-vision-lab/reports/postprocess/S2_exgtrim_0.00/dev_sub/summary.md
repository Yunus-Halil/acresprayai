# Classical baseline `S2_exgtrim_0.00` on `dev_sub`

120 images, 662 reference weed observations, 1894 detections. Generated 2026-10-13T22:57:33+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.252 | 0.721 | 0.373 | 0.262 | 0.385 | 11.81 | 1.54 | 8.03 | 0.62 |
| 0.3 | 0.309 | 0.884 | 0.458 | 0.322 | 0.472 | 10.91 | 0.64 | 7.75 | 0.62 |
| 0.1 | 0.320 | 0.915 | 0.474 | 0.333 | 0.488 | 10.73 | 0.47 | 7.71 | 0.62 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1894 | 0.252 | 0.721 | 0.373 | 0.262 | 0.385 | 0.8254 | 8.03 | 0.62 |
| 4 | 1219 | 0.391 | 0.721 | 0.507 | 0.405 | 0.519 | 0.8254 | 3.77 | 0.35 |
| 10 | 1070 | 0.446 | 0.721 | 0.551 | 0.460 | 0.561 | 0.8254 | 2.86 | 0.28 |
| 25 | 929 | 0.513 | 0.721 | 0.600 | 0.529 | 0.610 | 0.8254 | 1.98 | 0.23 |
| 50 | 794 | 0.593 | 0.712 | 0.647 | 0.611 | 0.657 | 0.8254 | 1.28 | 0.19 |
| 100 | 656 | 0.678 | 0.672 | 0.675 | 0.689 | 0.680 | 0.8254 | 0.74 | 0.08 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.831 (172) | 0.765 (17) | 0.880 (117) | 0.735 (162) | 0.412 (51) | 0.800 (35) | 0.463 (108) | 0.409 (132) | 0.770 (392) | 0.872 (133) | 1.000 (5) |
| 0.3 | 0.971 (172) | 0.882 (17) | 0.966 (117) | 0.914 (162) | 0.588 (51) | 0.886 (35) | 0.750 (108) | 0.659 (132) | 0.936 (392) | 0.947 (133) | 1.000 (5) |
| 0.1 | 0.988 (172) | 0.941 (17) | 0.992 (117) | 0.932 (162) | 0.627 (51) | 1.000 (35) | 0.796 (108) | 0.712 (132) | 0.972 (392) | 0.947 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.863 | 0.027 | 0.003 | 0.063 | 0.624 | 0.226 |
| A | 172 | 0.930 | 0.000 | 0.000 | 0.052 | 0.651 | 0.446 |
| B | 17 | 0.882 | 0.000 | 0.000 | 0.000 | 0.638 | 0.345 |
| C | 117 | 0.957 | 0.009 | 0.000 | 0.026 | 0.701 | 0.480 |
| D | 162 | 0.895 | 0.086 | 0.000 | 0.123 | 0.614 | 0.331 |
| partial | 51 | 0.569 | 0.020 | 0.020 | 0.098 | 0.391 | 0.000 |
| touches_border | 35 | 0.886 | 0.029 | 0.029 | 0.114 | 0.693 | 0.250 |
| tiny | 108 | 0.732 | 0.009 | 0.000 | 0.009 | 0.481 | 0.000 |
| band tiny | 132 | 0.667 | 0.015 | 0.008 | 0.008 | 0.445 | 0.000 |
| band small | 392 | 0.893 | 0.013 | 0.000 | 0.084 | 0.623 | 0.379 |
| band medium | 133 | 0.962 | 0.083 | 0.007 | 0.060 | 0.774 | 0.472 |
| band large | 5 | 1.000 | 0.000 | 0.000 | 0.000 | 0.892 | 0.744 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.93, IoU 0.63 (n 148) | found 0.96, IoU 0.79 (n 24) | - |
| B | - | found 0.83, IoU 0.57 (n 12) | found 1.00, IoU 0.77 (n 5) | - |
| C | - | found 0.95, IoU 0.66 (n 93) | found 1.00, IoU 0.80 (n 24) | - |
| D | - | found 0.85, IoU 0.59 (n 100) | found 0.97, IoU 0.71 (n 58) | found 1.00, IoU 0.89 (n 4) |

Weed count error per image (detections minus reference weeds): mean 10.27, median abs 8.0, p90 abs 20.10000000000001. Detections per image median 13.5, p95 38.05, max 93; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.028 (p10 0.004); pixel recall of plants 0.028; pixel precision 0.686.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 34.41 | 40.46 |
| ms_separate | 4.04 | 5.25 |
| ms_measure | 49.84 | 58.14 |
| ms_total | 88.91 | 97.95 |

## Worst images

