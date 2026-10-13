# Classical baseline `S3_erode_1` on `dev_sub`

120 images, 662 reference weed observations, 1008 detections. Generated 2026-10-13T22:57:47+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.507 | 0.772 | 0.612 | 0.526 | 0.626 | 4.14 | 1.26 | 2.67 | 0.31 |
| 0.3 | 0.575 | 0.876 | 0.695 | 0.597 | 0.710 | 3.57 | 0.68 | 2.57 | 0.31 |
| 0.1 | 0.596 | 0.908 | 0.720 | 0.619 | 0.736 | 3.39 | 0.51 | 2.52 | 0.31 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1008 | 0.507 | 0.772 | 0.612 | 0.526 | 0.626 | 0.9048 | 2.67 | 0.31 |
| 4 | 920 | 0.555 | 0.772 | 0.646 | 0.574 | 0.658 | 0.9048 | 2.09 | 0.25 |
| 10 | 865 | 0.591 | 0.772 | 0.669 | 0.609 | 0.681 | 0.9048 | 1.73 | 0.22 |
| 25 | 780 | 0.653 | 0.769 | 0.706 | 0.670 | 0.716 | 0.9048 | 1.23 | 0.17 |
| 50 | 689 | 0.723 | 0.752 | 0.737 | 0.737 | 0.744 | 0.9048 | 0.77 | 0.11 |
| 100 | 564 | 0.796 | 0.678 | 0.733 | 0.805 | 0.736 | 0.873 | 0.43 | 0.05 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.924 (172) | 0.706 (17) | 0.940 (117) | 0.784 (162) | 0.392 (51) | 0.886 (35) | 0.481 (108) | 0.417 (132) | 0.847 (392) | 0.895 (133) | 1.000 (5) |
| 0.3 | 0.988 (172) | 0.941 (17) | 0.983 (117) | 0.907 (162) | 0.549 (51) | 0.914 (35) | 0.667 (108) | 0.583 (132) | 0.949 (392) | 0.947 (133) | 1.000 (5) |
| 0.1 | 0.994 (172) | 0.941 (17) | 0.992 (117) | 0.932 (162) | 0.588 (51) | 1.000 (35) | 0.759 (108) | 0.667 (132) | 0.975 (392) | 0.947 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.867 | 0.033 | 0.000 | 0.029 | 0.668 | 0.216 |
| A | 172 | 0.977 | 0.000 | 0.000 | 0.000 | 0.689 | 0.539 |
| B | 17 | 0.941 | 0.000 | 0.000 | 0.000 | 0.691 | 0.457 |
| C | 117 | 0.983 | 0.009 | 0.000 | 0.000 | 0.724 | 0.573 |
| D | 162 | 0.926 | 0.105 | 0.000 | 0.080 | 0.684 | 0.359 |
| partial | 51 | 0.490 | 0.000 | 0.000 | 0.078 | 0.391 | 0.000 |
| touches_border | 35 | 0.914 | 0.000 | 0.000 | 0.057 | 0.739 | 0.400 |
| tiny | 108 | 0.630 | 0.037 | 0.000 | 0.000 | 0.483 | 0.000 |
| band tiny | 132 | 0.561 | 0.030 | 0.000 | 0.000 | 0.395 | 0.000 |
| band small | 392 | 0.931 | 0.020 | 0.000 | 0.038 | 0.665 | 0.446 |
| band medium | 133 | 0.977 | 0.075 | 0.000 | 0.030 | 0.809 | 0.498 |
| band large | 5 | 1.000 | 0.000 | 0.000 | 0.000 | 0.925 | 0.796 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.97, IoU 0.67 (n 148) | found 1.00, IoU 0.83 (n 24) | - |
| B | - | found 0.92, IoU 0.60 (n 12) | found 1.00, IoU 0.81 (n 5) | - |
| C | - | found 0.98, IoU 0.71 (n 93) | found 1.00, IoU 0.84 (n 24) | - |
| D | - | found 0.89, IoU 0.64 (n 100) | found 0.98, IoU 0.77 (n 58) | found 1.00, IoU 0.93 (n 4) |

Weed count error per image (detections minus reference weeds): mean 2.88, median abs 2.0, p90 abs 8.0. Detections per image median 7.0, p95 17.0, max 28; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.026 (p10 0.003); pixel recall of plants 0.026; pixel precision 0.749.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 15.62 | 19.12 |
| ms_separate | 3.87 | 4.63 |
| ms_measure | 48.58 | 59.67 |
| ms_total | 68.5 | 81.39 |

## Worst images

