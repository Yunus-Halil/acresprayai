# Classical baseline `B2_ws_h2_d5` on `dev_sub`

120 images, 662 reference weed observations, 1483 detections. Generated 2026-10-13T22:55:13+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.303 | 0.678 | 0.419 | 0.318 | 0.433 | 8.62 | 1.77 | 5.06 | 0.59 |
| 0.3 | 0.402 | 0.900 | 0.556 | 0.422 | 0.575 | 7.39 | 0.55 | 4.58 | 0.59 |
| 0.1 | 0.413 | 0.926 | 0.572 | 0.434 | 0.591 | 7.25 | 0.41 | 4.53 | 0.59 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1483 | 0.303 | 0.678 | 0.419 | 0.318 | 0.433 | 0.7672 | 5.06 | 0.59 |
| 4 | 1249 | 0.359 | 0.678 | 0.470 | 0.371 | 0.480 | 0.7672 | 3.52 | 0.33 |
| 10 | 1187 | 0.378 | 0.678 | 0.486 | 0.388 | 0.494 | 0.7672 | 3.09 | 0.26 |
| 25 | 1092 | 0.411 | 0.678 | 0.512 | 0.422 | 0.520 | 0.7672 | 2.42 | 0.23 |
| 50 | 1000 | 0.443 | 0.669 | 0.533 | 0.453 | 0.540 | 0.7672 | 1.88 | 0.17 |
| 100 | 855 | 0.492 | 0.636 | 0.555 | 0.498 | 0.559 | 0.7672 | 1.19 | 0.08 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.785 (172) | 0.588 (17) | 0.795 (117) | 0.722 (162) | 0.412 (51) | 0.686 (35) | 0.454 (108) | 0.402 (132) | 0.737 (392) | 0.782 (133) | 0.600 (5) |
| 0.3 | 0.994 (172) | 0.882 (17) | 0.983 (117) | 0.944 (162) | 0.608 (51) | 0.886 (35) | 0.741 (108) | 0.651 (132) | 0.959 (392) | 0.977 (133) | 0.800 (5) |
| 0.1 | 0.994 (172) | 0.941 (17) | 1.000 (117) | 0.975 (162) | 0.647 (51) | 1.000 (35) | 0.768 (108) | 0.697 (132) | 0.980 (392) | 0.993 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.869 | 0.021 | 0.003 | 0.156 | 0.582 | 0.284 |
| A | 172 | 0.965 | 0.000 | 0.000 | 0.099 | 0.626 | 0.452 |
| B | 17 | 0.824 | 0.000 | 0.000 | 0.235 | 0.578 | 0.322 |
| C | 117 | 0.949 | 0.000 | 0.000 | 0.120 | 0.656 | 0.441 |
| D | 162 | 0.883 | 0.049 | 0.000 | 0.278 | 0.580 | 0.353 |
| partial | 51 | 0.588 | 0.020 | 0.020 | 0.216 | 0.381 | 0.000 |
| touches_border | 35 | 0.886 | 0.029 | 0.029 | 0.286 | 0.594 | 0.281 |
| tiny | 108 | 0.741 | 0.037 | 0.000 | 0.018 | 0.467 | 0.000 |
| band tiny | 132 | 0.674 | 0.038 | 0.008 | 0.015 | 0.426 | 0.000 |
| band small | 392 | 0.934 | 0.015 | 0.000 | 0.133 | 0.606 | 0.407 |
| band medium | 133 | 0.880 | 0.023 | 0.007 | 0.353 | 0.622 | 0.379 |
| band large | 5 | 0.600 | 0.000 | 0.000 | 0.400 | 0.501 | 0.305 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.98, IoU 0.62 (n 148) | found 0.88, IoU 0.72 (n 24) | - |
| B | - | found 0.83, IoU 0.51 (n 12) | found 0.80, IoU 0.78 (n 5) | - |
| C | - | found 0.95, IoU 0.63 (n 93) | found 0.96, IoU 0.77 (n 24) | - |
| D | - | found 0.90, IoU 0.58 (n 100) | found 0.86, IoU 0.61 (n 58) | found 0.75, IoU 0.50 (n 4) |

Weed count error per image (detections minus reference weeds): mean 6.84, median abs 5.0, p90 abs 16.10000000000001. Detections per image median 10.0, p95 29.049999999999997, max 45; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.028 (p10 0.004); pixel recall of plants 0.028; pixel precision 0.643.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 11.12 | 13.79 |
| ms_separate | 19.16 | 31.96 |
| ms_measure | 48.67 | 53.9 |
| ms_total | 80.53 | 89.63 |

## Worst images

