# Field Twin: adaptive intelligence map (2026-10-27)

The Field Twin page redrawn around one question: where are the significant problems in this field? The default
view is a weed-pressure heatmap on fixed bands over the ground the photographs could observe, with the regions that
stand clearly apart outlined and labelled. An **Explore findings** control ranks the actual objects (largest
candidates, biggest patches, highest pressure, most extensive regions, highest confidence, on or between rows), an
adaptive prominence rule decides how many the map emphasises, and a results panel lists every qualifying finding.
Zooming in reveals the measured outlines and the photographs, as before.

Everything upstream is unchanged: the Swardus Direct georeferencing, the detections, the reconciled objects and
their measurements, provenance, rows and trees, the bundle format, saving flows, the orthomosaic workflows. The
engine ranks and aggregates what the bundle already holds; nothing is estimated for display.

Brief: Yunus's "Swardus Field Twin, adaptive intelligence map" (the earlier request of the same session, rows that
seemed to run out of the field and a more vibrant, effect-free look, is folded in: see "Rows" below).

## What is on screen

| Zoom | What it shows |
|---|---|
| Field | the heatmap (verified cover as a share of observable ground, 4 m cells interpolated), hatched ground no photograph saw, canopy cells in the crop tone, the emphasised regions outlined and labelled, the rows, the block and the imagery hull; with a filter active, markers for every qualifying finding in view (count badges where they crowd) and labels for the emphasised ones that fit |
| Row | crowns, the 1.5 m patches of two or more candidates, the heatmap lighter underneath, region boundaries thinner |
| Plant | every measured weed outline and crown, other vegetation, the heatmap faint; a selected finding's boundary in white |

The legend sits in the status strip: the five cover bands, "under canopy" and "not observed".

## Metrics, kept apart

| Metric | Computed from | Where it appears |
|---|---|---|
| Weed size | one candidate's measured `areaM2` | Largest individual weeds, Near crop rows / between rows |
| Patch footprint | the convex hull of a connected patch's members' extents (four points per candidate), never less than the summed cover | Biggest weed patches (the ranking value) |
| Summed cover | the members' areas added | listed beside the footprint, never ranked by |
| Pressure | verified cover ÷ observable ground of a region's cells (cells under canopy and ground no photograph saw are excluded from the denominator) | Highest weed pressure, the heatmap |
| Affected ground | a region's cells' area, however dense | Most extensive affected areas |
| Model confidence | the detector's score for one candidate | Highest confidence; photograph agreement (seen in n of m, size agreement) is listed beside it, not mixed in |

A patch is a connected set of two or more verified candidates whose extents are within 0.75 m of each other
(union-find over the grid index). A candidate is one reconciled object already (its photographs were merged
upstream), so a patch counts it once; a candidate belongs to at most one patch. Single-sighting candidates and
detections on tree crowns are never findings; the panel says how many were left out and why.

### Observable ground

`pressureGrid` now samples each 4 m cell on a 3 × 3 lattice against the tree crowns: `observable` is the share of
the cell not under a crown, `observableM2` its square metres, and `coverPct` is cover over that, not over 16 m².
A cell with less than 25 % observable ground is `canopy`: its count and square metres are kept, its percent is not
claimed, the heatmap paints it in the crop tone and the smoothing skips it. Ground no photograph covered has no
cell at all and stays hatched. Neither is ever drawn as weed-free. On the apricot twin two cells are canopy (the
crowns are 1.1 m on a 5 m × 3.1 m planting), so the change is small there; on a closed-canopy orchard it is the
difference between "no weeds" and "could not see".

## The prominence rule

`prominence(values, uncertainty)` in `lib/fieldTwin/findings.ts`, deterministic and tested:

1. Nothing qualifies: none. One qualifies: that one.
2. Each value is discounted by its uncertainty, v′ = v × (1 − min(0.9, u)): `sizeCv` for a weed (how far the
   photographs disagree on its size), the members' median for a patch, the share of cells seen once for a region.
   The order stays the order of the measured values; the discount only decides breaks.
