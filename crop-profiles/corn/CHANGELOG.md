# Corn profile changelog

## 1.1.0 (2026-10-23)

- **Grade and hotspots on corn rows.** The weed-pressure grade and the hotspots move from unsupported to experimental.
  They run on corn rows read from the field map by the pattern pass with this profile (`weedVision/patternRows.ts`),
  only after the operator confirms on the map that the rows sit on the corn.
- **Map read.** Corn rows are read from the map at about 3 cm a pixel (`rowReader.readGsdCm`), not 5 cm. At
  5.7 cm the leaves became mixed pixels and the rows fell onto the straw.
- **Row band.** The crop band is set to 15 cm either side of a row line (`rowReader.bandHalfWidthM`), from the
  WeedsGalore band result.
- **Still owed.** No real corn field map has been graded yet.

## 1.0.0 (2026-10-23)

First version. Status: experimental.

- **Reference knowledge.** Planting, growth, morphology, visual characteristics, weed ecology, field conditions and
  imagery from the 2026-10-22 and 2026-10-23 research (`docs/research/crops/corn.md`, `docs/research/crops/corn/`),
  with 124 sources.
- **Run-time configuration.**
  - Planted spacings 38, 51, 70, 76 and 91 cm, searched beside the crop-neutral ones.
  - An ExGR gate at zero on the green mask.
  - A measured-pitch rule and a prior-and-evidence rule for photos a few rows wide.
  - Brightness rows re-placed on the green.
  - Provisional cover classes (the engine's former numbers) and a grade window of V1 to V9.
  - The map grade marked unsupported.
- **Tried and replaced before release.**
  - A floor of 0.05 on the ExG index fixed the red-soil photo but not bright yellow straw in rendered scenes; the
    ExGR gate replaced it.
  - Four-row windows of about 3 m split small photos into blocks that did not join; windows stay at 4 m.
- **Validation.** Six benchmarks run; see `10_validation/validation.json`. Five failure cases registered, three
  fixed with regression tests.
