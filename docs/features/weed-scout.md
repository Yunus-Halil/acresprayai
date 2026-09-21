# Weed Scout (experimental, developer mode)

The experimental replacement for the Treatment Grid, switched in per browser from
Settings, section 5, "Developer mode". It is the `offrow/` research track ported into the
app and wired to the scan on screen, with a two-scale anomaly pass, regions, a full-depth
sweep, an event context, an in-house describer and an observation archive the scout
learns from. Nothing about it is a verdict. The Treatment Grid stays the shipped analysis
system and its stored state is untouched while the switch is on.

**Nothing external.** Every number is computed in the browser from the pixels, the
boundary and the operator's own past verdicts. There is no model anyone else runs; the
external description step from the first version was removed.

## The switch

`src/hooks/useDeveloperMode.ts` holds `{ weedScout: boolean }` in
`localStorage["swathwise.developer"]`, like the unit preference and for the same reasons.
When it is on, the workspace's "treatment" tab slot renders `WeedScoutTab` instead of
`TreatmentTab`, and every button that opens the analysis system opens the scout. Off
again, the grid is back exactly as it was.

## Any crop, any field

Nothing in the scout assumes corn, rows, or a size. Three things adapt per run and the
result says what they did:

- **Tile size** follows the field's area when "auto" is on (the default): 3 m wherever
  that lands between 100 and 20,000 tiles, smaller for a trial plot so the baseline has
  tiles to be a baseline, larger for a quarter section so the browser can hold it. Ground
  units, 1 to 20 m, reported in the run summary.
- **Rows** are a crop pattern setting: *Detect rows* (default) tries the fit and, if the base
  pass finds none, treats the field as not a row crop for that run and says so; *Row crop*
  fits everywhere and warns when nothing is found; *Not a row crop* skips the fit. Rows only
  add the between-the-rows signal. Regions and plant outliers work without them.
- **Closed canopy** (pasture, a mature crop, a cover crop): when the typical tile is over
  85% vegetation, plants cannot be separated, so plant-level detection and the row fit are
  turned off for that run and the regions carry it. The same guard is per window in the
  sweep, and a mask that splits into too many pieces is a note, not a crash.

Multi-part boundaries are handled throughout; a headland that swallows the whole field is
reported rather than silently scoring nothing.

## The pipeline, in the operator's order

All of it is `src/lib/weedScout/`, pure except where the browser is unavoidable.

