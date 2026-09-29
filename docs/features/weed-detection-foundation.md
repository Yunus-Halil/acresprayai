# Weed detection: the foundation (living plan)

Objective, in the founder's words: the scout can find strands and shapes but cannot say
"weed". Build the strongest possible foundation for a detection system that can, then
improve accuracy on top of it. This document is the plan and its status; it is updated as
each piece lands. Last updated 2026-09-29.

## The shape of it

The geometric detector stays the candidate generator: rows, the field baseline and the
plant population find what is not average and not where the crop should be, in ground
units, checked against truth. On top of it sits a learned classifier that says how likely
each plant candidate is a weed, a crop plant or not a plant at all. The classifier ships
only with a scorecard on a frozen test set, runs in the browser on the chips the scout
already renders, and its number is stored beside the operator's verdict, never in place
of it.

Five parts, in dependency order:

| # | Part | Where | Status |
|---|---|---|---|
| 1 | One ground-truth store: every labelled chip in one format, split by group | `offrow/src/offrow/learn/examples.py`, `sources.py` | **done** |
| 2 | Evaluation harness and gate: scorecard per version, by source and weed size | `offrow/src/offrow/learn/evaluate.py` | **done** |
| 3 | Model boundary in the app: contract, registry, browser inference | `src/lib/weedScout/classify/` | **done** (wired into the pipeline, popup, default verdict, archive) |
| 4 | First learned model (weed-v1) trained on USU + synthetic, published with scorecard | `offrow learn train / evaluate / publish` | **done** 2026-09-29: published to `public/models/`, gate passed |
| 5 | The loop: prediction stored with every verdict, defaults from the model, retrain command | app + `weed_observations.prediction` | **done** in code; migration applied 2026-09-29 |

## Decisions taken (2026-09-29)

- Machine learning is allowed, in `offrow.learn` only. The old "no ML" rule was a phase.
  The geometric core still imports no ML library (a test enforces it).
- Inference runs in the browser (onnxruntime-web, WebAssembly, single-threaded). Imagery
  never leaves the browser. The runtime is served from our origin under a
  `'wasm-unsafe-eval'` CSP allowance, the only CSP change.
- Training data now: USU-Corn-WeedDB (CC BY 4.0, auto-fetched) and synthetic scenes.
  DRONEWEED will be added when the founder downloads it manually (bot-protected host).
  No flown imagery yet; the Friday flight in `offrow/FLIGHT.md` has not happened.
- Labels for v1: weed / crop / other. Species comes later, from operator verdicts and a
  reviewed catalog, never from pixels alone.

## What was built

### 1. The store (`offrow learn build-examples`)
- `Example`: chip PNG at native resolution, GSD, ground span, label, **label basis**,
  species, group, split, licence, padding flag. Refuses an unknown label or a missing GSD.
- Chips are cut at `4 x diameter` of ground (0.24 to 1.2 m), the same framing the scout's
  chip renderer satisfies, so a training chip and a live chip cover the same ground.
- Splits: `sha1("offrow-learn-v1:" + group)` into train/val/test (70/15/15). Group is a
  frame (USU), a scene seed (synthetic) or a field (operator). Deterministic on every
  machine; adding a source never moves an existing example.
- Sources: USU boxes as weeds, clear ground between boxes labelled crop/other by the repo's
  own vegetation mask (basis says "derived"); synthetic scenes with exact truth at 5.5, 11
  and 22 mm/px across four weed sizes so every diameter bin is populated; operator verdicts
  exported with `offrow learn pull-verdicts` (service role, run off-app).

### 2. The scorecard and gate (`offrow learn evaluate`)
- Per version JSON in `offrow/reports/`: accuracy, per-class precision/recall/F1, weed
  AUROC, expected calibration error, confusion, **by source** and **weed recall by
  diameter bin**.
- Gate: weed recall and precision may not fall more than 0.02 against the previous
  scorecard; calibration error may not rise more than 0.02; an empty test split or no
  weeds in it fails outright. `publish` refuses on a failed gate unless `--force`.

