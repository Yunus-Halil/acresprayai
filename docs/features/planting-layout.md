# Planting layout: where the crop is, so weeds are looked for only between the rows

Built 2026-10-19 on `experiment/weed-vision-preview`. Code: `src/lib/weedVision/layout/` (plantingLayout, readLayout,
rowBand, fieldLayoutStore, layoutUi), `CropRowsPanel.tsx`, `LayoutLayer.tsx`; migration
`20261019120000_field_planting_layouts.sql`; tests `src/test/weedVisionLayout.test.ts`; trial tools
`scripts/bench/layoutTrial.ts`, `paintedWindowLook.ts`, `twoStageTrial.ts --rows layout`.

## Why

**The pattern is the proof (2026-10-21).** The planter follows fixed waypoints at a fixed spacing, so a position on a
kept row is a crop. The fitter does not ask the operator whether a planted position holds a crop; the first version
did, with "?" rings on every pale tree, and the operator answered "a crop" to all of them. A second version drew a red
cross where the crown-scale green was under 0.08; on the real orchard those were small trees whose green fell under
the floor at 8 cm a pixel, 99 of 100 by the operator's eye ("follow the spacing average"), so the fitter now never
calls a planted position empty. One mark on a row: a green ring. A skip is the operator's word alone (a grey cross).
The count of planted positions is the field's stand, read over the whole field rather than interpolated from samples.

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

## The signal under the lattice, and where it holds (2026-10-21)

Built after the literature sweeps in `docs/research/row-crop-detection-methods.md` and measured on the six grassed
olive frames of `docs/research/olive-orchard-fitter-trial.md` (where the fitter had found 3 of 820 trees) and on
DJI_0301 (bare ground, 104 labelled trees).

1. **The mask is excess green minus excess red at a fixed zero** (`fieldRows.ts`, `VEGETATION_INDEX`), not excess
   green with Otsu's split. Otsu assumes two balanced classes and on a scene that is mostly lit ground it paints the
   sward greener than the crowns (DJI_0380: 0.48 inside the labelled crowns, 0.64 outside). The fixed bar reads the
   crowns at 0.88 and the sward at 0.76 on the same frame, 0.94 against 0.82 at tree centres against the midpoints
   between trees. On DJI_0301 nothing changed (94 to 95 of 104 trees matched within 0.6 m; 35 to 36 labelled weeds
   taken for crop).
