# Classical baseline `erfnet_weed` on `dev_check`

690 images, 4020 reference weed observations, 7622 detections. Generated 2026-10-13T21:49:53+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.386 | 0.732 | 0.505 | 0.414 | 0.529 | 6.78 | 1.56 | 4.74 | 0.76 |
| 0.3 | 0.473 | 0.896 | 0.619 | 0.508 | 0.648 | 5.82 | 0.6 | 4.22 | 0.76 |
| 0.1 | 0.485 | 0.920 | 0.635 | 0.521 | 0.665 | 5.69 | 0.47 | 4.18 | 0.76 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 7622 | 0.386 | 0.732 | 0.505 | 0.414 | 0.529 | 0.8498 | 4.74 | 0.76 |
| 4 | 6299 | 0.467 | 0.732 | 0.570 | 0.491 | 0.588 | 0.8498 | 3.35 | 0.44 |
| 10 | 5831 | 0.504 | 0.732 | 0.597 | 0.526 | 0.612 | 0.8498 | 2.86 | 0.34 |
| 25 | 5267 | 0.556 | 0.729 | 0.631 | 0.574 | 0.642 | 0.8498 | 2.29 | 0.24 |
| 50 | 4741 | 0.610 | 0.720 | 0.661 | 0.624 | 0.669 | 0.8498 | 1.81 | 0.15 |
| 100 | 4029 | 0.680 | 0.682 | 0.681 | 0.690 | 0.686 | 0.8424 | 1.21 | 0.09 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.848 (1137) | 0.876 (81) | 0.890 (698) | 0.686 (982) | 0.493 (286) | 0.793 (280) | 0.448 (556) | 0.438 (736) | 0.762 (2459) | 0.907 (786) | 0.872 (39) |
| 0.3 | 0.980 (1137) | 0.963 (81) | 0.991 (698) | 0.862 (982) | 0.615 (286) | 0.921 (280) | 0.791 (556) | 0.741 (736) | 0.926 (2459) | 0.950 (786) | 0.923 (39) |
| 0.1 | 0.990 (1137) | 0.975 (81) | 0.993 (698) | 0.886 (982) | 0.671 (286) | 0.936 (280) | 0.854 (556) | 0.796 (736) | 0.944 (2459) | 0.958 (786) | 0.923 (39) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4020 | 0.920 | 0.066 | 0.001 | 0.030 | 0.634 | 0.299 |
| A | 1137 | 0.973 | 0.000 | 0.000 | 0.018 | 0.663 | 0.451 |
| B | 81 | 0.951 | 0.025 | 0.000 | 0.025 | 0.682 | 0.455 |
| C | 698 | 0.986 | 0.011 | 0.000 | 0.013 | 0.695 | 0.489 |
| D | 982 | 0.941 | 0.197 | 0.002 | 0.069 | 0.614 | 0.241 |
| partial | 286 | 0.626 | 0.056 | 0.000 | 0.049 | 0.489 | 0.000 |
| touches_border | 280 | 0.968 | 0.100 | 0.007 | 0.014 | 0.707 | 0.371 |
| tiny | 556 | 0.813 | 0.036 | 0.000 | 0.007 | 0.475 | 0.011 |
| band tiny | 736 | 0.751 | 0.035 | 0.000 | 0.011 | 0.468 | 0.000 |
| band small | 2459 | 0.946 | 0.059 | 0.002 | 0.039 | 0.632 | 0.357 |
| band medium | 786 | 0.991 | 0.108 | 0.000 | 0.024 | 0.782 | 0.527 |
| band large | 39 | 1.000 | 0.256 | 0.000 | 0.000 | 0.903 | 0.488 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.97, IoU 0.64 (n 929) | found 1.00, IoU 0.78 (n 208) | - |
| B | - | found 0.93, IoU 0.66 (n 61) | found 1.00, IoU 0.88 (n 20) | - |
| C | - | found 0.98, IoU 0.66 (n 535) | found 1.00, IoU 0.81 (n 163) | - |
| D | - | found 0.92, IoU 0.57 (n 697) | found 0.98, IoU 0.72 (n 252) | found 1.00, IoU 0.90 (n 33) |

Weed count error per image (detections minus reference weeds): mean 5.22, median abs 4.0, p90 abs 11.100000000000023. Detections per image median 10.0, p95 24.549999999999955, max 40; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.034 (p10 0.004); pixel recall of plants 0.035; pixel precision 0.666.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 375.06, preprocess_ms 6.24, forward_ms 277.05, postprocess_ms 44.75, components_ms 3.01, measure_ms 37.69.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 367.83 | 452.92 |
| preprocess_ms | 5.15 | 8.93 |
| forward_ms | 269.24 | 351.6 |
| postprocess_ms | 45.72 | 50.71 |
| components_ms | 3.12 | 3.63 |
| measure_ms | 39.04 | 41.12 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00135_P0030852.png (3), 05-26_00098_P0034280.png (3), 05-15_00053_P0030852.png (2), 05-15_00057_P0030852.png (2)
- most background false positives: 06-05_00174_P0037989.png (26), 06-05_00046_P0037820.png (24), 06-05_00175_P0037989.png (23), 06-05_00151_P0037820.png (20)
- most crop false positives: 06-05_00134_P0038055.png (10), 06-05_00100_P0037989.png (8), 06-05_00133_P0038055.png (7), 06-05_00153_P0037989.png (7)
- most merged references: 05-15_00051_P0030852.png (10), 05-15_00072_P0030852.png (10), 05-15_00050_P0030852.png (8), 05-15_00071_P0030852.png (8)
