# Corn profile changelog

## 1.2.0 (2026-10-29)

- **Photographs read by the continuous-row reader.** `src/lib/rowCrop/readRowCrop.ts` replaces the lattice pattern
  pass for this crop's photographs (Photo Scout): rows are traced strip by strip on the soil-relative green, never on
  brightness, so never on the straw; the whole row is the crop; each row's crop band comes from its own green
  (`rowReader.bandHalfWidthM` is its floor); a green patch is a weed candidate only when it stands clear of every
  band; gaps along each row are reported; the stand is estimated from the green peaks along the row at 1.5 cm and
  finer, marked unverified. Lawns, verges and closed canopy are left out as solid green.
- **Measured.** 15 real top-down photographs of one V5 to V7 field (`directtestimagery`, no EXIF: the scale is assumed
  from the pitch and the default spacing, and the read says so): every visible row traced on the crop, 1 to 14 patches
  between rows per photograph, about half a second a photograph. Three residue photographs: rows on the corn, weeds
  outlined between the rows. Rendered development stands: rows on the crop on 23 of 24; the exception is a V2 stand
  under weeds larger than its plants (failure case registered as the known weak case).
- **Known limits.** Row ends can run a metre or two into a mown verge; a weed touching the crop's leaves is the
  crop; twin rows share one band. The field map still goes through the pattern pass (`weedVision/patternRows.ts`).

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
