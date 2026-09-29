# Review brief: the weed detection foundation in SwathWise

*Written to be handed to an independent reviewer (a person or another model) with one
instruction: find every way this could fail before it reaches a farmer's laptop. Nothing
below is confidential; nothing below is a claim of accuracy.*

## 1. What SwathWise is, in one paragraph

SwathWise is a browser application for farmers, spray-drone operators and agronomists. A
drone maps a field; the app stitches the imagery, finds the weeds and the patches of ground
that are not behaving like the rest of the field, lets the operator confirm or reject each
one, plans a spray flight that covers only the confirmed spots, and writes the pesticide
application record. Everything the app concludes is a suggestion; the operator's click is
the decision, and the record says who decided what. The product is in closed testing.

## 2. The problem this work addresses

The detector was, until now, purely geometric. It measures every tile of the field against
the field's own baseline, fits the crop rows, measures every plant against the field's own
plant population, and surfaces what is not average or not where the crop should be. This is
honest and it works without any training data, but it cannot say "weed". It says "a plant
30 cm off the nearest row" or "a plant three deviations larger than the field's plants". The
founder's objective: give the system a core it can build real weed detection on, then
improve accuracy on that core. Not accuracy first; foundation first.

## 3. What was built, and why in that order

The foundation is five parts, each of which exists because the next one is untrustworthy
without it.

### 3.1 One ground-truth store (`offrow/src/offrow/learn/examples.py`)

Every labelled chip, whatever it came from, lands in one format: a square PNG at native
resolution, the ground sample distance, the ground span in metres, the label (weed / crop /
other), **the basis of the label** (an annotated box, synthetic truth, an operator's verdict,
or "derived by the vegetation mask away from every annotated box"), the species when known,
the licence, and a train / validation / test split.

Two rules matter more than the rest:

- **Chips are cut at a fixed multiple of the object's diameter** (4x, clamped to 0.24 to
  1.2 m of ground), not at a fixed pixel count. A 3 cm seedling and a 30 cm broadleaf fill
  their chips the same way, so the model learns shape and colour rather than how big the
  annotator drew the box. The app's chip renderer already satisfies the same rule, so a
  training chip and a live chip cover the same ground.
- **Splits are assigned by group, never by chip.** The group is the frame a USU tile came
  from, the seed of a synthetic scene, or the operator's field. The split is a hash of the
  group name (`sha1("offrow-learn-v1:" + group)`), so it is identical on every machine and
  adding a new source never moves an existing example between splits. Two chips from the
  same frame share soil, light and camera; putting one in train and one in test would
  measure memorisation.

### 3.2 Sources (`sources.py`)

- **USU-Corn-WeedDB** (CC BY 4.0, Zenodo). 800 annotated 640 px tiles of forage corn at
  10 m, 4.8 mm/px, three weed species boxed, corn not labelled. Boxes become weed examples.
  The dataset's contract is that annotated tiles are exhaustively annotated, so ground far
  from every box is not a weed; those chips are labelled crop or other by the repository's
  own vegetation mask, and the basis says "derived" so they can be excluded or weighted
  separately.
- **Synthetic scenes** (`offrow/synth.py`, already existing). Rendered fields with exact
  truth for every crop plant, weed and patch of bare soil, at 5.5, 11 and 22 mm/px, cycling
  through four weed sizes (3, 6, 12, 25 cm) so every weed-diameter bin is populated,
  including the smallest one, which the public sets do not populate at all. Shadows, wheel
  tracks and wet soil are switched on for a subset of scenes so "other" includes the known
  false-positive sources.
- **Operator verdicts.** The archive the app already keeps (`weed_observations`, 30 rows
  today) exported off-app with the service role, chips included. Verdict "weed" is a weed;
  "crop" a crop; "not vegetation" other; "not a weed" resolved to crop or other by the mask;
  "unsure" teaches nothing and is skipped. Grouped by field.

### 3.3 The scorecard and the gate (`evaluate.py`)

Every model version gets a JSON scorecard on the frozen test split: accuracy, per-class
precision, recall and F1, weed-versus-rest AUROC, expected calibration error, the confusion
matrix, and the same numbers **broken down by source** and **weed recall by diameter bin**.
A pooled number over synthetic and real data would flatter a model that only learned the
synthetic; the breakdown makes that visible.

The gate compares a new scorecard to the previous one: weed recall and precision may not
fall by more than 0.02, calibration error may not rise by more than 0.02, and an empty test
split or a test split with no weeds fails outright. `offrow learn publish` refuses to export
a version that fails the gate unless forced, and prints why either way.

### 3.4 The model and its export (`model.py`, `train.py`, `export.py`)

MobileNetV3-small, ImageNet-pretrained, three-way head, 96 px input. Small on purpose: it
runs in a browser on a hundred chips without being noticed, and 96 px is what a plant looks
like from a mapping flight anyway. ImageNet normalisation and the calibration temperature
are folded into the graph so the client does exactly one thing: resize and divide by 255.

