# Planting layout: where the crop is, so weeds are looked for only between the rows

Built 2026-10-19 on `experiment/weed-vision-preview`. Code: `src/lib/weedVision/layout/` (plantingLayout, readLayout,
rowBand, fieldLayoutStore, layoutUi), `CropRowsPanel.tsx`, `LayoutLayer.tsx`; migration
`20261019120000_field_planting_layouts.sql`; tests `src/test/weedVisionLayout.test.ts`; trial tools
`scripts/bench/layoutTrial.ts`, `paintedWindowLook.ts`, `twoStageTrial.ts --rows layout`.

## Why

The automatic row reader builds rows tree by tree from green blobs. On the kept orchard frames it found no rows on 2 of
5 and only one block on a third: weed clumps merge with crowns into blobs of up to 77 m², which push its idea of a
"normal plant" so high that real trees are thrown out (33 of 152 kept on DJI_0327), and a frame with two plantings at
different angles cannot pass its checks. With no rows, every green pixel counts as weed pressure and trees are shown
as weeds.

## How

1. The operator marks three trees once per planting (two neighbours in a row, one in the next row), or accepts the
   rows the reader proposes ("They are right").
2. The planting is a lattice. It is refined against the map near the clicks (hundreds of trees vote; a merged clump
   or a missing tree cannot move it). **The spacing is the strongest clue, and the true spacing is the finest one at
   which plants keep appearing**: between two plants that are there, is there another (the clicks skipped a tree)?
   Between two rows that are there, is there another (the clicks skipped a row, or the rows between hold younger,
   smaller trees)? Judged on presence at crown scale with the ground beside the added positions checked to be bare,
   never on average greenness (a lattice that skips every fainter row is greener on average, which is how every
   second row of the real orchard was missed on 2026-10-19). Rows found between the rows are followed as plantings
   of their own, so an interplanted row out of step with its neighbours is still found.
3. The planting is grown outward from the clicked trees: a position is accepted only next to an accepted tree, close
   to the layout (re-fitted by least squares as it grows), with soil between neighbours when the trees stand apart (a
   weed strip is green all along), and a step into a new row needs a second tree on it. Presence is judged in a
   crown-sized box (0.3 m), not a spacing-sized one, so a young 0.5 m crown counts. A planting does not stop in the
   middle of a field: an empty row is stepped over and every expected position near an accepted tree is looked at
   again (the sweep). A stretch of row reached only that way must have six plants sitting tightly on the layout's own
   line with crowns of the planting's size, or it is dropped (across a track, another block's trees or a strip crop's
   edge row can line up by chance). Stretches that do not run straight and evenly are dropped. Where two plantings
   claim the same trees, the shorter stretch gives way. Missing trees become gaps.
   **Rows on both sides and green between them means rows between them.** Every gap between two found rows is scanned
   across for row lines (peaks of the green profile, each standing twice above the valleys beside it, so a young row
   that reads a fifth of an old one still counts and a weedy alley with no valleys does not), and every row line along
   for plants; every stretch between two found plants on a row is scanned along the same way. A row in step with the
   lattice joins it; a row at another pitch or phase (a younger block planted between) stands on its own. A gap
   explained this way joins what lay beyond it to the planting.
   **The marked trees are the truth.** The three clicked trees are plants whatever the green there, and the rows
   they stand in get a presence bar set from the palest of them (half its green, never under 0.08), so a row of pale
   young trees the fitter missed is followed from the marks. The bar is lowered only on the marked rows: lowered for
   the whole planting, it let weed clumps into rows that then failed the straightness check (DJI_0301: 98 to 89 trees).
   Markings on the same planting (same direction and plant spacing, row pitch the same or half, as when an
   interplanted row's next row is at half the pitch) are one planting, fitted on the finer pitch. A fit that gives no
   rows says why in the panel instead of showing the automatic rows in silence.
4. Tree-sized green on no row is reported (orange rings): a row or block not marked yet.
5. The result is the app's own row structure, so Find weeds, Stage 1 and the two-stage prototype use it unchanged.
   With a layout, every picture sent to RF-DETR has the rows painted over with the field's bare-ground colour (each
   crown 0.3 m wider than measured), so the model looks only between the rows. Results are cached apart
   (`|between-rows`).
