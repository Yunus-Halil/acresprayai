# Weed pressure: the grade after the crop is taken out of the picture

Built 2026-10-21 on `experiment/weed-vision-preview` from `docs/research/weed-pressure-grading-2026-10-21.md` (three
literature sweeps). Code: `src/lib/weedVision/pressure/grade.ts` (pure), `pressureStore.ts` (per scan), the map layer
`PressureLayer.tsx` and the sidebar `PressurePanel.tsx` (Simple mode and the full view), the painting switch and
comparison in `twoStage/twoStageStore.ts` and `TwoStagePanel.tsx`. Tests `src/test/weedPressure.test.ts`.

## What the operator asked for

Once the row and crop algorithm has run, take the crops and rows out of what the weed model sees, run the weed model,
grade the pressure carefully with no false positives, and tell apart three scenarios: many tiny weeds; one big weed
and several large clusters; one large cluster filling a big share of a tile. "How do we decide high and low pressure,
how much does greenness count, how does the crop factor in?"

## What runs

1. **Find weeds** (unchanged): the rows and crowns are painted with the field's bare-ground colour before RF-DETR, and
   the weeds that land on a row are dropped (`rowBand.ts`, `rowFilter.ts`).
2. **Grade the field** (new, one button under Find weeds): Stage 1 reads the field into 0.5 m cells from the map in
   seconds (imaged share, crop-band share, green share, shadow; `twoStage/stage1.ts`), and the weeds between the rows
   are graded on that grid.

## The grade, rule by rule, and where each comes from

| Rule | What it does | Source |
|---|---|---|
| Cover, not greenness | A cell's metric is weed canopy over the **visible ground** (imaged, off the crop band and crowns). Green only decides what is a plant. | Every threshold people act on is cover; no paper or tool grades by index intensity. |
| Classes by crop group | Wide-row crops: trace <1%, low 1-5, moderate 5-10, **action 10%**, high 20%. Drilled cereals: action 5% barley, 9% wheat, high 15%. Orchards: low <5, moderate 5-10, **action 10%** (apricot and citrus 15%), high 25%. The group comes from the field's crop on file, or from the planting layout (trees). | Turkish ministry integrated-control guides 2022 (maize, cotton, olive, apricot, citrus); German cereal thresholds (Gesunde Pflanzen 2014); Peña 2013; Braun-Blanquet. |
| Scenario 1, many small weeds | Objects per m² beside cover. Two or more objects at 2 per m² or more with a median under 15 cm, before canopy closure, step the cell up one class and tag it "treat while small". | Scattered weeds compete harder than clumped (Norris 2001); late spot spraying 20% efficacy vs 86% early (Allmendinger 2024). The density bar is ours. |
| Scenario 2, one big weed | A single object 30 cm across or more never raises its cell's class; it is a **large escape** point with its size and a seed-risk note. | One Palmer amaranth plant 200,000-600,000 seeds; one plant's seed infested over 95% of a field by year 3 (Norsworthy 2014). The size bar is ours. |
| Scenario 3, one large cluster | The class comes from cover; the field's priority from the patch's area. Patches are touching cells at 5% or more, ranked by area; a priority at 25 m² of ground (ours, labelled so) or at the scheme's high cover. | Peña 2013's 5% boundary; patches persist year to year (Rew & Cussans 1995). |
| Relative cover | weed / (weed + crop) per cell, the crop from the layout's crowns (or the row band without a layout); shown as a yield-loss band from Kropff and Spitters at q 0.54 to 1, only before canopy closure, never as a number to act on. | Kropff & Spitters 1991; Goldsmith et al. 2025 (UAS maize, q 0.2-0.8, mean 0.54). |
| Tiers | **Confirmed** needs corroboration: cover at 5% or more, or three objects, and, when the plants came from photographs, at least one object seen in two photographs. Everything else found is **possible**, drawn dashed and kept for review, never dropped. | No system reaches zero false marks (best 2-5%); a missed weed costs more than a false mark (every source; a sprayer at low sensitivity raised the Palmer seedbank 280% a year). |
| Detection floor | No plant-level claim under four pixels; the floor is stated in centimetres on every grade and smaller objects are counted as below it. | Peña 2015. |
| Not assessed | A cell Stage 1 could not judge (no rows read, partly imaged, mostly crop row, shadow) is hatched: unseen, not weed-free. | Stage 1's reasons. |
| Canopy closure | Read from Stage 1's mean green share (0.85); after closure no step-ups and no loss band, and the grade says it under-counts. | Goldsmith 2025; Allmendinger 2024; Sentera's own stage limits. |
| Painting the crop out, tested | The two-stage prototype can run the same windows with the crop painted out or left in (dropping what lands on the rows afterwards) and reports both counts side by side. | Row edges are the top source of false weeds; painted regions are untested in agriculture and general vision work finds models fire on paint edges (Jain 2022; Dwibedi 2017). |

## After the first eye test (2026-10-21, night)

The operator: "the tiles overlap the crop circles and the rows, we can't have that; what does 'no weeds found, run
Find weeds' mean; the tiles are way too broad." Three changes:

