# Classical baseline `C3_probhigh0.6_adaptive_h4_p5_s0.50` on `dev_tune`

717 images, 4121 reference weed observations, 7012 detections. Generated 2026-10-13T23:02:14+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.442 | 0.752 | 0.557 | 0.458 | 0.569 | 5.46 | 1.43 | 3.58 | 0.34 |
| 0.3 | 0.519 | 0.883 | 0.653 | 0.537 | 0.668 | 4.71 | 0.68 | 3.35 | 0.34 |
| 0.1 | 0.535 | 0.910 | 0.674 | 0.554 | 0.689 | 4.55 | 0.51 | 3.31 | 0.33 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 7012 | 0.442 | 0.752 | 0.557 | 0.458 | 0.569 | 0.8701 | 3.58 | 0.34 |
| 4 | 6113 | 0.507 | 0.752 | 0.606 | 0.521 | 0.615 | 0.8701 | 2.66 | 0.23 |
| 10 | 5722 | 0.542 | 0.752 | 0.630 | 0.555 | 0.638 | 0.8701 | 2.22 | 0.19 |
| 25 | 5255 | 0.589 | 0.751 | 0.660 | 0.601 | 0.668 | 0.8701 | 1.75 | 0.15 |
| 50 | 4719 | 0.646 | 0.740 | 0.690 | 0.656 | 0.696 | 0.8701 | 1.31 | 0.11 |
| 100 | 3983 | 0.724 | 0.700 | 0.712 | 0.731 | 0.715 | 0.8684 | 0.79 | 0.06 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.874 (1107) | 0.814 (86) | 0.896 (632) | 0.775 (1032) | 0.475 (343) | 0.803 (309) | 0.464 (612) | 0.416 (776) | 0.802 (2463) | 0.908 (851) | 0.903 (31) |
| 0.3 | 0.973 (1107) | 0.930 (86) | 0.986 (632) | 0.903 (1032) | 0.609 (343) | 0.909 (309) | 0.711 (612) | 0.637 (776) | 0.928 (2463) | 0.971 (851) | 1.000 (31) |
| 0.1 | 0.983 (1107) | 0.954 (86) | 0.994 (632) | 0.935 (1032) | 0.682 (343) | 0.945 (309) | 0.756 (612) | 0.689 (776) | 0.957 (2463) | 0.973 (851) | 1.000 (31) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4121 | 0.874 | 0.042 | 0.002 | 0.042 | 0.647 | 0.238 |
| A | 1107 | 0.952 | 0.000 | 0.000 | 0.005 | 0.675 | 0.480 |
| B | 86 | 0.919 | 0.046 | 0.000 | 0.046 | 0.690 | 0.406 |
| C | 632 | 0.972 | 0.003 | 0.000 | 0.022 | 0.710 | 0.492 |
| D | 1032 | 0.916 | 0.108 | 0.001 | 0.093 | 0.648 | 0.322 |
| partial | 343 | 0.606 | 0.032 | 0.018 | 0.093 | 0.480 | 0.000 |
| touches_border | 309 | 0.883 | 0.042 | 0.010 | 0.052 | 0.706 | 0.309 |
| tiny | 612 | 0.701 | 0.052 | 0.000 | 0.008 | 0.476 | 0.000 |
| band tiny | 776 | 0.633 | 0.045 | 0.003 | 0.009 | 0.444 | 0.000 |
| band small | 2463 | 0.915 | 0.031 | 0.002 | 0.045 | 0.647 | 0.391 |
| band medium | 851 | 0.975 | 0.070 | 0.004 | 0.065 | 0.785 | 0.512 |
| band large | 31 | 0.903 | 0.065 | 0.000 | 0.032 | 0.882 | 0.711 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.95, IoU 0.66 (n 933) | found 0.99, IoU 0.80 (n 174) | - |
| B | - | found 0.88, IoU 0.65 (n 60) | found 1.00, IoU 0.77 (n 26) | - |
| C | - | found 0.96, IoU 0.67 (n 492) | found 1.00, IoU 0.83 (n 140) | - |
| D | - | found 0.89, IoU 0.62 (n 655) | found 0.97, IoU 0.76 (n 359) | found 0.94, IoU 0.90 (n 18) |

Weed count error per image (detections minus reference weeds): mean 4.03, median abs 3.0, p90 abs 10.0. Detections per image median 8.0, p95 22.0, max 43; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.031 (p10 0.004); pixel recall of plants 0.032; pixel precision 0.702.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 14.71 | 17.26 |
| ms_separate | 22.52 | 35.92 |
| ms_measure | 56.94 | 63.82 |
| ms_total | 95.11 | 110.25 |

## Worst images

