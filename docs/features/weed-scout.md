# Weed Scout

The analysis system in the Treatment tab since 2026-10-08 (before that, the experimental
replacement for the Treatment Grid behind developer mode; the grid is still one switch away
in Settings, section 5, with its state untouched). It is the `offrow/` research track ported into the
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

## The planting pattern (2026-10-08)

Between the baseline and the sweep the scout now reads the planting pattern from the field
map (`fieldPattern.ts`, over `photoScout/pattern.ts` in a Web Worker): windows of 60 m at the
baked zoom nearest 5 cm per pixel, each giving its row blocks, their settled row lines and
every crop plant, placed in lat/lng. The pattern stands for the row model, the sweep measures
its distances against the settled lines, and an on-row blob the pattern placed no crop plant
at is a new candidate kind, "between plants". Where the pattern reads nothing the older
per-window fit runs as before. `ScoutParams.pattern` turns it off; `rowSpacingAuto` searches
the spacing; `rowAngleDeg` is the grower's "rows run this way". The plan and the measurements
are in [field-intelligence-plan.md](field-intelligence-plan.md).
## The photos, for the small weeds (2026-10-08)

The field map at 5 cm per pixel keeps the pattern and the crop and loses the small weeds, so
after the map pass has landed, `runStore` reads the kept originals (`photoPass.ts`): the photos
covering most of the field first, up to `maxPhotoReads`, each through the same pass in the
worker, each off-pattern blob carried to the ground through the ODM pose (`odm.ts`
`pixelToGround`). A photo's row block counts only where it agrees with the map's pattern, a
plant the map pass already has or another photo already gave is not added twice, and the
rest join the candidates as they land, with the photo as their source and a chip cut from the
photo. Stop ends it; a connection the browser says to spare is not used. `photoPass` turns it off.
## What a finding is called, and what it looks like once saved (2026-10-08, evening)

Every finding has one title, `findingTitle` in candidates.ts: what it is and how big, "Likely
weed, off the row · 40 cm", "Likely weed, between plants · 25 cm", "Plant unlike the crop ·
60 cm", "Bare or dry ground · 0.1 ha". The map label, the popup heading (without the size,
which the line under it carries), the closer look's title and the saved shape's name all say
it, so a spot is the same thing everywhere. "Likely": the operator decides.

Where the pattern placed the crop, a region of vegetation unlike the field average IS the
crop (trees on bare ground read as "dense vegetation" against a field that is mostly soil),
so those regions are not findings there; bare, dark or wet ground and a thin stand still are.

A kept spot saved to the field is now the circle the scout drew: one and a half times the
plant across, never under 60 cm, in its class's colour (red for the plant the operator kept
as a weed, orange for ground, yellow for the rest), named as above. It used to be an orange
square four times the plant across named "Weed Scout: off-row vegetation", which made the
Planner's map a field of identical boxes.

The closer look opens on a cut of three row spacings around the spot, marks the spot with a
white ring (on the plant the pass placed there, or where the map put it when it placed none),
halos the circles that are not crop so they read over foliage, and fades the rows and the crop
plants to context. It says how far the read is while it reads.

## The pattern on the photo (2026-10-08, revised late that night)

The spot's look is made during the scan, not when the spot is opened. The photo pass reads
only the spots' own photos: each spot's best photo, the one holding most spots first
(`photosOfSpots`, `shotsOfSpots`), each whole, and none of the field's other photos (reading
all of them was what ran the browser out of memory on the first real scan, 2026-10-09). For every spot whose best photo it is,
`looksInPhoto` carries the spot into the photo through the pose and keeps a `PhotoLook`
(`sourceFrames/patternLook.ts`): a window of three row spacings a side (8 to 24 m) in the
original's own pixels, the rows clipped to it as lines, the plants inside it as circles in
their class's colour (green on the pattern, orange between plants, red off the rows, blue a
double), and the spot itself ringed in white (the nearest placed plant within 1.5 m, or a ring
where the map put it). The look sits on the candidate (`Candidate.look`), so it is saved with
the run and restored with it. The tab's photo line counts them: "N spots shown in their photo".

A photo read once is a photo read: the pass's result per photo is saved per scan
(`scan_photo_reads`, migration `20261009120000`, `photoReadCache.ts`) under a key of the pass
version and settings, and the next run of the scan, or the closer look opening a spot in that
photo, takes the saved read instead of downloading and decoding the photo again. A finding
from a saved read carries no picture (the pixels are gone); its look opens it in the photo.

Closer look opens on that look at once: it cuts the window from the original and draws the
lines and circles over it, nothing to compute. A spot without a look (the photos were not read,
or its photo was over the budget) has its whole photo read there, once, and the read is kept
for the next spot in the same photo. Whole, because the pass needs several rows in view to
trust a fit: the earlier cut of three spacings read nothing on an orchard, which is what
"Reading the rows and plants (0%)" over a dashed box was. The map's dashed outline is still
drawn in the same pixels; a toggle shows the plain crop, and the detector's boxes belong to
that view.

Two faults found the same night on the first real scan (the orchard), both fixed: the pixel
buffer was handed to the pattern worker and then read again for the chip, so every photo with
a finding failed and the pass reported "0 more plants" (the buffer is copied now unless the
caller says it is done with it); and a run with no pattern could not be saved because
`scan_patterns.summary` was NOT NULL (migration `20261008210000` makes it nullable). The
pattern pass now also says why it read nothing: the run notes carry "Pattern pass: N of M
windows showed rows (...), K tiles failed to load, J windows failed (why), at X cm per pixel",
and the pass's most common word on the windows that showed nothing. One window failing is one
window without rows, not a field without a pattern.

## The saved run (2026-10-08)

