# Corn plants and rows as one loop

Design only. Nothing in this document is built. It follows phases 1 to 4 on `feature/corn-crops-make-rows`
(scoreboard, no rows on unplanted ground, the band-against-alley test, the between-rows label). Line numbers are
as of the commit that last touched `plantsFirst.ts` on this branch ("phase 3: the default test reads the row's whole band").

## The three rules

1. Rows are fitted only from plants found without help from rows.
2. Anything found because of a row is never used to create, extend or confirm a row, or to judge planted ground.
3. Where a row expects a plant and the pixels disagree, the output is "gap" or "cannot tell".

## What the rules mean for a loop

The request is plants, then rows, then a guided second look, then a refit, repeated until nothing changes. Rule 2
decides what a refit may use, and it has a consequence that should be seen before any code is written:

**a plant found on the guided look can never change a row.** So the rows do not move because the second look
found something. What may change between rounds is only what the row-free reading produces when it is handed
better measurements of the field. Three things qualify, and all three are computed on marks the photographs
already made (no photograph is decoded again):

- the plant spacing, which decides how a long piece of green is split into plants (phase 3 does this once);
- the row direction and spacing, which decide the frame the planted ground is judged in;
- the photographs' registration against each other, which decides which marks are one plant and therefore which
  dots are certain.

Each of these is measured from the certain plants alone, so handing them back breaks no rule. In practice the loop
settles in two rounds: the first measures the field, the second reads it with those measurements.

## State

Every dot carries where it came from, as two facts. Today these exist only implicitly (the `tier` and
`notCertain` arrays of `reconstruct`, `src/lib/fieldTwin/plantsFirst.ts:612`).

