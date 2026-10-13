# Classical baseline `erfnet_weed` on `smoke`

10 images, 115 reference weed observations, 173 detections. Generated 2026-10-13T21:33:34+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.480 | 0.722 | 0.576 | 0.515 | 0.601 | 9.0 | 3.2 | 5.6 | 1.2 |
| 0.3 | 0.567 | 0.852 | 0.681 | 0.609 | 0.710 | 7.5 | 1.7 | 5.1 | 1.2 |
| 0.1 | 0.590 | 0.887 | 0.708 | 0.633 | 0.739 | 7.1 | 1.3 | 4.9 | 1.2 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 173 | 0.480 | 0.722 | 0.576 | 0.515 | 0.601 | 0.8929 | 5.6 | 1.2 |
| 4 | 148 | 0.561 | 0.722 | 0.631 | 0.593 | 0.651 | 0.8929 | 3.6 | 0.8 |
| 10 | 139 | 0.597 | 0.722 | 0.653 | 0.634 | 0.675 | 0.8929 | 2.9 | 0.8 |
| 25 | 127 | 0.653 | 0.722 | 0.686 | 0.669 | 0.695 | 0.8929 | 2.4 | 0.3 |
| 50 | 113 | 0.699 | 0.687 | 0.693 | 0.712 | 0.699 | 0.8929 | 1.8 | 0.2 |
| 100 | 100 | 0.750 | 0.652 | 0.698 | 0.750 | 0.698 | 0.8929 | 1.3 | 0.0 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.889 (18) | 0.900 (10) | 0.833 (18) | 0.651 (43) | 1.000 (3) | 0.833 (6) | 0.412 (17) | 0.444 (18) | 0.761 (67) | 0.808 (26) | 0.750 (4) |
| 0.3 | 1.000 (18) | 1.000 (10) | 1.000 (18) | 0.744 (43) | 1.000 (3) | 1.000 (6) | 0.647 (17) | 0.667 (18) | 0.910 (67) | 0.846 (26) | 0.750 (4) |
| 0.1 | 1.000 (18) | 1.000 (10) | 1.000 (18) | 0.791 (43) | 1.000 (3) | 1.000 (6) | 0.765 (17) | 0.778 (18) | 0.925 (67) | 0.885 (26) | 0.750 (4) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 115 | 0.939 | 0.157 | 0.000 | 0.043 | 0.654 | 0.242 |
| A | 18 | 1.000 | 0.000 | 0.000 | 0.000 | 0.662 | 0.526 |
| B | 10 | 1.000 | 0.000 | 0.000 | 0.100 | 0.804 | 0.584 |
| C | 18 | 1.000 | 0.000 | 0.000 | 0.000 | 0.728 | 0.481 |
| D | 43 | 0.954 | 0.326 | 0.000 | 0.046 | 0.639 | 0.063 |
| partial | 3 | 1.000 | 0.000 | 0.000 | 0.000 | 0.673 | 0.622 |
| touches_border | 6 | 1.000 | 0.167 | 0.000 | 0.167 | 0.660 | 0.548 |
| tiny | 17 | 0.706 | 0.176 | 0.000 | 0.059 | 0.400 | 0.004 |
| band tiny | 18 | 0.722 | 0.167 | 0.000 | 0.056 | 0.436 | 0.004 |
| band small | 67 | 0.970 | 0.104 | 0.000 | 0.060 | 0.659 | 0.313 |
| band medium | 26 | 1.000 | 0.192 | 0.000 | 0.000 | 0.753 | 0.333 |
| band large | 4 | 1.000 | 0.750 | 0.000 | 0.000 | 0.689 | 0.234 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 1.00, IoU 0.64 (n 13) | found 1.00, IoU 0.82 (n 5) | - |
| B | - | found 1.00, IoU 0.68 (n 7) | found 1.00, IoU 0.83 (n 3) | - |
| C | - | found 1.00, IoU 0.72 (n 14) | found 1.00, IoU 0.76 (n 4) | - |
| D | - | found 0.93, IoU 0.64 (n 28) | found 1.00, IoU 0.65 (n 12) | found 1.00, IoU 0.54 (n 3) |

Weed count error per image (detections minus reference weeds): mean 5.8, median abs 6.0, p90 abs 11.0. Detections per image median 13.5, p95 33.65, max 35; reference weeds per image median 11.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.133 (p10 0.008); pixel recall of plants 0.150; pixel precision 0.712.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 363.82, preprocess_ms 5.29, forward_ms 265.6, postprocess_ms 45.68, components_ms 3.05, measure_ms 37.9.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 326.48 | 351.47 |
| preprocess_ms | 4.85 | 5.66 |
| forward_ms | 239.66 | 257.37 |
| postprocess_ms | 43.15 | 44.61 |
| components_ms | 3.17 | 3.57 |
| measure_ms | 38.93 | 40.18 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00072_P0030852.png (2), 05-15_00179_P0030688.png (1), 05-15_00039_P0030852.png (0), 05-15_00198_P0030949.png (0)
- most background false positives: 05-15_00072_P0030852.png (13), 06-05_00111_P0037820.png (8), 06-05_00090_P0037989.png (7), 06-05_00219_P0038053.png (6)
- most crop false positives: 06-05_00090_P0037989.png (6), 06-05_00061_P0037989.png (2), 05-15_00072_P0030852.png (1), 06-05_00111_P0037820.png (1)
- most merged references: 05-15_00072_P0030852.png (10), 05-15_00179_P0030688.png (2), 05-15_00198_P0030949.png (2), 06-05_00090_P0037989.png (2)
