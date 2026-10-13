# Classical baseline `S1_probhigh_0.7` on `dev_tune`

717 images, 4121 reference weed observations, 6749 detections. Generated 2026-10-13T23:00:03+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.464 | 0.759 | 0.576 | 0.478 | 0.587 | 5.05 | 1.38 | 3.01 | 0.29 |
| 0.3 | 0.526 | 0.862 | 0.653 | 0.543 | 0.666 | 4.46 | 0.79 | 2.92 | 0.29 |
| 0.1 | 0.547 | 0.896 | 0.679 | 0.564 | 0.693 | 4.26 | 0.6 | 2.9 | 0.29 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 6749 | 0.464 | 0.759 | 0.576 | 0.478 | 0.587 | 0.8793 | 3.01 | 0.29 |
| 4 | 5843 | 0.535 | 0.759 | 0.628 | 0.549 | 0.637 | 0.8793 | 2.11 | 0.2 |
| 10 | 5472 | 0.572 | 0.759 | 0.652 | 0.583 | 0.660 | 0.8793 | 1.77 | 0.15 |
| 25 | 4962 | 0.629 | 0.758 | 0.687 | 0.639 | 0.694 | 0.8793 | 1.31 | 0.11 |
| 50 | 4391 | 0.696 | 0.742 | 0.719 | 0.704 | 0.723 | 0.8793 | 0.85 | 0.07 |
| 100 | 3674 | 0.778 | 0.693 | 0.733 | 0.783 | 0.736 | 0.8734 | 0.45 | 0.04 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.884 (1107) | 0.814 (86) | 0.921 (632) | 0.784 (1032) | 0.443 (343) | 0.806 (309) | 0.471 (612) | 0.421 (776) | 0.806 (2463) | 0.924 (851) | 1.000 (31) |
| 0.3 | 0.960 (1107) | 0.954 (86) | 0.981 (632) | 0.893 (1032) | 0.574 (343) | 0.880 (309) | 0.647 (612) | 0.575 (776) | 0.916 (2463) | 0.964 (851) | 1.000 (31) |
| 0.1 | 0.978 (1107) | 0.965 (86) | 0.989 (632) | 0.931 (1032) | 0.630 (343) | 0.932 (309) | 0.714 (612) | 0.642 (776) | 0.951 (2463) | 0.967 (851) | 1.000 (31) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4121 | 0.844 | 0.040 | 0.002 | 0.043 | 0.669 | 0.157 |
| A | 1107 | 0.926 | 0.000 | 0.000 | 0.013 | 0.703 | 0.479 |
| B | 86 | 0.895 | 0.000 | 0.000 | 0.046 | 0.716 | 0.400 |
| C | 632 | 0.953 | 0.003 | 0.000 | 0.033 | 0.736 | 0.521 |
| D | 1032 | 0.903 | 0.107 | 0.000 | 0.092 | 0.667 | 0.287 |
| partial | 343 | 0.563 | 0.029 | 0.015 | 0.096 | 0.465 | 0.000 |
| touches_border | 309 | 0.858 | 0.042 | 0.010 | 0.032 | 0.720 | 0.261 |
| tiny | 612 | 0.629 | 0.046 | 0.000 | 0.002 | 0.470 | 0.000 |
| band tiny | 776 | 0.563 | 0.039 | 0.003 | 0.005 | 0.418 | 0.000 |
| band small | 2463 | 0.885 | 0.026 | 0.001 | 0.057 | 0.668 | 0.343 |
| band medium | 851 | 0.977 | 0.080 | 0.004 | 0.040 | 0.803 | 0.540 |
| band large | 31 | 1.000 | 0.065 | 0.000 | 0.000 | 0.890 | 0.745 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.92, IoU 0.68 (n 933) | found 0.97, IoU 0.82 (n 174) | - |
| B | - | found 0.85, IoU 0.66 (n 60) | found 1.00, IoU 0.81 (n 26) | - |
| C | - | found 0.94, IoU 0.70 (n 492) | found 1.00, IoU 0.84 (n 140) | - |
| D | - | found 0.86, IoU 0.63 (n 655) | found 0.97, IoU 0.77 (n 359) | found 1.00, IoU 0.91 (n 18) |

Weed count error per image (detections minus reference weeds): mean 3.67, median abs 3.0, p90 abs 8.0. Detections per image median 8.0, p95 21.0, max 42; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.030 (p10 0.003); pixel recall of plants 0.030; pixel precision 0.755.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 14.89 | 17.8 |
| ms_separate | 4.66 | 5.84 |
| ms_measure | 57.41 | 64.85 |
| ms_total | 77.16 | 85.18 |

## Worst images