| Step | What | Module |
|---|---|---|
| 1 | The boundary becomes squares in a local metric frame (edge from the field's area, or pinned), clipped by centroid; headland tiles stay in the baseline and out of the scoring | `tiles.ts` |
| 2 | Every tile is measured: chromaticity shares, brightness and its spread, ExG and its spread, green-red index, vegetation fraction. Very dark pixels are unknown, not soil | `baseline.ts` |
| 3 | The baseline is the **shorth** per feature (the shortest interval holding half the tiles), so a patch covering a third of the field cannot swallow it, with a precision floor per feature so a field that agrees with itself to the fourth decimal does not make every tile an outlier. Every tile is scored against the field AND against its own 5x5 neighbourhood. A tile is flagged when its strongest non-brightness deviation passes `anomalyZ` (3.5) with a second feature from a different group in support, or overwhelmingly. Brightness never leads and never supports: it is what seams, vignetting and cloud edges move, so it names a region's class and triggers nothing. Touching flagged tiles are grown by hysteresis (neighbours whose leading deviation passes 60% of the threshold) into **regions** with an outline, an area and a class | `baseline.ts` |
|   | Where the crop rows can be fitted (angle by sparse projection-variance search with exact per-bin pixel counts, pitch by autocorrelation inside a band around the stated spacing, phase by circular mean about the window centre), vegetation further than 30% of the spacing from a centreline is off-row. Independently, the **plant population** (shorth of log size, greenness, green share, shape over every plant, with precision floors; shape is ignored under six pixels across) says which plant is unlike the others, so a large weed among small corn is found even when the canopy has defeated the row fit. Plants cut by an imagery edge are never candidates | `rows.ts`, `blobs.ts`, `candidates.ts` |
| 4 | The **sweep**: the whole interior is read at the deepest baked zoom in 512 px windows that overlap by 0.6 m and each own a rectangle; a plant is kept by the window that owns its centroid, and cut plants are dropped. Rows are refitted per window with the coarse angle as a hint. The zoom backs off to stay under `maxSweepWindows` (400) and the run says so | `sweep.ts` |
| 5 | Candidates are ranked, compared with the archive, described, and the top `maxChips` get a chip of real pixels | `candidates.ts`, `feedback.ts`, `describe.ts`, `zoom.ts` |

The vegetation mask is ExG plus half the informative part of CIVE on chromaticity,
thresholded with Otsu per tile and a whole-field fallback (`vegetation.ts`). No
morphology: the ground-unit area floor in `blobs.ts` (1 cm squared) does the despeckling
continuously in GSD, which a kernel cannot.

## What a candidate is

| Kind | Meaning | Drawn as |
|---|---|---|
| not-average region | touching not-average tiles, one shape with an area and a class | polygon, colour by class |
| field outlier | a single not-average tile that did not grow into a region | point |
| off-row vegetation | a plant outside the in-row band of the fitted rows | point |
| vegetation outlier | a plant unlike the field's plants in size or colour | point |
| off-row and outlier | both | point |

A plant inside a region is not a second candidate for being there; it is a candidate only
if it is off-row or an outlier in its own right. That is what stops a patch arriving as a
storm of dots.

Region classes, from the direction of the deviations: bare or dry ground; dark ground
(wet, shadow or residue); thin stand; dense vegetation; pale vegetation; greener than the
field; different from the field. Descriptive, never a verdict.

## The archive tunes the scout

Every saved verdict is a labelled example. Before the queue is shown, each candidate is
compared with the archived rows most like it: nearest neighbours within 2 units of a
distance whose scales are fixed and physical (a factor of two in area, 0.03 of a
chromaticity share, 0.15 of a row spacing off-row), never the archive's own spread, so
"like this one" means the same thing on day one and day one thousand. At least three
neighbours are needed; same-field rows are used alone once there are ten; votes are
weighted by closeness. If 75% of the weight was dismissed (crop or not vegetation) the
score is multiplied by 0.4 and the reason shown; if 75% was confirmed it is multiplied by
1.25 and the species text those rows carried is offered. Nothing is hidden: a dismissed-looking candidate is ranked lower, never removed.
`feedback.ts`; the vector is stored with every observation so nothing has to be re-run.

## The in-house describer

`describe.ts` builds an `Estimate` from the measurements: size class with the resolution
floor stated, growth habit from the coarse outline (only when there are pixels enough to
say), colour against the field's own plants, position against the rows, a season and
time-of-day note, what a person on the ground should check, and caveats. No species is
ever named by this file; species text only ever comes from verdicts the operator wrote,
surfaced by retrieval. Never a product, never a rate.

## The event context

`weather?mode=context&lat&lon&time=` on the existing weather edge function. NOAA's
`/points` gives the relative location ("Fairfax, VA") and the IANA time zone; the
observation mode gives the nearest station's report closest to the capture time, with the
station's sky text. Local time is formatted in the field's zone; season is meteorological,
shifted for the southern hemisphere. Every field is nullable and a failed lookup carries its
reason. Nothing is ever invented.

## The archive

`public.weed_observations` (migrations `20260921120000_weed_observations.sql` and
`20260921180000_weed_observations_v2.sql`), one row per candidate the operator chose to
save. The chip goes to the private `weed-chips` bucket under
`<user_id>/<scan_id>/<candidate_id>.png`. Columns hold the where and local when, the
season and place, the station weather, the crop and stage, the imagery scale, the
pipeline's measurements, the region outline and class for regions, the feature vector, the
in-house estimate, the pipeline version and parameters, and the operator's verdict
(`weed`, `crop`, `not_vegetation`, `unsure`), species text and notes. The verdict is the
label; everything else is the feature. Owner-scoped by RLS; there is deliberately no
cross-user read. A national dataset is a later, consented, separate step.

The `brain` and `brain_model` columns from the first migration remain, unused.

## What is and is not verified

Verified, in `src/test/weedScout.test.ts` against synthetic scenes with known truth: a dry
strip covering a third of a 60 m field arrives as one region of the right size and class
with nothing flagged outside it; a 25% brightness seam flags nothing; a single 2.4 m bare
spot is one point found by local contrast; rows at 23 degrees and 76.2 cm are recovered to
within 1.5 degrees and 5% with centrelines within 4 cm of the planted positions; a hinted
angle search matches the full one; between-row plants rank as off-row; a 30 cm plant on a
row line among 10 cm crop is a plant outlier with no row model; a region and a plant
outlier arrive together without a dot storm; sweep windows' owned rectangles tile the
field exactly; feedback lowers dismissed-looking candidates and raises confirmed-looking
ones and stays silent with too few neighbours; the describer never says weed, spray, apply
or rate.

Both migrations are applied to the linked project and the weather function is deployed
(2026-09-21). Not verified: any flown imagery. The thresholds (`anomalyZ` 3.5, `blobZ` 3.5, band 0.30,
1 cm squared floor, hysteresis 0.6) are starting values that the operator's verdicts and a
false-positives-per-acre count from a real field are meant to set. The sweep and the chips
are browser-only and have run under no signed-in session.
