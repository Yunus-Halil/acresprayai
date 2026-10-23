# Corn profile changelog

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
