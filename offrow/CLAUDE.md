# offrow

Off-row vegetation detection in early-season corn from RGB drone imagery.

Part of SwathWise. This repo is the research track: given an orthomosaic of a corn
field at V2 to V6, a field boundary, and the grower's row spacing, find vegetation
that is not the planted crop and rank grid cells for operator review.

There is no drone available for this work yet. Everything here is developed against
synthetic scenes and against public datasets resampled to simulate altitude. The
code must not assume access to new imagery.

## The one idea this repo is built on

Do not learn what corn looks like. Learn where corn is.

Corn is planted in rows at a spacing the grower already knows. Fit the row
centerlines, and any vegetation sitting between rows is by construction not the
planted crop. That is a geometric fact, not a prediction, and it works at
altitudes where appearance-based classification does not because it needs a blob
of the wrong color in the wrong place, not a resolvable leaf outline.

Everything in this codebase serves that. If a change makes the system rely more on
appearance and less on geometry, it is probably the wrong change.

## The question this repo exists to answer first

At what ground sample distance does off-row detection stop working?

Published methods that succeed at this were flown at 11 m and below, around 1 to 2
mm/px. Operators fly mapping missions at 100 to 120 m and get roughly 2 cm/px.
That is a fifteen to thirty times gap, and whether the middle of it is usable
decides whether this is a product or a paper.

Answering it needs no new flights. Take real high-resolution imagery, degrade it to
simulate higher altitudes, and measure recall at each step. See `altitude.py`.

## Hard constraints

1. **No machine learning in the current phase.** No torch, no tensorflow, no
   pretrained models, no classifiers. scikit-learn is allowed only for the
   one-class anomaly step, which is not built yet. If a task seems to need a
   model, the geometric approach has not been exhausted.

2. **Never load a full raster into memory.** A 100 acre field at 5 mm/px is on the
   order of 16 billion pixels. All raster access goes through windowed reads with
   overlap. Blobs that straddle a window boundary must be merged, not
   double-counted or truncated. This is the single most likely source of silent
   wrong answers in this repo.

3. **All thresholds are in ground units, never pixels.** Minimum blob area is
   square centimeters. Morphological kernels are millimeters. Buffers are meters.
   Convert to pixels at the call site using the raster transform. The same scene at
   two different GSDs must produce the same mask. There is a test for this and it
   must keep passing.

4. **Every function that touches imagery takes or derives a GSD.** A result
   without a GSD attached is not a result.

5. **No hardcoded sensor.** Camera geometry lives in `sensor.py` as parameters.
   The hardware for this project is not decided yet, so nothing downstream may
   assume a particular drone.

6. **The output is a ranked review queue, never a verdict.** The system surfaces
   and ranks candidates. A human confirms. No code path should describe or treat
   a candidate as a confirmed weed.

## Pipeline

```
ortho + boundary + row spacing
  -> vegetation mask        (chromaticity, ExG, CIVE, Otsu)
  -> row model              (Radon angle, FFT pitch, per-tile centerline fit)
  -> blobs                  (connected components, ground-unit filtering)
  -> candidates             (signed distance to nearest centerline)
  -> review grid            (cells ranked by worst candidate)
```

## Module contracts

### `sensor.py`
Pure geometry, no imagery. Given sensor width in mm, pixel count across, focal
length in mm and altitude in metres, return GSD and ground swath. Inverse too:
given a target GSD, return the required altitude. Also return relative flight
count and acres per hour against a reference altitude, since the operational cost
of flying lower is part of the finding.

No drone is committed to yet, so keep a small dict of candidate airframes and
their parameters rather than baking one in.

### `altitude.py`
The altitude simulation ladder, and the most important module in the repo right
now.

To simulate imagery captured at a higher altitude from imagery captured at a lower
one, do **not** simply decimate. Flying higher degrades the optical transfer
function as well as the sampling rate, and plain decimation simulates only the
second, which makes high altitudes look better than they are.

Apply a Gaussian PSF whose sigma scales with the altitude ratio, then decimate,
then optionally add sensor noise. Expose the PSF assumption as a parameter and
document it as an approximation, because it is one. Any curve produced by this
module must be labelled as simulated, never reported as flown.

`ladder(image, source_gsd_mm, target_gsds_mm) -> list[(gsd, array)]`

