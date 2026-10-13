# Classical baseline `exg_fixed_t0.10` on `dev_tune`

717 images, 4121 reference weed observations, 1042243 detections. Generated 2026-10-13T21:03:39+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.001 | 0.332 | 0.003 | 0.001 | 0.003 | 1451.71 | 3.84 | 1423.47 | 13.19 |
| 0.3 | 0.002 | 0.516 | 0.004 | 0.002 | 0.004 | 1450.65 | 2.78 | 1423.45 | 13.17 |
| 0.1 | 0.003 | 0.689 | 0.005 | 0.003 | 0.005 | 1449.66 | 1.79 | 1423.43 | 13.09 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1042243 | 0.001 | 0.332 | 0.003 | 0.001 | 0.003 | 0.4518 | 1423.47 | 13.19 |
| 4 | 115020 | 0.012 | 0.332 | 0.023 | 0.013 | 0.024 | 0.4518 | 142.14 | 9.53 |
| 10 | 36770 | 0.037 | 0.332 | 0.067 | 0.045 | 0.079 | 0.4518 | 35.3 | 8.96 |
| 25 | 15174 | 0.089 | 0.328 | 0.140 | 0.150 | 0.205 | 0.4518 | 7.18 | 8.56 |
| 50 | 9910 | 0.132 | 0.316 | 0.186 | 0.304 | 0.310 | 0.4518 | 1.69 | 7.84 |
| 100 | 7250 | 0.151 | 0.266 | 0.193 | 0.463 | 0.338 | 0.4166 | 0.36 | 6.8 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.443 (1107) | 0.570 (86) | 0.492 (632) | 0.117 (1032) | 0.327 (343) | 0.417 (309) | 0.257 (612) | 0.253 (776) | 0.310 (2463) | 0.454 (851) | 0.774 (31) |
| 0.3 | 0.615 (1107) | 0.651 (86) | 0.703 (632) | 0.250 (1032) | 0.525 (343) | 0.602 (309) | 0.523 (612) | 0.515 (776) | 0.487 (2463) | 0.589 (851) | 0.806 (31) |
| 0.1 | 0.784 (1107) | 0.837 (86) | 0.902 (632) | 0.433 (1032) | 0.653 (343) | 0.744 (309) | 0.699 (612) | 0.676 (776) | 0.675 (2463) | 0.737 (851) | 0.806 (31) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4121 | 0.533 | 0.096 | 0.166 | 0.051 | 0.314 | 0.003 |
| A | 1107 | 0.460 | 0.000 | 0.000 | 0.043 | 0.411 | 0.042 |
| B | 86 | 0.593 | 0.000 | 0.000 | 0.093 | 0.566 | 0.018 |
| C | 632 | 0.519 | 0.003 | 0.006 | 0.030 | 0.487 | 0.111 |
| D | 1032 | 0.653 | 0.296 | 0.507 | 0.065 | 0.059 | 0.001 |
| partial | 343 | 0.571 | 0.117 | 0.190 | 0.073 | 0.321 | 0.000 |
| touches_border | 309 | 0.618 | 0.087 | 0.188 | 0.061 | 0.422 | 0.014 |
| tiny | 612 | 0.407 | 0.034 | 0.057 | 0.043 | 0.310 | 0.000 |
| band tiny | 776 | 0.426 | 0.044 | 0.073 | 0.039 | 0.306 | 0.000 |
| band small | 2463 | 0.476 | 0.082 | 0.138 | 0.057 | 0.285 | 0.002 |
| band medium | 851 | 0.784 | 0.182 | 0.324 | 0.048 | 0.399 | 0.011 |
| band large | 31 | 0.903 | 0.161 | 0.387 | 0.000 | 0.743 | 0.076 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.42, IoU 0.37 (n 933) | found 0.68, IoU 0.71 (n 174) | - |
| B | - | found 0.57, IoU 0.50 (n 60) | found 0.65, IoU 0.68 (n 26) | - |
| C | - | found 0.42, IoU 0.40 (n 492) | found 0.86, IoU 0.72 (n 140) | - |
| D | - | found 0.56, IoU 0.03 (n 655) | found 0.81, IoU 0.11 (n 359) | found 0.94, IoU 0.76 (n 18) |

Weed count error per image (detections minus reference weeds): mean 1447.87, median abs 1426.0, p90 abs 2195.4. Detections per image median 1431.0, p95 2415.999999999999, max 3093; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.819 (p10 0.657); pixel recall of plants 0.950; pixel precision 0.860.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 51.73, index_and_threshold_ms 13.16, components_ms 2.4, measure_ms 36.16.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 48.49 | 71.02 |
| index_and_threshold_ms | 12.24 | 14.41 |
| components_ms | 2.42 | 3.12 |
| measure_ms | 33.78 | 49.12 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00279_P0030688.png (7), 05-26_00290_P0034018.png (7), 05-15_00051_P0030950.png (6), 05-15_00072_P0030950.png (6)
- most background false positives: 05-15_00282_P0030688.png (3052), 05-15_00261_P0030688.png (2888), 05-15_00281_P0030688.png (2870), 05-15_00240_P0030688.png (2830)
- most crop false positives: 06-05_00156_P0037818.png (32), 05-26_00130_P0034117.png (31), 06-05_00136_P0038053.png (29), 06-05_00137_P0038053.png (29)
- most merged references: 06-05_00096_P0037987.png (8), 06-05_00220_P0038053.png (7), 06-05_00046_P0037818.png (6), 06-05_00075_P0037987.png (6)
