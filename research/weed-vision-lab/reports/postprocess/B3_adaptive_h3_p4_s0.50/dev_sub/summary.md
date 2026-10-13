# Classical baseline `B3_adaptive_h3_p4_s0.50` on `dev_sub`

120 images, 662 reference weed observations, 1269 detections. Generated 2026-10-13T22:58:07+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.385 | 0.739 | 0.506 | 0.408 | 0.525 | 6.5 | 1.44 | 4.8 | 0.58 |
| 0.3 | 0.469 | 0.899 | 0.616 | 0.496 | 0.639 | 5.62 | 0.56 | 4.32 | 0.58 |
| 0.1 | 0.480 | 0.920 | 0.631 | 0.508 | 0.654 | 5.5 | 0.44 | 4.25 | 0.58 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1269 | 0.385 | 0.739 | 0.506 | 0.408 | 0.525 | 0.8201 | 4.8 | 0.58 |
| 4 | 1035 | 0.472 | 0.739 | 0.576 | 0.490 | 0.590 | 0.8201 | 3.27 | 0.32 |
| 10 | 973 | 0.503 | 0.739 | 0.598 | 0.519 | 0.609 | 0.8201 | 2.83 | 0.25 |
| 25 | 879 | 0.556 | 0.739 | 0.635 | 0.573 | 0.645 | 0.8201 | 2.17 | 0.22 |
| 50 | 795 | 0.608 | 0.730 | 0.663 | 0.624 | 0.673 | 0.8201 | 1.69 | 0.17 |
| 100 | 675 | 0.684 | 0.698 | 0.691 | 0.696 | 0.697 | 0.8201 | 1.1 | 0.09 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.826 (172) | 0.765 (17) | 0.889 (117) | 0.809 (162) | 0.451 (51) | 0.771 (35) | 0.454 (108) | 0.402 (132) | 0.788 (392) | 0.925 (133) | 0.800 (5) |
| 0.3 | 0.994 (172) | 0.941 (17) | 0.974 (117) | 0.938 (162) | 0.588 (51) | 0.914 (35) | 0.741 (108) | 0.644 (132) | 0.957 (392) | 0.977 (133) | 1.000 (5) |
| 0.1 | 0.994 (172) | 0.941 (17) | 1.000 (117) | 0.957 (162) | 0.627 (51) | 1.000 (35) | 0.768 (108) | 0.689 (132) | 0.977 (392) | 0.977 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.903 | 0.027 | 0.003 | 0.032 | 0.625 | 0.302 |
| A | 172 | 0.983 | 0.000 | 0.000 | 0.006 | 0.652 | 0.466 |
| B | 17 | 0.941 | 0.000 | 0.000 | 0.000 | 0.625 | 0.424 |
| C | 117 | 0.983 | 0.009 | 0.000 | 0.000 | 0.675 | 0.482 |
| D | 162 | 0.951 | 0.068 | 0.000 | 0.068 | 0.656 | 0.411 |
| partial | 51 | 0.627 | 0.020 | 0.020 | 0.098 | 0.408 | 0.000 |
| touches_border | 35 | 0.914 | 0.029 | 0.029 | 0.086 | 0.728 | 0.318 |
| tiny | 108 | 0.741 | 0.037 | 0.000 | 0.009 | 0.467 | 0.000 |
| band tiny | 132 | 0.674 | 0.038 | 0.008 | 0.008 | 0.426 | 0.000 |
| band small | 392 | 0.954 | 0.020 | 0.000 | 0.033 | 0.625 | 0.431 |
| band medium | 133 | 0.985 | 0.038 | 0.007 | 0.045 | 0.781 | 0.567 |
| band large | 5 | 0.800 | 0.000 | 0.000 | 0.200 | 0.891 | 0.544 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.98, IoU 0.63 (n 148) | found 1.00, IoU 0.78 (n 24) | - |
| B | - | found 0.92, IoU 0.57 (n 12) | found 1.00, IoU 0.78 (n 5) | - |
| C | - | found 0.98, IoU 0.66 (n 93) | found 1.00, IoU 0.80 (n 24) | - |
| D | - | found 0.93, IoU 0.60 (n 100) | found 0.98, IoU 0.77 (n 58) | found 1.00, IoU 0.89 (n 4) |

Weed count error per image (detections minus reference weeds): mean 5.06, median abs 4.0, p90 abs 11.100000000000009. Detections per image median 9.0, p95 23.049999999999997, max 39; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.028 (p10 0.004); pixel recall of plants 0.028; pixel precision 0.643.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 11.32 | 13.8 |
| ms_separate | 20.01 | 29.34 |
| ms_measure | 48.49 | 55.23 |
| ms_total | 80.44 | 93.16 |

## Worst images

