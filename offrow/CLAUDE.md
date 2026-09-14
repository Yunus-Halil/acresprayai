# offrow

Off-row vegetation detection in early-season corn from RGB drone imagery.

Part of SwathWise. This repo is the research track: given an orthomosaic of a corn
field at V2 to V6, a field boundary, and the grower's row spacing, find vegetation
that is not the planted crop and rank grid cells for operator review.

Development is carried by synthetic scenes and public datasets; flown imagery is
arriving and the altitude ladder will be flown rather than simulated. Nothing may
assume any particular imagery is present: every loader states where its data
comes from and refuses rather than substituting, and every number states whether
it was flown, rendered, or neither.

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

**The altitude ladder comes from real flights.** A drone flies the ladder and the
rungs are measured, not simulated. There is no `altitude.py` and there is not
going to be one: simulating degradation was only ever a way to answer this
without an aircraft, and there is an aircraft.

What this changes for everything else: a rung of the ladder is imagery captured
at that GSD, so `eval.gsd_sweep()` takes a scene per GSD rather than one scene
and a degradation model. Synthetic scenes can still be rendered natively at
several GSDs, which is useful for exercising a detector across resolutions on
known truth, and is still not flying.

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

### `datasets.py`
Loaders for public sets, normalised to a common internal representation of
imagery plus point or box ground truth.

- **USU-Corn-WeedDB is primary for row geometry.** UAV RGB multi-species weed
  detection in forage corn, 10 m AGL, 0.48 cm/px, YOLO boxes, CC BY 4.0, on
  Zenodo. 8,800 tiles of 640 px, of which 800 are labelled.
- **DRONEWEED is primary for the vegetation mask and blob features.** Maize and
  tomato, 67,558 labelled images, PASCAL VOC boxes, 0.17 cm/px, maize at BBCH14
  and BBCH17. Its maize subset is the only public set here that labels the crop
  as well as the weeds.

This split is the reverse of the original spec, and the reason is worth keeping:

1. **Resolution.** USU at 4.8 mm/px is within 15 percent of the 5.5 mm/px a 30 m
   flight gives, so row fitting gets tested at roughly the resolution the product
   would actually fly. DRONEWEED at 1.7 mm/px would have made `rows.py` look good
   at a resolution no operator will give you.
2. **Coverage.** Both sets ship orthomosaic tiles, not orthomosaics. A DRONEWEED
   tile is 1000 px at 1.7 mm/px, which is 1.70 m of ground: 2.2 rows at 30 inch
   spacing. No row model fits in that. USU tiles are 3.07 m, four rows, which is
   no better on its own, but USU filenames encode the tile's origin in the frame
   it was cut from (`10m_cache (1036)_x1024_y512.jpg`), so the tiles reassemble
   into 12.9 by 17.8 m frames: 16.9 rows, and the row structure is unmistakable.
   DRONEWEED files are named species plus a counter, so the grid position is
   gone unless the VOC `path` field happened to keep the original partition name.
   Do not go hunting for it beyond that one check. DRONEWEED mosaics are not
   needed; its per-tile imagery and its labelled maize are.

A stitched mosaic has complete imagery and partial truth, because only a sparse
subset of each frame's tiles are labelled. `Mosaic.truth_footprint_m2` reports
how much of the imagery the truth covers, and scoring happens only inside it. A
detection outside that footprint is unjudgeable, not a false positive.

USU does not label the corn, only the three weed species. DRONEWEED does label
maize. That is the argument for keeping both, not a gap to be fixed.

Cache downloads under `data/`, which is gitignored. DIGITAL.CSIC, which hosts
DRONEWEED, sits behind proof-of-work bot protection. That is an access control
the operator put up: `fetch` refuses and prints the manual route rather than
working around it, and never silently falls back to the other dataset.

### `io.py`
Windowed raster access. `iter_windows(path, window_m, overlap_m)` yields
`(array, transform, window)` with overlap sized so the largest expected blob
cannot straddle two windows without appearing whole in one. Boundary clipping and
inward buffering live here. Expose `gsd_m(transform) -> float`.

**Two backends behind one interface.** `rasterio` when it loads, `tifffile` when
it does not, chosen at runtime by `open_raster(path, backend="auto")` and
reported by `active_backend()` and `offrow backends`. The tifffile backend
decodes only the TIFF segments a window touches and takes georeferencing from
GeoTIFF tags or a `.tfw` world file. Both are tested against each other; they
return identical pixels, transforms and bounds.

The seam logic lives in this module, not in either backend, so both are correct
for the same reason. Ownership is the mechanism: every window gets an owned
rectangle, the owned rectangles tile the raster exactly with no gaps and no
overlaps, and a feature is kept from the window that owns its centroid. The
boundary between two neighbours is the midpoint of the ground they actually
share, computed from the offsets used rather than from the nominal stride,
because the last window is pulled back to the raster edge and an ownership rule
that ignored that would have two windows owning the same ground.

