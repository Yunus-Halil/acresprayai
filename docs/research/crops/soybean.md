# Soybean (US): what grading weeds from the air has to work with

Research of 2026-10-22, US only. Soybean is the crop where row width varies most, from drilled 7.5 in to 30 in and wider
beds, and row width sets almost everything we care about: whether rows are readable, when the alley closes, and when the
critical period starts. The weeds are broadleaf like the crop, so position, not appearance, is what separates them at
our resolution. Figures marked "(snippet)" were seen in a search result or abstract and not read in the full source.
Our own estimates and arithmetic are labelled.

## A. The planting, as it appears from the air

**Row spacing.** Unlike corn, soybean has an official measured row-width table. USDA NASS objective-yield samples for
2025, as the share of sampled fields by measured row width (10 in or less including drilled and broadcast / 10.1 to 18.5
in, the 15 in class / 18.6 to 28.5 in / 28.6 to 34.5 in, the 30 in class / 34.6 in or more) and the average:

| State | ≤10 in | 15 in class | 20 to 22 in | 30 in class | ≥34.6 in | Average |
|---|---|---|---|---|---|---|
| Arkansas | 6.5 | 9.6 | 1.2 | 28.5 | 54.2 | 31.6 in |
| Illinois | 4.6 | 52.0 | 12.1 | 31.3 | 0 | 20.3 in |
| Indiana | 3.4 | 76.0 | 10.3 | 10.3 | 0 | 17.2 in |
| Iowa | 3.6 | 30.4 | 15.4 | 50.6 | 0 | 23.5 in |
| Kansas | 11.6 | 37.5 | 9.8 | 41.1 | 0 | 21.0 in |
| Minnesota | 6.9 | 16.7 | 30.6 | 44.4 | 1.4 | 23.9 in |
| Missouri | 2.2 | 63.3 | 11.7 | 15.0 | 7.8 | 19.9 in |
| Nebraska | 2.7 | 38.4 | 6.2 | 47.9 | 4.8 | 23.9 in |
| North Dakota | 14.0 | 45.6 | 27.5 | 12.9 | 0 | 17.6 in |
| Ohio | 19.8 | 66.0 | 5.6 | 8.6 | 0 | 15.2 in |
| South Dakota | 0 | 21.0 | 23.5 | 53.8 | 1.7 | 25.2 in |

