# Vegetation structure: plants, clusters and coverage, at the scale the imagery supports

Built 2026-10-12 on top of weed size v1 (`weed-size.md`). The founder's principle, verbatim:
detect at the finest reliable scale, display at the most useful scale, never confuse the two.

How it finds weeds is a trade secret. This document is for the team and never for the site.

## What existed, and what it did wrong

The pass (`photoScout/pattern.ts`) already reads every vegetation component of a photo at
its pixel size, classes each by the planting pattern (crop on the pattern, double, between
plants, off the row, unplaced) and counts, but drops, the specks under the component floor.
The map pass does the same on the field map through the sweep. Weed size v1 then measured
each spot in its photo.

What was wrong was the representation, not the detection. Every off-pattern component was
one marker: a 4 cm fragment and a 40 cm clump got the same circle, two canopies that touch
were two circles over one shape, the thousands of specks were a number in a note and nothing
on the map, and the screenshots of the demo showed it. The limitations, named:

- No idea of scale: a 2 px object at 3 cm/px was a "plant" like a 30 px one at 1 cm/px.
- Touching plants were separate markers; their canopies were counted once each, but shown as
  if each were measurable on its own.
- Micro vegetation was invisible: counted as specks, never located, never accounted for.
- The map drew everything at every zoom.

## What was reused

| Need | Reused |
|---|---|
| The components, their classes and sizes at the photo's scale | `PhotoPattern.blobs`, unchanged |
| The specks | `measureComponents` now reports each speck's centre and size to a callback; `analysePhoto` sums them per 1 m cell into `PhotoPattern.fragments` (the saved read version is now `photo-read-v2`) |
| The map's components | the sweep's blobs in `pipeline.ts`, classed by the pattern's placed plants (`nearestPlantFinder`) |
| The hull and its longest axis | `sizing/segment.ts` `convexHull`, `maxFeret` |
| Photo to ground | `odm.ts` `pixelToGround`, as the photo pass already does |
| Field frame | `rows.ts` `localFrame` |
| Persistence | `scan_patterns.result` through `slimResult`, as an optional `vegetation` field: old rows read as before |
| Display | the scout map beside `PatternLayer`, the field read |

## The three categories, and the one rule that holds them together

`src/lib/weedScout/structure/`:

- `types.ts`: `VegItem` (any object in a metric frame with area, diameter, class), `Individual`,
  `Cluster`, `Zone`, `Accounting`, `StructureParams` (`minPixelsAcross` 6, `clusterGapM` 0.15,
  `cellM` 4, `zoneMinCoverage` 0.001, `zoneMinCount` 3; in `ScoutParams.structure`).
- `group.ts`: `groupVegetation`. The scale first: `minMeasurableM = minPixelsAcross x gsdM`, so
  a 1 cm/px photo measures from 6 cm and a 4 cm/px map from 24 cm, and the same object is an
  individual in one and coverage in the other. Then single linkage over the measurable
  off-pattern objects, two joined when their canopies come within `clusterGapM` edge to edge
  (a grid hash: 20,000 objects in about 30 ms). A group of one is an **individual**; of two or
  more a **cluster**, with the sum of its members' mask areas as canopy, the hull around their
  canopies as footprint, box and longest axis, the component count, and `plantCount: null`.
  Fragments and objects under the measurable size land in a cell grid; a cell whose micro
  coverage or count passes the floor is a **zone** with coverage, area, density, counts and
  the number of measurable objects standing in it (counted, never re-added).
- The accounting: every item's area is in exactly one of crop, individuals, clusters, micro
  or border, and `accountingGap` is zero. A test holds it on every scenario.
- `photo.ts`, `map.ts`, `ground.ts`: the adapters and the projection to lat/lng;
  `mergeGroundStructures` keeps an object seen in two photos once (within 0.4 m, or a zone
  centre inside a kept zone) and sums the accounting over what is kept.

Nearby is not the same as one cluster: two 20 cm plants 40 cm apart edge to edge are two
individuals; the gap is physical and a setting, so a photo and the map group alike. The
crop is counted and never grouped; a weed touching a tree is an individual beside it. Where
no trusted row pattern classed the objects, they are "vegetation, rows unknown", grouped the
same and marked so: off-pattern is never assumed to be a weed, and the operator's verdicts
stay on the spots.

## Where it runs

- The pipeline, after ranking: `structureOfMap` over the sweep's blobs, in the result as
  `vegetation.map`, with a note of its counts.
- The photo pass, per photo read: `structureOfPhoto` on the pattern (with fragments), to the
  ground through the pose, merged across photos into `vegetation.photos` as they land. With
  "put the plants found in the photos on the map" on, only the individuals and the clusters
  become findings; the small plants are coverage, never a thousand dots.
- Saved with the run; restored with it.

## What the map shows

`VegetationLayer.tsx`, a toggle beside the pattern's, nothing clickable (the findings keep
the clicks), numbers on hover:

| zoom | drawn |
|---|---|
| under 18 | coverage zones as soft squares shaded by coverage, from the map (field wide); clusters as footprints |
| 18 to 19 | the zones faint; plants at twice the measurable size as small rings; clusters |
| 20 and over | every measurable plant with its size on hover; clusters; the photos' finer zones where photos were read |

Plants and clusters come from the photos where there are any, from the map otherwise; only
what is in view is drawn, never more than 4,000 marks. The field read gains a line: plants
measurable on their own, clusters, and the small vegetation as coverage, with the scale and
the source.

## Validation

`src/test/vegetationStructure.test.ts`, the nine cases asked for: one isolated plant; two
touching (one cluster, no count) and two 40 cm apart (two individuals, and one cluster at a
50 cm setting); a clump of eight (canopy is the sum, footprint the hull); 640 fragments and
five sub-measurable objects (two zones with coverage, density and counts, none below the
floors); a weed beside a tree (the tree counted, never grouped; without a pattern the two
are one cluster of unknown standing); an object on the edge (set aside); the same plant at
1 and 3 cm/px (individual, then coverage); two photos of one place (seen twice, kept once,
summed once); 20,000 objects in under three seconds with the identity held and the linkage
checked against brute force. Then the adapters on a fake pattern with fragment cells, the
pass counting its specks per cell on a painted scene, and the map's blobs classed by a
pattern. `vegetationLayer.test.ts` holds what each zoom shows and what the hover says.

**Grouping accuracy, missed vegetation and false detections against the ground are NOT
measured**: no reference data exists. The harness for sizes (`npm run bench:size`) takes a
ground-truth file; a grouping truth (which fragments are one plant, which clump is how many)
would need the same kind of file, and is owed with the twenty measured plants.

## Limitations, stated

- A cluster is a linkage of mask components. Two canopies that overlap into one component
  are one object to the structure; only the sizer's split (on a spot) can see inside.
- Zones are cells, not shapes: a 4 m square shaded by coverage, aligned to the photo or the
  field, not to the vegetation.
- The photos' structure covers the photos the pass read (the spots' own photos), not the
  whole field; the map's covers the field at the map's coarser scale. The layer says which.
- Fragments are counted by the pass's own mask; residue, algae and artifacts that the index
  calls green are in the coverage, and the zone says "small vegetation", not "weeds".
- Zones from the map and from a photo are never drawn together, but their numbers are
  separate accounts: a reader adding both would count the micro vegetation twice.
