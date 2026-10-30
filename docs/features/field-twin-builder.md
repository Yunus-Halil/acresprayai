# Field Twin builder in the app (2026-10-28)

The Field Twin can now be built inside the app from a flight's photographs. The page's "Build a twin from
photographs" button opens the builder: pick the original JPEG or TIFF files (or a folder), name the field, choose whether
the weed model runs, watch the eight stages, then open the twin and save it to the account. Nothing leaves the
browser except the photographs sent to the local weed model when it is on.

## What runs where

`src/lib/fieldTwin/build/` is the milestone chain of `scripts/directGeoref/` (run, exp1Align, m2Rows, m1Weeds,
buildTwin, boundaryEvidence, boundary) turned into pure stages behind two abstractions:

| Abstraction | Browser (`browserPhotos.ts`) | Node (`scripts/directGeoref/nodePhotos.ts`) |
|---|---|---|
| `PhotoSource` | `createImageBitmap` + `OffscreenCanvas`; the quarter-size decode is kept as a small JPEG and decoded again from that | jpeg-js, the quarter-size decode cached |
| `Codec.encodeJpeg` (atlases) | `OffscreenCanvas.convertToBlob` | jpeg-js |

| Stage | Module | What it does |
|---|---|---|
| Reading the photographs | `photos.ts` | DJI header, quarter-size decode, green patches, grey raster as bytes (1.25 MB per photograph, so seventy fit in a worker) |
| Aligning the cameras | `cameras.ts` | soil ties under the header cameras, the four flight-wide numbers, ties again, then the per-photo attitude model (experiment 1's reference). Under 40 ties: header-only placement, said so |
| Rows and trees | `rows.ts` | milestone 2's three passes and field rules, unchanged |
| Weeds | `weeds.ts` | the injected detector per photograph (the local service through the dev proxy), reconciliation, classes; a null detector builds without weeds |
| Other vegetation, the bundle | `bundle.ts` | milestone 3: vegetation, evidence crops (one full decode per photograph, all its crops cut from it), atlases, the bundle |
| Evidence and the block | `bundle.ts` | the nearest-nadir sampling, the classes, `inferBoundary`, the record into the twin |
| The whole | `pipeline.ts` | the stages in order, timings, notes, the report |

The page starts `worker.ts` through `runBuild.ts`; the worker posts progress, log lines and the result (twin.json
and the atlases as Blobs). Cancel terminates it. `TwinBuilder.tsx` is the panel; `FieldTwin.tsx` opens the result
at once and saves it to the account behind it (`saveTwin`).

## Checked

- `src/test/fieldTwinBuild.test.ts`: the pure pieces, and the whole pipeline on the first eight photographs of
  the local test flight when it is present (37 s in Node: cameras aligned on the soil, rows, trees, a block, a
  parseable bundle).
- `npx vite-node scripts/directGeoref/buildTwinApp.ts -- --weeds saved`: the same code over all 71 apricot
  photographs in Node with the service's saved answers, written to `data/direct-georef/twin-app/apricot-app/`,
  against the milestone scripts' twin:

| | Scripts' twin | In-app pipeline (Node) |
|---|---|---|
| Observed trees | 1,040 | 1,054 |
| Rows kept | 14 of 16 | 14 of 16 |
| Weed objects, verified | 9,643, 4,356 | 9,493, 4,410 |
| Other vegetation | 203 | 204 |
| Cultivated block | 1.358 ha, 88 % photographed edges | 1.338 ha, 94 % photographed edges |
| Time | about 25 min over five scripts (with the GPU) | 387 s without the model: photographs 96 s, cameras 63 s, rows 94 s, atlases 72 s, evidence 60 s |

The small differences come from the camera fit (all ties used, no held-out split) and from the soil-tie pass
reading bytes rather than floats. The in-app boundary leaves 7 trees of the used rows outside at the south-west
corner, where the scripts' twin left none: the one stretch to look at by eye.

## Since the first version (2026-10-28, the speed plan)

- The photographs are read from the camera's own 960 × 640 preview (MPF) instead of a 20 MP decode; the quarter
  decode stays for the colour weed pass and the fallback.
- Weed tiers in the panel: colour rules (default without the service), the model, or none; the twin's
  `source.weedModel` and `stats.weedTier` say which ran.
- The twin opens before its atlases; they are cut in the background and the twin is saved when they are in.
- A pool of helper workers (cores − 1) runs the ties, the colour pass and the crops.
- The dev preview offers the builder without a sign-in (`/dev/field-twin?build=1`), and
  `scripts/directGeoref/twinBuildBench.mjs` drives it headlessly: 71 photographs, twin ready in 21 s on this
  machine (6 helpers), 45 s with one worker. Measurements and the reasoning: 
  docs/research/swardus-direct-speed-plan-2026-10-28.md.

## TIFF photographs (2026-10-28, evening)

The builder takes TIFFs beside JPEGs (`.tif`, `.tiff`; the folder picker takes both):

- **An RGB TIFF** (three or more bands, 8 or 16 bits) is one photograph. Its DJI header is read from the TIFF's
  own directories (`src/lib/directGeoref/tiffHeader.ts`: the drone-dji XMP packet in tag 700, the EXIF and GPS
  sub-directories; the whole file is handed over because DJI writes the directories after the pixels).
- **A DJI multispectral shot** is read from its band files as one photograph: Phantom 4 Multispectral
  `DJI_0011_1.TIF` to `_5.TIF` (1 blue, 2 green, 3 red) become `DJI_0011` with the red, green and blue bands as its
  colour; the blue band is the reference grid and the header. The bands are aligned by DJI's
  RelativeOpticalCenterX/Y (each band read at its own offset less the blue band's). The sign of that shift is
  this code's reading of DJI's guide and is to be checked by eye on a real set. A Mavic 3 Multispectral shot has
  no blue band (`_MS_G`, `_MS_R`, `_MS_RE`, `_MS_NIR`) and is refused with the reason: use its RGB JPEG. A
  single-band TIFF on its own is refused the same way.
- 16-bit bands are stretched per band to their 99.5th percentile and gamma-encoded (1 / 2.2), so the colour rules
  read a chromaticity like a camera JPEG's. No preview exists in a TIFF, so the builder decodes it at the quarter
  size (geotiff.js, bilinear). The weed model and the helper pool get a JPEG re-encoded from the full decode.
- Code: `src/lib/fieldTwin/build/tiffPhotos.ts` (`tiffPhoto`, `bandSetPhoto`, `djiBandOf`, `refusedPhoto`) and
  `groupPhotoFiles` in `browserPhotos.ts`, which the worker uses for every build. Tests:
  `src/test/tiffPhotos.test.ts` (a TIFF written with its directories after the pixels, the header walked, a band
  set decoded and aligned). Not in Node's `buildTwinApp.ts` (JPEG only there).
- Not tested on a real multispectral set: none is on this machine. The first real set decides the shift's sign
  and whether the per-band stretch gives the colour rules what they need.

## Photographs without GPS (test switch, 2026-10-30)

Yunus's corn photographs (`directtestimagery/midphase`) carry no position: the headers were stripped. They turned
out to be one serpentine flight (1 to 16 up, 17 the turn, 18 to 28 back, 36/37/41/45 a third pass beside), so a
twin can be built from the overlaps alone. Behind a test switch for the reviewer accounts
(`lib/fieldTwin/reviewers.ts`): "Photographs without GPS" in the builder, with the row spacing that sets the scale.

- `src/lib/fieldTwin/build/matchPlacement.ts`, a stage before everything else (`BuildOptions.placement`):
  - every photograph shrunk to a 256-cell grey canvas, tapered at its own edges, and phase-correlated against every
    other one at the four quarter turns (a quarter turn of the square canvas is a re-indexing of its spectrum, so
    it costs one inverse transform), then at -3 to +3 degrees around the best turn with a parabola through the peak;
  - a pair is kept at a peak of 0.06 or more and 20 % or more shared ground; the turns are solved over a spanning
    tree of the strongest pairs and averaged, the places by least squares over every pair, the worst pair dropped
    while one disagrees (3 degrees, 2 cells and 4 x the median), and the largest joined group is kept;
  - the scale: the continuous-row reader (both stage variants) on up to ten placed photographs with the scale
    unknown, each reading the row pitch in pixels; the reading most photographs agree on (within 5 %) times the
    operator's row spacing is the pixel size;
  - the camera assumed: straight down, a 24 mm-equivalent lens, no lens distortion; the height follows from the scale;
  - each photograph gets a DJI-like header (position on a stand-in plane near 0, 0, height, gimbal yaw, pitch -90),
    and the build runs on as on a flight with GPS: soil ties, the camera fit, rows, weeds, the bundle.
- The twin says so: `source.placement = "matched"` and the method text; the viewer drops the surroundings, the
  mini-map and the north arrow and shows a note that the twin is not on the map.
- Checked: `src/test/matchPlacement.test.ts` (a synthetic serpentine flight cut from one textured ground with known
  turns and places comes back within 1 degree and 2.5 cells, a photograph off on its own is left out; the made-up
  headers project through the real camera model as the placement says; the JPEG size from the frame header).
  `scripts/directGeoref/matchProbe.ts` places a folder and draws the mosaic through the camera model
  (`<photos>/outputs/no-gps-match/`); `buildTwinApp.ts --no-gps 0.762` builds the whole twin in Node.
- On the 40 mid photographs: 32 placed (68, 72, 75, 86 alone; 88 to 91 a separate strip), 116 overlapping pairs,
  none dropped; the scale 0.50 cm a pixel, the mid variant agreeing on almost every photograph (the early variant
  locks on half or double pitches, which is why it is the agreed reading and not a median).
- The whole build in Node (`buildTwinApp.ts --no-gps 0.762 --weeds none`): 95 s, 32 photographs; the soil ties
  found bare soil in only 3 of 489 pairs under the canopy, so the camera fit is skipped in this mode unless the ties
  reach a fifth of the photographs (`alignCameras` `minTiePairs`; fitted on those 3 it tilted every photograph by
  up to 3 degrees, about 2 m between the passes); the twin's row stage is the orchard reader and reads no corn
  rows, so the twin holds the photo footprints and 11 vegetation patches, and the builder sets the weed pass to
  none when the switch is on (the colour rules with no rows would call every corn plant a weed).
- Limits: all pairs are tried (fine for a test flight of tens of photographs; hundreds would need the flight order
  to prune them); one flight; a field with no rows has no scale and is refused; north and place unknown, so nothing
  from such a twin can drive a sprayer.

## Limits

- The weed model needs the local service (development builds, `VITE_WEED_VISION_PREVIEW`): on the live site the
  builder offers the colour rules (seconds, about 60 % of what the model finds on the apricot flight) and no model.
- One flight at a time, in one browser tab; the tab must stay open while it builds.
- Checked in headless Chrome by the benchmark script; the eye test on the opened twin is Yunus's.