6. Saved per field (table `field_planting_layouts`, and this browser as a fallback) as the refined lattice's own three
   points, so the next scan of the field needs no clicks.

## Measured on the five orchard frames (stand-in maps; not the orthomosaic)

| Frame | How marked | Rows | Trees found (first build / spacing rule / interior scan) | Gaps | Uncovered tree-sized patches |
|---|---|---|---|---|---|
| DJI_0301 | 3 labelled trees | 8 (reader: 6) | 85 / 92 / 98 (101 with the clicks as anchors) | 12 | 1 |
| DJI_0303 | reader's proposal | 7 | 90 / 94 / 108 | 5 | 3 |
| DJI_0312 | 3 + 3 clicks, two plantings | 7 (reader: none) | 63 / 79 / 85 | 10 | 6 |
| DJI_0320 | reader's proposal | 6 | 40 / 56 / 60 | 4 | 12 (the strip crop and hedge to the west) |
| DJI_0327 | 3 clicks | 6 (reader: none) | 40 / 60 / 55 | 3 | 7 (a young block to the west) |

The spacing rule (section "How", 2 and 3) was added after the real map showed every second row skipped: rows of
younger, smaller trees between the clicked rows. On the five frames no spacing changed (no row or plant was invented
between bare alleys or plants that stand apart) and every frame gained trees, mostly at row ends and in rows that had
stopped early. Two rows that stepped across a track into another block were caught by the bridged-stretch rule.
Synthetic tests cover the failures seen on the real map: clicks that skip the young row between (every row and 85% of
the young trees found, the field's 2.6 m spacing reported), clicks that skip a tree along the row, and a block of
young trees at its own pitch and phase between two blocks of old ones (rows on both sides, none drawn in the middle:
found by the interior scan). DJI_0327 keeps a row of tree-sized plants along the track verge that passed every test;
whether it is a planting is for the operator.

Against the hand labels on DJI_0301 (104 trees, 414 weeds, not exhaustive): 101 of 104 labelled trees fall on the rows
(reader: 72), 80 are matched to a fitted tree within 0.6 m. 76 of 414 labelled weeds fall inside the crop band and are
treated as crop (reader: 33); most of those are under or against a crown, where the model does not see them either.
That is the cost of measuring crowns generously, and it is not measured against anything but these labels.

With the layout, against the old reader, RF-DETR on every window of the five frames (Stage 1 routing in brackets):

| | Old reader | Layout | Layout, rows painted over |
|---|---|---|---|
| Windows Stage 1 sends to the model | 214 / 232 | 199 / 232 | 199 / 232 |
| DJI_0301 high-priority candidates | 6 | 1 | 1 |
| DJI_0312 / 0327 cells uncertain | 100% / 100% | 42% / 72% | 42% / 72% |
| Tree-sized "weeds" shown (0301, 0303, 0312, 0320, 0327) | 26, 22, 79, 36, 55 | 12, 17, 28, 41, 33 | 10, 12, 23, 44, 30 |
| "Weed" area within 1.6 m of a tree (all frames) | | 43 to 121 m² a frame | under 2.1 m² a frame |
| DJI_0301 labelled weeds with a detection within 30 cm | 218 | 218 | 217 |
| RF-DETR time, all windows | 40.5 s | 38.9 s | 35.4 s |

Painting shows 20 to 45% more weeds between the rows than the unpainted run, most of them 1.6 m or more from a tree.
Whether they are real is not known: the labels found no more of them.

## Limits

- Measured on raw photos used as maps (lens curvature bends rows near the edges; the orthomosaic is rectified) and on
  one orchard. Not run on the real map, which needs the signed-in app.
- Colour only: where weeds form a continuous strip along a row, the layout can still be found (DJI_0327 checked at full
  resolution) but a crown is measured larger. A height model from ODM would settle crop against weed; not read yet.
- A block not marked stays unexplained, and its trees can be shown as weeds; the orange rings say where.
- The automatic proposal picked a wrong neighbour row once (fixed: nearest tree in the next row); a fit with under 3
  rows or under 60% of its expected trees is flagged in the panel.

## To test

1. Apply the migration (until then the layout is kept in the browser only): `npx supabase db push`.
2. `npm run weed-vision:service`, dev app, open the orchard, Weed Scout (simple view).
3. Crop rows panel: tick "show on map". If rows were found, check them and press "They are right", or "Mark three
   trees": a tree, its neighbour in the same row, a tree in the next row.
4. Check the cyan lines run through the trees, red crosses sit on missing trees, orange rings show what is not covered;
   mark another block there if it is trees. Press "Save for this field".
5. Find weeds again: the yellow weeds should all be between the rows, none on a tree.

## Weed hotspots between the rows (2026-10-19, later)

With the rows known, the simple view runs in two quick steps: "Find weed hotspots" reads every 2 m cell's green off
the crop rows and crowns from the map (Stage 1 of `twoStage/stage1.ts`, under a second per hectare in the browser,
no model) and draws the hotspots; "Check the hotspots with the model" runs RF-DETR on those cells, the cells it could
not judge, and a few at random elsewhere, and shows its weeds as outlines. Running the model over the whole field
stays as a link.

Measured on DJI_0301 against the 414 labelled weeds by cell density (`scripts/bench/hotspotEval.ts`; a "dense" cell
holds at least 3 labels; labels are not exhaustive, so a flagged cell with no label is not shown wrong):

| Stage 1 | Field flagged | Dense cells caught | Cells with any label caught | "Mostly crop row" cells |
|---|---|---|---|---|
| Before (share of the whole cell, 5% floor, crown area in the denominator) | 7% | 9 of 60 | 12 of 203 | 116 |
| Now (share of the ground off the crop, plus one blob per m² floor) | 23% | 22 of 60 | 50 of 203 | 48 |
| Random at 23% | 23% | about 14 of 60 | | |

Rank correlation of the signals with label density: green share 0.28, blobs per cell 0.37, random 0. A modest,
honest lift: the labels are single small weeds, and a hotspot is a concentration. The next measurement that matters is
the operator's blind cell labels on the real map (the two-stage prototype's labelling mode).

