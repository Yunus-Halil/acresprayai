# Real-world weed measurement validation: report

Run of 2026-10-13 over `measurementrealworldimages/rawimagery/` (15 JPEG photographs, DJI FC9113, 8192 x 6144, gimbal pitch -83 to -90 degrees, each with a yellow Stanley inch tape laid beside a weed). Pipeline version `rw-measure-v1`. Rerun with:

```
npm run rw:measure
npx vitest run src/test/rwMeasure.test.ts
```

The 15 DNG files beside the JPEGs were not used (no raw decoder in the toolchain). The originals were only read.

## What this run establishes, and what it does not

Five things are different, and this run supports them to different degrees.

1. **Ruler detection: established on this set.** The tape was found in 15 of 15 photographs, as the best-filled elongated yellow bar.
2. **Calibration from the ruler's own markings: established on 14 of 15, with stated uncertainty.** The inch is read from the printed ticks (the deepest ticks on a lattice, cross-checked against sixteen times the finest tick period), never assumed from the tape's length or position. Ten photographs calibrated to within 3%, four to within 3 to 5% (the scale drifts 5 to 9% along the tape where the camera was a few degrees off nadir), one was refused (0098: the tape is short and steeply diagonal in the frame; only two inch ticks are readable).
3. **Target plant identification: partially established.** In 9 photographs the pipeline's choice stands on its own; in 6 a runner-up plant scored nearly as well and the choice is flagged for a person. Which plant the photographer meant is not recoverable from the picture alone; the review file exists for that.
4. **Image-based measurement: produced for 14 photographs, supported to the extent of the segmentation.** Spans and areas are computed from a canopy mask whose completeness is uncertain in 13 of 14 (see the segmentation column). Where the mask is a single leaf of a larger plant, the span is that leaf's.
5. **Field-verified accuracy: not established.** No physical measurement of any plant exists for this set. The ground-truth columns are empty and no error figure is claimed. A plausible-looking number is not an accurate one.

Nothing here says anything about drone-altitude measurement. These are close-range (about 1 m) nadir photographs of a tape and a plant.

## Counts

| Stage | Result |
|---|---|
| Photographs processed | 15 (every one has a result record) |
| Tape found | 15 |
| Calibrated ok (uncertainty up to 3%) | 10 |
| Calibrated, uncertain (3 to 8%) | 4 |
| Calibration refused | 1 (0098) |
| Target selected without a flag | 9 |
| Target flagged for review | 6 |
| Canopy isolated | 1 (0104) |
| Canopy touching vegetation | 1 (0099) |
| Canopy uncertain | 13 |
| Measurements produced | 14 |
| Measurements refused | 1 (no scale) |
| Area reported | 14 (all within 8 degrees of nadir) |
| Ground truth available | 0 |
| Review files accepted | 0 (all pending) |

## Per image

| Photo | Scale px/cm | Scale unc. | Calibration | Target | Canopy | Max span cm | Perp. span cm | Area cm2 | Equiv. diam. cm |
|---|---|---|---|---|---|---|---|---|---|
| 0097 | 141.9 | 1.0% | ok | selected | uncertain: one leaf core 2.5 cm away not joined | 14 | 13 | 72 | 9.5 |
| 0098 | refused | | failed: two inch ticks readable on a short, steep tape | selected | no scale | | | | |
| 0099 | 142.8 | 4.1% | uncertain: drift 8.1% along the tape | review | touching vegetation: 45% smooth leaf | 6 | 2.7 | 10 | 3.6 |
| 0100 | 147.2 | 4.3% | uncertain: drift 8.6% | selected | uncertain: one core not joined | 4.2 | 2.7 | 7 | 3.1 |
| 0101 | 129.7 | 1.1% | ok | review | uncertain: runner-up plant | 7.2 | 5.3 | 21 | 5.2 |
| 0102 | 152.0 | 2.6% | ok | review | uncertain: runner-up plant | 6.1 | 3.3 | 11 | 3.8 |
| 0103 | 116.0 | 1.1% | ok | review | uncertain: runner-up plant | 6.2 | 3.8 | 15 | 4.4 |
| 0104 | 170.2 | 2.4% | ok | selected | isolated | 6.5 | 3.2 | 12 | 3.9 |
| 0106 | 134.5 | 3.5% | uncertain: drift 6.9% | review | uncertain: runner-up plant | 6.3 | 4.4 | 15 | 4.3 |
| 0107 | 130.1 | 2.4% | ok | selected | uncertain: three cores not joined | 9 | 4.4 | 22 | 5.3 |
| 0108 | 85.9 | 1.2% | ok: lattice read is two inches, told by the body width | selected | uncertain: 25 cores joined, a patch | 31 | 20 | 318 | 20 |
| 0109 | 87.7 | 1.1% | ok | selected | uncertain: 15 cores joined, a patch | 20 | 16 | 131 | 13 |
| 0110 | 115.9 | 3.0% | uncertain: noise 3.0%, drift 5.3% | selected | uncertain: three cores not joined | 13 | 7.5 | 37 | 6.9 |
| 0111 | 150.3 | 0.5% | ok | review | uncertain: runner-up plant | 4 | 3.8 | 10 | 3.6 |
| 0112 | 94.2 | 1.4% | ok | selected | uncertain: two cores not joined | 14 | 9.4 | 64 | 9 |

`measurements.csv` has the same rows with every column; `images/<name>.result.json` has the full record, including the tick positions, the local inch along the tape, the target alternatives and the mask outline.

Reading the overlays (`images/<name>.5-measurement.png`): white is the maximum span, magenta the span perpendicular to it through the midpoint, cyan the inch ticks that were read, the label top left the result and its state (OK? means every stage passed but no person has accepted it; REVIEW means a stage flagged itself; REFUSE means no measurement).

