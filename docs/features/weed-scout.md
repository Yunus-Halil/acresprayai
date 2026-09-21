# Weed Scout (experimental, developer mode)

The experimental replacement for the Treatment Grid, switched in per browser from
Settings, section 5, "Developer mode". It is the `offrow/` research track ported into the
app and wired to the scan on screen, plus an event context and an observation archive.
Nothing about it is a verdict. The Treatment Grid stays the shipped analysis system and
its stored state is untouched while the switch is on.

## The switch

`src/hooks/useDeveloperMode.ts` holds `{ weedScout: boolean }` in
`localStorage["swathwise.developer"]`, like the unit preference and for the same reasons
(a per-browser preference of the person testing, nothing to do with a field's data). When
it is on, the workspace's "treatment" tab slot renders `WeedScoutTab` instead of
`TreatmentTab`, and every button that opens the analysis system opens the scout. Off
again, the grid is back exactly as it was.

## The pipeline, in the operator's order

All of it is `src/lib/weedScout/`, pure except where the browser is unavoidable.

| Step | What | Module |
|---|---|---|
| 1 | The boundary becomes `tileM` (default 3 m) squares in a local metric frame, clipped by centroid; headland tiles are kept for the baseline and excluded from scoring | `tiles.ts` |
| 2 | Every tile is measured: chromaticity shares, brightness and its spread, ExG and its spread, green-red index, vegetation fraction | `baseline.ts` |
| 3 | Median and scaled MAD per feature over the field; a tile is "not average" when its most deviant feature is past `anomalyZ` (default 3.5), and the flag names the feature | `baseline.ts` |
|   | Where the crop rows can be fitted (angle by projection-variance search, pitch by autocorrelation inside a band around the stated spacing, phase by circular mean in ground metres about the window centre), vegetation further from the nearest centreline than 30% of the spacing is off-row | `rows.ts`, `blobs.ts`, `candidates.ts` |
| 4 | Flagged tiles and the tiles of the top candidates are re-read at the deepest baked zoom, one tile at a time; blobs are remeasured on those pixels and a chip is rendered with smoothing off so every visible square is one real pixel | `zoom.ts`, `pipeline.ts` |
| 5 | The event context (place, local time, season, nearest-station weather) is fetched once per capture; the brain is asked per candidate on request | `context.ts`, `brain.ts` |

The vegetation mask is ExG plus half the informative part of CIVE on chromaticity,
thresholded with Otsu per tile and a whole-field fallback for tiles with no soil-to-plant
contrast of their own (`vegetation.ts`). No morphology: the ground-unit area floor in
`blobs.ts` (1 cm squared) does the despeckling continuously in GSD, which a kernel
cannot.

Candidates carry a `kind` ("off-row vegetation", "field outlier", or both), a rank score,
the distance to the row, the tile's deviation and its driving feature, the blob's
measurements, and the chip. A flagged tile with no vegetation at all (bare patch, water,
residue) still enters the queue as the tile, because that is exactly the "not average
thing" the operator asked to be shown.

## The event context

`weather?mode=context&lat&lon&time=` on the existing weather edge function. NOAA's
`/points` gives the relative location ("Fairfax, VA") and the IANA time zone; the
observation mode gives the nearest station's report closest to the capture time, now with
the station's sky text ("Sunny"). Local time is formatted in the field's zone; season is
meteorological, shifted for the southern hemisphere. Every field is nullable and a failed
lookup carries its reason. Nothing is ever invented.

The sentence the operator sees: "Captured in Fairfax, VA at 5:05 PM local time, autumn.
Sunny, 74 F, wind 6 mph NW at Washington Dulles International Airport (8 mi away)."

## The brain

`supabase/functions/weed-brain`: a signed-in POST with the chip (base64 PNG), its scale,
the context, the crop and stage, the row spacing, and the candidate's measurements. It
calls Claude Opus 5 with a structured-output schema and returns a description: whether it
reads as vegetation, growth habit, leaf and colour notes, plausible GROUPS with a
likelihood and a reason, a crop look-alike note, what a person on the ground should check,
and caveats. The system prompt forbids naming any product, rate or dose, and the function
rejects a reply that mentions one. Without `ANTHROPIC_API_KEY` it answers `unconfigured`
and the UI says so plainly.

Server-side refusal fallback is enabled by default (`fallbacks: "default"` with the
`server-side-fallback-2026-07-01` beta), so a policy decline re-runs on a fallback model
inside the same call.

## The archive

`public.weed_observations` (migration `20260921120000_weed_observations.sql`), one row per
candidate the operator chose to save. The chip goes to the private `weed-chips` bucket
under `<user_id>/<scan_id>/<candidate_id>.png`. Columns hold the where and local when, the
season and place, the station weather, the crop and stage, the imagery scale, the
pipeline's measurements, the brain's estimate and model if asked, the pipeline version and
parameters, and the operator's verdict (`weed`, `crop`, `not_vegetation`, `unsure`),
species text and notes. The verdict is the label; everything else is the feature.
Owner-scoped by RLS; there is deliberately no cross-user read. A national dataset is a
later, consented, separate step.

## What is and is not verified

Verified: 24 tests in `src/test/weedScout.test.ts` against synthetic scenes with known
truth. Rows at 23 degrees and a 76.2 cm pitch are recovered to within 1.5 degrees and 5%,
and the centrelines pass within 4 cm of the planted positions (the phase check that caught
two silent bugs in the research track). Between-row plants rank as off-row; the crop does
not. A bare patch is the only tile flagged in a uniform field. Noise at the same coverage
refuses to be queried. The context sentence matches the example the operator gave.

Not verified: any flown imagery. The area floor, the flag threshold and the in-row band are
the research track's defaults and the false-positives-per-acre measurement from a real
field is what sets them. The zoom step and the chip renderer are browser-only and have run
under no signed-in session. The `weed-brain` function is written to the current SDK
surface but has not been deployed or called. Deploy it with
`npx supabase functions deploy weed-brain`, set `ANTHROPIC_API_KEY` with
`npx supabase secrets set`, and push the migration with `npx supabase db push`.
