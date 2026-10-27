# Field Twin: visual architecture and progressive zoom (2026-10-27)

The Field Twin page (`/app/field-twin`) redrawn as a field rather than a cloud of detections: a vector map with the
field's surroundings from OpenStreetMap data while it is seen whole, detail that follows the ground scale, one
drawing surface for everything, and a docked inspector with the photographs behind each object. Same bundle
format (`swardus-field-twin-v1`), same apricot twin, no satellite imagery, no orthomosaic in the default view.

Brief: Yunus's "Visual Architecture & Progressive Zoom Redesign", with two additions during the work: the measured
weed polygons stay the plant-level truth and only emerge by zoom (never dots or a heat map in their place), and the
field should sit in real surroundings with a way back to them.

## What is on screen

| Zoom | What it shows | Judged on |
|---|---|---|
| Field (the orchard fits) | the orchard block, the imagery hull, the rows as single lines, weed pressure per 4 m cell along the rows, the heaviest scouting zones labelled, the surroundings fading in as you zoom out | a 4 m cell under 16 px |
| Row | trees as their measured crowns, weed candidates as soft patches of the ground they stand on (count labels once a patch is 28 px), the pressure cells fading out | the median crown 8 to 16 px, a 1.5 m patch 6 to 14 px |
| Plant | every weed candidate's measured outline, every crown, the other vegetation patches, inferred positions dashed; click anything | the median weed 3 to 7 px |

Every threshold is a rendered size of a real measurement in this twin (median verified weed 0.21 m, median crown
radius 1.08 m), converted through metres per pixel at the field's latitude. No zoom number appears in the rules,
and the factors are blends, so a step of zoom fades one representation into the next instead of swapping it.

The ground: charcoal outside, a faint hatch where no photograph looked, olive inside the imagery hull, soil in the
orchard block. The block is derived from the kept rows (half a spacing beyond them, following each row's own
ends), the hull from the photo footprints. The surroundings are OpenStreetMap's tiles under a dark filter, with
attribution; they show roads and places that exist (RP7065 and RP7048 beside this field), nothing invented.

Controls: Layers (crop structure, weed candidates, weed pressure, scouting zones, other vegetation, uncertainty,
photo coverage, surroundings) with the technical layers under Diagnostics (single-sighting candidates, detections
on tree crowns, inferred positions, dropped row candidates, photo footprints, the reference orthomosaic, draw
timing). A locate-field button, a mini-map with the view rectangle, north mark, scale bar in the account's units,
and the view's centre coordinates in the status strip.

## Four kinds of data, kept apart

| | Where | Changed by the display? |
|---|---|---|
| Observations | each object's `evidence` / `members` in the bundle; listed in the inspector under "Observations behind this object" | never |
| Reconciled objects | `twin.trees`, `twin.weeds`, `twin.vegetation`, with their measured outlines | never |
| Field intelligence | `lib/fieldTwin/intelligence.ts`: pressure cells (percent of ground covered by verified candidates, fixed bands), scouting zones (connected cells at 1.5 % or more), clusters (candidates grouped on a 1.5 m row-aligned grid), photo-coverage counts, the orchard block | computed once per twin from the objects |
| Render geometry | `lib/fieldTwin/scene.ts`: zoom-0 projections, packed outlines, cluster discs, row lines | drawing only |

A pressure cell or a cluster is drawn instead of the outlines only while the outlines would be smaller than three
pixels; the outlines themselves are untouched and return as you zoom in. Agreement across photographs is labelled
as what it is ("seen in 6 of 7 photographs that covered it"), never as a verified species.

## Architecture

- **One canvas.** `TwinCanvasLayer` extends Leaflet's own canvas renderer with its path list left empty and `_draw`
  replaced. Leaflet still provides the padded canvas, repositioning on drag, the zoom-animation transform and retina
  scaling; the class draws the scene for the viewport and answers hits itself. Nothing is ever stacked over it, which
  is also what fixed the earlier "cannot click a second weed" bug (a highlight circle had made Leaflet create a
  second canvas on top).
