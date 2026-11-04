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

## Integration status

- Done: the library (`cornField`, `compactCornRead`), its tests (three overlapping cameras with single-photograph
  errors planted: the shared weed kept, the made-up weed withheld, a weed one photo calls crop withheld, a gap another
  photo sees plants in withheld, a row one of three holds not corn), the real-flight bench.
- Next (not built): a corn stage in the Field Twin builder (`src/lib/fieldTwin/build/pipeline.ts`, after `alignCameras`,
  which already produces the `GeorefFrame`s: read each photograph with Corn V1 in the worker pool, send
  `compactCornRead`, call `cornField`), a `corn` section in the twin bundle, and viewer layers (corn rows, planted rows,
  weed candidates, stand gaps, each with its photographs). Our own corn flights need camera headers first.