Source: [USDA NASS, Crop Production 2025 Summary](https://esmis.nal.usda.gov/sites/default/release-files/795725/cropan26.txt)
(56 to 130 samples a state; 2021 to 2024 in the same table; checked against the file). The US average was about 20 in in
2012 and 2018 ([USDA ERS Chart of Note](https://www.ers.usda.gov/data-products/charts-of-note/109303)). The pattern is
clear: 15 in dominates in Indiana, Ohio, Missouri and Illinois; 30 in leads in Iowa, Nebraska and South Dakota; 20 to 22
in is common in Minnesota and North Dakota (sugar beet country); Arkansas is mostly on beds of 34.6 in or wider; and
Ohio and North Dakota have the largest drilled or broadcast shares, the latter with no rows at all.

About 5% of US soybean acres were double-cropped after another crop in 2022, about 4 million acres, down from about 10%
in 2013, with Virginia near 39% of its soybean acres and Oklahoma, Georgia and North Carolina over 30%
([American Soybean Association, 2022](https://soygrowers.com/news-releases/double-crop-soybeans-and-crop-insurance/));
most double-crop soybean follows winter wheat ([USDA ERS EIB-125](https://primary.ers.usda.gov/webdocs/publications/43862/46871_eib125.pdf)).
Those fields are planted into standing or cut wheat stubble. Conservation tillage was on 74% of soybean acres with
mulch-till at 35% in 2018 ([USDA ERS Chart of Note](https://ers.usda.gov/data-products/charts-of-note/105042)), and
no-till on about 40% in 2012 ([ERS EIB-197](https://ers.usda.gov/sites/default/files/_laserfiche/publications/90201/EIB-197.pdf), snippet).
So much soybean ground between the rows is residue, not bare soil.

**Plants and population.** Iowa State recommends a final stand of 100,000 uniformly spaced plants/a
([Iowa State, soybean seeding rates](https://crops.extension.iastate.edu/encyclopedia/soybean-seeding-rates-balance-between-cost-and-yield));
NDSU about 150,000 established plants/a, from about 180,000 seeds/a in eastern North Dakota
([NDSU A1172](https://www.ndsu.edu/agriculture/sites/default/files/2023-01/a1172.pdf)). At 140,000 seeds/a a seed lands
about every 3.8 cm in 30 in rows, 7.6 cm in 15 in rows and 15 cm in drilled 7.5 in rows (our arithmetic).

**Is a plant resolvable at 1 to 5 cm a pixel?** Not as an individual plant. The only US altitude study counted stands
best at 15.2 m, 14 to 20 days after planting (within 12% of ground truth, R² 0.81), and accuracy fell after about 27 days
as canopies overlapped ([Ermish et al. 2026, Agronomy Journal](https://www.synapsesocial.com/papers/6971bfdff17b5dc6da021f17),
summary). At that height a 20 MP one-inch camera gives about 0.4 cm a pixel (our arithmetic), so plant counting has only
been shown about 2.5 to 12 times finer than our range. The row is the readable unit: 76 cm is 15 to 76 pixels at 5 to 1
cm, 38 cm is 8 to 38 pixels, and a drilled 19 cm row is 4 to 19 pixels (our arithmetic).

**Canopy closure.** Row width decides it, and the sources disagree on how much:

- Iowa State: closure about 15 days earlier in 15 in rows than in 30 in rows ([Iowa State, consider 15 inch rows](https://crops.extension.iastate.edu/cropnews/2018/02/consider-15-inch-row-spacing-soybean)).
- An older Nebraska study: 30 in rows fully shaded the ground at 58 days after planting, 20 in rows 11 days earlier and
  10 in rows 22 days earlier ([UNL CropWatch 2024](https://cropwatch.unl.edu/2024/does-narrow-row-spacing-help-suppress-weeds-and-increase-yields-corn-and-soybean)).
- Wisconsin with Canopeo, 2019 and 2020: 15 in rows reached 90% green cover only 4 to 7 days before 30 in rows; a late-May
  planting reached it about 47 to 63 days after planting (our reading of the dates); no-till delayed it 1 to 5 days and a
  pre-emergence herbicide up to 4 ([UW-Madison, canopy closure](https://wiscweeds.info/images/Update%20Series%20Articles/WWRUS%20Article%208_Canopy%20Closure.pdf)).
- Canopeo cover averaged 75% at R1 and 89% at R3 in 30.5 and 61 cm rows ([Agronomy 2021](https://www.mdpi.com/2073-4395/11/3/605), snippet).

So the alley in 30 in soybean is open for roughly the first seven to nine weeks, and closes one to three weeks earlier
in 15 in rows. Drilled soybean closes earliest.

## B. Growth stages, and what each looks like from above

**Staging.** Fehr and Caviness V and R stages. Average intervals: planting to emergence 10 days (5 to 15), then about 5
days per stage from VE through V5 and about 3 days per node after; R1 to R2 3 days, R2 to R3 10, R3 to R4 9, R4 to R5 9,
R5 to R6 15 ([NDSU A1172](https://www.ndsu.edu/agriculture/sites/default/files/2023-01/a1172.pdf)). Emergence takes 10 to
18 days in North Dakota, the plant is about half its mature height at R2, and reaches maximum height, nodes and leaf area
about halfway through R5 ([NDSU quick guide](https://www.ndsu.edu/agriculture/extension/publications/soybean-growth-and-management-quick-guide)).
A stage counts when at least half the plants have reached it ([Iowa State, soybean growth stages](https://crops.extension.iastate.edu/encyclopedia/soybean-growth-stages)).

**Critical period of weed control.** Nebraska work (Knezevic et al. 2003) ties its start to row width, at a 5% loss basis:

| Row spacing | Start of weed control | Days after crop emergence |
|---|---|---|
| 7.5 in | V3 | 19 |
| 15 in | V2 | 15 |
| 30 in | V1 | 9 |

Each leaf stage of delay costs about 2% of yield, applicable up to R3; if weeds emerge four to five days before the crop,
start one to two leaves earlier ([UNL CropWatch, timing of post-emergence weed control in soybean](https://cropwatch.unl.edu/timing-post-emergence-weed-control-soybean);
paper: [Knezevic et al. 2003, Weed Technology](https://bioone.org/journals/Weed-Technology/volume-17/issue-4/WT02-49/Row-Spacing-Influences-the-Critical-Timing-for-Weed-Removal-in/10.1614/WT02-49.full)).
A pre-emergence residual moves the window: the critical time for removing Palmer amaranth in Nebraska soybean was 33 to
45 days after emergence with a residual and about ten days earlier without one, and Palmer biomass was three to five
times higher without it ([CSA News 2022](https://www.sciencesocieties.org/publications/crops-soils/2022/january-february/critical-time-of-palmer-amaranth-removal-in-soybean)).
The often-cited V2 to R3 range of Van Acker et al. 1993 is from Ontario, not the US.

The practical reading: in wide-row soybean weeds start costing yield almost as soon as the crop has a leaf, and the
window runs to about R3; narrower rows buy a week or so.

**Stage from the imagery.** NDSU is explicit that herbicide timing goes by growth stage, not plant height, planting date
or row closure, because label limits are stage-based (A1172). Drone photogrammetry height is weak in soybean: with a
Mavic 3M at 45.7 m over 15 in rows, RGB height against a ruler gave R² 0.52, 0.51 and 0.49 at R3, R5 and R7 with RMSE of
11 to 24 cm, against lidar's 0.75 at R3 ([Pun Magar et al. 2025, Frontiers in Plant Science](https://pmc.ncbi.nlm.nih.gov/articles/PMC11821976/)).
Other studies report better figures (R² up to 0.88; [Smart Agricultural Technology 2025](https://www.sciencedirect.com/science/article/pii/S2772375525000127), snippet),
so the sources disagree. Either way, stage should come from planting date and the calendar or heat units, with cover and
closure from the imagery as checks, never as the timing for a label.

## C. Action thresholds that practitioners actually use

**No US cover-percentage threshold for soybean weeds was found.** US guidance is in weed height, crop stage and, for the
worst species, zero tolerance.

*Height.* NDSU: control weeds before 2 to 4 in; in a North Dakota trial, removing weeds at 2 to 4 in (VC to V1) kept 42.1
bu/a against 44.3 weed-free, at 6 to 8 in 40.8, at over 10 in (V2 to V4) 36.4, and the weedy check 22.7 (A1172). Take
Action: Group 14, glufosinate and dicamba on waterhemp no taller than 3 to 4 in ([Take Action waterhemp factsheet 2026](https://growiwm.org/wp-content/uploads/2026/07/Take-Action_Waterhemp-Factsheet-Updated-2026.pdf.pdf)).
Giant ragweed before 6 to 10 in, common ragweed before 4 to 6 in ([Purdue GWC-12](https://ag.purdue.edu/btny/purdueweedscience/wp-content/uploads/2021/01/gwc-12.pdf),
[GWC-14](https://ag.purdue.edu/btny/purdueweedscience/wp-content/uploads/2021/01/gwc-14.pdf)). Marestail in LibertyLink
soybean before 6 in ([Ohio State ANR-72](https://ohioline.osu.edu/factsheet/anr-72)).

*Density.* Waterhemp at more than 20 plants/ft² all season cut yield 44% in 30 in rows and 37% in 7.5 in rows, and
waterhemp emerging as late as V5 still cost up to 10% ([Purdue GWC-13](https://ag.purdue.edu/btny/purdueweedscience/wp-content/uploads/2021/01/gwc-13.pdf)).
Common ragweed at 4 plants per 30 ft of row: up to 10% (GWC-14). For resistant waterhemp, a zero-tolerance approach is
recommended regardless of economic threshold ([Soybean Research and Information Network](https://soybeanresearchinfo.com/research-highlight/computing-soybean-yield-loss-from-palmer-amaranth-and-waterhemp-interference/)).

*Zero tolerance.* Arkansas's Palmer amaranth programme aims to prevent all Palmer seed for three to four years; with
glyphosate alone, resistant populations covered more than 20% of a field in under two years
([UA FSA2177](https://www.uaex.uada.edu/publications/pdf/FSA2177.pdf)).

**Programme context.** Take Action recommends a full-rate pre-emergence herbicide with two or more effective modes of
action, then post with an overlapping Group 15 residual; cereal rye planted green with over 4,000 lb/a biomass cut
waterhemp emergence by up to half (Take Action 2026). Over-the-top dicamba (Engenia, Stryax, Tavium) was registered on 6
February 2026 for 2026 and 2027: at most two applications of 0.5 lb/a, cut-offs by date and stage (Minnesota no later
than 12 or 30 June depending on latitude; South Dakota 30 June or R1; Tavium no later than V4, Stryax R1), a 240 ft
downwind buffer, and no spraying above 85 F in Minnesota ([University of Minnesota Extension](https://blog-crop-news.extension.umn.edu/2026/03/over-top-dicamba-use-registered-for.html);
[South Dakota State](https://extension.sdstate.edu/epa-approves-dicamba-over-top-applications-tolerant-soybean-2026-and-2027)).
Label stage limits: Enlist One and Duo no later than R2, Liberty no later than R1 ([Take Action horseweed factsheet](https://growiwm.org/wp-content/uploads/2026/07/Take-Action_Herbicide-Resistant-Horseweed-Factsheet-Updated-URL.pdf)).
These cut-offs are another reason stage, not cover, decides what a grower can still do. What a freshly sprayed soybean
field looks like was not found with a source; see the symptom timings in [estimating-from-upload.md](estimating-from-upload.md).

**What our code uses today, and what US guidance gives instead.** `schemeFor` in `grade.ts` has no soybean entry:
soybean falls to the wide-row scheme, whose 10% cover action point comes from the Turkish ministry's maize and cotton
guidance (TAGEM 2022). No US source gives a cover threshold for soybean. US guidance acts on weed height (2 to 4 in), the
row-width-dependent start of the critical period (V1 to V3), label stage cut-offs, and zero tolerance for Palmer
amaranth and resistant waterhemp. The 10% figure needs replacing. The closest published analogue to a cover measure is a
2026 Ohio method that takes weed cover as total Canopeo green cover minus soybean cover, with weed cover correlating with
weed density and biomass at r 0.78 and working best at V1 to V2 ([Dias Mendonça et al. 2026, Agricultural and
Environmental Letters](https://acsess.onlinelibrary.wiley.com/doi/full/10.1002/ael2.70073), snippet). It measures cover
well; it does not set a threshold.

## D. The weeds themselves

**Dominant weeds.** In the 2025 WSSA survey waterhemp passed Palmer amaranth as the most troublesome soybean weed
nationally ([GROW, WSSA survey 2025](https://growiwm.org/wssa-survey-shows-an-urgent-need-for-new-weed-control-strategies/));
in the Midsouth, Palmer was ranked first by nearly every Arkansas, Mississippi and Tennessee respondent, with
morningglories, barnyardgrass, horseweed and yellow nutsedge also high ([Mississippi Soybean Promotion Board](https://mssoy.org/articles/most-troublesome-weeds-in-midsouth-soybeans)).

**Resistance and biology.** Waterhemp: resistance to groups 2, 4, 5, 9, 10, 14, 15 and 27; about 250,000 seeds a plant,
sometimes over a million; emerges all season (Take Action 2026). Palmer amaranth: over 5 ft tall, over 1 in of growth a
day, more than 600,000 seeds uncompeted ([Take Action Palmer factsheet 2025](https://growiwm.org/wp-content/uploads/2025/04/Revised-Palmer-Amaranth-Factsheet.pdf.pdf));
glufosinate-resistant Palmer confirmed in two eastern Arkansas counties. Marestail (horseweed): two emergence flushes,
a rosette until spring then bolting to 3 to 6 ft, up to 200,000 wind-blown seeds, glyphosate and ALS resistance
widespread and often together (Take Action horseweed factsheet). Kochia: glyphosate, triazine and some dicamba
resistance in the Plains, first found in Missouri soybean fields in 2025 ([University of Missouri Extension](https://extension.missouri.edu/news/kochia-found-in-nw-missouri-soybean-fields)).

**What RGB at our resolution can and cannot see.** Weeds and soybean are both broadleaf. The US evidence:

- An NDSU and Arkansas study comparing a Phantom 4 Pro RGB with a Phantom 4 Multispectral for crop, broadleaf and grass in
  soybean found overall accuracy RGB 93.8% and multispectral 93.4%; RGB was better on grasses ([Betitame et al. 2025,
  Journal of Agriculture and Food Research](https://scholarworks.uark.edu/aectpub/3/), abstract; altitude not stated).
- Palmer amaranth in Kansas soybean was detected at mAP 0.77 and F1 0.72, but from imagery taken 1.5 to 8 m up, at
  millimetre scale ([Barnhart et al. 2022, Weed Science](https://www.cambridge.org/core/journals/weed-science/article/use-of-opensource-object-detection-algorithms-to-detect-palmer-amaranth-amaranthus-palmeri-in-soybean/CE05E066C36EBFA4A7150EC364A1FA03)).
- Palmer and soybean were spectrally distinct at every date in a five-band multispectral study at 15 to 45 m, near-infrared
  best ([Sanders et al. 2021, Agronomy](https://www.mdpi.com/2073-4395/11/10/1909), abstract).
- A USDA-ARS review, citing Peña 2015, puts individual weed plants at 1 to 4 cm a pixel and weed patches at 5 cm or
  coarser ([Huang et al. 2018, Weed Technology](https://ars.usda.gov/ARSUserFiles/60663500/Publications/Huang/2018/Huang%20et%20al_2018_WT_32-2-6.pdf)).

No US drone RGB study separating waterhemp from soybean with a stated pixel size was found. Plainly: at 1 to 5 cm a pixel
RGB can map weed patches and weed cover between soybean rows, by position, until the canopy closes; it cannot tell
Palmer amaranth from waterhemp, cannot reliably find a seedling weed inside the row, and cannot see under the closed
canopy. In drilled soybean at 5 cm, there is no between-row ground to measure.

**Escapes.** In August, waterhemp and Palmer amaranth push through the soybean canopy mainly at field edges, planting
skips, wheel tracks and thin spots, already too big for post herbicides ([Kentucky Corn and Soybean News, August 2022](https://graincrops.ca.uky.edu/files/csnews2022august.pdf)).
Giant ragweed reached 6 ft in soybean in an Illinois study, often 1 to 5 ft above the crop, and escaped in 29% of more
than 1,300 Indiana fields (GWC-12). Palmer and waterhemp keep about 99% of their seed on the plant at harvest, common
ragweed 78%, lambsquarters 55%, while giant ragweed drops most before harvest ([UW-Madison](https://cropsandsoils.extension.wisc.edu/articles/late-season-weeds-and-controlling-weed-escapes/)),
so a late flight over Palmer or waterhemp escapes still sees the seed it can stop. Soybean itself stands about 19 to 30 in
in North Dakota trials ([NDSU variety trials 2024](https://www.ag.ndsu.edu/varietytrialS/north-central-rec/2024-variety-trial-results/2024-variety-trial-results-soybean-mohall-ncrec));
by our estimate a 4 to 5 ft escape stands 2 to 4 ft above it. In Texas, late-season escape seed production could be
estimated from drone imagery: waterhemp seed count against NDVI r 0.81, Palmer seed against canopy volume r 0.87
([Kutugata et al. 2021, Weed Science](https://www.cambridge.org/core/journals/weed-science/article/seed-rain-potential-in-lateseason-weed-escapes-can-be-estimated-using-remote-sensing/DE00CA1864C2FB75E15E8CB8CA89493F)).

## E. What the imagery must be

| Task | Pixel size | Basis |
|---|---|---|
| Find 30 in rows | 5 cm or finer | our arithmetic (15 px per row at 5 cm) |
| Find 15 in rows | 3 cm or finer | 8 px per row at 5 cm, marginal; our estimate |
| Find drilled 7.5 in rows | 1 to 2 cm, before closure only | 4 px per row at 5 cm; see [wheat.md](wheat.md) |
| Cover between rows | 2 to 3 cm, V1 to about R1 in 30 in rows | our estimate; closure timings above |
| Weed patches | 5 cm or coarser | Huang 2018 |
| Individual weed of action size (5 to 10 cm) | 1 to 2.5 cm | four-pixel rule ([Peña et al. 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC4435221/)) |

With a Phantom 4 RTK (pixel size equals height divided by 36.5, [DJI](https://www.dji.com/phantom-4-rtk/info)), 1 cm needs
about 37 m, 2 cm 73 m and 3 cm 110 m; the 400 ft FAA ceiling ([14 CFR 107.51](https://www.law.cornell.edu/cfr/text/14/107.51))
makes about 3.3 cm the coarsest legal RGB. Residue and wheat stubble between rows (common in no-till and double-crop
soybean) change the background the vegetation mask works against; no study of that background was found.

**Multispectral and height.** For US soybean the direct comparison found no net gain from multispectral (93.8% against
93.4%, Betitame 2025); a Chinese seedling study at 1.4 cm found adding near-infrared to RGB raised segmentation by about
2.6 points of mIoU ([SCG-UNet, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC13468278/)). Height from a DSM is weak in
soybean (R² about 0.5 for the crop at 45.7 m) but canopy volume predicted late escape seed production for Palmer (r 0.87)
and johnsongrass (r 0.90), though not for waterhemp (Kutugata 2021). No soybean study quantifying sun angle, shadow or
wind effects was found.
