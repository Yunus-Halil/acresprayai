# Field intelligence: from Photo Scout to production (living plan)

Objective, in the founder's words (2026-10-08): the product is field intelligence. A
grower uploads the field map, SwathWise finds the weeds, measures each one, and turns what
the grower confirms into action. The planting-pattern pass built as Photo Scout is the
engine; this plan is how it becomes the scan, the screen and the shipped Weed Scout. It is
updated as each piece lands. Nothing here is built until the founder says which phase.

How it finds weeds is a trade secret. This document is for the team and never for the site.

## What we know going in

Measured on 58 real frames (orchard, 29 frames at 2 cm/px; vineyard, 29 frames at 2.2
cm/px), see `samplerowtestingimagery/` and the memory notes:

| | at 2 cm/px (the photo) | at 5 cm/px (the field map) | at 8 cm/px |
|---|---|---|---|
| rows found, spacing, direction | yes, 28/29 and 29/29 frames | yes, same numbers | yes, same numbers |
| crop plants counted and sized (trees 1.8 m, vines 2.1 m) | yes | yes | yes |
| plant spacing along the row | yes, 65 to 96% agreement | yes, 75 to 84% | yes, 80 to 91% |
| small weeds between rows | yes | about half as many | about a quarter |
| time per frame, one thread | 5 to 8 s | 2 to 3 s | 1.5 to 3 s |

So the field map is enough for the pattern and the crop. The original photos are needed
for the small weeds. The app keeps both: originals under `scans/{user}/{odm}/frames/`, and
`src/lib/sourceFrames/odm.ts` already projects a photo pixel to the ground
(`pixelToGround`) and back (`projectToFrame`), with `detections.ts` as the worked example.

Known gaps in the pass itself, all with a fix in hand:

- A square grid (vineyard, vines 3.5 m along and 3.5 m across) is self-consistent both
  ways and the pass chose across the trellis. Brightness prefers along the wire by 1.3:1
  where vegetation prefers across by 5:1, so a brightness tiebreak when both directions fit
  the same spacing decides it. A one-tap "rows run this way" from the grower is the backstop.
- Three-to-five-window blocks on a road, a hedge or a pond edge draw stray lines.
- Touching canopies sometimes split in two (shown as doubles). Fine for a count, noise
  for a weed list.

## The shape of it

One pass, two resolutions, one result:

1. **On the field map** (the baked tiles, as the scout stitches them today): the planting
   pattern per block, every crop plant placed, the large weeds and the regions. This runs
   for every scan, imported maps included, because it needs nothing but the map.
2. **On the original photos**, where the scan kept them: the same pass at 2 cm/px, only on
   the windows the map pass marked as rows, projected to the ground through the ODM
   reconstruction. This adds the small weeds the map cannot resolve, each tied to the
   photo it was seen in (CloserLook already shows that photo).
3. **One list of findings** on the field: the off-pattern plants from both, the regions
   from the baseline (bare, thin, wet), ranked worst first, with the pattern itself drawn
   underneath as the explanation the grower never has to read.

The two-scale anomaly pass, the regions and the archive stay. What changes is the
candidate generator: "off-row vegetation" and "vegetation outlier" become the pattern's own
classes, and the row fit the scout used is replaced by the pattern's blocks and settled row
lines (`pattern.ts`), which the scout's `rows.ts` already shares code with.

## Phases

### Phase 0. The pass, finished for the field map (1 to 2 days)
- Brightness tiebreak for square grids; stray-block suppression (a block whose windows
  carry under a fifth of the vegetation of the photo's main block, or sit on a road, is
  dropped); a doubles merge when the two halves sit within half a plant of each other.
- `analysePhoto` takes a raster in ground metres with an origin, not only a photo, so the
  same function runs on a stitched map window. It already is pure.
- A benchmark command over both sample sets that prints the table above, so every change
  to the pass is measured before it ships. (`npm run bench:pattern`.)

### Phase 1. The pattern on the map, in the scout (3 to 4 days)
- `runWeedScout` gains a stage between the baseline and the sweep: stitch the interior at
  the zoom nearest 5 cm/px (MAX_TILES allows it at that zoom for a 20 ha field; larger
  fields run per 60 m block), run the pass per 12 m window, keep the blocks, row lines,
  plants and classes in ground coordinates.
- The row model the sweep and the candidates read (`RowModel`) is built from the blocks,
  so nothing downstream changes shape; off-row and between-plants blobs become candidates
  with `kind` "off-pattern", measured area, distance to the row and the block they sit in.
- Off the main thread: the pass runs in a Web Worker (`pattern.ts` is pure; the raster is
  transferred). The CSP already allows workers in the report-only policy; the enforced
  header needs `worker-src 'self' blob:`. The scout's other stages follow later.
