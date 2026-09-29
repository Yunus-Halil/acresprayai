# Shipped classifier models

Written by `offrow learn publish`, never by hand. Each version is three files:

- `<version>.onnx`: the model. Input `chips` is `N x 3 x 96 x 96` float32 in [0, 1]
  (RGB divided by 255; ImageNet normalisation and the calibration temperature are inside
  the graph). Output `logits` is `N x 3` for the classes `weed, crop, other`; softmax gives
  probabilities. Int8 weight-quantised unless the sidecar says otherwise.
- `<version>.json`: the sidecar. Version, file, classes, the input contract and chip span
  rule the browser must follow, the temperature, the training sources, a scorecard summary
  and a caveat. The app refuses a sidecar whose contract it does not recognise.
- `<version>.scorecard.json`: the full scorecard on the frozen test split, by source and
  by weed diameter bin, with calibration and the confusion matrix. The same file lives in
  `offrow/reports/`.

`manifest.json` names the current version. Removing it, or the version it names, turns the
classifier off: the scout runs on geometry and the operator's own past verdicts alone and
says so in its notes.

What a number from one of these models is: a suggestion with a probability about a single
plant chip, from a model trained on public corn imagery flown at 10 m, synthetic scenes and
operators' verdicts. What it is not: a finding, a species, or a spray decision. The operator
decides; the record says who decided.

The WebAssembly runtime that executes these (`public/ort/`, gitignored) is copied from
`node_modules/onnxruntime-web` by `scripts/copy-ort-wasm.cjs` before every dev and build.