### 3. Training and export (`offrow learn train / publish`)
- MobileNetV3-small, 96 px input, three classes, ImageNet normalisation and the calibration
  temperature folded into the graph. Augmentation includes random resolution loss (down to
  4x coarser) to stand in for the 10 m to 100 m altitude gap.
- Best epoch by validation macro-F1, temperature scaling on validation, early stopping.
- ONNX via the torch.export exporter with a dynamic batch; verified against PyTorch on
  random input; int8 weight quantisation (1.75 MB) verified to agree with the float model.
- Sidecar JSON states version, classes, input contract, span rule, temperature, sources,
  scorecard summary and a caveat. `public/models/manifest.json` names the current version.

### 4. The app boundary (`src/lib/weedScout/classify/`)
- `types.ts`: `Prediction {pWeed, pCrop, pOther, modelVersion}`, `ModelMeta` (the sidecar),
  refusal of a sidecar whose class order or input contract is not the expected one.
- `preprocess.ts`: pure, tested mirror of the Python chip contract (crop centre to object
  span, box-filter to 96 px, [0, 1] CHW). If this drifts from Python every probability is
  wrong; a test pins the constants.
- `registry.ts`: reads `/models/manifest.json`; no manifest means no classifier and the
  scout runs as before. Never an error a farmer sees.
- `onnxClassifier.ts`: lazy-loads onnxruntime-web, one session per model per page, batched.
- `index.ts`: scores only single-plant candidates with a chip (regions get no prediction;
  the model knows nothing about ground). Adds a note to the run saying what was scored.

### 5. The loop
- `weed_observations.prediction` and `model_version` (migration
  `20260929120000_weed_observation_predictions.sql`), written at save time beside the
  verdict. Disagreement per version is then a query, and the next training export carries
  the model's word alongside the operator's.
- Default verdict: the operator's own past verdicts (feedback) win; then the model: at or
  above 0.6 weed starts as a weed, below 0.4 starts removed, between starts unsure. Regions
  and unscored spots keep the old rule.

## Next (in order)

1. ~~Wire the classifier into the pipeline, verdict default, popup, archive, CSP, wasm copy, tests.~~ Done.
2. ~~USU examples, train, evaluate, publish weed-v1.~~ Done. 30,162 examples; test accuracy 0.966, USU weed recall 0.986, ECE 0.005. In-distribution numbers; see the review brief.
3. ~~Apply the prediction migration.~~ Done.
4. Click-through in a signed-in session on a real scan: chips scored, popup line shows,
   verdicts saved with predictions.
5. DRONEWEED when downloaded (adds labelled maize, the only public crop labels).
6. Flown imagery with staked truth becomes the test set the moment it exists.

## weed-v1 in one line

Trained on 19,535 chips, scored on 7,008 held out by frame: weed recall 0.990, precision
0.992, calibration error 0.005; on the real source alone, weed recall 0.986, crop recall
0.762 (mask-derived labels). In-distribution; the flown test set is still the missing piece.
Full results and caveats: [the review brief](../review/weed-detection-foundation-review-brief.md).

## Precautions and known weaknesses (for review)

- **Domain gap.** v1 learns from corn at 10 m (4.8 mm/px) and synthetic scenes. Operators
  fly at 100 m (about 2 cm/px) over any crop. Resolution augmentation narrows this; it does
  not close it. Until flown imagery is in the test set, the scorecard measures the wrong
  altitude and the sidecar says so.
- **Derived negatives.** USU's crop/other labels come from the vegetation mask, not a
  person. A mask error becomes a label error. Basis is recorded so they can be excluded.
- **Label leakage.** Guarded by group splits; a bug in `group` assignment would defeat it.
  Tests check that chips from one scene share a split.
- **Calibration drift.** Temperature is fitted on validation data from the same sources;
  on a new field the 80% may not be 80%. Stored predictions against verdicts are the check.
- **Model file integrity.** The ONNX file is served from our origin like any asset. A
  tampered file would produce wrong probabilities silently; a content hash in the sidecar
  checked at load is a cheap next step.
- **The runtime is 14 MB.** Downloaded once per browser, only when a scan has chips. Not
  precached by the service worker.
- **Nothing here changes what gets flagged.** The model reorders and proposes defaults on
  candidates geometry found. A weed geometry never surfaces is still missed.
