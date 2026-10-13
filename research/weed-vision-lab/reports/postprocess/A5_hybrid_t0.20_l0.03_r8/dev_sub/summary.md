# Classical baseline `A5_hybrid_t0.20_l0.03_r8` on `dev_sub`

120 images, 662 reference weed observations, 977 detections. Generated 2026-10-13T22:55:07+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.357 | 0.527 | 0.426 | 0.373 | 0.437 | 5.23 | 2.61 | 4.46 | 0.34 |
| 0.3 | 0.560 | 0.826 | 0.667 | 0.584 | 0.685 | 3.58 | 0.96 | 2.99 | 0.34 |
| 0.1 | 0.610 | 0.900 | 0.727 | 0.637 | 0.746 | 3.17 | 0.55 | 2.62 | 0.34 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 977 | 0.357 | 0.527 | 0.426 | 0.373 | 0.437 | 0.5714 | 4.46 | 0.34 |
| 4 | 963 | 0.362 | 0.527 | 0.429 | 0.376 | 0.439 | 0.5714 | 4.43 | 0.29 |
| 10 | 950 | 0.367 | 0.527 | 0.433 | 0.379 | 0.441 | 0.5714 | 4.37 | 0.25 |
| 25 | 918 | 0.380 | 0.527 | 0.442 | 0.390 | 0.448 | 0.5714 | 4.18 | 0.19 |
| 50 | 873 | 0.400 | 0.527 | 0.455 | 0.409 | 0.461 | 0.5714 | 3.85 | 0.17 |
| 100 | 752 | 0.452 | 0.514 | 0.481 | 0.460 | 0.485 | 0.5714 | 3.07 | 0.1 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.576 (172) | 0.529 (17) | 0.684 (117) | 0.580 (162) | 0.490 (51) | 0.714 (35) | 0.157 (108) | 0.151 (132) | 0.536 (392) | 0.857 (133) | 1.000 (5) |
| 0.3 | 0.936 (172) | 0.765 (17) | 0.949 (117) | 0.846 (162) | 0.549 (51) | 0.943 (35) | 0.593 (108) | 0.515 (132) | 0.893 (392) | 0.932 (133) | 1.000 (5) |
| 0.1 | 0.994 (172) | 0.824 (17) | 0.992 (117) | 0.901 (162) | 0.627 (51) | 1.000 (35) | 0.759 (108) | 0.682 (132) | 0.959 (392) | 0.940 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.927 | 0.067 | 0.003 | 0.015 | 0.507 | 0.189 |
| A | 172 | 0.994 | 0.000 | 0.000 | 0.006 | 0.530 | 0.349 |
| B | 17 | 0.941 | 0.235 | 0.000 | 0.000 | 0.504 | 0.114 |
| C | 117 | 0.992 | 0.034 | 0.000 | 0.000 | 0.549 | 0.353 |
| D | 162 | 0.975 | 0.179 | 0.000 | 0.043 | 0.538 | 0.227 |
| partial | 51 | 0.647 | 0.020 | 0.020 | 0.020 | 0.424 | 0.000 |
| touches_border | 35 | 0.971 | 0.029 | 0.029 | 0.000 | 0.651 | 0.342 |
| tiny | 108 | 0.796 | 0.046 | 0.000 | 0.009 | 0.354 | 0.000 |
| band tiny | 132 | 0.720 | 0.045 | 0.008 | 0.008 | 0.313 | 0.000 |
| band small | 392 | 0.977 | 0.056 | 0.000 | 0.013 | 0.507 | 0.293 |
| band medium | 133 | 0.985 | 0.120 | 0.007 | 0.030 | 0.693 | 0.440 |
| band large | 5 | 1.000 | 0.000 | 0.000 | 0.000 | 0.849 | 0.705 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.99, IoU 0.50 (n 148) | found 1.00, IoU 0.70 (n 24) | - |
| B | - | found 0.92, IoU 0.43 (n 12) | found 1.00, IoU 0.60 (n 5) | - |
| C | - | found 0.99, IoU 0.53 (n 93) | found 1.00, IoU 0.71 (n 24) | - |
| D | - | found 0.97, IoU 0.48 (n 100) | found 0.98, IoU 0.64 (n 58) | found 1.00, IoU 0.85 (n 4) |

Weed count error per image (detections minus reference weeds): mean 2.62, median abs 2.0, p90 abs 6.0. Detections per image median 7.0, p95 17.049999999999997, max 27; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.028 (p10 0.004); pixel recall of plants 0.029; pixel precision 0.495.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 298.87 | 316.74 |
| ms_separate | 4.06 | 5.12 |
| ms_measure | 48.8 | 56.4 |
| ms_total | 351.64 | 371.51 |

## Worst images