Training: class-weighted cross-entropy (inverse square-root frequency), AdamW with a
one-cycle schedule, best epoch by validation macro-F1, early stopping, then temperature
scaling on the validation split. Augmentation: rotations and flips (orientation is not a
feature of a weed), mild exposure and white-balance jitter, framing jitter, and **random
resolution loss** (downsample by up to 4x and back), which stands in for the gap between
the 10 m the public data was flown at and the 100 m operators fly.

Export: the `torch.export`-based ONNX exporter with a dynamic batch dimension, verified
against PyTorch on random input before the file is written; int8 weight quantisation to
1.75 MB, verified to pick the same class as the float model on random input. A sidecar
JSON states the version, classes, input contract, span rule, temperature, sources, a
scorecard summary and a caveat; `public/models/manifest.json` names the current version.

### 3.5 The boundary in the app (`src/lib/weedScout/classify/`)

- A pure, tested mirror of the Python chip contract. If the two drift, every probability
  is silently wrong; a test pins the constants.
- A registry that reads the manifest and refuses any sidecar whose class order or input
  contract is not the expected one. No manifest means no classifier; the scout runs
  exactly as before and says so in its notes. This is never an error a farmer sees.
- onnxruntime-web, loaded lazily the first time a scan has chips, single-threaded, with the
  WebAssembly runtime served from our own origin. Imagery does not leave the browser.
- Only single-plant candidates with a chip are scored. Regions of ground get no prediction,
  because the model was never shown ground and a number there would be meaningless.
- The prediction rides on the candidate beside two things that already existed: the
  operator's own past verdicts (nearest-neighbour retrieval) and the in-house description.
  It sets the default verdict **after** the operator's own verdicts: at or above 0.6 weed a
  plant starts as a weed, below 0.4 it starts removed, between it starts unsure. The popup
  shows it in words that never say "is a weed".
- Saving a verdict stores the prediction and the model version beside it
  (`weed_observations.prediction`, `model_version`), never in place of it. Disagreement per
  model version is then a database query, and the next training export carries both.

### 3.6 Rules that were changed, and rules that were kept

Changed: the research track's spec forbade machine learning ("the current phase is
geometric"). That was a phase, not a principle. It now reads: learning lives in
`offrow.learn` and nowhere else; the geometric core imports no ML library (a test enforces
it), still generates every candidate, and still owns every threshold in ground units.

Kept: the output is a ranked queue with probabilities, never a verdict. No code path calls a
candidate a weed. The operator decides, on the record, with the chip in front of them. The
application record prints what the operator stated and says that none of it was produced
by image analysis.

One infrastructure change: the Content Security Policy gained `'wasm-unsafe-eval'` in
`script-src`, the minimum needed to run WebAssembly. Nothing else in the policy moved.

## 4. Results of the first model (weed-v1)

Full scorecard: `offrow/reports/weed-v1.json`; sidecar: `public/models/weed-v1.json`.

**Trained 2026-09-29 on 19,535 chips (USU-Corn-WeedDB and synthetic), validated on 3,619,
scored on 7,008 held-out chips from 88 groups. 12 epochs, best at epoch 9 by validation
macro-F1 (0.937), calibration temperature 1.18, 16 minutes on an Apple M-series GPU. The
shipped file is 1.81 MB, int8-quantised, agreeing with the float model on 100% of random
inputs.**

| Measure | All test chips | USU (real, 4,158) | Synthetic (2,850) |
|---|---|---|---|
| Accuracy | 0.966 | 0.944 | 0.998 |
| Weed recall | 0.990 | 0.986 | 0.998 |
| Weed precision | 0.992 | 0.989 | 0.998 |
| Crop recall | 0.913 | 0.762 | 0.995 |
| Other recall | 0.915 | 0.873 | 0.998 |
| Weed AUROC | 0.999 | 0.997 | 1.000 |
| Calibration error (ECE) | 0.005 | 0.008 | 0.002 |

Weed recall by canopy diameter: <4 cm: 0.999 (n=729), 4-8 cm: 0.997 (n=585), 8-16 cm: 0.948 (n=577), 16-32 cm: 0.995 (n=2495), >=32 cm: 1.000 (n=345)

Confusion (rows: true weed, crop, other; columns: predicted): [[4686, 11, 34], [14, 847, 67], [22, 93, 1234]]

**How to read this.** The numbers are high because the test chips are in-distribution: the
same fields, camera, altitude and day as the training chips, split by source frame. They
show the pipeline works end to end and that the model learned real weeds, not only rendered
ones (USU weed recall 0.986 against synthetic 0.998). They do not
estimate performance at 100 m over another crop. The weakest cells are crop versus other
on USU (67 crop chips called other, 93 other chips called crop), and those are
exactly the labels that came from the vegetation mask rather than a person. The
sub-4 cm bin is synthetic only; no public set has a labelled weed that small.

