# Swardus Direct: milestones 1 to 3 (2026-10-26)

Approved by Yunus after experiments 1 to 3
([direct-photo-georeferencing-experiments.md](direct-photo-georeferencing-experiments.md)). Same 71 apricot
photographs (Phantom 4 RTK, 36 m). Cameras are the reference adjustment from experiment 1: the header, plus four
flight-wide numbers, plus a per-photo attitude correction. No orthomosaic anywhere.

| Step | Run | Output |
|---|---|---|
| Weed model on every original | the local service, settings below | `data/direct-georef/apricot/m1/rfdetr/` |
| Milestone 2: rows and trees | `npx vite-node scripts/directGeoref/m2Rows.ts` | `m2/` |
| Milestone 1: weeds reconciled | `npx vite-node scripts/directGeoref/m1Weeds.ts` | `m1/` |
| Milestone 3: the twin bundle | `npx vite-node scripts/directGeoref/buildTwin.ts` | `data/direct-georef/twin/apricot-2021-04-27/` |
| The Field Twin page | in the app, `/app/field-twin` | reviewers only |

Milestone 2 runs before milestone 1's reconciliation, because weeds are classed against the trees and rows.

New library code:

- `src/lib/directGeoref/reconcile.ts`: one object per plant from many observations.
- `src/lib/fieldTwin/`: the bundle format, its validation, storage, view rules and colours.
- The page, `src/pages/app/FieldTwin.tsx`, with its components in `src/components/app/fieldTwin/`.

One change to the row reader: `fieldRowsFromPixels` takes an optional trace (where each check stopped) and an
optional size share. The defaults are unchanged, and the app's map reading is unchanged.

## Milestone 1: weeds from the original photographs, one object per plant

**The model.** RF-DETR Seg-Large, the app's simple Find weeds settings: confidence 0.5, 1024 px tiles, 256 px
overlap. It ran on the photographs' full resolution (0.98 cm pixels): 35 tiles and 15 s per photograph on the
RX 9060 XT, about 18 minutes for all 71.

**Reconciliation** (`reconcile.ts`) has three rules:

