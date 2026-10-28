# Swardus Direct: the whole algorithm, end to end, and every way to make it faster for a farmer

## Context

Swardus Direct turns a flight's original photographs into a Field Twin with no orthomosaic. Yunus asked for a
complete understanding of the method and every possible optimisation, for speed and for a farmer on cheap
hardware (the mission: precision agriculture for every farmer, rural and low-connectivity). This document is
that understanding plus the plan. Everything measured here was measured on the 71-photograph apricot flight
(Phantom 4 RTK, 5472 × 3648, 0.98 cm pixels at 36 m) on this machine, on one CPU core in Node unless said
otherwise; the browser build (one Web Worker) runs the same code.

Measured today (`scripts/directGeoref/buildTwinApp.ts`, 71 photographs, weed answers read from disk):

| Stage | Seconds | What it really spent them on |
|---|---|---|
| Reading the photographs | 96 | jpeg-js full 20 MP decode, 1.35 s each |
| Aligning the cameras (soil ties, two rounds, three fits) | 63 | window resampling, 64² FFTs, ring re-projection |
| Rows and trees (94 reads) | 94 | **decode again** (a cache bug): the reader itself is under 1 s |
| Weeds (reconcile 30,536 detections) | 1 | fine as it is |
| Atlases (15,829 crops, 49 JPEGs) | 72 | decode again + jpeg-js encode |
| Evidence raster | 60 | decode again |
| Boundary | 0.3 | fine |
| **Total** | **387** | **about 70 % is JPEG decoding** |

The weed model is not in that table. Measured from the 71 saved service answers: RF-DETR Seg-Large on the
RX 9060 XT takes **8.4 s per photograph** (median; 10 minutes for the flight, `data/direct-georef/service.log`):
forward passes 5.6 s (35 tiles of 1024 px, 159 ms each), **polygon geometry 2.6 s (31 %)** because the twin asks
for "full" geometry and then thins every outline to 32 points, decode 0.16 s, fusion and rasterising 0.1 s. On a
CPU the same tile takes 6 s at 4 threads (`two-stage-weed-intelligence.md`): 3.5 minutes per photograph, about
4 hours for the flight. That is the cost a farmer without a GPU faces today, and the first thing to cut.

CPU profile of the same pipeline on 24 photographs (Node, `--cpu-prof`): jpeg-js decode 85 s of 129 s (66 %),
garbage collection 4.5 %, FFT + window sampling + phase correlation 11 s (8.5 %), ring point-in-polygon 1.2 s,
the row reader (boxMean, piecesOf, masks) about 1 s, atlas JPEG encode 2.5 s.

Decisions taken with Yunus (2026-10-28): the first target is **a laptop without a GPU**, in the field; the weed
stage may offer **tiers the operator picks** (colour-only in seconds, a small model on CPU in minutes, Seg-Large
on a GPU for the full result), the twin always saying which ran; and **the flight itself is in scope**, tested
offline first by dropping every second photograph of this flight.

## Part 1: the algorithm, end to end

### 1.1 What a photograph gives us (`src/lib/directGeoref/metadata.ts`, `frame.ts`)
The DJI header holds the camera position (RTK, 1 cm), its height above take-off, the gimbal angles, the
calibrated focal length and principal point, and whether the lens was dewarped in camera. From these
`frameFromDji` builds a pinhole camera on a declared flat ground plane at take-off height. Nothing is guessed:
a missing field refuses the photograph with the reason.

### 1.2 Projection (`projection.ts`)
`pixelToGround`: pixel → normalised ray → rotate by the camera-to-world matrix (gimbal yaw/pitch/roll, then the
boresight) → intersect the ground plane → ENU metres → lat/lng. `groundToPixel` is the inverse.
`groundSampleAt` is three projections. Cost today: the 3 × 3 rotation is rebuilt on every call (6 trig calls,
8 array allocations), and every call allocates about 15 small objects. This function is called millions of
times (the ties, the solver, reconciliation, evidence sampling).

### 1.3 Reading the photographs (`build/photos.ts`, `objects.ts`)
Each photograph is decoded in full (20 MP), box-averaged to a quarter (1368 × 912, 3.9 cm/px), the ExGR green
mask is cut, green patches are found (connected components of 2 px cells), and a grey raster with the green mask
is kept for the ties. Cost: the full decode. Everything downstream except the weed model and the evidence
crops reads the quarter.

### 1.4 Aligning the cameras on the soil (`soilTies.ts`, `fft.ts`, `adjust.ts`, `build/cameras.ts`)
Why: the header places a photograph to about 2 m (a 2° camera-to-gimbal offset at 36 m), and opposite flight legs
disagree by 1.9 m. The photographs are aligned to each other on bare-soil texture, which lies on the ground and
is unique at centimetre scale.
- Pairs: every two cameras within 45 m (635 pairs for 71 photographs).
- Per pair: both footprints are projected; a 1 m grid over the overlap decides where both see the ground (about
  6,000 point-in-footprint tests, each re-projecting the 16-vertex ring); a coarse 128² window at 16 cm is phase
  correlated to find the metre-scale shift; then up to 60 fine 64² windows at 4 cm (2.56 m), each resampled from
  both photographs through a homography (4,096 bilinear reads, an allocation per sample), gated (soil only,
  textured, not stripes), correlated, and correlated back at the found shift as a check.
- A tie is a pixel-to-pixel correspondence; it survives any later camera change.
- Fit 1: four flight-wide numbers (tilt across, tilt along, spin, ground height) by Levenberg-Marquardt with a
  forward-difference Jacobian over 13,700 ties. Ties are found again under the fit (14,700). Fit 2: the four
  numbers again, then the reference model: the four plus five per-photo corrections (east, north, yaw, two
  tilts) with a 1° prior, 359 parameters, 15 iterations, each iteration evaluating about 200,000 tie residuals
  (400,000 projections, each rebuilding the rotation).
- Result on the apricot: held-out ties agree to 7 cm.

