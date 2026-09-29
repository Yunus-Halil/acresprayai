"""The learning track: from "not average" to "weed".

The geometric detector (rows, baseline, plant population) finds what is not
average and what is not where the crop should be. It has never been shown a
labelled weed, so it cannot say "weed"; the operator says it. This package is
what changes that, and it is built on three parts that have to exist before any
model is worth training:

1. **One ground-truth store** (:mod:`offrow.learn.examples`). Every labelled
   chip, whatever it came from (a public dataset, a synthetic scene, an
   operator's saved verdict), lands in one format with its ground sample
   distance, its label, where the label came from, its licence, and a
   train/val/test split assigned by *group* (a frame, a scene, a field), never
   by chip, so a model can never be scored on the neighbour of a chip it
   trained on.

2. **A scorecard for every model** (:mod:`offrow.learn.evaluate`). Recall,
   precision and calibration on the frozen test split, broken down by source
   and by weed size. A version that scores worse than the last on the same test
   set does not ship; the gate is a function, not a habit.

3. **A boundary the app can hold** (:mod:`offrow.learn.export`). The model
   leaves here as an ONNX file plus a sidecar that states its version, its
   classes, its input contract and its scorecard. The browser runs it on the
   chips the scout already renders; nothing leaves the browser.

The rule this package changes, and the rule it keeps: machine learning is now
allowed, in this package only. Geometry still generates the candidates and
still owns every threshold in ground units; the model classifies what geometry
found. The output is still a suggestion with a probability, never a verdict.
"""
