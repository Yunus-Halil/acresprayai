# Classical baseline `exg_fixed_t0.15` on `dev_tune`

717 images, 4121 reference weed observations, 738946 detections. Generated 2026-10-13T21:04:38+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.001 | 0.143 | 0.002 | 0.001 | 0.002 | 1029.78 | 4.92 | 977.24 | 27.91 |
| 0.3 | 0.002 | 0.282 | 0.003 | 0.002 | 0.003 | 1028.99 | 4.13 | 977.24 | 27.89 |
| 0.1 | 0.003 | 0.534 | 0.006 | 0.003 | 0.006 | 1027.54 | 2.68 | 977.23 | 27.82 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 738946 | 0.001 | 0.143 | 0.002 | 0.001 | 0.002 | 0.1752 | 977.24 | 27.91 |
| 4 | 70316 | 0.008 | 0.143 | 0.016 | 0.010 | 0.018 | 0.1752 | 74.49 | 13.19 |
| 10 | 25366 | 0.023 | 0.143 | 0.040 | 0.033 | 0.054 | 0.1752 | 17.67 | 10.67 |
| 25 | 12474 | 0.047 | 0.142 | 0.070 | 0.101 | 0.118 | 0.1752 | 3.1 | 9.34 |
| 50 | 8942 | 0.064 | 0.138 | 0.087 | 0.188 | 0.159 | 0.1752 | 0.67 | 8.25 |
| 100 | 6991 | 0.076 | 0.129 | 0.096 | 0.287 | 0.178 | 0.1685 | 0.15 | 7.16 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.179 (1107) | 0.128 (86) | 0.204 (632) | 0.095 (1032) | 0.160 (343) | 0.243 (309) | 0.041 (612) | 0.053 (776) | 0.095 (2463) | 0.344 (851) | 0.774 (31) |
| 0.3 | 0.345 (1107) | 0.430 (86) | 0.402 (632) | 0.176 (1032) | 0.315 (343) | 0.362 (309) | 0.144 (612) | 0.155 (776) | 0.248 (2463) | 0.478 (851) | 0.806 (31) |
| 0.1 | 0.609 (1107) | 0.733 (86) | 0.644 (632) | 0.393 (1032) | 0.539 (343) | 0.670 (309) | 0.423 (612) | 0.424 (776) | 0.507 (2463) | 0.703 (851) | 0.806 (31) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4121 | 0.282 | 0.061 | 0.126 | 0.022 | 0.119 | 0.000 |
| A | 1107 | 0.192 | 0.000 | 0.000 | 0.004 | 0.187 | 0.002 |
| B | 86 | 0.128 | 0.000 | 0.000 | 0.023 | 0.190 | 0.000 |
| C | 632 | 0.226 | 0.000 | 0.000 | 0.021 | 0.220 | 0.012 |
| D | 1032 | 0.489 | 0.188 | 0.388 | 0.035 | 0.046 | 0.001 |
| partial | 343 | 0.327 | 0.073 | 0.152 | 0.061 | 0.120 | 0.000 |
| touches_border | 309 | 0.379 | 0.065 | 0.162 | 0.016 | 0.203 | 0.006 |
| tiny | 612 | 0.101 | 0.021 | 0.029 | 0.013 | 0.074 | 0.000 |
| band tiny | 776 | 0.126 | 0.028 | 0.043 | 0.010 | 0.059 | 0.000 |
| band small | 2463 | 0.202 | 0.047 | 0.096 | 0.025 | 0.097 | 0.000 |
| band medium | 851 | 0.633 | 0.129 | 0.280 | 0.024 | 0.270 | 0.013 |
| band large | 31 | 0.903 | 0.161 | 0.387 | 0.000 | 0.681 | 0.072 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.12, IoU 0.16 (n 933) | found 0.56, IoU 0.54 (n 174) | - |
| B | - | found 0.07, IoU 0.16 (n 60) | found 0.27, IoU 0.41 (n 26) | - |
| C | - | found 0.13, IoU 0.14 (n 492) | found 0.55, IoU 0.50 (n 140) | - |
| D | - | found 0.36, IoU 0.03 (n 655) | found 0.71, IoU 0.09 (n 359) | found 0.94, IoU 0.70 (n 18) |

Weed count error per image (detections minus reference weeds): mean 1024.86, median abs 1010.0, p90 abs 1573.4. Detections per image median 1014.0, p95 1708.1999999999998, max 2108; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.820 (p10 0.614); pixel recall of plants 0.888; pixel precision 0.916.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 52.01, index_and_threshold_ms 13.58, components_ms 2.51, measure_ms 35.91.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 46.24 | 47.94 |
| index_and_threshold_ms | 11.84 | 12.73 |
| components_ms | 2.17 | 2.56 |
| measure_ms | 32.07 | 33.9 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00279_P0030688.png (8), 05-15_00051_P0030950.png (7), 05-15_00193_P0030688.png (7), 05-26_00197_P0034018.png (7)
- most background false positives: 05-26_00194_P0034117.png (2077), 05-15_00282_P0030688.png (2006), 05-15_00240_P0030688.png (1960), 05-15_00261_P0030688.png (1955)
- most crop false positives: 06-05_00156_P0037818.png (111), 06-05_00095_P0037818.png (81), 06-05_00157_P0037818.png (75), 06-05_00135_P0037818.png (74)
- most merged references: 06-05_00046_P0037818.png (6), 06-05_00096_P0037987.png (6), 05-26_00221_P0034279.png (5), 06-05_00060_P0037987.png (5)
