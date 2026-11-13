# Corn: reading along the rows the field already knows (plan, 2026-11-12)

Status: plan and evaluation rules, written before any of the method. Nothing here is built yet.

## Why

Corn V1 reads each photograph bottom-up: a mask of seedlings, plant points from the mask, rows from the points. The
field combination then joins the photographs' rows ([corn-v1-field.md](corn-v1-field.md),
[corn-dark-seedlings.md](corn-dark-seedlings.md)). A row a photograph missed stays missed in that photograph, although
the field knows the planting's direction and spacing and the rows on either side. On the first flight from someone
else's field (one to two leaves, about 0.6 cm a pixel) the photographs hold 57 % of the row length the planted ground
carries, and a person looking at the photographs sees seedlings on rows with no line drawn.

The information does not flow: the field knows where rows must run and never tells the photographs; each photograph
knows which places looked weakly like a seedling and never tells the field.

## The method, in the order it will be built

1. This document: which fields are for development and which are held out, and the pass marks.
2. Two known causes of lost rows that need no new pixels: a row spacing impossible for the entered crop is refused
   (recorded in corn-v1-field.md as not built), and each photograph is told the field's direction and spacing.
3. Every row the planting must contain, laid out from the rows found and the plants located: "verified" where the
   photographs show plants on the line, "predicted" where the planting requires a row they have not confirmed.
4. A second look along each row in every photograph covering it: a band on the row and a control strip on each side;
   pixels scored against that photograph's own soil with brightness taken out; the bar set from the false alarms
   measured on the control strips.
5. The photographs' candidates merged along the row into one mark per plant, a photograph that covers the place and
   finds nothing counting against it.
6. Settings frozen, the held-out flight run once.
7. Only then: the build, the twin, and the plants drawn as "plants located".

Every setting is in centimetres, a share of the row or seed spacing, or measured from the photograph. None in pixels
or grey levels.

What it will not claim: a stand count (a range at most, and only where recall has been bounded on that flight);
doubles; that a weed standing on the row's line is told from the crop.

## Development fields and held-out fields

The unit is a flight or session (field, date, camera, height), never an image. Every labelled maize set on this
computer was used when Corn V1's constants were chosen (their own comments cite the sets), so none is unseen: they are
regression guards from now on. No set anywhere pairs plant labels with overlapping georeferenced photographs, so the
multi-photograph steps can only be judged on unlabelled flights.

| Data | Role |
|---|---|
| The first independent flight (123 photographs, GPS, one to two leaves, about 0.6 cm; private, not in the repository) | Development |
| UAV3DCrop Day 15, 23, 45 (40 photographs each, reconstruction poses) | Development; results there must not change |
| Our single photographs: very early, emergence, establishment | Development |
| MatchPlant (27 frames, 8,701 boxes), MSDD 2022 test tiles (696), UAVMultiCrop maize (9 French sites) | Development and regression guard |
| The 48 held-out single frames of 2026-11-03 | Spent; regression only |
| G2F College Station 2019, flights of 16 April (emergence to two leaves) and 29 April (public, real GPS, about 0.68 cm, no labels; never run through any corn reader) | **Held out** |
| A participant's flight, the first time it is built | **Held out**: built once with the settings as they stand, the result recorded before anything is changed |
| Public sets not yet downloaded (EWIS1 unlabelled maize flights; the Seedling-DETR set) | Held out if obtained |

Rules:

- The held-out flights are not opened, drawn or run until the settings are frozen in a tagged commit. They are run
  once. If the method changes afterwards they become development fields and new ones are needed.
- A flight too large to build whole is cut by a rule fixed here, before it is looked at: the first 150 photographs in
  file-name order of each held-out date.
- Each new setting has a reason other than "it made one field look right": a physical quantity, a share of the row or
  seed spacing, or a statistic of the photograph itself. Each is swept 25 to 50 % either side on every development
  field separately; a setting whose best value differs between fields is fitted, not found.
- Comparisons against stored results run in Node with the same decoder. A few rows' difference on single photographs
  between decoders is decoder noise (corn-v1-field.md).

## Pass marks, fixed before the run

| Measure | On | Mark |
|---|---|---|
| Verified row length over planted ground, as a share of what the planted ground carries | each held-out flight | at least 0.90 |
| Verified row length on scattered ground, or more than 15 degrees off the field's direction | each held-out flight | at most 2 % of verified length |
| Marks per metre on the control strips over marks per metre on the rows | each held-out flight | at most 0.05 |
| Marks agreeing between a build from the odd photographs and one from the even (within half the seed spacing) | each held-out flight | at least 0.80 |
| Seedlings a person can see in the photograph that hold a mark, on windows drawn before any output is seen | each held-out flight | lower bound at least 0.80 before the marks are called a stand |
| Count per 1/1000 acre of row against the same windows | each held-out flight | error at most 10 % to show a count; 10 to 20 % a range; above 20 % none |
| Corn rows and confirmed weed candidates on the three test flights | Day 15, 23, 45 | unchanged |
| Any stored measure on a labelled development set | MatchPlant, MSDD, UAVMultiCrop | no worse by more than 2 points |

