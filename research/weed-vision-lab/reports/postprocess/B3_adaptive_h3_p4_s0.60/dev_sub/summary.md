# Classical baseline `B3_adaptive_h3_p4_s0.60` on `dev_sub`

120 images, 662 reference weed observations, 1289 detections. Generated 2026-10-13T22:55:33+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.376 | 0.731 | 0.496 | 0.397 | 0.515 | 6.71 | 1.48 | 4.8 | 0.58 |
| 0.3 | 0.462 | 0.899 | 0.610 | 0.488 | 0.633 | 5.78 | 0.56 | 4.33 | 0.58 |
| 0.1 | 0.472 | 0.920 | 0.624 | 0.500 | 0.647 | 5.67 | 0.44 | 4.26 | 0.58 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1289 | 0.376 | 0.731 | 0.496 | 0.397 | 0.515 | 0.8201 | 4.8 | 0.58 |
| 4 | 1055 | 0.459 | 0.731 | 0.564 | 0.476 | 0.577 | 0.8201 | 3.27 | 0.32 |
| 10 | 993 | 0.487 | 0.731 | 0.585 | 0.503 | 0.596 | 0.8201 | 2.83 | 0.25 |
| 25 | 899 | 0.538 | 0.731 | 0.620 | 0.554 | 0.631 | 0.8201 | 2.17 | 0.22 |
| 50 | 815 | 0.587 | 0.722 | 0.647 | 0.602 | 0.657 | 0.8201 | 1.69 | 0.17 |
| 100 | 695 | 0.658 | 0.690 | 0.673 | 0.668 | 0.679 | 0.8201 | 1.1 | 0.09 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.826 (172) | 0.765 (17) | 0.863 (117) | 0.802 (162) | 0.431 (51) | 0.771 (35) | 0.454 (108) | 0.402 (132) | 0.781 (392) | 0.910 (133) | 0.800 (5) |
| 0.3 | 0.994 (172) | 0.941 (17) | 0.974 (117) | 0.938 (162) | 0.588 (51) | 0.914 (35) | 0.741 (108) | 0.644 (132) | 0.957 (392) | 0.977 (133) | 1.000 (5) |
| 0.1 | 0.994 (172) | 0.941 (17) | 1.000 (117) | 0.957 (162) | 0.627 (51) | 1.000 (35) | 0.768 (108) | 0.689 (132) | 0.977 (392) | 0.977 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.900 | 0.027 | 0.003 | 0.051 | 0.622 | 0.302 |
| A | 172 | 0.983 | 0.000 | 0.000 | 0.023 | 0.649 | 0.465 |
| B | 17 | 0.941 | 0.000 | 0.000 | 0.000 | 0.625 | 0.424 |
| C | 117 | 0.983 | 0.009 | 0.000 | 0.043 | 0.667 | 0.459 |
| D | 162 | 0.944 | 0.068 | 0.000 | 0.093 | 0.647 | 0.407 |
| partial | 51 | 0.608 | 0.020 | 0.020 | 0.118 | 0.381 | 0.000 |
| touches_border | 35 | 0.914 | 0.029 | 0.029 | 0.086 | 0.715 | 0.318 |
| tiny | 108 | 0.741 | 0.037 | 0.000 | 0.009 | 0.467 | 0.000 |
| band tiny | 132 | 0.674 | 0.038 | 0.008 | 0.008 | 0.426 | 0.000 |
| band small | 392 | 0.949 | 0.020 | 0.000 | 0.046 | 0.625 | 0.422 |
| band medium | 133 | 0.985 | 0.038 | 0.007 | 0.105 | 0.766 | 0.536 |
| band large | 5 | 0.800 | 0.000 | 0.000 | 0.200 | 0.891 | 0.544 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.98, IoU 0.63 (n 148) | found 1.00, IoU 0.78 (n 24) | - |
| B | - | found 0.92, IoU 0.57 (n 12) | found 1.00, IoU 0.78 (n 5) | - |
| C | - | found 0.98, IoU 0.66 (n 93) | found 1.00, IoU 0.78 (n 24) | - |
| D | - | found 0.92, IoU 0.60 (n 100) | found 0.98, IoU 0.74 (n 58) | found 1.00, IoU 0.89 (n 4) |

Weed count error per image (detections minus reference weeds): mean 5.22, median abs 4.0, p90 abs 12.0. Detections per image median 9.0, p95 24.049999999999997, max 39; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.028 (p10 0.004); pixel recall of plants 0.028; pixel precision 0.643.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 10.84 | 13.2 |
| ms_separate | 18.8 | 31.62 |
| ms_measure | 47.19 | 53.45 |
| ms_total | 77.85 | 92.34 |

## Worst images