## Method, as run

- **Tape.** Yellow is read as red within 15% of green, green within 20% of red, blue under 85% of green, and bright. Among the yellow components at one eighth scale, the tape is the one that is at least three times longer than wide and fills at least a quarter of its own oriented box, largest first. The tape is straightened along its principal axis at native resolution.
- **Calibration.** Per column of the straightened tape: the darkness relative to the row's own yellow in the outer third of the body from each edge (the fine ticks), and the share of body rows with ink (the long ticks). The finest tick period comes from the autocorrelation of the band darkness. The inch ticks are the deepest class that sits on one lattice, extended outward by tracking with a local spacing allowed to drift 4% per inch; a numeral stroke, a grass blade across the tape or the hook's shadow is not on the lattice and is left out. The inch is the median local spacing; the scale at the plant is the local spacing nearest the plant's projection on the tape. The ratio of lattice spacing to fine period says the unit: a power of two is an inch tape, ten is metric (refused in this version). Where the ratio admits two readings a factor of two apart (eight fine ticks per long tick: an inch at eighth resolution, or a half inch at sixteenth), the body width decides: on the unambiguous photographs the yellow body is 0.90 to 0.95 inch wide, and the reading within a quarter of that is taken. The body width is never the scale itself. Uncertainty is the largest of the spacing noise, the fine-versus-lattice disagreement beyond the fine period's half-pixel resolution, and half the drift along the tape.
- **Canopy.** At a quarter scale, green by chromaticity (not yellow, not deep shadow). On a lawn (green over 35% of the picture) the darkest 30% of green pixels are dropped: a leaf has no dark gap inside it, a lawn has shadow between blades. An opening with a disc of 0.35 cm radius (wider than a blade) leaves the leaf cores. The target core is scored by area, discounted by distance from the picture's centre and, softly, from the tape's axis. Cores within 0.7 cm of the target are chained into one canopy (a rosette's leaves open into separate cores); eight or more joined is reported as a patch. The joined core is grown back 0.5 cm within green to the leaf edge. The tape's yellow and shadow under luma 35 are never canopy.
- **Measurement.** Maximum span is the convex hull's diameter; the perpendicular span is the extent across the span's direction through its midpoint; area is the mask's pixel count; equivalent diameter is that of the disc with the same area. Area is withheld beyond 8 degrees off nadir and when the mask touches the picture's edge. All of it is on the tape's plane; a leaf above the plane reads larger by its height over the camera distance, about 1 to 3% here.

## Failure modes met during the run, and what was done

Each was found on these photographs, not assumed.

- The first yellow rule (hue 42 to 72 degrees) lost the tape in five photographs where the bright morning light washed the body out to r 220, g 246, b 178 (hue 83). Replaced by the channel-ratio rule above.
- Taking the largest yellow component as the tape picked yellow-green lawn in those photographs. Replaced by the filled-bar rule.
- Reading a tick as a contiguous run of ink in from the edge read the real ticks at a fifth of their length (JPEG and a slight tilt break the run). Replaced by whole-body column statistics.
- The strongest autocorrelation peak is often a harmonic (the eighths are deeper than the sixteenths). The finest period is now the smallest lag that still clearly repeats.
- Half-inch ticks read as deep as inch ticks in some photographs, giving a lattice at half the inch. Alternation of depth along the lattice, and failing that the body width, now tell them apart.
- The feet-and-inches sub-numerals next to inch ticks shifted a tick's run centre; tick positions are now height-weighted centroids. In 0108 the deepest class came out as a two-inch lattice; the body width resolved it.
- Off-nadir photographs foreshorten along the tape by 5 to 9%; a single global inch hid that. The inch is now local, with the drift in the uncertainty.
- A rosette's leaves open into separate cores and the first measurement was of one leaf. Cores are now joined within 0.7 cm, and cores left within 2.5 cm are flagged.
- A dandelion darker than its lawn (0112) lost most of its leaves at the 60th lit-green percentile; the 30th keeps it and still drops the grass.
- Growing the core back by 0.65 cm took grass in at the edge; halved to 0.5 cm total.

Still open: the target in six photographs needs a person; the join gap is a single number and a shaded leaf 1.5 cm away is left out (0112, 0107); the patches in 0108 and 0109 are many plants and the measurement is of the patch; 0098 needs ruler points from a person.

## Review workflow

`review/<name>.json` is written once per photograph and never overwritten. Filling it in changes the next run:

- `targetOverride: {x, y}` (native pixels) picks the plant.
- `rulerPoints: [{x, y, inches}, ...]` (two or more, two inches apart at least) replaces the tick calibration; the record then says `manual-points`.
- `joinGapCm` widens the gap within which leaf cores are joined.
- `maskErase: [{x, y, r}]` removes discs from the mask.
- `groundTruth: {maxSpanCm, perpendicularSpanCm, measuredInField, notes}` enables the comparison columns.
- `status: accepted | rejected` and `notes`.

Automated results and human corrections stay in separate files; the record says which was used.

## Tests and environment

`src/test/rwMeasure.test.ts`: 10 tests on painted pictures (units, spans, tape at four angles, metric refusal, no tape, no ticks, canopy on grass, off-nadir area withheld, manual override, comparison). All pass.

Node 24.14.1, jpeg-js 0.4.4, pngjs 7.0.0, vite-node. No OpenCV, no raw decoder, no model.

The production Swardus detector, thresholds and app were not changed by this work; the pipeline lives in `src/lib/rwMeasure/` and `scripts/rwmeasure/` and nothing in the app imports it. The earlier benchmark under `evaluation/` is untouched.