- Run state stays in `runStore.ts`, abortable, surviving tab switches.

### Phase 2. The screen (3 to 4 days)
The scan results screen exists (spots worst first, keep / remove / unsure, build mission).
It gains the field read and the pattern layer:
- **The field read**, three lines above the list: the crop pattern found (rows at N cm,
  plants N cm apart, N plants in N blocks, or "no row pattern: findings are by region"),
  the weeds found (count, area, share of the field), the ground that is not crop (bare,
  thin, wet). Numbers in the grower's units. Never the method.
- **The pattern layer** on the map: row lines per block as faint lines, crop plants as
  small dots in the crop colour, findings as the existing markers. A toggle, off by
  default on Field View, on by default on the scout map.
- **Rows run this way**: one control on the map, two choices when the pass found a square
  grid, which re-runs the placement only (seconds).
- Findings list: off-pattern plants grouped by block and size, regions as today. The
  describer's sentence says where the plant sits ("between two trees on row 7, 1.1 m
  across") instead of a z-score.
- CloserLook draws the row lines and the plant circles over the original photo, from the
  photo pass (phase 3) or projected from the map pass until then.

### Phase 3. The original photos for the small weeds (4 to 5 days)
- For scans with a manifest and a reconstruction: choose the photos that cover each row
  block (`select.ts`), download at native, run the pass per photo in the worker, keep only
  windows whose block matches the map's block (same direction and spacing within 10%), and
  project every off-pattern blob to the ground with `pixelToGround`. A blob seen in two
  photos is one finding; the photo that holds it nearest its centre is its source.
- Budget: a 20 ha scan at 36 m is 150 to 300 photos; at 5 s each that is 15 to 25 minutes
  on one thread. So: run in the background after the map pass has already shown its
  results, four workers, photos ordered by how much row block they cover, with a progress
  line "reading photo 40 of 220" and the list growing as they land. A grower on a slow
  connection gets the map result immediately and the photo result when it arrives.
- Imported maps and scans without originals stop at phase 1 and say so in the field read.

### Phase 4. Persistence and the record (2 days)
- A finished run is saved, not recomputed per visit: `scan_patterns` (one row per scan:
  blocks with direction, spacing, phase and row lines in ground coordinates; plant spacing;
  counts; the pass version and parameters) and `scan_findings` (one row per candidate:
  geometry, kind, class, area, distance to row, block, source photo and pixel, score).
  Verdicts stay in `weed_observations`, joined by `candidate_id`, exactly as today.
- `odm_tasks.ai_analysis` gains `source: "weed-scout"` beside `"treatment-grid"`, and
  `ScanTimeline`, `ReportsTab` and `compareGround` accept both. This is the promotion gate
  the memory notes call "held on the report's source".
- The scan card shows the field read once the pattern is saved; the report carries it.

### Phase 5. Promotion out of developer mode (1 day, after a flown field)
- The scout becomes the "Treatment" tab for everyone; the Treatment Grid stays reachable
  from Settings for the fields that already carry one, and its stored state is untouched.
- Photo Scout stays as a developer tool: the same engine on one photo, for tuning.
- Gate: one flown field reviewed end to end by the founder (scan, field read, findings,
  verdicts, mission built, record written), and the benchmark table not worse than today.

## The founder's own list (2026-10-08, evening)

His notes name five phases of his own: 0 master row crops in every condition including the
non-obvious ones; 1 the ortho pass with the source photos checking the bigger weeds; 2 the
single-image finding display stitched onto the map; 3 the detection system running this
model; 4 speed. Against this plan: his 3 is phase 1 here; his 1 is phases 1 and 3, less the
double-check of the map's own large findings against the photo; his 2 is phase 3 plus the
closer-look pattern view (done the same evening); his 0 and 4 are not started, on his word:
"hold off on speed", "first let's master real crops". A conditions suite for row crops
(corn, soybeans closed along the row, twin rows, curved rows, emergence, heavy weeds,
residue, broadcast) was drafted and set aside unrun.

## Where it stands (2026-10-08, end of the build day)

All five phases are in main. Nothing has run on a real scan in a browser: every phase was
verified by unit tests (synthetic rasters, the real reconstruction fixture) and the
58-frame benchmark. The first real scan will show whether the tile fetch, the worker and
the photo download behave; the pipeline falls back to the older row fit when the pattern
finds nothing, and both passes fail soft with a note. The benchmark is the regression
gate for the pass itself.

## The first real scan (2026-10-08, late)

The founder ran the orchard scan. What it showed, and what was done:

- "No row pattern was read" on the map, so the old by-area findings (dense vegetation,
  patch unlike the field) stood over the trees. The built worker was checked in a headless
  Chrome against the deployed bundle: it answers in 2 s for a map window and 8 s for a whole
  photo, so it is not the worker. The run notes now say why the pass read nothing (windows
  with rows, trusted fit windows, missing tiles, failed windows, pixel size, the pass's own
  word), and a window that fails no longer ends the pass. The reason itself is still owed
  by the next run's notes.
