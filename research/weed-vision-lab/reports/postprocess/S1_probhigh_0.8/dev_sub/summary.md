# Classical baseline `S1_probhigh_0.8` on `dev_sub`

120 images, 662 reference weed observations, 1024 detections. Generated 2026-10-13T22:57:20+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.474 | 0.733 | 0.575 | 0.481 | 0.581 | 4.49 | 1.48 | 2.19 | 0.12 |
| 0.3 | 0.538 | 0.832 | 0.654 | 0.546 | 0.659 | 3.94 | 0.93 | 2.17 | 0.12 |
| 0.1 | 0.569 | 0.881 | 0.692 | 0.578 | 0.698 | 3.67 | 0.66 | 2.16 | 0.12 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1024 | 0.474 | 0.733 | 0.575 | 0.481 | 0.581 | 0.873 | 2.19 | 0.12 |
| 4 | 897 | 0.541 | 0.733 | 0.622 | 0.547 | 0.627 | 0.873 | 1.5 | 0.09 |
| 10 | 843 | 0.575 | 0.733 | 0.644 | 0.580 | 0.647 | 0.873 | 1.23 | 0.06 |
| 25 | 760 | 0.638 | 0.733 | 0.682 | 0.642 | 0.684 | 0.873 | 0.86 | 0.04 |
| 50 | 673 | 0.709 | 0.721 | 0.715 | 0.712 | 0.716 | 0.873 | 0.47 | 0.03 |
| 100 | 546 | 0.786 | 0.648 | 0.710 | 0.789 | 0.711 | 0.836 | 0.23 | 0.02 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.889 (172) | 0.706 (17) | 0.914 (117) | 0.772 (162) | 0.392 (51) | 0.686 (35) | 0.407 (108) | 0.356 (132) | 0.809 (392) | 0.872 (133) | 1.000 (5) |
| 0.3 | 0.959 (172) | 0.824 (17) | 0.966 (117) | 0.889 (162) | 0.529 (51) | 0.829 (35) | 0.546 (108) | 0.485 (132) | 0.908 (392) | 0.947 (133) | 1.000 (5) |
| 0.1 | 0.983 (172) | 0.941 (17) | 0.983 (117) | 0.926 (162) | 0.549 (51) | 0.943 (35) | 0.667 (108) | 0.583 (132) | 0.957 (392) | 0.947 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.790 | 0.027 | 0.003 | 0.051 | 0.671 | 0.051 |
| A | 172 | 0.942 | 0.000 | 0.000 | 0.023 | 0.693 | 0.494 |
| B | 17 | 0.824 | 0.000 | 0.000 | 0.000 | 0.694 | 0.267 |
| C | 117 | 0.923 | 0.000 | 0.000 | 0.034 | 0.722 | 0.513 |
| D | 162 | 0.846 | 0.086 | 0.000 | 0.111 | 0.695 | 0.291 |
| partial | 51 | 0.471 | 0.020 | 0.020 | 0.078 | 0.358 | 0.000 |
| touches_border | 35 | 0.714 | 0.029 | 0.029 | 0.114 | 0.741 | 0.186 |
| tiny | 108 | 0.491 | 0.018 | 0.000 | 0.000 | 0.375 | 0.000 |
| band tiny | 132 | 0.439 | 0.023 | 0.008 | 0.000 | 0.258 | 0.000 |
| band small | 392 | 0.852 | 0.010 | 0.000 | 0.069 | 0.672 | 0.356 |
| band medium | 133 | 0.947 | 0.083 | 0.007 | 0.053 | 0.822 | 0.478 |
| band large | 5 | 1.000 | 0.000 | 0.000 | 0.000 | 0.923 | 0.803 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.93, IoU 0.68 (n 148) | found 1.00, IoU 0.84 (n 24) | - |
| B | - | found 0.75, IoU 0.60 (n 12) | found 1.00, IoU 0.82 (n 5) | - |
| C | - | found 0.91, IoU 0.70 (n 93) | found 0.96, IoU 0.85 (n 24) | - |
| D | - | found 0.78, IoU 0.61 (n 100) | found 0.95, IoU 0.77 (n 58) | found 1.00, IoU 0.93 (n 4) |

Weed count error per image (detections minus reference weeds): mean 3.02, median abs 2.0, p90 abs 7.0. Detections per image median 8.0, p95 19.0, max 31; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.025 (p10 0.003); pixel recall of plants 0.025; pixel precision 0.815.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 12.29 | 15.71 |
| ms_separate | 3.81 | 4.81 |
| ms_measure | 49.17 | 56.2 |
| ms_total | 65.84 | 72.49 |

## Worst images

