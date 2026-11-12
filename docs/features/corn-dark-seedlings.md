# Corn: dark seedlings, and where the planting ends (2026-11-12)

Two changes to the corn read, made together because the first needs the second.

- **Seedlings darker than their soil** are now seen (`src/lib/rowCrop/seedlingGreen.ts`). Corn V1's seedling mask
  compared a leaf's green tint with the soil's as a difference of grey levels. Tint shrinks with brightness, so an
  olive leaf half as bright as pale sand passed almost never.
- **The field combination knows where the planting is** (`src/lib/fieldTwin/cornField.ts`, cornField v3). Seeing dark
  plants also means seeing the small weeds of a headland, and each photograph strings some of them into lines. The
  field now asks the located plants themselves whether the ground is planted, and leaves those lines out.

Everything stays review-only, and the crop's identity still rests on the operator's entry ([corn-v1.md](corn-v1.md),
[corn-v1-field.md](corn-v1-field.md)).

## Where it came from

The first corn flight from someone else's field: 123 DJI photographs of corn at V1 to V2 on pale sandy soil, 36-inch
rows, with a weedy headland, turning loops and a grass verge (private imagery, kept off the repository). Corn V1 as
shipped (tag `corn-v1.0`) drew 1 confirmed corn row. Measured on the pixels: 98 % of the seedling pixels were darker
than the soil beside them, by about 66 grey levels, and 0.04 % passed the mask's strong test.

## The dark-leaf rule

For a pixel darker than its local soil (and brighter than 40 grey levels: below that the tint is noise), the tint is
also compared at the soil's brightness: `tint x min(2.5, soil brightness / pixel brightness)` against the soil's tint.
Strong at 24 levels over, weak at 15. It is added to the existing rules, never in place of them: every pixel the
shipped mask keeps is kept, and the hysteresis (a component needs a strong pixel) is unchanged. Strong 24 was the best
of 12 / 16 / 20 / 24 / 28 tried on that flight and on the labelled sets.

Where it applies:

- the whole-frame seedling mask the emergence reader and the plant read share (`SEEDLING_GREEN.dark`);
- **not** the narrow second looks (`SEEDLING_RELAXED`): those windows were chosen and measured without it;
- **not** the plant read on a photograph the green read itself reads as bands or a canopy (establishment, mid or
  late plans over a fifth of the frame) with no seedling stand (`cornV1PlantPoints` in `cornV1.ts`). There the shipped
  mask is already seeing the plants, and the dark green is leaf in shade. Tried without this scope on the three test
  flights checked by eye: on the mid-stage flight a patch one photograph already called a weed candidate (a shaded
  corn leaf, by eye) gained its second vote, and on the day-23 flight one of seven real weeds lost its confirmation.
  With the scope every photograph of those three flights reads exactly as `corn-v1.0` read it. On the flight the
  rule was made for, 122 of the 123 photographs are read with it: the green read took them for a seedling stand or
  for bare soil.

`SEEDLING_V1` is the shipped mask (rule off); `readCornV1(..., { baselineSeedlings: true })` reads with it.

## The planting, from the located plants (cornField v3)

Before the field's rows are grouped:

1. **Planted ground.** Every plant the photographs located is projected to the ground. Plants of a planting repeat
   across the rows at the row spacing; weeds are scattered. Per square of ground (1 m along the rows by one spacing,
   judged on the 3 m by 3 spacings around it, with at least 30 plant sightings) the concentration of the plants'
   across positions on the spacing is measured (0 scattered, 1 all on the lines). Under 0.3 over a connected 40 m² or
   more is scattered ground, and a photograph's row is cut where it runs over it. From 0.5 is planted. Anything else
   (few plants, or between the two) is unknown and left alone. On the flight above the squares fell into two heaps:
   429 at 0.8 and over, 319 under 0.3.
2. **It only ever removes, and only where it has shown it works.** If fewer than a quarter of the judged squares are
   planted, the plants do not show the planting on this flight and nothing is judged by them. That is what happens
   on the mid-stage test flight (45 of 296 squares): its rows are untouched by this rule.
3. **Across the planting.** A photograph's row piece more than 15 degrees off the field's row direction is left out.
   On the lattice it was drawn as a zigzag.
4. **Scraps.** Field rows within 2.5 spacings of each other form a block (the grouping the orchard's cultivated-block
   inference uses, `boundary.ts`). A block under 5 % of the largest block's row length is left out; one that holds a
   confirmed corn row, under 1 %.
5. **Row spacing reported.** Where the spacing the plants repeat at differs from the rows' own estimate by more than
   2 %, the field reports the plants'. The rows are still grouped on the rows' estimate, as before.
6. **Stand gaps.** Over planted ground, the row length the photographs hold is compared with the length that ground
   must carry in every photograph covering it (the read share). Under 0.75 the photographs miss rows and plants that
   are there, a stretch with no plant seen is not evidence, and the field carries no gaps at all, confirmed or
   withheld. It says so once.

`FIELD_V2` is cornField v2's rule set. A build can be asked for the shipped result or for the dark rule alone, to open
beside the present one: `BuildOptions.cornVariant` (`"corn-v1.0"`, `"dark-only"`), `--corn-variant` on
`scripts/directGeoref/buildTwinApp.ts`.

What the field left out is written in the twin's corn notes and shown in the viewer's Corn panel.

## Measured

