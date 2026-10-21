# Weed pressure: how to grade it, and how to keep false marks out (2026-10-21)

Three web sweeps on 2026-10-21 after the operator's brief: once the rows and crops are found, remove them from what
the weed model sees, run the weed model, grade pressure carefully with no false positives, and tell apart three
scenarios: (1) many tiny weeds; (2) one big weed, and several large clusters; (3) one large cluster filling a big share
of a tile. "How do we decide high and low pressure, how much does greenness count, how does the crop factor in, and
what did others do?"

Labels: **[S]** sourced (primary or its abstract), **[S2]** secondary (review, extension page, search snippet),
**[I]** inference. Many publisher full texts were paywalled; such figures come from abstracts and are marked so in the
sweep reports. Nothing here has been built yet; the recommendation at the end awaits the operator's go-ahead.

What Swardus does today: rows and crowns are painted with the field's bare-ground colour (crowns +0.3 m) before
RF-DETR runs (`src/lib/weedVision/layout/rowBand.ts`); Stage 1 grades cells by weed cover into none / <1% / 1-5% /
5-25% / >25%, a patch is 8-connected cells at 5% or more, a patch is high priority at 25 m² or 25% mean cover
(`src/lib/weedVision/twoStage/score.ts`). All of those boundaries were our own choice.

## 1. What measures pressure

| Metric | Relation to yield loss | Source |
|---|---|---|
| Density, plants/m² | Cousens hyperbola YL = I·D/(1+I·D/A); parameters vary by species, crop, year, site (corn: sunflower I 49.2 vs shattercane 4.2). Field-mean density "of limited value" because weeds aggregate | Cousens 1985 [S]; Cardina 1997 [S] |
| Relative weed cover Lw = weed / (weed + crop) | Kropff & Spitters YL = q·Lw/(1+(q−1)·Lw); as good as density (r² 0.67-0.90 vs 0.61-0.92) and folds in emergence time and size; must be measured before canopy closure | Kropff & Spitters 1991; Ngouajio 1999; Lotz 1994, 1996 [S] |
| Relative cover from UAS imagery | Maize V3-V8, 0.47-1.45 cm/px: q 0.2-0.8, mean 0.54; uncorrected r² < 0.17, 0.97 after a site correction; altitude and sensor did not matter; invalid after closure | Goldsmith et al. 2025, Weed Sci, doi 10.1017/wsc.2025.3 [S] |
| Absolute cover % per m² | The unit of the Turkish ministry's action thresholds and of German cover thresholds; what UAV weed maps report | TAGEM 2022; Gesunde Pflanzen 2014; Peña 2013 [S] |
| Greenness intensity (ExG, NDVI value) | Used by no paper or tool as a pressure scale: only to separate vegetation from ground. Pitfalls: shadow, residue, crop stage (ExG cover error 2.2-17.8%), NDVI saturation, sensor calibration | Peña 2013, 2015; Adhikari 2026; WUR shadow study [S] |

Worked Kropff loss bands [I, arithmetic]: at Lw 0.05 / 0.10 / 0.25, loss is 2.8 / 5.7 / 15% with q 0.54, 5 / 10 / 25%
with q 1, 9.5 / 18 / 40% with q 2. Shown only as bands, only before closure.

## 2. Thresholds people act on

| Crop | Threshold | Source |
|---|---|---|
| Maize, Turkey | act at 10-15% weed cover per m²; spray at grasses 10-15 cm, broadleaves 2-4 leaves | TAGEM Mısır EM Teknik Talimatı 2022 [S] |
| Cotton, Turkey | 10% cover broadleaves, 15% grasses | TAGEM Pamuk 2022 [S] |
| Olive, apricot, citrus, Turkey | 10-15 weeds/m² or 10-15% cover (apricot annex and citrus: >15%) | TAGEM Zeytin, Kayısı, Turunçgil 2022 [S] |
| Winter wheat / barley, Germany | economic threshold 9.2-9.8% / 4.5-8.9% absolute cover (122 trials) | Gesunde Pflanzen 2014 [S2] |
| Cereals, EU | Galium 0.1-2, broadleaves 40-50, grasses 20-30 plants/m²; blackgrass ~12/m² for 5% loss (UK) | Hamouz 2013; AHDB [S, S2] |
| Corn, US | competitiveness groups: high (cocklebur, waterhemp, giant ragweed) ≤1 plant per ft of row for 5% loss; moderate 5-10; low (foxtails, crabgrass) >10 | SDSU [S] |
| UAV maize map | classes <5 / 5-20 / >20% cover | Peña 2013 [S] |
| Critical period | corn ~V3-V10 (by N), ends ~V14 near closure; soybean V1 (76 cm rows) to V3 (19 cm) start, ~2% loss per leaf stage of delay | Hall 1992; UNL; Knezevic 2002, 2003 [S, S2] |
| Weed size | most post products lose efficacy above ~7.5-10 cm; Palmer >90% control at ≤15 cm, nothing alone at 33-90 cm | Illinois, MSU, labels; Beltwide 2011 [S2] |

