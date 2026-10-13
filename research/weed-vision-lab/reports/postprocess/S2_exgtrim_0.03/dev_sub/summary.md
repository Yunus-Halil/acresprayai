# Classical baseline `S2_exgtrim_0.03` on `dev_sub`

120 images, 662 reference weed observations, 2575 detections. Generated 2026-10-13T22:57:40+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.175 | 0.683 | 0.279 | 0.181 | 0.286 | 17.69 | 1.75 | 10.62 | 0.64 |
| 0.3 | 0.215 | 0.835 | 0.342 | 0.221 | 0.350 | 16.85 | 0.91 | 10.5 | 0.64 |
| 0.1 | 0.235 | 0.912 | 0.373 | 0.242 | 0.382 | 16.43 | 0.48 | 10.5 | 0.64 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2575 | 0.175 | 0.683 | 0.279 | 0.181 | 0.286 | 0.7831 | 10.62 | 0.64 |
| 4 | 1379 | 0.328 | 0.683 | 0.443 | 0.338 | 0.452 | 0.7831 | 3.7 | 0.35 |
| 10 | 1144 | 0.395 | 0.683 | 0.501 | 0.406 | 0.510 | 0.7831 | 2.51 | 0.27 |
| 25 | 949 | 0.476 | 0.683 | 0.561 | 0.490 | 0.571 | 0.7831 | 1.52 | 0.23 |
| 50 | 800 | 0.555 | 0.671 | 0.607 | 0.569 | 0.616 | 0.7831 | 0.87 | 0.17 |
| 100 | 597 | 0.672 | 0.606 | 0.637 | 0.682 | 0.642 | 0.7513 | 0.39 | 0.07 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.796 (172) | 0.647 (17) | 0.812 (117) | 0.667 (162) | 0.412 (51) | 0.714 (35) | 0.509 (108) | 0.439 (132) | 0.704 (392) | 0.850 (133) | 1.000 (5) |
| 0.3 | 0.895 (172) | 0.824 (17) | 0.923 (117) | 0.858 (162) | 0.588 (51) | 0.857 (35) | 0.722 (108) | 0.644 (132) | 0.862 (392) | 0.940 (133) | 1.000 (5) |
| 0.1 | 0.988 (172) | 0.941 (17) | 0.992 (117) | 0.920 (162) | 0.627 (51) | 1.000 (35) | 0.796 (108) | 0.712 (132) | 0.967 (392) | 0.947 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.781 | 0.027 | 0.003 | 0.082 | 0.632 | 0.194 |
| A | 172 | 0.831 | 0.000 | 0.000 | 0.076 | 0.665 | 0.294 |
| B | 17 | 0.647 | 0.000 | 0.000 | 0.118 | 0.592 | 0.220 |
| C | 117 | 0.863 | 0.009 | 0.000 | 0.077 | 0.685 | 0.323 |
| D | 162 | 0.827 | 0.086 | 0.000 | 0.123 | 0.620 | 0.246 |
| partial | 51 | 0.549 | 0.020 | 0.020 | 0.098 | 0.381 | 0.000 |
| touches_border | 35 | 0.800 | 0.029 | 0.029 | 0.086 | 0.718 | 0.206 |
| tiny | 108 | 0.667 | 0.009 | 0.000 | 0.018 | 0.504 | 0.000 |
| band tiny | 132 | 0.614 | 0.015 | 0.008 | 0.015 | 0.450 | 0.000 |
| band small | 392 | 0.781 | 0.013 | 0.000 | 0.105 | 0.624 | 0.259 |
| band medium | 133 | 0.940 | 0.083 | 0.007 | 0.083 | 0.776 | 0.401 |
| band large | 5 | 1.000 | 0.000 | 0.000 | 0.000 | 0.896 | 0.696 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.81, IoU 0.65 (n 148) | found 0.96, IoU 0.81 (n 24) | - |
| B | - | found 0.58, IoU 0.60 (n 12) | found 0.80, IoU 0.55 (n 5) | - |
| C | - | found 0.83, IoU 0.65 (n 93) | found 1.00, IoU 0.79 (n 24) | - |
| D | - | found 0.75, IoU 0.58 (n 100) | found 0.95, IoU 0.73 (n 58) | found 1.00, IoU 0.90 (n 4) |

Weed count error per image (detections minus reference weeds): mean 15.94, median abs 12.0, p90 abs 32.0. Detections per image median 18.0, p95 48.05, max 142; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.027 (p10 0.003); pixel recall of plants 0.027; pixel precision 0.747.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 34.85 | 40.32 |
| ms_separate | 4.02 | 5.11 |
| ms_measure | 49.67 | 58.5 |
| ms_total | 88.72 | 99.75 |

## Worst images

