# Classical baseline `S1_probhigh_0.7` on `dev_sub`

120 images, 662 reference weed observations, 1050 detections. Generated 2026-10-13T22:57:14+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.480 | 0.761 | 0.589 | 0.497 | 0.601 | 4.55 | 1.32 | 2.65 | 0.3 |
| 0.3 | 0.549 | 0.870 | 0.673 | 0.568 | 0.687 | 3.95 | 0.72 | 2.56 | 0.3 |
| 0.1 | 0.565 | 0.896 | 0.693 | 0.585 | 0.708 | 3.81 | 0.57 | 2.53 | 0.3 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1050 | 0.480 | 0.761 | 0.589 | 0.497 | 0.601 | 0.8889 | 2.65 | 0.3 |
| 4 | 928 | 0.543 | 0.761 | 0.634 | 0.557 | 0.644 | 0.8889 | 1.97 | 0.2 |
| 10 | 879 | 0.573 | 0.761 | 0.654 | 0.584 | 0.661 | 0.8889 | 1.73 | 0.13 |
| 25 | 791 | 0.635 | 0.758 | 0.691 | 0.642 | 0.695 | 0.8889 | 1.23 | 0.07 |
| 50 | 696 | 0.708 | 0.745 | 0.726 | 0.715 | 0.729 | 0.8889 | 0.75 | 0.05 |
| 100 | 587 | 0.775 | 0.687 | 0.729 | 0.780 | 0.731 | 0.8836 | 0.45 | 0.03 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.913 (172) | 0.647 (17) | 0.932 (117) | 0.772 (162) | 0.392 (51) | 0.800 (35) | 0.500 (108) | 0.432 (132) | 0.824 (392) | 0.895 (133) | 1.000 (5) |
| 0.3 | 0.983 (172) | 0.941 (17) | 0.983 (117) | 0.901 (162) | 0.569 (51) | 0.914 (35) | 0.639 (108) | 0.561 (132) | 0.946 (392) | 0.947 (133) | 1.000 (5) |
| 0.1 | 0.994 (172) | 0.941 (17) | 0.983 (117) | 0.926 (162) | 0.608 (51) | 0.971 (35) | 0.704 (108) | 0.629 (132) | 0.967 (392) | 0.947 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.854 | 0.036 | 0.003 | 0.051 | 0.669 | 0.196 |
| A | 172 | 0.954 | 0.000 | 0.000 | 0.017 | 0.696 | 0.522 |
| B | 17 | 0.824 | 0.000 | 0.000 | 0.059 | 0.703 | 0.349 |
| C | 117 | 0.966 | 0.009 | 0.000 | 0.009 | 0.728 | 0.558 |
| D | 162 | 0.920 | 0.105 | 0.000 | 0.117 | 0.683 | 0.323 |
| partial | 51 | 0.549 | 0.020 | 0.020 | 0.118 | 0.412 | 0.000 |
| touches_border | 35 | 0.886 | 0.029 | 0.029 | 0.114 | 0.715 | 0.345 |
| tiny | 108 | 0.611 | 0.037 | 0.000 | 0.000 | 0.494 | 0.000 |
| band tiny | 132 | 0.553 | 0.038 | 0.008 | 0.000 | 0.421 | 0.000 |
| band small | 392 | 0.908 | 0.020 | 0.000 | 0.069 | 0.676 | 0.407 |
| band medium | 133 | 0.985 | 0.083 | 0.007 | 0.053 | 0.810 | 0.492 |
| band large | 5 | 1.000 | 0.000 | 0.000 | 0.000 | 0.916 | 0.800 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.95, IoU 0.68 (n 148) | found 1.00, IoU 0.82 (n 24) | - |
| B | - | found 0.75, IoU 0.58 (n 12) | found 1.00, IoU 0.81 (n 5) | - |
| C | - | found 0.96, IoU 0.70 (n 93) | found 1.00, IoU 0.84 (n 24) | - |
| D | - | found 0.88, IoU 0.66 (n 100) | found 0.98, IoU 0.76 (n 58) | found 1.00, IoU 0.92 (n 4) |

Weed count error per image (detections minus reference weeds): mean 3.23, median abs 2.0, p90 abs 8.0. Detections per image median 7.5, p95 18.049999999999997, max 31; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.026 (p10 0.004); pixel recall of plants 0.026; pixel precision 0.745.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 13.13 | 15.45 |
| ms_separate | 3.91 | 5.4 |
| ms_measure | 51.04 | 60.68 |
| ms_total | 67.77 | 78.88 |

## Worst images