3. Walking down the top of the list (at most 24 steps), the first place where a value is at least twice the next
   is a break. The findings above it are the emphasised set ("dominant", with the ratio reported).
4. No break: the findings are similarly significant ("similar"). All of them are emphasised and the map's job is
   to summarise them at the current zoom, never to drop some.

No importance score: the ranking value is one named metric, the break is a ratio, the discount is the measurement's
own uncertainty, and the panel prints which rule applied ("22 stand clearly apart, next one 2.7× smaller").

### Visual budget, separately

Prominence says how many; the renderer decides what fits:

- **Bins per integer zoom.** The qualifying findings are binned once per query into screen-space bins of 44 px at
  each integer zoom from 10 up (world-anchored, so a bin's members do not change between integer zooms); the bin
  holds its count and its top-ranked member. Finer levels stop once nearly every bin holds one finding, and from
  there the points are drawn directly. Each level has its own grid index, so a frame touches only the bins in view.
- **Hysteresis.** The level in use changes only when the zoom has clearly left its range (0.15 past the edges),
  so a small zoom does not flip markers between grouped and single.
- **Markers.** One finding in a bin: a ring on the object (white ring too when emphasised). Several: a count badge;
  clicking it zooms two levels in. Regions are never binned (they have boundaries and a centre each).
- **Labels.** For the emphasised findings in rank order, each placed only where it does not overlap one already
  placed and stays on screen; a bin label carries its top member's label with "+n". The panel reports "x of y
  emphasised labelled at this zoom". The list in the panel is the complete set regardless.
- **Boundaries.** Regions: in the overview only the emphasised regions are outlined (the heatmap carries the
  rest); under the pressure and extent filters every region in the list is outlined, the emphasised ones firmer.
  Patches: their hull once it is over four pixels across.

## Explore findings

Modes: Overview (regions by total verified cover; the default), Largest individual weeds (least cover threshold),
Biggest weed patches (least footprint), Highest weed pressure and Most extensive affected areas (regions are
connected cells at or above a chosen cover percent, 1.5 % by default), Highest confidence (least score), Near crop
rows / between rows (the relationship the twin already holds; also available as a modifier on the weed and patch
modes). The results panel: count, the rule that applied, sort (rank, size, confidence, candidates), 50 rows at a
time with "show more", each row the ranking value and the other metrics named, the excluded counts with reasons,
"Clear filter", and the empty state with why nothing qualified. Selecting a row zooms to the object and highlights
it; a weed opens its inspector (measurements, confidence, the photograph crops), a patch or region its own panel
(a patch lists its members, each a click away).

## Rows

Rows are drawn from the first observed tree to the last (`buildScene`), not along the bundle's line, which reaches
half a plant spacing beyond them. That margin belongs to the block, which keeps it; a line running past the last
tree was what read as a row leaving the field. The block fill is a step warmer than the observed ground so the rows
read as inside it. Rows 9 to 14 of the apricot twin really do run 30 m further south-east than rows 1 to 8 (their
observed trees do), so the block's stepped end is the field, not an error.

## Performance

Designed in, measured in the browser (Playwright over the installed Chrome, 1440 × 900):

- The heatmap is a raster built once per twin (1 m per pixel and one per cell) and drawn with one transformed
  `drawImage` per frame. The 971-cell wash of per-cell fills is gone.
- Crowns, outlines, cluster discs and rows are batched into one path per colour and filled or stroked once.
- The grid index is a counting sort into one array (no Map, no string keys), so a million points index in tens of
  milliseconds. Findings are projected and binned once per query; a frame reads the bins of one level in view.
- No blur, no per-frame pattern over the viewport (the hatch is clipped to the imagery hull), no hover redraw,
  no per-object DOM. The results panel pages its rows.
- `?synthetic=N` on the dev preview builds a seeded field of N observations (`lib/fieldTwin/synthetic.ts`:
  hot spots and scatter, rows and up to 20,000 trees, overlapping footprints); `scripts/directGeoref/twinBench.mjs`
  times it at 1,000, 10,000, 100,000 and 1,000,000.

### Before and after, synthetic fields

"Before" is commit ca2ff6a (the zone fills and the per-cell wash) run from a clean worktree with the same generator
and the same harness; "after" is this build. Ready = page open to twin ready (generate, parse, intelligence, scene).
Draw = the renderer's own median over ten redraws of the same view. Pan = frame time of a 240 px pan step
(one display frame is 11 ms). Filter = time to rank the whole field. `data/direct-georef/twin/bench/{before,after}.json`.

| Observations | Ready before → after | Field draw | Row draw | Plant draw | Pan field / row / plant | Heap |
|---|---|---|---|---|---|---|
| 1,000 | 0.51 s → 0.48 s | 0.6 → 0.6 ms | 0.8 → 0.4 ms | 0.2 → 0.3 ms | 11 / 11 / 11 → 11 / 11 / 11 ms | 45 → 46 MB |
| 10,000 | 0.55 s → 0.42 s | 1.6 → 0.8 ms | 1.3 → 0.5 ms | 0.9 → 2.1 ms | 11 / 11 / 11 → 17 / 11 / 17 ms | 54 → 53 MB |
| 100,000 | 1.33 s → 0.91 s | 12.0 → 7.8 ms | 3.0 → 0.9 ms | 0.7 → 0.7 ms | 23 / 11 / 11 → 23 / 17 / 11 ms | 167 → 166 MB |
| 1,000,000 | 23.8 s → 4.7 s | 123 → 95 ms | 6.1 → 0.7 ms | 0.6 → 2.0 ms | 186 / 30 / 24 → 133 / 11 / 11 ms | 700 → 697 MB |

The 1,000,000 case before: the pressure grid tested every cell against every photograph (217,800 cells × 1,400
footprints) and the indexes were string-keyed maps; after: footprints bucketed, indexes counting-sorted. Its field
view still costs 95 ms a frame: 16,800 tree points, 396 region boundaries and 258 rows for a 330 ha field seen
whole, which is the next thing to tile if such fields become real. Everything closer in is one display frame.

Filters, after (rank time for the whole field; the list is complete every time):

| Observations | Largest weeds | Biggest patches | Pressure | Extent | Confidence | Rows |
|---|---|---|---|---|---|---|
| 1,000 | 0.5 ms (727) | 3 ms (85 patches) | 0.1 ms (2) | 0.2 ms | 0.4 ms | 0.1 ms |
| 10,000 | 2.4 ms (7,053) | 16 ms (658) | 0.1 ms (11) | 0.2 ms | 2.5 ms | 1.1 ms |
| 100,000 | 26 ms (70,063) | 86 ms (9,568) | 1.6 ms (172) | 1.6 ms | 24 ms | 11 ms |
| 1,000,000 | 311 ms (699,694) | 868 ms (95,023) | 19 ms (1,072) | 16 ms | 314 ms | 124 ms |

The patch linking first joined every point to every neighbour in reach; inside a synthetic hot spot that is a
thousand neighbours a point and the million-point run never finished. It now joins points per fine cell and tests
neighbouring cells only until their first link (0.87 s at a million).

### The apricot twin (9,643 weeds, 1,040 trees, 71 photographs)

`data/direct-georef/twin/shots/benchmark.json`, before in `shots-before-adaptive/`:

| | Before | After |
|---|---|---|
| Draw, field view | 0.7 ms (971 cell fills, 21 zones) | 0.5 ms (heatmap, 1 boundary) |
| Draw, row view | 1.6 ms | 1.2 ms |
| Draw, plant view | 0.3 ms | 1.0 ms (the heatmap stays underneath, faint) |
| Pan, any level | 11 ms | 11 to 14 ms |
| Zoom step, worst settled frame | 24 ms | 39 ms |
| Filter: largest / patches / pressure / extent / confidence / rows | – | 2.2 / 16 / 0.6 / 0.5 / 2.2 / 2.9 ms |
| Qualifying → emphasised (rule) | – | 4,356 → 22 (dominant, next 2.7× smaller); 835 → 835 (similar); 13 → 13 (similar); 13 → 1 (dominant); 4,356 → 4,356 (similar); 4,356 → 22 (dominant) |

Screenshots: [surroundings](field-twin-adaptive-map/surroundings.png), [field](field-twin-adaptive-map/field.png),
[row](field-twin-adaptive-map/row.png), [plant](field-twin-adaptive-map/plant.png),
[inspector](field-twin-adaptive-map/inspector.png); filters: [largest weeds](field-twin-adaptive-map/findings-largest.png),
[biggest patches](field-twin-adaptive-map/findings-clusters.png), [highest pressure](field-twin-adaptive-map/findings-pressure.png),
[most extensive](field-twin-adaptive-map/findings-extent.png), [highest confidence](field-twin-adaptive-map/findings-confidence.png),
[near rows](field-twin-adaptive-map/findings-rows.png), [the top patch selected](field-twin-adaptive-map/findings-selected.png).

## The detail dial (2026-10-28)

The row view with a filter on was confusing: count badges for every qualifying weed sat on top of the cluster
discs that already drew the same weeds, with 1,040 crown rings, the rows, the heatmap and the labels all at the
same weight, and two control panels open before anything was asked for. The fix is one control, the **Detail**
dial, with three stops. Nothing in the engine, the prominence rule or the results panel changed: every qualifying
finding stays in the list at every stop.

| | Simple (default) | Standard | Full |
|---|---|---|---|
| Heatmap, block, boundary, hatch, surroundings | yes | yes | yes |
| Rows | thin, as orientation | yes | yes |
| Tree crowns | plant level only | yes | yes |
| Weed groups (row-level discs) | no | yes | yes |
| Weed outlines (plant level) | yes, always | yes | yes |
| Other vegetation | no | yes | yes |
| Finding markers | emphasised only | emphasised, plus count badges where the findings are not drawn as themselves | every qualifying finding, badges everywhere |
| Controls | dial, Show, the rule sentence | plus thresholds and a collapsed Layers panel | Layers open, Diagnostics, centre coordinates |

The one rule behind the badges (`badgesAllowed` in `style.ts`): **a count badge summarises findings only where
they are not drawn as themselves**. Weeds are drawn as themselves once the row-level discs or the plant-level
outlines are on screen; patches once the typical one's boundary reads as a shape (4 px of reach). Full keeps the
badges everywhere so the complete picture is still one click away. The same policy drives hit-testing, so a click
lands on what is drawn. The stop is remembered per browser (`swathwise:twin-detail`); a layer toggled by hand
turns the dial to "Custom" until a stop is chosen again; the dev preview takes `?detail=simple|standard|full`.

Row view, "Largest individual weeds" on, the busiest spot of the apricot twin (same view at every stop):

| Stop | Draw | Drawn |
|---|---|---|
| [Simple](field-twin-adaptive-map/detail-simple.png) | 0.4 ms | heatmap, 14 rows, 6 emphasised rings with labels |
| [Standard](field-twin-adaptive-map/detail-standard.png) | 1.6 ms | plus 437 crowns and 1,895 weed discs; no badges, the discs are the weeds |
| [Full](field-twin-adaptive-map/detail-full.png) | 0.9 ms | plus 197 count badges and 25 single markers (the picture before the dial) |

## Opening a twin: bytes to first frame

`scripts/directGeoref/twinOpenBench.mjs` reads phase marks the page records (median of four runs, apricot twin,
local dev server, so the fetch is a lower bound). `data/direct-georef/twin/bench/open.json`.

| Phase | ms |
|---|---|
| Page open to first frame drawn, total | 491 |
| Fetch of twin.json (8.7 MB, local) | 31 |
| JSON.parse | 24 |
| parseTwin (the bundle checks) | 5 |
| Field intelligence (block, 1,749 cells, zones, clusters) | 28 |
| Scene (projection, packed outlines, indexes) | 16 |
| Heatmap rasters | 7 |
| First draw | 11 |

The computation after the bytes arrive is about 120 ms; the rest of the half second is the page and its modules.
What will dominate for a real user is the transfer, which the dev server hides:

| twin.json | Size | At 5 Mbit/s (rural) | At 50 Mbit/s |
|---|---|---|---|
| As stored today | 8.7 MB | 14 s | 1.4 s |
| gzip | 1.7 MB | 2.7 s | 0.3 s |
| gzip after compacting rings and evidence outlines (estimate) | ~0.6 MB | ~1 s | ~0.1 s |

Where the bytes are: weeds 8.0 MB of the 8.7 (outline rings 2.8 MB as eight-decimal latitude/longitude pairs,
13 points a weed; photograph-crop outlines 2.7 MB for 13,999 crops; the measurements themselves 2.4 MB), trees
0.6 MB. The 52 MB of atlases are never on the critical path (a crop is fetched when inspected).

Where it can be optimised, in order of return:

1. **Compress the bundle at rest** (store `twin.json.gz`, inflate with `DecompressionStream` in the page): five
   times fewer bytes, no format change, one line in the store and one in the loaders.
2. **Rings as centimetre offsets from the weed's centre** (small integers) instead of absolute eight-decimal pairs:
   about four times smaller rings and a faster `JSON.parse`; `buildScene` would reconstruct the absolute ring.
3. **Crop outlines out of the critical path**: the evidence `poly` is only read by the inspector; move it to a
   sidecar fetched with the atlas, or cap it at twelve points.
4. **Columnar weeds** (typed arrays, one object per field instead of one per weed): halves the heap and the parse
   time at 100,000 and beyond; the engine and the renderer already work on typed arrays, only `parseTwin` and the
   inspector read objects. Worth it when fields of that size exist.
5. The page itself: the Field Twin route is already lazy; Leaflet and the view chunk are the remaining fixed cost.



## Tests

`src/test/fieldTwinFindings.test.ts`: the prominence rule (none, one, a break, no break, uncertainty cannot make a
break, only the top of the list is searched) and the brief's ten scenarios: one dominant cluster; several equally
significant; thousands of small candidates (none dropped, binned by zoom); a few exceptionally large weeds; high
pressure on a small area versus moderate pressure on a large one (first by pressure and first by extent are
different regions, with different density and ground); incomplete photo coverage (no cell, no colour, never
"none"); closed canopy (unobservable, excluded from the share, drawn as canopy, the candidate still counted); dense
findings near crop rows (the row filter and its complement); zero findings (explicit empty state with reasons).
Plus: footprint versus summed cover, link distance, confidence ranking with agreement beside it, fixed heatmap
bands, rows ending at their trees. `fieldTwinUi.test.tsx` opens the page, runs a filter, selects a result, hits the
empty state and clears the filter. 45 Field Twin tests in all.

## Remaining limitations

- **Not yet seen by Yunus in his account.** Screenshots come from the dev preview; the eye test on the live twin is
  his (field view, each filter, selecting a result, the row ends).
- **Canopy from circles.** Observable ground uses the planting layout's crown radius per tree, not measured crown
  outlines (the bundle holds none).
- **Patch footprint is a convex hull.** A long, bent patch gets a hull larger than its true footprint; the hull is
  never less than the summed cover, and both numbers are shown.
- **Regions are 4 m cells.** A region's boundary follows the pressure grid; a threshold change recomputes it (cheap)
  but the cells themselves are fixed at 4 m along the rows.
- **Labels at fractional zoom.** Marker bins have hysteresis; label placement is recomputed per draw in rank order
  with a margin, so a label can still appear or go as the viewport moves.
- **A million observations as JSON objects.** The bundle format holds one object per weed; at 1,000,000 the page
  carries a few hundred megabytes of JavaScript objects and the synthetic field draws its weeds as circles (no
  outline points). Beyond that, the bundle itself would need a columnar form; the renderer and the engine would not.
- **The uncertainty layer** (cells seen once) is still a plain fill, drawn only when switched on.
