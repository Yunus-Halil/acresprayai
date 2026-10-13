# Classical baseline `A1_argmax` on `dev_tune`

717 images, 4121 reference weed observations, 7875 detections. Generated 2026-10-13T22:59:13+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.387 | 0.740 | 0.508 | 0.410 | 0.528 | 6.73 | 1.49 | 4.93 | 0.62 |
| 0.3 | 0.466 | 0.890 | 0.611 | 0.493 | 0.635 | 5.87 | 0.63 | 4.51 | 0.62 |
| 0.1 | 0.480 | 0.918 | 0.631 | 0.509 | 0.655 | 5.71 | 0.47 | 4.44 | 0.61 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 7875 | 0.387 | 0.740 | 0.508 | 0.410 | 0.528 | 0.8382 | 4.93 | 0.62 |
| 4 | 6478 | 0.471 | 0.740 | 0.576 | 0.489 | 0.589 | 0.8382 | 3.47 | 0.33 |
| 10 | 6028 | 0.506 | 0.740 | 0.601 | 0.523 | 0.613 | 0.8382 | 2.97 | 0.27 |
| 25 | 5429 | 0.561 | 0.739 | 0.638 | 0.577 | 0.648 | 0.8382 | 2.3 | 0.21 |
| 50 | 4867 | 0.617 | 0.729 | 0.668 | 0.630 | 0.676 | 0.8382 | 1.79 | 0.14 |
| 100 | 4095 | 0.698 | 0.694 | 0.696 | 0.708 | 0.701 | 0.8382 | 1.15 | 0.07 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.839 (1107) | 0.826 (86) | 0.880 (632) | 0.764 (1032) | 0.504 (343) | 0.803 (309) | 0.464 (612) | 0.424 (776) | 0.777 (2463) | 0.913 (851) | 1.000 (31) |
| 0.3 | 0.978 (1107) | 0.919 (86) | 0.992 (632) | 0.902 (1032) | 0.633 (343) | 0.916 (309) | 0.730 (612) | 0.657 (776) | 0.936 (2463) | 0.964 (851) | 1.000 (31) |
| 0.1 | 0.986 (1107) | 0.930 (86) | 1.000 (632) | 0.931 (1032) | 0.688 (343) | 0.961 (309) | 0.792 (612) | 0.724 (776) | 0.961 (2463) | 0.966 (851) | 1.000 (31) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4121 | 0.904 | 0.049 | 0.003 | 0.029 | 0.623 | 0.278 |
| A | 1107 | 0.962 | 0.000 | 0.000 | 0.004 | 0.650 | 0.462 |
| B | 86 | 0.977 | 0.105 | 0.000 | 0.000 | 0.656 | 0.418 |
| C | 632 | 0.981 | 0.003 | 0.000 | 0.011 | 0.675 | 0.472 |
| D | 1032 | 0.943 | 0.120 | 0.001 | 0.065 | 0.633 | 0.324 |
| partial | 343 | 0.665 | 0.050 | 0.020 | 0.070 | 0.507 | 0.000 |
| touches_border | 309 | 0.909 | 0.052 | 0.013 | 0.042 | 0.698 | 0.378 |
| tiny | 612 | 0.774 | 0.056 | 0.000 | 0.008 | 0.476 | 0.000 |
| band tiny | 776 | 0.709 | 0.054 | 0.003 | 0.009 | 0.453 | 0.000 |
| band small | 2463 | 0.935 | 0.034 | 0.002 | 0.035 | 0.624 | 0.393 |
| band medium | 851 | 0.987 | 0.087 | 0.005 | 0.032 | 0.769 | 0.524 |
| band large | 31 | 1.000 | 0.065 | 0.000 | 0.000 | 0.871 | 0.714 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.96, IoU 0.63 (n 933) | found 0.99, IoU 0.78 (n 174) | - |
| B | - | found 0.97, IoU 0.63 (n 60) | found 1.00, IoU 0.73 (n 26) | - |
| C | - | found 0.98, IoU 0.64 (n 492) | found 1.00, IoU 0.81 (n 140) | - |
| D | - | found 0.92, IoU 0.59 (n 655) | found 0.98, IoU 0.74 (n 359) | found 1.00, IoU 0.89 (n 18) |

Weed count error per image (detections minus reference weeds): mean 5.24, median abs 4.0, p90 abs 13.0. Detections per image median 9.0, p95 25.0, max 41; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.032 (p10 0.004); pixel recall of plants 0.032; pixel precision 0.649.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 14.24 | 17.16 |
| ms_separate | 4.91 | 6.35 |
| ms_measure | 60.69 | 71.26 |
| ms_total | 79.77 | 92.66 |

## Worst images

