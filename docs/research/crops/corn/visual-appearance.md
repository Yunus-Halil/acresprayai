# Corn: visual appearance and the conditions that make RGB vegetation segmentation misleading

Research date: 2026-10-23. Scope: overhead drone RGB photos and orthomosaics of corn (maize) at 0.3 to 5 cm/px, and how the app's two masks behave on them:

- `src/lib/weedScout/vegetation.ts`: ExG + 0.5*CIVE on chromaticity, per-tile Otsu.
- `src/lib/weedVision/fieldRows.ts`: ExGR = 3g - 2.4r - b on chromaticity, vegetation at ExGR > 0, cover mask at ExGR > -0.08 (`COVER_EXGR`). Our own field measurements: soil about -0.24, straw about -0.14, ripening wheat about 0.

Evidence labels used below:
- **Strong**: peer-reviewed, measured, numbers read in the full text this run.
- **Moderate**: peer-reviewed but abstract or secondary only, or a single site.
- **Weak**: extension, trade press, forum, or (snippet) = seen only in a search-result snippet, not opened.
- **Ours**: our own arithmetic, illustrative, not a measurement.

"Not found" means searched in this run without a result, not that it does not exist.

---

## 1. RGB vegetation indices for crop/soil separation

### Formulas (chromatic coordinates r = R/(R+G+B), etc.)

| Index | Formula | Threshold practice | Source |
|---|---|---|---|
| ExG (Woebbecke et al. 1995) | 2g - r - b | Otsu, or fixed (one study: 10 on 8-bit scale) | Meyer & Neto 2008 (below); s40502-020-00562-0 (snippet) |
| ExR | 1.4r - g | used inside ExGR | same |
| ExGR (Meyer & Neto 2008) | ExG - ExR = 3g - 2.4r - b | **fixed zero**, "built-in", no Otsu | Meyer & Neto 2008, Comput. Electron. Agric. 63:282-293, doi:10.1016/j.compag.2008.03.009 (abstract via search) |
| CIVE (Kataoka 2003) | 0.441R - 0.811G + 0.385B + 18.787 (vegetation = low CIVE) | Otsu or mean | coefficients from the general literature; a UAV study uses different CIVE coefficients (snippet) - check per paper |
| VEG (Hague 2006) | G / (R^a * B^(1-a)), a = 0.667 | Otsu or mean | general literature, not re-verified this run |
| COM (Guijarro 2011) | 0.25 ExG + 0.30 ExGR + 0.33 CIVE + 0.12 VEG | mean / fuzzy | weights as quoted in a sensors study (snippet) |
| COM2 (Guerrero/Burgos-Artizzu group) | 0.36 ExG + 0.47 CIVE + 0.17 VEG | | (snippet); weights differ between papers |
| VARI (Gitelson 2002) | (G - R)/(G + R - B) | | general literature |
| GLI (Louhaichi 2001) | (2G - R - B)/(2G + R + B) | | general literature |
| NGRDI (Tucker 1979) | (G - R)/(G + R) | | general literature |

Note: an ESA SNAP spec defines "ExGR" as (2G - R - B) - (1.3R - G) - a different coefficient. Always check which ExGR a paper used (step.esa.int ExGR algorithm spec, snippet).

### Reported accuracy

