# Corn V1 over a whole field (Swardus Direct, 2026-11-04)

Corn V1 ([corn-v1.md](corn-v1.md)) reads one photograph. A mapping flight sees every square metre in several
photographs, so the field can ask more of each finding than one photograph can. `src/lib/fieldTwin/cornField.ts`
projects every photograph's Corn V1 read into the field's ground coordinates through the same camera frames Swardus
Direct builds (`GeorefFrame`, `pixelToGround`, `groundToPixel`) and combines the evidence of overlapping photographs.
No new model, no new reading of pixels: the per-photograph outputs, placed and cross-checked.

Review-only like V1: rows, identities and candidate findings with the photographs behind each; crop identity is the
operator's entry; nothing decides a treatment.

## What it does

```
per photograph:  Corn V1 read ──► compactCornRead (rows + identity, judged green patches + verdict, gaps, plants located)
                                         │   (small: what a worker sends, what a cache keeps)
whole field:     cornField(reads, frames)
                   rows   projected (every 25 cm) ─► the field's row direction (length-weighted) and spacing (neighbouring
                          rows in each photograph) ─► grouped across on the lattice (a quarter spacing) ─► cut along where
                          no photograph holds them for 1.5 m.  A field row is CORN only where the photographs holding it
                          mostly call it corn AND at least half of the photographs covering it hold it at all.  A row not
                          confirmed, between corn rows and off their spacing, is left out (no row of the planting runs there).
                   weeds  every patch Corn V1 judged is a sighting with its verdict ─► Direct's reconcile joins one patch's
                          sightings (outline overlap, one per photograph) ─► a field WEED CANDIDATE needs at least two weed
                          votes (fewer only where fewer photographs covered it), the weed votes leading, a third of the
                          covering photographs to have seen it, and never more "crop on a row" votes than weed votes.
                   gaps   every reported stand gap placed on its field row ─► joined along ─► checked in EVERY photograph
                          covering it: a plant located inside it (any photograph) withholds it; so does a report from fewer
                          than half of the photographs holding a corn row there, or a field row whose crop is not confirmed.
```

The plant check is the strongest thing a second photograph adds: a plant one frame missed (a dim corner, blur, a leaf
over it) is a plant another frame sees.

## Measured on real overlapping corn flights

