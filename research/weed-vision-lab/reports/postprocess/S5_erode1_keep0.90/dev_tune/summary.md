# Classical baseline `S5_erode1_keep0.90` on `dev_tune`

717 images, 4121 reference weed observations, 6445 detections. Generated 2026-10-13T23:03:37+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.492 | 0.770 | 0.601 | 0.511 | 0.614 | 4.56 | 1.32 | 2.92 | 0.32 |
| 0.3 | 0.560 | 0.876 | 0.683 | 0.581 | 0.699 | 3.95 | 0.71 | 2.81 | 0.32 |
| 0.1 | 0.582 | 0.910 | 0.710 | 0.603 | 0.725 | 3.76 | 0.52 | 2.78 | 0.32 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 6445 | 0.492 | 0.770 | 0.601 | 0.511 | 0.614 | 0.8935 | 2.92 | 0.32 |
| 4 | 5857 | 0.542 | 0.770 | 0.636 | 0.559 | 0.648 | 0.8935 | 2.3 | 0.25 |
| 10 | 5454 | 0.582 | 0.770 | 0.663 | 0.598 | 0.673 | 0.8935 | 1.85 | 0.21 |
| 25 | 4922 | 0.642 | 0.767 | 0.699 | 0.657 | 0.708 | 0.8935 | 1.36 | 0.15 |
| 50 | 4330 | 0.713 | 0.749 | 0.730 | 0.725 | 0.737 | 0.8935 | 0.89 | 0.11 |
| 100 | 3546 | 0.796 | 0.685 | 0.737 | 0.804 | 0.740 | 0.8709 | 0.48 | 0.05 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.899 (1107) | 0.826 (86) | 0.930 (632) | 0.794 (1032) | 0.431 (343) | 0.838 (309) | 0.480 (612) | 0.425 (776) | 0.822 (2463) | 0.927 (851) | 1.000 (31) |
| 0.3 | 0.970 (1107) | 0.930 (86) | 0.984 (632) | 0.897 (1032) | 0.601 (343) | 0.916 (309) | 0.686 (612) | 0.617 (776) | 0.926 (2463) | 0.965 (851) | 1.000 (31) |
| 0.1 | 0.983 (1107) | 0.930 (86) | 0.995 (632) | 0.931 (1032) | 0.676 (343) | 0.948 (309) | 0.761 (612) | 0.689 (776) | 0.958 (2463) | 0.967 (851) | 1.000 (31) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4121 | 0.864 | 0.046 | 0.002 | 0.029 | 0.668 | 0.226 |
| A | 1107 | 0.949 | 0.000 | 0.000 | 0.001 | 0.698 | 0.498 |
| B | 86 | 0.954 | 0.093 | 0.000 | 0.000 | 0.717 | 0.445 |
| C | 632 | 0.975 | 0.003 | 0.000 | 0.009 | 0.728 | 0.551 |
| D | 1032 | 0.918 | 0.117 | 0.001 | 0.069 | 0.668 | 0.325 |
| partial | 343 | 0.548 | 0.029 | 0.012 | 0.085 | 0.455 | 0.000 |
| touches_border | 309 | 0.890 | 0.045 | 0.013 | 0.029 | 0.728 | 0.331 |
| tiny | 612 | 0.658 | 0.056 | 0.000 | 0.005 | 0.483 | 0.000 |
| band tiny | 776 | 0.597 | 0.048 | 0.003 | 0.005 | 0.429 | 0.000 |
| band small | 2463 | 0.906 | 0.032 | 0.001 | 0.036 | 0.667 | 0.383 |
| band medium | 851 | 0.984 | 0.085 | 0.005 | 0.029 | 0.810 | 0.553 |
| band large | 31 | 1.000 | 0.065 | 0.000 | 0.000 | 0.897 | 0.745 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.94, IoU 0.68 (n 933) | found 0.99, IoU 0.82 (n 174) | - |
| B | - | found 0.93, IoU 0.67 (n 60) | found 1.00, IoU 0.79 (n 26) | - |
| C | - | found 0.97, IoU 0.70 (n 492) | found 1.00, IoU 0.84 (n 140) | - |
| D | - | found 0.88, IoU 0.63 (n 655) | found 0.98, IoU 0.78 (n 359) | found 1.00, IoU 0.92 (n 18) |

Weed count error per image (detections minus reference weeds): mean 3.24, median abs 3.0, p90 abs 8.0. Detections per image median 8.0, p95 20.0, max 34; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.030 (p10 0.003); pixel recall of plants 0.030; pixel precision 0.754.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 21.9 | 25.65 |
| ms_separate | 5.05 | 6.65 |
| ms_measure | 63.66 | 75.29 |
| ms_total | 90.63 | 103.68 |

## Worst images