### 1.5 Rows and trees (`build/rows.ts`, `weedVision/fieldRows.ts`, `weedVision/layout/plantingLayout.ts`)
Per photograph, three passes: the tree-row reader with default rules (48 photographs in the in-app run), the
same with a lower size share accepted only when it agrees with the field (9), and a fit seeded by three trees
reconciled from other photographs (10); 4 stay unread. The planting-layout fitter is the app's: a lattice from three positions, refined, grown tree
by tree on an 8 cm raster of green, shadow and cover. Trees from all photographs are reconciled into one object
each (rays must meet); rows are peaks of the trees' across offsets along the refined planting direction; a row
is kept on evidence (4 trees, 2 photographs, straight, filled). Cost: the reader itself is cheap (about 1 s for
the flight); the stage's 94 s today are the decode bug.

### 1.6 Weeds (`build/weeds.ts`, `reconcile.ts`, the service)
RF-DETR Seg-Large (35.6 M parameters, input 504 px, fp32, batch 1, one inference at a time behind a lock) on
every photograph in 1024 px tiles with 256 px overlap (35 tiles; the service's own default overlap is 128, which
would be 24), confidence 0.5. **Each 1024 px tile is resized to 504 px inside the model, so the model sees the
photograph at about 2 cm per pixel, never at 1 cm.** The tiles overlap 1.84 ×, so 36.7 MP are pushed for a 20 MP
photograph. The service rasterises two 80 MB label images per photograph and, with "full" geometry, measures
hulls, spans and oriented boxes and traces contours for every instance (weeds and crops); the twin keeps only
`max_span_px` of all that and thins the polygons to 32, 16 and 20 points. Each instance becomes a ground observation at its own pixel size. Reconciliation across
photographs: a hash grid per frame, links between observations whose rays meet (miss under 10 cm + a quarter of
the size) with one sighting per photograph, union-find, position from the point closest to all rays, coverage
counted against every footprint. Classes: on a tree (inside a crown or over 0.5 m tall), on a row (within
0.5 m of a row line), between rows; verified = seen in two or more photographs. Cost: the model (GPU 15 s per
photograph); reconciliation 1 s.

### 1.7 Other vegetation, evidence crops, the bundle (`build/bundle.ts`)
Green patches seen twice that are neither tree nor weed. For every tree and weed, one or two crops of the
original photographs (nearest the frame centre) are cut into 112 px atlas cells: 15,829 crops, 49 atlases of
2016 × 2016, 52 MB. Cost: a second full decode per photograph plus the JPEG encoding of the atlases.

### 1.8 Evidence and the cultivated block (`build/bundle.ts`, `fieldTwin/boundary.ts`, `boundaryEvidence.ts`)
Every quarter metre of ground is sampled from the nearest-nadir photograph (cover share, brightness,
saturation), classed (soil, canopy, cover, road, foreign, unseen), and probes from every row end and along the
outer rows find where the field stops. Cost: a decode per photograph (cached quarter in the browser; the bug in
Node) and 550,000 `groundToPixel` calls.

### 1.9 Opening the twin (`fieldTwin/intelligence.ts`, `heatmap.ts`, `scene.ts`)
8.9 MB of JSON (1.7 MB gzipped), about 120 ms of compute, draws under 3 ms. The transfer dominates for a real
user (14 s at 5 Mbit/s).

## Part 2: where the time goes, and why

