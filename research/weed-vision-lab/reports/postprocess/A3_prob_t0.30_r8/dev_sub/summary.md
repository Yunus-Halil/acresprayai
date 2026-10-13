# Classical baseline `A3_prob_t0.30_r8` on `dev_sub`

120 images, 662 reference weed observations, 1019 detections. Generated 2026-10-13T22:54:00+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.401 | 0.618 | 0.487 | 0.425 | 0.504 | 5.08 | 2.11 | 3.99 | 0.47 |
| 0.3 | 0.563 | 0.867 | 0.683 | 0.597 | 0.707 | 3.71 | 0.73 | 2.86 | 0.47 |
| 0.1 | 0.589 | 0.906 | 0.714 | 0.624 | 0.739 | 3.49 | 0.52 | 2.67 | 0.47 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1019 | 0.401 | 0.618 | 0.487 | 0.425 | 0.504 | 0.6931 | 3.99 | 0.47 |
| 4 | 972 | 0.421 | 0.618 | 0.501 | 0.438 | 0.513 | 0.6931 | 3.8 | 0.33 |
| 10 | 956 | 0.428 | 0.618 | 0.506 | 0.443 | 0.516 | 0.6931 | 3.73 | 0.28 |
| 25 | 909 | 0.450 | 0.618 | 0.521 | 0.463 | 0.529 | 0.6931 | 3.44 | 0.22 |
| 50 | 835 | 0.489 | 0.616 | 0.545 | 0.502 | 0.554 | 0.6931 | 2.92 | 0.19 |
| 100 | 709 | 0.558 | 0.598 | 0.578 | 0.568 | 0.583 | 0.6931 | 2.17 | 0.1 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.698 (172) | 0.647 (17) | 0.786 (117) | 0.630 (162) | 0.490 (51) | 0.743 (35) | 0.306 (108) | 0.273 (132) | 0.648 (392) | 0.857 (133) | 1.000 (5) |
| 0.3 | 0.971 (172) | 0.882 (17) | 0.983 (117) | 0.870 (162) | 0.569 (51) | 0.943 (35) | 0.685 (108) | 0.591 (132) | 0.934 (392) | 0.940 (133) | 1.000 (5) |
| 0.1 | 0.994 (172) | 0.882 (17) | 1.000 (117) | 0.901 (162) | 0.627 (51) | 1.000 (35) | 0.778 (108) | 0.697 (132) | 0.964 (392) | 0.940 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.923 | 0.057 | 0.003 | 0.017 | 0.562 | 0.225 |
| A | 172 | 0.988 | 0.000 | 0.000 | 0.000 | 0.581 | 0.395 |
| B | 17 | 0.941 | 0.118 | 0.000 | 0.000 | 0.523 | 0.220 |
| C | 117 | 0.992 | 0.009 | 0.000 | 0.000 | 0.636 | 0.399 |
| D | 162 | 0.969 | 0.179 | 0.000 | 0.056 | 0.574 | 0.248 |
| partial | 51 | 0.647 | 0.020 | 0.020 | 0.020 | 0.472 | 0.000 |
| touches_border | 35 | 0.971 | 0.029 | 0.029 | 0.000 | 0.678 | 0.380 |
| tiny | 108 | 0.787 | 0.037 | 0.000 | 0.009 | 0.391 | 0.000 |
| band tiny | 132 | 0.712 | 0.038 | 0.008 | 0.008 | 0.360 | 0.000 |
| band small | 392 | 0.972 | 0.046 | 0.000 | 0.015 | 0.562 | 0.347 |
| band medium | 133 | 0.985 | 0.113 | 0.007 | 0.030 | 0.723 | 0.456 |
| band large | 5 | 1.000 | 0.000 | 0.000 | 0.000 | 0.864 | 0.743 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.99, IoU 0.55 (n 148) | found 1.00, IoU 0.74 (n 24) | - |
| B | - | found 0.92, IoU 0.48 (n 12) | found 1.00, IoU 0.64 (n 5) | - |
| C | - | found 0.99, IoU 0.59 (n 93) | found 1.00, IoU 0.76 (n 24) | - |
| D | - | found 0.96, IoU 0.54 (n 100) | found 0.98, IoU 0.66 (n 58) | found 1.00, IoU 0.86 (n 4) |

Weed count error per image (detections minus reference weeds): mean 2.98, median abs 2.0, p90 abs 8.0. Detections per image median 8.0, p95 19.0, max 30; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.028 (p10 0.004); pixel recall of plants 0.029; pixel precision 0.543.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 72.65 | 85.92 |
| ms_separate | 3.87 | 5.02 |
| ms_measure | 48.9 | 59.07 |
| ms_total | 125.42 | 141.34 |

## Worst images

