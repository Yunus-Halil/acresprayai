# Classical baseline `erfnet_weed` on `dev_tune`

717 images, 4121 reference weed observations, 7875 detections. Generated 2026-10-13T21:38:43+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.387 | 0.740 | 0.509 | 0.411 | 0.529 | 6.73 | 1.49 | 4.92 | 0.63 |
| 0.3 | 0.466 | 0.890 | 0.611 | 0.494 | 0.635 | 5.87 | 0.63 | 4.49 | 0.63 |
| 0.1 | 0.480 | 0.918 | 0.631 | 0.509 | 0.655 | 5.71 | 0.47 | 4.42 | 0.63 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 7875 | 0.387 | 0.740 | 0.509 | 0.411 | 0.529 | 0.8391 | 4.92 | 0.63 |
| 4 | 6481 | 0.471 | 0.740 | 0.576 | 0.489 | 0.589 | 0.8391 | 3.48 | 0.33 |
| 10 | 6032 | 0.506 | 0.740 | 0.601 | 0.523 | 0.613 | 0.8391 | 2.97 | 0.27 |
| 25 | 5434 | 0.560 | 0.739 | 0.638 | 0.576 | 0.647 | 0.8391 | 2.31 | 0.21 |
| 50 | 4871 | 0.617 | 0.729 | 0.668 | 0.630 | 0.676 | 0.8391 | 1.79 | 0.14 |
| 100 | 4098 | 0.698 | 0.694 | 0.696 | 0.707 | 0.701 | 0.8391 | 1.15 | 0.07 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.840 (1107) | 0.826 (86) | 0.878 (632) | 0.764 (1032) | 0.507 (343) | 0.803 (309) | 0.464 (612) | 0.425 (776) | 0.777 (2463) | 0.913 (851) | 1.000 (31) |
| 0.3 | 0.978 (1107) | 0.919 (86) | 0.992 (632) | 0.902 (1032) | 0.633 (343) | 0.916 (309) | 0.730 (612) | 0.657 (776) | 0.936 (2463) | 0.964 (851) | 1.000 (31) |
| 0.1 | 0.986 (1107) | 0.930 (86) | 1.000 (632) | 0.931 (1032) | 0.688 (343) | 0.961 (309) | 0.792 (612) | 0.724 (776) | 0.961 (2463) | 0.966 (851) | 1.000 (31) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4121 | 0.904 | 0.049 | 0.003 | 0.029 | 0.623 | 0.278 |
| A | 1107 | 0.962 | 0.000 | 0.000 | 0.004 | 0.650 | 0.461 |
| B | 86 | 0.977 | 0.105 | 0.000 | 0.000 | 0.656 | 0.417 |
| C | 632 | 0.981 | 0.003 | 0.000 | 0.011 | 0.675 | 0.472 |
| D | 1032 | 0.943 | 0.120 | 0.001 | 0.065 | 0.633 | 0.324 |
| partial | 343 | 0.668 | 0.050 | 0.020 | 0.070 | 0.507 | 0.000 |
| touches_border | 309 | 0.909 | 0.052 | 0.013 | 0.042 | 0.698 | 0.378 |
| tiny | 612 | 0.774 | 0.056 | 0.000 | 0.008 | 0.476 | 0.000 |
| band tiny | 776 | 0.710 | 0.054 | 0.003 | 0.009 | 0.451 | 0.000 |
| band small | 2463 | 0.935 | 0.034 | 0.002 | 0.035 | 0.623 | 0.394 |
| band medium | 851 | 0.987 | 0.087 | 0.005 | 0.032 | 0.769 | 0.524 |
| band large | 31 | 1.000 | 0.065 | 0.000 | 0.000 | 0.871 | 0.714 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.96, IoU 0.63 (n 933) | found 0.99, IoU 0.78 (n 174) | - |
| B | - | found 0.97, IoU 0.63 (n 60) | found 1.00, IoU 0.73 (n 26) | - |
| C | - | found 0.98, IoU 0.64 (n 492) | found 1.00, IoU 0.81 (n 140) | - |
| D | - | found 0.92, IoU 0.59 (n 655) | found 0.98, IoU 0.74 (n 359) | found 1.00, IoU 0.89 (n 18) |

Weed count error per image (detections minus reference weeds): mean 5.24, median abs 4.0, p90 abs 13.0. Detections per image median 9.0, p95 25.0, max 39; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.032 (p10 0.004); pixel recall of plants 0.032; pixel precision 0.648.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 333.24, preprocess_ms 5.46, forward_ms 244.41, postprocess_ms 42.43, components_ms 3.0, measure_ms 37.01.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 328.77 | 400.28 |
| preprocess_ms | 4.33 | 5.74 |
| forward_ms | 238.61 | 302.39 |
| postprocess_ms | 43.62 | 48.13 |
| components_ms | 3.11 | 3.61 |
| measure_ms | 38.44 | 40.84 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00051_P0030950.png (4), 05-15_00072_P0030950.png (4), 05-15_00279_P0030688.png (4), 05-26_00202_P0034279.png (3)
- most background false positives: 06-05_00131_P0037818.png (29), 06-05_00141_P0037987.png (26), 06-05_00110_P0037818.png (25), 06-05_00139_P0038053.png (25)
- most crop false positives: 05-26_00225_P0034018.png (10), 05-15_00164_P0030853.png (6), 05-26_00179_P0034279.png (6), 06-05_00174_P0038053.png (6)
- most merged references: 05-15_00180_P0030688.png (4), 05-15_00181_P0030688.png (4), 05-15_00216_P0030688.png (4), 05-15_00217_P0030688.png (4)
