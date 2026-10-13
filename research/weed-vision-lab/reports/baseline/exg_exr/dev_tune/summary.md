# Classical baseline `exg_exr` on `dev_tune`

717 images, 4121 reference weed observations, 559327 detections. Generated 2026-10-13T20:58:37+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.001 | 0.113 | 0.002 | 0.001 | 0.002 | 779.44 | 5.1 | 727.62 | 32.17 |
| 0.3 | 0.002 | 0.226 | 0.003 | 0.002 | 0.004 | 778.79 | 4.45 | 727.62 | 32.14 |
| 0.1 | 0.003 | 0.419 | 0.006 | 0.003 | 0.006 | 777.69 | 3.34 | 727.61 | 32.1 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 559327 | 0.001 | 0.113 | 0.002 | 0.001 | 0.002 | 0.1123 | 727.62 | 32.17 |
| 4 | 37932 | 0.012 | 0.113 | 0.022 | 0.018 | 0.030 | 0.1123 | 27.91 | 16.0 |
| 10 | 17736 | 0.026 | 0.113 | 0.043 | 0.058 | 0.077 | 0.1123 | 4.81 | 13.51 |
| 25 | 11903 | 0.039 | 0.113 | 0.058 | 0.130 | 0.121 | 0.1123 | 0.57 | 11.63 |
| 50 | 9691 | 0.047 | 0.110 | 0.066 | 0.198 | 0.141 | 0.1123 | 0.08 | 10.32 |
| 100 | 8071 | 0.054 | 0.105 | 0.071 | 0.299 | 0.156 | 0.109 | 0.02 | 9.23 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.113 (1107) | 0.105 (86) | 0.180 (632) | 0.094 (1032) | 0.125 (343) | 0.227 (309) | 0.015 (612) | 0.023 (776) | 0.058 (2463) | 0.336 (851) | 0.645 (31) |
| 0.3 | 0.229 (1107) | 0.267 (86) | 0.321 (632) | 0.192 (1032) | 0.283 (343) | 0.349 (309) | 0.082 (612) | 0.093 (776) | 0.168 (2463) | 0.497 (851) | 0.806 (31) |
| 0.1 | 0.454 (1107) | 0.570 (86) | 0.506 (632) | 0.350 (1032) | 0.487 (343) | 0.553 (309) | 0.255 (612) | 0.268 (776) | 0.382 (2463) | 0.650 (851) | 0.806 (31) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4121 | 0.215 | 0.038 | 0.090 | 0.021 | 0.052 | 0.000 |
| A | 1107 | 0.113 | 0.000 | 0.000 | 0.011 | 0.072 | 0.000 |
| B | 86 | 0.128 | 0.000 | 0.000 | 0.000 | 0.122 | 0.000 |
| C | 632 | 0.183 | 0.000 | 0.000 | 0.005 | 0.102 | 0.000 |
| D | 1032 | 0.390 | 0.115 | 0.272 | 0.034 | 0.030 | 0.000 |
| partial | 343 | 0.260 | 0.047 | 0.122 | 0.061 | 0.077 | 0.000 |
| touches_border | 309 | 0.346 | 0.049 | 0.123 | 0.029 | 0.130 | 0.000 |
| tiny | 612 | 0.057 | 0.010 | 0.020 | 0.011 | 0.011 | 0.000 |
| band tiny | 776 | 0.076 | 0.014 | 0.030 | 0.009 | 0.011 | 0.000 |
| band small | 2463 | 0.128 | 0.021 | 0.066 | 0.015 | 0.036 | 0.000 |
| band medium | 851 | 0.571 | 0.102 | 0.213 | 0.051 | 0.296 | 0.010 |
| band large | 31 | 0.774 | 0.161 | 0.194 | 0.000 | 0.706 | 0.074 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.05, IoU 0.05 (n 933) | found 0.45, IoU 0.46 (n 174) | - |
| B | - | found 0.03, IoU 0.07 (n 60) | found 0.35, IoU 0.40 (n 26) | - |
| C | - | found 0.08, IoU 0.05 (n 492) | found 0.56, IoU 0.54 (n 140) | - |
| D | - | found 0.25, IoU 0.01 (n 655) | found 0.62, IoU 0.09 (n 359) | found 0.83, IoU 0.73 (n 18) |

Weed count error per image (detections minus reference weeds): mean 774.35, median abs 703.0, p90 abs 1305.8. Detections per image median 711.0, p95 1421.3999999999999, max 1712; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.822 (p10 0.563); pixel recall of plants 0.848; pixel precision 0.966.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 51.63, index_and_threshold_ms 14.35, components_ms 2.35, measure_ms 34.92.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 49.7 | 68.02 |
| index_and_threshold_ms | 14.09 | 18.76 |
| components_ms | 2.33 | 3.66 |
| measure_ms | 33.24 | 50.05 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00279_P0030688.png (8), 05-15_00051_P0030950.png (7), 05-15_00193_P0030688.png (7), 05-26_00197_P0034018.png (7)
- most background false positives: 05-15_00282_P0030688.png (1638), 05-15_00281_P0030688.png (1625), 05-15_00184_P0030692.png (1610), 05-15_00220_P0030692.png (1586)
- most crop false positives: 05-15_00139_P0030853.png (89), 05-15_00115_P0030950.png (87), 05-15_00204_P0030692.png (86), 05-15_00201_P0030853.png (85)
- most merged references: 05-26_00221_P0034279.png (5), 06-05_00046_P0037818.png (5), 06-05_00060_P0037987.png (5), 06-05_00096_P0037987.png (5)