## 5. Precautions taken

- Splits by group, hashed, frozen. Tests assert that chips from one scene share a split.
- Label basis recorded on every example; derived labels are distinguishable from annotated.
- The gate: no version ships that regresses on the frozen test split.
- Export verified against PyTorch; quantised model verified against the float one.
- Sidecar contract checked at load; unknown contracts refused.
- Degradation, never failure: missing runtime, missing model, undecodable chip, failed batch
  all produce "no prediction" and a note, never a failed scan.
- Predictions stored beside verdicts, never overwriting them.
- Regions unscored; the model speaks only about what it was trained on.
- Operator retrieval outranks the model in the default verdict.
- Wording: "82% weed (reads most like weed), weed-v1. A suggestion, not a finding."
- Imagery stays in the browser; the runtime and the model are first-party assets.

## 6. Known weaknesses, stated plainly (this is the part to attack)

1. **Domain gap.** v1 learns from corn flown at 10 m (4.8 mm/px), plus synthetic scenes.
   Operators fly at roughly 100 m (about 2 cm/px) over any crop, with different cameras,
   light and soils. Resolution augmentation narrows the gap; it does not close it. Until
   flown imagery with staked ground truth is in the test set, the scorecard measures the
   wrong altitude and the wrong crops. The sidecar's caveat says so, and the sidecar is
   shown to nobody by default.
2. **Derived negatives.** USU's crop and other labels come from the vegetation mask, not a
   person. A mask error is a label error. They are marked as derived, but v1 trains on them.
3. **Synthetic dominance.** The synthetic source will outnumber the real one by an order of
   magnitude. Class weights do not correct source imbalance. A model that learned to
   recognise rendered leaves is a risk; the per-source scorecard is the check, not a fix.
4. **Calibration is local to the sources.** The temperature is fitted on validation data
   from the same sources. On a new field the "80%" may not be 80%. Stored predictions
   against verdicts are how this will be measured; nothing corrects it yet.
5. **The default verdict now moves with the model.** A confident wrong prediction makes a
   real weed start as "removed" or a crop plant start as "weed". The operator can flip it
   with one click, but a tired operator on spot 90 of 120 may not. The threshold choice
   (0.6 / 0.4) is a first guess, not a measured operating point.
6. **Nothing here changes what gets flagged.** The model reorders and proposes defaults
   for candidates that geometry found. A weed that geometry never surfaces (in a closed
   canopy, inside the headland, under a failed sweep window) is still missed, and the
   model's recall number does not measure that.
7. **Model file integrity.** The ONNX file is served like any static asset. A tampered or
   corrupted file would produce wrong probabilities silently. A content hash in the sidecar
   checked at load is the obvious next step and is not built.
8. **The runtime is 14 MB.** Downloaded once per browser, only when a scan has chips, not
   precached by the service worker. On a farm connection this is a noticeable wait the
   first time.
9. **Species is not addressed.** v1 says weed / crop / other. Any name still comes from the
   operator or from their own past verdicts through a reviewed catalogue; nothing names a
   species from pixels. That is deliberate and it should stay deliberate until there is
   labelled species imagery at operating altitude.
10. **Consent and data flow.** Operator chips and verdicts are owner-scoped in the database
    and only leave it through an off-app export run with the service role by a person.
    There is no cross-user read and no automatic pipeline from a farmer's data to a model.
    That is the right default and it means the model improves only as fast as someone runs
    the export with consent.
11. **The public data's licence.** USU-Corn-WeedDB is CC BY 4.0; attribution is recorded on
    every example and in the sidecar's sources. DRONEWEED, when added, has its own terms on
    the DIGITAL.CSIC record and is not fetched automatically.
12. **Small test sets by source.** With 800 real annotated tiles and 15% held out by frame,
    the real test split is small and its confidence intervals are wide. A single scorecard
    number from it should be read as an estimate, not a measurement.

## 7. What "done" would look like for a reviewer

- A flown field, at operating altitude, with staked ground truth, in the test split, and
  the scorecard reporting recall on that source alone.
- Predictions versus verdicts over a season, per model version, showing calibration in the
  field rather than on held-out chips.
- An operating point (the 0.6 / 0.4 thresholds) chosen from measured false-positives per
  acre against recall, not guessed.
- A content hash on the model file, checked at load.
- Species suggestions only when a reviewed catalogue and labelled imagery support them.

## 8. Questions a reviewer should ask

- Where could a probability reach a farmer without its caveat?
- Where could the model's default survive to the spray plan without a human click?
- What happens on a field with no crop rows, a closed canopy, or a crop that is not corn?
- What happens if the manifest names a model that does not exist, or the runtime fails to
  load halfway through a batch?
- Could a chip from one field leak into the test split for that same field?
- Is there any path by which imagery or chips leave the browser without the operator's
  action?
- Is the CSP change wider than it needs to be?
