# Classical baseline `S1_probhigh_0.6` on `dev_sub`

120 images, 662 reference weed observations, 1080 detections. Generated 2026-10-13T22:57:07+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.467 | 0.761 | 0.579 | 0.486 | 0.594 | 4.8 | 1.32 | 3.26 | 0.37 |
| 0.3 | 0.540 | 0.881 | 0.669 | 0.563 | 0.687 | 4.14 | 0.66 | 3.04 | 0.37 |
| 0.1 | 0.556 | 0.906 | 0.689 | 0.579 | 0.707 | 4.0 | 0.52 | 2.99 | 0.37 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1080 | 0.467 | 0.761 | 0.579 | 0.486 | 0.594 | 0.8783 | 3.26 | 0.37 |
| 4 | 945 | 0.533 | 0.761 | 0.627 | 0.550 | 0.638 | 0.8783 | 2.4 | 0.23 |
| 10 | 896 | 0.562 | 0.761 | 0.647 | 0.578 | 0.657 | 0.8783 | 2.07 | 0.2 |
| 25 | 820 | 0.615 | 0.761 | 0.680 | 0.629 | 0.689 | 0.8783 | 1.6 | 0.16 |
| 50 | 733 | 0.681 | 0.754 | 0.715 | 0.692 | 0.722 | 0.8783 | 1.12 | 0.1 |
| 100 | 621 | 0.754 | 0.707 | 0.730 | 0.761 | 0.733 | 0.873 | 0.68 | 0.05 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.901 (172) | 0.647 (17) | 0.914 (117) | 0.778 (162) | 0.451 (51) | 0.886 (35) | 0.472 (108) | 0.409 (132) | 0.832 (392) | 0.895 (133) | 1.000 (5) |
| 0.3 | 0.994 (172) | 0.941 (17) | 0.974 (117) | 0.907 (162) | 0.569 (51) | 0.886 (35) | 0.694 (108) | 0.599 (132) | 0.952 (392) | 0.947 (133) | 1.000 (5) |
| 0.1 | 0.994 (172) | 0.941 (17) | 0.992 (117) | 0.932 (162) | 0.608 (51) | 0.971 (35) | 0.750 (108) | 0.667 (132) | 0.972 (392) | 0.947 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.881 | 0.036 | 0.003 | 0.033 | 0.657 | 0.206 |
| A | 172 | 0.983 | 0.000 | 0.000 | 0.000 | 0.672 | 0.505 |
| B | 17 | 0.882 | 0.000 | 0.000 | 0.059 | 0.673 | 0.398 |
| C | 117 | 0.974 | 0.009 | 0.000 | 0.009 | 0.721 | 0.526 |
| D | 162 | 0.926 | 0.105 | 0.000 | 0.086 | 0.673 | 0.334 |
| partial | 51 | 0.588 | 0.020 | 0.020 | 0.078 | 0.470 | 0.000 |
| touches_border | 35 | 0.914 | 0.029 | 0.029 | 0.057 | 0.729 | 0.379 |
| tiny | 108 | 0.676 | 0.037 | 0.000 | 0.000 | 0.479 | 0.000 |
| band tiny | 132 | 0.606 | 0.038 | 0.008 | 0.000 | 0.437 | 0.000 |
| band small | 392 | 0.936 | 0.020 | 0.000 | 0.043 | 0.654 | 0.427 |
| band medium | 133 | 0.985 | 0.083 | 0.007 | 0.038 | 0.790 | 0.500 |
| band large | 5 | 1.000 | 0.000 | 0.000 | 0.000 | 0.902 | 0.787 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.98, IoU 0.65 (n 148) | found 1.00, IoU 0.80 (n 24) | - |
| B | - | found 0.83, IoU 0.54 (n 12) | found 1.00, IoU 0.79 (n 5) | - |
| C | - | found 0.97, IoU 0.69 (n 93) | found 1.00, IoU 0.82 (n 24) | - |
| D | - | found 0.89, IoU 0.63 (n 100) | found 0.98, IoU 0.74 (n 58) | found 1.00, IoU 0.90 (n 4) |

Weed count error per image (detections minus reference weeds): mean 3.48, median abs 3.0, p90 abs 8.0. Detections per image median 8.0, p95 19.049999999999997, max 29; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.027 (p10 0.004); pixel recall of plants 0.027; pixel precision 0.694.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 13.18 | 16.1 |
| ms_separate | 4.12 | 5.11 |
| ms_measure | 51.58 | 59.3 |
| ms_total | 68.88 | 79.35 |

## Worst images

