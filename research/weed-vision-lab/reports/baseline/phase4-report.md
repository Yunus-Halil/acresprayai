# Experiment 4: pretrained ERFNet versus colour-based detection, and the hysteresis variant

Date 2026-10-13. Lab weedlab-0.1.0, branch `research/weed-vision-lab`. Same
splits, scorer, categories and bands as Phase 3 (`phase3-report.md`); the
Phase 2 manifests were not changed. Holdout (val) untouched. Per-run tables in
`reports/baseline/<run>/<split>/summary.md`; comparisons in
`comparison_dev_tune.md` and `comparison_dev_check.md`; panels on D: under
`baseline\<run>\<split>\panels\` and `baseline\_compare\`.

## 4A. The checkpoint, verified from source

| item | finding |
|---|---|
| file | `semantic-seg-erfnet.ckpt`, 25,076,659 bytes, SHA-256 `06252edf…66fe2`, from the IPB server, stored on D: |
| architecture | ERFNet encoder-decoder as `erfnet_modified.py` in the baselines repository: 2 downsamplers, 5 + 8 non-bottleneck-1d blocks (dilations 2/4/8/16 twice), 2 upsamplers with 4 decoder blocks, transposed-conv head with 3 outputs; 2,066,575 parameters; 383 tensors under the `network.` prefix; loaded strictly, no missing or unexpected keys |
| classes | 0 background, 1 crop, 2 weed; partial classes 3 and 4 were folded into 1 and 2 for training, so the network has no partial notion |
| preprocessing | ToTensor (0 to 1), then each channel z-scored by its own mean and unbiased std plus 1e-17 (`SingleImageNormalizer`); centre crop 1024 is a no-op here; no ImageNet statistics |
| training | config `config_erfnet.yaml`: from scratch (`pretrained: false`), cross-entropy with class weights 1.47 / 5.06 / 10.02, 768 px random crops, colour and flip augmentation, 4,096 epochs; the checkpoint is epoch 4,095 (final epoch, not a best-validation pick); Lightning 1.6.2 |
| provenance | trained on the PhenoBench **train** split and validated on val. Our dev_tune and dev_check are subsets of train. **Every ERFNet number below is in-sample: an exploratory comparison, not generalisation evidence.** |
| runtime stack | the lab's port (`weedlab/detect/erfnet.py`) on torch 2.14.1+cpu; no CUDA, no Lightning |

Two variants were scored with the same component extraction as the colour methods (8-connected, no floor): `erfnet_weed` (components of the weed class) and `erfnet_veg` (components of crop-or-weed, to compare like for like with a vegetation detector).

## Results (IoU 0.5 unless stated; n: dev_tune 4,121 and dev_check 4,020 reference weed observations)

| run | split | dets/img | raw P | R | raw F1 | floor 25: P raw | P crop-aware | F1 crop-aware | A | B | C | D | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| exg_fixed t 0.08 (Phase 3) | dev_tune | 1,767 | 0.001 | 0.414 | 0.003 | 0.098 | 0.149 | 0.219 | 0.559 | 0.581 | 0.589 | 0.125 | 10.2 | 8.2 |
| exg_hyst 0.10 / 0.03 | dev_tune | 1,170 | 0.003 | 0.492 | 0.006 | 0.066 | 0.079 | 0.136 | 0.753 | 0.779 | 0.709 | 0.145 | 32.7 | 7.2 |
| erfnet_veg (in-sample) | dev_tune | 16 | 0.208 | 0.616 | 0.312 | 0.247 | 0.556 | 0.582 | 0.847 | 0.826 | 0.888 | 0.219 | 2.3 | 7.9 |
| **erfnet_weed (in-sample)** | dev_tune | 10 | 0.387 | 0.740 | 0.509 | 0.553 | 0.571 | 0.640 | **0.840** | **0.826** | 0.885 | 0.692 | 2.3 | 0.25 |
| exg_fixed t 0.08 (Phase 3) | dev_check | 1,501 | 0.002 | 0.383 | 0.003 | 0.096 | 0.149 | 0.214 | 0.485 | 0.370 | 0.544 | 0.124 | 9.3 | 8.2 |
| exg_hyst 0.10 / 0.03 | dev_check | 666 | 0.004 | 0.508 | 0.008 | 0.070 | 0.084 | 0.144 | 0.729 | 0.568 | 0.672 | 0.158 | 30.1 | 6.9 |
| erfnet_veg (in-sample) | dev_check | 16 | 0.210 | 0.612 | 0.313 | 0.247 | 0.558 | 0.582 | 0.855 | 0.876 | 0.895 | 0.229 | 2.2 | 8.0 |
| **erfnet_weed (in-sample)** | dev_check | 10 | 0.386 | 0.732 | 0.505 | 0.556 | 0.574 | 0.642 | **0.848** | **0.876** | 0.890 | 0.686 | 2.3 | 0.24 |

dev_tune and dev_check agree to within a few points for every run.

### Recall by size band and at lower IoU (erfnet_weed, dev_check)

| IoU | tiny (736) | small (2,459) | medium (786) | large (39) | A | B | partial (286) |
|---|---|---|---|---|---|---|---|
| 0.5 | 0.438 | 0.762 | 0.907 | 0.872 | 0.848 | 0.876 | 0.493 |
| 0.3 | 0.741 | 0.926 | 0.950 | 0.923 | 0.980 | 0.963 | 0.615 |
| 0.1 | 0.796 | 0.944 | 0.958 | 0.923 | 0.990 | 0.975 | 0.671 |

### Instance quality: found, merged, split, boundary (A and B)

| run | split | A found | A median best IoU | A p10 IoU | A split | B found | B median IoU | B split | B merged with weed |
|---|---|---|---|---|---|---|---|---|---|
| exg_fixed t 0.08 | dev_check | 0.515 | 0.469 | 0.096 | 0.079 | 0.444 | 0.351 | 0.074 | 0.025 |
| exg_hyst | dev_check | 0.783 | 0.603 | 0.289 | 0.095 | 0.617 | 0.611 | 0.185 | 0.049 |
| erfnet_weed | dev_check | 0.973 | 0.663 | 0.451 | 0.018 | 0.951 | 0.682 | 0.025 | 0.025 |
| erfnet_weed | dev_tune | 0.962 | 0.650 | 0.461 | 0.004 | 0.977 | 0.656 | 0.000 | 0.105 |

Merges with crops: erfnet_weed 0.1% of all weeds (0.2% in D), against 16 to 20% for every colour method. Merges with other weeds in D: 20% for erfnet_weed, since touching weeds share one weed-class component.

### Crop confusion (erfnet_weed, dev_check)

Pixel confusion over every tenth image (69 images): reference weed pixels predicted as crop 0.8%, as background 3.1%; reference crop pixels predicted as weed 0.06%. Pixel IoU background 0.992, crop 0.957, weed 0.726. Crop false-positive components over 25 px: 0.24 per image (colour methods: 7 to 12). In the category table, D recall rises from 0.12 to 0.69 because weeds under or beside crops are no longer swallowed by a crop component.

### Runtime (single process, sequential, native resolution, Ryzen 5 9600X, 6 threads)

| run | preprocess | forward | postprocess | components | measure | total median | total p95 | cold first image |
|---|---|---|---|---|---|---|---|---|
| erfnet_weed | 5 ms | 269 ms | 46 ms | 3 ms | 39 ms | 368 ms | 453 ms | 375 ms (model load 0.4 s before it) |
| exg_fixed t 0.08 | 25 ms (index) | | | 4 ms | 20 ms | 46 ms | 48 ms | 51 ms |
| exg_hyst | | | | | | 52 ms | 55 ms | 62 ms |

ERFNet is 8 times slower than ExG on this CPU: 690 images in 295 s of wall time with 2 processes of 3 threads, against 26 s. The forward pass with 1 thread is 670 ms.

## 4B. Hysteresis, answered

Coverage of pale seedlings improved: A found rate 0.52 to 0.78 and A median best IoU 0.47 to 0.60 on dev_check; A+B recall on 05-15 rose from 196 to 305 of 515. Canopy boundaries improved for found weeds (p10 IoU 0.10 to 0.29). The cost is exactly the feared one: background false positives over 25 px tripled, 9.3 to 30.1 per image, because a strong-green speck now seeds a whole patch of pale soil above 0.03, and crop-aware F1 at the 25 px floor fell from 0.214 to 0.144. B split rate rose to 18.5%. Hysteresis is a better delineator and a worse detector; it does not change the conclusion.

## What ERFNet still gets wrong (dev_check)

1. **Under-delineation, not misses.** Of the 183 A+B misses at IoU 0.5, 81% are found (coverage at least 0.5) with a median IoU of 0.44; only 6% are untouched. All but three are small-band weeds (median area 181 px). The 15% A+B shortfall is a boundary problem at the 100 to 300 px scale.
2. **Tiny band.** Recall 0.44 at IoU 0.5 and 0.74 at IoU 0.3: a 50 px reference tolerates few boundary pixels of error.
3. **Partial weeds** 0.49: under a crop leaf the weed class loses to crop or background.
4. **Background false positives**, 2.3 per image over 25 px, median 108 px, mean weed probability 0.73: in the panels they sit on small green specks that carry no reference label (unannotated seedlings or soil cannot be told apart from the annotation alone); 27% of them touch a labelled weed. These are not the one-pixel specks of the colour methods.
5. **Touching weeds merge** into one weed-class component (D merged with weed 20%). Instance separation remains to be done; the semantic map does not provide it.

## Side-by-side panels

`baseline\_compare\exg_fixed_t0.08__vs__erfnet_weed\<split>\index.html` and the hysteresis pair: the dense 05-15 cluster (`05-15_00072`: ExG 4 of 12 A+B, ERFNet 10 of 12, crop correctly declined), a case where ExG wins (`05-15_00144`: ERFNet under-delineates one small weed), both methods finding every A+B weed on 06-05, and the images with the most ERFNet false positives.

## Conclusion

Pretrained semantic understanding outperforms colour-based vegetation detection on every axis measured: A recall 0.85 against 0.49, weed-versus-crop separation (0.24 against 8 crop false positives per image, D recall 0.69 against 0.12), boundary quality (A median IoU 0.66 against 0.47), and false positives (2.3 against 9 per image at 25 px), at 8 times the CPU cost. The caveat is material: the checkpoint was trained on the images it was scored on. The in-sample numbers put an upper bound on what this model does here; the independent number requires the holdout (val), which the checkpoint did not train on but was validated against, or imagery from another field.

## Recommended next algorithm

Keep ERFNet weed semantics as the detector family and address its two gaps with classical steps on top, scored by the same protocol:

1. **Boundary refinement of ERFNet weed components with ExG hysteresis grown inside a dilated ERFNet mask** (seed = ERFNet weed pixels, grow through ExG above 0.03 within 8 px of the seed). ERFNet decides what is a weed; colour decides where the leaf edge is. Targets the 81% of A+B misses that are found but under IoU 0.5, without the soil false positives hysteresis produced on its own, since growth is confined to ERFNet's neighbourhood.
2. **Instance separation inside weed-class components**: distance-transform watershed seeded at distance-map peaks, applied only to components whose solidity is low, scored on B and D merge and split rates.

Both are classical, need no training and no download, and run in milliseconds. The holdout stays closed until this combined method is fixed on dev_tune and checked on dev_check; the first holdout run should then be the ERFNet family's one independent number.
