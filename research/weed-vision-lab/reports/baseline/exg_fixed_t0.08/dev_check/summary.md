# Classical baseline `exg_fixed_t0.08` on `dev_check`

690 images, 4020 reference weed observations, 1009398 detections. Generated 2026-10-13T21:06:29+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.002 | 0.383 | 0.003 | 0.002 | 0.003 | 1460.66 | 3.59 | 1437.47 | 10.72 |
| 0.3 | 0.002 | 0.572 | 0.004 | 0.002 | 0.005 | 1459.56 | 2.49 | 1437.43 | 10.71 |
| 0.1 | 0.003 | 0.736 | 0.006 | 0.003 | 0.006 | 1458.61 | 1.54 | 1437.41 | 10.63 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1009398 | 0.002 | 0.383 | 0.003 | 0.002 | 0.003 | 0.477 | 1437.47 | 10.72 |
| 4 | 133938 | 0.011 | 0.383 | 0.022 | 0.012 | 0.023 | 0.477 | 176.97 | 8.82 |
| 10 | 41653 | 0.037 | 0.382 | 0.067 | 0.043 | 0.077 | 0.477 | 45.06 | 8.54 |
| 25 | 15940 | 0.096 | 0.381 | 0.153 | 0.149 | 0.214 | 0.477 | 9.28 | 8.24 |
| 50 | 10263 | 0.143 | 0.365 | 0.206 | 0.296 | 0.327 | 0.477 | 2.62 | 7.69 |
| 100 | 7301 | 0.171 | 0.310 | 0.220 | 0.465 | 0.372 | 0.4598 | 0.57 | 6.69 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.485 (1137) | 0.370 (81) | 0.544 (698) | 0.124 (982) | 0.388 (286) | 0.425 (280) | 0.408 (556) | 0.383 (736) | 0.338 (2459) | 0.509 (786) | 0.667 (39) |
| 0.3 | 0.703 (1137) | 0.543 (81) | 0.729 (698) | 0.278 (982) | 0.528 (286) | 0.600 (280) | 0.642 (556) | 0.605 (736) | 0.532 (2459) | 0.653 (786) | 0.872 (39) |
| 0.1 | 0.895 (1137) | 0.691 (81) | 0.874 (698) | 0.409 (982) | 0.668 (286) | 0.782 (280) | 0.833 (556) | 0.781 (736) | 0.709 (2459) | 0.768 (786) | 0.923 (39) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4020 | 0.595 | 0.105 | 0.159 | 0.067 | 0.378 | 0.004 |
| A | 1137 | 0.515 | 0.000 | 0.000 | 0.079 | 0.469 | 0.096 |
| B | 81 | 0.444 | 0.025 | 0.000 | 0.074 | 0.351 | 0.007 |
| C | 698 | 0.610 | 0.026 | 0.023 | 0.052 | 0.527 | 0.042 |
| D | 982 | 0.704 | 0.339 | 0.517 | 0.068 | 0.055 | 0.002 |
| partial | 286 | 0.626 | 0.059 | 0.164 | 0.063 | 0.333 | 0.000 |
| touches_border | 280 | 0.639 | 0.129 | 0.186 | 0.079 | 0.421 | 0.019 |
| tiny | 556 | 0.529 | 0.027 | 0.027 | 0.058 | 0.430 | 0.019 |
| band tiny | 736 | 0.512 | 0.033 | 0.039 | 0.054 | 0.411 | 0.000 |
| band small | 2459 | 0.541 | 0.097 | 0.152 | 0.066 | 0.335 | 0.003 |
| band medium | 786 | 0.821 | 0.195 | 0.275 | 0.089 | 0.524 | 0.018 |
| band large | 39 | 1.000 | 0.154 | 0.462 | 0.000 | 0.766 | 0.289 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.45, IoU 0.42 (n 929) | found 0.79, IoU 0.74 (n 208) | - |
| B | - | found 0.38, IoU 0.28 (n 61) | found 0.65, IoU 0.72 (n 20) | - |
| C | - | found 0.55, IoU 0.48 (n 535) | found 0.82, IoU 0.74 (n 163) | - |
| D | - | found 0.64, IoU 0.03 (n 697) | found 0.85, IoU 0.10 (n 252) | found 1.00, IoU 0.77 (n 33) |

Weed count error per image (detections minus reference weeds): mean 1457.07, median abs 1493.0, p90 abs 2142.2. Detections per image median 1501.0, p95 2387.199999999999, max 3197; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.808 (p10 0.711); pixel recall of plants 0.968; pixel precision 0.833.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 51.16, index_and_threshold_ms 13.3, components_ms 2.81, measure_ms 35.04.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 46.1 | 48.3 |
| index_and_threshold_ms | 11.86 | 12.74 |
| components_ms | 2.16 | 2.47 |
| measure_ms | 31.82 | 34.35 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00072_P0030852.png (8), 05-15_00134_P0030852.png (7), 05-15_00073_P0030852.png (6), 05-15_00135_P0030852.png (6)
- most background false positives: 05-26_00255_P0034119.png (3175), 06-05_00181_P0038055.png (2854), 06-05_00202_P0038055.png (2809), 05-26_00234_P0034119.png (2803)
- most crop false positives: 06-05_00074_P0037820.png (35), 06-05_00137_P0037820.png (35), 06-05_00095_P0037820.png (32), 06-05_00116_P0037820.png (29)
- most merged references: 06-05_00112_P0038055.png (10), 06-05_00113_P0038055.png (10), 06-05_00153_P0037989.png (10), 06-05_00130_P0037820.png (9)
