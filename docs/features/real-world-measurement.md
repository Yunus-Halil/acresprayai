# Real-world weed measurement (ruler-referenced)

An isolated experiment: close-range nadir photographs of a weed with a yellow Stanley inch tape beside it, measured in centimetres from the tape's own tick markings. It does not touch the production detector or the app. Code in `src/lib/rwMeasure/` (tape, canopy, measure, geometry, types), runner in `scripts/rwmeasure/run.ts`, tests in `src/test/rwMeasure.test.ts`.

```
npm run rw:measure -- [--dir measurementrealworldimages/rawimagery] [--out measurementrealworldimages/results] [--only 0097,0102] [--scale 4]
```

Outputs under `measurementrealworldimages/results/`: `measurements.csv`, `results.json`, `report.md` (the findings of the last run, written by hand from the data), `contact-sheet.png`, and per image `images/<name>.result.json` plus five pictures (original, target, mask, boundary, measurement). The originals and the PNGs are gitignored; the JSON, CSV and report are committed.

## Five different claims

The report keeps these apart, and so should anyone reading a number from it: the ruler was found; the scale was established from its markings with a stated uncertainty; the intended plant was identified; a measurement was computed from the picture; the measurement is accurate against a field measurement. The last needs ground truth that does not yet exist for this set (the `groundTruth` block in `results/review/<name>.json`).

## Calibration in one paragraph

The tape is the best-filled elongated yellow bar; it is straightened along its axis. The finest tick period comes from the autocorrelation of ink darkness in the edge bands; the inch ticks are the deepest class of column that sits on one lattice, tracked along the tape with a local spacing (a tape seen off nadir foreshortens 5 to 9% along its length; the scale used is the one nearest the plant). The ratio of lattice spacing to fine period says the unit (a power of two is inch, ten is metric and refused); where the ratio admits readings a factor of two apart, the body width measured on the unambiguous photographs (0.90 to 0.95 inch) decides. Nothing about the tape's length or position is assumed.

## Review

`results/review/<name>.json` is a template written once per photograph. A person may set the target, give ruler points (which replace the tick calibration and are labelled as such), widen the join gap between leaf cores, erase discs from the mask, enter a field measurement, and accept or reject. The next run uses it and the record says so.

## Known limits (2026-10-13)

The target is the pipeline's guess in nine of fifteen photographs and flagged in six; a rosette whose shaded leaf lies more than 0.7 cm from the rest loses it unless the join gap is widened; a clover patch measures as a patch, which the record says; a short, steeply diagonal tape with two readable inch ticks is refused. No drone-altitude claim follows from any of this.