## What the evidence says at each position (2026-10-19, later)

A position proves nothing about what stands there. Each fitted plant carries a state, each expected position without
a plant says what was seen, and the canopy is a measurement apart from the position:

| On the map | State | Rule |
|---|---|---|
| solid green ring | confirmed | green at its place; canopy at least half the planting's typical one and crown green at least 0.15 |
| dashed green ring, no ? | confirmed, canopy uncertain | the crown's green reaches the edge of its cell in half the directions or more: a crown that runs into weeds or a neighbour; drawn round what was measured, painted over for the model at the planting's typical size |
| dashed green ring with ? | probable | only a little green: a canopy under half the typical one, or crown green under 0.15: a young tree, or a weed at a tree's place |
| dashed amber ring with ? | ambiguous | weak green that runs into other green: a crown among weeds, or weeds alone |
| thick pale ring | operator | the operator said "a crop" |
| amber dashed ring with ? | expected position, some green under the bar | a young tree or a weed: the operator decides |
| red cross | expected position, nothing seen | no visible crop evidence; never reported as a dead tree by itself |
| grey cross | operator: no crop | kept in the field's layout |

A plant is questioned only when there is little green (the first version questioned every plant on a row the
operator had marked, and every crown wider than the cap). Each plant is centred on the green mass of its crown, not
on the centre of the greenest spots in the search box, which clipped wide or offset crowns and left the ring on the
lattice point. Click a ring or a cross in the Crop rows panel's map to say "A crop" or "No crop"; the word is kept with the field's
layout and applied at once: a no-crop position is never a plant (the interior scans respect it too), a crop position
is a plant whatever the green. A weed at a tree's place therefore stays a weed unless the operator says otherwise;
the crown painted over for the model is the measured canopy, capped, never the merged extent.

