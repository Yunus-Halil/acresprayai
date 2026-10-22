# Cotton (US): what grading weeds from the air has to work with

Research of 2026-10-22, US only. Cotton has the widest rows of the four crops and the slowest, least complete canopy, so
the ground between rows stays visible for weeks longer than in corn or soybean and in dryland West Texas may never be
covered. It also has the most demanding weed: Palmer amaranth, for which much of US guidance is zero tolerance rather
than any threshold. Figures marked "(snippet)" were seen in a search result or abstract and not read in the full source.
Our own estimates and arithmetic are labelled.

## A. The planting, as it appears from the air

**Row spacing.** Conventional US cotton is planted in 38 to 40 in (97 to 102 cm) rows. In the Mississippi Delta it
sits on 102 cm beds; twin rows are two rows 38 cm apart on a 102 cm bed; narrow rows are 38 cm; hooded and post-directed
spraying and cultivation are impossible in narrow rows ([Reddy and Boykin 2010, Weed Technology](https://ars.usda.gov/ARSUserFiles/60663500/Publications/Reddy/Reddyetal10WT24-95-101.pdf)).
West Texas dryland cotton has used 40 in rows with a 2x1 skip (two rows planted, one left bare), though "many producers
[are] tending toward solid planting" since glyphosate-tolerant varieties ([Boman et al., Beltwide 2009](https://www.cotton.org/beltwide/proceedings/2005-2022/data/conferences/2009/papers/9329.pdf)).
Fifteen-inch spindle-picked cotton was about 20,000 acres in 2005 and 40,000 in 2006
([Farm Press 2006](https://www.farmprogress.com/cotton/productive-15-inch-spindle-picked-cotton-gaining-broader-interest), snippet),
and ultra-narrow rows were never widely adopted. Thirty-inch cotton is used in South Texas
([Beltwide 2011](https://www.cotton.org/beltwide/proceedings/2005-2022/data/conferences/2011/papers/11872.pdf)). No
national survey of cotton row spacing or skip-row acreage was found.

**Plants and population.** Mississippi State targets 40,000 to 45,000 plants/a, about 3 to 4 live plants per foot of
row at 38 to 40 in ([Mississippi State Extension](https://extension.msstate.edu/agriculture/crops/cotton/what-the-recommended-seeding-rate-for-cotton));
Tennessee and Florida plan on 1.5 to 3 per foot ([UT Crops News](https://news.utcrops.com/2025/05/step-one-of-the-cotton-cost-cutting-challenge),
[UF EDIS AG200](https://edis.ifas.ufl.edu/publication/AG200/pdf), snippets). That is 7.6 to 15 cm between plants along
the row (our arithmetic).

**Is a plant resolvable at 1 to 5 cm a pixel?** Not as individual plants. Cotton seedling counting has been done at 3.3 mm
a pixel (20 m) and 7 mm a pixel (15 m); at 3.3 mm, detection fell to F1 54.5% on bright dry soil against 100% on dark
wet soil, and the authors say deep-learning stand counts "typically require" flights at 10 m or lower
([Lin and Guo 2021, Remote Sensing](https://mdpi-res.com/d_attachment/remotesensing/remotesensing-13-02822/article_deploy/remotesensing-13-02822.pdf)).
At 5 cm a pixel, plants 7.6 to 10 cm apart are 1.5 to 2 pixels apart (our arithmetic). The row, though, is easy: a 97 cm
row period is about 19 pixels even at 5 cm, and crop rows were found 100% of the time up to 3.8 cm (RGB) and 5.4 cm
(multispectral) in Peña's sunflower work ([Peña et al. 2015, Sensors](https://pmc.ncbi.nlm.nih.gov/articles/PMC4435221/)).
The first true leaf appears about 7 days after emergence ([UGA Bulletin 1252, Cotton Growth and Development](https://cotton.tamu.edu/wp-content/uploads/sites/27/legacy-files/General%20Production/Georgia%20Cotton%20Growth%20and%20Development%20B1252-1.pdf));
leaf sizes in millimetres were not found.

**Canopy closure.** Slow, and in wide dryland rows sometimes never. Irrigated at Stoneville, Mississippi, 102 cm single
rows were 33% closed 7 weeks after planting, 60% at 9 weeks and 100% at 13 weeks; twin rows were 52%, 90% and 100% at 11
weeks (Reddy and Boykin 2010). In the Texas Brazos Bottoms, 30 and 40 in rows were under 30% closed at match-head square
and under 70% at early bloom, while 7.5 in rows approached 100% by early bloom
([Beltwide 1999](https://www.cotton.org/beltwide/proceedings/1999/abstracts/324.cfm)). Another Beltwide study found closure
"never attained in the conventional row spacings" ([Beltwide 1998](https://www.cotton.org/beltwide/proceedings/1998/abstracts/584.cfm)).
For us this means cotton is the crop where between-row cover stays measurable longest, often into bloom, and a skip row
never closes by design.

**Field geometry.** Raised beds and furrow irrigation in the Delta, skip rows in the West Texas dryland, terraces and
pivots on the High Plains. No quantified source on terraces, pivots or rolled-rye cover-crop residue in cotton was found.
A skip row will read to a row reader as a missing row and to a cover grade as a wide bare alley; the design session has to
treat 2x1 skip as a known pattern (two rows at 40 in, then 80 in).

## B. Growth stages, and what each looks like from above

**Staging.** Cotton is staged by main-stem nodes, squaring, flowering and nodes above white flower (NAWF), with cutout at
5 NAWF. Georgia's table, in heat units (DD60) and days after planting: emergence 50 DD60 and 4 to 14 days; pinhead
square 550 and 35 to 45 days; first bloom 940 and 55 to 70 days; peak bloom 1,700 and 85 to 95 days; first open boll
2,150 and 115 to 120 days; harvest 2,500 to 2,700 and 140 to 160 days ([UGA Circular 1244](https://fieldreport.caes.uga.edu/publications/C1244/cotton-growth-monitoring-and-pgr-management/)).
The National Cotton Council gives a new node about every 50 DD60 (about 3 days), emergence to first square 27 to 38 days,
planting to first flower 60 to 70 days, and leaf area index under 0.01 at emergence and about 1 at pinhead square, with
full light interception at about 3 ([Cotton Physiology Today, May 2007](https://www.cotton.org/tech/physiology/cpt/plantphysiology/upload/Growth-and-Development-First-60-Days.pdf)).
The sources disagree by up to ten days on first square and first bloom, as the ranges show.

**Ground cover by stage.** No US cover-by-stage table was found; the closure series above is the nearest thing. A
Louisiana thesis puts about 80% cover at first flower ([LSU](https://repository.lsu.edu/gradschool_theses/3257), snippet),
which disagrees with the 60% at 9 weeks in Mississippi single rows.

**Critical period of weed control.** US sources give it in weeks after emergence, and for Palmer amaranth in days or crop
leaves:

- Alabama (Buchanan and Burns 1970): maximum yield when kept weed-free about 8 weeks after emergence, with first control
  delayable 4 to 7 weeks ([Weed Science](https://www.cambridge.org/core/journals/weed-science/article/influence-of-weed-competition-on-cotton/0D8AD5BADADEBA3FEEE58974EBBDBF71), abstract).
  A follow-up gave 6 weeks in one year and 8 in two others (snippet).
- Palmer amaranth: delaying removal from 0 to 21 days after emergence raised lint loss from 0 to 3%, and from 21 to 63
  days from 3 to 77%; the critical removal time was 19 days after emergence at a 2.7% loss threshold
  ([Fast et al. 2009, Journal of Cotton Science](https://www.cotton.org/journal/2009-13/1/32.cfm)).
- Palmer amaranth in Georgia: eliminate it before cotton has 12 leaves; plants establishing at 12 or 17 leaf cotton had
  no yield effect ([MacRae et al., Journal of Cotton Science 17:227](https://journal.cotton.org/?p=2506)).
- Extension rule of thumb: weed-free for the first 4 to 6 weeks ([Mississippi Crops](https://www.mississippi-crops.com/2012/05/04/timing-critical-for-postemergence-herbicide-applications/), snippet).
  Texas A&M's production chapter says "first 6 weeks" in one place and "first 10 weeks after planting" in another
  ([Texas Cotton Production, chapter 5](https://cotton.tamu.edu/wp-content/uploads/sites/27/legacy-files/General%20Production/texascottonproduction/pdf/chapter5.pdf)).

So the US window is roughly the first 6 to 8 weeks after emergence, with Palmer amaranth costing yield from about three
weeks and mattering until about the 12 leaf stage.

**Stage from the imagery.** Cotton height from drone photogrammetry is the best of the four crops: r² 0.89 and 0.94 in
Texas ([Maeda et al., Beltwide 2018](https://www.cotton.org/beltwide/proceedings/2005-2022/data/conferences/2018/papers/18440.pdf)),
R² 0.92 nadir and 0.96 oblique at 2.95 to 3.54 cm RMSE ([Drones 2024](https://doaj.org/article/907414ed4a544a8abf149c714b9514c5), snippet).
RGB and NDVI canopy cover agreed at r² 0.99 until leaves yellowed, about 90 days after planting (Maeda). Node counts and
NAWF cannot be read from nadir RGB at 1 to 5 cm (our estimate). Stage would come from planting date and heat units, with
height and cover as checks.

## C. Action thresholds that practitioners actually use

**No US cover-percentage threshold for cotton weeds was found.** US guidance uses three other currencies.

*Density per length of row.* Palmer amaranth in 38 in Texas cotton cost 11% of yield at one plant per 30 ft of row, 27%
at four, 38% at six and 59% at ten ([Texas A&M, Palmer Amaranth: Big Cotton Competitor](https://cotton.tamu.edu/wp-content/uploads/sites/27/legacy-files/Weeds/palmeramaranth.pdf));
the journal version gives 13 to 54% for one to ten plants per 9.1 m ([Morgan, Baumann and Chandler 2001, Weed Technology](https://bioone.org/journals/weed-technology/volume-15/issue-3/0890-037X(2001)015%5B0408%3ACIOPAA%5D2.0.CO%3B2/Competitive-Impact-of-Palmer-Amaranth-Amaranthus-palmeri-on-Cotton-Gossypium/10.1614/0890-037X(2001)015[0408:CIOPAA]2.0.CO;2.short)).
In Georgia, about 6% loss per Palmer plant per 6.1 m of row when established at 3 or 8 leaf cotton, up to 60% (MacRae).
One Palmer plant per metre of row is therefore a loss of roughly 40 to 50% (our arithmetic).

*Weed height.* Treat Palmer before it passes 3 in (Georgia; [UGA 2025 Cotton Weed Control](https://site.extension.uga.edu/applingcrop/files/2025/05/2025-Cotton.pdf)),
1 to 4 in for early post in Arizona ([Arizona AZ2206, 2026](https://extension.arizona.edu/sites/default/files/2026-07/az2206-controlling-palmer-amaranth-az-cotton.pdf)),
and 4 in or less on dicamba labels.

*Zero tolerance.* Arkansas's programme aims to stop all Palmer seed production for three to four years: 75 to 80% of
seed is lost over the first winter and the seedbank is nearly exhausted in four years without new input; glyphosate-
resistant Palmer from 1 m² spread over more than 20% of a field in under two years; seedheads 14 days old can carry
viable seed ([UA FSA2177](https://www.uaex.uada.edu/publications/pdf/FSA2177.pdf)). Under zero tolerance a single Palmer
plant is an action, whatever the cover.

**Programme context.** Georgia's current programme: weeds removed before planting, two Palmer-effective residuals at
planting (over 90% season-long control, 99% for two to three weeks), a first post pass 15 to 17 days later and a second
15 to 17 days after that before 9 leaf cotton, treating before weeds pass 3 in, then a directed layby; overlapping
residuals continue to canopy closure (UGA 2025). Over-the-top dicamba was re-registered on 6 February 2026 for 2026 and
2027 only, at most two applications and 1.0 lb/a a year ([Minnesota Department of Agriculture](https://www.mda.state.mn.us/pesticide-fertilizer/dicamba);
[Texas A&M AgriLife](https://agrilifeextension.tamu.edu/wp-content/uploads/2026/02/2.9.26.pdf)). A cotton field is
therefore usually under a residual for its first five to seven weeks, and the weeds a flight finds then are escapes from
it. How a freshly sprayed cotton field looks was not found with a source; contact products (glufosinate, paraquat) brown
weeds within days, glyphosate and auxins act more slowly, so a flight soon after spraying can count dead weeds as live
(our estimate).

**What our code uses today, and what US guidance gives instead.** `schemeFor` in `grade.ts` grades cotton as a wide-row
crop with the Turkish ministry's 10% cover action point (TAGEM 2022 lists 10% for broadleaf and 15% for grass weeds in
cotton; the grass branch is switched off in the code), and our earlier research used a Turkish critical period of 15 to
60 days after emergence. Neither has a US counterpart in cover. US cotton guidance is density per row length, weed
height under about 3 to 4 in, a weed-free window of about 6 to 8 weeks with Palmer removed by about 19 to 21 days after it
emerges, and zero tolerance for Palmer amaranth. The 10% figure needs replacing, and for Palmer the design session should
consider whether any presence, rather than any cover, is the trigger.

## D. The weeds themselves

**Dominant weeds.** Palmer amaranth is the most troublesome weed in US cotton in the 2022 and 2025 WSSA surveys
([AgWeb](https://www.agweb.com/news/crops/crop-production/worst-weeds-ranked), snippet). Across 14 southern states,
morningglories and nutsedges were in the top five in both 1995 and 2009, with Palmer amaranth, pigweeds and Florida pusley
joining by 2009 ([Webster and Nichols 2012, Weed Science](https://complete.bioone.org/journals/weed-science/volume-60/issue-2/WS-D-11-00092.1/Changes-in-the-Prevalence-of-Weed-Species-in-the-Major/10.1614/WS-D-11-00092.1.full), abstract).
In 400 Texas fields in 2016 and 2017, the top late-season escapes were Palmer amaranth, Texas millet, waterhemp, ragweed
parthenium and barnyardgrass ([Werner et al. 2020, PLoS ONE](https://pmc.ncbi.nlm.nih.gov/articles/PMC7279589/)). Georgia
flags goosegrass, nutsedge and tropical spiderwort as rising (UGA 2025). Waterhemp is replacing Palmer in some
Tennessee fields, with dicamba resistance confirmed there in 2021 ([UT Crops News](https://news.utcrops.com/2021/11/dicamba-resistant-waterhemp-confirmed-in-tennessee)).

**Resistance.** Palmer amaranth in the US carries resistance to nine sites of action (groups 2, 3, 4, 5, 9, 10, 14, 15
and 27); glufosinate-resistant accessions from eastern Arkansas resist seven post-emergence sites, and only paraquat gave
over 90% control ([Carvalho-Moore et al. 2025, Weed Technology](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/BB38267CBFA44F9F61E72AF017C9C184/S0890037X25000089a.pdf/resistance-profile-of-glufosinate-resistant-palmer-amaranth-accessions-and-herbicide-options.pdf)).

**What RGB at our resolution can and cannot see.** The best US evidence is Texas A&M work at 0.8 cm a pixel over 1 m
rows: weed occurrence detected with 83 to 89% accuracy across densities, and image weed cover against ground density at
r² 0.80 overall and 0.91 for Palmer at 4 to 6 leaves; the authors could not tell species apart in RGB at 8 mm a pixel, and
the model held for one weed growth stage only ([Sapkota et al. 2020, AgriEngineering](https://mdpi-res.com/d_attachment/agriengineering/agriengineering-02-00024/article_deploy/agriengineering-02-00024.pdf)).
A Spanish study using RGB, near-infrared and a DSM at 0.6 cm got 63 and 84% weed detection in two cotton fields and weed
cover only R² 0.57, mostly overestimated ([de Castro et al. 2018, Remote Sensing](https://mdpi-res.com/d_attachment/remotesensing/remotesensing-10-00285/article_deploy/remotesensing-10-00285.pdf)).
Plainly: RGB at 1 to 5 cm a pixel cannot tell Palmer amaranth from waterhemp or other pigweeds, cannot see cotyledon-stage
seedlings coarser than about 1.5 cm, and cannot see weeds under the canopy. What it can do is measure weed cover and
find weed objects between wide rows for longer than in any other crop. Bright dry soil, common in West Texas, is a real
problem: it halved seedling detection in Lin and Guo's work.

**Escapes.** Palmer amaranth is the textbook escape: 1 to 7 ft tall, over 2 in of growth a day in full light
([NMSU Guide A-617](https://pubs.nmsu.edu/_a/A617/)), over 8 ft in Georgia. Seed per plant runs from about 600,000
uncompeted (Keeley 1987, via NMSU) to 50,000 to 60,000 under dense crop competition (FSA2177) and 14,000 to 61,000 in
Georgia cotton depending on when it established (MacRae). In Texas, Palmer escapes infested 2.4 to 9.4% of field area by
region, with seed rain of 2.4 to 13.9 million seeds per hectare (Werner 2020). A tall Palmer plant above a cotton canopy
that peaks around 80 days is the late-season target nadir RGB sees best, and the reason our escape rule exists.

## E. What the imagery must be

| Task | Pixel size | Basis |
|---|---|---|
| Find 38 to 40 in rows | 5 cm or finer | rows found 100% up to 3.8 cm RGB (Peña 2015) |
| Cover between rows | 2 to 3 cm, often through bloom | our estimate; closure series above |
| Detect a 10 cm weed | about 1 to 2.5 cm | four-pixel rule (Peña 2015) |
| Seedling or cotyledon weeds | under about 1.5 cm; better 1 cm or less | Peña 2015; Lin and Guo 2021 |
| Weed species | not achieved in RGB even at 0.8 cm | Sapkota 2020 |

With a Phantom 4 RTK (pixel size equals height divided by 36.5, [DJI](https://www.dji.com/phantom-4-rtk/info)), 1 cm
needs about 37 m, 2 cm 73 m and 3 cm 110 m; the 400 ft FAA ceiling ([14 CFR 107.51](https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-107/subpart-B/section-107.51))
makes about 3.3 cm the coarsest legal RGB from that camera. Soil colour matters in cotton country: Piedmont soils (Cecil
series) have a red clay subsoil that eroded ground exposes ([NRCS Cecil](https://soilseries.sc.egov.usda.gov/OSD_Docs/C/CECIL.html)),
High Plains soils are brown fine sandy loams and clay loams (Amarillo, Pullman series), and bright dry soil cut seedling
detection to F1 54.5% (Lin and Guo). No quantified US study of shadow or wind effects in cotton was found.

**Multispectral and height.** Multispectral beat RGB by 5 to 18 points for seedling weeds in Peña's work; RGB cover
falls once leaves yellow while NDVI cover does not (Maeda). Adding DSM height to a classifier still gave only 63 to 84%
weed detection in cotton at 0.6 cm (de Castro 2018). No US study isolates what a DSM adds for cotton weeds; height mainly
helps with the tall Palmer escapes late in the season.