| Rank | Cost | Cause |
|---|---|---|
| 1 | The weed model | 2,485 tiles through a 36 M-parameter transformer; every tile of every photograph, though each ground cell is seen 4.8 times (median 4) and verification needs 2; 31 % of the service time is geometry the twin throws away; 1.84 × tile overlap; one tile at a time |
| 2 | JPEG decoding | 20 MP decoded in full for a quarter-size result; in Node four times per photograph (cache bug `nodePhotos.ts:28`); in the browser twice (quarter + crops) |
| 3 | Soil ties | 1,270 pair runs; per fine window three resamplings of 4,096 bilinear reads with an allocation each, two 64² phase correlations (A's FFT twice), 6,000 ring re-projections per pair for the overlap grid |
| 4 | The solver | 359 parameters by finite differences: 400,000 projections per iteration, both ends of a tie recomputed when one camera moves, the rotation rebuilt per projection |
| 5 | Atlases | 15,829 crops, 49 JPEG encodes of 4 MP, a second full decode per photograph |
| 6 | Evidence raster | 550,000 projections with rotation rebuilds, cells tested against all 71 footprints |

## Part 3: the optimisations

Ordered by (gain × certainty) / effort. Each has an expected effect on the apricot flight, how it is verified,
and what it must not change (the rules that came from Yunus's eye tests).

### A. Use the preview DJI already wrote (the largest cheap win)
Every DJI JPEG of this flight carries, after the main image, a **960 × 640 preview** (Multi-Picture Format
APP2, 250 KB, 5.7 cm/px at 36 m), plus the usual 160 × 120 EXIF thumbnail. Checked on all 71 files
(`DJI_0301`: main SOF at byte 29,131, preview SOF at 8,509,800). Decoding the preview costs about 5 ms
against 400 ms (browser) or 1,350 ms (jpeg-js) for the full frame. Verified by eye: trees, rows, weeds and
alleys are clear at 5.7 cm.
- Rows and trees: the fitter's raster is 8 cm cells already; the preview is enough. Evidence raster at 25 cm:
  enough. Green patches for vegetation: enough (patches under 0.1 m² are dropped anyway).
- Soil ties: the fine windows run at 4 cm today. At 5.7 cm the window is 2.56 m / 5.7 cm = 45 px; use 64 px
  windows of 3.65 m instead. Expected precision loss: small (the peak is parabolic-interpolated); to be
  measured against the 7 cm held-out figure. If it costs more than 2 cm, keep the quarter for ties only.
- Full decodes remain only for the weed model (which needs the pixels) and the evidence crops.
- Fallback: a photograph without an MPF preview (other makers, some models) is decoded at the smallest size
  the decoder offers; the browser's `createImageBitmap(blob, {resizeWidth})` is the path there (it still pays
  the full decode, so a no-MPF flight keeps today's cost on this stage).
- Where it is (verified in the bytes of DJI_0301): APP2 `MPF\0` at byte 28,817, inside the first megabyte the
  builder already reads; its index points at the preview at byte 8,509,664, 252,097 bytes, ending at the end of
  the file. The ratio 5472/960 = 3648/640 = 5.7 exactly, so the camera's uniform-rescale guard passes.
- Consequences to handle, not to skip: the build's `down` is one integer for the whole build today; it becomes a
  per-photograph ratio measured as `intrinsics.width / preview.width`. The fitter's raster cell is
  `round(0.08 / mpp)`: at 5.6 cm pixels that rounds to one pixel, so the raster becomes finer (614k cells) rather
  than coarser; decide the rounding rule and measure. The reader's metre thresholds are unchanged but the pixel
  counts they turn into move, so the trees and rows are checked within tolerance, not for identity. The tie
  windows go to 5.7 cm pixels with `maxBackM` scaled with the resolution (today 2 cm is half a pixel). The
  preview's in-camera sharpening is unknown: the ties' rejection counts (collected and discarded today) are
  reported so a texture-gate shift is visible.
- Expected: photographs 96 s → about 3 s (jpeg-js decodes the 0.6 MP preview in 40 ms, the browser in 5);
  rows 94 s → about 12 s of real reading (less with M); evidence 60 s → under 5 s.

### B. Fix the Node decode cache and stop decoding twice in the browser
`nodePhotos.ts:28` decodes in full before checking the cache. Fix: check first. In the browser, decode the
original once per photograph in the atlas stage only (already so), and never for `decode(4)` once A is in.
Also drop the quarter-JPEG re-encode in `browserPhotos.ts` (no longer needed with the preview).

### C0. The service does a third less work for the same twin (one afternoon)
- Ask for `geometry: "lite"` and take the span from the thinned polygon client-side (`max_span_px` is the
  only full-geometry field the twin reads). Geometry is 31 % of the service time on this flight, but "lite" still
  traces contours and skips only the hull measures (8 % in the service's own profile): the saving is between 8
  and 31 % and is measured with one call before it is counted.
- Send the photograph at half size (2736 × 1824, a 2 MB JPEG from a half decode or a `createImageBitmap`
  resize) with 512 px tiles: the model's input is the same ground at the same 2 cm (it shrinks 1024 → 504 today),
  the upload is 4 × smaller, the service decode 4 × faster, the two 80 MB label rasters 4 × smaller. Not
  identical in detail (a different resampling chain, masks at half resolution, the tiny-instance flags), so it is
  measured on DJI_0301's labels through the service's `/evaluate` first, with `scale: 0.5` and the full upload as
  the intermediate step the service already supports.
- Tile overlap 128 instead of 256 (the service's own default): 24 tiles instead of 35, **minus 31 %** of the
  forward passes. The fusion already merges across overlaps; check on DJI_0301's labels that nothing at tile
  seams is lost.
- Cache detections per photograph (hash of the file bytes + settings) in the service and in the builder: a
  rebuild, another run with other settings, or a cancelled build never pays twice. Today nothing is cached.
- Batch 4 tiles per forward pass: measured only 4 % on this GPU; skip unless the CPU path shows more.
- Together: about 8.4 s → about 4 s per photograph on the GPU before any pruning.

### C. Run the weed model on the ground that needs it, not on every tile
Measured on this flight: with the two nearest-nadir views kept per 2 m ground cell, only **39 %** of the
photographed ground is needed (median 4 views per cell today). Verification needs two views; the third and
later views add only "seen in N of M" counts. Tile pruning by vegetation does not help here (97 % of tiles hold
a detection or a crown), so the saving is in views, not in tiles' content.
- Rule: for each ground cell pick the two photographs whose nadir is nearest; a tile is run only if some cell it
  covers picked its photograph. On this flight that is about 1,000 of 2,485 tiles: 2.5 × fewer model runs.
- **The catch, measured:** a weed is detected in only half the views that cover it (repeatability median 0.5 in
  the m1 report). With exactly two views run, "seen twice" becomes roughly a one-in-three event where four views
  gave three-in-four, so the verified count would fall well below today's 4,410 (plausibly near 2,500). Two
  consequences: a **mandatory third pass** runs the third-nearest view's tiles wherever exactly one view saw a
  plant (few tiles, since detections cluster), and the twin reports `runBy` (views actually run over that
  ground, from the run tiles projected to the ground) beside `coveredBy`, so "seen in N of M" stays honest.
  The acceptance test is the twin-level verified count against 4,410, not the per-photo label recall, which
  cannot see this.
- The service accepts no tile list today: `/detect` gets `algorithm, scale, tile, overlap, threshold,
  include_crop, polygon_tolerance, geometry`. Add a `tiles` field (origins at processing scale, validated
  against the service's own tile plan) and an `origins` filter in the RF-DETR loop; fusion and extraction are
  untouched; the answer records `tiles_run`.
- Expected with C0: 10 min → about 2 to 3 min on the GPU for the flight; on a CPU 4 h → about 1 h.

### D. A smaller model where the field allows it, and a colour pass first
- RF-DETR Seg sizes (Roboflow, T4 FP16): Nano 312 px 3.4 ms, Small 384 px 4.4 ms, Medium 432 px 5.9 ms,
  Large 504 px 8.8 ms, 33.6 to 36.2 M parameters. Large is 2.6 × Nano. Intel publishes INT8 OpenVINO builds of
  the Seg models (Small, Medium, Large, XL), made with NNCF post-training quantisation, for CPU use.
- On a bare-soil orchard the colour rules find most of what the model finds: on DJI_0301 (414 labelled weeds)
  the ExGR green patches hit 219 labels and RF-DETR 288; 238 of RF-DETR's 481 weeds coincide with a green patch
  within 0.6 m. So a colour-first pass (green patches between the rows, outside the crowns, from the preview)
  gives a usable weed map in seconds, and the model is a second pass run only on tiles whose green is
  ambiguous (near crowns, small, or in shadow), or on request.
- Proposed tiers, the operator chooses and the twin says which ran: (1) colour only, seconds, every device;
  (2) colour + Seg-Nano INT8 on CPU on the needed tiles; (3) Seg-Large on the GPU on the needed tiles (today's
  quality). Measure each tier against the DJI_0301 labels before shipping.
- Browser: RF-DETR Nano runs in the browser through onnxruntime-web (a public WebGPU demo exists); a CPU WASM
  path with SIMD and threads is the fallback. Not for Large.

### E. Soil ties: do a fifth of the work for the same ties
1. Project each footprint ring once per pair (the 16-vertex ring is re-projected in every point test: 100,000
   allocations per pair) and test the 1 m overlap grid against the two pre-projected rings; or replace the grid
   with the polygon intersection of the two footprints.
2. Resample each window of A once and cache its spectrum. A's window lattice is anchored to A's own footprint
   (the pair origin cancels), so it repeats across the pairs where the photograph is the first of the pair:
   about half of its 18 pairs, within one tie round. B's windows sit at A's lattice plus the found shift and never
   repeat. The cache lives per A while its pairs run (pairs are already emitted grouped by the first photograph),
   keyed by lattice index, at most about 48 MB, cleared when A changes. Results agree to about 1e-9 m, not to the
   bit (the homography is built per pair). Also: A's spectrum is computed twice per window today (forward and
   back-check); split `phaseCorrelate` into `spectrum` and `correlate`, bit-identical.
3. Real-to-complex FFT (two real transforms per complex one) and a precomputed twiddle table; `fft2` without
   the per-call allocations; `Math.sqrt` for `Math.hypot`.
4. Then a WASM FFT (pffft-ng, SIMD, BSD) if the JS one is still the top line; a WebGPU FFT only if ever needed.
5. Skip the second tie round when the first fit already brings ties under 10 cm (it is the same windows).
- Honest accounting per fine window today: 3 resamplings, 4 forward and 2 inverse 64² FFTs. After 1 to 3: about 2
  resamplings plus an amortised A, 3 forward and 2 inverse, no allocations, no ring tests: about 2.5 to 3 × on the
  ties, not a fifth. (The profile over 24 photographs: fft1 4.5 s, sampleWindow 4.5 s, phaseCorrelate 1.7 s,
  pointInFootprint 1.2 s, garbage collection 5.7 s.)
- Expected: cameras 63 s → about 25 to 30 s after E1 to E3 and F; under 15 s only with the WASM FFT (E4).

### F. The solver: analytic derivatives and one rotation per frame
- Cache the camera-to-world rotation (and its boresight product) per frame per residual evaluation; today
  `enuFromCamera` is rebuilt per projection (6 trig calls, 8 allocations).
- When a per-photo parameter is perturbed, recompute only that photograph's end of each tie.
- Analytic Jacobian of the flat-plane projection, tractable: the pixel ray depends on no fitted parameter; the
  ground point is `C + t·d` with `d = R(angles)·r`, `t = (g − alt) / d_z`; `∂P/∂dE = (1,0)`, `∂P/∂dN = (0,1)`,
  `∂P/∂g = d_xy / d_z`, and for each angle `d' = R'·r` with one rotation factor replaced by its derivative,
  `∂P_xy/∂θ = t·d'_xy − t·d'_z·d_xy / d_z`. A photo's parameters enter only its end of a tie, the four globals
  both ends. About five extra 3 × 3 products per tie end per iteration against 14 full residual passes today:
  an order of magnitude on the fit. The terrain (surface-ground) model stays on finite differences (not used by
  the twin). A different Jacobian changes the Levenberg-Marquardt path, so the fit agrees within tolerance, not
  to the bit: the finite-difference path stays as the test oracle (`opts.jacobian: "analytic" | "numeric"`).
- The Schur complement is not worth it at this size: the dense 359-parameter Cholesky is milliseconds.
- Expected: the three fits from about 10 to 20 s to about 1 s analytic (3 to 5 s with only the cache and the
  one-end rule).

### G. Projection, once and lean
`pixelToGround` and `groundToPixel` with a per-frame cached rotation, no per-call allocations (write into
caller-provided arrays), and a plane-only fast path. Every stage benefits (evidence 550,000 calls,
reconciliation, the solver, the ties). Keep the general surface path for the terrain option.

### H. Atlases on demand, not on build
15,829 crops are cut and 49 atlases encoded for every twin, yet an operator opens perhaps fifty of them.
- Keep the atlases but build them lazily: the twin opens without them (the inspector fetches "evidence
  pending"), and the atlases are cut in the background after the twin is open, in the worker, from the
  photographs still in memory, and saved when done. The operator sees the field in a third of the time.
- Or cut crops on demand from the photographs kept on the device (the file handle API) and never ship atlases
  at all for a locally built twin. Ship atlases only when a twin is saved to the account.
- Encode with the browser's native JPEG encoder (`convertToBlob`) in the browser, and in Node only through
  jpeg-js when a script asks.

### I. Parallelism: the flight has 8 cores waiting
Everything runs on one worker today. The photographs, the ties (per pair), the per-photo row reads, the weed
tiles and the evidence sampling are embarrassingly parallel.
- A pool of `navigator.hardwareConcurrency - 1` workers with a small task queue; the main worker keeps the
  state and hands out photographs (decode + patches + grey), pairs (ties), photographs (row reads), photographs
  (evidence cells). Transfer typed arrays, never copy.
- Expected on a 4-core laptop: about 3 × on the parallel stages; the fits stay serial (they are small after F).

### J. Process while the flight lands
The pipeline is incremental by nature: a photograph's header, preview, patches, grey and row read depend on it
alone; ties depend on a pair; the fit and reconciliation on the set. A folder watcher (or the SD card mounted)
can run stages 1 to 3 per photograph as the files arrive and run the fit, reconciliation and the block when the
flight is complete, so the twin is ready a minute after landing rather than ten minutes later. Browser: the File
System Access API for a chosen folder; Node: a watcher. The real-time bundle-adjustment literature (DLR, 2025)
does the same with navigation-predicted pairs and a sliding window; our pairs are already navigation-predicted
(camera centres within 45 m).

### K. Fly less: the flight carries 2.4 × more views than the twin uses
The median ground cell is seen 4 times; verification needs 2. Halving the forward overlap (the legs stay) keeps
about 2 views per cell on the straight legs, halves the photographs, the flight time and every stage's cost. The
ties need overlap too, but far less than 80 %: a 30 % overlap band between neighbours is 10 m wide and holds 5
tie windows across. Test on this flight by dropping every second photograph on each leg (an offline experiment,
no new flight): if the twin's verified weeds, trees and block hold within a few percent, the planner's default
for a twin flight becomes 60 / 70 instead of 80 / 80. This is the farmer's biggest saving of all: half the
battery, half the time in the field, half the data.

### L. Opening and transfer
Measured: twin.json 8.97 MB (gzip 1.73 MB, brotli 1.15 MB); the weeds are 8.2 MB of it: rings 2.88 MB (120,505
7-decimal lat/lng points), evidence entries 2.8 MB (194,876 outline points in crops plus per-crop fields),
measurements 2.5 MB. Opening computes for 120 ms; the bytes are the cost (14 s at 5 Mbit/s).
- Brotli or gzip at rest in the account's storage, served compressed (nothing compresses today in `store.ts`).
- Rings as centimetre integer offsets from the weed's centre: about 4 × smaller than 7-decimal pairs.
- Evidence entries into a sidecar loaded when the inspector first opens (with H).
- `loadAtlas` fetches a 1.1 MB atlas for one crop: range requests or smaller atlases (6 × 6 cells).
- Expected: the twin opens in 2 to 3 s on a 5 Mbit/s link instead of 14.

### M. The row reader and the fitter (measured: about 12 s of real compute for 94 reads)
- Ten full passes over the quarter image per read: the three masks (vegetation, shadow, cover, the first and
  third computing the same ExGR), four pooling passes in `rasterFromMask`, the vegetation mask again in
  `plantsOfPixels`, the component scan. Fuse into one RGBA pass (ExGR once, both masks, luma) and one pool pass:
  about 40 ms per read saved.
- Keep the pass-1 raster and candidate blobs for the 23 photographs that come back in pass 2 (the size share is
  applied after the candidates): the second read becomes milliseconds.
- `fitLayoutAll` (32 to 83 ms, about 4 s for the flight): `basis()` recomputed in every `latticePoint` (250,000
  calls in `subdividedLattices`), string keys split back with `split(",")`, five array literals per pixel in
  `canopyOf`, a 2.5 MB integral image allocated per `boxMean` (16 to 18 raster passes, 30 MB of garbage per fit).
  Cache the basis per lattice, integer keys, a reusable integral buffer, `GFgreen` cached per raster: 4 s → about
  1.5 s. None of this changes a rule: the fitter's decisions stay bit-identical (checked by the existing tests).
- `joinPieces` sizes its grid cell by the largest piece: on a wheat frame the grid collapses and the join goes
  quadratic (2.4 → 11 ms here; a risk on weedy frames with thousands of specks). Cap the cell.
- `stackScore` calls `toEnu` inside 201 angles × 1,054 trees: compute east/north once.

### N. Small things that add up
- `vegetationMask` is cut twice per photograph (objects and grey raster): once.
- `reconcile`: string keys for the hash grid and union-find; integer keys. Not a hotspot today (1 s), but it
  scales with weeds.
- Evidence sampling tests every cell against every footprint: bucket the footprints (as `pressureGrid` already
  does) and project with the cached rotation.
- The build holds 178 MB of grey and green masks for the whole flight; with the preview that is 37 MB.

## Part 3b: what must not change
- The planting-layout rules from the eye tests: the pattern is the proof, no automatic empties, marks hold the
  lattice, moveGain 2, one straight line per row. Speed changes to the fitter are bit-identical or not made.
- The twin's visual rules: full weed polygons, one canvas, no satellite, no dots or heatmaps in place of
  outlines.
- The boundary's rule: never an operational limit until accepted.
- Decision support, not prescriptions; "treated area", never a product rate.
- Every tier and every pruning rule is written into the bundle (`source.weedModel`, `stats.weedViews`), so a
  twin never claims more than it did.

## Part 4: what a farmer gets from each tier

| Device | Today | After A, B, E, F, G, I (pipeline) + C0 (service) | With C (needed views) and D (colour-first, Nano) | With K (half the photographs) |
|---|---|---|---|---|
| Desktop with GPU (this machine) | 6.5 min + 10 min model | about 1.5 min + 5 min | 1.5 min + 2 min (Large) | under 1 min + 1 min |
| 4-core laptop, no GPU (in the truck) | 6.5 min + 4 h | about 2 min + 2 h | 2 min + 0 (colour only) or 2 min + 20 to 40 min (Nano INT8 CPU, to be measured) | about 1 min + 10 to 20 min |
| Phone / tablet | not possible | borderline | colour only: a few minutes | colour only: about 2 min |

Numbers after "about" are estimates from the measured stage times and the measured factors (preview decode
5 ms against 400 to 1,350 ms; 39 % of ground needed; FFT work per window); they are to be re-measured after
each step, not promised.

## Part 5: the order of work, and how each step is checked

The target is the laptop without a GPU, so the order puts the pipeline wins and the colour-first tier before
the service work; the service steps (C0, C) still come early because they also serve the GPU desktop today and
every tier that uses a model.

### Step 1a: bit-identical speed (B + G + two refactors that A needs)
- `scripts/directGeoref/nodePhotos.ts`: the full decode runs before the cache is checked; check first. Node rows
  94 s → about 2 s and evidence 60 s → about 3 s with no change in results.
- `src/lib/directGeoref/projection.ts`: `rotationOf(pose)` through a `WeakMap<CameraPose, M3>` (poses are
  immutable and new per model evaluation, so the cache invalidates itself; document that no one mutates a pose
  in place); used in `worldRay` and `groundToPixel`; the flat path of `pixelToGround` without the closure and the
  temporaries. Test beside the projection round-trip tests: the cached rotation equals `enuFromCamera`.
- `src/lib/fieldTwin/build/bundle.ts`: the evidence sampling box from the real pixel size (today a hard-coded
  quarter GSD; identical on this flight). `rows.ts`: `down` derived per photograph from
  `intrinsics.width / px.width` (the `dn` the evidence stage already computes).
- Proof: `buildTwinApp.ts --weeds saved` and a diff of `twin.json` against
  `data/direct-georef/twin-app/apricot-app/twin.json` ignoring only `builtAt`: byte-identical (the raw camera
  globals are in the stats, so this proves the cameras too).

### Step 1b: the preview (A), checked within tolerance
- New `src/lib/directGeoref/mpf.ts`: `mpfPreview(head)` walks the JPEG segments (as `photoScout/exif.ts` does),
  finds APP2 `MPF\0`, reads the little-endian TIFF index (tag 0xB002 entries: size and offset relative to the MP
  header), returns the largest non-primary entry. Test: a synthetic header, plus DJI_0301 → offset 8,509,664,
  size 252,097, decoding to 960 × 640 when the flight is present.
- `build/types.ts`: `PhotoSource.preview(): Promise<PhotoPixels | null>`; `PhotoRead.down` is the measured
  ratio. `nodePhotos.ts`: a tail read (`openSync` + `readSync` at the offset), cache the 250 KB bytes.
  `browserPhotos.ts`: `file.slice(offset, offset + size)` → `createImageBitmap` → `toPixels`; drop the
  quarter-JPEG re-encode; `createImageBitmap(file, { resizeWidth })` as the no-MPF fallback.
- `photos.ts`: `px = (await p.preview()) ?? (await p.decode(down))`, `d = meta.width / px.width` into
  `vegetationObjects` and the grey raster. `pipeline.ts`: `pixels()` the same. `rows.ts`: the k rule, with the
  cell size written into the report. `cameras.ts`: `fineRes = max(0.04, median raster mpp)` and
  `maxBackM = 0.5 · fineRes` into `findSoilTies`; the rejection counts into the report.
- A held-out measure the app can report: `BuildOptions.holdOutPairs` (default 0, so the shipped twin is
  unchanged) using the deterministic pair hash of `scripts/directGeoref/common.ts` moved into `src`, reported as
  `cameras.heldOutResidualM`. Record the baseline on today's code first (the scripts' "7 cm" was measured on the
  scripts' own quarter frames, not through the app).
- Tests: `fieldTwinBuild.test.ts` with a fake PhotoSource whose preview is 96 × 64 under a 5472-wide header
  (`down` 57, objects in original pixels) and a no-MPF source; the 8-photograph flight test keeps its tolerant
  thresholds.
- Proof (tolerance): trees 1,054 ± 1 %, kept rows 14 exactly, verified weeds 4,410 ± 1 % (they come from the
  saved answers; only the cameras move them), vegetation 204 ± 10 %, block 1.338 ha ± 1 %, training residual
  0.064 m ± 0.01, held-out within 1 cm of the baseline, median tree shift (nearest within 0.3 m) under 3 cm.

### Step 2: ties and solver (E + F)
- E1 `soilTies.ts`: project both rings once per pair and test the overlap grid against the projected rings
  (today the 16-vertex ring is re-projected per point); tie list equal.
- E2 `fft.ts`: `spectrum` / `correlate`, `phaseCorrelate` as their composition (its tests in
  `directGeoref.test.ts` unchanged); `soilTies.ts` computes A's spectrum once per window; the per-A window cache
  passed from `cameras.ts`, cleared on A change.
- E3: scratch buffers in `fft2`, `phaseCorrelate` and `sampleWindow`, the homography inlined; bit-identical.
  Real-to-complex and the WASM FFT after measuring, not in this step. Skipping the second tie round is not in
  this step either (it changes the fit's input).
- F `adjust.ts`: (i) a per-end residual cache with a side-aware `byPhoto`, so a photo parameter reprojects only
  that photograph's end (bit-identical); (ii) `tieJacobian` for the flat-ground specs behind
  `opts.jacobian: "analytic" | "numeric"`, numeric kept as the oracle. Tests: extend "block adjustment over pixel
  ties" with analytic-against-central-difference agreement (1e-4 relative) and both existing cases under both
  modes agreeing to 1e-6 deg and 1e-5 m.
- Proof: with numeric the twin is byte-identical to step 1's; with analytic the globals within 1e-5, the
  residual within 1e-4 m, counts within 2. Cameras stage 25 to 30 s.

### Step 3: the weed tiers and the service (D tier 1, C0, C)
- D tier 1, colour-first, in `build/weeds.ts`: green patches from the preview between the rows and outside the
  crowns become weed observations (the reconciliation and classes unchanged), the bundle's `source.weedModel`
  says "colour rules"; measured against DJI_0301's 414 labels (today 219 by the patches, 288 by the model) and
  shown in the builder as the tier that needs no model.
- C0, client: `worker.ts` defaults `geometry: "lite"`, `overlap: 128`; `observationsOf` takes the span from
  the largest polygon when `max_span_px` is null; `weeds.ts` and `bundle.ts` take the settings from the answer's
  `processing` instead of hard-coding 1024/256/full. Scale: first `scale: 0.5, tile: 512, overlap: 64` with the
  full upload (the service rescales and maps back already), measured on DJI_0301 through `/evaluate`; then the
  half-size upload. A builder-side detection cache keyed by sha256(bytes) + settings (Node: a data folder;
  browser: IndexedDB).
- C: `build/views.ts` (`chooseViews`, a TypeScript `planTiles`, `tilesFor`); `WeedDetector` gains a tile
  request; `client.ts` a `tiles` field; the service's `parse_params` and `infer_rfdetr(origins=)` with a test in
  the lab's `tests/test_service.py`; `reconcile` gains `coverRings` (the run tiles on the ground) and the twin
  `runBy`; the mandatory third-view pass; `stats.weedViews` records the rule and the tiles run.
- Proof: per-photo recall on DJI_0301 unchanged on the tiles run; the twin-level verified count against 4,410
  reported honestly, choosing two or three views from the measurement; the bundle says which tier and rule ran.

### Steps 4 to 8
4. H + L (atlases after the twin opens, brotli at rest, centimetre rings, evidence sidecar). Check:
   `twinOpenBench.mjs` bytes to first frame.
5. I (worker pool). Check: wall time on a 4-core laptop; identical twin (the stages are deterministic).
6. K (the flight experiment offline): every second photograph dropped; report the twin's differences; if they
   hold, the planner's "twin flight" preset.
7. D tiers 2 and 3 (Seg-Nano INT8 on the CPU through OpenVINO or onnxruntime, Nano in the browser through
   onnxruntime-web): experiments after the above, each measured on the labels before it is offered.
8. J (process while the flight lands) last: product work on top of a pipeline that is already fast.
9. M and N as they come, each bit-identical by the existing tests (the fitter's decisions must not change).

Every step keeps the rules that came from the eye tests: the planting-layout rules (pattern is proof, no
automatic empties, marks hold the lattice), the twin's visual rules (no dots or heatmaps in place of polygons,
one canvas, no satellite), the boundary's rules (never an operational limit until accepted), and "decision
support, not prescriptions".

## Sources

- RF-DETR segmentation sizes and latencies: https://rfdetr.roboflow.com/latest/learn/run/segmentation/ ;
  ONNX export: https://rfdetr.roboflow.com/latest/learn/export/ ; Intel INT8 OpenVINO builds, e.g.
  https://huggingface.co/OpenVINO/rfdetr_seg_small-int8-ov ; in-browser Nano demo
  https://huggingface.co/spaces/webml-community/RF-DETR-WebGPU
- ONNX Runtime Web WebGPU / WASM SIMD + threads: https://opensource.microsoft.com/blog/?p=88005 ,
  https://img.ly/blog/browser-background-removal-using-onnx-runtime-webgpu/
- libjpeg-turbo IDCT scaling (1/2, 1/4, 1/8 SIMD paths): https://bugzilla.mozilla.org/show_bug.cgi?id=2033250 ;
  WebCodecs ImageDecoder desiredWidth: https://developer.mozilla.org/en-US/docs/Web/API/ImageDecoder/ImageDecoder
- Multi-Picture Format previews (ExifTool MPF): https://unpkg.com/exiftool-vendored.pl@10.50.0/bin/html/TagNames/MPF.html
- WASM FFTs: pffft.wasm https://0110.be/posts/pffft.wasm%3A_an_FFT_library_for_the_web , pffft-ng
  https://libraries.io/npm/pffft-ng ; WebGPU FFT https://github.com/AICL-Lab/gpu-fft
- Real-time bundle adjustment on full-resolution UAV images, CPU only, navigation-predicted pairs and a sliding
  window: https://arxiv.org/abs/2511.06152
- Direct georeferencing of single images for weed mapping (Agroscope, Stoop et al. 2024, < 0.82 m at 30 m with
  RTK, no feature matching): https://ira.agroscope.ch/en-US/publication/59424
- Offline in-field processing as the answer to rural connectivity (Pix4Dfields field test):
  https://www.pix4d.com/blog/input-savings-mavic-3-m

## Progress (2026-10-28, same day)

### Step 1a, done: bit-identical
Rotation cached per pose (`rotationOf`), the Node photo source's cache checked before the decode, the evidence
box from the real pixel size, the decode ratio per photograph. The apricot twin was byte-identical (only the
boundary's own `processingMs` differed). Node build 387 s → 199 s: rows 94 → 14 s, evidence 60 → 0.5 s.

### Step 1b, done: the camera's preview, checked with 30 % of the pairs held out
`src/lib/directGeoref/mpf.ts` reads the MPF index; `PhotoSource.preview()` slices the tail of the file; the fine
tie window follows the raster (5.6 cm on the preview, `maxBackM` half a sample); `cameras.heldOutResidualM` and
the rejection counts are reported; `BuildOptions.usePreview`, `holdOutShare`, `rowRasterCellM`.

| 30 % of pairs held out | Quarter decode (before) | Preview, fitter cell 1 px (5.6 cm) | Preview, fitter cell 2 px (11.2 cm) |
|---|---|---|---|
| Held-out tie residual | 7.58 cm (4,296 ties) | 7.53 cm (3,083 ties) | 7.53 cm |
| Training residual | 6.55 cm | 6.48 cm | 6.48 cm |
| Observed trees | 1,031 | 1,003 (−2.7 %) | 1,029 (−0.2 %) |
| Rows kept | 14 | 14 | 14 |
| Verified weeds | 4,384 | 4,415 | 4,367 (−0.4 %) |
| Other vegetation | 204 | 179 | 176 (−14 %: patches near the 0.1 m² floor at 5.7 cm) |
| Block | 1.340 ha | 1.385 ha | 1.373 ha (+2.5 %) |
| Photographs stage | 62 s | 3.2 s | 3.2 s |
| Rows stage | 8.3 s | 8.8 s | 4.7 s |

The preview's ties are as good as the quarter decode's (held-out 7.5 cm either way) with 30 % fewer of them. The
fitter's raster cell is now the whole number of preview pixels nearest 8 cm in ratio (two: 11.2 cm), which keeps
the tree count; one pixel (finer than today) changed it by 3 %. The block moved 2.5 %, more than the 1 %
tolerance asked for: the evidence classes are sampled from 5.6 cm pixels (a 5 × 5 box per quarter-metre cell
instead of 7 × 7 of 3.9 cm) and the trees differ; which is nearer the truth needs the eye test, and the operator
corrects the boundary either way. Noted, not hidden.

### Step 2, done: ties and the solver
E1 both rings projected once per pair; E2 `spectrum` / `correlate` with A's spectrum computed once and a window
memo per first photograph (`windowCacheFor`, cleared when the photograph changes); E3 the homography inlined in
the window sampler, scratch rows in `fft2`, scratch in `correlate`; F(i) the per-end residual: a photo parameter
re-projects only its own end of each tie (bit-identical). Cameras 41 s → 24.5 s on the preview; held-out
residual 7.55 cm (unchanged). Tiny tie differences from the memo (1e-9 m) moved the cameras at the fourth
decimal and the fitter followed: trees 1,029 → 1,014, block 1.373 → 1.317 ha. **The twin's tree and block counts
swing by about 2 % and 4 % between equivalent camera solutions: a sensitivity of the planting-layout fitter and
the boundary probes, not of the cameras (ties agree to the millimetre).** Worth its own look later.

Not yet done from step 2: the analytic Jacobian (F ii), the real-to-complex FFT and the WASM FFT (E3/E4).

Node build after steps 1 and 2 (71 photographs, saved weed answers): about 110 s with the hold-out, of which the
atlases are 75 s (step 4, H) and the cameras 25 s.

### The shipped build after steps 1 and 2 (no hold-out)
1,037 trees, **13 rows kept of 21** (the 13 orchard rows; the hedge along the track, kept as "row 1" with 18
hedge trees by the quarter decode and excluded again by the boundary engine, is no longer read as a row at
all), 4,426 verified weeds of 9,593 objects, 176 vegetation patches, block 1.320 ha, ties agree to 6.2 cm.
124 s in Node: photographs 6.5 s, cameras 32 s, rows 5 s, weeds 1 s, atlases 79 s, evidence 0.5 s. The
atlases are now two thirds of the build (step 4).

### Step 4 (H + L), done in part: the twin opens before its atlases, twin.json gzipped at rest
- `assembleBundle` now places every evidence crop in its atlas when the twin is assembled (the entries are
  identical to before) and hands back `cutAtlases()`, a generator that cuts the pixels one atlas at a time. The
  worker posts the twin as soon as it is complete and the atlases as they come; the page opens the twin at once
  (an inspector crop whose atlas is still being cut waits for it), shows "Cutting the evidence crops in the
  background: n of m atlases", and saves to the account when all are in. In the browser the operator sees the
  field about 80 s earlier on this flight (the atlases were two thirds of the build). Node and the tests keep
  cutting at once; the test proves the two paths give the same evidence entries and the same atlas bytes.
- `store.ts` uploads twin.json gzipped as `twin.json.gz` (about five times smaller) and reads either form; older
  twins in an account still open. Not done from L: centimetre rings, the evidence sidecar, smaller atlases.

### Step 3, done and measured: the weed tiers, the service defaults, and two findings that change the plan

**D tier 1, the colour rules** (`colourObservations` in `build/weeds.ts`, `weedTier: "colour"`, a radio in the
builder, the twin says `source.weedModel: colour rules…` and the status strip warns). Against DJI_0301's 414
hand-labelled weeds, twin-level, verified candidates within 0.6 m:

| Tier | Labelled weeds found by a verified candidate | by any candidate | Verified in the twin | Weed stage |
|---|---|---|---|---|
| Seg-Large, every tile (the saved answers) | 239 (58 %) | 275 | 4,426 | 10 min on the GPU |
| Colour rules on the quarter decode | 149 (36 %) | 181 | 3,596 | 78 s in Node (the decodes); about 30 s in a browser |
| Colour rules on the 960 × 640 preview | 63 (15 %) | 84 | 1,421 | 1 s |

The colour tier is the default for a computer without the service, on the quarter decode (the preview is too
coarse for weeds under 20 cm). It finds 62 % of what the model finds, in seconds, and the twin says so.

**C0 in the client**: the worker asks for `geometry: "lite"` and the service's own 128 px overlap (24 tiles
instead of 35), takes the span from the outline when the answer has none, records the settings the answer
reports, and caches answers in IndexedDB by the photograph's digest and the settings (Node: a folder). The
service-side half-size upload is not done; it needs the service running to measure.

**C, measured, and not switched on.** The tile list is implemented on both sides (`tiles` form field →
`infer_rfdetr(tiles=)`, `processing.tiles_run`; `views.ts` plans tiles as the service does and chooses each 2 m
cell's nearest views; a third pass looks again where one view alone saw a plant; `runBy` beside `coveredBy`;
tests on both sides). Emulated on the saved answers (an instance counts as found when its centroid lies in a
requested tile):

| Rule | Tiles run of 2,485 | Verified weeds | Labelled weeds found (verified) |
|---|---|---|---|
| Every tile | 2,485 | 4,426 | 239 |
| 2 nearest views + third pass | 1,724 + 563 = 2,287 (92 %) | 4,360 | 239 |
| 3 nearest views + third pass | 1,937 + 421 = 2,358 (95 %) | 4,387 | 239 |

A 1024 px tile covers 10 m of ground; with 2 m cells almost every tile holds some cell whose nearest views include
that photograph, so pruning by views saves 5 to 8 % of the tiles, and the third pass gives most of it back. The
39 % figure in Part 3 was per ground cell, not per tile. The mechanism stays (it is right at 512 px tiles or for a
sparser flight) but `views` defaults to 0 (every tile).

**K, measured offline, and the answer is no.** Every second photograph dropped from the whole build (36 of 71,
30 % of pairs held out):

| | 71 photographs | 36 photographs |
|---|---|---|
| Soil ties (train) | 7,353 in 478 pairs | 1,375 in 111 pairs |
| Held-out tie residual | 7.5 cm | **28.6 cm** |
| Observed trees | 1,014 to 1,037 | 771 |
| Verified weeds | 4,360 to 4,426 | 2,576 |
| Labelled weeds found (verified) | 239 | 143 |
| Block | 1.32 ha, 90 to 95 % photographed edges | 1.25 ha, 77 % |

And the model on every second photograph only, the rest of the build on all 71: verified 2,961, labelled weeds
found 204 (any sighting 263). The flight's overlap is not excess for this method: the soil ties need the
neighbouring legs, the trees need their four views, and a weed is seen in only half the views that cover it. The
planner keeps 80 / 80 for a twin flight. The farmer's saving is in the processing, not in the flight.

### Where the Node build stands (71 photographs, saved answers, every stage)
About 110 to 125 s: photographs 3 to 6 s, cameras 25 to 32 s, rows 5 s, weeds 1 s (10 min on the GPU, or 78 s
colour), atlases 75 to 79 s (now after the twin opens in the browser), evidence 0.5 s. From 387 s plus 10 min.