No corn flight of our own carries camera headers yet, so the test is UAV3DCrop's 2024 corn plots: real overlapping
nadir flights with their camera poses (`transforms.json`) and point cloud (`sparse_pc.ply`).
`scripts/rowCrop/uav3dcrop.ts` turns them into Direct `GeorefFrame`s (the camera rotation carried in the boresight, the
ground the point cloud's lower surface on a 1 m grid). The scenes carry no GPS and their units are the reconstruction's
own, so the scale is fixed from one photograph's corn rows taken as 76.2 cm (stated in every result). Checked first:
an image centre lands 6 cm from the camera's ground point, a point carried from one photograph into its neighbour and
back returns within 0.1 mm, and the mosaic drawn through the frames is seamless across photographs.

Blocks of the 40 nadir photographs nearest each flight's middle (`npx vite-node scripts/rowCrop/cornFieldBench.ts
--scene <scene> --out <dir> --n 40`; results and pictures in `D:\swardus-research\cornfield`):

| Scene (stage) | Day015_Corn1 (early) | Day023_Corn1 (establishment) | Day045_Corn1 (mid) |
|---|---|---|---|
| Scale fixed from the rows (m per reconstruction unit) | 0.515 | 0.489 | 0.486 |
| Row spacing measured over the 40 photographs (76.2 cm on one) | 81.3 cm | 79.2 cm | 78.0 cm |
| **Rows agree across photographs** (pieces' across scatter about their field row, median) | 5.4 cm | 7.3 cm | 7.7 cm |
| Field rows: corn / planted, crop not confirmed (left out off the lattice) | 12 / 4 (0) | 11 / 8 (2) | 8 / 19 (6) |
| Corn row length | 181 m | 165 m | 140 m |
| Best-held corn rows: photographs holding them | 34-40 | 27-40 | 21-33 of 30-40 covering |
| Weed candidates: single-photograph reports / field weed candidates | 37 / 1 | 33 / 2 | 21 / 0 |
| Patches a photograph called a weed: confirmed / withheld | 1 / 28 | 2 / 9 | 0 / 21 |
| Stand gaps: single-photograph reports / field gaps | 0 / 0 | 0 / 0 | 0 / 0 |
| Corn V1 per photograph / combination of 40 | 2.9 s / 44 ms | 3.4 s / 47 ms | 6.7 s / 45 ms |

What this shows:

- **The placement holds.** Rows from up to 40 photographs fall on one line within 5-8 cm (a tenth of a row spacing)
  and the measured spacing is within 3-7 % of the one photograph that fixed the scale, so per-photograph reads can be
  combined on the ground.
- **The field confirms rows the photographs agree on** (the best corn rows held by 34-40 of 40 photographs) and keeps
  the verge, the neighbouring plots and rows few photographs hold as planted rows, crop not confirmed; at mid stage
  6 phantom rows between the corn rows (plants located on the green lining up leaves across the alley) were left out.
- **Single-photograph weed candidates mostly do not repeat.** Of the patches some photograph called a weed, 58 of 61
  were not called one by the other photographs covering them. Without labels this cannot say whether they are weeds;
  it says they are not stable findings, which is what the field step is for. Confirmed: 3 across the three blocks.
- **Gaps were not exercised**: these research plots read no stand gaps in any photograph (the gap logic is covered by
  the unit tests only).
- Pictures (`field.jpg`, the fused rows, weeds and gaps over a mosaic made through the same camera frames) in
  `D:\swardus-research\cornfield\<scene>-n40`.

No labels exist for these plots, so the measures are the photographs' agreement, not accuracy against truth.

## Limits

- **One planting direction per field block** (the field's row direction is one angle); a block with two plantings at
  different angles needs splitting first.
- **Scale and position come from the cameras.** On a real Direct flight they come from the drone's headers and the
  camera fit (Direct's own limits apply: [swardus-direct-limits](../research/swardus-direct-limits-2026-11-02.md)); on
  the test scenes the scale was fixed from the corn rows.
- **Cost:** Corn V1 is 3-8 s per 20 MP photograph on one CPU core; the combination is under a second per 40 photographs.
  At mapping height with ordinary overlap every point is seen several times, so reading a subset of the photographs
  that still covers each point two or three times is the obvious lever for large areas (not built).
- **Coverage, not just accuracy:** a row or weed seen by one photograph of several is withheld, so patchy single-photo
  reads lose findings at the field's edges, where fewer photographs overlap.

## The Corn Field Twin (in the app, 2026-11-04)

Whole-field corn is part of the Field Twin build and viewer. The pieces:

- **Build** (`src/lib/fieldTwin/build`): the builder's Crop choice, Orchard or **Corn**. A corn build runs the same stages
  as an orchard one (the photographs' headers, the cameras, the bundle, the evidence crops) with one change: in place
  of the orchard's rows-and-trees and weed passes, the **corn stage** (`build/corn.ts`) reads every placed photograph
  with the frozen Corn V1 at its full size (in helper workers, three at a time, each with the aligned camera's pixel
  size) and combines them with `cornField`. The colour weed rules are not run on corn: they would call the corn weeds.
- **Stored twin** (`src/lib/fieldTwin/types.ts`): an optional `corn` section (version 1) beside the orchard fields:
  rows (corn / unconfirmed), every patch some photograph called a weed candidate (confirmed / unconfirmed / contested,
  with each photograph's vote), every reported stand gap (confirmed / withheld, with the photographs that reported it,
  held a corn row without a gap there, or located a plant inside it), each finding with crops from the photographs
  behind it, and the counts. Older twins (no `corn`, no `source.placement`) load and draw exactly as before;
  `parseTwin` refuses a malformed corn section with the reason. The corn rows are also written as the twin's rows.
- **Placement** (`source.placement`): `georeferenced` when the positions are the drone's own headers; `local` when a
  file says otherwise (`swardus:Placement` in its XMP: the UAV3DCrop test flights, whose positions are a scene
  reconstruction scaled from the corn rows). A local twin says so in the corn panel and the key, and the map's
  surroundings (OpenStreetMap) are switched off for it: its coordinates are not a place.
- **Viewer** (`FieldTwinView`, `TwinCanvasLayer`, `CornPanels.tsx`): the corn layer draws corn rows cyan, rows not
  confirmed amber dashes, confirmed weed candidates red, unconfirmed grey dashes, contested violet dashes, stand gaps
  orange and withheld gaps grey dashes, all in the twin's one canvas (picking and the selection ring included). The
  left column's **Corn** panel gives the counts, two switches (what the photographs confirm; observations not
  confirmed) and a review list (weeds, unconfirmed, gaps, withheld, rows) that selects and zooms to each. The
  inspector shows a selected row, weed or gap: its state and why, its measurements, what each photograph said, and
  crops from them. Every panel says it: review-only, not a treatment decision; the crop is the operator's entry.

### How to open one

1. `npm run dev`, sign in as the Field Twin reviewer, open **Field Twin** (`/app/field-twin`).
2. Built on this computer: the three test-flight twins are in `data/direct-georef/twin/` (`corn-day015-corn1-test`,
   `corn-day023-corn1-test`, `corn-day045-corn1-test`) and appear in the page's list of twins built here. Open one.
3. Build one in the app: **Build a twin** > **Pick a folder** > `D:\swardus-research\cornflight\Day023_Corn1-n40` (the 40
   photographs with their headers written) > Crop **Corn** > **Build the twin** (about 2-4 minutes on this computer with
   helper workers) > **Open and save to my account**.
4. In the twin: the **Corn** panel on the left; click a row, a weed or a gap on the map or in the review list.

Without signing in (development build only): `http://localhost:8080/dev/field-twin?id=corn-day023-corn1-test` opens a
twin built here; `http://localhost:8080/dev/field-twin?build=1` opens the builder.

Rebuild a test twin in Node: `npx vite-node scripts/directGeoref/buildTwinApp.ts --dir <flight folder> --out
data/direct-georef/twin --name "..." --id <id> --crop corn --weeds none --no-preview`. Write a test flight from a
UAV3DCrop scene: `npx vite-node scripts/rowCrop/uav3dcropFlight.ts --scene <scene> --out <dir> --reads <cornFieldBench
reads dir>`.

## Speed (2026-11-05)

**In the browser** (the app's own build: `node scripts/directGeoref/twinBuildBench.mjs --dir <flight> --crop corn
--base http://localhost:8080`, headless Chrome on this laptop, 12 logical cores, 6 helper workers of which the corn
stage uses 3; peak memory = the working sets of the benchmark's own Chrome processes, sampled every 2 s):

| 40-photo Day023 flight | corn-v1.0 (frozen) | shared seedling mask |
|---|---|---|
| Twin ready | 76.2 s | 73.1 s |
| Corn stage | 69.3 s (5.0 s per photograph per worker) | 66.7 s (4.9 s) |
| Peak memory, all of the benchmark's Chrome / its largest process | 2.69 / 2.18 GB | 2.64 / 2.12 GB |
| Result | 11 corn rows, 5 unconfirmed; 3 confirmed weeds, 9 withheld | identical |

The in-browser build is about four times faster than the Node script (286 s) because the corn stage runs in three
workers and the cameras use the pool.

**The shared seedling mask.** The emergence reader and the plant read both computed the whole-frame seedling mask
(soil levels + mask, about 1 s per 20 MP photograph). Corn V1 now computes it once per photograph and hands the same
arrays to both (`seedlingGreen.ts SeedlingCache`, passed through `RowCropOptions.seedlings`; it answers only for its own
photograph and settings, read-only). Checked against corn-v1.0 on the same decoded pixels
(`scripts/rowCrop/cornV1Equivalence.ts`, every photograph read both ways in one process): **274 of 274 photographs
byte-for-byte identical** (every set: our emergence, Corn2, establishment, mid, late; the three test flights).
Time: **42 % less on seedling-stage photographs** (our emergence set: 165.7 to 96.1 s over 23), unchanged (within
3 %, noise) wherever the emergence reader does not run, which includes all three UAV3DCrop test flights (establishment,
mid, late) and Corn2. So the in-browser test-flight build above barely moves; an emergence-stage flight would.

**Browser and Node see slightly different pixels.** The same JPEG decoded by Chrome and by Node's jpeg-js differs by
0.65 levels on average (up to 10), Chrome 0.36 % brighter overall; a borderline patch can tip, so an in-app build and a
Node benchmark of the same flight can differ at the margin (Day023: 3 confirmed weeds in the browser, 2 in Node, 34 vs
33 single-photograph reports, same rows). Corn V1's benchmarked numbers are Node's.

Where the remaining time goes, per photograph (Node): the adaptive green read 1-6 s (the mid reader is the heaviest:
5.4-5.8 s on mid-stage frames), the plant read 1.0-1.35 s, of which the soil levels (a 9 x 9 median over 16-pixel blocks,
done with a full sort) 0.6-1.1 s. Not changed here: half-resolution reading and photograph thinning (both would need
the loss of detections and multi-photograph evidence measured first).

## Integration status

- Done: the library (`cornField`, `compactCornRead`), its tests (three overlapping cameras with single-photograph
  errors planted: the shared weed kept, the made-up weed withheld, a weed one photo calls crop withheld, a gap another
  photo sees plants in withheld, a row one of three holds not corn), the real-flight bench.
- Done 2026-11-04: the corn stage in the builder, the twin's corn section, the viewer's corn layer, panel and
  inspector (above), tests of each (src/test/fieldTwinCorn.test.ts, fieldTwinCornUi.test.tsx).
- Not done: a cultivated block for corn (the boundary inference reads orchard trees); soil ties on the low test
  flights (0 found: the placement there is the headers'); our own corn flights still need camera headers.
