# Weed size v1: how large each weed is on the ground

Built 2026-10-12. The scout finds the spots; this measures each one in its original
photograph and says how much to trust the number. The objective behind it is the one in
`field-intelligence-plan.md`: find the weeds, measure each one, turn what the grower confirms
into action. Species and growth stage are later layers on the same record.

How it finds weeds is a trade secret. This document is for the team and never for the site.

## What already existed, and what was reused

| Need | Where it already was | Reused as |
|---|---|---|
| The plant itself | `weedScout/` candidates with a `Blob` (area, equivalent diameter, box) measured on the field map at the sweep's pixel size (3 to 6 cm) | the expected size that picks the window; shown as "Size on the map" |
| The original photo at full resolution | `scans/{user}/{odm}/frames/` + `frames.json`, `sourceFrames/manifest.ts` (never guess a key), `downloadFrame` | the pixels |
| Which photo holds a spot, and where | `sourceFrames/spot.ts` (`sourceImages.best`), `odm.ts` `projectToFrame` with its per-point `gsdM` and `viewAngleDeg` | the native pixel and the ground size of a pixel THERE |
| Vegetation against soil | `weedScout/vegetation.ts` (chromaticity index, Otsu) | the mask, with a dark floor added |
| Components and touching plants | `photoScout/pattern.ts` `measureComponents`, `splitTouchingPlants` (the watershed on the distance transform) | the plant, cut from its neighbours; the split takes options now |
| The crop's positions in the photo | the spot's `look` (`PhotoLook`, circles by class in native pixels) | so a tree is never measured as a weed, and a weed leaning on one is flagged |
| Persistence | `scan_findings.candidate` (the whole candidate as JSON), `weed_observations` | the measurement rides inside the candidate; generated columns expose it |
| Display | `SpotPopup` (Measurements details), `CloserLook` pattern view | the size line, the table, the white outline |

Nothing was built twice: no second detector, no second mask, no second projection.

## What was missing

A measurement that used the ORIGINAL at native resolution rather than the 4,096 px decode
the photo pass reads (0.99 cm/px against 1.33 on the sample imagery; 5,472 px wide against
2,400 for the frame ODM saw); the pixel size at the plant from the pose rather than one
number per photo; the canopy told apart from its box; touching plants, the crop, shadow and
the photo's edge handled and recorded; a confidence with a stated rule; an unknown that
withholds the number; a version; a place on the record; a line on the screen; a harness.

## What it does

`src/lib/weedScout/sizing/`, four files, pure where it can be:

- `types.ts`: `WeedMeasurement` (status, reason, method, confidence, canopy diameter and
  area, longest axis, box width and height kept separate, size category with the thresholds
  it was read against, pixel size, source photo and window and view angle, quality
  indicators, the whole clump when the plant was cut out of one, the outline in native
  pixels, the version). `SizeThresholds` is a setting (`ScoutParams.sizeThresholdsCm`, 10 and
  30 cm by default, in the scout's settings panel); `sizeCategoryOf` reads against it.
- `segment.ts`: the measurement on a window of pixels. Index with a dark floor (channel mean
  under 20 is shadow too deep to classify); the threshold from the 4 m context around the
  spot (the pass's own scale; a threshold found on one weed and a lot of soil sat low and
  read the soil's edge as canopy: 2.1x the pass's size on the small plants before this, 1.1x
  after) else Otsu on the window; components; the one under the spot or the nearest within
  30 cm; the touching-plant split with a lighter setting than the pass (`SIZER_SPLIT`: two
  discs that touch or overlap by up to a fifth come apart down to 12 px across, a six-leaf
  rosette and a grass blade stay whole, measured on painted shapes); the crop (a part holding
  a crop circle's centre is not measured; one reaching a circle is flagged); the edges (the
  photo's: unknown; the window's: one wider try, up to 8 m); area from the pixel count,
  diameter from the area, longest axis from the convex hull, box from the extremes, outline
  by Moore tracing; confidence = min(resolution, contrast) x view x touching x crop, with
  every term stated in `confidenceOf`; under 0.3 the number is withheld.
- `measure.ts`: a spot into its photo through the pose (`projectToFrame`), the native pixel
  size at that point, the window (6 expected diameters, 1 to 4 m first), the crop circles
  from the look, and the outline carried back to the photo's own pixels. Pure given a cutter;
  `openOriginal` is the browser's.
- `describe.ts`: the size line and the measurement table, in the operator's units.

Where it runs: in the photo pass, after each photo's pattern is read, for every spot whose
best photo it is and that has no measurement (the original is opened a second time for the
sizes rather than held through the pass, because reading photos is what ran the browser out
of memory before; a photo from the saved reads is downloaded for the sizes alone); and on
demand when a spot is opened without one (a restored run, a photo the pass did not reach),
from the same download the popup already makes, and the finding's record is updated in
place (`saveFindingCandidate`). The archive row carries it beside the verdict.

What the operator sees: one line on the spot ("Canopy 14.2 cm across, 158 cm², medium
(measured in the photo; confidence 0.82)", or "Size not measured in the photo: the plant is
cut by the photo's edge."), the table behind Measurements (canopy, longest axis, box marked
"not the canopy", size class with its thresholds, whole clump, confidence, pixel size, photo
and view angle, mask contrast and where its threshold came from, flags, method and version),
the measured size in the spot's title and the map label in place of the map's, and the
canopy's outline in white on the closer look's pattern view when it was measured in the
photo on screen, with a key entry.

## What survives

A measurement lives inside `scan_findings.candidate` under `measurement`, so a client older
than migration `20261012120000_weed_size_v1.sql` reads and writes findings unchanged and an
old finding simply has none. The migration adds GENERATED columns from that JSON
(`measurement_status`, `canopy_diameter_cm`, `canopy_area_cm2`, `size_category`,
`measurement_version`, indexed by scan and class) and a plain `measurement jsonb` on
`weed_observations`, written only when the saved spot carries one. Applied to the linked
project 2026-10-12. Reopening a scan restores the measurements with the run; a re-run
measures again (the photo pass) or on demand.

## What was measured, and what was not

`npm run bench:size`, two modes. Records go to `data/bench/size/` (gitignored), with PNG
crops of measured plants and their outline for eyes.

**Survey, no ground truth** (consistency, not accuracy), 2026-10-12, the pass's own
off-pattern plants as targets, measured at native and on the same photo box-downsampled:

| | orchard, 3 photos, 1,436 plants | vineyard, 2 photos, 589 plants |
|---|---|---|
| native pixel size | 0.99 cm | 1.10 cm |
| measured at native | 63% | 72% |
| at 2x coarser | 38% | 51% |
| at 4x coarser | 17% | 33% |
| median diameter at native | 13.8 cm | 22.2 cm |
| native against the pass's own blob (median ratio) | 0.96 | 0.99 |
| 2x coarser against native | 1.06 | 1.06 |
| 4x coarser against native | 1.19 | 1.15 |
| measured with a touching neighbour | 51 | 52 |

Why the rest were not measured at native (orchard): 353 under 6 pixels across (weeds under
6 cm at 1 cm/px: the floor is honest, not a fault), 95 low confidence, 29 no vegetation
within reach of the map's point, 29 no vegetation in the window, 24 ran past an 8 m window,
4 cut by the photo's edge. Coarser pixels inflate small plants (15 to 19% at 4 cm/px), which
is the known edge effect of a pixel mask and the reason the originals are read.

**Ground truth** (accuracy): NOT established. The harness takes a file of hand-measured
plants (`scripts/bench/weedSizes.example.json` shows the shape: photo, native pixel, canopy
diameter from a tape or quadrat, area when known) and reports the median absolute diameter
and area error, the share eligible, the failure rate per resolution and the plants over- or
under-segmented (more than 1.5x or under 0.67x the truth). Twenty independently measured
plants are owed before any accuracy claim; until then the number on a spot is a consistent
pixel measurement with its confidence, not a verified one.

**Unit tests** (`src/test/weedSizing.test.ts`, `photoPassSizing.test.ts`, `spotSize.test.tsx`):
painted discs at three pixel sizes measure within a few percent in ground units; touching
discs come apart and say so; a crop plant is refused and a weed leaning on one is flagged;
the photo's edge is unknown and the window's edge asks for a wider cut; the pixel floor and
bare soil withhold a number; shadow is left out and counted; the confidence rule term by
term; the outline tracer; then the whole thing through the real reconstruction fixture, with
a cutter that paints the disc at the pixel the pose predicts, at the native pixel size there;
the photo pass opening a fresh photo again and downloading a saved one, handing sizes over by
spot id, leaving a measured spot alone and retrying an unavailable one; the words.

## Limitations, stated

- Flat ground at the pose's ground height; the error at the plant is (distance from the frame
  centre over flying height) times the ground height error, and the view angle is recorded.
  A DSM would remove it.
- A pixel mask: the canopy is what the index calls green, so a pale or purplish weed, or one in
  deep shadow, is undercounted; the contrast and the dark share are on the record.
- Two canopies overlapping by more than a fifth of their diameter read as one plant and the
  clump field cannot see it; a lobed plant whose lobes touch at a point can read as two.
- Perspective: the pixel size is the ground size at the plant's centre; a plant 30 degrees
  off nadir is foreshortened across the radial direction and the confidence falls, but the
  number is not corrected.
- A canopy more than three times the diameter the map read is most likely the mask grown into
  something the pattern never placed (a vine, a tree skirt); the confidence is halved and the
  caveat says the ratio. The vineyard survey's 70 cm reading on a 12 cm map blob was this case.
- Only spots with a best photo whose original was kept get a number; imported orthomosaics
  and scans without originals are unavailable, and say so.
- One measurement per spot, from its best photo; a second photo is not consulted.
- Sizes are compared with the pass's blob and across resolutions, not with the ground.

## Owed

Twenty hand-measured plants with their photo and pixel, then `npm run bench:size -- --truth`.
One flown field reviewed in the browser: the size line on a real spot, the outline in the
closer look, the record after a reload.