- The save failed on a NOT NULL summary: migration `20261008210000`.
- The photo pass read 71 photos and found nothing: the pixel buffer was transferred to the
  worker and then read for the chip. Copied now.
- The closer look read a three-spacing cut, too small for the pass to fit rows on an
  orchard. The founder asked for the photos to be processed during the analysis, once an
  anomaly is found, not one at a time afterwards: done, the photo pass reads the spots'
  photos first and leaves each spot its look (`Candidate.look`), and the closer look opens
  on it.

## Order and what the founder decides

Phases 0 and 1 first: they make the scan itself smarter and are invisible until the screen
shows them. Phase 2 is the visible product. Phase 3 is accuracy on small weeds and can
ship after. Phase 4 before 5.

Decisions owed by the founder before phase 2: the three lines of the field read (wording),
whether crop plants are drawn on Field View at all, and the unit of "share of the field".
Before phase 3: whether photo reading may run in the background on a metered connection
(proposal: ask once per scan, remember the answer).

## Status

| Phase | Status |
|---|---|
| 0 | **done** 2026-10-08 (e353618): square-grid tiebreak by brightness once per photo with `rowAngleDeg` override, stray blocks dropped, doubles merged, blocks on the result, `npm run bench:pattern`. Vineyard agreement 0.75 to 0.90; doubles 206 to 100 and 151 to 39. Two vineyard frames (0014, 0031) still read across the wire: brightness favoured across there, the override is the fix. |
| 1 | **done** 2026-10-08: `lib/weedScout/fieldPattern.ts` plans windows at the baked zoom nearest 5 cm/px, reads each through `photoScout/runPattern.ts` (a Web Worker, inline fallback), and puts blocks, settled row lines and plants in lat/lng; `pipeline.ts` stage "pattern" stands for the row model, the sweep measures against the settled lines, and a new candidate kind "between plants" marks on-row blobs the pattern placed no crop plant at. Params `pattern`, `rowSpacingAuto`, `rowAngleDeg`. Tested on a synthetic georeferenced orchard. Not yet run on a real scan in the browser. |
| 2 | **done** 2026-10-08 (14acf40): `FieldRead.tsx` (three lines in the grower's units, never the method), `PatternLayer.tsx` (row lines per block, crop plants as dots from zoom 19, legend toggle), "rows run this way" on a square grid (re-reads with `rowAngleDeg`), pattern and spacing-search switches in settings, the pattern's numbers in run details. CloserLook overlay not done: deferred to the photo pass, which has the photo's own pattern. |
| 3 | **done** 2026-10-08, revised late that night (spots' photos first, each spot keeps its look, the buffer is no longer handed away): `lib/weedScout/photoPass.ts`. After the map pass shows its result, `runStore` reads the kept originals one by one in the worker (`maxPhotoReads`, 150 by default, the photos covering most of the field first), carries each off-pattern blob to the ground through the pose, keeps only blocks that agree with the map's pattern (10 degrees, 15 percent), drops plants the map pass already has or another photo already gave, and hands the rest over as candidates with a chip cut from the photo itself; the tab shows "Reading photo N of M, K more plants" with a stop. Skipped when the browser asks to spare the connection (`saveData`, 2g); the once-per-scan question was not built. Geometry tested on the real reconstruction fixture; not yet run on a real scan in the browser. |
| 4 | **done** 2026-10-08: migration `20261008150000_scan_scout_runs.sql` (applied to the linked project the same day): `scan_patterns` (one row per scan: pattern + slim result + summary, pass version `weed-scout-v3-pattern`) and `scan_findings` (one row per candidate, the candidate minus its chip), owner-scoped. `runCache.ts` saves after the map pass and again after the photo pass, `restoreRun` loads on opening a scan with nothing running; the tab says the result was restored and that spot pictures are not kept; the scan card carries a Weed Scout line (rows, plants, spots). Verdicts stay in `weed_observations`. NOT done: `ai_analysis` source "weed-scout" and the readers (ScanTimeline, ReportsTab, compareGround): the grid keeps that column; the scout's record is its own tables. |
| 5 | **done** 2026-10-08, on the founder's instruction to run every phase in one day, so WITHOUT the flown-field review the gate asked for: `weedScout` defaults to on (a stored false keeps the grid), the Treatment Grid stays reachable from Settings section 5 with its state untouched, and the Weed Library and Photo Scout sit behind a new `developerTools` flag. The scout's tab badge says "Closed testing". Still owed: one flown field reviewed end to end in the browser (scan, field read, findings, verdicts, mission, record), which no phase here has had. |
