# Orchard tree audit, 2026-10-19: every missed tree, why, and what changed

Phase 1 of the crop-intelligence brief, kept to its first milestone: every labelled tree of the diagnostic frame traced
through the planting-layout fitter, each miss explained, and the improvement measured without trading weed recall.
Tool: `scripts/bench/layoutAudit.ts` (writes `audit.json`, `audit.md`, `audit-overlay.png` beside the frame); the fitter
records the fate of every expected position it looks at (`GrowOptions.trace`). Frame: DJI_0301 as a stand-in map
(north-up, EXIF pixel size), 104 labelled trees and 414 labelled weeds, labels not exhaustive. Development
diagnostics only: nothing here is cross-field generalisation.

## 1. Root causes, in order of weight

| Cause | Labelled trees | Evidence | Fixed |
|---|---|---|---|
| Not a miss: the label is at the trunk base (often on bare soil, 10 of 15 labels have no green at the point) and the fitted plant is the crown's centre, 0.65 to 1.17 m away | 15 | audit rows marked "accepted" with nearest plant over 0.6 m; 97 of 104 trees have a plant within 1.2 m against 80 within 0.6 m | n/a |
| Expected position just outside the frame edge, never examined, although the crown is inside | 3 | "never looked at"; the lattice point fell outside the field | yes: a position within a third of the plant spacing of the field is examined |
| Tree standing 0.7 to 1.0 m off its lattice position | 2 | "off the layout" with the measured offsets against the limits (0.79 m along, 0.76 m across) | no: left as the layout's limit; widening it admits weeds |
| Crown merged with weeds into a strip along the row | 1 | "green all the way to the neighbour", 0.54 between | no: genuinely ambiguous by colour; a height model would settle it |
| Faint crown under the presence bar | 1 | crown green 0.20 against the bar 0.30 | no: marking it lowers the bar for that row (section 3) |

Earlier causes, found on the real map today and already fixed before this audit: every second row skipped when the
rows between hold smaller trees (the finer spacing was chosen by mean greenness, and presence was judged in a
spacing-sized box); a band of rows missed between found rows (growth stopped at the first row that failed); marked
trees ignored (clicks gave only the lattice); results served from a cache keyed without the rows.

## 2. The cost that was being traded: weeds taken for crop

The crop band along each row line inherited the crown radius (1.07 m each side on this frame). On this frame it took
63 of 414 labelled weeds standing on bare soil between trees for crop, against 13 inside a crown. Measured against
band width (crowns as measured):

| Band each side | Labelled weeds taken for crop | Labelled trees on a row |
|---|---|---|
| 1.07 m (crown radius, before) | 76 | 101 |
| 0.77 m | 61 | 98 |
| **0.5 m (now)** | **41 to 43** | **97 to 100** |
| 0.3 m | 31 | 93 |
| old automatic reader | 33 | 72 |

The band is now 0.5 m. The weeds under a crown's edge stay inside the crown disc, as they must for the model's input.

## 3. Before and after (DJI_0301 unless stated)

| | Old reader | Layout, first build | Now |
|---|---|---|---|
| Labelled trees on a row | 72 / 104 | 95 | 100 |
| Labelled trees with a fitted plant within 1.2 m | n/a | | 97 |
| Labelled weeds taken for crop | 33 | 67 | 43 |
| Labelled weeds with an RF-DETR detection within 30 cm, rows painted over | 218 (unpainted) | 217 | 220 |
| Model weeds shown between the rows | 340 | 451 | 472 |
| Tree-sized detections off the rows | 26 | 10 | 17 |
| Trees found on DJI_0303 / 0312 / 0320 / 0327 | reader: 0303 and 0320 only | 90 / 63 / 40 / 40 | 112 / 91 / 56 / 59 |

Tree-sized detections off the rows rose from 10 to 17 with the narrower band: those are large green things between
trees that the wide band had hidden; whether they are weeds is not known.

## 4. Evidence states the layout now carries

- observed plant: a fitted plant (crown green at or over the bar, or a marked tree)
- expected position without a plant: a gap, drawn as a cross, never reported as a dead tree by itself
- tree-sized green on no row: orange ring, a row or block not marked yet
- the fate of every expected position is recorded for audits (accepted, not present with the green and the bar, off
  the layout with the offsets, strip, outside the field, stretch dropped and why)

Not yet separated: "probable plant" (between the floor and the bar) and "ambiguous vegetation" (crown merged with
weeds). Both are one further state each in the same trace.

## 5. What the real map still needs from you

The frames are stand-ins. On the real orthomosaic: reload, press "Read the rows again" in the Crop rows panel, and
send a screenshot of any row still missed together with the panel's text. The audit tool can then be pointed at the
same rows once the map is reachable from a script.

## 6. The brief's other parts

Part B (crop dossiers for corn, soybean, wheat and cotton; planting-geometry reference table; growth-stage
catalogue; dataset and licence catalogue) and Part C (algorithm comparison, learning strategy, validation matrix) are
research deliverables not started here, by the brief's own order: the orchard milestone first.