| Fact | Values | Set by |
|---|---|---|
| `locatedBy` | `frame` (a photograph's whole-frame read) or `row` (a search along a known row) | the read that made the mark |
| `believedBy` | `own` (enough photographs made it, of those that looked) or `row` (accepted for where it stands on a row) | `certainEvidence`, `plantsFirst.ts:546`, or the placement on a row |

"Found without help from rows" is `locatedBy = frame` and `believedBy = own`. Only those dots may reach row
fitting or the planted-ground judgement. The type should make the other dots impossible to pass in, rather than
relying on each call site to filter.

## The loop

```
measure  := the row frame, row spacing and plant spacing from the last round (none on the first)
repeat
  1. free plants   each photograph's marks, split and merged with `measure`; the certain ones are `own`
  2. ground        planted / scattered / unknown, from the free plants only
  3. rows          through the certain free plants, only on ground not judged scattered
  4. measure'      direction, row spacing, plant spacing, from those rows
until measure' equals measure (within a tolerance) or three rounds
  5. expectations  along each row, the plant positions its own plants imply and do not fill
  6. guided look   at each expectation: plant, gap, or cannot tell
```

Steps 5 and 6 run once, after the rows have settled. They never feed steps 1 to 4.

## Functions to change

**Step 1, free plants.** `placeDots`, `src/lib/fieldTwin/cornPlants.ts:97`. Today it makes the dots once and the
first reading of rows once (`pre`, line 107). It becomes the body of the loop: `candidatePoints`
(`cornPlants.ts:72`) already takes the plant spacing as an argument, and `registerPhotos`
(`plantsFirst.ts:90`) and `mergeDots` (`plantsFirst.ts:188`) take no field measurement at all, so the second
round re-runs only the split and what depends on it.

**Step 2, ground.** `plantedGround`, `src/lib/fieldTwin/cornField.ts:282`, called at `cornField.ts:398` with
every photograph's strict marks in the frame of the photographs' own row pieces. It should be judged in the frame
the certain plants give (`rowsFromDots`, `plantsFirst.ts:327`), on the free plants. Its thresholds were set on
sightings (one per photograph per plant), so the input stays sightings, not merged dots. The second-look
candidates must never be passed to it; today they are not.

**Step 3, rows.** The first half of `reconstruct`, `plantsFirst.ts:615-676`: certain dots, `rowNumbers`
(`plantsFirst.ts:430`), one line per row number, pieces joined. It becomes its own function, `fitRows`, taking
only `own` dots and the ground.

**Rule 2, where it is broken today.** Four places in the second half of `reconstruct`, all of which let a dot
accepted because of a row act on that row:

| Where | What happens today | Change |
|---|---|---|
| `plantsFirst.ts:716` and `:733` (`along[ri].push`) | A dot placed on a row becomes a reference for the next one's distance test, so marks can step along a row across ground with no certain plant (seen 2026-11-16: a handful of marks left inside a wheel-track strip a few metres wide, which the stretch test cannot isolate). | Two reference sets: every plant on the row for the "not a double" clearance, only `own` plants for "within reach of a plant". |
| `plantsFirst.ts:758-764` (`build`) | A row runs from its first plant to its last, whichever kind they are, so a guided plant past the last certain one lengthens the row. | A row's ends are its first and last `own` plant. Guided plants beyond them are attached to the row and drawn, and do not move its ends. |
| `plantsFirst.ts:769` (`piece`, the segments) | A stretch is "plants confirmed" when plants of any kind stand along it closer than the gap rule. | "Confirmed" needs `own` plants. A stretch holding only guided plants gets its own state: plants found along the row, the row not confirmed by them. |
| `plantsFirst.ts:771-773` (`piece`, the drawn course) | The drawn line is refitted through all the row's plants. | Refit through `own` plants only. |

The rows found in a free slot (`plantsFirst.ts:736-751`) are made from dots that were located without a row but
are not certain. Under rule 1 as written ("plants you are sure of") they would go. That is a decision for you: on
the flights measured they hold 0 to 30 plants.

**Built since (2026-11-16): a final sweep, not the first row of that table.** `SEQUENCE.sweepLoneMarks` in
`reconstruct` takes a second-look mark off its row when no plant found without a row stands within the reach
along that row on either side (reason 8, "alone on its row"). It is the same idea as the first row of the table
and differs from it in four ways:

- It runs after every dot is placed, not at placement. A mark that stays may have had its "whole number of plant
  spacings" measured from a mark the sweep then removes; under the table's change a refused mark never serves as
  anybody's reference.
- It tests second-look marks only. The table's change tests every dot a row accepts, the probable plants included.
- Its company is, by default, any plant the stricter marks made (certain or probable); the table's is `own`
  plants only. `loneMarkCompany: "certain"` is the table's reading.
- The other three rows of the table (a row's ends, "confirmed" stretches, the refit) are not built. They change
  only as far as the removed marks no longer count in them.

**Steps 5 and 6, expectations and the guided look.** New, replacing the two placement loops
(`plantsFirst.ts:707-735`) and the "not confirmed" segments. An expectation is a plant position on a row between
two of its `own` plants that stand further apart than one and a half plant spacings. Each gets one of three
outcomes:

- **plant**: a candidate stands there and passes the tests phase 3 put in (`beatsAlley`, `plantsFirst.ts:694`).
- **gap**: nothing stands there, the photographs that looked at the spot saw it sharply, and enough of them looked
  that silence is evidence. `mergeAlongRows` already computes this as log-odds from a photograph's chance of
  finding a plant that is there and of marking one that is not (`src/lib/fieldTwin/rowGuided.ts:504-512`); the
  same two rates can be estimated here from the certain plants' repeats and from the alley counts of
  `bandAndAlley` (`plantsFirst.ts:587`).
- **cannot tell**: everything else. Too few photographs looked, the stretch's band does not beat its alley, or the
  photographs disagree.

This replaces two existing mechanisms with one: the "row probably continues, plants not confirmed" stretch
(`cornPlants.ts:158-160`) and the field's rule that withholds all gaps on a flight whose reads are incomplete
(`FIELD.gapMinReadShare`, `cornField.ts:134`).

**The driver.** `cornPlantsFirst`, `cornPlants.ts:133`, runs the loop; `cornStage`,
`src/lib/fieldTwin/build/corn.ts:86-93`, is unchanged apart from what it logs.

## What decides whether it is right

The scoreboard (`scripts/rowCrop/cornScoreboard.ts`) on every stored flight, before and after, as in phases 2 to
4. Two lines would be added: expectations by outcome (plant, gap, cannot tell), and how many rows or row metres
differ between the first round and the last. A loop that changes nothing after round one on every flight is a
finding too: it would mean the single pass was already the fixed point.

## Not in this design

Later growth stages, where one dot is not one plant and the rows have to lead; changing the colour thresholds;
combining photographs before detection; a pixel-level search along the rows (`searchPhoto`,
`rowGuided.ts:181`), which would need each photograph's pixels a second time.
