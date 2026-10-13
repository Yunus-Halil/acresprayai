# Classical baseline `B3_adaptive_h4_p5_s0.50` on `dev_tune`

717 images, 4121 reference weed observations, 7948 detections. Generated 2026-10-13T23:00:54+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.383 | 0.738 | 0.504 | 0.405 | 0.523 | 6.84 | 1.51 | 4.94 | 0.62 |
| 0.3 | 0.462 | 0.891 | 0.609 | 0.489 | 0.632 | 5.96 | 0.62 | 4.51 | 0.62 |
| 0.1 | 0.477 | 0.920 | 0.628 | 0.505 | 0.652 | 5.8 | 0.46 | 4.44 | 0.61 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 7948 | 0.383 | 0.738 | 0.504 | 0.405 | 0.523 | 0.8365 | 4.94 | 0.62 |
| 4 | 6551 | 0.464 | 0.738 | 0.570 | 0.482 | 0.583 | 0.8365 | 3.48 | 0.34 |
| 10 | 6101 | 0.498 | 0.738 | 0.595 | 0.515 | 0.607 | 0.8365 | 2.97 | 0.27 |
| 25 | 5502 | 0.552 | 0.737 | 0.631 | 0.567 | 0.641 | 0.8365 | 2.31 | 0.21 |
| 50 | 4940 | 0.606 | 0.726 | 0.661 | 0.619 | 0.668 | 0.8365 | 1.79 | 0.14 |
| 100 | 4168 | 0.684 | 0.692 | 0.688 | 0.693 | 0.692 | 0.8365 | 1.16 | 0.08 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.837 (1107) | 0.826 (86) | 0.880 (632) | 0.763 (1032) | 0.507 (343) | 0.783 (309) | 0.464 (612) | 0.424 (776) | 0.777 (2463) | 0.906 (851) | 0.903 (31) |
| 0.3 | 0.978 (1107) | 0.930 (86) | 0.992 (632) | 0.906 (1032) | 0.636 (343) | 0.916 (309) | 0.730 (612) | 0.657 (776) | 0.937 (2463) | 0.968 (851) | 1.000 (31) |
| 0.1 | 0.986 (1107) | 0.930 (86) | 1.000 (632) | 0.936 (1032) | 0.694 (343) | 0.961 (309) | 0.792 (612) | 0.724 (776) | 0.962 (2463) | 0.972 (851) | 1.000 (31) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4121 | 0.901 | 0.046 | 0.003 | 0.035 | 0.622 | 0.281 |
| A | 1107 | 0.961 | 0.000 | 0.000 | 0.005 | 0.649 | 0.460 |
| B | 86 | 0.977 | 0.093 | 0.000 | 0.000 | 0.656 | 0.418 |
| C | 632 | 0.981 | 0.003 | 0.000 | 0.011 | 0.675 | 0.472 |
| D | 1032 | 0.939 | 0.113 | 0.001 | 0.075 | 0.631 | 0.330 |
| partial | 343 | 0.665 | 0.044 | 0.020 | 0.076 | 0.507 | 0.000 |
| touches_border | 309 | 0.890 | 0.045 | 0.010 | 0.068 | 0.691 | 0.325 |
| tiny | 612 | 0.774 | 0.056 | 0.000 | 0.008 | 0.476 | 0.000 |
| band tiny | 776 | 0.709 | 0.054 | 0.003 | 0.009 | 0.453 | 0.000 |
| band small | 2463 | 0.935 | 0.033 | 0.002 | 0.036 | 0.624 | 0.396 |
| band medium | 851 | 0.978 | 0.076 | 0.004 | 0.053 | 0.770 | 0.518 |
| band large | 31 | 0.903 | 0.065 | 0.000 | 0.065 | 0.871 | 0.704 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.96, IoU 0.63 (n 933) | found 0.99, IoU 0.78 (n 174) | - |
| B | - | found 0.97, IoU 0.63 (n 60) | found 1.00, IoU 0.73 (n 26) | - |
| C | - | found 0.98, IoU 0.64 (n 492) | found 1.00, IoU 0.81 (n 140) | - |
| D | - | found 0.92, IoU 0.59 (n 655) | found 0.97, IoU 0.74 (n 359) | found 0.94, IoU 0.89 (n 18) |

Weed count error per image (detections minus reference weeds): mean 5.34, median abs 4.0, p90 abs 13.0. Detections per image median 9.0, p95 25.0, max 41; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.032 (p10 0.004); pixel recall of plants 0.032; pixel precision 0.649.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 13.51 | 15.89 |
| ms_separate | 23.11 | 36.8 |
| ms_measure | 57.22 | 64.08 |
| ms_total | 94.59 | 109.91 |

## Worst images

