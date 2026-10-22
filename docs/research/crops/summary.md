# US row crops: summary of the 2026-10-22 research

Corn, soybean, wheat and cotton, US only. Detail and sources are in [corn.md](corn.md), [soybean.md](soybean.md),
[wheat.md](wheat.md), [cotton.md](cotton.md), [estimating-from-upload.md](estimating-from-upload.md) and
[row-reading-approaches.md](row-reading-approaches.md). Nothing in the code was changed.

## Five things that most change what we should build

**1. US guidance does not act on cover, so our cover classes cannot be the trigger.** No US extension source gives a
cover-percentage action point for corn, soybean or cotton. US advice acts on crop stage (the critical period), weed
height (before about 4 in, 10 cm; 2 to 4 in in soybean, 3 in for Palmer amaranth in cotton), density per length of row
where it exists, and zero tolerance for Palmer amaranth and resistant waterhemp. The one US cover rule found is for wheat:
Kentucky rates fall total weed cover as light under 5%, moderate 5 to 30%, severe over 30%, on all the ground, not the
ground between rows. Cover between rows is what we measure best and should keep informing the operator, but the stage
window and the species answer should decide when to act.

**2. Growth stage decides more than anything we see, and the imagery cannot supply it.** The critical periods are stage
windows: corn about V1 to V11, narrowing to V6 to V9 with high nitrogen, about 2% loss per leaf stage of delay; soybean
starting at V1 in 30 in rows, V2 in 15 in, V3 in 7.5 in, through R3; cotton the first 6 to 8 weeks after emergence, with
Palmer amaranth costing yield from about 19 to 21 days and mattering until about the 12 leaf stage. Labels cut off by
stage too. Cover alone gives no stage, and drone height is too noisy for seedling corn or for soybean. The planting date
is therefore a question we must ask; with heat units it gives the stage, and the imagery checks it.

**3. The window for a between-row grade is short and differs by crop; wheat barely has one.** The alley closes at about
V10 to V11 in 30 in corn (6 to 8 weeks after emergence), about seven to nine weeks after planting in 30 in soybean and one
to three weeks earlier in 15 in rows, and slowest in cotton (33% closed at 7 weeks in Mississippi single rows, never in
some conventional and skip-row fields). Wheat already covers more than half the ground by late fall, its 19 cm rows are
under 4 pixels at 5 cm, and its rows vanish after jointing. After closure the grade has nothing to divide by and the
useful product is the late-season view: escapes above the canopy and a seed map for next year.

**4. RGB at 1 to 5 cm a pixel finds rows and measures cover by position; it cannot name weeds.** Every study that
separated weed species in maize or soybean worked at 0.3 to 0.8 cm a pixel; Texas A&M could not tell species apart in
cotton at 0.8 cm. Palmer amaranth cannot be told from waterhemp, grass weeds cannot be separated from vegetative wheat
(about 70% at best in US work, models not transferring between flights), weeds inside the row cannot be told from the crop,
and nothing under a closed canopy is visible. So whether Palmer or resistant waterhemp is in the field must be asked, and
the escape rule's targets are crop-specific: giant ragweed in corn (waterhemp rarely overtops corn), Palmer amaranth and
waterhemp in soybean and cotton.

**5. The first row reader to build is a tiled profile reader, and the crop can be narrowed but not decided from the
imagery.** Profile and projection methods have the best evidence on whole-field drone orthos (corn F1 0.995 over 6.1 ha;
cotton 0.99 to 1.00; wheat 0.66 to 0.82 at 2 cm) and beat Hough twice head to head; the pieces exist in our photo pass.
Tiles of about 10 to 15 m, direction from an FFT then a fine sweep, spacing snapped to the known US spacings, a validity
gate that says "no rows" rather than guessing. Row spacing then narrows the crop (drilled wheat is the narrowest; 38 to 40
in is cotton), but 30 in corn and 30 in soybean cannot be told apart by spacing, and the Cropland Data Layer only offers
last year's crop. The crop is a one-tap confirmation, pre-filled, never a silent guess.

## Three biggest gaps

**No measured link from drone RGB to stage or closure.** No published table turns canopy cover into V stages or Feekes
stages, no drone rule declares row closure, and nobody has measured how the periodic row signal fades as cover rises. We
will have to measure these on our own fields.

**No US drone study at our resolution that separates weeds from soybean or corn, and no labelled row truth.** The US
weed-crop separation work is at millimetre scale or uses multispectral; there is no public drone orthomosaic with row
lines for any of the four crops, and nothing on how a freshly sprayed field looks from the air. Any accuracy claim for
these crops will rest on our own data.

**Field geometry and national row-spacing data.** No source covered headlands, point rows, guess rows between planter
passes, terraces or skip-row frequency, and USDA publishes measured row widths for soybean only; corn, cotton and wheat
shares come from vendor surveys or single states.

## What the code uses today, and what has to be replaced

All of these are Turkish or European and need replacing with the US rules above before the four crops are graded:

- `src/lib/weedVision/pressure/grade.ts`, `schemeFor`: the wide-row scheme (used for corn, soybean and cotton) acts at 10%
  cover with high at 20%, sourced to the Turkish ministry (TAGEM 2022, maize and cotton) and Peña; its 15% grass branch
  for cotton is hard-coded off. The cereal scheme acts at 9% (wheat) and 5% (barley), from a German study (Gesunde
  Pflanzen 2014). The orchard scheme's 10 and 15% are also TAGEM. The header comment, the treatment-unit note and the
  orchard floor-pass note cite the Turkish guides, and the crop word lists carry Turkish names.
- `src/lib/plantingPractice.ts`: row spacings of 0.70 m (Turkish) and 0.75 m (European) for corn, 0.70 m for cotton, and 0.125, 0.14, 0.17 and 0.20 m for wheat are
  Turkish or European, not US; the US values are 0.76 m corn (with 0.51 and 0.56), 0.97 to 1.02 m cotton, and about 0.19 m
  wheat (0.15 to 0.25 m by region, wider in the dry Plains and the Pacific Northwest).
- `src/lib/weedScout/rows.ts`: comments giving Turkish corn and cotton spacings.
- Our earlier research ([weed-pressure-grading-2026-10-21.md](../weed-pressure-grading-2026-10-21.md) and
  [weed-measurement-and-prioritisation-2026-10-21.md](../weed-measurement-and-prioritisation-2026-10-21.md)) quotes TAGEM
  thresholds and a Turkish cotton critical period (15 to 60 days after emergence); for US work these are superseded by
  the crop files here.
