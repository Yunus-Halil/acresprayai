# Classical baseline `exg_hyst_h0.10_l0.03` on `dev_tune`

717 images, 4121 reference weed observations, 640767 detections. Generated 2026-10-13T21:43:53+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.003 | 0.492 | 0.006 | 0.003 | 0.006 | 890.85 | 2.92 | 881.59 | 6.83 |
| 0.3 | 0.004 | 0.656 | 0.008 | 0.004 | 0.008 | 889.91 | 1.98 | 881.34 | 6.83 |
| 0.1 | 0.005 | 0.743 | 0.009 | 0.005 | 0.010 | 889.41 | 1.48 | 881.2 | 6.74 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 640767 | 0.003 | 0.492 | 0.006 | 0.003 | 0.006 | 0.7552 | 881.59 | 6.83 |
| 4 | 240968 | 0.008 | 0.492 | 0.017 | 0.009 | 0.017 | 0.7552 | 324.21 | 6.79 |
| 10 | 117541 | 0.017 | 0.492 | 0.033 | 0.018 | 0.035 | 0.7552 | 152.14 | 6.79 |
| 25 | 35560 | 0.057 | 0.491 | 0.102 | 0.066 | 0.116 | 0.7552 | 38.02 | 6.76 |
| 50 | 16230 | 0.122 | 0.481 | 0.195 | 0.173 | 0.255 | 0.7552 | 11.57 | 6.65 |
| 100 | 9610 | 0.185 | 0.432 | 0.259 | 0.350 | 0.387 | 0.7326 | 3.52 | 6.31 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.753 (1107) | 0.779 (86) | 0.666 (632) | 0.131 (1032) | 0.361 (343) | 0.492 (309) | 0.484 (612) | 0.438 (776) | 0.506 (2463) | 0.495 (851) | 0.710 (31) |
| 0.3 | 0.895 (1107) | 0.861 (86) | 0.786 (632) | 0.251 (1032) | 0.574 (343) | 0.650 (309) | 0.789 (612) | 0.727 (776) | 0.656 (2463) | 0.588 (851) | 0.710 (31) |
| 0.1 | 0.968 (1107) | 0.884 (86) | 0.866 (632) | 0.371 (1032) | 0.671 (343) | 0.799 (309) | 0.830 (612) | 0.782 (776) | 0.751 (2463) | 0.683 (851) | 0.742 (31) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4121 | 0.845 | 0.169 | 0.236 | 0.063 | 0.492 | 0.002 |
| A | 1107 | 0.804 | 0.001 | 0.002 | 0.054 | 0.624 | 0.288 |
| B | 86 | 0.826 | 0.093 | 0.000 | 0.058 | 0.612 | 0.085 |
| C | 632 | 0.866 | 0.060 | 0.119 | 0.071 | 0.600 | 0.014 |
| D | 1032 | 0.873 | 0.487 | 0.657 | 0.093 | 0.026 | 0.001 |
| partial | 343 | 0.816 | 0.160 | 0.248 | 0.070 | 0.371 | 0.000 |
| touches_border | 309 | 0.825 | 0.142 | 0.265 | 0.052 | 0.491 | 0.008 |
| tiny | 612 | 0.881 | 0.078 | 0.080 | 0.020 | 0.493 | 0.001 |
| band tiny | 776 | 0.851 | 0.085 | 0.098 | 0.021 | 0.469 | 0.000 |
| band small | 2463 | 0.810 | 0.151 | 0.220 | 0.077 | 0.507 | 0.002 |
| band medium | 851 | 0.936 | 0.288 | 0.396 | 0.060 | 0.489 | 0.009 |
| band large | 31 | 1.000 | 0.419 | 0.548 | 0.000 | 0.700 | 0.034 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.78, IoU 0.61 (n 933) | found 0.91, IoU 0.71 (n 174) | - |
| B | - | found 0.77, IoU 0.63 (n 60) | found 0.96, IoU 0.60 (n 26) | - |
| C | - | found 0.84, IoU 0.57 (n 492) | found 0.97, IoU 0.68 (n 140) | - |
| D | - | found 0.84, IoU 0.01 (n 655) | found 0.93, IoU 0.05 (n 359) | found 1.00, IoU 0.72 (n 18) |

Weed count error per image (detections minus reference weeds): mean 887.93, median abs 691.0, p90 abs 1739.3999999999999. Detections per image median 695.0, p95 1873.5999999999995, max 2398; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.706 (p10 0.505); pixel recall of plants 0.989; pixel precision 0.715.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 61.37, index_and_threshold_ms 22.34, components_ms 3.17, measure_ms 35.85.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 51.79 | 55.94 |
| index_and_threshold_ms | 16.4 | 19.86 |
| components_ms | 2.36 | 2.73 |
| measure_ms | 32.72 | 34.88 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00051_P0030950.png (5), 05-15_00072_P0030950.png (5), 05-15_00133_P0030853.png (4), 05-15_00193_P0030688.png (4)
- most background false positives: 05-15_00284_P0030688.png (2386), 05-15_00220_P0030692.png (2283), 05-15_00281_P0030688.png (2273), 05-15_00282_P0030688.png (2255)
- most crop false positives: 05-26_00130_P0034117.png (17), 05-26_00223_P0034018.png (15), 05-26_00151_P0034117.png (14), 05-26_00248_P0034018.png (14)
- most merged references: 06-05_00219_P0038053.png (11), 06-05_00154_P0038053.png (10), 06-05_00198_P0038053.png (10), 06-05_00220_P0038053.png (10)
