# Classical baseline `C2_erode1_adaptive_h4_p5_s0.50` on `dev_tune`

717 images, 4121 reference weed observations, 6534 detections. Generated 2026-10-13T23:01:48+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.483 | 0.767 | 0.593 | 0.501 | 0.606 | 4.71 | 1.34 | 2.92 | 0.32 |
| 0.3 | 0.554 | 0.878 | 0.679 | 0.574 | 0.694 | 4.07 | 0.7 | 2.81 | 0.32 |
| 0.1 | 0.575 | 0.912 | 0.706 | 0.596 | 0.721 | 3.87 | 0.5 | 2.78 | 0.32 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 6534 | 0.483 | 0.767 | 0.593 | 0.501 | 0.606 | 0.8927 | 2.92 | 0.32 |
| 4 | 5946 | 0.531 | 0.767 | 0.628 | 0.548 | 0.639 | 0.8927 | 2.3 | 0.25 |
| 10 | 5543 | 0.570 | 0.767 | 0.654 | 0.586 | 0.664 | 0.8927 | 1.85 | 0.21 |
| 25 | 5005 | 0.628 | 0.763 | 0.689 | 0.642 | 0.697 | 0.8927 | 1.37 | 0.15 |
| 50 | 4416 | 0.695 | 0.745 | 0.719 | 0.708 | 0.726 | 0.8927 | 0.9 | 0.11 |
| 100 | 3618 | 0.776 | 0.681 | 0.725 | 0.783 | 0.728 | 0.8701 | 0.48 | 0.05 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.898 (1107) | 0.826 (86) | 0.927 (632) | 0.794 (1032) | 0.411 (343) | 0.822 (309) | 0.480 (612) | 0.424 (776) | 0.818 (2463) | 0.926 (851) | 0.903 (31) |
| 0.3 | 0.970 (1107) | 0.930 (86) | 0.984 (632) | 0.903 (1032) | 0.601 (343) | 0.916 (309) | 0.686 (612) | 0.617 (776) | 0.925 (2463) | 0.974 (851) | 1.000 (31) |
| 0.1 | 0.983 (1107) | 0.930 (86) | 0.995 (632) | 0.939 (1032) | 0.676 (343) | 0.955 (309) | 0.761 (612) | 0.687 (776) | 0.959 (2463) | 0.979 (851) | 1.000 (31) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4121 | 0.858 | 0.041 | 0.001 | 0.035 | 0.662 | 0.234 |
| A | 1107 | 0.949 | 0.000 | 0.000 | 0.002 | 0.696 | 0.498 |
| B | 86 | 0.954 | 0.093 | 0.000 | 0.000 | 0.717 | 0.445 |
| C | 632 | 0.975 | 0.003 | 0.000 | 0.016 | 0.726 | 0.549 |
| D | 1032 | 0.913 | 0.107 | 0.001 | 0.082 | 0.665 | 0.336 |
| partial | 343 | 0.510 | 0.020 | 0.006 | 0.082 | 0.410 | 0.000 |
| touches_border | 309 | 0.864 | 0.019 | 0.003 | 0.049 | 0.708 | 0.330 |
| tiny | 612 | 0.658 | 0.056 | 0.000 | 0.005 | 0.483 | 0.000 |
| band tiny | 776 | 0.589 | 0.045 | 0.000 | 0.004 | 0.426 | 0.000 |
| band small | 2463 | 0.903 | 0.031 | 0.001 | 0.038 | 0.662 | 0.381 |
| band medium | 851 | 0.971 | 0.062 | 0.001 | 0.054 | 0.805 | 0.552 |
| band large | 31 | 0.903 | 0.065 | 0.000 | 0.032 | 0.892 | 0.711 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.94, IoU 0.68 (n 933) | found 0.99, IoU 0.82 (n 174) | - |
| B | - | found 0.93, IoU 0.67 (n 60) | found 1.00, IoU 0.79 (n 26) | - |
| C | - | found 0.97, IoU 0.70 (n 492) | found 1.00, IoU 0.84 (n 140) | - |
| D | - | found 0.88, IoU 0.63 (n 655) | found 0.97, IoU 0.78 (n 359) | found 0.94, IoU 0.91 (n 18) |

Weed count error per image (detections minus reference weeds): mean 3.37, median abs 3.0, p90 abs 8.0. Detections per image median 8.0, p95 20.199999999999932, max 34; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.030 (p10 0.003); pixel recall of plants 0.030; pixel precision 0.754.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 18.39 | 21.72 |
| ms_separate | 22.72 | 37.97 |
| ms_measure | 57.0 | 65.88 |
| ms_total | 98.6 | 115.84 |

## Worst images

