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
   or a missing tree cannot move it), then grown outward from the clicked trees: a position is accepted only next to
   an accepted tree, close to the layout (re-fitted by least squares as it grows), with soil between neighbours when
   the trees stand apart (a weed strip is green all along), and a step into a new row needs a second tree on it.
   Stretches of row that do not run straight and evenly are dropped. Where two plantings claim the same trees, the
   shorter stretch gives way. Missing trees become gaps.
3. Tree-sized green on no row is reported (orange rings): a row or block not marked yet.
4. The result is the app's own row structure, so Find weeds, Stage 1 and the two-stage prototype use it unchanged.
   With a layout, every picture sent to RF-DETR has the rows painted over with the field's bare-ground colour (each
   crown 0.3 m wider than measured), so the model looks only between the rows. Results are cached apart
   (`|between-rows`).
5. Saved per field (table `field_planting_layouts`, and this browser as a fallback) as the refined lattice's own three
   points, so the next scan of the field needs no clicks.

## Measured on the five orchard frames (stand-in maps; not the orthomosaic)

| Frame | How marked | Rows | Trees found | Gaps | Uncovered tree-sized patches |
|---|---|---|---|---|---|
| DJI_0301 | 3 labelled trees | 8 (reader: 6) | 85 | 22 | 2 |
| DJI_0303 | reader's proposal | 6 | 90 | 13 | 3 |
| DJI_0312 | 3 + 3 clicks, two plantings | 6 (reader: none) | 63 | 10 | 11 |
| DJI_0320 | reader's proposal | 5 | 40 | 6 | 15 (the strip crop and hedge to the west) |
| DJI_0327 | 3 clicks | 5 (reader: none) | 40 | 8 | 7 (a young block to the west) |

Against the hand labels on DJI_0301 (104 trees, 414 weeds, not exhaustive): 95 of 104 labelled trees fall on the rows
(reader: 72), 81 are matched to a fitted tree within 0.6 m. 67 of 414 labelled weeds fall inside the crop band and are
treated as crop (reader: 33); that is the cost of measuring crowns generously.

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
