# Two-stage prototype: real-imagery trial, 2026-10-19

Decision report after validating the two-stage prototype and the quick wins. Plan and audit:
`two-stage-weed-intelligence.md`. Raw outputs: `D:\swardus-research\weed-vision-lab-outputs\two-stage-trial-2026-10-19\`
(per frame `trial.json`, `overlay.png`, `largest-offrow-weed.png`; `e2e-before.json`, `e2e-after.json`, `render-bench.json`).

**Nothing here is a weed-detection accuracy figure.** Every comparison is against RF-DETR, which is itself unvalidated on
these fields, or against 414 hand-labelled weed points on one frame that are not exhaustive.

## 1. What was actually tested

| | |
|---|---|
| Imagery | 5 frames of the kept orchard flight (`samplerowtestingimagery`: DJI_0301, 0303, 0312, 0320, 0327; 33.88 N, 5.42 W, April 2021, about 1 cm/px), each about 54 x 36 m |
| How | Each frame placed as a stand-in field map: north-up, centred on its GPS position, resampled to the app's zoom 23 and zoom 22 pixels. Then the app's own code: row reader, Stage 1, router, Stage 2 store and window cache, placement, scorecard (`scripts/bench/twoStageTrial.ts`) |
| Model | RF-DETR Seg-Large through the local weed-vision service on the RX 9060 XT, the same service the app calls |
| Find weeds before and after the quick wins | All 24 map chunks of three frames, old service code (commit fd54060, a temporary worktree, now removed) against the current one (`scripts/bench/mapRunEndToEnd.ts`) |
| Rendering | The two canvas layers' draw loops in headless Chrome with Leaflet, 1, 10 and 50 ha (`scripts/bench/layerRenderBench.mjs`) |

**Not tested, and why.** The real orthomosaic and the browser workflow. The map tiles are only served to a signed-in
session, no service credentials are stored on this machine, and the agreed rule is that you drive the live app. So
the alignment of the prototype's grid with the real orthomosaic, real field boundaries, and real browser timings are
untested. The stand-in has no heading, no ODM stitching and its pixel size is estimated from EXIF.

## 2. Before and after performance

**Find weeds on the map, the same 24 chunks, end to end (encode excluded, upload, service, response):**

| | Before | After | Change |
|---|---|---|---|
| Request time | 66.0 s | 54.7 s | -17% |
| Service time | 64.2 s | 53.5 s | -17% |
| Upload | 38.7 MB | 23.6 MB | -39% |
| Response | 3.0 MB | 2.4 MB | -19% |
| Stored detection JSON | 3.1 MB | 1.9 MB | -38% |
| Tiles run | 384 | 384 | same |
| Weeds / crop plants | 1,298 / 230 | 1,320 / 229 | |

The improvement is 17% here, not the 27% measured earlier on a chunk enlarged 2x: at this orchard's 1.5x enlargement
the old path also ran 16 tiles per chunk, so only the post-processing saving remains. Browser-side work (tile fetch,
canvas, the browser's own JPEG encoder) is not in these numbers.

**The quick wins changed which small weeds are found, not how many.** About 25% of weeds in either run have no
counterpart within 10 cm in the other (20% beyond 25 cm). The unmatched ones are small (median 0.03 m² against
0.07 m²). Aggregated to 2 m cells, 83 to 89% of the cells over 5% weed cover agree, with a cell-level correlation of
0.67 to 0.90. Which run is closer to the ground is not known. What it shows: RF-DETR's individual small detections are
unstable to how the image is resampled; the pressure per cell is much steadier.

**Map layers (headless Chrome, draw loop only, median per redraw):**

| Field | Stage 1 cells, whole field in view | Cells, zoomed in (after the fix) | Weed dots, whole field |
|---|---|---|---|
| 1 ha | 2 ms | 2 ms | 0.5 ms |
| 10 ha | 18 ms | 3 ms | 5 ms |
| 50 ha | 149 ms | 3.5 ms (was 42 ms) | 69 ms |

## 3. How much detailed RF-DETR computation was avoided

| Frame | Rows read | Windows inspected | RF-DETR time, routed / everywhere |
|---|---|---|---|
| DJI_0301 | 6 rows, 5.2 m | 39 of 48 | 7.3 / 8.7 s |
| DJI_0303 | 6 rows, 5.2 m | 39 of 48 | 7.1 / 8.6 s |
| DJI_0312 | none | 40 of 40 | 7.2 / 7.2 s |
| DJI_0320 | 5 rows, one block | 48 of 48 | 8.1 / 8.1 s |
| DJI_0327 | none | 48 of 48 | 7.9 / 7.9 s |
| **All** | | **214 of 232 (92%)** | **37.5 / 40.5 s (7% avoided)** |

Why so little: between-row green is widespread in this orchard, so candidates are scattered and almost every 7 m
window holds one; where the row reader finds no rows, every cell is uncertain and everything is inspected by design.
A freely placed window cover was simulated and was not cheaper (28 to 51 windows against 36 to 47 on the grid).

Stage 1 itself costs 31 to 37 ms per frame (about 0.2 s per hectare) plus 31 to 53 ms for the rows, in Node. RF-DETR:
170 to 187 ms per window in the service, 525 MB peak GPU memory, 1.39 GB service working set; the trial process 0.4 GB.

**A separate, larger saving was found by accident.** The prototype's one-tile windows cover a frame with 48 model
passes; Find weeds' overlapping tiles inside 1536 px chunks use about 128 (8.7 s against 18 s per frame). But the
window path finds 15 to 22% fewer weeds and 18 to 38% less weed area than Find weeds on the same frames. 86% of its
cells over 5% cover are also over 5% in Find weeds, but Find weeds has 23 to 33% more such cells. That is a trade between cost and detections, not a free
win, and the prototype's "reference" is therefore not "what Find weeds shows".

## 4. Candidate hotspots and uncertain areas

| Frame | Candidate areas (high priority) | Cells flagged | Cells uncertain | Main reasons |
|---|---|---|---|---|
| DJI_0301 | 18 (6) | 16% | 28% | 103 mostly crop row (do not route), 31 beyond the rows |
| DJI_0303 | 21 (3) | 21% | 34% | 112 mostly crop row, 51 beyond the rows |
| DJI_0312 | 5 (4) | 55% | 100% | no rows read; 46 shadow |
| DJI_0320 | 13 (4) | 41% | 66% | 223 beyond the rows (a hedgerow block), 33 shadow |
| DJI_0327 | 18 (7) | 51% | 100% | no rows read |

## 5. Where the prototype disagrees with full RF-DETR

| Frame | High-priority patches inspected | All patches inspected | Flagged by Stage 1 alone | Candidates RF-DETR found empty | Audit cells with cover over 5% |
|---|---|---|---|---|---|
| DJI_0301 | 12/12 | 27/29 | 20/29 | 0/18 | 3/49 |
| DJI_0303 | 10/10 | 30/30 | 26/30 | 3/21 | 4/53 |
| DJI_0312 | 42/42 | 49/49 | 47/49 | 0/5 | none drawn |
| DJI_0320 | 13/13 | 27/27 | 25/27 | 3/13 | 0/2 |
| DJI_0327 | 37/37 | 45/45 | 41/45 | 6/18 | none drawn |

Read this table with section 6 in mind: the agreement is mostly agreement about large green objects. On the frames
with rows, Stage 1's top 20% of cells holds 64 to 71% of RF-DETR's patch cells on DJI_0301 and 0303, but only 23% on
DJI_0320 (shadows and a hedgerow block). Cover per cell differs by 4 to 5 points on average on DJI_0301 and 0303 and by
13 to 16 points on the other three. The two patches the route missed on DJI_0301 were single 2 m cells.

## 6. Correctness risks and limitations

1. **Most "high-priority patches" are large single detections, sometimes trees.** In the RF-DETR reference, 12/12,
   10/10, 42/42, 12/13 and 37/37 high-priority patches are carried mainly by detections of 0.5 m² or more off the rows.
   Looked at full size: on the two frames without rows the largest are orchard tree crowns; on the frames with rows,
   a dense green patch at the field edge, a strip along a fence and a strip beside a path with a pale shrub. Stage 1
   flags the same objects, so "100% high-priority recall" partly means both see big green things.
2. **The row reader failed on 2 of 5 real frames** (irregular, touching crowns on DJI_0312 and 0327) and covered only
   one block on DJI_0320. Both Stage 1 and the product's "weeds between the rows" filter depend on it. Where it fails,
   Stage 1 says so (every cell uncertain, everything inspected); Find weeds falls back to per-chunk rows.
3. **Weeds hugging the rows.** 197 of the 414 hand-labelled weeds on DJI_0301 sit in cells touching the row band, and
   33 (8%) are on a row line or tree per the row reader, where every path sets them aside as crop by rule.
4. **Small scattered weeds are below Stage 1's 5% floor.** Candidate cells hold 78 of the 414 labelled weeds (19%);
   inspected windows hold 370 (89%), only because 81% of windows were inspected. RF-DETR has a detection within 30 cm
   of 218 of them (53%), the same figure as the earlier open-row benchmark.
5. **The "mostly crop row" exclusion is not hiding much.** Weeds RF-DETR found in such cells whose windows were not
   inspected: 3, 3, 0, 0, 0 per frame (0.08 and 0.11 m²); 6 of the 414 labelled weeds.
6. **Placement checks out on the stand-in.** Shifting every RF-DETR weed centre by up to 8 px, the most land on green
   at 0 px (two frames) or 2 px, 3 cm (three frames), well inside the snap's 12 cm. This is the window and placement
   arithmetic only; alignment with the real orthomosaic is untested.
7. **Window seams.** One to two plants per frame were counted by two windows (centres 3 to 61 cm apart, near-equal
   areas); now merged. Five to seven pairs per frame remain where a large object is cut by a seam into a big and a
   small piece; those are left as two. Find weeds' chunk seams follow the same centre rule and can show the same
   repeats; that path was not changed.
8. **Large-field view.** The cell layer takes about 150 ms per redraw with a whole 50 ha field in view.
9. **The stand-in is not the orthomosaic**: no heading, no stitching, estimated pixel size, 0.19 ha per frame. Savings
   on a large field with clean areas could be higher; on this orchard nothing suggests it.

**Fixed during the trial** (commit 38aed1b, tests added): cells farther than one row spacing from every row read are
now "no rows" (a hedgerow block had been flagged as confident pressure); seam repeats merged; off-view cells skipped.
No threshold was changed.

## 7. What still needs you

1. **The real map run** (about 15 minutes, checklist below). It is the only way to see the real inspected share, the
   grid's alignment with your orthomosaic and the browser timings.
2. **Blind cell labels**, at least 30 on the orchard map in the prototype's labelling mode, then export the file. Until
   then nothing in the scorecard says anything about weeds.
3. **A decision on what counts as a weed patch here**: hedgerows, fence lines and path verges are green, between the
   rows and flagged by both Stage 1 and RF-DETR. If they should not count, the field boundary should leave them out.
4. **Whether the cheaper one-tile window grid is acceptable** for Find weeds given it finds 15 to 22% fewer weeds; that
   needs your labels to judge, not RF-DETR.

### Manual test checklist (real map)

1. Start the service: `npm run weed-vision:service`; start the dev app with `VITE_WEED_VISION_PREVIEW=true`.
2. Open the orchard scan, Weed Scout, Show all options, open "Two-stage weed pressure (prototype)".
3. Press "1. Read weed pressure". Note the time shown, the candidate count and the uncertain reasons. Check the grey
   and orange cells sit on the map where you expect, and that tree crowns on the rows are not orange.
4. Press "2. Inspect with RF-DETR", then "Reference: RF-DETR everywhere". Note the windows line and the cost line.
5. Screenshot the map at field zoom and the scorecard. Pan and zoom once with everything on: tell me if it stutters.
6. Tick "Label cells", press "Next random cell" 30 times, label each, Export labels. Send me the file and screenshots.

## 8. Does it deserve further investment?

**Not the routing, not yet.** On this orchard the route saved 7% of RF-DETR time, because weed-like green is
everywhere between the rows and the row reader fails on irregular trees. More routing logic cannot change that.

**What earned its keep:**
- Stage 1 runs in about 0.2 s per hectare, says honestly where it cannot judge, and its pressure per cell is steadier
  than RF-DETR's individual small detections (section 2). As a pressure map it may be the deliverable itself for this
  kind of field; only your labels can say whether its pressure means weeds.
- The quick wins: Find weeds 17% faster on this orchard, 39% less upload, 38% less stored data.
- The trial tooling, which now runs the whole pipeline on any kept frames without the browser.

**Spend next on**, in order: your 30 blind labels on the real map; the row reader on irregular orchard crowns (two of
five frames failed, and the product's between-rows filter depends on it); then, with labels in hand, a decision on the
one-tile window grid, which halves RF-DETR cost but finds fewer weeds.
