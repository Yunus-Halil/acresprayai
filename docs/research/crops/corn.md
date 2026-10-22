# Corn (US): what grading weeds from the air has to work with

Research of 2026-10-22, US only. Corn is the friendliest of the four crops for us: wide rows, plants that are visible
from the early V stages, an open alley until about V10, and a well-studied critical period. It is also the crop where US
guidance most clearly decides by weed height and crop stage rather than by cover. Figures marked "(snippet)" were seen in
a search result or abstract and not read in the full source. Our own estimates and arithmetic are labelled.

## A. The planting, as it appears from the air

**Row spacing.** Thirty-inch (76 cm) rows dominate. A Pioneer survey put about 86% of US and Canadian corn acres in 30 in
rows in 2015, up from about 80% in 2007, with 36 to 38 in rows at 7% and rows under 30 in about 6%
([Pioneer, Row Width in Corn Grain Production](https://www.pioneer.com/us/agronomy/row-width-grain-corn.html), vendor
survey). In 2012 the narrow-row split was 20 in 3.0%, 22 in 2.6% and 15 in 0.7% ([Pioneer 2014 summary](https://www.pioneer.com/CMRoot/Pioneer/Canada_en/agronomy/agronomy_research_summaries/pdfs/2014_Row_Width_In_Corn_Grain_Production.pdf), snippet).
A 2011 USDA farmer survey gave Nebraska an average of 31.3 in, with 1.7% of acres at 20.5 in or narrower
([UNL NebGuide G2216](https://extensionpubs.unl.edu/publication/g2216/2013/html/view)). No current national USDA
row-width table for corn was found; NASS publishes one for soybean but not for corn (checked in the
[2025 Crop Production Summary](https://esmis.nal.usda.gov/sites/default/release-files/795725/cropan26.txt)). Iowa State
gives the Corn Belt range as 15 to 38 in, with 20 in beating 30 in by 8 to 10 bu/a only above about 235 bu/a
([Iowa State, Row Spacing for Corn](https://crops.extension.iastate.edu/encyclopedia/row-spacing-corn-0)). Twin rows are
under 1% of acres by the vendor figures. So in practice: assume 30 in, allow 20 and 22 in in the northern states, 36 to
38 in in the South, and 15 in as rare.

**Plants and population.** Nebraska's economic optimum is about 34,000 seeds/a irrigated and 26,000 rainfed (range 24,000
to 30,000), lower at low yield levels (G2216); Iowa State puts the yield-maximising rate at about 33,000 to 34,000
([ASA, CSSA, SSSA magazine, Licht 2024](https://www.sciencesocieties.org/publications/crops-soils/2024/may-june/seeding-back-to-the-basics)).
At 30 in rows that is 5.5 in (14 cm) between plants at 38,000 seeds/a, 6.1 in at 34,000, 8.0 in at 26,000 and 10.5 in
at 20,000 (our arithmetic). Arizona Extension gives plant height as 2 to 4 in at V2, 8 to 12 in at V5, about 24 in at V8
and over 4 ft at V12 ([Arizona Extension, corn growth stages](https://extension.arizona.edu/publication/corn-growth-and-development-stages)).

**Is a plant resolvable at 1 to 5 cm a pixel?** Every published corn stand-count study flew far finer than us, at 0.3 to
0.5 cm a pixel. In one, a 3 to 5 leaf plant covered 806 to 2,253 pixels at 0.25 to 0.35 cm a pixel, and counting error
rose from 0.08 at native 0.3 cm to 0.48 on real 0.6 cm imagery, mostly from image quality
([Velumani et al. 2021, Plant Phenomics](https://pmc.ncbi.nlm.nih.gov/articles/PMC8404552)). Scaling those plant sizes
(our estimate): a 3 to 5 leaf plant is roughly 70 to 200 pixels at 1 cm, 18 to 50 at 2 cm, 8 to 23 at 3 cm and 3 to 8
at 5 cm. By the four-pixel rule for the smallest detectable object ([Peña et al. 2015, Sensors](https://pmc.ncbi.nlm.nih.gov/articles/PMC4435221/)),
a plant is resolvable at 1 to 3 cm from about V3 and marginal at 5 cm. Plants 14 to 20 cm apart along the row merge into
a line at 3 to 5 cm (our estimate). Our earlier survey put the visibility window for separate corn plants at V2 to V3
([row-crop-detection-methods.md](../row-crop-detection-methods.md)).

**Canopy closure.** Thirty-inch corn closes the alley at about V10 to V11, "waist-high" ([Nafziger, University of
Illinois](https://www.thecattlesite.com/articles/4671/the-importance-of-sunlight), secondary host) and "about 11 fully
developed leaves" ([UNL CropWatch, critical period of weed control in corn](https://cropwatch.unl.edu/critical-period-weed-control-corn)).
At V10, light interception in an Illinois trial was 70% in 30 in rows, 80% in twin rows and 83% in 15 in rows, all
about 99% by R2 (Nafziger 2006, via the Pioneer page). Nebraska found narrow rows intercepted only 2 to 4% more light at
V9 and none at other stages (G2216). Arizona Extension puts V9 to V11 at 6 to 8 weeks after emergence (Arizona Extension),
so the alley is open for roughly the first 6 to 8 weeks (our reading). After that, cover "between the rows" is not
measurable from above and our grade has nothing to divide by.

**Field geometry.** Headlands, end rows, point rows, contour and terrace planting, pivot circles, planter pass widths
(12, 16, 24 rows) and the "guess row" between planter passes were not covered by any source found in this session. They
are the ordinary features of a Corn Belt field and will confuse a row reader at field edges; see
[row-reading-approaches.md](row-reading-approaches.md).

## B. Growth stages, and what each looks like from above

**Staging.** V stages count leaf collars; R stages run from silking (R1) to maturity (R6). Purdue gives about 120 growing
degree days (F) from planting to emergence, then one collar per 82 GDD to V10 and one per 50 GDD after
([Purdue, Nielsen, V-stage prediction](https://agry.purdue.edu/ext/corn/news/timeless/vstageprediction.html)); Iowa
State's figures are 84 and 56 ([Ohio State, predicting leaf development](https://agcrops.osu.edu/newsletter/corn-newsletter/predicting-leaf-development-corn-using-accumulated-heat-units)).
Measured in Indiana, a 3 May planting reached V3 at 24 days and V9 at 49, while a 17 April planting took 46 to 50 days
to reach V6 ([Purdue Pest&Crop 2006](https://extension.entm.purdue.edu/pestcrop/2006/issue3/tables/table1.html)).
Calendar days are a poor guide; heat units are a good one.

**Ground cover by stage.** No study giving canopy cover by V stage from imagery was found. The light-interception
figures above (about 70% at V10 in 30 in rows) are the nearest thing.

**Critical period of weed control.** Nebraska work (Evans et al. 2003) ties it to nitrogen. At a 5% yield-loss basis:

| Nitrogen (lb/a) | Critical period, leaf stage | Days after crop emergence |
|---|---|---|
| 0 | V1 to V11 | 8 to 45 |
| 55 | V3 to V10 | 10 to 42 |
| 110 | V4 to V9 | 15 to 39 |
| 210 | V6 to V9 | 20 to 39 |

Source: [UNL CropWatch, critical period of weed control in corn](https://cropwatch.unl.edu/critical-period-weed-control-corn);
paper: [Evans et al. 2003, Weed Science](https://resolve-he.cambridge.org/core/journals/weed-science/article/nitrogen-application-influences-the-critical-period-for-weed-control-in-corn/C6F6A880D19B946F58E7814D68EA340E).
Each leaf stage of delay costs about 2% of yield up to canopy closure (UNL). For waterhemp alone in Illinois, keeping the
crop clean through about V6 was enough, and waterhemp emerging after V8 did not reduce yield
([Steckel and Sprague 2004, Weed Science](https://bioone.org/journals/Weed-Science/volume-52/issue-3/WS-03-066R1/Common-waterhemp-Amaranthus-rudis-interference-in-corn/10.1614/WS-03-066R1.full)).
A South Carolina comparison found no difference in the critical period between 48 and 97 cm rows
([Norsworthy and Oliveira 2004, Weed Science](https://www.cambridge.org/core/journals/weed-science/article/comparison-of-the-critical-period-for-weed-control-in-wide-and-narrowrow-corn/1DD789FE43DB670FD482E1D7BFB47040)).
The often-quoted Hall et al. 1992 result (start between the 3 and 14 leaf stage, end on average at 14 leaves) is from
Ontario, not the US ([Hall et al. 1992](https://www.cambridge.org/core/journals/weed-science/article/abs/critical-period-of-weed-control-in-grain-corn-zea-mays/C0EF283B9B4A239ECBB4B6F0682DD9F3)).

The practical reading: in corn, weeds present between about V2 and V10 cost yield; after the canopy closes, new weeds
matter for seed, not yield.

**Stage from the imagery.** No validated method infers corn V stage from cover or row closure. Plant height from
drone photogrammetry is measurable but noisy: in a Phantom 4 RTK study at 25 m, R² 0.77 to 0.79 and MAE 3.6 to 3.9 cm in
the vegetative stage, with a systematic underestimate of 7 to 9 cm that needed calibration
([Fujiwara et al. 2022, Frontiers in Plant Science](https://pmc.ncbi.nlm.nih.gov/articles/PMC9263916/)); a fixed-wing
study got only R² 0.57 to 0.65 against lidar ([Ziliani et al. 2018, Remote Sensing](https://www.mdpi.com/2072-4292/10/12/2007)).
An error of 4 to 17 cm is the height of a V2 to V4 plant, so height cannot stage seedling corn. Planting date plus
growing degree days is the defensible route, with the imagery as a check (see [estimating-from-upload.md](estimating-from-upload.md)).

## C. Action thresholds that practitioners actually use

**US corn guidance is in weed height and crop stage, not cover.** Iowa State's summary of 37 experiments:

| Weed height at removal | Mean corn yield loss | Range |
|---|---|---|
| 2 in | 0% | 0 to 3% |
| 4 in | 2% | 0 to 7% |
| 6 in | 6% | 0 to 13% |
| 9 in | 8% | 0 to 18% |
| 12 in | 22% | 7 to 35% |

Source: [Iowa State, early-season weed competition](https://crops.extension.iastate.edu/encyclopedia/early-season-weed-competition),
advising control before weeds reach 4 to 5 in; the trials were glyphosate research of 1998 and 1999. Across 35
north-central sites, a single glyphosate pass at 5, 10, 15, 23 and 30 cm weed height gave 93, 94, 93, 91 and 79% of
weed-free yield; the recommendation was a first application before weeds reach 10 cm, within 23 days of planting and no
later than V4 ([Gower et al. 2003, Weed Technology](https://complete.bioone.org/journals/weed-technology/volume-17/issue-4/P02-200/Effect-of-Postemergence-Glyphosate-Application-Timing-on-Weed-Control-and/10.1614/P02-200.short)).
Herbicide labels set the same currency: Group 14, glufosinate and dicamba on waterhemp no taller than 3 to 4 in
([Take Action waterhemp factsheet 2026](https://growiwm.org/wp-content/uploads/2026/07/Take-Action_Waterhemp-Factsheet-Updated-2026.pdf.pdf));
giant ragweed before 6 to 10 in ([GWC-12, Biology and Management of Giant Ragweed](https://extension.missouri.edu/media/wysiwyg/Extensiondata/Pub/pdf/miscpubs/mx1140.pdf)).

**Density thresholds exist but do not transfer.** Foxtail: 3 to 4 plants per metre of row as a conservative single-year
threshold ([Lindquist et al. 1999, Weed Science](https://openprairie.sdstate.edu/plant_faculty_pubs/230)). Velvetleaf:
yield-loss coefficients differ between locations so much that "results do not support common coefficient estimates"
([Lindquist et al. 1996](https://openprairie.sdstate.edu/plant_faculty_pubs/242)). Palmer amaranth emerging with irrigated
Kansas corn at 0.5 to 8 plants per metre of row cut yield 11 to 91% ([Massinga et al. 2001, Weed Science](https://agris.fao.org/search/fr/records/65df22a14c5aef494fe03231),
a companion paper says 11 to 74%). Giant ragweed: two plants per 110 ft² cut yield 13% (GWC-12). The SDSU
competitiveness groups already in [weed-pressure-grading-2026-10-21.md](../weed-pressure-grading-2026-10-21.md) are of
this kind too. No US cover-percentage threshold for corn was found.

**Expressing these alongside cover (our suggestion, for the design session).** Three flags fit what US growers act on
better than a cover class: a window flag from crop stage (planting date plus heat units), saying "act now" from about V2
to V4 and "the alleys are closed, the grade is no longer observable" from about V10 in 30 in rows; a size flag on any
weed object larger than a 4 in plant would be (the height-to-canopy conversion is not sourced and would need our own
calibration); and an object count per metre of row as an indicator, read against the most conservative published
densities, never presented as an economic threshold.

**Programme context.** Herbicide is used on nearly all corn: in Wisconsin in 2021 on 95% of corn acres, atrazine on 64%
([NASS Wisconsin](https://data-origin.nass.usda.gov/Statistics_by_State/Wisconsin/Publications/Miscellaneous/2022/WI-Ag-Chem-Corn-2022.pdf), snippet).
Take Action recommends full-rate pre-emergence residuals with two or more effective modes of action, then a post pass
with an overlapping residual (Take Action 2026). No figure for the share of acres on a pre-then-post programme, or for
how many weeks corn residuals last, was found. How sprayed weeds look: glufosinate yellows the whole plant in 4 to 5
days, HPPD products (mesotrione) bleach leaves white, PPO and atrazine burn existing leaves, glyphosate yellows new growth
then kills depending on rate ([University of Wisconsin mode-of-action key](https://corn.aae.wisc.edu/Management/pdfs/L022_HerbicideMOASymptoms.pdf)).
A field flown within a few days of spraying will still show green weeds, and bleached weeds may drop out of a green mask.

**What our code uses today, and what US guidance gives instead.** `schemeFor` in `grade.ts` grades corn (and every
wide-row crop) with an action point of 10% cover from the Turkish ministry's maize guidance (TAGEM 2022) and a high class
at Peña's 20%. No US source gives a cover threshold for corn. US guidance acts on weed height (before 4 in, about 10 cm),
crop stage (before V4 for the first pass, through about V10) and, for the worst species, any presence. The 10% figure
needs replacing; the design session has to decide whether corn keeps a cover class at all or leads with the stage window
and size flags above.

## D. The weeds themselves

**Dominant weeds.** No regional dominance survey was retrieved in this session. The weeds that the sources above keep
returning to for corn are waterhemp and giant ragweed in the Corn Belt, Palmer amaranth in the Plains and South, and
foxtails, velvetleaf, lambsquarters and common ragweed as the common background.

**Resistance.** Waterhemp: eight herbicide groups documented (2, 4, 5, 9, 10, 14, 15, 27), one population resistant to
six (Take Action 2026); four-way resistance in Nebraska ([Weed Science 2019](https://bioone.org/journals/weed-science/volume-67/issue-5/wsc.2019.29/Protoporphyrinogen-Oxidase-PPO-InhibitorResistant-Waterhemp-Amaranthus-tuberculatus-from-Nebraska-is/10.1017/wsc.2019.29.full)).
Palmer amaranth: resistance across groups 2, 3, 4, 5, 9, 10, 14, 15 and 27 in Arkansas ([UA FSA2188](https://www.uaex.uada.edu/publications/pdf/FSA2188.pdf)).
Giant ragweed: ALS resistance since 1996, low-level glyphosate resistance in Indiana and Ohio (GWC-12). Status for
kochia, marestail, lambsquarters and foxtails in corn was not retrieved.

**What RGB at our resolution can and cannot see.** Every multi-species weed classifier found in maize worked at 0.3 to
0.5 cm a pixel ([USU-Corn-WeedDB, 0.48 cm](https://arxiv.org/abs/2606.06709); [Precision Agriculture 2025, 11 m flight](https://link.springer.com/article/10.1007/s11119-025-10309-2)).
None separates species at 1 cm a pixel or coarser. What does work at our resolution is position: in early maize at 2 cm a
pixel, Peña et al. separated weeds from crop by where they stood relative to the rows, not by colour, because crop and
weed spectra are "highly similar" early in the season, and got weed cover R² 0.89 and a three-class map at 86% overall
accuracy ([Peña et al. 2013, PLoS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0077151)); a
North Dakota system removed detected corn rows, called everything else weed, and cut herbicide use 26%
([review citing Sapkota et al. 2023](https://arxiv.org/pdf/2507.01269)). The extension identification cues (giant ragweed
lobes, Palmer amaranth's long petioles) are centimetre-scale and fall to one or two pixels at our resolution. Plainly:
RGB at 1 to 5 cm a pixel cannot name the weed in corn, cannot tell a weed inside the row from the corn, and can measure
weed cover between the rows until the canopy closes.

**Escapes.** Giant ragweed is the corn escape: up to 17 ft tall, often 1 to 5 ft above the crop, found escaped in 29% of
more than 1,300 Indiana fields (GWC-12). Waterhemp mostly does not overtop corn: in Iowa State work the cohort emerging
with the crop averaged about 140 cm under a 2.5 m canopy, "very few plants grew above the corn canopy", and plants
emerging at V8 produced no seed ([Iowa State, influence of corn on waterhemp growth](https://crops.extension.iastate.edu/encyclopedia/influence-corn-waterhemp-growth)).
Palmer amaranth above a corn canopy was not documented in what was found. So a late corn flight sees giant ragweed
escapes and not much else.

## E. What the imagery must be

| Task | Pixel size | Basis |
|---|---|---|
| Find 30 in rows | 5 cm or finer; rows found 100% at 1.5 to 3.8 cm in sunflower | [Peña et al. 2014](https://polipapers.upv.es/index.php/raet/article/view/3148), snippet |
| Cover between rows | 2 to 3 cm, until about V10 | our estimate from the alley width (76 cm is 25 px at 3 cm) |
| Detect a 10 cm weed (the action size) | about 1 to 2.5 cm | four-pixel rule, Peña 2015 |
| Weed vs corn | by position at 2 cm; not by appearance at 1 to 5 cm | Peña 2013; species work at 0.3 to 0.5 cm |

On a Phantom 4 RTK, pixel size is the height divided by 36.5 (cm a pixel, height in m) ([DJI Phantom 4 RTK](https://www.dji.com/phantom-4-rtk/info));
the Mavic 3 Enterprise and Mavic 3M RGB cameras work out about the same (our arithmetic from [DJI specifications](https://enterprise.dji.com/mavic-3-enterprise/specs)).
So 1 cm needs about 37 m, 2 cm 73 m and 3 cm 110 m. The FAA ceiling is 400 ft, about 122 m
([14 CFR 107.51](https://www.law.cornell.edu/cfr/text/14/107.51)), so about 3.3 cm is the coarsest legal RGB from these
cameras and 5 cm needs a waiver. In sunflower, RGB weed detection fell from 71 to 77% at 40 m (1.5 cm) to 19 to 45% at
100 m (3.8 cm), and crop-row edges were misread as weeds at height, up to 47% false positives (Peña 2015).

**Multispectral and height.** In Peña's sunflower work colour-infrared beat RGB by 5 to 18 percentage points, and in
Spanish maize multispectral at 30 m gave the best weed maps ([CSIC](https://digital.csic.es/handle/10261/158031), snippet).
Against that, a North Dakota soybean study found RGB 93.8% and multispectral 93.4% for crop, broadleaf and grass
(via the [2025 review](https://arxiv.org/pdf/2507.01269)). Height from a DSM helps only for tall late escapes such as giant
ragweed: its 4 to 17 cm error is the size of the seedling weeds that matter. No maize study quantifying sun angle,
shadow or wind effects on weed mapping was found.
