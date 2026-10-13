# Classical baseline `S1_probhigh_0.6` on `dev_tune`

717 images, 4121 reference weed observations, 6925 detections. Generated 2026-10-13T22:59:38+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.449 | 0.755 | 0.564 | 0.466 | 0.576 | 5.32 | 1.41 | 3.57 | 0.33 |
| 0.3 | 0.524 | 0.881 | 0.657 | 0.543 | 0.672 | 4.6 | 0.68 | 3.33 | 0.33 |
| 0.1 | 0.541 | 0.909 | 0.678 | 0.560 | 0.693 | 4.44 | 0.52 | 3.3 | 0.33 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 6925 | 0.449 | 0.755 | 0.564 | 0.466 | 0.576 | 0.8726 | 3.57 | 0.33 |
| 4 | 6026 | 0.516 | 0.755 | 0.613 | 0.531 | 0.623 | 0.8726 | 2.65 | 0.22 |
| 10 | 5635 | 0.552 | 0.755 | 0.638 | 0.566 | 0.647 | 0.8726 | 2.21 | 0.19 |
| 25 | 5168 | 0.601 | 0.754 | 0.669 | 0.614 | 0.677 | 0.8726 | 1.74 | 0.15 |
| 50 | 4632 | 0.661 | 0.743 | 0.699 | 0.672 | 0.706 | 0.8726 | 1.3 | 0.1 |
| 100 | 3896 | 0.743 | 0.703 | 0.723 | 0.751 | 0.726 | 0.8709 | 0.78 | 0.06 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.877 (1107) | 0.814 (86) | 0.896 (632) | 0.779 (1032) | 0.475 (343) | 0.822 (309) | 0.464 (612) | 0.416 (776) | 0.801 (2463) | 0.921 (851) | 1.000 (31) |
| 0.3 | 0.973 (1107) | 0.930 (86) | 0.986 (632) | 0.897 (1032) | 0.606 (343) | 0.909 (309) | 0.711 (612) | 0.637 (776) | 0.927 (2463) | 0.965 (851) | 1.000 (31) |
| 0.1 | 0.983 (1107) | 0.954 (86) | 0.994 (632) | 0.929 (1032) | 0.679 (343) | 0.945 (309) | 0.756 (612) | 0.689 (776) | 0.957 (2463) | 0.967 (851) | 1.000 (31) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4121 | 0.877 | 0.045 | 0.003 | 0.034 | 0.649 | 0.224 |
| A | 1107 | 0.953 | 0.000 | 0.000 | 0.003 | 0.675 | 0.484 |
| B | 86 | 0.919 | 0.046 | 0.000 | 0.046 | 0.690 | 0.406 |
| C | 632 | 0.972 | 0.003 | 0.000 | 0.022 | 0.710 | 0.492 |
| D | 1032 | 0.920 | 0.117 | 0.001 | 0.074 | 0.656 | 0.316 |
| partial | 343 | 0.606 | 0.035 | 0.018 | 0.082 | 0.480 | 0.000 |
| touches_border | 309 | 0.900 | 0.045 | 0.013 | 0.029 | 0.713 | 0.317 |
| tiny | 612 | 0.701 | 0.052 | 0.000 | 0.008 | 0.476 | 0.000 |
| band tiny | 776 | 0.633 | 0.045 | 0.003 | 0.009 | 0.444 | 0.000 |
| band small | 2463 | 0.915 | 0.032 | 0.002 | 0.043 | 0.648 | 0.390 |
| band medium | 851 | 0.985 | 0.082 | 0.005 | 0.031 | 0.785 | 0.545 |
| band large | 31 | 1.000 | 0.065 | 0.000 | 0.000 | 0.882 | 0.729 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.95, IoU 0.66 (n 933) | found 0.99, IoU 0.80 (n 174) | - |
| B | - | found 0.88, IoU 0.65 (n 60) | found 1.00, IoU 0.77 (n 26) | - |
| C | - | found 0.96, IoU 0.67 (n 492) | found 1.00, IoU 0.83 (n 140) | - |
| D | - | found 0.89, IoU 0.62 (n 655) | found 0.98, IoU 0.76 (n 359) | found 1.00, IoU 0.90 (n 18) |

Weed count error per image (detections minus reference weeds): mean 3.91, median abs 3.0, p90 abs 9.0. Detections per image median 8.0, p95 21.199999999999932, max 43; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.031 (p10 0.004); pixel recall of plants 0.032; pixel precision 0.702.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 15.15 | 18.67 |
| ms_separate | 4.71 | 6.14 |
| ms_measure | 59.19 | 70.85 |
| ms_total | 79.05 | 93.79 |

## Worst images

