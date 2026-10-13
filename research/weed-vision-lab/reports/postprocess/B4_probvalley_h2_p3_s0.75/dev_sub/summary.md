# Classical baseline `B4_probvalley_h2_p3_s0.75` on `dev_sub`

120 images, 662 reference weed observations, 1422 detections. Generated 2026-10-13T22:55:39+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.324 | 0.695 | 0.442 | 0.340 | 0.457 | 8.02 | 1.68 | 4.96 | 0.58 |
| 0.3 | 0.420 | 0.902 | 0.573 | 0.442 | 0.593 | 6.88 | 0.54 | 4.47 | 0.58 |
| 0.1 | 0.431 | 0.926 | 0.588 | 0.453 | 0.609 | 6.74 | 0.41 | 4.42 | 0.58 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1422 | 0.324 | 0.695 | 0.442 | 0.340 | 0.457 | 0.7884 | 4.96 | 0.58 |
| 4 | 1188 | 0.387 | 0.695 | 0.497 | 0.400 | 0.508 | 0.7884 | 3.42 | 0.32 |
| 10 | 1126 | 0.408 | 0.695 | 0.514 | 0.420 | 0.523 | 0.7884 | 2.99 | 0.25 |
| 25 | 1032 | 0.446 | 0.695 | 0.543 | 0.457 | 0.552 | 0.7884 | 2.33 | 0.22 |
| 50 | 947 | 0.479 | 0.686 | 0.564 | 0.490 | 0.572 | 0.7884 | 1.85 | 0.17 |
| 100 | 818 | 0.529 | 0.654 | 0.585 | 0.537 | 0.590 | 0.7884 | 1.2 | 0.09 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.802 (172) | 0.647 (17) | 0.821 (117) | 0.741 (162) | 0.412 (51) | 0.714 (35) | 0.454 (108) | 0.402 (132) | 0.755 (392) | 0.812 (133) | 0.600 (5) |
| 0.3 | 0.994 (172) | 0.882 (17) | 0.983 (117) | 0.951 (162) | 0.608 (51) | 0.886 (35) | 0.741 (108) | 0.651 (132) | 0.959 (392) | 0.985 (133) | 0.800 (5) |
| 0.1 | 0.994 (172) | 0.941 (17) | 1.000 (117) | 0.975 (162) | 0.647 (51) | 1.000 (35) | 0.768 (108) | 0.697 (132) | 0.980 (392) | 0.993 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.882 | 0.021 | 0.003 | 0.121 | 0.593 | 0.302 |
| A | 172 | 0.971 | 0.000 | 0.000 | 0.076 | 0.628 | 0.457 |
| B | 17 | 0.882 | 0.000 | 0.000 | 0.176 | 0.618 | 0.338 |
| C | 117 | 0.974 | 0.000 | 0.000 | 0.103 | 0.663 | 0.456 |
| D | 162 | 0.907 | 0.049 | 0.000 | 0.235 | 0.594 | 0.365 |
| partial | 51 | 0.588 | 0.020 | 0.020 | 0.157 | 0.380 | 0.000 |
| touches_border | 35 | 0.886 | 0.029 | 0.029 | 0.143 | 0.620 | 0.303 |
| tiny | 108 | 0.741 | 0.037 | 0.000 | 0.009 | 0.467 | 0.000 |
| band tiny | 132 | 0.674 | 0.038 | 0.008 | 0.008 | 0.426 | 0.000 |
| band small | 392 | 0.944 | 0.015 | 0.000 | 0.102 | 0.614 | 0.411 |
| band medium | 133 | 0.917 | 0.023 | 0.007 | 0.286 | 0.704 | 0.455 |
| band large | 5 | 0.600 | 0.000 | 0.000 | 0.200 | 0.501 | 0.305 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.98, IoU 0.62 (n 148) | found 0.92, IoU 0.75 (n 24) | - |
| B | - | found 0.83, IoU 0.51 (n 12) | found 1.00, IoU 0.78 (n 5) | - |
| C | - | found 0.97, IoU 0.65 (n 93) | found 1.00, IoU 0.78 (n 24) | - |
| D | - | found 0.92, IoU 0.59 (n 100) | found 0.90, IoU 0.62 (n 58) | found 0.75, IoU 0.50 (n 4) |

Weed count error per image (detections minus reference weeds): mean 6.33, median abs 5.0, p90 abs 14.100000000000009. Detections per image median 9.5, p95 28.0, max 45; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.028 (p10 0.004); pixel recall of plants 0.028; pixel precision 0.643.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 10.9 | 13.84 |
| ms_separate | 21.11 | 38.79 |
| ms_measure | 47.99 | 52.99 |
| ms_total | 81.52 | 98.41 |

## Worst images

