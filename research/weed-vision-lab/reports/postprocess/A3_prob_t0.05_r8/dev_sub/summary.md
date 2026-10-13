# Classical baseline `A3_prob_t0.05_r8` on `dev_sub`

120 images, 662 reference weed observations, 953 detections. Generated 2026-10-13T22:54:23+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.214 | 0.308 | 0.253 | 0.219 | 0.256 | 6.24 | 3.82 | 5.72 | 0.17 |
| 0.3 | 0.463 | 0.666 | 0.546 | 0.473 | 0.553 | 4.27 | 1.84 | 3.91 | 0.17 |
| 0.1 | 0.624 | 0.899 | 0.737 | 0.638 | 0.746 | 2.98 | 0.56 | 2.64 | 0.17 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 953 | 0.214 | 0.308 | 0.253 | 0.219 | 0.256 | 0.2751 | 5.72 | 0.17 |
| 4 | 940 | 0.217 | 0.308 | 0.255 | 0.220 | 0.257 | 0.2751 | 5.7 | 0.12 |
| 10 | 937 | 0.218 | 0.308 | 0.255 | 0.221 | 0.257 | 0.2751 | 5.67 | 0.12 |
| 25 | 919 | 0.222 | 0.308 | 0.258 | 0.225 | 0.260 | 0.2751 | 5.54 | 0.11 |
| 50 | 888 | 0.230 | 0.308 | 0.263 | 0.232 | 0.265 | 0.2751 | 5.33 | 0.07 |
| 100 | 840 | 0.242 | 0.307 | 0.270 | 0.243 | 0.271 | 0.2751 | 4.97 | 0.05 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.267 (172) | 0.353 (17) | 0.427 (117) | 0.389 (162) | 0.314 (51) | 0.600 (35) | 0.018 (108) | 0.038 (132) | 0.240 (392) | 0.752 (133) | 1.000 (5) |
| 0.3 | 0.698 (172) | 0.706 (17) | 0.812 (117) | 0.790 (162) | 0.490 (51) | 0.829 (35) | 0.296 (108) | 0.265 (132) | 0.709 (392) | 0.925 (133) | 1.000 (5) |
| 0.1 | 0.994 (172) | 0.824 (17) | 0.992 (117) | 0.901 (162) | 0.627 (51) | 1.000 (35) | 0.750 (108) | 0.674 (132) | 0.959 (392) | 0.940 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.927 | 0.067 | 0.003 | 0.014 | 0.393 | 0.137 |
| A | 172 | 0.994 | 0.000 | 0.000 | 0.000 | 0.391 | 0.242 |
| B | 17 | 0.941 | 0.235 | 0.000 | 0.000 | 0.407 | 0.084 |
| C | 117 | 0.992 | 0.034 | 0.000 | 0.000 | 0.452 | 0.240 |
| D | 162 | 0.975 | 0.179 | 0.000 | 0.043 | 0.451 | 0.185 |
| partial | 51 | 0.647 | 0.020 | 0.020 | 0.020 | 0.296 | 0.000 |
| touches_border | 35 | 0.971 | 0.029 | 0.029 | 0.000 | 0.579 | 0.252 |
| tiny | 108 | 0.796 | 0.046 | 0.000 | 0.009 | 0.234 | 0.000 |
| band tiny | 132 | 0.720 | 0.045 | 0.008 | 0.008 | 0.203 | 0.000 |
| band small | 392 | 0.977 | 0.056 | 0.000 | 0.010 | 0.391 | 0.205 |
| band medium | 133 | 0.985 | 0.120 | 0.007 | 0.030 | 0.610 | 0.386 |
| band large | 5 | 1.000 | 0.000 | 0.000 | 0.000 | 0.807 | 0.657 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.99, IoU 0.36 (n 148) | found 1.00, IoU 0.63 (n 24) | - |
| B | - | found 0.92, IoU 0.35 (n 12) | found 1.00, IoU 0.51 (n 5) | - |
| C | - | found 0.99, IoU 0.42 (n 93) | found 1.00, IoU 0.63 (n 24) | - |
| D | - | found 0.97, IoU 0.40 (n 100) | found 0.98, IoU 0.58 (n 58) | found 1.00, IoU 0.81 (n 4) |

Weed count error per image (detections minus reference weeds): mean 2.42, median abs 2.0, p90 abs 6.0. Detections per image median 7.0, p95 16.049999999999997, max 27; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.028 (p10 0.004); pixel recall of plants 0.030; pixel precision 0.375.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 73.19 | 83.57 |
| ms_separate | 3.86 | 4.98 |
| ms_measure | 49.26 | 57.19 |
| ms_total | 127.93 | 137.77 |

## Worst images