No commercial tool (Agremo, Solvi, Sentera, Taranis, DroneDeploy, Pix4Dfields, Hummingbird, Greeneye, See & Spray,
Ecorobotix) publishes numeric pressure classes; most produce binary spray / no-spray zones sized to the machine.

Machine units: nozzle spot spraying 1 × 1 m box per weed with 0.5 m before and behind (Allmendinger 2024); boom
sections 6 m and 6 × 10 m cells (Hamouz); spray drone ~0.1 acre vs nozzle ground rig ~0.001 acre (Iowa State);
patch control units above ~6 × 6 m unprofitable for blackgrass (Paice 1998) [S]. No standard patch buffer width
published.

## 3. The three scenarios

- **(1) Many tiny scattered weeds.** Spread-out weeds compete harder than clumped ones: barnyardgrass regular or
  random cut tomato yield 20-40% more than clumped at the same density (Norris 2001) [S]. Small weeds are the easiest
  to kill, and late spot spraying in maize gave 20% efficacy against 86% early (Allmendinger 2024) [S]. So low cover
  with many objects inside the critical period is **urgent, not low** [I]. At 1.5-5 cm/px a weed needs about 3-4
  pixels to be seen (Peña 2015) [S], so the smallest weed found is 5-15 cm, already near label size: the map must say
  its detection floor [I].
- **(2) One big weed.** A seed and resistance problem, not a yield one: one Palmer amaranth plant 200,000-600,000
  seeds; one plant's seed (20,000) placed in 1 m² infested over 20% of four fields by year 2 and over 95% by year 3,
  the basis of "zero tolerance" (Norsworthy 2014) [S]. One plant in a 2-5 m cell is a small share of the cell's yield
  [I]. Grade: do not raise the cell's class; report a "large escape" point with its size [I].
  **Several large clusters** that touch are a patch, graded by mean cover and area [I].
- **(3) One large cluster filling much of a cell.** Cover classes catch it directly; clumped weeds cost less yield per
  plant (Norris 2001) [S], but patches persist year to year (Rew & Cussans 1995; Gerhards 1997) [S] and seed falls
  within 2 m, so the patch area sets field priority and a buffer is warranted [I].
- No source ranks the three on one scale. Yield models favour cover (3 above 1), seedbank logic favours large
  individuals (2), herbicide efficacy favours acting early on (1).

## 4. How the crop factors in

- Grade only before canopy closure for row crops: detection and loss models fail after (Goldsmith; Allmendinger:
  reliable to about 4-leaf maize; Sentera accepts corn V1-V4, soybean V1-R2 only) [S].
- Relative cover needs the crop's cover per cell as the denominator, which the planting layout already measures [I].
- Row spacing: soybean critical period starts at V1 in 76 cm rows vs V3 in 19 cm; narrow rows cut weed density 42%
  and biomass 71% [S]. Drilled cereals have little inter-row ground, so weeds sit in the crop [I].
- Orchards: the zone matters more than the cover. Under-tree strips are kept bare (1.5 m apple; 76 cm each side of the
  trunk peach and almond; 0.8-1.5 m by tree age for young peach); young trees suffer most (almond first 4 years); alleys
  are often a deliberate sward (Spanish olive ≥30%; Turkish guides recommend cover crops) and matter through water
  competition in the dry season [S, S2].

## 5. False positives

- **Nobody reaches zero.** Best measured: per-plant false detections 4.5% (soil, mulch, stones; Allmendinger 2024);
  cell precision ~97% with a height gate and RTK rows (Mink 2018, 9 m cells); commission <2% with height and
  phenology in a vineyard sward (de Castro 2020); YOLO per object P 0.786 R 0.779 (Montana 2025) [S].
- **Misses are larger.** Drone maps missed 41-65% (RGB), 48-74% (NIR), 78-85% (YOLO) of weeds against a camera sprayer
  (Montana 2025); sunflower errors mostly omissions (Peña 2015) [S].
- **Agronomy prefers over-marking to missing**: de Castro 2018, Peña 2015, Huang 2018 (recommends a 0% threshold);
  a sprayer at low sensitivity raised the Palmer seedbank 280% a year over three years (Arkansas 2025) [S].
