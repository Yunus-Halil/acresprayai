# Classical baseline `B3_adaptive_h4_p5_s0.50` on `dev_check`

690 images, 4020 reference weed observations, 7701 detections. Generated 2026-10-13T23:06:06+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.380 | 0.728 | 0.499 | 0.408 | 0.523 | 6.92 | 1.58 | 4.75 | 0.75 |
| 0.3 | 0.469 | 0.899 | 0.617 | 0.503 | 0.645 | 5.92 | 0.59 | 4.23 | 0.75 |
| 0.1 | 0.482 | 0.923 | 0.633 | 0.517 | 0.662 | 5.78 | 0.45 | 4.19 | 0.75 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 7701 | 0.380 | 0.728 | 0.499 | 0.408 | 0.523 | 0.8489 | 4.75 | 0.75 |
| 4 | 6375 | 0.459 | 0.728 | 0.563 | 0.482 | 0.580 | 0.8489 | 3.36 | 0.44 |
| 10 | 5908 | 0.495 | 0.728 | 0.590 | 0.516 | 0.604 | 0.8489 | 2.86 | 0.34 |
| 25 | 5346 | 0.545 | 0.725 | 0.623 | 0.562 | 0.633 | 0.8489 | 2.3 | 0.23 |
| 50 | 4823 | 0.597 | 0.717 | 0.652 | 0.611 | 0.659 | 0.8489 | 1.83 | 0.15 |
| 100 | 4108 | 0.663 | 0.678 | 0.670 | 0.673 | 0.675 | 0.8415 | 1.23 | 0.08 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.847 (1137) | 0.876 (81) | 0.880 (698) | 0.697 (982) | 0.469 (286) | 0.757 (280) | 0.448 (556) | 0.435 (736) | 0.766 (2459) | 0.879 (786) | 0.846 (39) |
| 0.3 | 0.980 (1137) | 0.963 (81) | 0.991 (698) | 0.875 (982) | 0.612 (286) | 0.921 (280) | 0.790 (556) | 0.738 (736) | 0.930 (2459) | 0.953 (786) | 0.923 (39) |
| 0.1 | 0.990 (1137) | 0.975 (81) | 0.993 (698) | 0.901 (982) | 0.671 (286) | 0.936 (280) | 0.853 (556) | 0.795 (736) | 0.950 (2459) | 0.961 (786) | 0.923 (39) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4020 | 0.914 | 0.060 | 0.001 | 0.039 | 0.633 | 0.307 |
| A | 1137 | 0.973 | 0.000 | 0.000 | 0.021 | 0.663 | 0.449 |
| B | 81 | 0.951 | 0.025 | 0.000 | 0.025 | 0.682 | 0.455 |
| C | 698 | 0.980 | 0.011 | 0.000 | 0.021 | 0.693 | 0.484 |
| D | 982 | 0.934 | 0.172 | 0.002 | 0.079 | 0.615 | 0.267 |
| partial | 286 | 0.612 | 0.056 | 0.000 | 0.063 | 0.468 | 0.000 |
| touches_border | 280 | 0.946 | 0.089 | 0.007 | 0.061 | 0.695 | 0.330 |
| tiny | 556 | 0.813 | 0.036 | 0.000 | 0.007 | 0.477 | 0.011 |
| band tiny | 736 | 0.750 | 0.035 | 0.000 | 0.011 | 0.469 | 0.000 |
| band small | 2459 | 0.945 | 0.052 | 0.002 | 0.040 | 0.633 | 0.366 |
| band medium | 786 | 0.970 | 0.097 | 0.000 | 0.064 | 0.782 | 0.441 |
| band large | 39 | 0.974 | 0.256 | 0.000 | 0.026 | 0.903 | 0.469 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.97, IoU 0.64 (n 929) | found 1.00, IoU 0.78 (n 208) | - |
| B | - | found 0.93, IoU 0.66 (n 61) | found 1.00, IoU 0.88 (n 20) | - |
| C | - | found 0.98, IoU 0.66 (n 535) | found 0.98, IoU 0.81 (n 163) | - |
| D | - | found 0.92, IoU 0.57 (n 697) | found 0.96, IoU 0.72 (n 252) | found 0.97, IoU 0.90 (n 33) |

Weed count error per image (detections minus reference weeds): mean 5.33, median abs 4.0, p90 abs 12.0. Detections per image median 10.0, p95 25.0, max 41; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.034 (p10 0.004); pixel recall of plants 0.035; pixel precision 0.667.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 12.97 | 15.64 |
| ms_separate | 22.53 | 36.51 |
| ms_measure | 56.45 | 63.47 |
| ms_total | 92.43 | 111.66 |

## Worst images

