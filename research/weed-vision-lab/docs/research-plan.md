# Research plan (corrected after Milestones 3 and 4, 2026-10-13)

The brief's ten phases stand. This page records what the data changed about
them. The original findings and reports are untouched; this is an addendum.

## Working licensing assumption

The official dataset page (https://www.phenobench.org/dataset.html) states
CC BY-SA 4.0. The README inside the v1.1.0 archive states CC BY-NC-SA 4.0. By
the founder's decision on 2026-10-13 the lab works under **CC BY-SA 4.0 as a
working assumption**, records the discrepancy, keeps both notices intact, and
does not treat the assumption as a legal determination. Attribution to Weyler
et al. (IEEE TPAMI 2024) is carried on every PhenoBench-derived number or figure.
No training and no checkpoint downloads are authorised.

## Corrections from the data

| Discovery | Where it bites | What changes |
|---|---|---|
| Leaf instances and leaf visibility exist for crops only (0% of weed pixels) | Phase 5 | Leaf-level diagnostics run on crop plants as a proxy for thin-leaf behaviour. Weed thin-structure analysis uses the plant mask's own geometry (solidity, OBB width, fragment count) instead. No weed leaf metric will be reported. |
| Dense weed patches are one reference instance (82 instances over 10,000 px; the largest 144,400 px) | Phases 3, 4, 8 | Category D is scored separately. A split of a D instance is reported as a D split, never mixed into A/B merge and split rates. |
| Very small instances exist (2,007 under 100 px, smallest 1 px) | Phases 3, 9 | Four size bands fixed in `configs/soil_only_v1.json`. Detection recall is reported per band, tiny included. Segmentation quality is reported from 100 px up; the tiny band's exclusion is stated with its count. |
| Overlapping frames repeat plants: 12,067 observations are 3,654 unique (plot, id) plants, 3.3 frames each | Phases 3 to 8, 17 | Every count is given per observation and per unique plant. Internal splits are by plot (`splits.json`). Train and val share no plot. |
| Visibility masks are 8-bit | Reader | Kept as stored; no rescaling. |
| Semantic background includes cast shadows, stones and dry residue, on four soil textures | Phases 3, 9 | Robustness experiments are stratified by plot (as the soil proxy) and by shadow presence, measured as the share of dark background pixels near the instance. |
| Weeds touch crops far more than each other (2,100 vs 279 pairs) | Phase 4 | Instance separation is first evaluated on B (weed-weed gaps 8 to 32 px) and C (crop gaps 8 to 64 px), where the reference does separate them. |
| Seedling crops and weeds are the same size and colour on 05-15 | Phase 3 | The classical baseline is a vegetation detector. Weed-versus-crop is scored two ways: raw (crop detections count as false positives) and crop-aware (detections inside reference crop masks are "don't care"). The second uses reference crops for scoring only, never for inference. |
| Reference outlines are loose at some leaf tips | Phase 4 | Boundary F1 is reported with an annotation-noise floor estimated from repeated frames of the same plant (identical masks give no estimate; neighbouring-frame masks of the same plant where the copy is not exact will, if any exist) or from a small re-annotation. |

## Subsets and splits in force

- `soil_only_v1`: categories A, B (primary), C (secondary), D (tracked). Thresholds in `configs/soil_only_v1.json`; membership in `reports/subset/soil_only_v1/manifest.json`.
- Splits: `dev_tune` (train, 11 plots, 717 images), `dev_check` (train, 10 plots, 690 images), `holdout` (val, 12 plots, 772 images). Smoke: `configs/smoke10.json`.
- The holdout is used once per method family for the final comparison. Development iterates on dev_tune and is checked on dev_check.

## Order of work from here

1. Classical baseline (Milestone 5): vegetation mask, components, per-band detection scores on dev_tune; A and B segmentation IoU with oracle-location and autonomous modes kept apart.
2. Measurement on reference masks (Phase 6 A) runs in the same milestone since the geometry code already exists (`weedlab.phenobench.geometry`).
3. Pretrained model inventory (Phase 7) is paperwork until downloads are authorised.
