# Classical baseline `exg_fixed_t0.05` on `dev_check`

690 images, 4020 reference weed observations, 1623540 detections. Generated 2026-10-13T21:07:28+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.001 | 0.485 | 0.002 | 0.001 | 0.002 | 2350.13 | 3.0 | 2331.62 | 8.52 |
| 0.3 | 0.002 | 0.660 | 0.003 | 0.002 | 0.003 | 2349.11 | 1.98 | 2331.51 | 8.51 |
| 0.1 | 0.002 | 0.773 | 0.004 | 0.002 | 0.004 | 2348.45 | 1.32 | 2331.48 | 8.42 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1623540 | 0.001 | 0.485 | 0.002 | 0.001 | 0.002 | 0.6199 | 2331.62 | 8.52 |
| 4 | 246637 | 0.008 | 0.485 | 0.016 | 0.008 | 0.016 | 0.6199 | 341.78 | 7.84 |
| 10 | 69321 | 0.028 | 0.483 | 0.053 | 0.030 | 0.057 | 0.6199 | 86.23 | 7.71 |
| 25 | 21904 | 0.088 | 0.481 | 0.149 | 0.116 | 0.187 | 0.6199 | 18.43 | 7.61 |
| 50 | 12174 | 0.153 | 0.462 | 0.230 | 0.263 | 0.335 | 0.6199 | 5.37 | 7.39 |
| 100 | 8171 | 0.195 | 0.397 | 0.262 | 0.441 | 0.418 | 0.5895 | 1.61 | 6.6 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.629 (1137) | 0.494 (81) | 0.653 (698) | 0.162 (982) | 0.465 (286) | 0.479 (280) | 0.561 (556) | 0.531 (736) | 0.443 (2459) | 0.565 (786) | 0.667 (39) |
| 0.3 | 0.839 (1137) | 0.642 (81) | 0.807 (698) | 0.303 (982) | 0.594 (286) | 0.661 (280) | 0.779 (556) | 0.735 (736) | 0.632 (2459) | 0.672 (786) | 0.821 (39) |
| 0.1 | 0.948 (1137) | 0.852 (81) | 0.918 (698) | 0.417 (982) | 0.710 (286) | 0.793 (280) | 0.871 (556) | 0.829 (736) | 0.756 (2459) | 0.766 (786) | 0.923 (39) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4020 | 0.738 | 0.113 | 0.175 | 0.086 | 0.482 | 0.006 |
| A | 1137 | 0.685 | 0.000 | 0.000 | 0.118 | 0.601 | 0.193 |
| B | 81 | 0.543 | 0.025 | 0.000 | 0.111 | 0.484 | 0.036 |
| C | 698 | 0.762 | 0.033 | 0.046 | 0.056 | 0.616 | 0.150 |
| D | 982 | 0.796 | 0.361 | 0.554 | 0.097 | 0.048 | 0.002 |
| partial | 286 | 0.738 | 0.066 | 0.182 | 0.066 | 0.452 | 0.000 |
| touches_border | 280 | 0.750 | 0.150 | 0.200 | 0.061 | 0.488 | 0.026 |
| tiny | 556 | 0.737 | 0.027 | 0.034 | 0.061 | 0.525 | 0.077 |
| band tiny | 736 | 0.715 | 0.033 | 0.049 | 0.061 | 0.516 | 0.017 |
| band small | 2459 | 0.693 | 0.105 | 0.173 | 0.100 | 0.444 | 0.004 |
| band medium | 786 | 0.889 | 0.212 | 0.282 | 0.071 | 0.584 | 0.016 |
| band large | 39 | 1.000 | 0.154 | 0.513 | 0.000 | 0.753 | 0.213 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.64, IoU 0.57 (n 929) | found 0.87, IoU 0.74 (n 208) | - |
| B | - | found 0.51, IoU 0.38 (n 61) | found 0.65, IoU 0.74 (n 20) | - |
| C | - | found 0.72, IoU 0.58 (n 535) | found 0.91, IoU 0.71 (n 163) | - |
| D | - | found 0.75, IoU 0.02 (n 697) | found 0.90, IoU 0.11 (n 252) | found 1.00, IoU 0.75 (n 33) |

Weed count error per image (detections minus reference weeds): mean 2347.13, median abs 2485.0, p90 abs 3439.9. Detections per image median 2491.0, p95 3762.2, max 4574; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.758 (p10 0.609); pixel recall of plants 0.983; pixel precision 0.769.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 53.44, index_and_threshold_ms 13.56, components_ms 2.47, measure_ms 37.4.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 48.17 | 53.22 |
| index_and_threshold_ms | 11.97 | 12.95 |
| components_ms | 2.31 | 2.72 |
| measure_ms | 33.93 | 37.85 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00072_P0030852.png (8), 05-15_00051_P0030852.png (5), 05-15_00073_P0030852.png (5), 05-15_00093_P0030852.png (5)
- most background false positives: 06-05_00202_P0038055.png (4555), 06-05_00155_P0038055.png (4437), 05-15_00262_P0030690.png (4326), 06-05_00203_P0038055.png (4223)
- most crop false positives: 05-26_00159_P0034119.png (22), 06-05_00224_P0038055.png (20), 05-26_00215_P0034119.png (19), 06-05_00155_P0038055.png (19)
- most merged references: 06-05_00112_P0038055.png (11), 06-05_00113_P0038055.png (10), 06-05_00153_P0037989.png (10), 06-05_00130_P0037820.png (9)
