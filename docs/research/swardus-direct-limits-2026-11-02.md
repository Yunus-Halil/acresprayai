# Swardus Direct: the limits of the no-orthomosaic pipeline as it stands (2026-11-02)

Brief (Yunus): since Swardus Direct is not an orthomosaic its limits are unclear; find out how many photographs it
works with, the processing time, and every other limit worth knowing. This is read from the code
(`src/lib/fieldTwin/build/`, `src/lib/directGeoref/`), the recorded runs (`data/direct-georef/`), the documents
(`docs/features/direct-photo-georeferencing*.md`, `field-twin-builder.md`, `swardus-direct-milestones.md`,
`docs/research/swardus-direct-speed-plan-2026-10-28.md`) and new runs made today on the 71-photograph apricot flight
(`C:\Users\Yunus\Desktop\High-Resolution UAV Datasets for Agricultural Comp\TreeCrownsDb\Apricot\images`, Phantom 4
RTK, 36 m, 5472 × 3648). Each limit says where it comes from: **code** (a constant or a refusal in the source),
**measured** (a run), **derived** (arithmetic from the code and a measurement), **untested** (nothing has been tried).

## 1. What a flight must be

| Limit | Value | Basis |
|---|---|---|
| Header | Every photograph needs a camera position, `RelativeAltitude` and gimbal yaw and pitch in its DJI XMP; without them the photograph is refused with the reason, and under two readable photographs the whole build stops | code, `photos.ts`, `pipeline.ts` |
| So: the corn sets | All 91 corn photographs in `directtestimagery` have no EXIF at all: Direct cannot be run on them. The no-GPS placement was built and removed on 2026-10-30 (GPS is a given) | measured, `getexif()` empty on every set |
| Camera | Only the Phantom 4 RTK (FC6310R, in-camera dewarp, `DewarpFlag 1`) has ever been through it. The model handles Brown distortion from `DewarpData` when a camera writes it; a camera that writes neither is treated as a pinhole | code, `frame.ts`; untested on any other body |
| Preview | The 3 s photograph stage depends on DJI's 960 × 640 MPF preview inside the JPEG. A file without one falls back to a full decode (about 0.4 s in the browser, 1.35 s in Node, per photograph) | code, `mpf.ts`, `browserPhotos.ts`; measured on DJI only |
| TIFF and multispectral | Accepted (RGB TIFF; P4 Multispectral band sets), never run on a real set; the band-shift sign is unverified | code, `tiffPhotos.ts`; untested |
| Positioning | RTK was flown. Without RTK the photographs still agree with each other to 6 cm after the ties, but the whole block sits off by the GPS's mean error (metres) and its shape by a fifth to a third of the random error; a photograph more than about 10 m off its true place never ties (the coarse search reaches ±10 m: a 128-cell window at 16 cm) | measured, experiment 2; code, `SOIL_TIE_DEFAULTS` |
| Overlap | Dropping every second photograph (36 of 71): held-out ties 7.5 to 28.6 cm, trees −26 %, verified weeds −42 %. So 80 / 80 stays the planner's default; 60 % forward is not enough for this pipeline | measured, `apricot-drop2` |
| Bare soil | The cameras are aligned on soil texture: windows over 5 % green are rejected. A field with no bare ground between the rows (closed corn, pasture, cover crop) gives no ties; under 40 ties the build falls back to header-only placement and says so (photographs may disagree by a metre or more). On the mid-stage corn flight the no-GPS experiment found 3 tie pairs of 489 | code, `cameras.ts` (`minTies` 40), `soilTies.ts`; measured on corn |
| Pairs | Two cameras tie only when their centres are within 45 m. At 36 m with 80 / 80 that is the 8 to 18 nearest neighbours; a flight at 120 m with the same overlap has legs about 35 m apart, still inside; wider spacing or sparser flights lose cross-leg ties | code, `candidatePairs(45)` |
| Height | Everything was measured at 36 m (0.98 cm pixels; preview at 5.6 cm). The tie windows are 64 samples at 4 cm or the raster's own pixel, whichever is coarser, so at 100 m the preview pixel is 16 cm and a window spans 10 m; expect the 7 cm held-out figure to grow with height roughly in proportion. Untested | derived |
| Terrain | A flat ground plane at one fitted height. A point 25 m from the nadir with 0.5 m of height error moves 0.35 m at 36 m. A terrain grid was tried and gained 1 cm on this flat field; a sloping field is untested | measured, experiment 1; derived |
| Crop | Rows and trees come from the orchard tree-row reader and the planting-layout fitter. Corn (and every continuous-row crop) gets no rows and no block from the twin; the colour weed tier then has no crowns to cut out and marks every green patch over 50 cm² as a weed candidate, which on a corn field is the corn. The continuous-row reader is not wired into the twin | code, `rows.ts`, `weeds.ts` (`colourObservations`, `minM2 0.005`) |

## 2. How many photographs

