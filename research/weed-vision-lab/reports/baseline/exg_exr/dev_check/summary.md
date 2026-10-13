# Classical baseline `exg_exr` on `dev_check`

690 images, 4020 reference weed observations, 427603 detections. Generated 2026-10-13T21:08:40+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.001 | 0.112 | 0.002 | 0.001 | 0.002 | 619.06 | 5.17 | 568.32 | 31.34 |
| 0.3 | 0.002 | 0.193 | 0.004 | 0.002 | 0.004 | 618.59 | 4.7 | 568.31 | 31.32 |
| 0.1 | 0.004 | 0.401 | 0.007 | 0.004 | 0.008 | 617.38 | 3.49 | 568.31 | 31.24 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 427603 | 0.001 | 0.112 | 0.002 | 0.001 | 0.002 | 0.1256 | 568.32 | 31.34 |
| 4 | 34209 | 0.013 | 0.112 | 0.024 | 0.019 | 0.033 | 0.1256 | 24.62 | 15.88 |
| 10 | 16734 | 0.027 | 0.112 | 0.043 | 0.060 | 0.079 | 0.1256 | 4.3 | 13.43 |
| 25 | 11631 | 0.039 | 0.112 | 0.058 | 0.129 | 0.120 | 0.1256 | 0.6 | 11.81 |
| 50 | 9507 | 0.046 | 0.110 | 0.065 | 0.192 | 0.140 | 0.1256 | 0.16 | 10.45 |
| 100 | 8004 | 0.053 | 0.105 | 0.070 | 0.285 | 0.154 | 0.124 | 0.03 | 9.45 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.128 (1137) | 0.099 (81) | 0.192 (698) | 0.060 (982) | 0.147 (286) | 0.186 (280) | 0.020 (556) | 0.025 (736) | 0.063 (2459) | 0.322 (786) | 0.615 (39) |
| 0.3 | 0.224 (1137) | 0.148 (81) | 0.289 (698) | 0.120 (982) | 0.252 (286) | 0.296 (280) | 0.063 (556) | 0.069 (736) | 0.141 (2459) | 0.443 (786) | 0.795 (39) |
| 0.1 | 0.410 (1137) | 0.407 (81) | 0.531 (698) | 0.361 (982) | 0.458 (286) | 0.539 (280) | 0.185 (556) | 0.219 (736) | 0.346 (2459) | 0.715 (786) | 0.923 (39) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4020 | 0.217 | 0.050 | 0.090 | 0.014 | 0.041 | 0.000 |
| A | 1137 | 0.132 | 0.000 | 0.000 | 0.025 | 0.056 | 0.000 |
| B | 81 | 0.099 | 0.000 | 0.000 | 0.000 | 0.090 | 0.000 |
| C | 698 | 0.196 | 0.000 | 0.000 | 0.007 | 0.123 | 0.000 |
| D | 982 | 0.397 | 0.172 | 0.305 | 0.011 | 0.026 | 0.000 |
| partial | 286 | 0.273 | 0.021 | 0.098 | 0.021 | 0.061 | 0.000 |
| touches_border | 280 | 0.318 | 0.071 | 0.107 | 0.018 | 0.127 | 0.000 |
| tiny | 556 | 0.038 | 0.011 | 0.011 | 0.000 | 0.000 | 0.000 |
| band tiny | 736 | 0.058 | 0.009 | 0.025 | 0.005 | 0.000 | 0.000 |
| band small | 2459 | 0.153 | 0.035 | 0.074 | 0.011 | 0.028 | 0.000 |
| band medium | 786 | 0.536 | 0.130 | 0.192 | 0.032 | 0.255 | 0.017 |
| band large | 39 | 0.846 | 0.154 | 0.359 | 0.000 | 0.711 | 0.156 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.06, IoU 0.02 (n 929) | found 0.45, IoU 0.42 (n 208) | - |
| B | - | found 0.00, IoU 0.03 (n 61) | found 0.40, IoU 0.28 (n 20) | - |
| C | - | found 0.11, IoU 0.05 (n 535) | found 0.49, IoU 0.49 (n 163) | - |
| D | - | found 0.29, IoU 0.01 (n 697) | found 0.64, IoU 0.13 (n 252) | found 0.82, IoU 0.60 (n 33) |

Weed count error per image (detections minus reference weeds): mean 613.89, median abs 612.5, p90 abs 946.1. Detections per image median 615.5, p95 1029.6499999999999, max 1305; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.838 (p10 0.634); pixel recall of plants 0.865; pixel precision 0.966.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 52.84, index_and_threshold_ms 14.44, components_ms 2.53, measure_ms 35.87.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 46.84 | 49.83 |
| index_and_threshold_ms | 13.32 | 14.65 |
| components_ms | 2.18 | 2.72 |
| measure_ms | 31.24 | 33.26 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00072_P0030852.png (12), 05-15_00134_P0030852.png (9), 05-15_00051_P0030852.png (8), 05-15_00073_P0030852.png (8)
- most background false positives: 05-26_00180_P0034020.png (1250), 05-26_00173_P0034119.png (1152), 05-26_00158_P0034280.png (1141), 05-15_00262_P0030690.png (1140)
- most crop false positives: 06-05_00074_P0037820.png (93), 05-15_00177_P0030949.png (91), 05-15_00156_P0030949.png (90), 05-15_00157_P0030949.png (88)
- most merged references: 06-05_00153_P0037989.png (8), 06-05_00052_P0037820.png (7), 06-05_00130_P0037820.png (7), 06-05_00134_P0038055.png (7)
