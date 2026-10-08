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
| 0 | not started; measured on 58 frames, gaps listed above |
| 1 | not started |
| 2 | not started |
| 3 | not started |
| 4 | not started |
| 5 | not started |