There is no cap in the code: the file picker takes any number, the worker takes them all, nothing refuses a count.
The limits are time and memory, and they scale differently per stage:

| Stage | Scales with | Per-unit cost measured | Where it breaks first |
|---|---|---|---|
| Photographs | N | 40 ms a preview in Node, 5 ms in the browser; one grey + green raster of 1.2 MB per photograph kept for the whole build | memory: 1.2 MB × N in the main worker, plus a copy per helper that needs it |
| Soil ties | pairs ≈ 9 N (within 45 m) | 2 rounds × about 20 ms a pair with the memo (28 s for 635 pairs in one worker, 9 s with 6 helpers) | time, linear in N |
| The fits | parameters P = 4 + 5 N | a dense P × P normal matrix, Cholesky each try, up to 8 tries × 12 iterations × 3 fits, finite differences over every tie | **the first hard wall**: dense P² memory (359² doubles = 1 MB at 71; 25 MB at 500 photographs; 200 MB at 1,000) and P³ time (milliseconds at 71; about 5 s a solve at 500; about a minute a solve at 1,000, so tens of minutes of fits) |
| Rows and trees | N reads, then reconciliation | under 1 s a read | fine |
| Weeds, colour tier | N photographs | 50 ms a photograph on the preview, 0.4 s on the quarter decode | fine |
| Weeds, model tier | N × tiles (24 at 1024 / 128) | 8.4 s a photograph on this GPU, about 3 min on a CPU | time: 10 min a flight on the GPU, hours on a CPU |
| Reconciliation | observations | 1 s for 30,536 detections (hash grid) | fine |
| Atlases | crops (2 per tree and verified weed, 1 per other weed) | 0.3 s a photograph for the crops, 15,829 crops → 49 atlases, 52 MB | storage, linear in objects |
| Evidence raster, boundary | ground area / 0.25 m cells | 0.6 s for 1.4 ha | fine |
| Opening the twin | objects | 120 ms compute for 10,000; 4.7 s ready and 700 MB of page memory at 1,000,000 synthetic | memory in the browser past a few hundred thousand objects |

### Measured today: the Node build against the photograph count

`npx vite-node scripts/directGeoref/buildTwinApp.ts -- --dir <apricot> --limit N --weeds <tier>` on this machine
(one Node process, no helper pool, previews on), peak node working set polled every 2 s:

| Photos | Weed tier | Wall (incl. 4 s start-up) | Pipeline | Photographs | Cameras | Rows | Weeds | Bundle (crops, atlases) | Peak node memory | Ties / pairs | Residual | Twin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 8 | none | 20 s | 16 s | 0.5 s | 4.4 s | 2.7 s | 0 | 7.8 s | 0.96 GB | 465 / 23 | 2.6 cm | 153 trees, 11 rows, 0.24 ha |
| 18 | none | 42 s | 36 s | 0.9 s | 8.8 s | 8.6 s | 0 | 17 s | 1.33 GB | 2,108 / 110 | 4.3 cm | 302 trees, 13 rows, 0.45 ha |
| 36 | none | 61 s | 57 s | 1.7 s | 16 s | 5.9 s | 0 | 32 s | 1.46 GB | 4,454 / 292 | 5.1 cm | 569 trees, 13 rows, 0.75 ha |
| 71 | none | 111 s | 106 s | 3.2 s | 32 s | 5.0 s | 0 | 65 s | 1.74 GB | 10,460 / 635 | 6.2 cm | 1,037 trees, 13 rows, 1.33 ha |
| 71 | colour on the preview | 137 s | 133 s | 3.2 s | 31 s | 5.0 s | 7.6 s | 85 s | 2.05 GB | same | same | + 27,935 weed objects, 16,449 verified |
| 71 | colour on the quarter decode | 240 s | 234 s | 3.4 s | 31 s | 5.2 s | 94 s | 99 s | 2.86 GB | same | same | + 45,688 weed objects, 28,626 verified |

(The residual is the median tie disagreement under the final cameras; it grows with the flight because a larger block
holds more opposite-leg pairs. The colour tier's weed counts are candidates, three to six times the model's 4,426
verified weeds on this flight; the labels are not exhaustive, so no precision.)

Reading: the pipeline time is linear in the photographs over this range, about 1.5 s a photograph in one Node
process without weeds, of which 0.9 s is the bundle stage (one full 20 MP decode per photograph for the evidence
crops) and 0.45 s the soil ties; the dense fit is still cheap at 71 (P = 359). Peak memory grows by about 11 MB a
photograph without weeds (1.7 GB at 71) and the colour tier on the quarter decode adds another 1.1 GB; the browser
build holds the same rasters but decodes through the GPU. The browser build with six helpers is about five times
faster than this on the parallel stages (21 s for the whole apricot twin, measured 2026-10-28). The solver's P³ term becomes the leading cost somewhere between 300 and 500
photographs (derived, not measured: no flight of that size is on this machine), which at 36 m and 80 / 80 is about
6 to 10 ha. Beyond that the fit needs a sparse solver or the analytic Jacobian of step F of the speed plan, neither
built.