- **The grade reads at 1 m cells of its own** (`PRESSURE_CELL_M`), the spot-spray unit (a 1 × 1 m box per weed with
  nozzle control; the 0.5 to 1 m grids of the UAV weed-map studies), not the 2 m boom-section cell the two-stage
  prototype reads at. Stage 1 is re-read at 1 m when the grid on hand is another size, and the prototype's own layers
  (its cells, candidates and windows) are switched off when Stage 1 was read for the grade.
- **The tint is cut away from the rows and crowns.** The layer erases the row bands and each crown with its margin
  from the tint, so pressure is drawn only on the ground it was measured on and never over a tree.
- **The grade reads whatever weeds the scan has.** The model's plants from Find weeds when it ran; else the scan's
  spots kept as weeds by "Scan this field" with the operator's verdicts applied (`weedObjectsOfScan`); else the
  two-stage windows. A weed on a crop row by the field's own rows is the crop whichever system found it. The panel
  says which source the grade came from, and only says "nothing to grade" when the scan truly has no weeds.

- **The cover comes from the map's own pixels.** The second eye test showed weed clumps between the rows with no
  tint: the grade had counted only the scan's ranked, capped list of spots. Stage 1 already measures every green
  thing off the rows per cell from the pixels, so that is the cell's cover (and its blob count); the model's plants
  or the scan's spots add sizes, large escapes and corroboration, and win a cell's cover only where they say more.
  The ground within the row band (half a metre each side of a row line) and 0.3 m around a crown is not assessed,
  and the panel says so; where more than six in ten cells read at the action point, the panel says the alleys may
  be a managed cover rather than weeds.

- **Near the crop is caution, not action** (fourth eye test: red slivers beside crowns; "if it's too near the crop
  we should exercise caution making it red"). A cell with less than half its ground visible (the rest under the row
  band and crowns), or one a crown's 0.3 m margin reaches into, is ambiguous ground: green there may be the crop's
  own rim, and a scrap of ground reads any leaf as high cover. Such a cell keeps its class in the data but is drawn
  at medium at most, and the panel counts and explains them. Cells with under 30% of their ground visible are not
  assessed.
- **A solid border in the cell's colour.** A light fill over green weeds read as green whatever its colour (a green
  tile full of weeds, "how is it not red"); the border makes the band read regardless of the ground.

- **A patch the grid cut reads whole** (fifth eye test: "when there is a red major one and the major one goes into
  another tile that tile now becomes yellow, it's so weird"). A fixed 1 m grid cuts a patch where it likes, so the
  patch's edge lands in a neighbouring cell at a lower cover. A cell beside a high cell that carries weeds of its own
  (cover at the scheme's moderate boundary or over, 5% in most schemes) is marked `buffered` and drawn high with it;
  a cell with only a trace of green beside a patch is not, and a neighbour that is itself near the crop is never the
  reason. Treatment maps buffer a patch for the same reason (Allmendinger 2024; the Wallinga patch-margin rule). The
  class in the data is unchanged; the panel counts the buffered cells and explains them.
- **The cell is 0.5 m** (sixth eye test: "make the tiles smaller for more accuracy, it's already very fast"). The
  finest grid of the UAV weed-map studies, half the spot-spray box; at the map's 4 to 6 cm read a cell is about 100
  pixels, enough to read cover to the percent. The not-assessed floor is a share of the cell (30% visible), so it
  moves with the cell size; the border thins as cells draw small so a zoomed-out field reads as fills, not a mesh.
- **Stage 1 counts off-row cover of any colour** (`Stage1Params.mask`, default `cover`). A cell full of drying
  yellow-green weeds read as low under the vegetation mask's fixed zero, which rejects yellowish cover on purpose for
  the plant masks. The cover mask (`fieldRows.ts coverMask`, anything standing out against bare ground, straw and
  shadowed soil) is what the grade needs: pressure is cover, whatever its colour. The crop paint and row drop are
  unchanged.

## On the map and in the panel

Three light fills and nothing else on the cells (the operator, third eye test: "a lot of chaos; keep it simple: low
green, medium yellow, high red"): low is anything under the moderate boundary, medium is moderate, high is the
published action point and over, so red means act. "Possible" cells are the same colour a little fainter; cells not
assessed are not drawn; large escapes are small diamonds; the clicked cell is outlined. The six classes, the patches
and the not-assessed count live in the panel. The panel gives the field in one line ("N cells assessed; M at
the action point or over (area); priority patches; large escapes; possible, for review"), the scheme with its source,
the legend with counts, the escapes list, the priority patches, the notes, and a card for the clicked cell with its
cover, count, density, sizes, tier and loss band. Never a product rate.

## What is not built, and why

- **Multi-frame consensus on the raw frames.** The photo path already merges a plant seen in several photographs
  (`frames.ts`, `seenIn`), and the tiers use it; a true re-projection vote across overlapping frames at detection time
  is not built. The map run sees each spot once.
- **Blur rejection, per-field confidence calibration, a height gate.** Each needs data the pipeline does not carry
  yet (per-frame sharpness, labelled cells, a surface model). Named in the research as the next levers.
- **Validation.** None of the published precision figures transfer. Owed: one exhaustively labelled field per crop
  group, scored at the 2 m cell, precision and recall reported separately.

Wired and visible: yes (the panel in Simple mode under Find weeds, and in the full view; the layer on the map).