None of this is ground truth: no one labelled the flight. "Beyond the edge row" is the headland by eye, bounded by the
one row the shipped result confirmed. All three columns are real builds of the 123 photographs through the Field Twin
pipeline in Node (cameras aligned, every photograph read at full size, combined over the field).

| The first flight (123 photographs) | shipped `corn-v1.0` | dark rule only | present |
|---|---:|---:|---:|
| confirmed corn rows | 1 (77 m) | 167 (3,169 m) | 167 (3,019 m) |
| unconfirmed rows | 110 | 345 | 98 |
| row length inside the field: confirmed + unconfirmed | 77 + 2,162 m | 3,168 + 2,005 m | 3,019 + 1,439 m |
| row length beyond the edge row (the headland) | 33 m | 2,133 m | 28 m |
| row length running across the planting | 238 m | 904 m | 32 m |
| stand gaps: confirmed / withheld | 1 / 103 | 63 / 3,472 | none reported (read share 0.57) |
| row spacing reported (36-inch rows are 0.914 m) | 0.910 m | 0.873 m | 0.918 m |
| photographs with no row | 16 | 0 | 0 |
| build time, Node | 594 s | | 668 s |

Inside the field the present result holds 4,458 m of row against the dark-only 5,173 m. The dark-only figure includes
most of its 904 m across the planting; what else went was not separated. Confirmed length inside the field is 95 %
of the dark-only result's: one planted photograph is read as shipped under the scope above, and five rows it helped
confirm are now unconfirmed.

The three test flights of corn that were checked by eye on 2026-11-05 (40 photographs each), shipped against present:

| | photographs reading exactly as shipped | corn rows | confirmed weed candidates | unconfirmed rows | spacing reported |
|---|---:|---|---|---|---|
| Day 15 | 40 of 40 | 12 = 12 | 2 = 2, same places | 4 = 4 | 0.814 = 0.814 m |
| Day 23 | 40 of 40 | 11 = 11 | 7 = 7, same places | 6 = 6 | 0.792 -> 0.761 m (planted at 0.762) |
| Day 45 (mid stage) | 40 of 40 | 10 = 10 | 0 = 0 | 15 -> 12 | 0.783 = 0.783 m |

Day 45 loses three short unconfirmed rows (11 m in all) standing apart from the planting. The plants there do not
show the planting (45 of 296 squares), so its ground is not judged.

The original Corn V1 benchmark (`scripts/rowCrop/cornV1Bench.ts`, the same measures, stored final run of 2026-11-04
against the present code):

| Set | plants on a row | false corn rows | crop called weed | false stand gaps |
|---|---|---|---|---|
| MatchPlant maize, 27 | 78.3 -> 80.2 % | 20 of 114 (17.5 %) -> 25 of 122 (20.5 %) | 1 -> 1 | 12 -> 12 |
| MSDD maize, 696 | 74.5 -> 76.1 % | 113 -> 114 (8.7 %) | 55 -> 54 | 183 -> 183 |
| UAVmulticrop maize, 49 | 60.0 -> 61.8 % | 5 -> 5 (8.1 %) | 24 -> 24 | 6 -> 6 |
| sugar beet entered as corn, 60 | 99.5 = 99.5 % | 0 -> 0 | 2 -> 2 | 42 -> 41 |
| sunflower entered as corn, 78 | 80.1 -> 79.2 % | 14 -> 15 (6.2 -> 6.6 %) | 149 -> 149 | 46 -> 46 |

The one measure worse by more than 2.5 points is MatchPlant's false share of corn rows (3.0 points, 5 rows more).
Utah corn with weed boxes (64): weed candidates 551 -> 541, on a labelled weed 94 -> 92; 61 photographs unchanged.
Our own photographs: emergence (63), establishment (15), mid (40) and late (13) unchanged in every count; very early
(23) rows 676 -> 705, weed candidates 44 -> 43 (no labels; the stored run had 22 of the 23).

## Limits

- The dark rule sees the weeds of bare ground as plants. Inside one photograph (Photo Scout) nothing removes the lines
  strung through them: the planted-ground judgement needs the overlap of a flight.
- A single photograph of such a stand also reports many stand gaps (12,782 over that flight). The field withholds
  them; Photo Scout does not.
- The read is still incomplete on that flight: over planted ground the photographs hold 57 % of the row length, and
  rows at the frames' edges are weaker than in the middle.
- A photograph of dark seedlings that the green read takes for bands is read as shipped (1 of 123 on that flight).
- Up to about one row spacing of headland beside the planting can keep a line: the square there is half planted.
- A second planting across the first (headland rows planted crosswise) is left out as "across the planting". The
  field has one row direction.
- Scattered ground is judged only where plants were located. A bare headland has none, and needs no judging.
- No false-alarm rate on truly bare soil was measured: that flight has no weed-free ground.
- The browser build was not run on that flight (Node only), and the planted-ground figures (0.3, 0.5, 30 sightings,
  40 m²) rest on one flight.

## Seeing it

`scripts/directGeoref/twinReferenceTiles.ts` lays a flight's photographs on the ground through the cameras a build
aligned (one photograph per tile, nothing reconstructed or blended) and cuts them into map tiles beside the twin. The
developer preview (`/dev/field-twin?id=...`) then opens with them under the twin, in the viewer's reference-imagery
pane (Layers, Diagnostics: opacity, swipe, off). Local files only.