## 3. Time, per device, as measured and as derived

| Device, tier | 71 photographs (1.4 ha) | Basis |
|---|---|---|
| This desktop, browser, 6 helpers, colour tier | twin ready 21 s, atlases done 24 s | measured 2026-10-28 (`twinBuildBench.mjs`) |
| This desktop, browser, 1 worker, colour tier | 45 s / 54 s | measured 2026-10-28 |
| This desktop, Node, saved model answers | 124 s (after steps 1a, 1b, 2); 387 s before | measured 2026-10-28 |
| This desktop, Node, today | see the table above | measured 2026-11-02 |
| This desktop, model tier (RF-DETR Seg-Large, RX 9060 XT) | + 10 min for the model (8.4 s a photograph; the service's cache makes a rebuild free) | measured 2026-10-28 |
| 4-core laptop, no GPU, colour tier | about 1 to 2 min (derived from the 1-worker figure and the core count) | derived |
| 4-core laptop, model tier on CPU | about 4 h (3 min a photograph) | measured once on 24 photographs, extrapolated |
| Phone or tablet | not possible today: the worker holds the whole flight's rasters and decodes 20 MP frames for the crops | derived |

Per hectare at 36 m and 80 / 80 (about 50 photographs a hectare): about 15 s a hectare in the browser with helpers,
colour tier; the model tier adds about 7 min a hectare on this GPU.

## 4. Accuracy limits (what the twin can and cannot claim)

| Quantity | Figure | Basis |
|---|---|---|
| Photo-to-photo agreement (held-out soil ties) | 7 cm median, 17 cm p90, RTK flight | measured, experiment 1 |
| Tree position across views | 7 to 8 cm at the tree's own height | measured, milestone 2 |
| Weed position across views | 4.3 cm median, 10.6 cm p90 (verified weeds) | measured, milestone 1 |
| Absolute position | never measured against a surveyed mark; RTK positions carry 1 to 1.4 cm standard deviation, the block's fit moves cameras at most 3 mm, so the twin is as absolute as the RTK is, plus the unmeasured boresight residual | untested |
| Model repeatability | a weed is detected in half the views that cover it (median), which is why 2,813 of 7,556 candidates are single-view | measured, milestone 1 |
| Colour tier against labels | 312 of 414 labelled weeds on DJI_0301 at twin level (the model 230), with 3 times the candidates; labels not exhaustive, so no precision | measured, colour-weed-rules |
| Heights | from parallax: median 4 cm for weeds, 1.07 m for trees; unverified against a tape | measured, unverified |
| Block boundary | 1.36 ha with confidence 0.89 on the apricot; no hand-drawn reference exists; a planting two pitches away over soil merges | measured, documented limit |

## 5. Storage and the account

| Limit | Value | Basis |
|---|---|---|
| Twin size | twin.json 8.9 MB (1.7 MB gzipped, stored gzipped) + 52 MB of atlases for 10,000 objects; about 6 KB an object in all | measured |
| Bucket | the `orthos` bucket, 10 GiB file cap; a twin's files are far under it | code, migrations |
| Twins per account | the list reads at most 100 | code, `store.ts` |
| Transfer | 14 s to open at 5 Mbit/s before the gzip; atlases fetched 1.1 MB at a time per inspected crop | measured |
| Session | one build per tab; the tab stays open; cancel terminates the worker; nothing is resumable | code, `TwinBuilder.tsx`, `worker.ts` |
| The weed model | only with the local service in a development build (`VITE_WEED_VISION_PREVIEW`); the live site has the colour tier only | code |

## 6. The short list a farmer-facing page could state

- Works on a DJI RTK flight at 36 m with 80 / 80 overlap over a field with bare soil between the rows; tested on one
  such flight of 71 photographs, 1.4 ha.
- Not yet for corn or any continuous-row crop (no rows, and the colour tier mistakes the crop for weeds).
- Twin in about half a minute on a desktop, a couple of minutes on a laptop, for a field of this size; weeds by the
  model add ten minutes on a GPU and hours without one.
- Up to a few hundred photographs (several hectares) before the camera fit becomes the bottleneck; untested beyond 71.
- Positions agree between photographs to centimetres; absolute accuracy is the drone's.
- Without RTK: an internally consistent map, offset by the GPS's error, usable for the same-day operation, not for
  returning to a spot later.

## 7. What was not measured and should be before any of the above is promised

1. A second camera body (Mavic 3E, Air 3S) through the header reader and the preview path.
2. A flight at 60 to 100 m: tie precision against height.
3. A flight of 200 or more photographs: the fit's wall, and the browser's memory with the helper pool.
4. Absolute accuracy against one surveyed mark.
5. A real TIFF or multispectral set.
6. A corn flight with headers, once the continuous-row reader is wired into the twin.
