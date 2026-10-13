# Classical baseline `S4_probhigh_0.7_exg_0.00` on `dev_sub`

120 images, 662 reference weed observations, 1445 detections. Generated 2026-10-13T22:57:54+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.331 | 0.722 | 0.454 | 0.339 | 0.462 | 8.06 | 1.53 | 4.19 | 0.3 |
| 0.3 | 0.394 | 0.860 | 0.540 | 0.404 | 0.549 | 7.3 | 0.78 | 4.13 | 0.3 |
| 0.1 | 0.412 | 0.900 | 0.566 | 0.423 | 0.576 | 7.08 | 0.55 | 4.09 | 0.3 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1445 | 0.331 | 0.722 | 0.454 | 0.339 | 0.462 | 0.8307 | 4.19 | 0.3 |
| 4 | 1068 | 0.448 | 0.722 | 0.553 | 0.458 | 0.560 | 0.8307 | 2.25 | 0.2 |
| 10 | 967 | 0.494 | 0.722 | 0.587 | 0.503 | 0.593 | 0.8307 | 1.76 | 0.13 |
| 25 | 843 | 0.566 | 0.721 | 0.634 | 0.572 | 0.638 | 0.8307 | 1.18 | 0.07 |
| 50 | 732 | 0.638 | 0.705 | 0.670 | 0.643 | 0.673 | 0.8307 | 0.68 | 0.05 |
| 100 | 594 | 0.722 | 0.648 | 0.683 | 0.727 | 0.685 | 0.8254 | 0.33 | 0.03 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.843 (172) | 0.706 (17) | 0.889 (117) | 0.735 (162) | 0.372 (51) | 0.743 (35) | 0.491 (108) | 0.424 (132) | 0.768 (392) | 0.872 (133) | 1.000 (5) |
| 0.3 | 0.965 (172) | 0.882 (17) | 0.966 (117) | 0.901 (162) | 0.569 (51) | 0.886 (35) | 0.639 (108) | 0.561 (132) | 0.929 (392) | 0.947 (133) | 1.000 (5) |
| 0.1 | 0.988 (172) | 0.941 (17) | 0.983 (117) | 0.932 (162) | 0.608 (51) | 0.971 (35) | 0.732 (108) | 0.651 (132) | 0.967 (392) | 0.947 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.813 | 0.024 | 0.003 | 0.080 | 0.652 | 0.196 |
| A | 172 | 0.913 | 0.000 | 0.000 | 0.064 | 0.687 | 0.442 |
| B | 17 | 0.824 | 0.000 | 0.000 | 0.000 | 0.679 | 0.310 |
| C | 117 | 0.923 | 0.000 | 0.000 | 0.043 | 0.716 | 0.486 |
| D | 162 | 0.858 | 0.080 | 0.000 | 0.161 | 0.653 | 0.304 |
| partial | 51 | 0.510 | 0.020 | 0.020 | 0.098 | 0.388 | 0.000 |
| touches_border | 35 | 0.829 | 0.029 | 0.029 | 0.171 | 0.708 | 0.249 |
| tiny | 108 | 0.602 | 0.009 | 0.000 | 0.000 | 0.493 | 0.000 |
| band tiny | 132 | 0.545 | 0.015 | 0.008 | 0.000 | 0.416 | 0.000 |
| band small | 392 | 0.850 | 0.008 | 0.000 | 0.107 | 0.655 | 0.350 |
| band medium | 133 | 0.962 | 0.083 | 0.007 | 0.083 | 0.798 | 0.479 |
| band large | 5 | 1.000 | 0.000 | 0.000 | 0.000 | 0.917 | 0.768 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.91, IoU 0.66 (n 148) | found 0.96, IoU 0.83 (n 24) | - |
| B | - | found 0.75, IoU 0.55 (n 12) | found 1.00, IoU 0.79 (n 5) | - |
| C | - | found 0.90, IoU 0.69 (n 93) | found 1.00, IoU 0.83 (n 24) | - |
| D | - | found 0.79, IoU 0.61 (n 100) | found 0.97, IoU 0.75 (n 58) | found 1.00, IoU 0.92 (n 4) |

Weed count error per image (detections minus reference weeds): mean 6.53, median abs 5.0, p90 abs 13.100000000000009. Detections per image median 10.0, p95 28.14999999999999, max 79; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.025 (p10 0.004); pixel recall of plants 0.025; pixel precision 0.771.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 36.15 | 42.17 |
| ms_separate | 4.05 | 5.01 |
| ms_measure | 50.99 | 59.08 |
| ms_total | 90.92 | 101.22 |

## Worst images