- **Rays must meet.** Two sightings are the same plant when their rays from the two cameras nearly meet at a
  plausible height (miss under 10 cm + a quarter of the plant's size). Flat positions are not enough: a 1.5 m tree
  seen from cameras 20 m apart lands 0.9 m apart on the soil, yet its rays still cross at the tree.
- **One sighting per photograph.** No object takes two sightings from one photograph.
- **Position and height** come from the point closest to all the rays.

Every object then carries how many photographs covered it against how many saw it.

| | |
|---|---|
| Weed detections (all photographs) | 30,536 |
| Objects after reconciliation | 9,643 |
| On a tree crown (the sugar-beet-trained model calling part of an apricot tree a weed) | 2,087, kept apart |
| Weed candidates | 7,556 |
| **Verified: seen in 2+ photographs** (median 4, up to 12) | **4,356**, of which 4,126 between the rows |
| Seen in only one photograph, though 2+ photographs covered it | 2,813 |
| Verified: the views agree on position | median 4.3 cm, p90 10.6 cm |
| Verified: the views agree on size | median 8 %, p90 21 % |
| Verified: size across | median 21 cm (p10 11, p90 52) |
| Verified: height above the soil (from parallax) | median 4 cm |

**Independent check.** DJI_0301 has 414 hand-labelled weeds. Objects reconciled from the OTHER 70 photographs
alone find 274 of them; DJI_0301's own detections find 259. Reconciliation loses nothing, and other views of the
same plant add a little. Labels are not exhaustive, so this is recall against the labels only.

**Measured weakness.** At confidence 0.5, a candidate that several photographs covered is detected in half of
them (median). One view finds a plant that the next view misses. That is why 2,813 candidates have one sighting,
and why the twin shows them as unverified, not as weeds.

Success: the same physical plant in several photographs becomes one georeferenced object, with a position, a
size, an area, a height and its cross-view consistency.

## Milestone 2: rows in every photograph, one field-wide row map

**Diagnosis.** The tree-row reader found no rows in 22 of 71 photographs. A trace now records where each direction
stopped (`m2/diagnosis.json`). There are three causes:

1. **Wheat or road in frame** (9 photographs over 30 % green): the take-off area (DJI_0291, DJI_0292) and the
   wheat-edge leg (DJI_0355 to DJI_0361). The reader's size reference is the area-weighted median patch; a big
   green mass inflates it, and real trees fall under the size cut.
2. **Turn frames at the ends of the legs** (9 of the 22), mostly over the headland.
3. **Mixed tree ages in clean orchard views** (DJI_0328, DJI_0337, DJI_0351). Young, pale trees fall under the
   size cut, the rows that survive are every second row, and the across-row check refuses them. DJI_0337 also missed
   "the rows explain half the green" at 0.48.

**What changed, and what did not.** The reader's default is untouched: a size-median change was tried once before
and gave wrong layouts on the map (planting-layout memory), and the accepted map flow depends on it. In the
direct pipeline a refused photograph gets two fallbacks, each needing independent support:

- **Pass 2.** Read again with a lower size share (young trees kept). The read is kept only when its row direction
  (within 3 deg), row spacing and plant spacing (within 15 %) agree with the field read from the other
  photographs. 8 photographs were kept this way; 8 others read but disagreed and were refused.
- **Pass 3.** Seeded from the field: three trees reconciled from OTHER photographs that fall inside the photo (two
  neighbours in a row, one in the next) seed the planting-layout fitter, the way an operator's three marks do in
  the app. The photograph's own pixels decide what stands where. 11 photographs.
- **3 stay unread, with their reasons.** DJI_0359 and DJI_0360 are half wheat with no reconciled trees inside;
  in DJI_0333 the seeded fit found nothing.

**The field-wide row map.**

- **Trees** from all 68 read photographs are reconciled: 1,040 observed trees (seen in 2+ photographs or a
  confirmed crown, median 4 views). The views agree on each tree's position to 7 cm, at a median height of 1.07 m.
- **Rows** are peaks in the trees' across-row offsets, along a direction refined on the trees (131.0 deg).
- **A row is kept only on evidence**: at least 4 observed trees, at least 2 photographs, straight (trees within
  0.5 m of one line), and filled (observed trees on at least 35 % of the positions along it).
- **Inferred positions** inside a row are added only in a gap between observed trees, and only where BOTH
  neighbouring rows hold a tree at that place. They are drawn dashed and never counted as trees. Rows are never
  extended past their ends.

| | |
|---|---|
| Photographs with rows | 68 of 71 (49 reader, 8 young trees kept, 11 seeded from the field) |
| Observed trees | 1,040 |
| Field rows kept | 14, spacing 4.74 to 5.01 m (median 4.90); the edge row sits 5.89 m out |
| Row candidates dropped | 2: trees 0.90 and 0.73 m off one straight line, scattered objects strung along the wheat edge (they had collected 10 inferred positions before the straightness check existed) |
| Trees off a straight row line (sd, median over rows) | 0.33 m |
| Inferred positions | 7 |

Success: one consistent field-wide row set, every kept row with its evidence, every dropped candidate with its
reason, and nothing filled where a neighbouring row does not support it.

## Milestone 3: the Swardus Field Twin

**What it is.** A vector map of the field built only from the original photographs: 14 crop rows, 1,040 trees with
crown and height, 7 inferred positions, 9,643 weed objects (4,356 verified), and 203 patches of other vegetation.
No satellite image and no orthomosaic underneath.

**The bundle** (`swardus-field-twin-v1`):

- `twin.json`, 8.9 MB.
- 50 JPEG atlases of evidence crops, 52 MB. There are 15,906 crops from the original photographs: two views per
  tree and verified weed, one per other weed. Each crop carries the object's outline in the crop's own pixels.
- `parseTwin` refuses anything malformed, with the reason. That covers unsafe ids, unsafe file names, and evidence
  that points at a missing atlas.

**The page** (`/app/field-twin`):

- **Who sees it.** The sidebar link shows only for the review account (`lib/fieldTwin/reviewers.ts`). Storage
  policies, not the link, keep the data private.
- **Progressive detail by zoom.** Under 19: rows, coverage, crowns and a 5 m density grid of verified weeds.
  19 to 21: points. 21 and up: crowns and weed outlines as measured. Each layer group is built only the first time
  it is needed.
- **Click to inspect.** Clicking a tree or weed shows its status: verified (seen in N of M photographs), unverified
  (seen in 1 of M), or on a tree crown. It also shows whether it sits between the rows or on a row.
- **Measurements in the account's units.** Size across, ground cover, longest span, height above the soil, how
  well the views agree on position and size, model confidence, and position.
- **Source-photo evidence.** The inspector shows the crops of the original photographs with the outline drawn
  over them.
- **Layers** for rows, trees, inferred positions, verified weeds, single-view weeds, detections on tree crowns,
  other vegetation, dropped row candidates and photo coverage.
- **Where a twin lives.** Each account's private folder: `orthos/{user}/field-twins/{id}/`. In a development build
  the page offers "Save to my account" for twins built on that computer, served by a dev-only Vite route that
  answers only twin ids and bundle file names. On the live site, "Add a twin from files" takes `twin.json` and its
  atlases.

**Tests.** `src/test/fieldTwin.test.ts` covers parsing, refusals, files, reviewers, zoom levels, the density grid,
inspector wording in metric and imperial, and colours. It also parses the real bundle when it exists locally.
`src/test/fieldTwinUi.test.tsx` covers the inspector with its evidence, and the page opening a twin and switching
every layer. jsdom cannot hold the map for the real 10,000-object bundle, so the full twin has not been rendered in
a test; the first look at it is Yunus's.

## Not verified, and not done

- **No browser check.** The page has not been looked at in a browser with the real twin. The tests cover a
  synthetic twin, and the real bundle's parsing.
- **Single-view candidates are a model-consistency problem, not a geometry one.** A lower confidence, or a second
  pass at 512 px tiles, would see more plants twice. Not tried.
- **RF-DETR's training.** It was trained on sugar beet; 2,087 of its weed detections sit on apricot crowns and are
  kept apart, not deleted.
- **Unread photographs.** DJI_0337-type failures are now rescued by pass 2. The reader itself was not changed for
  the app.