- **Ranked sources of false weeds**: (1) crop at row edges or overhanging leaves, the most repeated (up to 47% of
  over-detection, Peña 2015; Bah 2018; Louargant 2018); (2) crop the row model missed; (3) soil, mulch, residue,
  stones; (4) similar vegetation (cover crop, volunteers); (5) coarse resolution; (6) mosaic seams and ghosting (maize
  counting R² 0.616 on the mosaic vs 0.906 on raw frames); (7) motion blur; (8) shadows; (9) **painted or masked
  regions**: untested in agriculture, but general vision work finds masked pixels push models out of distribution and
  paste boundaries create edges detectors fire on (Jain 2022; Dwibedi 2017) [S, S for analogues].
- **Mitigations with measured effect**: row buffer sized to object size (Peña 2013); multi-view consistency raised
  precision 12-22 points with recall flat (ground robot, Lottes 2018; apple SfM +0.065 F1) though no UAV weed paper
  does it yet; height gate (Mink; de Castro); cell cover thresholds (Huang: treated area 41.7% at 0 to 29.2% at 0.25);
  per-field calibration (Montana re-tuned per date); blur rejection (Genze 2023); audit stages (precision 0.82 to 0.92,
  recall −2.6 points) [S].
- **Cell vs plant**: aggregation into cells raises the precision of presence when weeds cluster, but systematic false
  marks (row edges) repeat in every cell along a row and are hidden, not removed [S, I].

## 6. Recommendation (for the operator's go-ahead; not built)

1. **Cell metric**: weed cover % of visible ground after crop removal; greenness only decides vegetation or not [S].
2. **Classes by crop group** [S where marked, else I]:
   - wide-row crops before closure: none / trace <1% / low 1-5% / moderate 5-10% / **action ≥10%** (TAGEM maize;
     cotton 10% broadleaf, 15% grass) / high ≥20-25% (Peña);
   - drilled cereals: none / trace / low 1-5% / **action ≥5% barley, ≥9-10% wheat** (German thresholds) / high ≥15-20%;
   - orchards, graded in the tree-row strip: none / low <5% / moderate 5-10% / **action ≥10-15%** (TAGEM apricot,
     olive, citrus) / high ≥25%; young trees one class up; alleys reported as cover, promoted to pressure only for young
     orchards, the dry season in rainfed orchards, or when the operator says the alley should be bare.
   The current 5-25% band is split at the published action point; 25% sits above every published threshold.
3. **Scenario 1**: an objects-per-m² axis beside cover; inside the critical period, many small objects step the cell up
   one class and tag it "treat while small"; every map states its detection floor in cm for its imagery.
4. **Scenario 2**: a large single weed never raises a cell's class; it is a "large escape" point with its size and a
   seed-risk note, at the machine's smallest unit (1 × 1 m box). Touching large clusters are a patch.
5. **Scenario 3**: class from cover; field priority from patch area (patch rule kept at 5%; the 25 m² priority is ours,
   labelled so, and better expressed in machine units).
6. **Relative cover and loss band**: weed / (weed + crop) per cell from the planting layout's crop area, shown as a
   Kropff loss band only before closure, never as a number [S, I]. Never a product rate.
7. **False marks, in order of payoff**: (a) row band from the measured crown size, marked "not assessed" not
   "weed-free"; (b) test running the model on the unpainted image and dropping detections over the crop, against
   painting, on our own frames before switching; (c) flag a cell only with corroboration (cover or object count);
   (d) a weed must re-project to the same ground spot in at least two overlapping raw frames; (e) detect on raw frames,
   not the mosaic; (f) no plant-level claim under about 4 pixels per object; (g) per-field confidence calibration;
   (h) reject blurred frames. Output two tiers, "confirmed" and "possible", each with its source-photo evidence; lone
   single-weed cells go to review, never silently dropped.
8. **Validation owed**: one exhaustively labelled field per crop group, scored at the planned cell size, precision and
   recall reported separately. Target (inference): cell precision ≥95% with recall stated beside it.

## Not found

EWRC 1-9 anchors; Danish Crop Protection Online numeric targets; Gerhards maize and sugar-beet thresholds; the Turkish
cereal (Hububat) threshold table; any vendor's numeric pressure classes; a standard patch buffer width; a UAV study of
multi-frame voting for weeds; a buffer-width sweep against commission and omission; any source ranking many tiny
weeds against one large one on one scale; weed mapping inside grassed olive, almond or apple alleys.
