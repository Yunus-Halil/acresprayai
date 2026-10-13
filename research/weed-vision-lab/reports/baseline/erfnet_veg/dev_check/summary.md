# Classical baseline `erfnet_veg` on `dev_check`

690 images, 4020 reference weed observations, 11721 detections. Generated 2026-10-13T21:54:35+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.210 | 0.612 | 0.313 | 0.408 | 0.490 | 13.42 | 2.26 | 4.34 | 8.25 |
| 0.3 | 0.261 | 0.761 | 0.389 | 0.506 | 0.608 | 12.56 | 1.39 | 3.85 | 8.24 |
| 0.1 | 0.274 | 0.800 | 0.409 | 0.526 | 0.634 | 12.33 | 1.17 | 3.8 | 8.12 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 11721 | 0.210 | 0.612 | 0.313 | 0.408 | 0.490 | 0.8563 | 4.34 | 8.25 |
| 4 | 10813 | 0.228 | 0.612 | 0.332 | 0.474 | 0.534 | 0.8563 | 3.24 | 8.14 |
| 10 | 10430 | 0.236 | 0.612 | 0.341 | 0.509 | 0.556 | 0.8563 | 2.77 | 8.1 |
| 25 | 9904 | 0.247 | 0.609 | 0.351 | 0.558 | 0.582 | 0.8563 | 2.24 | 8.0 |
| 50 | 9369 | 0.257 | 0.599 | 0.360 | 0.611 | 0.605 | 0.8563 | 1.73 | 7.87 |
| 100 | 8446 | 0.267 | 0.561 | 0.362 | 0.680 | 0.615 | 0.8506 | 1.13 | 7.43 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.855 (1137) | 0.876 (81) | 0.895 (698) | 0.229 (982) | 0.475 (286) | 0.629 (280) | 0.460 (556) | 0.451 (736) | 0.637 (2459) | 0.679 (786) | 0.744 (39) |
| 0.3 | 0.986 (1137) | 0.963 (81) | 0.993 (698) | 0.340 (982) | 0.622 (286) | 0.757 (280) | 0.795 (556) | 0.753 (736) | 0.773 (2459) | 0.723 (786) | 0.897 (39) |
| 0.1 | 0.994 (1137) | 0.975 (81) | 0.993 (698) | 0.414 (982) | 0.664 (286) | 0.839 (280) | 0.867 (556) | 0.814 (736) | 0.793 (2459) | 0.801 (786) | 0.923 (39) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4020 | 0.948 | 0.139 | 0.175 | 0.028 | 0.581 | 0.008 |
| A | 1137 | 0.982 | 0.000 | 0.000 | 0.018 | 0.668 | 0.464 |
| B | 81 | 0.951 | 0.025 | 0.000 | 0.025 | 0.682 | 0.455 |
| C | 698 | 0.989 | 0.011 | 0.000 | 0.013 | 0.697 | 0.494 |
| D | 982 | 0.977 | 0.456 | 0.593 | 0.055 | 0.064 | 0.002 |
| partial | 286 | 0.748 | 0.084 | 0.150 | 0.066 | 0.473 | 0.000 |
| touches_border | 280 | 0.986 | 0.164 | 0.204 | 0.011 | 0.604 | 0.044 |
| tiny | 556 | 0.858 | 0.052 | 0.041 | 0.007 | 0.487 | 0.016 |
| band tiny | 736 | 0.808 | 0.052 | 0.046 | 0.016 | 0.475 | 0.000 |
| band small | 2459 | 0.973 | 0.141 | 0.179 | 0.034 | 0.588 | 0.006 |
| band medium | 786 | 0.995 | 0.206 | 0.276 | 0.020 | 0.716 | 0.027 |
| band large | 39 | 1.000 | 0.256 | 0.359 | 0.000 | 0.853 | 0.297 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.98, IoU 0.64 (n 929) | found 1.00, IoU 0.78 (n 208) | - |
| B | - | found 0.93, IoU 0.66 (n 61) | found 1.00, IoU 0.88 (n 20) | - |
| C | - | found 0.98, IoU 0.66 (n 535) | found 1.00, IoU 0.81 (n 163) | - |
| D | - | found 0.97, IoU 0.03 (n 697) | found 0.98, IoU 0.12 (n 252) | found 1.00, IoU 0.75 (n 33) |

Weed count error per image (detections minus reference weeds): mean 11.16, median abs 11.0, p90 abs 17.0. Detections per image median 16.0, p95 28.549999999999955, max 39; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.919 (p10 0.826); pixel recall of plants 0.991; pixel precision 0.932.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 390.71, preprocess_ms 5.76, forward_ms 292.49, postprocess_ms 45.16, components_ms 3.21, measure_ms 37.83.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 359.22 | 398.35 |
| preprocess_ms | 4.84 | 7.08 |
| forward_ms | 263.88 | 292.91 |
| postprocess_ms | 44.84 | 47.77 |
| components_ms | 3.26 | 3.53 |
| measure_ms | 38.69 | 40.95 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00135_P0030852.png (3), 05-26_00098_P0034280.png (3), 05-15_00053_P0030852.png (2), 05-15_00061_P0030852.png (2)
- most background false positives: 06-05_00175_P0037989.png (22), 06-05_00046_P0037820.png (21), 06-05_00174_P0037989.png (19), 05-15_00241_P0030949.png (17)
- most crop false positives: 05-26_00139_P0034280.png (21), 06-05_00155_P0038055.png (20), 05-26_00194_P0034119.png (19), 05-26_00173_P0034119.png (18)
- most merged references: 05-15_00051_P0030852.png (10), 05-15_00072_P0030852.png (10), 06-05_00153_P0037989.png (10), 06-05_00130_P0037820.png (9)
