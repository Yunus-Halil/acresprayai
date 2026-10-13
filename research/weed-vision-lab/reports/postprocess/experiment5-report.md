# Experiment 5: maximum-performance autonomous weed segmentation and instance separation

Date 2026-10-13. Lab weedlab-0.1.0, branch `research/weed-vision-lab`, Experiment 4 committed as `f20cde5` (not pushed; the remote is public). Same splits, frozen `soil_only_v1` categories and bands, same scorer as Phases 3 and 4, extended with per-instance Dice, boundary F1 (2 px tolerance), pixel precision and recall, false and missed pixel areas, crop contamination, plot-clustered bootstrap intervals and per-plant recall. Holdout untouched.

**All numbers are in-sample for ERFNet** (the checkpoint was trained on the train split that dev_tune and dev_check come from). They bound what this model does on this field; they are not generalisation evidence.

Tables: `comparison_dev_sub.md`, `comparison_dev_tune.md`, `comparison_dev_check.md`; per-config `reports/postprocess/<config>/<split>/summary.md`; `probability-analysis.json`, `per_plant_recall.json`, `end_to_end_timing.json`. Masks, tables and panels on D: under `postprocess\`.

## 1. Inference cache

ERFNet's three softmax probabilities are cached per image as an 8-bit RGB PNG (background, crop, weed, each quantised to 1/255), under `cache\erfnet-prob-u8-v1\` with a manifest carrying the cache version, the checkpoint SHA-256, the preprocessing description and the image list. 1,407 images (dev_tune and dev_check), 164 MB total, median 106 KB per image. Quantisation changes the argmax on 7 pixels in a million (71 images checked, maximum 33 in a million). Building it cost 476 s once (two processes, three threads each); every post-processing experiment then costs 25 s per 717 images instead of 270 s. Thirty configurations were evaluated on dev_sub, dev_tune or dev_check for the price of about two ERFNet passes.

## 2. What the network's probabilities say (`probability-analysis.json`, 144 dev_tune images)

- 96.0% of reference weed pixels are argmax weed; 2.9% go to background, 1.1% to crop. Small weeds (100 to 1,000 px) lose 8.2% of their pixels.
- The network is saturated almost everywhere: the maximum class probability is 1.0 at every background percentile. Uncertainty exists only within about two pixels of weed edges (maximum probability median 0.84 there).
- Just inside the reference boundary P(weed) has median 0.92; just outside, median 0.55. The network's weed region extends past the reference edge with substantial confidence.
- Lowering the weed threshold to recover the 4% of lost weed pixels admits far more non-weed pixels: at P(weed) above 0.2 within 8 px of the mask, 14,500 weed pixels are gained against 171,000 non-weed pixels (precision 8%). The continuous output cannot recover the lost pixels at any threshold without adding more halo than it recovers. This predicted that every additive refinement would lose IoU, which section 4 then measured.

## 3. The dominant error, measured

On dev_sub A+B references, the ERFNet baseline has pixel recall 0.95 and pixel precision 0.72: 215 false pixels per instance against 27 missed. Of the 29 found-but-unmatched A+B weeds, 27 have more false than missed pixels; the predicted area is 1.38 times the reference at the median (p10 1.12, p90 1.97); 70% of the false pixels lie within 2 px of the reference outline and 45% within 1 px. The Phase 4 diagnosis of "under-delineation" was wrong in direction: the masks are a one-to-two-pixel halo too large. Crop contamination is zero (0.0 crop pixels per A+B instance in every config).

## 4. Experiment A: boundary refinement (dev_sub, 120 images, 189 A+B references)

Additive methods (A2 to A5) start from the argmax mask and may only add pixels within a radius, never on argmax crop. Tightening methods (S1 to S4) only remove.

| config | A recall | A+B IoU med | IoU p10 | bF1 med | pixel P | pixel R | FP px/inst | FP bg/img |
|---|---|---|---|---|---|---|---|---|
| A1 argmax (baseline) | 0.831 | 0.651 | 0.466 | 0.754 | 0.718 | 0.953 | 215 | 2.15 |
| A2 ExG hysteresis 0.03, r 8 | 0.820 | 0.619 | 0.448 | 0.693 | 0.673 | 0.960 | 268 | 3.84 |
| A3 P(weed) > 0.3, r 8 | 0.698 | 0.579 | 0.389 | 0.609 | 0.624 | 0.976 | 337 | 3.44 |
| A3 P(weed) > 0.2, r 8 | 0.576 | 0.526 | 0.332 | 0.483 | 0.575 | 0.984 | 417 | 4.03 |
| A4 edge-aware, colour 0.04, edge 0.35 | 0.797 | 0.632 | 0.451 | 0.738 | 0.708 | 0.954 | 225 | 2.63 |
| A5 hybrid | 0.576 | 0.525 | 0.332 | 0.483 | 0.573 | 0.984 | 420 | 4.18 |
| S1 keep P(weed) >= 0.6 | 0.901 | 0.673 | 0.492 | 0.814 | 0.757 | 0.933 | 172 | 1.60 |
| S1 keep P(weed) >= 0.7 | 0.913 | 0.697 | 0.494 | 0.851 | 0.801 | 0.904 | 129 | 1.23 |
| S1 keep P(weed) >= 0.8 | 0.890 | 0.693 | 0.478 | 0.865 | 0.847 | 0.854 | 88 | 0.86 |
| S2 drop ExG <= 0.00 | 0.831 | 0.648 | 0.434 | 0.821 | 0.762 | 0.877 | 155 | 1.98 |
| S3 erode 1 px | 0.924 | 0.689 | 0.514 | 0.836 | 0.810 | 0.892 | 120 | 1.23 |

Every additive method is negative on every quality metric, as the probability analysis predicted; the ExG and colour-edge variants also raise soil false positives. Tightening is positive: the confidence floor and the 1 px erosion are close, erosion has the better lower tail (IoU p10) and fewer false splits; colour trimming (S2) cuts pale leaves and fragments weeds.

### Confirmed on dev_tune (717 images) and dev_check (690 images)

| config | split | A | B | C | D | tiny | small | A+B@0.3 | IoU med | IoU p10 | bF1 med | bF1 p10 | pixel P | pixel R | P floor25 | FP bg/img | FP crop/img | false split A |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 argmax | tune | 0.839 | 0.826 | 0.880 | 0.765 | 0.424 | 0.777 | 0.974 | 0.651 | 0.460 | 0.771 | 0.546 | 0.725 | 0.950 | 0.561 | 2.30 | 0.21 | 0.004 |
| S1 P >= 0.7 | tune | 0.884 | 0.814 | 0.921 | 0.784 | 0.421 | 0.806 | 0.960 | 0.704 | 0.469 | 0.849 | 0.630 | 0.809 | 0.902 | 0.629 | 1.31 | 0.11 | 0.013 |
| **S3 erode 1** | tune | **0.899** | 0.826 | 0.930 | 0.793 | 0.424 | 0.819 | 0.967 | 0.698 | **0.496** | 0.844 | 0.634 | 0.814 | 0.892 | 0.641 | 1.37 | 0.15 | **0.001** |
| A1 argmax | check | 0.848 | 0.877 | 0.890 | 0.686 | 0.435 | 0.762 | 0.979 | 0.666 | 0.451 | 0.789 | 0.537 | 0.741 | 0.962 | 0.556 | 2.28 | 0.23 | 0.019 |
| S1 P >= 0.7 | check | 0.872 | 0.778 | 0.894 | 0.682 | 0.432 | 0.768 | 0.960 | 0.702 | 0.461 | 0.862 | 0.615 | 0.813 | 0.915 | 0.613 | 1.27 | 0.11 | 0.049 |
| **S3 erode 1** | check | **0.887** | 0.840 | 0.914 | 0.701 | 0.454 | 0.788 | 0.976 | **0.708** | **0.489** | **0.868** | 0.629 | 0.823 | 0.906 | 0.630 | 1.38 | 0.16 | **0.013** |

Plot-clustered 95% intervals for A+B recall at IoU 0.5 (dev_check, 10 plots): baseline 0.850 [0.804, 0.906]; erosion 0.884 [0.862, 0.908]. The intervals overlap because plots differ; the per-plot direction is consistent (erosion is better or equal on every plot in both splits, and the interval of the erosion run is narrower). Per unique plant (dev_check, 401 A plants): majority-of-frames recall 0.843 to 0.883, every-frame recall 0.835 to 0.870.

A variant that spares pixels with P(weed) >= 0.9 or 0.95 from the erosion (S5) is identical to plain erosion to three decimals: the rim pixels are never that confident. The confidence floor at 0.7 is the second-best tightener; it wins on B-merge (0 on dev_tune) but fragments thin weeds (false split A 1.3% and 4.9%, A+B recall at IoU 0.3 drops to 0.960).

Cost of erosion: 4 ms per image over the baseline post-processing.

## 5. Experiment B: individual weed separation

| config | split | false split A | false split C | merge w/ weed B | merge w/ weed D touching (unambiguous) | split of ambiguous D ref | components split / pieces added | A recall |
|---|---|---|---|---|---|---|---|---|
| B1 components (A1) | tune | 0.004 | 0.011 | 0.105 | 0.158 | 0.172 | 0 / 0 | 0.839 |
| B2 watershed everywhere h2 d5 | sub | 0.099 | 0.120 | 0.0 | 0.041 | 0.359 | 142 / 235 | 0.785 |
| B2 watershed everywhere h4 d7 | sub | 0.035 | 0.043 | 0.0 | 0.041 | 0.281 | 60 / 77 | 0.808 |
| B3 adaptive h2 p3 s0.75 | sub | 0.076 | 0.094 | 0.0 | 0.041 | 0.344 | 91 / 174 | 0.802 |
| B4 probability-valley h2 p3 s0.75 | sub | 0.076 | 0.103 | 0.0 | 0.041 | 0.344 | 91 / 174 | 0.802 |
| B3 adaptive h3 p4 s0.60 | sub | 0.023 | 0.043 | 0.0 | 0.061 | 0.188 | 27 / 41 | 0.826 |
| B3 adaptive h4 p5 s0.50 | tune | 0.005 | 0.011 | 0.093 | 0.149 | 0.172 | 35 / 73 | 0.837 |
| B3 adaptive h4 p5 s0.50 | check | 0.021 | 0.022 | 0.025 | 0.209 | 0.181 | 55 / 84 | 0.847 |
| C2 erode 1 + adaptive h4 p5 s0.50 | tune | 0.002 | 0.016 | 0.093 | 0.139 | 0.188 | 52 / 89 | 0.898 |
| C2 erode 1 + adaptive h4 p5 s0.50 | check | 0.016 | 0.034 | 0.025 | 0.180 | 0.167 | 77 / 136 | 0.886 |

Watershed applied to every component (B2) and the permissive adaptive settings cut 3 to 10% of isolated single A plants and a third of the ambiguous D references: that is false splitting of lobed rosettes, not separation. Weighting the watershed surface by P(weed) (B4) changes nothing, consistent with the saturated probabilities. The strictest adaptive rule (solidity at most 0.5, at least two distance peaks of 5 px or more, h-maxima 4, area at least 200 px) is the only one with a defensible balance: on dev_check it lowers D-touching merges from 0.242 to 0.209 alone and to 0.180 on the eroded mask, at the cost of raising C false splits from 0.020 to 0.034 and cutting some grass-like single weeds (seen in the "touching" collection: a many-bladed weed cut into pieces). B merges are already 2.5% on dev_check without any separation; weeds here rarely touch each other and the reference separates the ones that do.

## 6. Experiment C: ablation

| dev_check | A | B | C | D | IoU med | bF1 med | FP bg/img | false split A | merge D touching | post-processing ms |
|---|---|---|---|---|---|---|---|---|---|---|
| 1. ERFNet (A1) | 0.848 | 0.877 | 0.890 | 0.686 | 0.666 | 0.789 | 2.28 | 0.019 | 0.242 | 65 |
| 2. best refinement alone (S3 erode 1) | 0.887 | 0.840 | 0.914 | 0.701 | 0.708 | 0.868 | 1.38 | 0.013 | 0.225 | 69 |
| 3. best separation alone (B3 strict) | 0.847 | 0.877 | 0.880 | 0.697 | 0.665 | 0.788 | 2.30 | 0.021 | 0.209 | 79 |
| 4. combination (C2) | 0.886 | 0.840 | 0.905 | 0.716 | 0.707 | 0.867 | 1.39 | 0.016 | 0.180 | 79 |

Refinement supplies the whole of the accuracy and boundary gain; separation supplies a reduction in D merges and nothing else, and costs C false splits and grass-weed cuts.

## 7. Runtime and memory (`end_to_end_timing.json`; single process, idle CPU, 30 dev_check images)

| stage | 6 threads median | 6 threads p95 | 1 thread median |
|---|---|---|---|
| preprocess | 5 ms | 6 ms | 12 ms |
| ERFNet forward + softmax | 264 ms | 279 ms | 635 ms |
| post-processing A1 (argmax, components, measure) | 65 ms | 71 ms | 50 ms |
| post-processing S3 (erode, components, measure) | 69 ms | 79 ms | 53 ms |
| post-processing C2 (erode, adaptive watershed, measure) | 79 ms | 86 ms | 63 ms |

Model load 33 to 77 ms; cold first image 318 ms forward. Peak working set of the single process 432 MB (torch plus one image). End to end, the chosen pipeline is about 340 ms per 1024 x 1024 image on this CPU with six threads, about 700 ms on one thread; three images per second with six cores in parallel processes. ERFNet is 80% of the cost; nothing in this milestone changed it. The AMD GPU was not used (no CUDA, no DirectML attempted, per the brief).

## 8. The selected method and why

**ERFNet weed semantics, argmax, one-pixel binary erosion (4-connected cross), 8-connected components, no size floor.** Config `S3_erode_1`.

It wins on the balanced criteria: highest A recall (0.887 and 0.899 on the two splits, from 0.848 and 0.839), the best lower tail (IoU p10 0.489 from 0.451; boundary F1 p10 0.63 from 0.54), the best boundary F1 (0.868 from 0.789), 40% fewer background false positives, the fewest false splits of any tightening method, the small and tiny bands up rather than down, zero crop contamination, one extra operation costing 4 ms, no parameter beyond "one pixel", and it explains itself: the network's weed region is a one-pixel halo larger than the reference, so remove one pixel. The confidence floor is a near-equal alternative with a worse tail; the separation step is not adopted by default because its only gain is on D-touching merges and it cuts grass-like single plants; it is kept as an optional stage for a secondary D benchmark.

What it costs: pixel recall falls from 0.96 to 0.91 and 22 of 1,218 A+B references on dev_check that the baseline found are no longer found (thin seedlings eroded away); B recall on dev_check falls from 0.877 to 0.840 (3 of 81 observations, 32 plants; within noise).

## 9. Remaining limitations

1. The one-pixel correction is calibrated to how PhenoBench was annotated and how this checkpoint behaves at native resolution. On other imagery or resolutions the halo may be two pixels or none; it must be re-measured, not assumed.
2. Tiny weeds (under 100 px): recall 0.45 at IoU 0.5 and 0.74 at IoU 0.3 regardless of post-processing. A 50 px reference tolerates about four boundary pixels of error; this is the limit of the network's resolution, not of the post-processing.
3. Thin and grass-like weeds are the ones erosion and the watershed both damage. Narrow-structure handling needs a different idea (skeleton-aware erosion, or no erosion for components whose width is under 3 px).
4. D (weeds touching crops): recall 0.70 to 0.72, merges with the touching plant in 18 to 24% of touching cases. The semantic map cannot separate a weed from the crop leaf it overlaps.
5. Background false positives, 1.4 per image at 25 px: small green specks without a reference label; whether they are unannotated seedlings or soil cannot be decided from the annotation.
6. Everything above is in-sample for ERFNet. The holdout remains the one untouched set for this model family.
7. Repeated frames: per-plant recall tracks per-observation recall within 0.01 to 0.02, so the observation-level numbers are not inflated by repetition, but the effective sample is about a third of the observation count and the plot-level intervals are the honest ones.

## 10. Readiness for independent DJI imagery

Not ready, and the gap is measurable rather than mysterious. The pipeline needs: (a) ground sample distance comparable to PhenoBench's (sub-millimetre to about 1 mm per pixel at these plant sizes; a 120 m mapping flight at 2 cm per pixel puts a median PhenoBench weed into one or two pixels); (b) a check of the per-image z-score normalisation on DJI colour rendering; (c) re-measurement of the halo correction; (d) a labelled reference set on the new imagery, because without one no number can be reported. The Phase 9 resolution experiment (run ERFNet on downsampled PhenoBench against properly downsampled references) is the cheapest way to find the altitude at which this pipeline stops working before any flight.

## 11. Recommended next experiment

**Resolution ladder on the frozen pipeline.** Downsample dev_tune images by 1/2, 1/3, 1/4 and 1/8 (0.5, 0.33, 0.25, 0.125 of native), run ERFNet plus the one-pixel erosion at each scale, score against references downsampled with the same transform (area-weighted majority), and report A, B, small and tiny recall, IoU and runtime per scale. It answers the DJI question directly (how many pixels a weed needs), tests whether the halo correction holds across scales, and cuts inference cost by 4 to 64 times if the answer is favourable. No training, no downloads, cached probabilities cannot be reused (the input changes), about 20 minutes of compute. Second priority: width-aware erosion for thin weeds, measured on the grass-like A references (solidity under 0.3).