2. **The crown vote** (`crownVote`): the lattice is fitted and presence judged on green weighed by the spread of green
   and the shadow share within a crown radius; the rings are still measured on the green itself. On bare ground the
   crowns have edges, so nothing changes; on a sward the vote is quieter. Measured on the olive frames, neither texture
   nor shadow told crown from sward at 9 cm a cell (luma spread 23.4 against 23.3, shadow share 0.13 against 0.14),
   and a per-field colour witness learnt from the three marks (blue share and saturation separate olive canopy from
   sward by 0.6 to 0.8 of the field's spread) read the wrong way on one frame of two, so it was taken out. The vote
   stays because it costs nothing on bare ground and helped on the swards once the two rules below held the phase
   (DJI_0380: 55 trees with it, 33 without).
3. **The marks hold the lattice** (`refineLattice`, `latticeHoldM` 0.5 m): a refined lattice that puts a clicked tree
   further than half a metre from a lattice point is not a candidate. The free descent had walked the origin 0.7 to
   1.4 m off the clicked tree on every olive frame, since the score landscape on a sward is flat, and the planting
   followed.
4. **A plant leaves its slot only for clearly greener ground** (`moveGain` 2): the greenest spot in the search box
   takes the plant only when it is twice as green as the slot itself. On a sward the greenest patch is 1.3 to 1.5 times
   the slot and the plants used to walk onto it; a tree beside its slot on bare ground is three to twelve times
   greener, so DJI_0301 is unchanged at any setting.

| Frame | Labelled trees | Found within 0.6 m, before | After (gain 2, vote, hold) | Clicks' lattice alone within 0.6 m |
|---|---|---|---|---|
| DJI_0365 | 143 | 0 | 43 | 37 |
| DJI_0369 | 155 | 1 | 54 | n/m |
| DJI_0380 | 186 | 0 | 55 | 89 |
| DJI_0386 | 115 | 0 | 19 | n/m |
| DJI_0395 | 94 | 2 | 5 | 7 (the clicks were on the wrong neighbour: 6.0 m along for a 5.3 m grid) |
| DJI_0407 | 127 | 0 | 22 | n/m |

198 of 820 against 3. What is left on grass is not the signal but the lattice: a rigid lattice from three clicks
matches only a quarter to a half of the trees within 0.6 m over a 100 m frame (the planting drifts), and on a sward the
growth cannot follow the drift because there is no green contrast to follow. Rings on grass sit at the half-spacing
cap (median 2.4 m) because every crown's green merges with the sward; a ring there says where the planting stands, not
how big the crown is. On bare ground the rings are the crowns (DJI_0301: 98% of the joined green inside the ring).

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

## What stands at each position (2026-10-21: a crop by the pattern unless the ground is bare)

The position is the proof. Where the planting extends is still decided on evidence (stretches, straightness, the
bridged-stretch proof and the density rule are judged on plants seen at or over the bar, and a row never extends past
its last seen plant); inside a kept stretch every position is a crop. Each fitted plant carries a state that says how
much of its own green it had, and the canopy is a measurement apart from the position:

| On the map | State | Rule |
|---|---|---|
| solid green ring | confirmed | green at its place over the bar; canopy at least half the planting's typical one and crown green at least 0.15 |
| dashed green ring | confirmed or expected, canopy uncertain | the crown's green reaches the edge of its cell in half the directions or more: a crown that runs into weeds or a neighbour; drawn round what was measured, painted over for the model at the planting's typical size |
| green ring | expected | a crop by the pattern: a young or pale tree (canopy under half the typical one, or crown green under 0.15), green under the bar, green that stood off the layout or ran to the neighbour (a strip), a plant on a row found at another pitch, or a position with no green seen at all; ringed at the green joined to the slot, between half and all of the typical crown, at the typical size when there is none |
| thick pale ring | operator | the operator said "a crop" |
| grey cross | operator: no crop | the only kind of gap; kept in the field's layout |

No position on a row is drawn as a question or as missing, and the operator is never asked about one. A weed standing
exactly at a planted position is shown as that position's crop (an "expected" ring): the pattern cannot tell them
apart, and the planter did put a plant there. Click a ring to say "No crop" (a grey cross from then on) or a cross to
take that back;
the word is kept with the field's layout and applied at once: a no-crop position is never a plant (the interior scans
respect it too), a crop position is a plant whatever the green. The crown painted over for the model is the measured
canopy, capped, never the merged extent.

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

## Where the fitter fails outright: a grassed orchard (2026-10-19, olive trial)

The same fitter on six frames of a public olive orchard (OliveTreeCrownsDb, CC BY 4.0, Meknes, April, 1.67 cm a
pixel, 820 labelled tree boxes; docs/research/olive-orchard-fitter-trial.md) found 3 of 820 trees. The rows,
spacing and direction were right on every frame (within 0.4 m and 7 degrees of the labelled grid from three
clicks), but every plant landed on the grass between two trees: the vegetation mask lights 64-82% of the sward and
only 36-56% of the silver-green olive canopy, and the fitter's objective is green under the plant and bare between.
Even the clicked trees were moved 1.4-1.9 m off their crowns toward the grass. Since then a mark on green holds
within 0.5 m of the mark (a mark on bare ground is still looked for within 1 m), but that only keeps the operator's
word; it does not find the other trees. The fitter, as built, assumes the crop is the greenest thing on its lattice.
That holds on the bare-soil orchard it was built on and fails on a grass sward. A mask that separates canopy from
sward (texture, shadow, the silver of the leaves) or a tree proposer that does not depend on colour is needed before
grassed orchards are in scope; nothing of the kind is built, and the olive stand-in maps and scoring scripts under
D:\swardus-research\olive are ready to rerun on one.
