# Classical baseline `A3_prob_t0.20_r16` on `dev_sub`

120 images, 662 reference weed observations, 981 detections. Generated 2026-10-13T22:54:30+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.364 | 0.539 | 0.435 | 0.381 | 0.447 | 5.2 | 2.54 | 4.37 | 0.37 |
| 0.3 | 0.561 | 0.831 | 0.669 | 0.587 | 0.688 | 3.59 | 0.93 | 2.94 | 0.37 |
| 0.1 | 0.608 | 0.900 | 0.726 | 0.636 | 0.746 | 3.21 | 0.55 | 2.59 | 0.37 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 981 | 0.364 | 0.539 | 0.435 | 0.381 | 0.447 | 0.5767 | 4.37 | 0.37 |
| 4 | 963 | 0.371 | 0.539 | 0.439 | 0.385 | 0.449 | 0.5767 | 4.33 | 0.3 |
| 10 | 945 | 0.378 | 0.539 | 0.444 | 0.390 | 0.453 | 0.5767 | 4.23 | 0.25 |
| 25 | 910 | 0.392 | 0.539 | 0.454 | 0.403 | 0.461 | 0.5767 | 4.03 | 0.19 |
| 50 | 869 | 0.411 | 0.539 | 0.466 | 0.420 | 0.472 | 0.5767 | 3.73 | 0.17 |
| 100 | 748 | 0.464 | 0.524 | 0.492 | 0.471 | 0.496 | 0.5767 | 2.96 | 0.1 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.576 (172) | 0.588 (17) | 0.701 (117) | 0.605 (162) | 0.490 (51) | 0.714 (35) | 0.167 (108) | 0.159 (132) | 0.554 (392) | 0.857 (133) | 1.000 (5) |
| 0.3 | 0.930 (172) | 0.765 (17) | 0.957 (117) | 0.858 (162) | 0.549 (51) | 0.943 (35) | 0.602 (108) | 0.523 (132) | 0.898 (392) | 0.932 (133) | 1.000 (5) |
| 0.1 | 0.994 (172) | 0.824 (17) | 0.992 (117) | 0.901 (162) | 0.627 (51) | 1.000 (35) | 0.759 (108) | 0.682 (132) | 0.959 (392) | 0.940 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.927 | 0.067 | 0.003 | 0.015 | 0.511 | 0.191 |
| A | 172 | 0.994 | 0.000 | 0.000 | 0.006 | 0.530 | 0.343 |
| B | 17 | 0.941 | 0.235 | 0.000 | 0.000 | 0.506 | 0.113 |
| C | 117 | 0.992 | 0.034 | 0.000 | 0.000 | 0.579 | 0.353 |
| D | 162 | 0.975 | 0.179 | 0.000 | 0.043 | 0.544 | 0.230 |
| partial | 51 | 0.647 | 0.020 | 0.020 | 0.020 | 0.429 | 0.000 |
| touches_border | 35 | 0.971 | 0.029 | 0.029 | 0.000 | 0.652 | 0.342 |
| tiny | 108 | 0.796 | 0.046 | 0.000 | 0.009 | 0.356 | 0.000 |
| band tiny | 132 | 0.720 | 0.045 | 0.008 | 0.008 | 0.316 | 0.000 |
| band small | 392 | 0.977 | 0.056 | 0.000 | 0.013 | 0.513 | 0.294 |
| band medium | 133 | 0.985 | 0.120 | 0.007 | 0.030 | 0.696 | 0.441 |
| band large | 5 | 1.000 | 0.000 | 0.000 | 0.000 | 0.849 | 0.721 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.99, IoU 0.50 (n 148) | found 1.00, IoU 0.70 (n 24) | - |
| B | - | found 0.92, IoU 0.43 (n 12) | found 1.00, IoU 0.60 (n 5) | - |
| C | - | found 0.99, IoU 0.54 (n 93) | found 1.00, IoU 0.72 (n 24) | - |
| D | - | found 0.97, IoU 0.51 (n 100) | found 0.98, IoU 0.64 (n 58) | found 1.00, IoU 0.85 (n 4) |

Weed count error per image (detections minus reference weeds): mean 2.66, median abs 2.0, p90 abs 6.0. Detections per image median 7.0, p95 17.049999999999997, max 27; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.029 (p10 0.004); pixel recall of plants 0.029; pixel precision 0.492.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 70.87 | 81.78 |
| ms_separate | 3.86 | 5.14 |
| ms_measure | 48.34 | 58.04 |
| ms_total | 123.88 | 137.67 |

## Worst images