- **Meyer & Neto 2008** (Nebraska, USA; greenhouse soybean, sunflower, redroot pigweed, velvetleaf over bare soil, corn-stalk residue and wheat-straw residue, 1-3 weeks after emergence; plus field soybean images). Quality factor vs hand-segmented plants: ExGR 0.88 +/- 0.12; ExG+Otsu 0.53 +/- 0.39; NDI+Otsu 0.54 +/- 0.33 (greenhouse). Field soybean: ExGR and ExG+Otsu both about 0.88 +/- 0.07. ExGR "especially" better on fresh wheat-straw background, "generally 55% more accurate" than ExG+Otsu and NDI+Otsu. Evidence: Moderate (abstract via search; the full paper was not opened). Not maize, but corn-stalk residue background was one of the tests.
- **Camargo Neto, Meyer & Jones 2004** (ASAE paper 043060; same group): ExG-ExR beat ExG+Otsu on soil-residue backgrounds. Differences were significant for all species in week 1 on corn-stalk residue, and in all 3 weeks on wheat straw. Evidence: Moderate (abstract, embrapa record https://www.bdpa.cnptia.embrapa.br/consulta/marc?id=9026).
- **Sadeghi-Tehran et al. 2017**, "Multi-feature machine learning model for automatic segmentation of green fractional vegetation cover for high-throughput field phenotyping", Plant Methods 13:103, doi:10.1186/s13007-017-0253-8, https://pmc.ncbi.nlm.nih.gov/articles/PMC5696775/ (UK, wheat, ground-based field camera, whole season). Qseg mean (SD): ExG 0.617 (0.299); CIVE 0.65 (0.314); ACE 0.645 (0.327); ExGR 0.776 (0.169); K-means 0.77 (0.19); learned model 0.898 (0.07). **Stability over one day** (10:16, 12:44, 15:36, 17:03), coefficient of variation: CIVE 58%, ExG 56%, ACE 18%, K-means 5%, MFL 4%, ExGR 2%. Evidence: Strong (full text read). This is the best number we have for "ExGR is stable across illumination and CIVE/ExG are not". It is wheat, not maize.
- The same paper cites a prior fuzzy-clustering approach on ExR and ExG that "achieved only 69% accuracy to classify plants in bare soil" and "failed for plants in corn and wheat residues". Strong (quoted in full text; the original reference was not traced).
- **Guijarro et al. 2011**, "Automatic segmentation of relevant textures in agricultural images", Comput. Electron. Agric. 75(1):75-83, doi:10.1016/j.compag.2010.09.013 (Spain, cereal and **maize**, ground camera). It fuses four chromatic indices (COM), separates sky and soil by chromaticity, then fuzzy-clusters. **Maize accuracy numbers: not found** (only the abstract was reachable; the UCM repository refused connection).
- **Hamuda, Glavin & Jones 2016**, "A survey of image processing techniques for plant extraction and segmentation in the field", Comput. Electron. Agric. 125:184-199, doi:10.1016/j.compag.2016.04.024. A review of colour-index, threshold and learning-based segmentation, mostly from studies published 2008-2015. **Its per-index comparison table: not found** in this run (abstract only).
- **A controlled illumination test** (Springer, doi:10.1007/s40502-020-00562-0) gave correct classification of 93.03% for ExGR at threshold 0 and 86.03% for ExG at threshold 10. Best separation was at 89 +/- 8 lux; the authors suggest the indices "might perform better at low lighting". Colour patches, not a field. Weak (snippet).
- **Maize seedlings from UAV** (Chinese journal, doi:10.6046/zrzyyg.2021072): ExG with Otsu was the best of the indices tested; seedling count accuracy about 96.5%. Multispectral platform. Weak (snippet).
- **Maize, Nigeria, 6 ha RGB drone**: RGBVI depicted cover best; ExG and MGRVI were adequate. Qualitative. Weak (snippet; Mersin IGD 2021, https://publish.mersin.edu.tr/index.php/igd/article/view/535).
- **Peña et al. 2013**, "Weed mapping in early-season maize fields using object-based analysis of UAV images", PLoS ONE, https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3795646/ (Spain, maize at early post-emergence, six-band multispectral). Weed density estimated vs observed: r^2 = 0.89, RMSE 0.02. The 3-class weed cover map reached 86% overall accuracy. Crop vs weed was decided **by position relative to detected rows**, not by colour. Moderate (abstract).

### Sensitivity to illumination, white balance, JPEG

- ExG-based segmentation "often provides poor segmentation results especially when the image scene contains an extreme illumination difference caused by dark shadows" (WUR, "Shadow resistant segmentation based on illumination invariant image transformation", https://research.wur.nl/en/publications/shadow-resistant-segmentation-based-on-illumination-invariant-ima/). Weak (snippet).
- Shadow removal before segmentation improved precision by 20%, specificity by 4.4% and modified accuracy by 13.5% on average. HDR cameras do not solve shadows (Precision Agriculture 2018, doi:10.1007/s11119-017-9511-z). Moderate (snippet of the abstract).
- Sadeghi-Tehran 2017: "detection of specular reflective regions is hardly achievable using classical segmentation based on colour properties"; colour temperature changes through the day hurt index methods. Strong.
- **White balance (ours)**: on chromaticity with b = 1 - r - g, ExGR = 4g - 1.4r - 1. A shift of +0.02 in g chromaticity (holding r) raises ExGR by +0.08, the whole margin between our cover cut (-0.08) and our vegetation cut (0). A neutral grey or white surface (r = g = b = 1/3) sits at ExGR = -0.133, so bright straw or a pale tassel needs only a small green cast to cross -0.08. Auto white balance that changes frame to frame will therefore move the soil and straw clusters. Fixed WB is the protective setting. Ours (arithmetic), not measured.
- **JPEG**: no study found that quantifies the effect of JPEG compression on ExG or ExGR segmentation. Not found. Known mechanism (general imaging knowledge, not sourced here): 4:2:0 chroma subsampling halves chroma resolution, so thin leaves at 1-2 px width lose colour first and edges get colour bleed.

---

## 2. Corn leaf colour variants

| Variant | When | Appearance from above | Source |
|---|---|---|---|
| Cold or P purpling | V2-V5; the genes act only before about V6 | purple/red leaves and sheaths, patchy within a field, hybrid-dependent. Trigger: nights < 50 F (10 C) with days > 60 F (15 C). Fades after a few sunny days > 70 F. If it persists, check P. | Corteva/Pioneer purple corn page; OSU C.O.R.N. 2015-14 and 2018-16; K-State eUpdate 2020-05-29 (https://eupdate.agronomy.ksu.edu/eupdates/eUpdate052920.pdf). Weak (extension, snippet-level) |
| Early yellowing (cool, wet, slow emergence) | VE-V5 | yellow-green whorls. "Little or no effect on later crop performance" | OSU C.O.R.N. 2015-14, https://agcrops.osu.edu/newsletter/corn-newsletter/2015-14/purple-and-yellow-corn-what-going. Weak |
| N deficiency | mostly V6 onward; early shortage gives stunted pale-green plants | yellowing of lower, older leaves first, from the tip inward along the midrib (an inverted V), then climbing the plant; severe = whole leaf brown. K deficiency yellows the margins instead. Drought can mimic N symptoms | Nebraska CropWatch, https://cropwatch.unl.edu/nitrogen-corn-n-stress-how-detect; Manitoba Agriculture, https://gov.mb.ca/agriculture/crops/seasonal-reports/pubs/yellowing-lower-corn-leaves.pdf; Farm Progress. Weak (extension, snippet) |
| Drought leaf rolling | any vegetative stage under stress, typically afternoons | leaves roll, so more soil is visible and canopy cover drops. Thermal study: curling changes the sunlit soil fraction (hypothesis) | Zhang et al. 2019, Front. Plant Sci., doi:10.3389/fpls.2019.01270. Moderate (snippet). **Magnitude of the cover drop: not found** |
| Tassels | VT-R1 | tassels "significantly reduce canopy reflectance in the green wavelength range", and their contribution to each VI changes with tassel stage | Precision Agriculture 2021, doi:10.1007/s11119-021-09842-7. Moderate (snippet). **Size of the green-cover drop at VT: not found** |
| Senescence | R5-R6 | yellow, then brown/dry leaves, lower leaves first | Makanza et al. 2018, "High-throughput phenotyping of canopy cover and senescence in maize field trials using aerial digital canopy imaging", Remote Sens. 10(2):330, https://pmc.ncbi.nlm.nih.gov/articles/PMC7745117/ (Zimbabwe, CIMMYT Harare; 80 m AGL, 1.51 cm/px; flights 42/75/96 DAS). Classes: soil / green / yellow / dry canopy (supervised ML, no index). Senescence index vs visual score: r = 0.64 (trial 1); not significant (trial 2). Strong (full text) |
| Specular glint, wet leaves | sunny, near the hotspot geometry, or after rain/dew | white to grey highlights that colour indices cannot classify | Sadeghi-Tehran 2017 (Strong, quote); no corn-specific measurement found |
| Soil-coated leaves after heavy rain (clay) | any stage, after rain | red soil reflectance "masks the green", so greenness methods fail; the authors switch to SVM | Guerrero et al. 2012, "Support Vector Machines for crop/weeds identification in maize fields", Expert Syst. Appl. 39(12):11149-11155, doi:10.1016/j.eswa.2012.03.040 (Spain). Moderate (abstract) |

**Illustrative ExGR values for these colours** (ours; hypothetical chromaticities, not measured, to show the direction of each effect):
- Chlorotic yellow leaf (r .38, g .42, b .20): ExGR = +0.15. It **passes** vegetation, because yellow is low in blue.
- Pale tassel (r .38, g .37, b .25): -0.05. It fails vegetation but passes the cover mask.
- Brown dry leaf (r .45, g .38, b .17): -0.11. It fails both.
- Purple seedling (r .36, g .34, b .30): -0.14. It fails both, so it reads as soil-like.

Consequence: purple V2-V5 corn and senescent corn can drop out of the mask, while yellow N-deficient corn mostly stays in. These are illustrative only and must be checked on our own frames.

---

## 3. Soil and residue backgrounds

- **Wet vs dry soil**: wetting lowers reflectance at all wavelengths, and the response is "quite similar within the visible and NIR up to about 1.3 um", so band ratios change little (ASPRS PE&RS 1986, https://asprs.org/wp-content/uploads/pers/1986journal/oct/1986_oct_1661-1668.pdf). Moderate (snippet). Implication for us: wet soil is darker but its chromaticity barely shifts, so ExGR on chromaticity is roughly invariant to wetting. However, in dark wet soil sensor noise and JPEG make up a larger share of the signal, so chromaticity is noisier. That last point is ours, by inference. Over-saturated soil can reflect **more** than saturated soil through specular reflection (FAO record, snippet). **A percent visible darkening: not found.**
- **Residue**: corn stalk and wheat straw backgrounds were where ExG+Otsu failed and ExGR held (Meyer & Neto 2008; Camargo Neto 2004; above). The fuzzy ExR/ExG method "failed for plants in corn and wheat residues" (Sadeghi-Tehran 2017). After harvest (bare soil + dry residue), RGB indices correlated with NDVI at r < 0.15, and VARI showed almost no variation (Comino et al. 2025, Univ. Granada, https://digibug.ugr.es/handle/10481/109296). Weak (snippet).
- Our measured straw at about -0.14 is close to the neutral-grey value of -0.133 (ours). Straw is effectively a bright near-neutral surface: safe at a cut of 0, about 0.06 from the -0.08 cover cut.
- **Soybean stubble** and **corn stover** specific ExGR values: **not found**.
- **Algae/moss on wet soil**, **standing water**: no study measuring their effect on RGB indices was found. By mechanism (ours): algae and moss are green (positive ExGR), so they are true false positives that colour cannot reject. Standing water reflects the sky (blue: negative ExGR) or shows glint.

---

## 4. Illumination and shadows

- **Shadow geometry** (ours): shadow length L = h / tan(solar elevation).

  | Plant | Sun elevation 30 deg | 45 deg | 60 deg |
  |---|---|---|---|
  | V4 corn, 0.2 m | 0.35 m | 0.20 m | 0.12 m |
  | V10 corn, 1.0 m | 1.73 m | 1.00 m | 0.58 m |
  | Tasselled corn, 2.5 m | 4.33 m | 2.50 m | 1.44 m |

  At 0.76 m (30 in) rows, the shadow of V10+ corn spans the inter-row whenever the sun is below about 53 deg (ours: atan(1.0/0.76)) and the sun azimuth crosses the rows.
- Effect on indices: shadowed soil is dark and its chromaticity is dominated by blue skylight and noise. Shadowed leaves keep a positive ExG but with low brightness. Shadow removal improved segmentation (+20% precision; Precision Agric. 2018, above). Without shadow correction, fractional vegetation cover was underestimated by up to 0.2 at peak growth, at 10 m scale (Song et al. 2015, "Extracting the green fractional vegetation cover from digital images using a shadow-resistant algorithm (SHAR-LABFVC)", Remote Sens. 7(8):10425-10443, doi:10.3390/rs70810425; abstract via search). Their fix works in CIE L*a*b* plus HSI to brighten shaded areas, and it matched visual interpretation best when cover was high and shadows deep.
- **Overcast vs sunny protocol**: Makanza 2018 flew under "diffuse" light, either under cloud or very early morning, specifically to reduce shadows and canopy reflectance (Strong). BRDF effects "were less pronounced under overcast conditions" (snippet summary of a higher-latitude study, Weak). Within 2 h of solar noon was recommended at higher latitude (Weak, snippet).
- **BRDF / hotspot**: NDVI is lower in the hotspot region (preprints.org 202412.0017, snippet). A BRDF correction reduced band differences from up to 6.37% to <= 0.65% (snippet). Sun-glint/hotspot detection on UAV multispectral images (Ortega-Terol et al. 2017, https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5677353/), error about 10 px at 5 cm GSD (snippet). No RGB/ExG-specific hotspot magnitude was found.
- **Time of day**: ExGR CV 2% vs ExG 56% and CIVE 58% over four times of day (Sadeghi-Tehran 2017, Strong).
- **Exposure seams between frames**: no quantification found. By mechanism (ours): exposure changes scale R, G and B together, so chromaticity is invariant. **White-balance** changes are not invariant (see section 1).

---

## 5. Orthomosaic artefacts in corn

- **Repetitive rows**: "plants in one frame look very much like those in adjacent frames", which gives too few correct keypoint matches and degraded registration. **Wind and propeller downdraft** cause irregular plant motion between frames. Fields "are not strictly planar", which causes pinching and tilt (Aktar et al. 2020, "Robust mosaicking of maize fields from aerial imagery", https://pmc.ncbi.nlm.nih.gov/articles/PMC7507512/, Missouri, USA, Phantom 4). Strong (full text, qualitative). No failure rates for Pix4D or Metashape are reported.
- Row crops sometimes stitch "fine visually" but break once an index is applied (Pix4D community thread, https://community.pix4d.com/t/unsuccessful-stitching-on-row-crops/12437). Weak.
- WebODM has an outlier option for moving objects, used in a barley dataset (Dryad doi:10.5061/dryad.bk3j9kdhp). Weak (snippet).
- **Relief displacement of tall corn** (ours): horizontal offset of the canopy top relative to its base is about D * h / (H - h). For 2.5 m corn at 60 m AGL and 20 m from nadir, that is 0.87 m. Over a DTM-based (not DSM-based) ortho, tall corn leans out radially and fills the inter-row at frame edges. Seam lines then cut plants with different lean, which makes rows look doubled or broken. Not measured here.
- **Ghosting/blur in wind**: no quantified study on corn was found. Not found.
- **Colour balancing/blending**: no corn-specific study was found. Mechanism (ours): the blend changes per-frame WB and vignetting, which is a chromaticity shift that could move soil across -0.08 locally along seams.

---

## 6. Known crop-vs-weed failure conditions in corn RGB

- **In-row weeds**: position-based methods (Peña 2013) call everything on the row "crop". Weeds inside the row are therefore missed by design; the abstract gives no separate in-row figure. Moderate.
- **Resolution limit (sunflower analogue, not maize)**: Peña et al. 2015, "Quantifying efficacy and limits of UAV technology for weed seedling detection as affected by sensor resolution", Sensors 15(3):5609-5626, https://pmc.ncbi.nlm.nih.gov/articles/PMC4435221 (Córdoba, Spain; sunflower in 0.70 m rows; ExG + Otsu + row position). Visible camera, correct weed-infested frames: at 44 DAS (4 leaves) 71/43/29/19% at 1.52/2.28/3.04/3.81 cm/px; at 50 DAS 77/64/45/45%; at 57 DAS 68/68/50/27%. Errors were mostly false negatives, from weeds too small. At 100 m on date 1, 47% of errors were false positives from "spectral mixture between sunflowers and bare soil" at **row edges**. Strong (full text). The row-edge mixed pixel is a general RGB failure at coarse GSD.
- **Grass weeds spectrally like corn**: johnsongrass (Sorghum halepense) and maize are both Poaceae with "analogous spectral patterns and parallel phenology", which makes early detection difficult. Johnsongrass grows in compact patches. An OBIA procedure on visible and multispectral UAV orthomosaics (30, 60, 100 m; two maize fields, Spain) gave the best maps with the **multispectral camera at 30 m**, and estimated herbicide savings of 85-96% (CSIC, https://digital.csic.es/handle/10261/158031; Moderate, abstract via search). **Per-class RGB accuracy: not found.** This fits our patch-level goal: grass weeds in corn are found as patches by place and pattern, not by colour per plant.
- **Overlapping foliage / canopy closure**: the bimodal-histogram (Otsu) assumption fails when vegetation is sparse or the canopy nearly closed (Sadeghi-Tehran 2017, Strong). After about V10-V12 in 0.76 m rows, inter-row soil disappears from above. That is general agronomy; see growth-and-morphology.md.
- **Dense infestations hiding rows**: not quantified in sources found. By mechanism: row-position methods lose the lattice. Our planting-layout lattice from 3 clicks is the mitigation.
- **Volunteer corn**: same species, so colour and shape are identical. It is detectable only by position (off-row, or clumps from dropped ears). **UAV volunteer-corn study: not found.** The nearest analogue is volunteer **cotton** in corn, found with YOLOv3 on RGB UAS imagery: mAP 90.6%, F1 86.35% at early corn growth. With YOLOv5 the best result was at V6 (mAP 96.3%) and weaker at VT, because the plants hide under the canopy (Yadav et al. 2022, Texas, arXiv:2207.06673; Weak, snippet). Even a different species needed a learned detector, not colour.
- **Lodging**: no RGB-segmentation study was opened. Mechanism: stalks lie across the inter-row and the row lattice breaks.
- **Soil-coated crop after rain**: Guerrero 2012 (above). Greenness methods fail on these plants and they look like soil.

---

## Failure conditions registry

| id | condition | effect on segmentation / rows / weeds | detectable from the image itself? | source |
|---|---|---|---|---|
| F1 | Hard shadows (sunny, low sun, V10+) | shadowed soil and leaves are misclassified; FVC underestimated (up to 0.2); shadows read as darker rows; ExG worst | yes: bimodal brightness (V or L channel) with shadow azimuth consistent across the frame; flight time + sun elevation from EXIF/GPS | WUR shadow paper (snippet); Precis. Agric. 2018 doi:10.1007/s11119-017-9511-z; Song 2015 doi:10.3390/rs70810425 (abstract) |
| F2 | Specular glint / hotspot / wet leaves | white/grey highlights fall out of the mask; leaves get holes | partly: near-saturated, low-chroma pixels; the hotspot sits at the anti-solar point | Sadeghi-Tehran 2017 (Strong); PMC5677353 (snippet) |
| F3 | White-balance drift (auto WB, colour balancing in ortho) | soil/straw cluster moves; +0.02 in g = +0.08 ExGR, so soil or straw crosses the -0.08 cover cut | yes: soil-cluster ExGR per frame/tile vs the field median (expect about -0.24) | ours |
| F4 | Bright residue (wheat straw, corn stover) | ExG+Otsu false positives; ExGR at 0 holds; straw about -0.14 sits near the -0.08 cover cut | yes: a near-neutral, bright, elongated texture; its ExGR mode sits around -0.13 | Meyer & Neto 2008; Camargo Neto 2004; Sadeghi-Tehran 2017; our measurement |
| F5 | Wet / dark soil | darker but chromaticity roughly unchanged; noisier chroma; over-saturated soil can be specular | partly: low brightness of the soil mode; glint on puddles | ASPRS 1986 (snippet) |
| F6 | Soil-coated crop after heavy rain (clay) | crop loses greenness and reads as soil; gaps in rows that are not skips | partly: row lattice gaps aligned with brown blobs of plant shape | Guerrero 2012 (abstract) |
| F7 | Cold/P purpling V2-V5 | purple seedlings can fall below ExGR 0 (illustrative -0.14), giving false skips and an undercounted stand | partly: reddish/purple blobs at lattice positions; season + stage | Pioneer, OSU, K-State (extension) |
| F8 | Yellow seedlings / N deficiency | usually still above ExGR 0 (illustrative +0.15); lower greenness may reduce Otsu splits | partly: yellow hue at lattice positions | OSU (extension); ours |
| F9 | Drought leaf rolling | lower cover, more soil; leaf width halves, so thin leaves at coarse GSD are lost | partly: narrow leaves, afternoon flight, field-wide cover drop vs prior scan | Zhang 2019 (snippet, hypothesis) |
| F10 | Tassels VT-R1 | pale tassels fall below 0 but sit inside the cover mask (illustrative -0.05); green band reduced | yes: bright pale-yellow small blobs at the canopy top; date/stage | Precis. Agric. 2021 doi:10.1007/s11119-021-09842-7 (snippet) |
| F11 | Senescence R5-R6 | yellow and brown canopy leaves the green mask; the cover mask makes it look like soil/straw | yes: yellow/brown classes (Makanza 2018 did it with supervised ML) | Makanza 2018 (Strong) |
| F12 | Canopy closure (about V10+ at 0.76 m rows) | no soil gap; Otsu bimodality fails; rows invisible in the mask; weeds under canopy invisible | yes: vegetation fraction near 1 per tile; unimodal histogram | Sadeghi-Tehran 2017 |
| F13 | Repetitive-row stitching failure | misregistration, duplicated or kinked rows, seams | partly: row continuity breaks at seam lines; compare against kept originals | Aktar 2020 (Strong, qualitative); Pix4D forum |
| F14 | Wind / downdraft motion | ghosted or blurred leaves in the ortho, doubled plants | partly: local blur (Laplacian variance) or double edges in the ortho vs a sharp source frame | Aktar 2020 |
| F15 | Relief displacement of tall corn | canopy leans radially, up to about 0.9 m at 60 m AGL / 20 m off-nadir for 2.5 m corn (ours); fills the inter-row | partly: a lean direction varying across the frame; use the nadir-most source frame | ours (geometry) |
| F16 | In-row weeds | position rules call them crop, so they are missed | no (from colour); only by shape/size at fine GSD | Peña 2013 |
| F17 | Grass weeds vs corn (e.g. johnsongrass) | analogous spectra and phenology (Poaceae); not separable by RGB index per plant; it forms compact patches | no from colour; partly from patch pattern + position | CSIC johnsongrass-in-maize OBIA (abstract); our weed-v1 memory |
| F18 | Volunteer corn | identical to crop | partly: off-lattice position or clumps | not found (searched); analogue volunteer cotton in corn needed YOLO (arXiv:2207.06673, snippet) |
| F19 | Dense infestation hiding rows | lattice lost; weeds read as crop | partly: lattice fit residuals; patch-level cover above the expected crop cover | mechanism only |
| F20 | Lodging | stalks across the inter-row; lattice broken; cover looks like weeds | partly: oriented stalk texture across rows | not found (searched) |
| F21 | Algae/moss on wet soil | true green false positives | partly: flat, smooth, spatially diffuse green with no plant shape | not found (searched) |
| F23 | Mixed pixels at row edges at coarse GSD (>= about 3 cm/px) | crop-edge pixels read as weed, small weeds vanish (false negatives dominate) | partly: thin vegetation bands parallel to rows at the lattice edge | Peña 2015 (sunflower, Strong) |
| F22 | JPEG chroma subsampling | thin leaves lose colour at 1-2 px; colour bleeds at edges | yes: known from the file (4:2:0 in the JPEG header) | not found (no quantification) |

---

## Parameter table for the profile

| name | value / range | units | condition | source | evidence |
|---|---|---|---|---|---|
| exgr_veg_threshold | 0 | ExGR (chromaticity) | fixed; field and greenhouse | Meyer & Neto 2008 | Moderate |
| exgr_quality_factor | 0.88 +/- 0.12 (greenhouse); about 0.88 +/- 0.07 (field soybean) | quality factor 0-1 | soil + corn-stalk + wheat-straw backgrounds, weeks 1-3 | Meyer & Neto 2008 | Moderate |
| exg_otsu_quality_factor | 0.53 +/- 0.39 | quality factor | same | Meyer & Neto 2008 | Moderate |
| qseg_exgr / exg / cive | 0.776 / 0.617 / 0.65 | Qseg | wheat, UK, whole season | Sadeghi-Tehran 2017 | Strong |
| illumination_cv_exgr / exg / cive | 2 / 56 / 58 | % CV over the day | 4 times 10:16-17:03, wheat | Sadeghi-Tehran 2017 | Strong |
| exgr_classification_accuracy | 93.03 (thr 0) vs ExG 86.03 (thr 10) | % | colour patches, controlled light | doi:10.1007/s40502-020-00562-0 | Weak (snippet) |
| shadow_removal_gain | +20 precision, +4.4 specificity, +13.5 modified accuracy | % | field vegetation segmentation | doi:10.1007/s11119-017-9511-z | Moderate (snippet) |
| fvc_shadow_underestimate | up to 0.2 | FVC fraction | peak growth, 10 m scale | Song et al. 2015 doi:10.3390/rs70810425 | Moderate (abstract) |
| soil_exgr | about -0.24 | ExGR | our fields | our measurement | Ours |
| straw_exgr | about -0.14 | ExGR | our fields | our measurement | Ours |
| neutral_grey_exgr | -0.133 | ExGR | r = g = b | ours (arithmetic) | Ours |
| exgr_sensitivity_to_g | +4 per unit g (b compensating); -1.4 per unit r | dExGR/dchroma | any | ours (ExGR = 4g - 1.4r - 1) | Ours |
| cover_cut_margin | 0.08 = a 0.02 shift in g chromaticity | ExGR | WB drift | ours | Ours |
| purpling_window | V2-V5 (genes off by about V6) | leaf stage | nights < 10 C, days > 15 C | Pioneer; OSU; K-State | Weak (extension) |
| purpling_clears | after a few sunny days > 21 C (70 F) | days | | OSU C.O.R.N. 2015-14 | Weak |
| senescence_classes | soil / green / yellow / dry | classes | R5-R6, 1.51 cm/px, 80 m AGL | Makanza 2018 | Strong |
| senescence_index_validity | r = 0.64 (trial 1), not significant (trial 2) | Pearson r vs visual | Zimbabwe | Makanza 2018 | Strong |
| recommended_light | diffuse: overcast or very early morning | | to cut shadows and reflectance | Makanza 2018 | Strong (practice, not tested) |
| solar_window | within 2 h of solar noon | h | higher latitudes | snippet summary | Weak |
| shadow_length | h / tan(elevation): 2.5 m corn = 1.44 m at 60 deg, 4.33 m at 30 deg | m | | ours | Ours |
| relief_offset | D * h / (H - h): 0.87 m at H 60 m, D 20 m, h 2.5 m | m | DTM-based ortho | ours | Ours |
| weed_map_accuracy_row_position | 86 overall; r^2 0.89 density | %, r^2 | early-season maize, Spain, multispectral, OBIA | Peña 2013 | Moderate |
| rgb_weed_frame_accuracy_vs_gsd | 71 / 43 / 29 / 19 at 1.52 / 2.28 / 3.04 / 3.81 cm/px (4-leaf crop) | % correct frames | sunflower analogue, ExG+Otsu, 0.70 m rows | Peña 2015 | Strong (not maize) |
| johnsongrass_best_sensor | multispectral at 30 m; savings 85-96% | | maize, Spain | CSIC 10261/158031 | Moderate |
| rgb_vs_ndvi_bare_residue | r < 0.15 | Pearson r | post-harvest bare soil + residue | Comino 2025 (UGR) | Weak (snippet) |

---

## Gaps and uncertainties

1. **No maize-specific accuracy numbers for ExG/ExGR/CIVE/COM** were read in full. Guijarro 2011 and Hamuda 2016 were reachable only as abstracts. The best full-text comparison (Sadeghi-Tehran 2017) is wheat.
2. **Meyer & Neto 2008 numbers come from the abstract** via search; the full paper was not opened. Its field part is soybean, not corn.
3. **COM and CIVE coefficients differ between papers** (snippet). Check before reusing.
4. **Not found**: a percent visible darkening of wet soil; ExGR values for corn stover and soybean stubble; the size of the green-cover drop at VT; how much cover drops under drought leaf rolling; ghosting rates in wind; stitching failure rates on corn; JPEG effect on ExGR; quantified RGB separability of grass weeds vs corn; UAV volunteer-corn or lodging segmentation studies; algae/moss and standing-water effects.
5. **N-deficiency appearance** is from extension snippets only. From nadir, lower-leaf yellowing is partly hidden by upper leaves after about V8. That is ours, by geometry, not measured.
6. The **ExGR values for coloured leaves** in section 2 are illustrative arithmetic on assumed chromaticities. They must be measured on our own kept originals before any threshold change.
7. **Disagreement**: Sadeghi-Tehran finds ExGR far more stable than ExG (CV 2% vs 56%). The UAV maize seedling study (snippet) found ExG+Otsu the best index. These are different platforms, stages and metrics, so they are not reconciled.
8. Our app's ExG + 0.5*CIVE with per-tile Otsu combines the two indices with the **highest** day-time CV in Sadeghi-Tehran 2017 (56%, 58%). Otsu per tile partly compensates, because it re-fits each tile, but it fails on unimodal tiles (closed canopy, all-soil). This is a reading of the literature, not a measurement on our data.