A finished run is saved per scan (`runCache.ts`, migration `20261008150000`): `scan_patterns`
holds the pattern and the slim result, `scan_findings` one row per candidate as the review
reads it, minus the chip. Opening a scan with nothing running restores the last run, says so,
and renders spots without their pictures until the scan is run again. Verdicts are still
`weed_observations`, joined by (scan_id, candidate_id). The scan card shows the Weed Scout
line (rows, crop plants, spots) once a run is saved. The grid's `ai_analysis` column is untouched.
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

## Apply to Field View and the Flight Planner

The scout's own map is a separate, disposable review surface — nothing there is real until
the operator says so. "Apply to Field View" (`lib/weedScout/applyToField.ts`) is that
"say so": it writes an ordinary `user_annotations` row, the exact shape a hand-drawn
anomaly polygon already produces. Field View already draws that table (`UserPolyLayer`)
and answers a click with a popup naming the issue, the area and any notes; the Flight
Planner already routes over it and prices it at the settings' default rate, with no
"promotion" step for either — see `gridAnomaliesLayer.ts`'s own note that grid zones and
`user_annotations` are the only two shape sources those two surfaces read. A region
candidate's own ring is used as-is; a plant candidate gets a small square around its
centroid, sized like its own chip. `issue_type` is picked from the same vocabulary a
hand-drawn polygon uses (Bare soil, Waterlogging, Weed pressure, Other), and `notes`
carries the in-house estimate's summary and position, already in the operator's own units
— which is what answers "what is this" on a map click. Applying writes no rate and makes
no claim beyond what the estimate already says.

Because developer mode *replaces* the Treatment Grid tab rather than sitting beside it,
Field View also stops loading and drawing the grid's own zones while `weedScout` is on
(`FieldViewTab.tsx`) — a farmer testing the scout was otherwise seeing the old grid's
highlights on the same map with no way to tell them from whatever the scout found.
Applied candidates are unaffected: they draw through the ordinary `UserPoly` layer, which
was never gated on developer mode to begin with.

## Review flow, identification and treatment (2026-09-22)

A finished run lands on a **scan results screen** rather than a map and a 400 px sidebar:
three headline numbers, a row per spot worst-first carrying the chip, the describer's own
sentence, keep / remove / unsure and the identification block, then one button that saves
everything and opens the Flight Planner. "Show map" returns to the scouting map with the
same spot selected; both surfaces write to the same session, so neither is a second copy of
the review.

That screen computes nothing of its own. It composes `lib/weedScout` (the spots and their
order), `describe.ts` (the sentence, attached to each candidate by the pipeline),
`lib/treatment/plannedArea.ts` (the acreage, the same function the Flight Planner prices
with) and `weedCatalog/suggest.ts` (the names and every caveat). Spots carry stable ids
(`spotId.ts`); verdicts are weed / not a weed / unsure with a default shown per row; saving
puts the kept weed spots on the field and takes removed ones off; identification comes from
the Virginia reference catalog, with a suggestion only when the operator's own past verdicts
support one. Treatment is a separate, operator-entered decision priced in the planner. All
of it is in [weed-catalog.md](weed-catalog.md).

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

Every distance, area and resolution figure the tab and the describer produce follows the
operator's unit setting (`useUnitSystem`), the same one every other screen reads: cm/in for
plant and off-row measurements (`fmtLengthCm`), cm²/in² for a leaf's footprint
(`fmtAreaCm2`), and m²/ha or ft²/ac for regions (`fmtArea`). `describe()`, `describeCandidate()`
and the pipeline's own notes all take the unit system as a parameter and default to metric
only for callers, such as the tests, that have no operator setting to read.

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

## The classifier (2026-09-29)

The scout can now carry a learned opinion on each plant spot. After the chips are
rendered, `lib/weedScout/classify/` scores every single-plant candidate with the model this
build ships (`public/models/manifest.json`, written by `offrow learn publish`) and attaches
a `prediction` ({pWeed, pCrop, pOther, modelVersion}) to the candidate. Regions get none:
the model was trained on chips centred on one object and knows nothing about ground.

The model runs in the browser (onnxruntime-web, WebAssembly served from our own origin
under a `'wasm-unsafe-eval'` CSP allowance). Imagery does not leave the page. No manifest,
or a sidecar whose contract the app does not recognise, means no classifier: the run says so
in its notes and everything else is as before.

What the prediction changes: the default verdict, after the operator's own past verdicts.
At or above 0.6 weed a plant starts as a weed, below 0.4 it starts removed, between it
starts unsure. The popup shows the number in words that never say "is a weed". Saving
writes the prediction and model version beside the verdict (`weed_observations.prediction`,
`model_version`), so agreement between the model and the operator is a query per version and
the next training export carries both.

How the model is made, scored and gated is in `offrow/README.md` ("The learning track")
and the living plan in [weed-detection-foundation.md](weed-detection-foundation.md).

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
or rate. `src/test/weedScoutApplyToField.test.ts` covers the Apply mapping: a region's own
ring and area pass through unchanged, a point candidate gets a correctly-sized and
correctly-centred square, the issue vocabulary matches what a hand-drawn polygon offers,
and the colour never varies with score or kind (a display choice carries no claim).

Both migrations are applied to the linked project and the weather function is deployed
(2026-09-21). Not verified: any flown imagery. The thresholds (`anomalyZ` 3.5, `blobZ` 3.5, band 0.30,
1 cm squared floor, hysteresis 0.6) are starting values that the operator's verdicts and a
false-positives-per-acre count from a real field are meant to set. The sweep and the chips
are browser-only and have run under no signed-in session, and neither has Apply — a real
candidate reaching Field View and the Flight Planner as a routable, correctly-priced
polygon has not been clicked through end to end.
