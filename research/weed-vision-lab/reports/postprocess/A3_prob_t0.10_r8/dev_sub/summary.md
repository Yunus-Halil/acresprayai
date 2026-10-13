# Classical baseline `A3_prob_t0.10_r8` on `dev_sub`

120 images, 662 reference weed observations, 970 detections. Generated 2026-10-13T22:54:15+00:00, lab weedlab-0.1.0. Hardware: AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD, 3.12.10.

Inference used the RGB image only. Categories and bands come from the frozen `soil_only_v1` table and are used for scoring only.

## Detection, one-to-one IoU matching, weeds only

| IoU | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | FP/img | FN/img | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.265 | 0.388 | 0.315 | 0.274 | 0.321 | 5.94 | 3.38 | 5.27 | 0.26 |
| 0.3 | 0.524 | 0.767 | 0.623 | 0.541 | 0.635 | 3.85 | 1.28 | 3.38 | 0.26 |
| 0.1 | 0.614 | 0.900 | 0.730 | 0.635 | 0.745 | 3.12 | 0.55 | 2.66 | 0.26 |

Crop-aware sets aside unmatched detections whose majority pixels lie on a reference crop; it is a scoring view, not something the detector can do.

## Scoring-time detection-size floor (IoU 0.5)

The detector keeps every component down to one pixel. Here detections under f px are set aside at scoring only; recall counts a reference as hit only when its matched detection survives the floor.

| floor px | detections kept | precision raw | recall | F1 raw | precision crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 970 | 0.265 | 0.388 | 0.315 | 0.274 | 0.321 | 0.3704 | 5.27 | 0.26 |
| 4 | 956 | 0.269 | 0.388 | 0.318 | 0.276 | 0.323 | 0.3704 | 5.23 | 0.21 |
| 10 | 948 | 0.271 | 0.388 | 0.319 | 0.278 | 0.324 | 0.3704 | 5.18 | 0.19 |
| 25 | 924 | 0.278 | 0.388 | 0.324 | 0.284 | 0.328 | 0.3704 | 5.04 | 0.15 |
| 50 | 890 | 0.289 | 0.388 | 0.331 | 0.293 | 0.334 | 0.3704 | 4.81 | 0.12 |
| 100 | 807 | 0.316 | 0.385 | 0.347 | 0.319 | 0.349 | 0.3704 | 4.23 | 0.07 |

## Recall by category and by size band

| IoU | A | B | C | D | partial | border | tiny | tiny band | small | medium | large |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.5 | 0.372 (172) | 0.353 (17) | 0.513 (117) | 0.481 (162) | 0.392 (51) | 0.657 (35) | 0.056 (108) | 0.068 (132) | 0.344 (392) | 0.812 (133) | 1.000 (5) |
| 0.3 | 0.872 (172) | 0.765 (17) | 0.880 (117) | 0.827 (162) | 0.510 (51) | 0.857 (35) | 0.481 (108) | 0.424 (132) | 0.824 (392) | 0.932 (133) | 1.000 (5) |
| 0.1 | 0.994 (172) | 0.824 (17) | 0.992 (117) | 0.901 (162) | 0.627 (51) | 1.000 (35) | 0.759 (108) | 0.682 (132) | 0.959 (392) | 0.940 (133) | 1.000 (5) |

## Found, merged, split (coverage-based, independent of IoU)

Found: one detection covers at least half the reference. Merged: that detection also covers at least half of another weed / crop. Split: two or more detections each cover at least a fifth.

| group | n | found | merged w/ weed | merged w/ crop | split | median best IoU | p10 best IoU |
|---|---|---|---|---|---|---|---|
| all | 662 | 0.927 | 0.067 | 0.003 | 0.014 | 0.449 | 0.159 |
| A | 172 | 0.994 | 0.000 | 0.000 | 0.000 | 0.463 | 0.288 |
| B | 17 | 0.941 | 0.235 | 0.000 | 0.000 | 0.447 | 0.095 |
| C | 117 | 0.992 | 0.034 | 0.000 | 0.000 | 0.505 | 0.288 |
| D | 162 | 0.975 | 0.179 | 0.000 | 0.043 | 0.495 | 0.204 |
| partial | 51 | 0.647 | 0.020 | 0.020 | 0.020 | 0.347 | 0.000 |
| touches_border | 35 | 0.971 | 0.029 | 0.029 | 0.000 | 0.611 | 0.284 |
| tiny | 108 | 0.796 | 0.046 | 0.000 | 0.009 | 0.285 | 0.000 |
| band tiny | 132 | 0.720 | 0.045 | 0.008 | 0.008 | 0.249 | 0.000 |
| band small | 392 | 0.977 | 0.056 | 0.000 | 0.010 | 0.449 | 0.241 |
| band medium | 133 | 0.985 | 0.120 | 0.007 | 0.030 | 0.660 | 0.414 |
| band large | 5 | 1.000 | 0.000 | 0.000 | 0.000 | 0.827 | 0.688 |

| category x band | tiny | small | medium | large |
|---|---|---|---|---|
| A | - | found 0.99, IoU 0.42 (n 148) | found 1.00, IoU 0.67 (n 24) | - |
| B | - | found 0.92, IoU 0.38 (n 12) | found 1.00, IoU 0.56 (n 5) | - |
| C | - | found 0.99, IoU 0.48 (n 93) | found 1.00, IoU 0.67 (n 24) | - |
| D | - | found 0.97, IoU 0.44 (n 100) | found 0.98, IoU 0.61 (n 58) | found 1.00, IoU 0.83 (n 4) |

Weed count error per image (detections minus reference weeds): mean 2.57, median abs 2.0, p90 abs 6.0. Detections per image median 7.0, p95 17.049999999999997, max 27; reference weeds per image median 5.0.

Vegetation pixels (diagnostic): IoU vs all plant pixels median 0.028 (p10 0.004); pixel recall of plants 0.030; pixel precision 0.426.

## Runtime

Single process, sequential, post-processing only; ERFNet inference is cached (see cache manifest for its cost). Cold first image: .

| stage | steady median ms | steady p95 ms |
|---|---|---|
| ms_refine | 71.34 | 81.71 |
| ms_separate | 3.99 | 5.09 |
| ms_measure | 48.68 | 56.67 |
| ms_total | 125.43 | 138.05 |

## Worst images