### `datasets.py`
Loaders for public sets, normalised to a common internal representation of
imagery plus point or box ground truth.

- DRONEWEED, maize and tomato, 67,558 labelled images, PASCAL VOC boxes, 0.17
  cm/px, maize at BBCH14 and BBCH17. This is the primary benchmark. The maize
  subset at both growth stages is what matters here.
- USU-Corn-WeedDB, UAV RGB multi-species weed detection in forage corn. Secondary
  benchmark, so that nothing is tuned to one collection's soil and light.

Cache downloads under `data/`, which is gitignored.

### `io.py`
Windowed raster access. `iter_windows(path, window_m, overlap_m)` yields
`(array, transform, window)` with overlap sized so the largest expected blob
cannot straddle two windows without appearing whole in one. Boundary clipping and
inward buffering live here. Expose `gsd_m(transform) -> float`.

### `vegetation.py`
Convert RGB to normalized chromaticity first: `r = R/(R+G+B)` and so on. This is
the shadow handling, and it is why a shaded corn leaf and a sunlit corn leaf land
in the same place. Do not threshold raw RGB.

Compute ExG (`2g - r - b`) and CIVE (`0.441r - 0.811g + 0.385b + 18.78745`),
combine, threshold with Otsu per window with a global fallback for windows that
are nearly all soil or nearly all canopy. Morphological open then close, kernel
radius specified in millimeters.

Returns a boolean mask.

### `rows.py`
Row angle by Radon transform of the vegetation mask: project at angles across
0 to 180 degrees, pick the angle whose projection profile has maximum variance.
Row pitch from the FFT or autocorrelation of that profile.

Cross-check the recovered pitch against the grower-supplied row spacing and emit a
warning if they disagree by more than 10 percent, because that usually means the
angle estimate landed on a harmonic.

Refit per tile (default 20 m) and interpolate the row phase across the field so
contour and terrace planting does not break the model. Centerlines come from peaks
in the perpendicular projection profile.

Expose `signed_distance_to_row(points, model) -> np.ndarray` in meters.

Row fitting is likely the first thing to fail as GSD coarsens, since it needs the
projection profile to still show periodic structure. Instrument it to report a
confidence, so the altitude curve can distinguish "rows not found" from "rows
found, weeds missed". Those are different failures with different fixes.

### `blobs.py`
Connected components on the mask. Drop anything below a ground-unit area floor
(default 4 cm squared).

Per blob, compute: `area_m2`, `equiv_diameter_m`, `eccentricity`, `solidity`,
`extent`, `compactness` (perimeter squared over 4 pi area), `major_axis_m`,
`minor_axis_m`, `orientation_rel_row_deg`, mean and std of chromaticity r/g/b,
mean and std ExG, Lab a\* and b\* stats, an LBP histogram (P=8, R=1), plus
`distance_to_row_m` and `inrow_spacing_residual_m`.

Most of these features are not used yet. Compute them anyway. They are the input
to the one-class step later, and collecting them now means the feature extraction
is already validated when that lands.

### `candidates.py`
Current scoring is pure geometry. A blob is a candidate when
`abs(distance_to_row_m) > band_frac * row_spacing_m`, default `band_frac = 0.30`.
Score is the normalized off-row distance, clipped to [0, 1].

Apply exclusions before scoring, not after: inward boundary buffer for headlands
and end rows (default 15 m, configurable), plus any user-supplied exclusion
polygons. Most early false positives live in exactly these places.

### `grid.py`
Tesselate the field into review cells (default 10 m, roughly what a drone sprayer
treats as a unit). Cell attributes: `max_score`, `candidate_count`,
`candidate_area_m2`. Emit GeoJSON sorted by `max_score` descending.

### `synth.py`
A synthetic field generator, used as the development fixture and for the tests
that need exactly known ground truth.

Render a soil background with noise-based texture and color variation, plant
sprites at row positions with configurable spacing jitter and skip rate, and weeds
at controllable density with a tunable off-row bias. Options for directional
shadows, wheel tracks, and wet patches, since those are the known false positive
sources and the pipeline should be tested against them deliberately.

Render at a specified GSD, and be able to render the same scene at several GSDs
natively, which is a useful cross-check on whether `altitude.py`'s degradation
model is behaving sensibly.

Synthetic drives development and tests. It does not produce reportable accuracy
numbers. Anything quoted outside this repo comes from the public datasets.

