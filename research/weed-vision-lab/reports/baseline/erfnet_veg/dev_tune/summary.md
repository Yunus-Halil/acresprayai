# Classical baseline `erfnet_veg` on `dev_tune`

717 images, 4121 reference weed observations, 12165 detections. Generated 2026-10-13T21:43:15+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.208 | 0.616 | 0.312 | 0.397 | 0.483 | 13.43 | 2.21 | 4.65 | 8.06 |
| 0.3 | 0.254 | 0.750 | 0.380 | 0.483 | 0.588 | 12.65 | 1.43 | 4.25 | 8.04 |
| 0.1 | 0.269 | 0.792 | 0.401 | 0.504 | 0.616 | 12.41 | 1.19 | 4.17 | 7.92 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 12165 | 0.208 | 0.616 | 0.312 | 0.397 | 0.483 | 0.8458 | 4.65 | 8.06 |
| 4 | 11091 | 0.229 | 0.616 | 0.334 | 0.472 | 0.535 | 0.8458 | 3.31 | 7.98 |
| 10 | 10723 | 0.236 | 0.615 | 0.342 | 0.505 | 0.555 | 0.8458 | 2.85 | 7.96 |
| 25 | 10173 | 0.249 | 0.614 | 0.354 | 0.561 | 0.586 | 0.8458 | 2.23 | 7.9 |
| 50 | 9604 | 0.258 | 0.601 | 0.361 | 0.614 | 0.607 | 0.8458 | 1.72 | 7.77 |
| 100 | 8663 | 0.267 | 0.561 | 0.362 | 0.693 | 0.621 | 0.8458 | 1.11 | 7.43 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.847 (1107) | 0.826 (86) | 0.878 (632) | 0.277 (1032) | 0.504 (343) | 0.676 (309) | 0.498 (612) | 0.472 (776) | 0.654 (2463) | 0.631 (851) | 0.774 (31) |
| 0.3 | 0.986 (1107) | 0.919 (86) | 0.987 (632) | 0.367 (1032) | 0.624 (343) | 0.780 (309) | 0.760 (612) | 0.702 (776) | 0.788 (2463) | 0.683 (851) | 0.806 (31) |
| 0.1 | 0.990 (1107) | 0.930 (86) | 0.991 (632) | 0.461 (1032) | 0.676 (343) | 0.851 (309) | 0.806 (612) | 0.751 (776) | 0.818 (2463) | 0.754 (851) | 0.871 (31) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4121 | 0.943 | 0.140 | 0.192 | 0.023 | 0.575 | 0.005 |
| A | 1107 | 0.970 | 0.000 | 0.000 | 0.005 | 0.651 | 0.465 |
| B | 86 | 0.977 | 0.105 | 0.000 | 0.000 | 0.656 | 0.417 |
| C | 632 | 0.983 | 0.003 | 0.009 | 0.011 | 0.677 | 0.468 |
| D | 1032 | 0.975 | 0.421 | 0.601 | 0.036 | 0.091 | 0.002 |
| partial | 343 | 0.799 | 0.119 | 0.181 | 0.079 | 0.500 | 0.000 |
| touches_border | 309 | 0.958 | 0.117 | 0.233 | 0.042 | 0.640 | 0.051 |
| tiny | 612 | 0.866 | 0.085 | 0.054 | 0.010 | 0.497 | 0.001 |
| band tiny | 776 | 0.820 | 0.088 | 0.064 | 0.012 | 0.478 | 0.000 |
| band small | 2463 | 0.961 | 0.128 | 0.175 | 0.030 | 0.591 | 0.005 |
| band medium | 851 | 0.999 | 0.215 | 0.349 | 0.014 | 0.674 | 0.014 |
| band large | 31 | 1.000 | 0.258 | 0.484 | 0.000 | 0.781 | 0.091 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.97, IoU 0.63 (n 933) | found 0.99, IoU 0.78 (n 174) | - |
| B | - | found 0.97, IoU 0.63 (n 60) | found 1.00, IoU 0.73 (n 26) | - |
| C | - | found 0.98, IoU 0.64 (n 492) | found 1.00, IoU 0.81 (n 140) | - |
| D | - | found 0.96, IoU 0.06 (n 655) | found 1.00, IoU 0.13 (n 359) | found 1.00, IoU 0.83 (n 18) |

Weed count error per image (detections minus reference weeds): mean 11.22, median abs 10.0, p90 abs 18.0. Detections per image median 16.0, p95 29.0, max 40; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.919 (p10 0.816); pixel recall of plants 0.990; pixel precision 0.931.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 352.22, preprocess_ms 5.67, forward_ms 261.12, postprocess_ms 43.63, components_ms 3.09, measure_ms 37.79.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 308.71 | 469.95 |
| preprocess_ms | 4.28 | 6.6 |
| forward_ms | 219.01 | 354.62 |
| postprocess_ms | 42.34 | 46.77 |
| components_ms | 3.27 | 3.57 |
| measure_ms | 38.82 | 41.08 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00051_P0030950.png (4), 05-15_00072_P0030950.png (4), 05-15_00279_P0030688.png (4), 05-26_00202_P0034279.png (3)
- most background false positives: 06-05_00139_P0038053.png (28), 06-05_00047_P0037818.png (23), 06-05_00121_P0037987.png (23), 06-05_00131_P0037818.png (23)
- most crop false positives: 05-26_00130_P0034117.png (23), 05-15_00114_P0030950.png (21), 05-26_00248_P0034018.png (20), 05-26_00151_P0034117.png (19)
- most merged references: 06-05_00220_P0038053.png (10), 06-05_00198_P0038053.png (9), 06-05_00219_P0038053.png (9), 06-05_00096_P0037987.png (8)
