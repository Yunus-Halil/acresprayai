# Crop Intelligence Profiles: engineering report (2026-10-23)

The system is in `crop-profiles/` (see its README) and `src/lib/cropProfiles/`. The research is in
`docs/research/crops/corn.md` and `docs/research/crops/corn/`. Corn is the reference implementation, at status
**experimental**.

## 1. What the audit found in the existing engine

- **The crop is set in one place, and only one place drives analysis.** It is set in Settings and saved in
  `fields.settings.crop_type`.
  - `fields.crop` is always written empty and only displayed.
  - `crop_zones.crop` and `planted_at` are never used.
  - The choices are nine English names with no orchard crops.
  - Five different functions normalised the name, each its own way (exact, substring, plural, Turkish).
- **The crop barely reached the analysis.** Before this work it set:
  - the cover classes (`grade.ts schemeFor`, by substring);
  - the row-crop refusal (`fieldRows.ts`);
  - the catalogue context;
  - a week-band stage text.

  Row spacing, window sizes, masks and blob floors came from browser-global settings or constants. The default row
  spacing of 76.2 cm (30 in corn) appeared in four places.
- **About 150 agronomic constants were hardcoded.** The full table is in the audit appendix below. The ones that
  matter most for corn:
  - the map row reader's minimum row spacing of 1 m (the root of the corn grading refusal);
  - the 4 m photo window;
  - three copies of the 0.85 canopy-closed share;
  - Turkish TAGEM cover thresholds applied to all wide-row crops;
  - a 0.50 m row band built for trees.
- **The universal parts are sound.** These are crop-neutral, and the profile now configures them rather than
  replacing them:
  - projection, autocorrelation and phase row fitting with a coherence gate;
  - per-window Otsu;
  - Stage 1 cells with uncertain reasons;
  - the grade's unit, floor and near-crop rules;
  - source-frame projection and ownership;
  - the sizer's 6-pixel gate.
- **Uncertainty was already explicit in places but scattered.** Examples: `UNKNOWN_RESOLUTION` (classifier),
  `UncertainReason` (Stage 1), `MeasurementStatus` (sizer), `whyNot` (grade). There was no shared vocabulary and no
  crop-level gate.
- **The corn photo test of 2026-10-23 had shown three failures.**
  - Rows were drawn on the straw in a no-till photo.
  - No rows were found on two close-ups.
  - A grade on the misplaced rows counted the corn as weeds.

## 2. Research completed

Five research passes ran: planting systems, growth and morphology, visual appearance, weed ecology, and imaging
requirements with datasets. Each is a report with a parameter table and a gaps list, built on 124 sources (extension
services, USDA ERS and NASS, WSSA, peer-reviewed agronomy and remote sensing, the Turkish ministry, vendor
specifications marked as such). The uncertainties that matter most:

- No US row-width survey newer than 2015, and that one is a vendor survey.
- No cover-by-V-stage table from imagery. V3 and V6 come from one Chinese study; the rest is our estimate.
- No validation of calendar or GDD stage estimates.
- No US cover action threshold for corn. US guidance acts on weed height and stage, so the engine's 10% cover point is
  marked provisional.
- No RGB study separates weed species in corn at 1 cm a pixel or coarser.
- The WSSA per-region survey tables refused every fetch.

## 3. Structure implemented

See `crop-profiles/README.md`. In short:

- **Schema.** zod schemas (`src/lib/cropProfiles/schema.ts`), with JSON Schemas generated from them.
- **Shared vocabularies.** Units, staging systems, pattern types, morphology terms, image-quality standards,
  uncertainty codes, weed taxonomy.
- **Twelve documents per crop.** Reference knowledge, the algorithm contract, uncertainty policies, validation and
  references, kept apart.
- **A validator.** It checks the schema and every cross-reference: sources, stages, regions, species, codes and units.
  It refuses "validated" without passing benchmarks.
- **A compiled run-time file** per crop, bundled through `import.meta.glob`.
- **A registry** that resolves crop names.
- **A checks module** for the four questions.

## 4. Which algorithms use the profile, and how

| Analysis | What the profile changes | Where |
|---|---|---|
| Photo pattern pass (scan map pass, photo pass, per-photo rows for models, closer look, Photo Scout) | Planted spacings searched beside the crop-neutral ones; ExGR gate on the green mask; pitch must be measured; prior-and-evidence rule; brightness rows re-placed on green | `photoScout/pattern.ts`, `weedScout/photoPass.ts photoPassParams`, `fieldPattern.ts`, `pipeline.ts` |
| Saved photo reads | The key names the crop and profile version | `photoReadKey` |
| Field rows for the grade, Stage 1 and hotspots | Corn: rows read from the map by the pattern pass with the profile, at 3 cm, band 15 cm each side, used only after the operator confirms them on the map (Crop rows panel, "They sit on the crop"); other crops keep the tree reader or the planting layout | `weedVision/patternRows.ts`, `frameRunStore.ts`, `CropRowsPanel.tsx` |
| Weed pressure grade | Crop group and cover classes from the profile (corn: same numbers, marked provisional); waits for confirmed rows; Stage 1 reads at the profile's 3 cm and refuses a coarser map; refused past the stage window when a planting date is set | `grade.ts`, `pressureStore.ts`, `stage1.ts` |
| Growth stage text | Estimated range from the profile's calendar, marked estimated | `farmerSettings.growthStage` |
| Weed catalogue | Crop context by any alias (maize, mısır) | `weedCatalog/region.ts` |
| Weed Scout panel | Crop profile card: expectations, observations, each analysis on, review or off with its reason, regional weed list marked as a reference | `CropProfileCard.tsx` |