Features flagged `touches_border` are dropped before the ownership test. A blob
cut by a window edge has a displaced centroid and a truncated area, so it cannot
be trusted even when its centroid lands in the owned rectangle. Nothing is lost:
with the overlap at least one blob diameter, every blob appears whole in the
window that owns it. `required_overlap_m()` states that rule.

GeoJSON reading and writing are hand-rolled on `json` plus `shapely`, because
`pyogrio` needs GDAL and GDAL is not guaranteed to load.

### `vegetation.py`
Returns a boolean mask, and `vegetation_coverage()` alongside it. A binary mask
of a five-pixel object is mostly edge, so its ground area is not GSD-invariant
even when the imagery is: measured across 2.75 to 5.5 mm/px, a 3 cm weed's mask
area rises about 18 percent while a 12 cm plant moves about 1. Sub-pixel
coverage drifts less and is the measure to prefer, though it is not a cure,
since its endpoints come from percentiles and a five-pixel weed has few fully
vegetated pixels to set the plant end from.

**Morphological kernels quantise, and that is worse than it sounds.** A radius
in millimetres becomes a whole number of pixels, so a 3 mm opening is one pixel
at 1.7 mm/px (1.7 mm of ground), one pixel at 2.75 mm/px (2.75 mm of ground),
and zero pixels at 5.5 mm/px. The radius is floored rather than rounded, so the
kernel applied is never larger than the one requested, but it cannot be constant
across a GSD ladder and no rounding rule makes it so. Rounding up was worse: it
made the effective ground radius grow as GSD coarsened and then snap back to
zero, which alone swung 3 cm weed mask area by 29 points across a factor of two.

`MaskResult.effective_open_radius_mm` reports what was actually applied. The
conclusion for `blobs.py`: **the ground-unit area floor is the correct way to
despeckle, not morphology**, because a pixel count times a pixel area is
continuous in GSD while a structuring element is not. Keep the opening small and
let the area floor do that work. Closing still earns its place, rejoining a leaf
split by a shadow, where being approximate is acceptable.

The global fallback is two-pass and bounded: `accumulate_histogram()` builds a
fixed-range histogram across windows and `threshold_from_histogram()` takes Otsu
on the total, so whole-raster statistics never need a whole raster in memory.

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
(default 4 cm squared). This floor, not the morphological opening, is where
despeckling belongs: it is continuous in GSD where a structuring element is not.

Drop blobs touching a window border too, and let the owning window supply them
whole. `io.merge_across_seams()` expects a `touches_border` flag for that.

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

Weed diameter is a controllable parameter and its default is the 3 cm seedling
the flight spec targets, **not** the 15 to 38 cm distribution the public sets
happen to contain. Synthetic scenes are the only place the hard regime gets
tested, and defaulting to the easy one would waste that. Ground truth carries
the diameter of every weed so recall can be binned by it.

Render at a specified GSD, and be able to render the same scene at several GSDs
natively, which is a useful cross-check on whether `altitude.py`'s degradation
model is behaving sensibly. Rendering is anchored in ground coordinates and
antialiased analytically, so a 3 cm weed at 11 mm/px is genuinely a soft
three-pixel smudge rather than a hard dot drawn at whatever size the pixel grid
allows.

Synthetic drives development and tests. It does not produce reportable accuracy
numbers. Anything quoted outside this repo comes from the public datasets.

### `eval.py`
Match predictions to truth by centroid distance within a tolerance.

The headline metric is **recall at a fixed false-positives-per-acre budget**, not
accuracy and not pixel IoU. The operator's real cost is how many junk flags they
click through per acre. Produce the full recall versus FP-per-acre curve.

**Recall is never reported pooled across weed sizes.** Every recall figure is
binned by ground-truth weed diameter, with bin edges at 4, 8, 16 and 32 cm.
Those are octaves anchored on the 3 cm seedling the flight spec targets: at the
5.5 mm/px a 30 m flight gives, they land at 7.3, 14.5, 29 and 58 px across, so
the first edge sits just above the roughly 4 px detection floor and the second
right at the roughly 15 px shape floor. The bins separate detection regimes
rather than slicing a continuum at round numbers.

The smallest bin is the only one that speaks to the flight spec, and it must be
called out as such wherever recall is reported. This matters because the public
sets do not populate it. USU has **zero** labelled weeds under 8 cm: 76 percent
of its truth is 16 to 32 cm, which is 31 to 67 px at its own GSD and well into
the regime where leaf shape is resolvable. A pooled recall number from USU would
measure the easy problem and flatter us.

