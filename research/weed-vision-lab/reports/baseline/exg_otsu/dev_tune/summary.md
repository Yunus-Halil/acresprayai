# Classical baseline `exg_otsu` on `dev_tune`

717 images, 4121 reference weed observations, 561769 detections. Generated 2026-10-13T20:59:28+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.001 | 0.119 | 0.002 | 0.001 | 0.002 | 782.82 | 5.07 | 721.77 | 39.19 |
| 0.3 | 0.002 | 0.198 | 0.003 | 0.002 | 0.003 | 782.36 | 4.61 | 721.77 | 39.16 |
| 0.1 | 0.003 | 0.350 | 0.005 | 0.003 | 0.005 | 781.49 | 3.74 | 721.76 | 39.1 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 561769 | 0.001 | 0.119 | 0.002 | 0.001 | 0.002 | 0.1291 | 721.77 | 39.19 |
| 4 | 62907 | 0.008 | 0.119 | 0.015 | 0.009 | 0.018 | 0.1291 | 63.66 | 15.57 |
| 10 | 21902 | 0.022 | 0.119 | 0.038 | 0.035 | 0.054 | 0.1291 | 13.97 | 11.26 |
| 25 | 10810 | 0.045 | 0.117 | 0.065 | 0.115 | 0.116 | 0.1291 | 2.28 | 9.22 |
| 50 | 8017 | 0.060 | 0.116 | 0.079 | 0.211 | 0.150 | 0.1291 | 0.58 | 8.02 |
| 100 | 6513 | 0.071 | 0.113 | 0.088 | 0.331 | 0.169 | 0.1241 | 0.25 | 7.12 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.127 (1107) | 0.163 (86) | 0.188 (632) | 0.083 (1032) | 0.154 (343) | 0.236 (309) | 0.006 (612) | 0.019 (776) | 0.066 (2463) | 0.343 (851) | 0.645 (31) |
| 0.3 | 0.216 (1107) | 0.349 (86) | 0.312 (632) | 0.135 (1032) | 0.271 (343) | 0.320 (309) | 0.033 (612) | 0.053 (776) | 0.157 (2463) | 0.430 (851) | 0.774 (31) |
| 0.1 | 0.369 (1107) | 0.558 (86) | 0.500 (632) | 0.284 (1032) | 0.376 (343) | 0.505 (309) | 0.147 (612) | 0.164 (776) | 0.316 (2463) | 0.599 (851) | 0.806 (31) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 4121 | 0.398 | 0.205 | 0.272 | 0.009 | 0.027 | 0.000 |
| A | 1107 | 0.361 | 0.220 | 0.226 | 0.002 | 0.025 | 0.000 |
| B | 86 | 0.314 | 0.140 | 0.140 | 0.000 | 0.169 | 0.000 |
| C | 632 | 0.277 | 0.071 | 0.071 | 0.002 | 0.100 | 0.000 |
| D | 1032 | 0.528 | 0.249 | 0.443 | 0.015 | 0.019 | 0.000 |
| partial | 343 | 0.405 | 0.169 | 0.245 | 0.047 | 0.040 | 0.000 |
| touches_border | 309 | 0.521 | 0.184 | 0.291 | 0.000 | 0.100 | 0.000 |
| tiny | 612 | 0.319 | 0.283 | 0.301 | 0.003 | 0.000 | 0.000 |
| band tiny | 776 | 0.318 | 0.266 | 0.286 | 0.005 | 0.000 | 0.000 |
| band small | 2463 | 0.326 | 0.194 | 0.248 | 0.006 | 0.019 | 0.000 |
| band medium | 851 | 0.666 | 0.184 | 0.328 | 0.020 | 0.194 | 0.004 |
| band large | 31 | 0.839 | 0.161 | 0.323 | 0.000 | 0.719 | 0.073 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.32, IoU 0.01 (n 933) | found 0.60, IoU 0.33 (n 174) | - |
| B | - | found 0.25, IoU 0.05 (n 60) | found 0.46, IoU 0.44 (n 26) | - |
| C | - | found 0.16, IoU 0.05 (n 492) | found 0.68, IoU 0.60 (n 140) | - |
| D | - | found 0.43, IoU 0.01 (n 655) | found 0.69, IoU 0.06 (n 359) | found 0.89, IoU 0.73 (n 18) |

Weed count error per image (detections minus reference weeds): mean 777.75, median abs 783.0, p90 abs 1363.1999999999998. Detections per image median 790.0, p95 1508.1999999999998, max 1958; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.786 (p10 0.010); pixel recall of plants 0.865; pixel precision 0.940.

## Runtime

Single process, sequential, single process, sequential, perf_counter; image decode excluded; native 1024 x 1024. Cold first image: total_ms 57.16, index_and_threshold_ms 18.77, components_ms 2.5, measure_ms 35.88.

| stage | steady median ms | steady p95 ms |
|---|---|---|
| total_ms | 53.36 | 66.38 |
| index_and_threshold_ms | 16.75 | 18.88 |
| components_ms | 2.33 | 4.15 |
| measure_ms | 33.27 | 42.48 |

## Worst images

- most A/B misses at IoU 0.5: 05-15_00193_P0030688.png (8), 05-15_00279_P0030688.png (8), 05-15_00051_P0030950.png (7), 05-15_00172_P0030688.png (7)
- most background false positives: 05-15_00238_P0030688.png (1850), 05-15_00282_P0030688.png (1749), 05-15_00239_P0030688.png (1669), 05-15_00240_P0030688.png (1665)
- most crop false positives: 05-26_00221_P0034279.png (225), 05-26_00242_P0034279.png (219), 05-26_00200_P0034279.png (212), 05-26_00179_P0034279.png (211)
- most merged references: 05-15_00279_P0030688.png (18), 05-15_00200_P0030688.png (13), 05-15_00258_P0030688.png (13), 05-15_00221_P0030688.png (12)
