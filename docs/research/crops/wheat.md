# Wheat (US): what grading weeds from the air has to work with

Research of 2026-10-22, US only. Wheat is the hardest of the four crops for a cover grade between rows: the rows are
drilled about 19 cm apart, the plants cannot be told apart, most of its worst weeds are grasses inside a grass crop,
and the canopy covers most of the ground by the time weeds matter in spring. What follows is what the literature
supports and where it stops. Figures marked "(snippet)" were seen in a search result or abstract and not read in the
full source; treat them as leads. Our own estimates are labelled as such.

## A. The planting, as it appears from the air

**Row spacing.** US wheat is drilled, mostly at 7 to 8 in. The Kentucky Wheat Guide says "the most practical row widths
are normally 7 to 8 inches" and recommends 4 to 8 in, with region-wide research showing 5 to 10% more yield at 4 in than
8 in and losses above 10 in ([Kentucky ID-125, rev. 10-2025](https://publications.mgcafe.uky.edu/sites/publications.ca.uky.edu/files/ID125_0.pdf)).
In eastern Kansas "traditional" drills are 7.5 in, 7.5 to 10 in is standard, and some growers now plant at 15 in with
row-crop planters, which cost 11.7 to 18.5 bu/a against 7.5 in in two seasons and raised henbit emergence about 3.5
times ([Shoup and Adee, K-State Report of Progress 1084](https://ksu.janeway.systems/kaesrr/article/10875/galley/10771/download)).
Nebraska recommends 10 to 14 in for dryland western Nebraska and 6 to 8 in for irrigated or late-seeded wheat
([UNL CropWatch, Klein](https://cropwatch.unl.edu/2019/determining-seeding-rate-winter-wheat/)). Pacific Northwest
deep-furrow drills run 16 to 18 in ([Schillinger and Wuest, USDA-ARS](https://www.ars.usda.gov/ARSUserFiles/6233/wideRowSpacing.pdf), snippet).
The only grower survey found is Ohio's, where 8 in or less is predominant ([2022 Ohio Agronomic Crop Production Survey](https://agcrops.osu.edu/sites/agcrops/files/imce/Resources/2022%20Ohio%20Agronomic%20Crop%20Production%20Survey%20Report.pdf), snippet).
No national share of acres by row spacing was found, and nothing for Northern Plains air seeders.

So the US spread is roughly 6 to 10 in in most regions, 10 to 14 in in the dry western Plains, 15 in where planters are
used, and 16 to 18 in on PNW deep-furrow ground. Every one of these is narrower than any corn, soybean or cotton row
except drilled soybean, which is the basis for telling wheat apart in [estimating-from-upload.md](estimating-from-upload.md).

**Plants and population.** Kansas seeds 750,000 to 900,000 seeds/a in the west, 0.9 to 1.25 million in central Kansas
and up to 1.35 million in the east or under irrigation ([K-State eUpdate](https://eupdate.agronomy.ksu.edu/article/optimum-sowing-dates-and-seeding-rates-for-wheat-in-kansas-592-1), snippet).
Kentucky targets 25 plants/ft² (about 270/m²) from 35 to 40 seeds/ft² (ID-125). At 25 plants/ft² in 19 cm rows a plant
stands about every 2 cm along the row (our arithmetic). No individual wheat plant is resolvable at 1 to 5 cm a pixel; our
earlier survey put that at under 0.4 mm a pixel ([row-crop-detection-methods.md](../row-crop-detection-methods.md)).

**Rows from the air.** A 19 cm row period is 19 pixels at 1 cm, 9.5 at 2 cm, 6.4 at 3 cm and 3.8 at 5 cm (our
arithmetic). A seedling row is a stripe one to two centimetres wide, so at 3 to 5 cm a pixel it is a sub-pixel line
smeared into mixed pixels. No study measuring row visibility by stage and pixel size was found. Our estimate: rows are
readable from emergence through tillering at 1 to 3 cm, marginal at 5 cm, and gone at every resolution once the canopy
closes. That last point is supported: in mature wheat at 3.2 cm a pixel "crop rows are not discernible"
([Lambert et al. 2018, Weed Research](https://pmc.ncbi.nlm.nih.gov/articles/PMC5832304/)).

**Canopy closure.** Wheat covers the ground early. K-State's Canopeo guidance for grazed Southern Plains wheat treats 60
to 100% green cover as optimal in late fall and 70 to 100% at first hollow stem ([K-State MF3304](https://bookstore.ksre.ksu.edu/pubs/MF3304.pdf),
from Butchee and Edwards 2013, Oklahoma). A North Carolina study described soft red winter wheat as near canopy closure
about 120 days after planting, in mid-February ([Sanders et al. 2021, Frontiers in Agronomy](https://www.frontiersin.org/journals/agronomy/articles/10.3389/fagro.2021.687112/full)).
No measured cover-by-stage curve for ungrazed US wheat was found. The consequence for us is direct: the "visible ground
between rows" that our cover metric divides by is small from late fall and close to nothing after jointing.

**Field geometry.** Tramlines are used in US soft red winter wheat under intensive management, made by blocking drill
spouts and matched to the sprayer boom, "most sprayer tramlines are 80 ft or larger" (ID-125). A tramline is an
unplanted pair of tyre tracks, about 12 to 16 in wide per track ([Cornell/Alabama fact sheet](https://nydairyadmin.cce.cornell.edu/uploads/doc_86.pdf), snippet),
which a row reader will see as a gap or a wide row and a cover grade will see as bare ground. No evidence of tramlines in
Plains or PNW wheat was found. Headlands, terraces and contour drilling in the Plains, pivots and broadcast seeding were
not covered by any source found in this session.

## B. Growth stages, and what each looks like from above

**Staging.** Feekes (1 to 11) and Zadoks (two-digit) are both used. Feekes 2 is tillering, Feekes 6 is first node or
jointing, 10.1 is heading begins, 10.5.1 flowering ([SDSU Extension, growth stages of wheat](https://extension.sdstate.edu/growth-stages-wheat), snippet).
Kansas hard red winter wheat is planted in October, goes dormant in mid-December (MF3304), reaches first hollow stem in
early to mid-March ([K-State eUpdate, first hollow stem](https://eupdate.agronomy.ksu.edu/article/wheat-growth-and-development-tool-for-estimating-first-hollow-stem-534-2), snippet),
heads from mid-April to late May depending on the year (USDA NASS crop progress), and is harvested in June (K-State
Report 1084). Kentucky plants from 10 to 30 October and asks for weed scouting in early October, mid to late November,
early March to early April before jointing, and late May to early June (ID-125).

**Ground cover by stage.** The only US cover-by-stage figures are the grazed-wheat ones above: at least 53% green cover
before dormancy and 62% at first hollow stem kept 95% of grain yield (MF3304). The same publication gives 60 and 70% as
the floors of its "optimal" bands, so the two numbers inside one document disagree; both are given here. These are
thresholds for grazing management, not a growth curve.

**Critical period of weed control.** US wheat work is species by species and mostly expressed as emergence timing.
For Italian ryegrass in no-till soft red winter wheat in North Carolina, the critical period for a 5% loss ran from
1,100 to 1,900 growing degree days, at ryegrass densities of 292 to 824 plants/m² that cost over 60% uncontrolled
([Contreras et al. 2025, Weed Technology](https://complete.bioone.org/journals/weed-technology/volume-39/issue-1/wet.2024.105/Critical-period-for-Italian-ryegrass-Lolium-perenne-L-spp-multiflorum/10.1017/wet.2024.105.full), abstract).
In Kansas, annual bromes emerging within a week of the wheat cut yield 9 to 36% depending on density, while downy brome
emerging three to four weeks after the wheat cost only 1 to 5% even at 180 to 190 plants/yd²; cheat stayed damaging at
9 to 16% ([Stahlman 1986, K-State](https://journals.newprairiepress.org/kaesrr/article/7403/galley/7335/download/)).
NDSU says treating foxtail in spring wheat "may not be warranted" when it emerges after the crop's 3 to 4 leaf stage
([North Dakota Weed Control Guide W253-24](https://www.ndsu.edu/agriculture/sites/default/files/2024-01/229704_WeedGd_ColorCV.pdf)).
The common thread is that weeds emerging with the crop in the fall do the damage and late emergers do little, with
cheat and ryegrass as exceptions. No single critical period for US wheat exists in the literature found.

**Stage from the imagery.** Only cover has published support (Canopeo is an RGB method), and heads become detectable at
heading ([Global Wheat Head Detection](https://arxiv.org/pdf/2005.02162)). No quantified US source on estimating wheat
stage from UAV height was found. In practice the calendar plus region narrows the stage more than the imagery does.

## C. Action thresholds practitioners actually use

**A US cover threshold exists, and it is not ours.** The Kentucky Wheat Guide is the only current US source found that
grades wheat weeds by cover: rate total weed ground cover in the fall, averaged over survey sites, as light (<5%,
"probably no economic benefit to treat"), moderate (5 to 30%, treatment "may or may not be justified") or severe (>30%,
treatment "may be justified if implemented in a timely manner"), with the note that light Italian ryegrass may still be
worth treating to limit seed spread, and that "economic thresholds for weeds in wheat are not well defined" (ID-125,
Table 6-2). Two differences matter for us: its denominator is all the ground, not the visible ground between rows, and
it is a fall assessment. An older Delaware and Maryland field guide rates early-spring winter-annual cover as few
(<10%), light, moderate, heavy and severe (>60%) with no action attached, and gives annual ryegrass a threshold of 1 to
2 plants/ft² ([Delaware/Maryland Winter Wheat IPM Field Guide](https://projects.sare.org/media/pdf/W/h/e/Wheat-IPM-Insect-Disease-Field-Guide-for-DE.pdf), 1990s).

**Most US guidance is in plants per area.**

| Weed | Density and loss | Source |
|---|---|---|
| Italian ryegrass | 1 plant/ft² (about 11/m²) costs about 4% | Kentucky ID-125 |
| Italian ryegrass | 15 plants/ft² (about 161/m²) about 20% and a 9 cent/bu discount | [OSU PSS-2791](https://extension.okstate.edu/fact-sheets/herbicide-programs-for-italian-ryegrass-control-in-winter-wheat.html), snippet |
| Cheat, feral rye, ryegrass, jointed goatgrass, wild oat | at 89 to 170 plants/m²: 19%, 55%, 20%, 21%, 28% loss | [Fast, Medlin and Murray 2009, Weed Technology](https://www.cambridge.org/core/journals/weed-technology/article/abs/five-coolseason-annual-grass-weeds-reduce-hard-red-winter-wheat-grain-yield-and-price/20A8DBD0745BB3191097D4F8CE51BF88) |
| Wild oat (spring wheat) | 10 plants/yd² 8 to 9%, 100/yd² 34%; "any population warrants chemical control" | NDSU W253-24 |
| Foxtail (spring wheat) | not warranted under 30 plants/ft², warranted over 100/ft² | NDSU W253-24 |
| Henbit (Missouri) | none at 18/m², 13% at 82/m², 38% at 155/m² | [Conley and Bradley 2005, Weed Technology](https://www.cambridge.org/core/journals/weed-technology/article/abs/wheat-triticum-aestivum-yield-response-to-henbit-lamium-amplexicaule-interference-and-simulated-winterkill/684352C21F5C7BC311F6548E1E97C895), abstract |
| Russian thistle (Washington) | 0.5 to 0.6% loss per 1% of total biomass | [Young, Weed Science](https://resolve-he.cambridge.org/core/journals/weed-science/article/effect-of-russian-thistle-salsola-iberica-interference-on-spring-wheat-triticum-aestivum/7FFA162EB5EB59771D1E81D944957205), abstract |
| Kochia | "a few uncontrolled plants can cause severe yield loss"; no US density figure found | NDSU W253-24 |

The Russian thistle relation is the one closest to a cover metric, since it is a share of biomass rather than a count.

**Timing windows.** Growth-regulator herbicides (2,4-D, MCPA) go on after tillering and before jointing, Feekes 3 to 6,
with severe injury likely at Feekes 9 to 10 ([Texas A&M AgriLife](https://agrilife.org/texasrowcrops/2020/02/07/guidelines-for-24-d-use-in-wheat/), snippet).
NDSU prefers fall treatment of fall-emerged bromes, and says relying on spring herbicides is "not recommended" because
the bromes "will still produce seed" (W253-24). The practical window for acting on what a spring flight sees therefore
closes at jointing.

**Programme context.** Pyroxasulfone pre-emergence gave at least 97% Italian ryegrass control in Oklahoma in 2016-17,
less under heavy straw without rain ([SASES poster](https://scisoc.confex.com/scisoc/2017am/webprogram/Handout/Paper107231/SASES_ResearchPoster2.pdf), snippet).
How a recently sprayed wheat field looks from the air was not found. Group 1 and Group 2 grass herbicides act slowly,
so sprayed weeds probably stay green for one to three weeks (our estimate, unsourced), which means a flight shortly
after spraying will count weeds that are already dead.

**What our code uses today, and what US guidance gives instead.** `schemeFor` in `grade.ts` grades cereals with
German cover thresholds (act at 9% for wheat, 5% for barley; Gesunde Pflanzen 2014), and its wide-row and orchard
classes come from the Turkish ministry (TAGEM 2022). Neither is US. The US equivalent for wheat is Kentucky's fall
total-cover bands (<5 / 5 to 30 / >30%), which sit on a different denominator, plus species density thresholds and a
before-jointing window. The cereal scheme needs replacing, and the denominator question needs settling in the design
session before any number is copied across.

## D. The weeds themselves

**Dominant weeds by region.** Southern Plains: cheat, feral rye, Italian ryegrass, jointed goatgrass and wild oat all
cut yield (Fast 2009), and Italian ryegrass is the headline because of resistance (OSU). Eastern Kansas: henbit,
Carolina foxtail, smallflowered bittercress, common chickweed (K-State Report 1084). Northern Plains: in a North Dakota
survey of spring wheat, durum and barley, green foxtail was in 57% of fields, wild oat in 54% and kochia in 41%
([Zollinger et al., NDSU](https://www.ag.ndsu.edu/Weeds/survey-pubs/WS-00-Intro.pdf), snippet), with Russian thistle
and wild buckwheat as listed targets. Pacific Northwest: downy brome and Italian ryegrass. Soft red winter region:
Italian ryegrass first, then common chickweed, purple deadnettle, henbit, wild garlic, field pennycress, shepherd's
purse and marestail (ID-125).

**Resistance.** Italian ryegrass in Oklahoma: a later OSU survey found resistant ryegrass in 19 of 32 counties, 77% of
populations resistant to at least one of quizalofop, imazamox or glyphosate ([OSU wheat report 2025](https://agresearch.okstate.edu/research/wheat-report/2025/herbicide-resistance-detection-in-weedy-grasses-across-the-wheat-producing-counties-in-oklahoma), snippet).
Kochia in North Dakota: "all kochia is considered ALS resistant", with Group 4, 9 and (since 2023) 14 resistance
(W253-24); in western Kansas, cross-resistance to dicamba and fluroxypyr ([Weed Technology first report](https://resolve.cambridge.org/core/journals/weed-technology/article/abs/first-report-of-kochia-bassia-scoparia-with-crossresistance-to-dicamba-and-fluroxypyr-in-western-kansas/2D9B100311A8B8AA73599F33FED7B025), abstract).
Wild oat and green foxtail in North Dakota: Group 1 and 2 resistance (W253-24). Downy brome in eastern Oregon: 81% of 21
populations resistant to mesosulfuron in 2021 ([WSU monitoring](https://wpcdn.web.wsu.edu/cahnrs/uploads/sites/16/Herbicide-Resistance-Monitoring-in-Eastern-Washington-Wheat-2.pdf), snippet).

**What RGB at our resolution can and cannot see.** Plainly: RGB at 1 to 5 cm a pixel cannot reliably separate grass
weeds from vegetative wheat. The US evidence is Italian ryegrass in North Carolina wheat at 1.0 and 3.1 cm a pixel,
where RGB-only classification ran under 30% in one year and 68 to 70% in the other, while filtered multispectral data
reached 83 to 99%; two-class accuracy was 64 to 78%, and models did not transfer between flights because reflectance
shifted with the light (Sanders 2021). UK blackgrass work agrees: at maturity and 3.2 cm, RGB density against pixel
value gave R² 0.29 (red edge 0.41) and models transferred between fields at a mean r of 0.34 (Lambert 2018); across 102
fields at 8.3 cm a convolutional network managed AUC 0.78 to 0.83 within a field but 0.54 leave-one-field-out, "often
no better than random" ([Lambert et al. 2019, Pest Management Science](https://pmc.ncbi.nlm.nih.gov/articles/PMC6767585/)).
Where grass weeds have been separated in wheat it was late in the season, by colour as they ripen at a different time
(overall accuracy 0.85 to 0.90; [Weed Science, late-season grass weed patches](https://resolve.cambridge.org/core/journals/weed-science/article/abs/using-remote-sensing-for-identification-of-lateseason-grass-weed-patches-in-wheat/89A1E96CFFEDF3923952DFDE0B7EC66A), abstract),
which is after the time to act.

Broadleaf weeds in wheat (henbit, chickweed, pennycress, kochia, Russian thistle) have a different shape and texture
from the crop. No US drone study of them was found. A Swiss study of narrow-row wheat at nine farms found crop-versus-
weed object classification fell from 0.88 on ground images to 0.72 on drone images from 10 m, stressing resolution
([ETH Zurich research collection](https://www.research-collection.ethz.ch/items/602fe545-b883-4985-8107-fd6b0315fa21), snippet).
Our estimate: broadleaf rosettes at least four pixels across are separable at 1 to 2 cm before the canopy closes,
patches only at 5 cm, and nothing under the canopy after closure.

**Escapes.** NDSU warns that downy brome sprayed in spring "will still produce seed", and Kentucky notes warm-season
weeds (giant and common ragweed, johnsongrass, marestail) can be green at harvest (ID-125). No measurements were found
of how far kochia, wild oat panicles or ryegrass heads rise above the wheat, or of their seed per plant in US wheat.

## E. What the imagery must be

Pixel size, from the geometry above and the four-pixel rule for the smallest object (at least 4 pixels across;
[Peña et al. 2015, Sensors](https://pmc.ncbi.nlm.nih.gov/articles/PMC4435221/)):

| Task | Pixel size needed | Basis |
|---|---|---|
| Find 19 cm drill rows | 1 to 3 cm, before closure only; 5 cm is marginal | our estimate from the row period |
| Cover between 19 cm rows | 1 to 2 cm, fall to green-up only; not meaningful at 5 cm (a 3 px gap) or after jointing at any size | our estimate; MF3304 cover levels |
| Detect a 4 cm weed seedling | 1 cm | 4 px rule (Peña 2015) |
| Grass weed from wheat | not achieved in RGB at 1 to 5 cm; multispectral or late-season colour | Sanders 2021, Lambert 2018 and 2019 |

On a DJI Mavic 3 Multispectral the RGB camera (4/3 in, 5280 px wide, 84 degree field of view) gives roughly one
centimetre a pixel per 37 m of height, so 1 cm at about 37 m, 2 cm at 73 m and 3 cm at 110 m; the multispectral camera
is about 5.5 cm a pixel at 120 m (our arithmetic from the [DJI Mavic 3M specifications](https://enterprise.dji.com/mavic-3-m/specs);
the standard formula is in the [Pix4D GSD article](https://support.pix4d.com/hc/en-us/articles/202559809-Ground-sampling-distance-GSD-in-photogrammetry)).
The North Carolina ryegrass study flew at 15 and 45 m and found altitude in that range made no significant difference;
it advises clear skies at midday because reflectance shifts with light broke models between flights (Sanders 2021).
No study was found on wind or lodging in drone weed mapping of wheat.

**Multispectral and height.** For grass weeds in wheat, multispectral is what made the difference in the one US study
(near-infrared at 840 nm was the only band where weed density changed reflectance significantly, Sanders 2021), and red
edge beat RGB for blackgrass (Lambert 2018); against that, a 34-field UK blackgrass study found near-infrared added
little and resolution mattered most ([Comont, BCPC 2023](https://www.bcpc.org/wp-content/uploads/2023/11/8-Comont-BCPC-2023-Weeds-Final-compressed.pdf), slides).
The sources disagree. No quantified study of height (DSM) for grass weeds in wheat was found.

## What this means for us

Wheat does not fit a between-row cover grade after late fall: the denominator shrinks to nothing, the worst weeds are
grasses RGB cannot separate, and the US cover guidance that exists is a whole-ground fall rating. What RGB can
plausibly do in wheat is measure total green cover in the fall at 1 to 2 cm, find broadleaf weed patches before the
canopy closes, and find grass patches by colour near maturity for next year's map. Anything finer needs multispectral
or a different question.
