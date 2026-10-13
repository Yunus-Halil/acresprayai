# Classical baseline `exg_fixed_t0.05` on `dev_tune`

717 images, 4121 reference weed observations, 2122505 detections. Generated 2026-10-13T21:01:06+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.001 | 0.496 | 0.002 | 0.001 | 0.002 | 2957.4 | 2.89 | 2939.28 | 8.56 |
| 0.3 | 0.001 | 0.649 | 0.003 | 0.001 | 0.003 | 2956.53 | 2.02 | 2939.2 | 8.55 |
| 0.1 | 0.002 | 0.768 | 0.003 | 0.002 | 0.003 | 2955.84 | 1.33 | 2939.15 | 8.45 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2122505 | 0.001 | 0.496 | 0.002 | 0.001 | 0.002 | 0.6773 | 2939.28 | 8.56 |
| 4 | 314827 | 0.006 | 0.496 | 0.013 | 0.007 | 0.013 | 0.6773 | 423.84 | 7.72 |
| 10 | 85247 | 0.024 | 0.495 | 0.046 | 0.026 | 0.049 | 0.6773 | 104.78 | 7.62 |
| 25 | 24735 | 0.082 | 0.494 | 0.141 | 0.105 | 0.174 | 0.6773 | 21.37 | 7.55 |
| 50 | 12964 | 0.150 | 0.472 | 0.228 | 0.253 | 0.330 | 0.6773 | 6.03 | 7.35 |
| 100 | 8462 | 0.199 | 0.409 | 0.268 | 0.456 | 0.431 | 0.6572 | 1.66 | 6.64 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.678 (1107) | 0.663 (86) | 0.712 (632) | 0.128 (1032) | 0.452 (343) | 0.531 (309) | 0.551 (612) | 0.518 (776) | 0.492 (2463) | 0.482 (851) | 0.742 (31) |
| 0.3 | 0.823 (1107) | 0.861 (86) | 0.839 (632) | 0.270 (1032) | 0.612 (343) | 0.644 (309) | 0.768 (612) | 0.728 (776) | 0.636 (2463) | 0.608 (851) | 0.774 (31) |
| 0.1 | 0.962 (1107) | 0.907 (86) | 0.919 (632) | 0.407 (1032) | 0.741 (343) | 0.803 (309) | 0.850 (612) | 0.822 (776) | 0.770 (2463) | 0.715 (851) | 0.774 (31) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4121 | 0.775 | 0.136 | 0.205 | 0.062 | 0.495 | 0.005 |
| A | 1107 | 0.718 | 0.000 | 0.000 | 0.051 | 0.628 | 0.197 |
| B | 86 | 0.663 | 0.000 | 0.000 | 0.058 | 0.670 | 0.116 |
| C | 632 | 0.829 | 0.017 | 0.044 | 0.068 | 0.614 | 0.186 |
| D | 1032 | 0.795 | 0.409 | 0.607 | 0.087 | 0.039 | 0.001 |
| partial | 343 | 0.790 | 0.134 | 0.222 | 0.064 | 0.445 | 0.001 |
| touches_border | 309 | 0.786 | 0.133 | 0.236 | 0.052 | 0.559 | 0.034 |
| tiny | 612 | 0.789 | 0.065 | 0.070 | 0.039 | 0.537 | 0.017 |
| band tiny | 776 | 0.778 | 0.070 | 0.086 | 0.032 | 0.516 | 0.002 |
| band small | 2463 | 0.735 | 0.121 | 0.183 | 0.070 | 0.492 | 0.003 |
| band medium | 851 | 0.881 | 0.232 | 0.365 | 0.070 | 0.481 | 0.009 |
| band large | 31 | 1.000 | 0.387 | 0.516 | 0.000 | 0.734 | 0.064 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.70, IoU 0.61 (n 933) | found 0.83, IoU 0.74 (n 174) | - |
| B | - | found 0.67, IoU 0.67 (n 60) | found 0.65, IoU 0.74 (n 26) | - |
| C | - | found 0.80, IoU 0.59 (n 492) | found 0.94, IoU 0.72 (n 140) | - |
| D | - | found 0.74, IoU 0.03 (n 655) | found 0.89, IoU 0.07 (n 359) | found 1.00, IoU 0.77 (n 18) |

Weed count error per image (detections minus reference weeds): mean 2954.51, median abs 3075.0, p90 abs 4561.799999999999. Detections per image median 3079.0, p95 4918.199999999996, max 6282; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.739 (p10 0.505); pixel recall of plants 0.983; pixel precision 0.752.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 53.23, index_and_threshold_ms 12.96, components_ms 2.79, measure_ms 37.47.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 50.37 | 86.99 |
| index_and_threshold_ms | 11.81 | 14.58 |
| components_ms | 2.36 | 3.01 |
| measure_ms | 36.44 | 73.03 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00051_P0030950.png (6), 05-15_00072_P0030950.png (6), 05-15_00193_P0030688.png (5), 05-15_00052_P0030950.png (4)
- most background false positives: 05-15_00282_P0030688.png (6248), 05-15_00261_P0030688.png (5997), 05-15_00281_P0030688.png (5875), 05-15_00260_P0030688.png (5735)
- most crop false positives: 05-15_00135_P0030947.png (19), 05-26_00130_P0034117.png (19), 05-15_00162_P0030692.png (18), 05-26_00151_P0034117.png (18)
- most merged references: 06-05_00220_P0038053.png (10), 06-05_00198_P0038053.png (9), 06-05_00219_P0038053.png (9), 06-05_00096_P0037987.png (8)