The windows are counted by the developer in the full-size photographs, never by the field's owner. They measure the
seedlings a person can see at this pixel size; a ground count on the day of the flight would be needed for the rest.

Two label-free figures bracket plant recall on every flight and are reported with it: from above, how often a plant
found by one half of the photographs is found by the other half (optimistic: a seedling no photograph can see is never
counted); from below, the share of expected seed positions along verified rows that hold a mark (it also falls with
real gaps).

## One rule against fooling ourselves

Marks found by looking along the rows lie on the rows by construction. They are never fed back into the test of where
the planting is, or into the fit of the rows, as if they were independent evidence. Only the first pass's sightings
fit the rows; only the band against its control strips verifies them.

## Frozen for the first held-out run (2026-11-12)

Built: `src/lib/fieldTwin/rowGuided.ts` (lattice from the planted ground, two-pass search with re-centring, control
strips, per-photograph bar, log-odds merge, verified stretches, row ends, seed spacing, applicability),
`src/lib/fieldTwin/fieldLook.ts` (the per-field visual model), `scripts/rowCrop/rowGuidedBench.ts`. Settings are
`ROW_GUIDED` and `LOOK` as committed with the tag `row-guided-freeze-1`; the band and the merge gate are derived from
the flight (twice and 1.3 times the photographs' row agreement).

On the development flight (123 photographs, one to two leaves, about 0.6 cm): applies on 123 of 123 photographs;
verified row length over planted ground 0.965 (the first pass held 0.57); marks on control strips over marks on rows
0.040; odd and even builds agree on 0.858 of marks; 25,100 marks; seed spacing 13.3 cm (about 82,000 plants a
hectare); recall of visible plants bracketed at roughly 0.80 (filled seed positions) to 0.96 (repeat between halves).
The visual model: AUC 0.881 out of fold on its row-derived labels, 0.615 on candidates it was never labelled on.

Merge-level settings swept either side (controlPerM, merge gate, minViews, minBand, alpha): verified share 0.960 to
0.970, control ratio 0.028 to 0.043 throughout. The plant count moves with the merge gate (23,300 to 29,600 between
0.75 and 1.33 of it): whether two near candidates are one plant or two decides a count, which is why no count is
shown yet. Not swept: the settings inside the photograph search (band, control position, weak score, smoothing).

On the three test flights (V3 and later) the method declares itself not applicable (no photograph shows the band
clearly above its controls, or the plants show no planting), so their results are unchanged.

## After the first held-out run (2026-11-12 night)

The frozen version was run once on a held-out early-corn flight (a public dataset, 150 photographs, about 0.7 cm) and
did not pass: it declared itself applicable on 79 of 150 photographs. The causes, found afterwards on that flight (from
then on a development flight, not held-out): control strips catching the crop's own leaf tips, and photographs placed a
few to 40 cm off across the rows. Fixed since: control strips mid-alley, each photograph registered across the rows as a
shift plus a slope over its frame (`registerAcross`), along the rows too (`registerAlong`), a per-field floor on a
candidate's strength, and the lattice carried beyond the planted ground.

Three changes the same night, each measured on that flight:

- **Along the rows, an offset that varies over the frame.** A camera turned a fraction of a degree, or a percent off in
  height, moves plants at one edge of its frame along the rows and those at the other the opposite way (median 0.14
  degrees and 1 % over the 150 photographs; at 10 m from the centre, 2 to 40 cm against seeds 19 cm apart). Each
  photograph's offset is now measured on every 4 m of each row it covers and fitted as a plane. On the same searches:
  odd and even halves agree on 0.874 of marks (0.795 with one offset a photograph), a photograph finds 0.522 of the
  plants it covers (0.456), 23,401 marks (27,838: the difference was one plant marked twice), verified share unchanged
  (0.938). A rendered test turns one camera 2 degrees.
- **The bar set over planted ground.** Rows carried beyond the planted ground run over scattered weeds, thin stands and
  headland, where the control strips can be as busy as the band; judged together with the planted rows they raised a
  whole photograph's bar. A photograph's bar and its applicability are now judged on its rows over planted ground when
  it holds 20 m of them (`judgedOn`, `markPlanted`). The method then applies on 145 of 150 photographs (131).
- **The lattice carried into unjudged ground** up to 40 m from planted ground, never into or across ground judged
  scattered (`fillM`). Rows there are looked for like any other and drawn only where they verify.

Eye audit (30 windows counted by eye before any output was seen, 819 seedlings): with the plane registration, the
windows the method had over-counted now match (33 counted / 34 marked, 28 / 30, 30 / 32, 33 / 34); over the windows
the lattice reached, 651 marks against 649 counted. Still open: six windows with no lattice under them (the fill run
decides), one window of tiny dark seedlings on cracked clay where marks fall between the visible plants (36 marked, 22
counted: unresolved whether they are plants), and one row the lattice misses at a window's edge.