**Crop-neutral changes, deliberately in the engine.** A row block needs at most as many windows as a photo has
(`minBlockWindows`). This fixed small close-ups for every crop. Crops without a profile otherwise run unchanged; their
photo-read keys are unchanged, and a test pins that.

**Not wired.** These analyses still use their own constants:
- the field-map tree reader (`fieldRows.ts`);
- the planting-layout fitter;
- Stage 1;
- the sizer's thresholds;
- hotspots.

Since corn profile 1.1.0 the map grade and hotspots run on confirmed corn rows. The size thresholds and the rest of
the Stage 1 parameters are in the profile but not read yet.

## 5. Tests and real results

- **Tests.** `src/test/cropProfiles.test.ts` has 33 tests and `src/test/cropProfilesEngine.test.ts` has 8. They cover
  the profiles on disk, runtime freshness, the validator's refusals, name resolution, the four questions, the engine
  wiring, and regression tests for each fixed failure case. The full suite (1996 tests) passes.
- **Benchmarks** (`npm run bench:crop-profile`). The results are in `crop-profiles/corn/10_validation/results/`:

| Benchmark | Data | Without profile | With corn profile | Acceptance |
|---|---|---|---|---|
| Rendered stands, correct rows | 60 held-out scenes | 0.78 | 0.90 | rows found 0.98 ≥ 0.95 met; pitch error 0.001 met; lines on crop 0.95 met |
| Rendered stands, wrong rows | same | 0.22 | 0.08 | |
| Real photos, rows found | 3 early-corn photos (development) | 2 of 3, one of them on the straw (1 of 3 before the small-photo block fix) | 3 of 3, all on the crop | met |
| Real photos, green on lines over mid-alley | same | 0.39 on the no-till photo | 12 or more on all | met |
| Vegetation IoU, 0.25 cm | WeedsGalore, 26 held-out patches | 0.25 | 0.41 | ≥ 0.70 not met |
| Between-row weed cover error | same (oracle rows) | 0.368 / 0.148 / 0.013 | 0.014 / 0.020 / 0.031 at 0.25 / 1 / 2 cm | ≤ 0.03 at all three not met (2 cm) |
| Maize inside the row band | same | 0.95 to 0.97 | 0.95 to 0.97 | ≥ 0.85 met |
| Stated stage in estimated range | WeedsGalore dates | n/a | 1 of 1 | met |

**How the evaluation was kept honest.**
- The first set of evaluation scenes was looked at while the ExGR gate replaced the ExG floor. It was moved to
  development data, and a fresh set was run once.
- WeedsGalore's test split was never used to set anything. Its band gain came from the train and val splits.
- The three photos are labelled development data, because one was used to diagnose.

## 6. Remaining weaknesses and unsupported conditions

- **No independent corn field with row-line truth or hand-measured weeds.** Real-field accuracy of rows, positions and
  sizes is unmeasured beyond three photos.
- **The corn map grade and hotspots are experimental.** They run on confirmed rows, but only on stand-in maps so far.
  Stand count is unsupported.
- **Vegetation IoU misses its target.** On P4 Multispectral band composites it is 0.41 against 0.70. At 2 cm the gate
  under-reads cover by about 3 points.
- **The calendar stage estimate is wide.** It is VE to V9 at 28 days. There is no GDD estimate without daily weather.
- **Out of reach by design.** Purple seedlings fall below the gate. Weeds in the row, grass weeds and volunteer corn
  cannot be separated from the crop. Species are never named from the pixels.
- **Region is still the Virginia testing assumption** for the weed list.

## 7. Next three engineering actions

1. **Done in corn 1.1.0: corn rows from the field map for the grade.** The map pattern pass with the corn profile
   (the tiled profile reader `docs/research/crops/row-reading-approaches.md` recommends) feeds `FieldRows`, with the
   operator's confirmation before any grade. Still owed: a real corn field map.
2. **One real corn field end to end.** Use original frames with EXIF, the ortho and the planting date. Draw rows and
   off-row weeds on the frames for review. Add it to the benchmark as the first independent field, split by field.
3. **Read the rest of the profile's contract.** Stage 1 parameters, sizer thresholds, hotspot minimum size and the
   capability gates inside the scan pipeline itself. Add a GDD stage estimate from a weather history. Then decide, on
   that field's evidence, whether the ExGR gate should become the engine's default for every crop.

## Appendix: the hardcoded-assumption audit

The full table of constants, with file, line, value and whether each is universal or crop-specific, came from the
codebase audit of 2026-10-23. Its headline items are in section 1. The ones the corn profile now owns:
- row spacing priors and candidates;
- the vegetation gate;
- canopy-closed share;
- cover classes;
- the grade window;
- size thresholds;
- the minimum hotspot object.

Those still hardcoded and crop-specific are the next candidates for profile fields: `fieldRows.ts MIN_ROW_SPACING_M`,
`MIN_PLANT_AREA_M2`, `LAYOUT_BAND_M`, `PAINT_CROWN_MARGIN_M`, `ROW_BAND_MIN_M`, `DEFAULT_SCOUT_PARAMS.bandFrac`,
`photoMinWeedM`, `CANOPY_CLOSED` (three copies), and the orchard-tuned planting-layout parameters.