### `eval.py`
Match predictions to truth by centroid distance within a tolerance.

The headline metric is **recall at a fixed false-positives-per-acre budget**, not
accuracy and not pixel IoU. The operator's real cost is how many junk flags they
click through per acre. Produce the full recall versus FP-per-acre curve.

Second metric at spray resolution: aggregate to review cells and report cell-level
recall, because coarse recall is what actually determines whether the right ground
gets treated.

`gsd_sweep()` runs the pipeline over a scene passed through the `altitude.py`
ladder and produces recall versus GSD, with row-model confidence plotted alongside
so the two failure modes stay separable. That curve is the deliverable that will
decide the flight spec once hardware exists.

## CLI

```
offrow sensor   --sensor-mm 13.2 --px 8192 --focal-mm 8.8 --alt 30
offrow fetch    --dataset droneweed --subset maize
offrow synth    --out data/synth --gsd-mm 5.5 --acres 2 --weed-density 3 --shadows
offrow detect   --ortho F.tif --boundary F.geojson --row-spacing-in 30 --out cand.geojson
offrow grid     --candidates cand.geojson --cell-m 10 --out review.geojson
offrow eval     --pred cand.geojson --truth truth.geojson --out curve.png
offrow gsd-sweep --scene data/droneweed/maize --gsds-mm 1.7,2.7,5.5,11,22 --out sweep.png
```

## Stack

Python 3.11+. rasterio, numpy, scipy, scikit-image, shapely, geopandas, pyproj,
matplotlib, typer, pytest. No GDAL command line dependency.

## Tests that must exist and keep passing

These target the things most likely to break silently rather than the things
easiest to test.

- Row detection recovers a known angle within 1 degree and a known pitch within
  3 percent, swept across angles 0 to 175 and several pitches, on synthetic fields.
- Row detection still recovers the angle with 20 percent plant skips and with a
  10 percent weed population present.
- Blob results from a windowed run are identical to a single-window run on a small
  raster, including blobs placed deliberately across the window seam.
- The same synthetic scene rendered at 2.7 mm and 5.5 mm produces vegetation masks
  whose area agrees within 5 percent, proving ground-unit thresholds work.
- A scene degraded by `altitude.py` from 1.7 mm to 5.5 mm has mask area close to
  the same scene rendered natively at 5.5 mm. If these diverge badly the
  degradation model is wrong and every altitude number downstream is wrong.
- Headland exclusion removes candidates inside the buffer and keeps ones just
  outside it.
- End to end on a synthetic field at 5.5 mm GSD with shadows on, recall stays
  above an agreed floor at a fixed FP-per-acre budget.

## Reference numbers

Worked for a 1 inch, 50 MP sensor at 24 mm equivalent (13.2 mm wide, 8192 px,
1.61 micron pitch, 8.8 mm focal). This is a plausible airframe, not the chosen one.

| Altitude | GSD | Swath | Flights vs 120 m | 3 cm weed |
|---:|---:|---:|---:|---:|
| 10 m | 1.8 mm | 15 m | 144x | 16 px |
| 20 m | 3.7 mm | 30 m | 36x | 8 px |
| 30 m | 5.5 mm | 45 m | 16x | 5 px |
| 60 m | 11.0 mm | 90 m | 4x | 3 px |
| 120 m | 22.0 mm | 180 m | 1x | 1 px |

Roughly 4 px is the floor for detecting a blob at all. Roughly 15 px is where leaf
shape becomes usable. The 20 to 40 m band is the plausible target. Anything that
only works below 20 m is not operationally real, because the flight count makes it
uneconomic.

## Not in scope yet

Species identification. In-row grass weeds. Telling volunteer corn from planted
corn, which is genuinely impossible in RGB at any altitude worth flying. Anything
after canopy closure. Per-frame detection with multi-view consensus, though the
coordinate handling should not make that hard to add later.

## Prior art worth reading before changing the core

- Knowledge-based labelling for weed segmentation, Scientific Reports 2026.
  Effectively this pipeline, already published: ExG plus CIVE, line extraction,
  inter-row geometry, no training labels, 87 percent overall accuracy and 76
  percent user accuracy for weeds at 0.88 mm/px.
- DRONEWEED, maize and tomato UAV dataset, 67,558 labelled images at 0.17 cm/px,
  maize at BBCH14 and BBCH17.