The consequence for this phase, which belongs in any writeup: the public sets
sit at stages and sizes where this is easier than the real target, so the
recall-versus-GSD curve **bounds the problem from above rather than estimating
it**. Say so. The smallest-bin numbers are the closest thing to a real answer,
and `synth.py` is where the hard regime that neither public set covers gets
tested at all.

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
offrow backends
offrow fetch    --dataset usu-corn-weeddb
offrow inspect  --dataset usu-corn-weeddb --row-spacing-in 30 --mosaic --complete
offrow synth    --out data/synth --gsd-mm 5.5 --acres 2 --weed-cm 3 --shadows
offrow synth    --out data/synth --width-m 13 --height-m 13 --ladder-mm 1.7,5.5,11
offrow detect   --ortho F.tif --boundary F.geojson --row-spacing-in 30 --out cand.geojson
offrow grid     --candidates cand.geojson --cell-m 10 --out review.geojson
offrow eval     --pred cand.geojson --truth truth.geojson --out curve.png
offrow gsd-sweep --scene data/droneweed/maize --gsds-mm 1.7,2.7,5.5,11,22 --out sweep.png
```

## Stack

Python 3.11+. rasterio, numpy, scipy, scikit-image, shapely, geopandas, pyproj,
matplotlib, typer, pytest. No GDAL command line dependency.

**The GDAL stack is not guaranteed to load.** On this machine an Application
Control policy blocked the compiled extensions in `rasterio`, `pyproj` and
`pyogrio` for a period and then stopped blocking them, with no change to the
install. Treat its availability as a runtime fact to be checked, not a build-time
one to be assumed.

Everything that touches GDAL therefore goes through a backend seam:

- `io.py` reads through `rasterio` or `tifffile`, chosen at runtime, reported by
  `active_backend()` and `offrow backends`. Both are tested against each other.
- `synth.py` writes through `rasterio` or `tifffile` plus `.tfw` and `.prj`
  world files. `last_raster_backend()` says which ran.
- GeoJSON is read and written with `json` and `shapely`, never `pyogrio`.
- Scene coordinates are written directly in a projected CRS in metres, so
  nothing needs `pyproj` to reproject.

The choice is never silent and never a substitution: asking for a backend that
cannot load raises rather than quietly using the other one.

## Tests that must exist and keep passing

These target the things most likely to break silently rather than the things
easiest to test.

- Row detection recovers a known angle within 1 degree and a known pitch within
  3 percent, swept across angles 0 to 175 and several pitches, on synthetic fields.
- Row detection still recovers the angle with 20 percent plant skips and with a
  10 percent weed population present.
- Blob results from a windowed run are identical to a single-window run on a small
  raster, including blobs placed deliberately across the window seam. Landed in
  `tests/test_io.py`, parametrised over every backend that loads. Positions are
  compared with a sub-pixel ground tolerance, not for bit-equality: a windowed
  centroid is computed in the window and offset by its origin, so it takes a
  different rounding path to the same answer.
- The same synthetic scene rendered at 2.7 mm and 5.5 mm produces vegetation masks
  whose area agrees within 5 percent, proving ground-unit thresholds work. **This
  holds for crop-sized objects and does not hold for the 3 cm seedling.**
  Measured on the renderer: coverage-weighted area agrees to 2 to 3 percent at
  both sizes, but a fixed index threshold inflates area by about 5 percent for a
  12 cm plant and about 20 percent for a 3 cm weed, always upward. A hard
  threshold on a soft edge adds roughly half a pixel of rim, and for a five-pixel
  object the rim is a fifth of the area. So `vegetation.py` must either carry
  sub-pixel coverage or accept that the blob area floor is GSD-dependent, and
  that is a decision to make deliberately rather than discover. `test_synth.py`
  pins the fact in both directions so neither can regress silently.
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

Flight count is piecewise, not quadratic. Ground speed is the smaller of cruise
speed and what the frame interval allows at the required frontlap, so above the
crossover altitude the aircraft is cruise-limited and coverage falls off
linearly as you descend, and below it the camera binds and the fall-off goes
quadratic. At 15 m/s, a 1 s frame interval and 75 percent frontlap the crossover
is 53.3 m. The frame is 4:3, so the along-track edge is 9.9 mm, and that edge is
what sets the crossover.

| Altitude | GSD | Swath | Limit | Flights vs 120 m | 3 cm weed |
|---:|---:|---:|:--|---:|---:|
| 10 m | 1.8 mm | 15 m | frame | 64x | 16 px |
| 20 m | 3.7 mm | 30 m | frame | 16x | 8 px |
| 30 m | 5.5 mm | 45 m | frame | 7.1x | 5 px |
| 40 m | 7.3 mm | 60 m | frame | 4x | 4 px |
| 60 m | 11.0 mm | 90 m | cruise | 2x | 3 px |
| 120 m | 22.0 mm | 180 m | cruise | 1x | 1 px |

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