- **Projected once.** `buildScene` projects every object to zoom-0 Web Mercator units into typed arrays and packs
  the outlines flat; a frame is a scale and a translate per point. A uniform grid index per object kind returns the
  viewport's candidates, so a draw touches only what is on screen.
- **No DOM markers, few React renders.** The map holds no per-object Leaflet layers. React re-renders only for the
  layer toggles, the detail level, the status strip and the inspector; the renderer reads layer state and selection
  from its own fields.
- **Rendering is 2D canvas.** It is hardware-composited but rasterised on the CPU; a WebGL path would be the next
  step for fields of several hundred thousand objects. With the index and the detail rules, the apricot twin
  (9,643 weeds, 1,040 trees, 4,663 clusters, 1,749 cells) draws in under 3 ms at every level.

## Benchmarks

`node scripts/directGeoref/twinShots.mjs --base http://localhost:8081` (Playwright over the installed Chrome,
1440 x 900, the dev server's no-sign-in preview `/dev/field-twin`). Numbers from `TwinCanvasLayer.stats` and frame
timing in the page; `data/direct-georef/twin/shots/benchmark.json`.

| | |
|---|---|
| Page open to twin ready (8.9 MB bundle parsed, intelligence and scene built) | 0.76 s warm, 2.9 s cold |
| Draw, field view (971 cells, 21 zones, 14 rows, 1,040 trees) | 1.1 ms |
| Draw, row view (490 crowns, 2,122 clusters) | 1.6 ms |
| Draw, plant view (177 outlines, 31 crowns, 5 patches) | 0.4 ms |
| Pan step (240 px), frame time, any level | median 11 ms (one display frame), worst 20 ms |
| Zoom step of 0.5 from field to plant, settled frame | 8 to 24 ms |
| Layer toggle redraw at plant view | 0.3 to 0.5 ms |

Screenshots (`data/direct-georef/twin/shots/`): `surroundings.png` (the field within its roads), `field.png`,
`row.png`, `plant.png`, `inspector.png` (a weed selected with its two photograph crops).

## Reference orthomosaic (developer diagnostics)

Under Diagnostics, "Reference Orthomosaic" lists the account's own scans with baked tiles. Choosing one draws its
tiles in a pane below the canvas (the twin's ground fill switches off so the imagery shows), with an opacity slider
and a swipe divider (imagery left of it). It is pure display: the twin's coordinates never read it.

- **Source.** The app's existing scan tiles (ODM orthomosaic, `tile` function, the signed-in session's token), the
  same path the Field View uses. Nothing was generated for this: there is no local ODM (the node is remote and its
  token lives in Supabase secrets), and the twin's flight was already scanned in the account.
- **Not verified here.** The page cannot know which scan is this twin's flight; the reviewer matches it by date and
  photo count (71). Its positional accuracy is unverified, and the note beside the control says so.
- **What a comparison would mean.** The orthomosaic comes from the same 71 photographs through ODM's own bundle
  adjustment and GPS placement. Agreement with it is a consistency check between two reconstructions of one
  flight, not independent absolute ground truth. Experiments 1 to 3 already measured the twin's internal
  agreement (soil ties 7 cm held out, trees 8 cm across views).
- **Alignment test, for Yunus (needs the signed-in account):** open the twin, Diagnostics, pick the scan of the
  apricot flight, opacity about 70 %. At plant view compare three things across the field: a tree crown against
  its canopy in the imagery at both ends of a long row and in the middle; a row line along a full row; three weed
  outlines in a weed strip near the block's south-west corner, the centre and the north-east end. Note the offset
  direction and size at each place (the scale bar is beside the mini-map). A constant offset everywhere is a
  placement difference between the two reconstructions; an offset that grows toward the edges or flips between
  legs is a camera-model difference; a tree outline that sits beside its canopy while weeds sit on theirs is the
  crown's height (the twin places crowns at their triangulated height, the orthomosaic at the ground).

## What changed, what did not

- The bundle format, the inspector's measurements, source-photo provenance, the saving flows, the orthomosaic
  workflows and the model outputs are unchanged. `parseTwin`, `store.ts` and the reconciliation pipeline were not
  touched.
- Removed: the zoom-number levels (`detailAt`), the per-object Leaflet layers, the compass-aligned density grid as
  the overview (the row-aligned pressure cells replaced it; `weedDensity` remains for callers).

## Correction pass (2026-10-27, later)

Yunus's visual review of the first screenshots: too dense and technical. What changed, judged against the saved
screenshots in `data/direct-georef/twin/shots-before/`:

- **Field view.** The 21 stair-stepped zone outlines are gone. Each zone is now a filled region with rounded
  corners (its own cells, chained and corner-cut; nothing merged or added), coloured by priority: the three heaviest
  by verified cover in red-orange, the next five in orange, the rest in amber, and only the first priority labelled
  until the rows come in. Pressure is a blurred single-hue wash whose strength is the cover averaged over
  neighbouring cells, so no cell edge is visible. Rows are drawn over the zones, in a quiet grey-violet at 45 %
  until the crowns appear. No tree points, no weed candidates. Before: a yellow mass with 21 labels; after: a block
  with three regions and three labels.
- **Row view.** Only patches of two or more candidates are drawn, at lower alpha; a lone candidate waits for the
  plant level, where its outline is drawn. Crowns in muted green, rows firmer.
- **Surroundings.** A halo on the imagery hull and the field's name while zoomed out, so the selected field is
  unmistakable within its roads; the charcoal outside the imagery is lighter and keeps its hatch, so the field never
  floats in a void at any zoom.
- **Colours.** Rows grey-violet, crop muted green, weeds controlled amber, zones a restrained orange scale,
  uncertainty neutral grey.
- **Inspector.** Opaque panel with sections: identity and state, a plain sentence on what the state means,
  measurements, confidence, the photographs, and technical diagnostics folded away. The layer panel and status strip
  are opaque too.

The field intelligence, the objects and their measurements are unchanged; only the drawing changed. Draw times
stayed under 3 ms (the wash's blur is the costliest step, 2.4 ms at the field view).

## Final polish (2026-10-27, later still)

Palette only, no new effects, after the lag report: the canvas blur, the tile-pane CSS filter, per-hover redraws
and per-drag mini-map updates were removed first (commit ae166b0). Then: surroundings charcoal (#191d1a) with the
OpenStreetMap tiles at 22 % so roads and land use read faintly; field interior #292f27 inside a sage imagery edge
(#879d85) and a warm-white block edge, both muted and 1 px; crop structure sage (#78977c, rows #8aa08c at half
alpha); weeds and the pressure wash one amber (#c58a44, wash alpha 0.03 to 0.2); zones #d77645 / #c58a44 / #a9955f
at 0.3 / 0.2 / 0.12 with a hairline edge on the first two priorities only; zone corners cut three times; panels
flat with a 1 px border. Screenshots before this pass in `shots-prev/`, after in `shots/`. Draws: 0.3 to 1.6 ms.

## Remaining issues

- **Not seen in a real session.** Playwright ran the dev preview without an account; the reference layer and the
  saving flows were not exercised in a browser. Yunus's eye test is owed.
- **Tile usage.** The surroundings use OpenStreetMap's public tile servers under their usage policy (attributed,
  light use). A product should move to a tile provider with a key or self-hosted vector tiles.
- **Tree crowns at the row level are circles**, the planting layout's measured radius; the crowns' actual outlines
  are not in the bundle.
- **Cluster discs** stand in for candidates between 2 and 3 rendered pixels; between 3 and 7 the two blend. The
  disc's extent is the members' spread plus the median candidate radius, never under half a metre.
- **WebGL** is not used; CPU canvas with culling is enough here and would still be at a few hundred thousand
  objects per field, but not for millions without tiling the scene by zoom.
