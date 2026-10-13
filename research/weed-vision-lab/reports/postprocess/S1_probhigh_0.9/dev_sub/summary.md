# Classical baseline `S1_probhigh_0.9` on `dev_sub`

120 images, 662 reference weed observations, 1073 detections. Generated 2026-10-13T22:57:26+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.381 | 0.618 | 0.471 | 0.384 | 0.474 | 5.53 | 2.11 | 1.65 | 0.07 |
| 0.3 | 0.466 | 0.755 | 0.576 | 0.469 | 0.579 | 4.78 | 1.35 | 1.65 | 0.07 |
| 0.1 | 0.517 | 0.838 | 0.640 | 0.521 | 0.643 | 4.32 | 0.89 | 1.63 | 0.07 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1073 | 0.381 | 0.618 | 0.471 | 0.384 | 0.474 | 0.7249 | 1.65 | 0.07 |
| 4 | 952 | 0.430 | 0.618 | 0.507 | 0.431 | 0.508 | 0.7249 | 1.12 | 0.03 |
| 10 | 873 | 0.469 | 0.618 | 0.533 | 0.471 | 0.534 | 0.7249 | 0.84 | 0.03 |
| 25 | 758 | 0.540 | 0.618 | 0.576 | 0.542 | 0.577 | 0.7249 | 0.43 | 0.03 |
| 50 | 652 | 0.606 | 0.597 | 0.601 | 0.609 | 0.603 | 0.7249 | 0.22 | 0.03 |
| 100 | 507 | 0.692 | 0.530 | 0.601 | 0.695 | 0.602 | 0.6614 | 0.14 | 0.02 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.733 (172) | 0.647 (17) | 0.821 (117) | 0.660 (162) | 0.275 (51) | 0.657 (35) | 0.296 (108) | 0.258 (132) | 0.658 (392) | 0.842 (133) | 1.000 (5) |
| 0.3 | 0.895 (172) | 0.824 (17) | 0.906 (117) | 0.809 (162) | 0.451 (51) | 0.771 (35) | 0.417 (108) | 0.364 (132) | 0.821 (392) | 0.940 (133) | 1.000 (5) |
| 0.1 | 0.971 (172) | 0.941 (17) | 0.966 (117) | 0.901 (162) | 0.529 (51) | 0.857 (35) | 0.518 (108) | 0.455 (132) | 0.931 (392) | 0.940 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.656 | 0.024 | 0.003 | 0.059 | 0.586 | 0.000 |
| A | 172 | 0.779 | 0.000 | 0.000 | 0.070 | 0.634 | 0.298 |
| B | 17 | 0.647 | 0.000 | 0.000 | 0.059 | 0.678 | 0.213 |
| C | 117 | 0.821 | 0.000 | 0.000 | 0.043 | 0.701 | 0.312 |
| D | 162 | 0.735 | 0.074 | 0.000 | 0.093 | 0.598 | 0.197 |
| partial | 51 | 0.294 | 0.020 | 0.020 | 0.078 | 0.146 | 0.000 |
| touches_border | 35 | 0.657 | 0.029 | 0.029 | 0.057 | 0.696 | 0.074 |
| tiny | 108 | 0.333 | 0.018 | 0.000 | 0.000 | 0.170 | 0.000 |
| band tiny | 132 | 0.295 | 0.023 | 0.008 | 0.000 | 0.000 | 0.000 |
| band small | 392 | 0.684 | 0.005 | 0.000 | 0.074 | 0.592 | 0.170 |
| band medium | 133 | 0.917 | 0.083 | 0.007 | 0.075 | 0.807 | 0.424 |
| band large | 5 | 1.000 | 0.000 | 0.000 | 0.000 | 0.891 | 0.788 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.75, IoU 0.60 (n 148) | found 0.96, IoU 0.86 (n 24) | - |
| B | - | found 0.58, IoU 0.62 (n 12) | found 0.80, IoU 0.80 (n 5) | - |
| C | - | found 0.78, IoU 0.68 (n 93) | found 0.96, IoU 0.83 (n 24) | - |
| D | - | found 0.61, IoU 0.55 (n 100) | found 0.93, IoU 0.73 (n 58) | found 1.00, IoU 0.89 (n 4) |

Weed count error per image (detections minus reference weeds): mean 3.42, median abs 3.0, p90 abs 8.100000000000009. Detections per image median 8.0, p95 20.0, max 31; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.022 (p10 0.003); pixel recall of plants 0.022; pixel precision 0.898.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 12.22 | 15.13 |
| ms_separate | 3.9 | 4.96 |
| ms_measure | 49.81 | 54.54 |
| ms_total | 66.21 | 71.83 |

## Worst images