### After the centring and the quieter states (2026-10-19, last run)

| | Before centring | Now |
|---|---|---|
| DJI_0301 labelled trees with a plant within 0.6 m | 85 of 104 | 89 |
| DJI_0301 labelled trees on a row | 100 | 101 |
| DJI_0301 labelled weeds taken for crop | 43 | 37 |
| DJI_0301 plants questioned ("?") | most on marked rows | only plants with little green |
| Trees found, DJI_0303 / 0312 / 0320 / 0327 | 112 / 91 / 56 / 59 | 111 / 80 / 67 / 56 |

The re-centring weighs the crown's own mass and moves a plant at most 0.5 m; unbounded, it pulled DJI_0327's edge
row into the verge weeds (93 matched on DJI_0301, but the row lost). The step-regularity tolerance is 0.35 of the
spacing, since crown-centred plants sit up to half a metre from their slots. DJI_0320's seventh row is the hedgerow
along the road, the field boundary's job on the real map.

## The ring is the crown (2026-10-19, evening)

Yunus: "some circles just don't cover crops". On the stand-in frames the fault was mostly not the size but the place:
the search box around an expected position found the near margin of a crown standing up to a metre off its slot,
the re-centring moved the plant half a metre at most, and the ring (the ring mean of green out of that centre) was
measured from the margin: a 0.7 m ring on a stem or a bare patch beside a 1.2 m crown. Where weeds ran along the
row (DJI_0327), the ring mean never fell under the edge bar, the crown was "merged" and drawn at the planting's
typical size under the real crown: 41 of 56 rings covered less than 80% of their crown's joined green.

Now the canopy is the crown itself: the green joined to the plant (raster green at least 0.25) inside its cell, the
ellipse of the planting's half-spacings around the expected position, so a neighbour's crown is cut off at the
mid-plane (the lattice-seeded, cell-bounded segmentation the crown-delineation survey in docs/research recommends).
The plant moves to that mass (at most 1 m), the ring encloses 95% of it, and "merged" means the mass reaches the
cell's edge in half the directions or more. What is painted over for the model is unchanged in kind: the measured
crown, or the planting's typical one when merged, so weeds in a tangle stay in the model's view (`paint` on each
plant and crop, apart from the drawn `r`).

Measured on the five stand-in frames (the proxy: the share of a plant's joined green within half a spacing that
lies inside its ring; weeds against a crown count against the ring, so it is a floor):

| | DJI_0301 | 0303 | 0312 | 0320 | 0327 |
|---|---|---|---|---|---|
| Rings covering under 80% of the crown, before / after | 19 / 2 of 102 | 16 / 1 of 107 | 22 / 2 of 76 | 16 / 6 of 66 | 41 / 6 of 56 |
| Ring radius, median, before / after | 0.98 / 1.08 m | 1.07 / 1.07 | 1.07 / 1.19 | 1.07 / 1.15 | 0.98 / 1.34 |
| Plants, rows | unchanged | unchanged | unchanged | unchanged | unchanged |

DJI_0301 against its labels: trees matched within 0.6 m 89 of 104 before and after, on a row line 101 both, labelled
weeds inside the crop band 37 before, 36 after. The contact sheets of the worst-covered and the barest rings were
looked at by eye on DJI_0301 and DJI_0327: rings sit on the crowns and round them; the barest rings are the small
"probable" ones on tiny plants and rings round open, sparse young crowns with their shadows. The radius on 0327 is
near the cell's edge for most plants because the crowns there are large and touch the weed strips along the row;
those are dashed. Not measured: crown outlines (no crown labels exist); the olive orchard set in docs/research
(CC BY 4.0, 1.78 cm a pixel, boxes) is the next evaluation.
