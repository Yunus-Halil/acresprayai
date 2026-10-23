# Corn growth stages and plant morphology as seen from above

Research of 2026-10-23. Extends [../corn.md](../corn.md) section B (staging, GDD rates, stage-from-imagery) without
repeating it. Scope: what a nadir RGB image at 0.3 to 5 cm a pixel can see of a corn plant at each stage, and how well
the stage can be known from the calendar. US sources first (Iowa State PMR 1009 via the Ohio State and Kansas State
restatements, Purdue, Ohio State, Minnesota, Arizona, SDSU, Penn State), then peer-reviewed phenotyping papers (France,
China, Germany, Ohio, Minnesota). Figures marked "(snippet)" were seen in a search result or abstract only. Our own
arithmetic and estimates are labelled "(our estimate)". Where a thing was searched for and not found it says "not found".
The web-search budget ran out before a Nafziger stage-by-stage interception table, a Dwyer and Stewart leaf-size table
and a corn shadow study could be chased; those are listed under gaps.

## 1. The staging system

**Vegetative stages (leaf collar method, the US standard).** VE is emergence of the coleoptile; V1, V2 ... V(n) count
leaves with a visible collar (the light band where blade meets sheath), starting from the short, round-tipped first leaf;
VT is the last tassel branch visible; R1 silking, R2 blister, R3 milk, R4 dough, R5 dent, R6 physiological maturity
(black layer). A field is at a stage when 50% or more of plants are at or beyond it
([Iowa State, Corn Growth Stages](https://crops.extension.iastate.edu/encyclopedia/corn-growth-stages);
[Ritchie, Hanway and Benson 1993, How a Corn Plant Develops, ISU Special Report 48](https://publications.iowa.gov/18027/1/How%20a%20corn%20plant%20develops001.pdf);
[Purdue, Nielsen, Determining Corn Leaf Stages](https://www.agry.purdue.edu/ext/corn/news/timeless/VStageMethods.html)).
Leaves in the whorl without a collar are not counted; a V3 plant "may show five to six leaves"
([Pioneer, Staging Corn Growth](https://www.pioneer.com/us/agronomy/staging_corn_growth.html)).

**The other counting methods and their offsets.** These matter because labels, adjusters and some sources count
differently, and because an overhead image sees leaf tips, not collars.

| Method | Rule | Offset from collar count | Source |
|---|---|---|---|
| Leaf collar (ISU) | uppermost visible collar | reference | ISU, Purdue |
| "Droopy" / horizontal leaf (FCIC, hail adjusters, older labels) | uppermost leaf 40 to 50% out of the whorl, tip hanging | collar = droopy minus 1 up to V5 to V6; minus 2 once plants are 18 to 24 in tall | Purdue Nielsen; Penn State shows a V4-collar plant as V5-droopy ([Penn State](https://extension.psu.edu/corn-growth-stages)) |
| Leaf tip | uppermost tip out of the whorl | V1 = 3 tips; V3 = 5 to 6; V4 to V5 = 7 to 8; V5 to V6 = 9 to 10; V8 = 12; V10 = 14 to 15 | [Pride Seeds, from OMAFRA Pub 75](https://www.prideseeds.com/fieldtalk/staging-corn-plants); [Manitoba Agriculture](https://www.gov.mb.ca/agriculture/crops/crop-management/grain-corn/how-a-corn-plant-grows.html) |
| "Leaf over" | leaves whose tip has arched over | V1 = 2; V3 = 4; V4 to V5 = 6; V5 to V6 = 8; V8 = 10; V10 = 12 | same |
| FCIC (40 to 50% of leaf visible) | as droopy | V1 = FCIC V2; V3 = V4; V5 = V7; V6 = V8; V10 = V13; V15 = V18 | [Hall, SDSU, Corn growth stages with calendar days and GDUs](https://mygeohub.org/resources/879/download/Corn-growth-stage-day-and-GDU-calendar10.pdf) |
| Height | soil to the arch of the highest leaf whose tip points down | 5 to 6 cm = V1; 9 to 17 cm = V3; 18 to 33 cm = V4 to V5; 36 to 54 cm = V5 to V6 | Pride Seeds / OMAFRA, "not the most accurate ... rarely used alone" |

The offset grows with age because leaves emerge faster than collars form; the Hall table shows the collar-to-FCIC gap
widening from one leaf at V1 to three leaves at V5 to V15. For an image that sees tips and not collars, the
tip-count-minus-two rule holds to about V5 and tip-minus-four to -five after that (our reading of the OMAFRA and Hall
columns).

**Total leaf number.** Most hybrids produce 18 to 21 leaves (ISU encyclopedia); 20 to 21 for the central Iowa midseason
hybrid illustrated in 1993 (Ritchie et al.); 19 to 20 for "most Corn Belt hybrids" ([Ohio State, A Guide to Corn Growth and
Development](https://cfaes.osu.edu/fact-sheet/guide-corn-growth-and-development)); 21 to 22 for full-season central Corn
Belt hybrids (Pioneer); about 20 (Penn State); "usually 18" ([Minnesota Extension](https://extension.umn.edu/growing-corn/growth-and-development)).
Across 98 Corn Belt datasets (Iowa 64, Illinois 13, North Dakota 13, Nebraska 8; relative maturity 73 to 115 days) the
maximum leaf number averaged 20, range 16 to 23
([Maize leaf appearance rates: a synthesis from the US Corn Belt, 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9037294/)).
Cold soil early "may increase the total number of leaves formed" (Ritchie et al. 1993). The "18 to 22" wording in the
brief was not found verbatim; the sourced range is 16 to 23 with 18 to 21 typical. A plant carries at most about 14 green
leaves at once during the vegetative period (synthesis paper); Minnesota puts 12 to 13 leaves on the plant at VT.

**Lower leaf loss and the split-stalk count.** From about V6, stalk expansion and nodal root growth tear off the lowest
leaves (Ritchie et al. 1993; [Wisconsin, Corn Development](https://corn.agronomy.wisc.edu/Management/L011.aspx); Ohio
State). The first (round) leaf is already senescent at V6 ([K-State / UNL / Wisconsin poster MF3305](https://corn.agronomy.wisc.edu/Management/pdfs/Corn%20Growth%20and%20Development%20poster.pdf));
the two lowest may be gone by V8 (Ritchie et al.); lower 2 to 3 decomposed at V9 (Pioneer); lower 3 to 4 absent at V12
([Ohio State AGF-0101 Table 1](https://ohioline.osu.edu/sites/ohioline/files/imce/Agriculture_and_Natural_Resources/AGF-0101-Table1e.pdf));
4 to 5 senesced by V18 (Ohio State guide); 5 to 6 slough between V8 and VT (Minnesota). Count after loss: split the
stalk, find the first elongated internode (about 1 cm, Ritchie; 1/2 to 3/4 in, Nielsen) above the woody base; the node
above it is leaf 5; count collars upward from there. A V12 plant with four withered leaves shows only eight collars and
must not be called V8 (Nielsen). For an image this means visible leaf count under-states stage from about V8 on.

## 2. Per-stage table: what an overhead image can see

Heights are extension figures for the collar stage (soil to the arch of the top drooping leaf, which is what a
photogrammetric height sees too). GDD are °F, 86/50 method, cumulative from planting; the three columns are the three
published tables and they do not agree (section 3). Days are Hall's Corn Belt 120-day-hybrid table (days after seeding);
Indiana and Arizona figures in section 3 bracket them. Cover and resolvability columns are our estimates unless sourced.
"px" is plant projected pixels at the stated GSD.

| Stage | GDD, OSU/ISU-derived | GDD, Bayer (20-leaf) | GDD, Hall/SDSU | Days after seeding (Hall) | Height | Leaves visible (collared / tips) | Canopy width, cover at 30 in | Resolvable at 1 / 3 / 5 cm | Sources |
|---|---|---|---|---|---|---|---|---|---|
| VE | 100 | 100 to 120 | 100 to 150 (germination) then VE 166 to 216 | 7 to 14 (5 to 7 d warm, 3 to 4 weeks cold) | spike 1 to 3 cm (our estimate) | 0 / coleoptile "spike" | a green dot; cover well under 1% | 1 cm: 1 to 3 px, marginal; 3 and 5 cm: no | OSU AGF-0101; Bayer; Hall; Nielsen Emergence; Arizona az2199 |
| V1 | not tabled (VE + 82) | not stated | 232 to 282 | 10 to 17 | 5 to 6 cm | 1 / 3 | first leaf 4 to 4.5 cm long, rounded tip; cover about 1% | 1 cm: a few px; 3 cm: no; 5 cm: no | OMAFRA; Mississippi State; Hall |
| V2 | about 264 | about 200 | 298 to 348 | 13 to 20 | 5 to 10 cm (2 to 4 in) | 2 / 4 to 5 | second leaf pointed, longer than the first; cover 1 to 2% (our estimate) | 1 cm: 10 to 25 px, countable at 0.3 to 1 cm; 3 cm: 1 to 3 px; 5 cm: no | Arizona; Hall; Sensors 2021 (snippet) |
| V3 | 346 | not stated | 364 to 414 | 16 to 23 (Indiana 24 d from 3 May) | 9 to 18 cm (5 to 7 in; 9 to 17 cm) | 3 / 5 to 6 | 24 to 37 cm² per plant from measured 2.3% cover in China; 70 to 230 cm² for "3 to 5 leaf" in France; cover 2 to 4% at 30 in | 1 cm: 25 to 230 px, countable; 3 cm: 3 to 25 px, marginal; 5 cm: 1 to 9 px, a dot | OSU; Mississippi; OMAFRA; Gao 2023; Velumani 2021; Purdue 2006 |
| V4 | 428 | 360 | 430 to 480 | 19 to 26 | 18 to 33 cm (V4 to V5) | 4 / 7 | per-plant 100 to 250 cm² (our estimate between V3 and V6); cover 5 to 10% (our estimate) | 1 cm: yes; 3 cm: 10 to 30 px, marginal; 5 cm: 4 to 10 px, dots | OMAFRA; Hall; counting drops at V4 from overlap (Sensors 2021, snippet) |
| V5 | 510 | not stated | 496 to 546 | 22 to 29 | 20 to 30 cm (8 to 12 in); 25 to 36 cm (Miss.); about 20 cm at tassel initiation (Ritchie) | 5 / 9 | 6% of final leaf area (Hall); cover 10 to 20% (our estimate) | 1 cm: yes, neighbours starting to touch; 3 cm: blobs; 5 cm: row becomes a dashed line | Arizona; Bayer; Mississippi; OMAFRA; Hall |
| V6 | 592 | 520 | 562 to 612 | 25 to 32 (Indiana 46 to 50 d from 17 April) | 36 to 54 cm (OMAFRA, V5 to V6); 36 to 51 cm (14 to 20 in, Miss.) | 6 (first leaf dying) / 10 | measured 32% cover at 0.94 cm in China (62,000 live plants/ha, about 520 cm² per plant); light interception 56% in 76 cm rows (NE US); 10% of final leaf area | 1 cm: plants merge along the row, "severe leaf overlapping"; 3 cm: row is a band; 5 cm: row is a band | Gao 2023; Weed Science 2021 interseeding study; Hall; OMAFRA; Mississippi |
| V7 to V8 | 674 to 756 | 680 to 760 (V8 to V9) | 628 to 744 | 28 to 38 | 60 cm (24 in) at V8 (Arizona); about 91 cm (36 in) at V8 to V9 (Bayer): the two disagree | 7 to 8 (lowest two gone by V8) / 11 to 12 | 16 to 31% of final leaf area; alley still open | rows as continuous bands; alley width measurable at 3 cm (25 px of 76 cm) | Arizona; Bayer; Hall; Ritchie |
| V9 to V10 | 838 to 920 | about 800 (interp.) | 760 to 876 | 34 to 44 (Indiana V9 at 49 d) | not sourced between 60 cm and 120 cm; Bayer "about 36 in" at V8 to V9 | 9 to 10 (2 to 3 lost) / 13 to 15 | light interception 70% (Illinois, 30 in), 84% (NE US, 76 cm) at V10; 41 to 50% of final leaf area; canopy closes about V10 to V11 at 30 in | alley closing; cover between rows no longer measurable from about V10 | Pioneer/Nafziger; Weed Science 2021; UNL; Hall |
| V12 | 1020 | 900 | 958 to 1008 | 43 to 50 | over 120 cm (4 ft) | 12 (3 to 4 lost) / 17 | 69% of final leaf area; 10% of final dry matter; closed | canopy only | Arizona; OSU; Hall |
| V15 | 1170 | about 1085 (interp.) | 1138 to 1188 | 51 to 58 | not sourced | 15 / 18 | 94% of final leaf area; 25% of dry matter; new leaf every 1 to 2 days | canopy only | OSU; Hall; Ritchie; Bayer |
| V18 | about 1320 | about 1200 (interp.) | 1282 to 1332 | 57 to 64 | near maximum | 18 (4 to 5 lost) | 96% of leaf area; 35% of dry matter; upper leaves about 30° from the stalk, lower about 45° | canopy only | OSU guide; Hall |
| VT | 1420 | 1350 | 1478 to 1528 | 65 to 72 (Arizona 9 to 10 weeks after VE) | maximum or near | all; tassel visible | 99% of leaf area; interception about 98 to 99% by R2 | tassels visible as texture at 1 to 3 cm | OSU; Bayer; Hall; Pioneer |
| R1 | 1420 | 1500 | 1578 to 1628 | 69 to 76 (Iowa: about 65 d after VE) | maximum | | | silks not resolvable at our GSD | OSU; Bayer; Hall; Ritchie |
| R2 | 1686 | 1700 | 1903 to 1953 | 82 to 89 (10 to 14 d after R1) | | | | | OSU; Bayer; Hall |
| R3 | 1830 | 1875 | 2103 to 2153 | 91 to 98 (18 to 22 d after R1) | | | | | |
| R4 | 1981 | 1950 | 2303 to 2353 | 100 to 107 (24 to 30 d) | | | | | |
| R5 | 2324 | 2300 | 2528 to 2578 | 113 to 120 (35 to 42 d) | | | leaves begin to yellow from below; senescence index work at 1.5 cm | canopy colour only | OSU; Bayer; Hall; Zimbabwe CIMMYT study |
| R6 | 2650 | 2700 | 2903 to 2953 | 128 to 135 (55 to 65 d after R1; Iowa about 125 d after VE) | | | | | OSU; Bayer; Hall; Ritchie |

Sources for the table beyond those in section 1: [Ohio State AGF-0101 Table 1](https://ohioline.osu.edu/sites/ohioline/files/imce/Agriculture_and_Natural_Resources/AGF-0101-Table1e.pdf)
(adapted from Abendroth et al. 2011 and Nielsen); [Bayer, Corn Growth Stages and GDU Requirements](https://www.cropscience.bayer.us/articles/bayer/corn-growth-stages-and-gdu-requirements);
[Hall, SDSU, calendar-day and GDU tables](https://mygeohub.org/resources/879/download/Corn-growth-stage-day-and-GDU-calendar10.pdf)
(from Ritchie et al. 1997 and Flowerday 1995, "evaluate on a relative basis"); [Arizona az2199, April 2026](https://extension.arizona.edu/sites/default/files/2026-06/az2199-corn-growth-development-stages.pdf);
[Mississippi State, How to Determine Corn Vegetative Growth Stages](https://www.mississippi-crops.com/2026/04/18/how-to-determine-corn-vegetative-growth-stages/);
[Gao et al. 2023, Remote Sensing 15:3671](https://www.mdpi.com/2072-4292/15/14/3671); [Velumani et al. 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8404552/);
[Light partitioning ... drill-interseeding in corn, Weed Science](https://www.cambridge.org/core/journals/weed-science/article/light-partitioning-strategies-impact-relative-fitness-of-weeds-and-cover-crops-when-drillinterseeding-in-corn/8F72FA88565D214BBB85170F158D5F15);
[Pioneer, Row Width in Corn Grain Production](https://www.pioneer.com/us/agronomy/row-width-grain-corn.html).

**Leaf dimensions by leaf number.** No US table of leaf length and width by rank for leaves 1 to 10 was found. What is
sourced: the first leaf is about 1.5 to 1.75 in (4 to 4.5 cm) long with a rounded tip, "each successive leaf is pointed
and longer" (Mississippi State). In a European and Mexican panel, leaf 6 base width ranged 66 to 83 mm across hybrids;
the longest leaf was 62 cm at rank 9 on 14-leaf plants and 88 cm at rank 16 on 26-leaf lines; length peaks at about
rank 0.68 × final leaf number (so rank 13 to 14 on a 20-leaf hybrid), width slightly higher (the paper's own parameters
are inconsistent on this), both following a bell curve with rank ([Simulating the effect of flowering time on maize
individual leaf area, Plants 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7501815/)). Dwyer and Stewart 1986
(Agronomy Journal 78:334) is the classic US leaf-area-by-rank source and was not retrievable. Leaf area accumulates
as 6, 10, 16 to 23, 31, 41, 50, 60, 69, 77, 84, 94% of the final total at V5, V6, V7, V8, V9, V10, V11, V12, V13, V14,
V15 (Hall). So the plant seen from above roughly doubles its leaf area every two stages from V5 to V9 and the alley is
half shaded by about V10.

**Leaf orientation.** Leaves are alternate and in one plane ("laid alternately from side to side", Ritchie et al. 1993);
a seedling's plane initially follows the direction the kernel was planted, so early fields look random
([Zhou et al. 2024, Plant Cell, via Iowa State](https://academic.oup.com/plcell/article/36/5/1600/7584950)). Re-orientation
towards the alley happens between 40 and 50 days after planting; by 60 days 40 to 70% of the top two leaves of control
inbreds lay within 30° of perpendicular to the row, and more so at higher density; in hybrid Pioneer 3902 leaves 12 to
16 turned perpendicular as density rose (Zhou et al. 2024, Iowa, 2021 to 2022). Pioneer's own field count reported no
difference in orientation distribution between products or densities (snippet, [Pioneer Growing Point 2015](https://www.pioneer.com/home/site/us/pioneer_growingpoint_agronomy/2015/corn-leaf-orientation-plant-density)).
Leaf angle (Iowa, inbreds, measured so that larger is more upright): B73 80.6° one leaf below the flag falling to 60.0°
two below the ear; Mo17 52.7° to 61.6°; the B73 × PHW30 hybrid 75.9° to 64.4°
([Dzievit, Li and Yu 2023, The Plant Genome](https://doi.org/10.1002/tpg2.20423)). Hybrids released 1980 to 2020 are on
average 6° more erect than older ones (Bayer legacy set, snippet); US hybrids after 1970 are more erect (Duvick 2004 via
Zhou). A descriptor scale classes upper-leaf angle from vertical as upright 0 to 30°, intermediate 30 to 60°, lax 60 to
90° (snippet, plant variety protection descriptor). For us: upright hybrids show less projected area per plant at the
same stage and keep the alley visible longer; no study quantifying this for imagery was found.

**Shadows.** No corn study of shadow length or its effect on cover estimates was found. Shadows lengthen at low sun
([Delaware Extension, Mapping with Drones](https://udel.edu/academics/colleges/canr/cooperative-extension/fact-sheets/mapping-with-drones));
Gao 2023 treats shadow as its own dark class. Arithmetic: shadow length = height / tan(solar elevation), so a 30 cm V5
plant casts 17 cm at 60° sun and 52 cm at 30°; a 60 cm V8 plant casts 35 and 104 cm, which at 30° already spans a 76 cm
alley (our estimate). Shadow on the alley is dark, not green, so it inflates a "not soil" mask but not a green mask.

## 3. Thermal time, calendar time, and observed versus estimated stage

**Definition.** GDD (°F) per day = (max + min)/2 minus 50, with max capped at 86 and min floored at 50 ("modified" or
86/50 method, Gilmore and Rogers 1958, Barger 1969 as the NOAA standard)
([Purdue, Nielsen, Heat Unit Concepts](https://www.agry.purdue.edu/ext/corn/news/timeless/heatunits.html)). The Celsius
equivalent is base 10 with a 30 cap and 1 °C-day = 1.8 °F-days (our arithmetic; no US source states it). Until about V6
the growing point is below ground and soil temperature at 2 to 4 in predicts development better than air temperature;
air-based tools can run far higher (20 GDD/day from air against 8 from soil on an April day in Indiana)
([Purdue, Soil Temperature and Corn Emergence, 2021](https://agry.purdue.edu/Ext/corn/news/articles_21/SoilTempEmergence-0412.html)).
Central Indiana accumulates about 10 GDD/day in late April and 23 in late July, about 2,800 in a late-April-to-September
season (Nielsen, heat units).

**Planting to emergence.** 100 to 120 GDD (Nielsen, [The Emergence Process](https://www.agry.purdue.edu/Ext/corn/news/timeless/Emergence.pdf));
115 ± 5 on soil GDD (Nielsen 2021); 90 to 120 ([Iowa State 2012](https://crops.extension.iastate.edu/cropnews/2012/04/how-long-will-it-take-corn-emerge));
100 (OSU table); 100 to 150 (Hall). In days: 4 to 5 under ideal soil temperature (Arizona; Ritchie), 5 to 7 (K-State
poster), about 1 week near 70 °F, 10 to 12 days at 60 °F, about 3 weeks at 50 to 55 °F (Iowa State 2012; Agrigold 18 to
21 days, snippet), up to four weeks in cold soil (Nielsen).

**Per leaf.** Purdue: one collar per 82 GDD (an earlier study said 85) from VE to V10, then one per 50
([Nielsen, Use Thermal Time to Predict Leaf Stage](https://www.agry.purdue.edu/ext/corn/news/timeless/VStagePrediction.html)).
Iowa State: 84 then 56 from V11 ([Ohio State, Predicting Leaf Development](https://agcrops.osu.edu/newsletter/corn-newsletter/predicting-leaf-development-corn-using-accumulated-heat-units)).
Ohio State's table is 82 per leaf to V9, 61 from V9 to V12, 50 from V12 to V19. Hall's table from Ritchie 1997 uses 66
per leaf to V14 and 48 after, a lower early rate than the 82 to 84 everyone else quotes. Bayer's cumulative values imply
about 80 per leaf V4 to V6 and 63 per leaf V6 to V12. The Corn Belt synthesis (base 8 °C, uncapped daily curve, so not
directly comparable) found a bilinear phyllochron of 57.9 ± 7.5 °C-days per leaf (range 42.5 to 77.9) to a breakpoint
at leaf 9.8 ± 1.2 (range 7.4 to 13.4), then 30.9 ± 5.7 (range 16.2 to 49.5); a single linear phyllochron averaged 51.5
with a 9.4% coefficient of variation; n = 4,694 observations
([Maize leaf appearance rates, 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9037294/)). Roughly converted, 58 °C-days
at base 8 is of the order of 85 to 95 °F-days at 86/50 (our estimate), consistent with Purdue and Iowa.

**Where the tables disagree.** V6: 520 (Bayer), 592 (OSU), 562 to 612 (Hall). V10 from planting: 940 (Purdue, 120 +
10 × 82), 920 (OSU), 826 to 876 (Hall). VT: 1,350 (Bayer, 20-leaf product), 1,420 (OSU), 1,478 to 1,528 (Hall). R6: 2,650
(OSU), 2,700 (Bayer), 2,903 to 2,953 (Hall, 120-day hybrid). The early-stage spread (V3 to V8) is 40 to 80 GDD, which is
half to one leaf; the late spread is one to two leaves. Our profile should carry a range, not a value.

**Calendar time.** Hall's Corn Belt table puts V3 at 16 to 23 days after seeding, V6 at 25 to 32, V10 at 37 to 44, VT at
65 to 72, R1 at 69 to 76, R6 at 128 to 135. Arizona: V3 two to four weeks after emergence, V6 four to six, V9 to V11 six
to eight, VT nine to ten. Iowa (1993 hybrid): silks about 65 days after emergence, maturity about 125. Indiana (from
corn.md): V3 at 24 days and V9 at 49 days from a 3 May planting; 46 to 50 days to V6 from 17 April. Beijing (sown 15 May,
6 plants/m², 0.6 m rows): V4 at 24 days, V10 at 45, V14 at 57, VT at 74, R1 at 81
([Fuzzy clustering of maize plant-height patterns, 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6652214/)). Leaf
appearance in days: one every 3 to 4 days early, 2 to 3 days from about V10, 1 to 2 days at V15 (Penn State; Arizona;
K-State poster; Ritchie; Pioneer). Minnesota: vegetative phase early May to early or mid July, reproductive to about
mid September.

**Observed versus estimated stage.** An estimated stage comes from planting date plus weather (soil GDD to V6, air GDD
after) and a per-leaf rate; an observed stage comes from collars counted in the field, or from an image that sees tips,
height and cover. Nielsen calls the estimate "the proverbial ballpark" and gives no error figure; his worked examples
bracket a field as "V6 to V7". No validation study reporting how often the estimate is within one leaf of the observed
stage was found. What is sourced on error: an Illinois 2015 trial found a 1 April planting about three leaf stages behind
the handbook GDD table and a 21 April planting two behind, blamed on frost regrowth and cloudy weather
([Illinois Extension, 2015](https://extension.illinois.edu/blogs/hill-and-furrow/2015-06-09-how-well-do-accumulated-gdds-relate-approximated-and-actual-growth));
growth-limiting stress (moisture, nutrients, compaction) "retards stem and leaf sheath elongation", delaying collars
(Nielsen; Ohio State); stress lengthens the time between vegetative stages (Ritchie). The hybrid-by-environment spread
of the phyllochron (42 to 78 °C-days around a mean of 58) means that using the mean rate for a field whose true rate is
at either end mis-stages it by about ±25% of leaves accumulated, about ±2 leaves at V8 (our arithmetic from the synthesis
ranges). Planting date itself is often the operator's estimate. The practical rule for the profile: the GDD estimate is
good to about one leaf in a normal season and two to three leaves after frost, replanting or prolonged stress; any
observable that disagrees by more than that (tip count, height, closure) should win.

## 4. V2 to V5 in detail

**Appearance from above.** VE is a pale green coleoptile "spike" 1 to 3 cm tall (K-State poster; Nielsen Emergence; size
our estimate) with the crown of the plant 1/2 to 3/4 in below the surface regardless of seeding depth (Nielsen). V1 shows
one short, oval, round-tipped leaf about 4 cm long (Mississippi State; Iowa State; Purdue). From V2 every later leaf is
pointed and longer, emerging from a central whorl, alternate and in one plane whose direction is random between plants
(Ritchie; Zhou). Seedlings are yellow-green until V3, when they turn dark green as the nodal roots take over
([Purdue, Corn Growth Stages VE to V3, 2021](https://ag.purdue.edu/news/department/agry/kernel-news/2021/05/corn-growth-stages-ve-to-v3.html));
a UAV study notes "weak color characteristics at the V3 stage" and "ambiguous color ... due to leaf overlapping at the
V6 stage" (Gao 2023). Shallow-planted seedlings can be "floppy" and lean (Purdue 2021), which from above moves the whorl
off the row line. Purpling from anthocyanin under cool wet soil or phosphorus shortage is common in V2 to V5 and
usually gone by V6 (section 6). Heights: V2 5 to 10 cm, V3 9 to 18 cm, V4 to V5 18 to 33 cm, V5 20 to 30 cm (section 2).

**Plant size and in-row spacing.** Measured projected sizes: at V3 in Shanxi (0.94 cm GSD, rows and spacing not
stated, 82,500 and 105,000 seeds/ha but only 66% emerged) mean canopy cover was 2.29% (plot range 1.66 to 2.75%), which
is about 24 to 37 cm² per live plant; at V6 it was 32.2% (25.5 to 35.9%), about 520 cm² per plant, with "severe leaf
overlapping" (Gao 2023; per-plant figures our arithmetic). In France, "three to five leaf" plants (about a month after
sowing) covered 806 to 2,253 pixels at 0.25 to 0.35 cm, which is 70 to 230 cm² (Velumani 2021; conversion ours). Treated
as a disc that is an equivalent diameter of 6 to 7 cm at V3 (Shanxi), 9 to 17 cm for the French 3 to 5 leaf plants, and
about 26 cm at V6; but a corn seedling is not a disc, it is two to four leaves in one plane, so its longest span is about
twice the longest leaf and its width across that plane only a leaf's width (our reading). With US in-row spacing of 14
to 20 cm at 26,000 to 38,000 plants/a in 30 in rows (corn.md), neighbours whose leaf planes lie along the row begin to
touch at about V4 to V5 and overlap generally at V6; neighbours whose planes lie across the row stay separate longer.
That matches the counting literature: counts hold through V3, fall at V4 "from overlapping and occluded canopies"
(Sensors 2021, snippet), and are "weakest at V2 and V6" with V3 and V5 best for a YOLOv9 detector (snippet, Remote Sensing
2026). No source gives canopy width across the row in cm by stage; that is a gap we can fill from our own imagery.

**Cover fraction at 30 in by stage (our estimate).** Scaling the Shanxi per-plant areas to 84,000 plants/ha
(34,000/a): V3 about 3%, V6 about 40% before overlap is removed, so 30 to 40% net. Hall's leaf-area curve (6% of final
leaf area at V5, 10% at V6, 50% at V10) and the interception figures (56% at V6 and 84% at V10 in 76 cm rows, NE US; 70%
at V10 in Illinois) sit together with that. A V2 to V3 field at 30 in is therefore 97 to 98% soil, residue and weeds from
above, and the crop row is a line of 6 to 10 cm green marks every 14 to 20 cm.

**Resolvability of a corn seedling.** By the four-pixel rule (corn.md): V2 needs about 1 cm or finer; V3 is countable at
1 cm (25 to 230 px), marginal at 3 cm (3 to 25 px), a one-to-nine-pixel dot at 5 cm; V4 to V5 are blobs at 3 cm and a
dashed line at 5 cm; from V6 the row is a continuous band at every GSD we fly. Published counting flew 0.24 to 0.33 cm
(Varela 2018, snippet; Velumani; [Lu et al. 2024, Germany, YOLOv5 at 0.33 cm](https://pmc.ncbi.nlm.nih.gov/articles/PMC10794460/)),
0.82 cm (Minnesota height study), 0.94 cm (Gao 2023, counts within 1 to 2% of truth at V3 and V6), and 1.5 cm
([Katari et al. 2024, Ohio, V2 to V4, 1 m rows, R² 0.94 against stand counts](https://pmc.ncbi.nlm.nih.gov/articles/PMC11479280/)),
where a plant annotation block of 0.2 × 0.25 m was only about 13 × 17 pixels. Degrading 0.3 cm imagery to 0.6 cm raised
Velumani's counting rRMSE from 0.08 to 0.48; 2.4 mm to 19.2 mm took Varela's accuracy from 0.96 to 0.68 (snippet).
Nothing published counts corn at 3 to 5 cm.

**Corn seedling versus grass weed from above.** The field keys separate them by the ligule (foxtails a fringe of hairs,
crabgrass membranous, barnyardgrass none), hairs on the blade, flattened versus round sheath, and the first leaf: a
foxtail's first blade is "linear, about seven times longer than wide and opens somewhat parallel to the ground"
([Bayer, Foxtail Identification](https://cropscience.bayer.us/articles/channel/foxtail-identification); [Missouri IPM1024](https://extension.missouri.edu/media/wysiwyg/Extensiondata/Pub/pdf/agguides/pests/ipm1024.pdf);
[Wisconsin IPM Weed Guide](https://corn.agronomy.wisc.edu/Management/pdfs/IPMManual_7_WeedGuide.pdf)), against a corn
first leaf that is short, oval and round-tipped and later leaves "broad lance-shaped" (Gao 2023). None of those features
survives 1 to 5 cm pixels: a foxtail seedling blade a few millimetres wide is sub-pixel at 1 cm, and even at 0.33 cm
"weeds that resembled maize in shape and color were detected as maize" at the 3-leaf stage and "maize and weeds were
hard to tell apart" for annotators (Lu 2024). The datasets built to separate maize from grass weeds used 0.17 cm
([maize and tomato drone dataset, Spain, BBCH14 and 17, with Lolium rigidum and Sorghum halepense](https://pmc.ncbi.nlm.nih.gov/articles/PMC11719326/))
and 0.25 cm (WeedsGalore, "to distinguish individual plant instances", snippet); a ground-camera SVM reached 97.5% on
corn against Poa annua, Eleusine indica and two broadleaves with texture features (rotation-invariant LBP plus
gray-gradient co-occurrence), shape moments being the weakest feature
([Weed and Corn Seedling Detection, Sensors 2021, China](https://pmc.ncbi.nlm.nih.gov/articles/PMC7796182/)), a resolution
we never have. What does separate them at our resolution: position on the planted line with regular 14 to 20 cm
spacing (Peña 2013 in corn.md); size, since corn out-grows a cohort of foxtail emerging with it; and from V3 the darker
green of corn against the paler grass, a cue no source quantifies. A grass seedling sitting on the row line within a few
cm of a corn plant is not separable from it at 1 cm or coarser.

## 5. Remote-sensing literature summary

| Study | Place, stage | GSD, height | Result | Note |
|---|---|---|---|---|
| Velumani et al. 2021, Plant Phenomics | France, 3 to 5 leaf, 30 to 110 cm rows | 0.25 to 0.35 cm at 16 to 26 m; 0.63 to 0.66 at 30 to 40 m | plants 806 to 2,253 px at high res, 156 to 437 at low; rRMSE 0.08 high-res, 0.48 on native low-res; super-resolution recovers to 0.22 | scale mismatch and loss of texture at coarser GSD |
| Varela et al. 2018, Remote Sensing 10:343 | US, early stand count | 2.4 mm | accuracy 0.96 native, 0.68 at 19.2 mm | snippet |
| Gao et al. 2023, Remote Sensing 15:3671 | Shanxi, China, V3 (21 May) and V6 (18 June) | 0.94 cm at 25 m, Phantom 4 Pro | counts within 1 to 2% at both stages; cover 2.29% at V3, 32.2% at V6; weeds removed by morphology and a dual threshold | the only stage-tagged cover figures found |
| Katari et al. 2024, Sensors 24:6467 | Wooster, Ohio, V2 to V4, 1 m rows | 1.5 cm at 26 m | VGG16 R² 0.94 against counts; errors from inter-row weeds of similar colour, curved rows, doubles | coarsest counting GSD found |
| Lu et al. 2024, Frontiers Plant Sci | Munich, 3-leaf and 7-leaf, dense plots | 0.33 cm at 12 m | mAP50 0.83 and 0.86; weeds mistaken for maize at 3-leaf, occlusion at 7-leaf | |
| Sensors 2021 CNN (Iowa State) | ground video, V1 to V4 | ground | 98.7% at V2, 98.1% at V3, falls at V1 and V4 | snippet |
| Remote Sensing 2026, YOLOv9 corn | three soil colours, V2 to V6, two heights | not read | V3 and V5 best (mAP50 over 85%), V2 and V6 weakest; 70 m flight loses 8 to 12 points | snippet |
| Emergence uniformity, ResNet18 | V2 to V4 at 10 m | about 0.3 cm (our estimate) | 0.73 to 0.97 for density and emergence | snippet |
| Minnesota UAV height, 2020 | St Paul, 30 in rows, 60 to 120k/ha, weekly | 0.82 cm at 30 m | height r² 0.96 but RMSE 10 to 39 cm by date | too noisy to stage seedlings (consistent with corn.md) |
| Beijing height time series, 2019 | 0.6 m rows, 6/m² | 0.72 to 2.7 cm at 40 to 60 m | RMSE 14.1 cm; V4 at 24 DAS to R1 at 81 | |
| CIMMYT Zimbabwe, 2018 | 0.75 m rows, 42, 75, 96 DAS | 1.51 cm at 80 m | cover and senescence by maximum likelihood classes; heritable | no stage values |
| MaizeHT, Remote Sensing 2024 | UAV orthophotos, stages not read | not read | 96.4% stage recognition | snippet, stages unknown |
| Agriculture 2024, stage classification from traits | China, vegetative stages | multispectral | random forest on cover, height, LAI, chlorophyll best | snippet, no accuracy |
| Peña et al. 2013 (corn.md) | Spain, early maize | 2 cm at 30 m | weeds by position relative to rows, R² 0.89 | position, not appearance |

Reading: counting is a V2 to V3 task at 1 cm or finer; cover tracking works at 1 to 1.5 cm through the season; height
from photogrammetry carries 10 to 25 cm error, which exceeds a seedling; no drone method infers V stage from cover
alone and the two stage classifiers found are snippet-only with unknown stage classes.

## 6. Variation

**Hybrids.** Final leaf number 16 to 23 (synthesis), earlier-maturing hybrids fewer; leaf angle differs by 20 to 30°
between upright and flat parents (Dzievit 2023) and modern hybrids are a few degrees more upright than 1980s ones
(snippet); "rigid" genotypes keep random leaf azimuth while plastic ones turn to the alley (snippet, leaf azimuth
papers). Leafy silage hybrids carry eight to nine leaves above the ear against five or fewer, with the ear set lower
(seed-industry and Canadian extension sources, snippet, not independently measured). **Sweet corn** stands shorter with
thinner leaves than grain corn ([MSU Extension](https://www.canr.msu.edu/news/sweet_corn_and_field_corn_what_are_the_differences), snippet);
Turkish cultivars 170 to 216 cm with 9 to 11 leaves and 0.13 to 1.5 tillers per plant (snippet); later plantings up to
23% taller and with fewer leaves in the north-central US ([HortScience 43:1775](https://journals.ashs.org/view/journals/hortsci/43/6/article-p1775.xml), snippet);
tillers are a sweet-corn feature that from above widens the plant at the base. **Popcorn**: not found. **Silage** is
grain corn or leafy hybrids at higher population; no separate morphology source found.

**Stress.** Nitrogen deficiency: V-shaped yellowing from the tip down the midrib of the oldest leaves first
([Iowa State IPM 42](https://www.agronext.iastate.edu/soilfertility/info/IPM42.pdf)); from above the lower leaves are
hidden after V8 so it reads as a paler canopy. Purpling: anthocyanin under cool wet soils, root injury or phosphorus,
starting on the oldest leaves, normally gone by V6; persistent purple margins on new leaves point to phosphorus
([Bayer, Purple Corn Seedlings](https://www.cropscience.bayer.us/articles/bayer/purpling-in-corn-seedlings); [MSU, Purple corn](https://www.canr.msu.edu/news/purple_corn)).
Purple V2 to V5 seedlings drop out of an ExG-type green mask. Drought: leaf rolling reduces canopy cover and exposes
sunlit soil in the thermal and visible image ([Zhang et al. 2019, Frontiers Plant Sci, maize UAV](https://www.frontiersin.org/journals/plant-science/articles/10.3389/fpls.2019.01270/full));
a midday flight on a hot day under-reads cover. Frost: plants regrow from the below-ground growing point and end two to
three stages behind the GDD estimate (Illinois 2015). Waterlogging mimics nitrogen chlorosis (Iowa State).

**Two cohorts.** Late emergers are "one or two leaves behind" and contribute little; a delay under two weeks between
cohorts costs 5% or less, half the stand three weeks late justifies replanting for about a 10% gain (Carter et al. 1992
via [Purdue AY-264-W](https://www.agry.purdue.edu/ext/corn/pubs/AY-264-W.pdf) and [UNL CropWatch](https://cropwatch.unl.edu/replanting-corn-things-do-and-think-about/));
5% loss when half the stand is 7 days late, 12% at two weeks ([Ontario Agronomy Guide](https://fieldcropnews.com/?p=20338)).
At one leaf per 3 to 4 days early, a one-week gap is about two leaves, so a replanted or unevenly emerged field shows
two plant sizes along the row (our reading); the field is staged by the 50% rule, and the image should report both.
Uniformity itself is measurable: Gao 2023 reports emergence-rate CV of about 16% between plots and cover CV of 8% at V6.

## 7. Gaps and uncertainties

- No US table of leaf length and width for leaves 1 to 8; only the first leaf (4 to 4.5 cm) and a European leaf-6 width
  (66 to 83 mm). Dwyer and Stewart 1986 not retrieved.
- No measured canopy width across the row or plant projected area in cm² by V stage from any US source; the per-plant
  areas above are back-calculated from Chinese cover and French pixel counts (our arithmetic).
- No canopy cover fraction by V stage for 30 in rows from imagery; the nearest are light interception at V6 and V10
  (NE US, Illinois) and Hall's leaf-area percentages. Row closure dates for 15 and 20 in corn not found (soybean figures
  only); Fresno State's "6 to 13 days earlier at 38 cm" is a snippet from California.
- Plant height between V8 (60 cm, Arizona; 91 cm, Bayer, a real disagreement) and V12 (over 120 cm) is unsourced.
- No validation of GDD stage estimates against observed stage with an error statistic; only the Illinois anecdote and the
  phyllochron ranges.
- No corn study of shadow length, sun angle or time of day on cover or counting.
- Stage classifiers from UAV imagery (MaizeHT, Agriculture 2024) are snippet-only; their stage classes and whether
  they cover V2 to V6 are unknown.
- Corn versus grass-weed separation at 1 to 5 cm has no published method; position and size are all that is sourced.
- Popcorn morphology, leafy-hybrid leaf dimensions and sweet-corn stage-by-stage heights were not found; sweet-corn
  tillers are sourced only from Turkey.
- Web-search budget ended before the Nafziger stage-by-stage interception table and the Iowa row-width defoliation
  study (V8 interception) could be read.

## 8. Parameter table for the profile

| Name | Value / range | Units | Stage | Geography | Source | Evidence |
|---|---|---|---|---|---|---|
| GDD method | base 50, cap 86, min floored at 50 | °F | all | US | Purdue heat units | strong |
| GDD planting to VE | 100 to 120 (115 ± 5 on soil GDD) | °F-days | VE | Indiana, Iowa, Ohio | Nielsen; ISU | strong |
| Days to VE | 4 to 7 warm; 10 to 12 at 60 °F; about 21 at 50 to 55 °F; up to 28 cold | days | VE | Iowa, Indiana, Arizona | ISU 2012; Nielsen; Arizona | strong |
| GDD per collar, VE to V10 | 82 to 84 (Hall 66) | °F-days per leaf | V1 to V10 | Corn Belt | Purdue; ISU via OSU; Hall | strong, one outlier |
| GDD per collar after V10 | 50 to 56 (Hall 48) | °F-days per leaf | V11 to VT | Corn Belt | Purdue; ISU; Hall | strong |
| Phyllochron spread across hybrids and sites | 42.5 to 77.9 around 57.9 (base 8 °C) | °C-days per leaf | to about leaf 10 | Iowa, Illinois, ND, Nebraska | synthesis 2022 | strong |
| Cumulative GDD V3 / V6 / V10 / VT / R6 | 346 to 414 / 520 to 612 / 826 to 940 / 1,350 to 1,528 / 2,650 to 2,953 | °F-days | | Corn Belt | OSU, Bayer, Hall, Purdue | strong, with spread |
| Days after seeding V3 / V6 / V10 / VT / R1 | 16 to 24 / 25 to 32 (46 to 50 after mid-April) / 37 to 49 / 65 to 72 / 69 to 76 | days | | Corn Belt, Indiana | Hall; Purdue 2006 | moderate |
| Leaf appearance interval | 3 to 4 d early; 2 to 3 d from V10; 1 to 2 d at V15 | days | | US | Penn State; Arizona; Ritchie | moderate |
| Total leaves | 18 to 21 typical; 16 to 23 range | leaves | VT | US | ISU; synthesis | strong |
| Lower leaves lost | first at V6; 2 by V8; 2 to 3 at V9; 3 to 4 at V12; 4 to 5 at V18 | leaves | V6+ | Iowa, Ohio | Ritchie; OSU; Pioneer | strong |
| Collar vs droopy offset | 1 to V5 or V6; 2 after 18 to 24 in | leaves | | Indiana | Nielsen | strong |
| Collar vs leaf-tip offset | 2 to V5; 4 at V8 to V10 | leaves | | Ontario, Manitoba | OMAFRA | moderate |
| Height V1 / V2 / V3 / V4 to V5 / V5 / V6 / V8 / V12 | 5 to 6 / 5 to 10 / 9 to 18 / 18 to 33 / 20 to 36 / 36 to 54 / 60 (or 91) / over 120 | cm | | Ontario, Arizona, Mississippi, Bayer | OMAFRA; az2199; MSU; Bayer | moderate, V8 disagrees |
| First leaf length | 4 to 4.5, rounded tip | cm | V1 | Mississippi | MSU | moderate |
| Leaf 6 base width | 6.6 to 8.3 | cm | V6+ | France, Mexico hybrids | Plants 2020 | moderate |
| Longest leaf | 62 at rank 9 (14-leaf); 88 at rank 16 (26-leaf); peak rank about 0.68 × N | cm | V12+ | France | Plants 2020 | moderate |
| Projected area per plant | 24 to 37 (V3, China); 70 to 230 (3 to 5 leaf, France); about 520 (V6, China) | cm² | V3 to V6 | China, France | Gao 2023; Velumani 2021; our arithmetic | moderate (derived) |
| Cover at V3 / V6 | 2.3% / 32% at about 62,000 live plants/ha; about 3% / 30 to 40% at 84,000/ha (estimate) | fraction | V3, V6 | Shanxi; scaled to US | Gao 2023; our estimate | moderate / estimate |
| Light interception V6 / V10 / R2, 30 in | 56% (NE US) / 70 to 84% / 98 to 99% | fraction | | NY, PA, Illinois | Weed Science 2021; Pioneer-Nafziger | strong |
| Interception at V10 by row width | 70% at 30 in, 80% twin, 83% at 15 in | fraction | V10 | Illinois | Pioneer-Nafziger | strong (vendor page) |
| Leaf area fraction by stage | 6, 10, 16 to 23, 31, 41, 50, 60, 69, 77, 84, 94% at V5 to V15 | % of final | | Corn Belt | Hall (Ritchie 1997) | moderate |
| Canopy closure, 30 in | V10 to V11 | stage | | Illinois, Nebraska | corn.md | strong |
| Closure advance at 38 cm rows | 6 to 13 days earlier than 76 cm | days | | California | Fresno State | snippet |
| In-row spacing at 26,000 to 38,000/a, 30 in | 14 to 20 | cm | | US | corn.md | arithmetic |
| Neighbours touch along the row | about V4 to V5; general overlap V6 | stage | | | our estimate from areas and counting literature | estimate |
| Leaf plane | alternate, one plane; random early; 40 to 70% near perpendicular to the row by 60 DAP | | V2 onward | Iowa | Ritchie; Zhou 2024 | strong |
| Leaf angle, upright vs flat parents | 80.6 vs 52.7 (one below flag), larger is more upright | degrees | V18+ | Iowa | Dzievit 2023 | strong (inbreds) |
| Counting GSD ceiling | 1 to 1.5 cm at V2 to V4; nothing published at 3 to 5 | cm per pixel | V2 to V4 | France, China, Ohio | Velumani; Gao; Katari | strong |
| Counting stage window | V2 to V3 best; V4 to V6 overlap | stage | | | Sensors 2021 (snippet); Gao; YOLOv9 (snippet) | moderate |
| Resolvability of a V3 plant | 25 to 230 px at 1 cm; 3 to 25 at 3 cm; 1 to 9 at 5 cm | pixels | V3 | | our arithmetic from Gao and Velumani | estimate |
| Photogrammetric height error | 10 to 39 cm RMSE (RTK 3.6 to 3.9 cm MAE in corn.md) | cm | all | Minnesota, Beijing | UMN 2020; Beijing 2019 | strong |
| GDD estimate error | about 1 leaf normal; 2 to 3 leaves after frost or stress | leaves | V3 to V10 | Illinois, Indiana | Illinois 2015; Nielsen; our reading | weak (no validation study) |
| Two-cohort gap | 1 week about 2 leaves; under 2 weeks costs under 5% yield | leaves, % | V2 to V6 | Nebraska, Indiana, Ontario | UNL; Purdue AY-264-W | moderate |
| Emergence uniformity CV between plots | about 16% emergence, 8% cover at V6 | % | V3, V6 | Shanxi | Gao 2023 | moderate (one site) |
| Purpling window | V2 to V5, gone by V6 | stage | | Michigan, Midwest | Bayer; MSU | moderate |
| Shadow length | height / tan(sun elevation): 17 to 52 cm for a 30 cm plant at 60° to 30° | cm | | | our arithmetic | estimate |
