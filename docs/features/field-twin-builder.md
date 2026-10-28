# Field Twin builder in the app (2026-10-28)

The Field Twin can now be built inside the app from a flight's photographs. The page's "Build a twin from
photographs" button opens the builder: pick the original JPEG files (or a folder), name the field, choose whether
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

## Limits

- The weed model needs the local service (development builds, `VITE_WEED_VISION_PREVIEW`): on the live site the
  builder makes a twin without weeds and says so. About 15 s per photograph on the GPU when it is on.
- One flight at a time, in one browser tab; seventy 20-megapixel photographs take a few minutes. The tab must
  stay open.
- Not yet checked in a browser by eye (the Node run is the same code, but `createImageBitmap` scaling is not
  jpeg-js box averaging). That check is the next step.
