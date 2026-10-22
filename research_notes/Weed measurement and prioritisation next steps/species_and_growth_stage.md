# Weed species and growth stage from drone source photographs (1–2 cm/px, RGB, nadir)

Scope note: Swardus already grades inter-row weed cover from the orthomosaic and keeps every original frame. This note asks what the *source photographs* can add on top of that: which species or species groups, at which growth stage, with what reliability, using which models/data under which licences, and how a credible product should present the answer. Research only; no code. Compiled 2026-10-21.

A recurring caveat for the writer: almost every published "species-level from a drone" result was obtained at a ground sampling distance (GSD) far finer than 1–2 cm/px (typically 0.1–0.5 cm/px, flown at 2–11 m). The 1–2 cm/px regime that Swardus flies today is the regime of the *weed-mapping* literature (crop / weed / soil, broadleaf vs grass patches), not the *species-identification* literature. That gap is the single most important finding here.

---

## Q1. From nadir drone RGB at 1–2 cm/px, which species or groups can be told apart with published accuracy, and which cannot (versus handheld photos)?

### Takeaway
At 1–2 cm/px the literature supports crop-vs-weed and coarse broadleaf-vs-grass patch mapping (roughly 75–94 % overall accuracy depending on study), with grasses systematically under-detected in RGB; published *species-level* identification from drones is done at 0.1–0.5 cm/px (2–11 m altitude), where per-species accuracies of 56–94 % are reported and accuracy collapses when the model is applied at a different altitude than it was trained on. Handheld or near-ground photos (30–50 cm, ~10 px/mm) are where the 92–96 % species results come from.

### Cited Findings

**What "1–4 cm per pixel" buys you: individual weed *plants*, not species**
- Peña et al. (2015), as summarised in a USDA-ARS review: "if the discrimination of individual weed plants is the objective, then the pixel size should be approximately 1 to 4 cm", which for their RGB camera meant 40–100 m altitude; patch-level detection tolerates coarser pixels — [Huang et al. 2018, Weed Technology, USDA-ARS copy](https://ars.usda.gov/ARSUserFiles/60663500/Publications/Huang/2018/Huang%20et%20al_2018_WT_32-2-6.pdf)
- A systematic review states modern RGB UAV sensors reach 1–5 cm GSD, "generally sufficient for detecting weeds even at early growth stages" — detection, not naming — [Advancements in Weed Mapping: A Systematic Review (arXiv 2507.01269)](https://arxiv.org/pdf/2507.01269)

**Broadleaf vs grass at UAV scale**
- Maize field, UAV at 40–100 m, visible vs colour-infrared: "with independence on spatial resolution (i.e., flight altitude), weed coverage was underestimated in the visible images, mostly in the parts of the field infested with grass weeds"; colour-infrared was "highly precise" only at 40 m and overestimated at higher altitudes — [Castillejo-González / Peña et al. 2014, CSIC digital repository](https://digital.csic.es/handle/10261/160279)
- Even in a near-ground handheld dataset (Weed25), the authors note Gramineae are hard to separate "because of similar shapes": crabgrass YOLOv5 accuracy 0.76, green foxtail 0.85, barnyard grass 0.93 and sometimes confused with crabgrass; most misidentifications were predicted as background — [Weed25, Frontiers in Plant Science 2022 (PMC9748680)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9748680/)

**Resolution as the variable (weed mapping, not species)**
- Soybean, four GSDs 0.27 / 0.55 / 1.10 / 2.19 cm (10–80 m): accuracy generally fell with coarser resolution; 80 m (2.19 cm/px) reached about 75 % overall accuracy; 10 m and 20 m results were not significantly different; the authors call prior results on resolution "contradictory" — [Spatial Resolution as a Factor for Efficient UAV-Based Weed Mapping — Soybean, Remote Sensing 2024](https://www.mdpi.com/2072-4292/16/10/1778)
- Wheat workflow at 0.088 cm/px: overall accuracy 87 %, kappa 0.81 for crop / weed / soil; weed user accuracy only 76 %, errors concentrated where crop and weed overlap — [Automated weed segmentation with knowledge (Scientific Reports 2026, reference PDF)](https://www.nature.com/articles/s41598-026-37475-1_reference.pdf)
- Soybean, RGB vs multispectral: RGB reached 93.8 % accuracy for land-cover types (crop / weed / soil), again not species — [A practical guide to UAV-based weed identification in soybean, 2025](https://www.sciencedirect.com/science/article/pii/S2666154325001553)

**Species-level from a drone: what has been achieved and at what altitude**
- Wheat, images captured at 1–6 m altitude, bag-of-visual-words classifier: single-plant discrimination of Matricaria recutita 88.6 %, Papaver rhoeas 89.1 %, Viola arvensis 87.9 %, winter wheat 94.1 % — [Remote Sensing 10(10):1530, 2018](https://mdpi-res.com/d_attachment/remotesensing/remotesensing-10-01530/article_deploy/remotesensing-10-01530.pdf)
- Soybean, DJI Mavic 3 Enterprise RGB, 5–30 m: deep learning was the only family that separated species from crop ("ANN and Maximum Likelihood could not effectively separate weed species from crops"); 94 % accuracy at 5 m falling to 79 % at 7.5 m in the soybean field — [Coscia, University of Padua thesis](https://thesis.unipd.it/handle/20.500.12608/59118)
- Same group, UNet trained on 15 m soybean imagery: 88.3 % overall accuracy, species-specific accuracies 56.3–94.1 %; "flight altitude significantly influences classification performance" and "altitude-specific models" are needed — [Nikolic & Masin, MetroAgriFor 2024, Padua repository](https://research.unipd.it/handle/11577/3573125)
- DRONEWEED (CSIC, Spain): 11 m AGL, Sony ILCE-6300L, **0.17 cm/px**, 67,558 labelled images, 7 maize weeds (Atriplex patula, Chenopodium album, Convolvulus arvensis, Datura ferox, Lolium rigidum, Salsola kali, Sorghum halepense) and 3 tomato weeds (Cyperus rotundus, Portulaca oleracea, Solanum nigrum), at BBCH14/17 (maize) and BBCH501/509 (tomato); no baseline accuracy in the data paper — [DRONEWEED, Data in Brief 2024 (PMC11719326)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11719326/)
- USU-Corn-WeedDB (forage corn): ~10 m, ~0.32 cm/px; authors note fine resolution matters because small weeds "lose definition at reduced input resolutions" — [arXiv 2606.06709](https://arxiv.org/pdf/2606.06709)
- CoFly-WeedDB (cotton, Larissa, Greece): 5 m altitude, 3 m/s, 201 images 1280×720, three weeds — Johnson grass (77 instances), purslane (21), field bindweed (286) — polygon labels, no baseline, "imbalanced, leading to a quite challenging detection task" — [CoFly-WeedDB, Data in Brief 2022 (PMC9483728)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9483728/)
- Rice seedling staging (BBCH 11/12/13) from nadir UAV images at 3 m: HOG-SVM best ≈ 85 % accuracy — [Frontiers in Plant Science 2022, 10.3389/fpls.2022.914771](https://www.frontiersin.org/journals/plant-science/articles/10.3389/fpls.2022.914771/pdf)
- Single Turkish species, drone, YOLOv5: Sinapis arvensis at 3–4 true-leaf stage; 1,000 training images gave 92.5 % precision; with 50–100 images "the system did not show any TP success" — [Güzel et al. 2022, Turkish Journal of Agriculture: Food Science and Technology](https://www.agrifoodscience.com/index.php/TURJAF/article/view/5183)

**Perennial grass example closest to an orchard**
- Cynodon dactylon in vineyards: bermudagrass and vine are spectrally similar so bands alone cannot separate them; OBIA on ultra-high-resolution UAV images (RGB and RGNIR) mapped grapevine / bermudagrass / bare soil above 97.7 % — a three-class map where the weed is the only green thing on the floor, flown in vine dormancy — [de Castro et al. 2019, PLOS ONE (PMC6559662)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6559662/)

**Handheld / near-ground reference accuracies (what "good" looks like with pixels to spare)**
- DeepWeeds: 17,509 images, 8 Australian rangeland weeds, ResNet50 95.7 % (five-fold) — [DeepWeeds GitHub](https://github.com/AlexOlsen/DeepWeeds); [paper, Scientific Reports 2019 (PMC6375952)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6375952/)
- Weed25: 25 species, ~14,000 images, SLR or phone at 30–50 cm, mostly BBCH 12–19; YOLOv5 mAP 92.4 %, Faster R-CNN 92.15 %; worst species Asiatic smartweed (Faster R-CNN AP 62.9 %, precision 20 %) — [Weed25 (PMC9748680)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9748680/)
- Plant Seedlings (Aarhus): ~960 plants, 12 species, ~10 px/mm — [Aarhus University dataset page](https://vision.eng.au.dk/plant-seedlings-dataset/)
- CottonWeedDet12 / YOLO benchmarks: mAP@0.5 88.1–95.2 % across YOLO versions; a modified YOLOv8-nano on augmented CottonWeedDet12 reached 97.6 % mAP — [EcoWeedNet, arXiv 2502.00205](https://arxiv.org/pdf/2502.00205); [AgriEngineering 7:313](https://mdpi-res.com/d_attachment/agriengineering/agriengineering-07-00313/article_deploy/agriengineering-07-00313.pdf)
- Pl@ntNet on weeds (informal, 60 images, 46 species, UC Weed Science 2018): correct species ranked first 60 %, second 12 %, third or lower 13 %, missed 15 % — [UC Weed Science blog](https://ucanr.edu/node/100003); Michigan State tests of eight apps on weeds at various stages: 11–67 % fully correct, 25–80 % partially — [AgWeb summary](https://www.agweb.com/news/crops/crop-production/are-you-spraying-right-weeds-apps-can-help); general flora (Estonia, 1,000 field observations, 281 taxa): Pl@ntNet and Flora Incognita both ≈ 80 % top-1, ≈ 90 % top-5, flowers identified better than leaves — [EUCYS 2021 summary](https://eucys2021.usal.es/computing-11-2021/)

### Inferences
- The 1–2 cm/px source frames Swardus keeps are 5–20× coarser than the imagery behind every species-level drone result found (0.088–0.32 cm/px). Expect the frames to support: (i) crop vs weed vs soil, (ii) broadleaf vs grass *when the patch is large*, (iii) a few coarse habit classes (prostrate mat vs upright rosette vs tall grass clump), (iv) colour events (yellow/white flowering, seed-head bleaching). Do not expect reliable named species except where the candidate list is already tiny and the species has a distinctive silhouette (bindweed's heart leaves and twining, purslane's succulent red stems and mats, Johnson grass's tall mid-rib-lined blades once large).
- Grass weeds are the group most likely to be *missed* in RGB at this GSD (CSIC maize result), and the group most likely to be *mis-named* even close up (Weed25). In an apricot orchard whose dangerous perennials are mostly grasses (Cynodon, Sorghum halepense), this is the first failure case to design around.
- Species-level claims require either a lower, dedicated pass (2–5 m, ~0.1–0.3 cm/px) over flagged patches, or a handheld photo taken by the operator at the spot the map flagged. Handheld is cheaper, avoids altitude-mismatch failure, and matches the regime where public models actually perform.
- Models trained at one altitude degrade at another (56–94 % per-species spread, 94 % → 79 % from 5 m to 7.5 m). Any model Swardus adopts needs its training GSD matched to the capture GSD, or the frames need resampling to the model's native scale.

### Gaps
- No study was found that isolates GSD as the only variable for *species-level* classification; the soybean resolution study is about weed mapping (crop/weed/soil), and its authors describe the literature as contradictory.
- The Padua thesis PDF exceeded the fetch size limit; the 94 % / 79 % figures come from the repository abstract and search snippet, and per-species confusions above 7.5 m could not be read.
- No published result was found for Sorghum halepense, Convolvulus arvensis, Conyza, Amaranthus or Portulaca identification from a UAV in an orchard; CoFly-WeedDB and DRONEWEED contain some of these species in row crops but report no accuracies.
- No peer-reviewed evaluation of Pl@ntNet specifically on agricultural weeds in field conditions was found; the 60 % top-1 figure is from an informal extension-service test.

---

## Q2. Which pretrained models, APIs and datasets could be used commercially, and what do they cost or require?

### Takeaway
Pl@ntNet is the only ready, commercially licensable species API found (free to 500 req/day, then €1,000/yr for 200k requests plus €5 per 1,000 overage); iNaturalist/Seek data and models are closed to commercial AI use under the current Terms per forum quotations; among datasets, DeepWeeds (CC BY 4.0) and Plant Seedlings (CC BY-SA) have clear licences, while CottonWeedID15/Det12, Weed25, DRONEWEED and CoFly-WeedDB have an open-access *paper* but no explicit dataset licence found.

### Cited Findings

**Pl@ntNet API**
- Free up to 500 identification queries per day; one free account per person or legal entity; paid access requires a signed licence — [Pl@ntNet API terms of use](https://my.plantnet.org/terms_of_use)
- Paid: base fee €1,000 (excl. tax) for 200,000 requests/year, no carry-over; overage €5 per 1,000; €4/1,000 above 3M, €3/1,000 above 30M, €2/1,000 above 300M; invoiced in USD at the billing-date rate; 20 simultaneous requests per client; 1M/day security quota for Pro — [terms of use](https://my.plantnet.org/terms_of_use); [pricing page](https://my.plantnet.org/pricing); [Pro plan docs](https://my.plantnet.org/doc/getting-started/pro-plan)
- Uploaded photos are not stored, only query history (date, time, image URLs); "In no event shall Pl@ntNet be liable for the accuracy of the results"; contents displayed "without any warranty whatsoever" — [terms of use](https://my.plantnet.org/terms_of_use)
- The API returns the most likely species with a confidence score and URLs of similar pictures — [terms of use](https://my.plantnet.org/terms_of_use)
- Coverage: a 2019 expansion added a "weed flora of European crops" project of about 1,300 species, a potentially invasive flora of ~900 species, and a world flora of >16,000; overall >20,000 species — [CIRAD press release 2019](https://www.cirad.fr/en/press-area/press-releases/2019/plantnet-in-central-america)
- Caching, redistribution and showing results to end customers are not addressed on the public terms page; they would be in the signed agreement ([EUR/USD agreement PDF v4.5](https://my.plantnet.org/documents/agreement_PlantNet_API_english_v4.5_USD.pdf))

**iNaturalist / Seek**
- Forum posts quote the current Terms of Use: "Prohibited Use for Commercial AI Training. Users may not use any iNaturalist data for training artificial intelligence, machine learning models, large language models, or similar networks, algorithms, or systems for commercial purposes" — [iNaturalist forum thread on AWS Open Data and commercial AI](https://forum.inaturalist.org/t/can-i-use-inaturalist-aws-open-data-to-train-commercial-ai-model/77663)
- Default photo licence is CC BY-NC; only CC BY and CC0 images are usable commercially — [iNaturalist licensing post](https://www.inaturalist.org/posts/107596-inaturalist-licensing); [Tech Tip Tuesday: Understanding Licensing](https://www.inaturalist.org/posts/30692-tech-tip-tuesday-understanding-licensing)
- One forum user reported staff did not respond to repeated emails asking for permission — [forum thread](https://forum.inaturalist.org/t/train-a-neural-network-using-inaturalist-photos-database/30864)

**WeedScan (Australia) as a design reference, not a usable model**
- Trained on "over 930 weeds and lookalike plants from across Australia"; managed by the Centre for Invasive Species Solutions, funded by the Australian Government's National Landcare Program — [WeedScan Identify](https://weedscan.org.au/Identify1)

**Datasets and licences**
| Dataset | Content | Capture / GSD | Licence (as found) | Source |
|---|---|---|---|---|
| DeepWeeds | 17,509 images, 8 Australian rangeland weeds + negative | in-situ ground cameras, resolution unstated | Images, annotations and code **CC BY 4.0**; repo Apache 2.0 | [GitHub](https://github.com/AlexOlsen/DeepWeeds) |
| Plant Seedlings (Aarhus/SDU) | ~960 plants, 12 species (3 crops + 9 Danish arable weeds incl. Chenopodium album, Capsella, Sinapis arvensis, Stellaria media) | ~10 px/mm, indoor trays | **CC BY-SA** (page links both 4.0 and 2.0); full citation required for derived models | [Aarhus page](https://vision.eng.au.dk/plant-seedlings-dataset/) |
| Weed25 | 25 species, ~14,000 images, BBCH 12–19 | SLR/phone at 30–50 cm, Chongqing, China | Paper CC BY; dataset on Baidu Pan, "provided by the authors without undue reservation"; **no dataset licence stated** | [PMC9748680](https://pmc.ncbi.nlm.nih.gov/articles/PMC9748680/) |
| CottonWeedID15 | 15 US cotton weeds | handheld, US South | "made publicly available" on Kaggle; **licence not confirmed** (Kaggle page did not render) | [Frontiers 2022](https://frontiersin.org/journals/plant-science/articles/10.3389/fpls.2022.1053329/full) |
| CottonWeedDet12 | 5,648 images, 12 classes, 9,370 boxes | handheld, Michigan State | Zenodo record; **licence field not read** | [Zenodo 7535814](https://zenodo.org/records/7535814); [HF mirror](https://huggingface.co/datasets/Voxel51/CottonWeedDet12) |
| DRONEWEED (CSIC) | 67,558 images, 10 species, maize + tomato | drone 11 m, 0.17 cm/px | Paper CC BY; dataset at DIGITAL.CSIC doi 10.20350/digitalCSIC/16559; **dataset licence not stated in paper** | [PMC11719326](https://pmc.ncbi.nlm.nih.gov/articles/PMC11719326/) |
| CoFly-WeedDB | 201 images, Johnson grass / purslane / bindweed in cotton | drone 5 m | Paper CC BY 4.0; dataset Zenodo 10.5281/zenodo.6697343; **dataset licence not stated in paper** | [PMC9483728](https://pmc.ncbi.nlm.nih.gov/articles/PMC9483728/); [Zenodo](https://zenodo.org/records/6697343) |
| CWD30 | crop-weed recognition benchmark, compares itself to Plant Seedlings | ground | not stated in results | [arXiv 2305.10084](https://arxiv.org/pdf/2305.10084) |
| WeedsGalore | multispectral + multitemporal UAV, maize crop/weed segmentation | drone | not read | [arXiv 2502.13103](https://arxiv.org/pdf/2502.13103) |

**Turkish datasets**
- No public Turkish weed image dataset was found. Turkish-authored work used private collections: Sinapis arvensis drone images (Güzel et al. 2022) and a four-species growth-stage set from seeds collected in Afyonkarahisar-Sinanpaşa — [TURJAF 2022](https://www.agrifoodscience.com/index.php/TURJAF/article/view/5183); [ÇOMÜ repository record, 2025 growth-stage study](https://acikerisim.comu.edu.tr/items/d72da664-16cb-4fa1-bb35-42c8ce157901)

### Inferences
- The only API that can go into a commercial product tomorrow with a known price is Pl@ntNet; at 500 free calls/day it covers a pilot comfortably, and at €1,000/yr for 200k calls it is cheap relative to any flight. But its weed flora is a *European crops* project with a confidence score and no warranty, and nothing found shows it validated on nadir drone crops of plants at 1–2 cm/px. Handheld confirmation photos are its natural input.
- Treat iNaturalist/Seek as off-limits for a commercial model unless written permission is obtained; the forum quotations are consistent, the official terms page could not be fetched (403).
- For training in-house, DeepWeeds (CC BY 4.0) and Plant Seedlings (CC BY-SA, which is share-alike and would taint a proprietary model's weights if "derived work" is read strictly) are the only clearly licensed sets, and neither contains Turkish orchard species. DRONEWEED is the most relevant by species list (bindweed, Johnson grass, purslane, Chenopodium, Lolium rigidum, Cyperus rotundus, black nightshade) and GSD-wise the closest to a low pass; its licence must be checked at DIGITAL.CSIC before any use.
- Every dataset found is a different scale from Swardus's frames; a Swardus-collected, operator-labelled set is unavoidable for anything that is to be trusted on its own fields.

### Gaps
- Kaggle (CottonWeedID15) and Zenodo (CottonWeedDet12) licence fields could not be read; iNaturalist's official terms page returned 403 — both must be confirmed by hand before any decision.
- Pl@ntNet's signed agreement (caching, redistribution, display to end customers, attribution for paid use) was not read.
- No price or terms were found for any competitor's species model (Taranis, Sentera, Greeneye, Carbon Bee); none is sold as an API.
- No "WeedCrop" dataset could be identified under that name; the closest match found was CWD30.

---

## Q3. What does the Turkish / Mediterranean orchard weed flora look like, and which are the dangerous species?

### Takeaway
Turkish orchard surveys consistently report 44–106 species per orchard type, with a short list recurring across apricot, citrus, olive and pome orchards: Cynodon dactylon, Sorghum halepense, Convolvulus arvensis, Cyperus rotundus, Portulaca oleracea, Amaranthus retroflexus, Chenopodium album/murale, Xanthium strumarium, Echinochloa crus-galli, Conyza (bonariensis in citrus, canadensis in vineyards), Capsella bursa-pastoris, Polygonum aviculare, Lolium, Bromus tectorum, Avena spp. and Poa bulbosa; the perennials (Cynodon, Sorghum halepense, Convolvulus, Cyperus) and glyphosate-resistant Conyza are the ones that justify a priority flag.

### Cited Findings

**Apricot (Malatya, the crop Swardus flies today)**
- Kale district, Malatya, 2020–2022, 6 orchards at different altitudes, four 1 m² frames each: 106 weed species (32 monocot, 74 dicot) in 30 families; density rose as elevation fell, diversity rose with elevation; most common by density Ranunculus repens, Ranunculus bulbosus, Poa bulbosa, Cynodon dactylon; frequent also Bromus tectorum, Medicago sativa, Chenopodium album — [İnönü/Özal University repository record](https://acikerisim.ozal.edu.tr/items/b535f457-2fd3-439c-a81a-ac8e6252416b)
- Malatya apricot cover-crop trial 2014–2016 (hairy vetch, buckwheat etc.): highest weed diversity index came from the weed-control plots — [Özal University repository](https://acikerisim.ozal.edu.tr/items/92803a16-9148-4e74-b832-80b3752f0bb8)
- Elazığ apricot seed-bank study (2024), 25 orchards, tillage effects on composition; notes Elazığ, Malatya, Tunceli and Bingöl are the major apricot provinces — [Advances in Weed Science (SciELO)](https://www.scielo.br/j/aws/a/Y4bVyb59C5zKdPJQzK5kHRp/?lang=en)

**Citrus (Mediterranean/Aegean Turkey)**
- Antalya, 100 citrus orchards, 2013: 44 species, 16 families; highest frequency Xanthium strumarium 64 %, Portulaca oleracea 60 %, Sorghum halepense 60 %, with Cyperus rotundus and Echinochloa crus-galli also most common; mean ground cover ≈ 40.3 %, mean density 44.9 plants/m² — [Düzce University repository](https://acikerisim.duzce.edu.tr/items/6ab50a21-8fd7-4c77-bc07-fb2b831997b6)
- Muğla, 60 orchards, spring and autumn 2010–2011: 68 species, 30 families; 54 species in spring vs 29 in autumn; annuals the dominant life-form; distribution shaped by soil P, sand, silt, altitude, precipitation; recommends orchard-specific management — [Planta Daninha (SciELO)](https://www.scielo.br/j/pd/a/cdzN9HLf8McsXzGynrnKXtw/?lang=en)
- Conyza survey 2015, 131 citrus orchards + 121 vineyards (Aegean + Mediterranean), 203 specimens, identified by PCR/sequencing: C. bonariensis in nearly half of citrus orchards, C. canadensis in 33 %; in vineyards C. canadensis in more than half; C. sumatrensis in 13 vineyards; glyphosate more effective at rosette for both susceptible and resistant biotypes; "late treatments" blamed for poor control of non-resistant populations — [Kaya-Altop et al. 2023, Emirates J. Food Agric. 35(2):170–179](https://acikkaynak.bilecik.edu.tr/items/ea102f08-64f7-4810-841e-bf468b81fe9b/full)

**Olive**
- Bursa, 60 orchards across 7 districts, 2012: 81 species, 30 families; densest Lolium perenne 2.55/m², Chenopodium murale 2.53, Sonchus asper 2.12, Anthemis altissima 2.10, Rapistrum rugosum 1.66; top ten also include Avena barbata, Convolvulus arvensis, Medicago polymorpha, Hordeum bulbosum, Sorghum halepense (the English abstract repeats 2.55 for all ten, a reporting error; use the Turkish figures) — [Namık Kemal University repository](https://acikerisim.nku.edu.tr/xmlui/handle/20.500.11776/827)
- Olive research-field thesis: 39 species, 14 families; control plots Avena fatua 13.89/m², Cynodon dactylon 13.46, Sorghum halepense 12.80, Lolium perenne 12.63 — [tezara thesis record](https://tezara.org/theses/705695)
- Southern Greece, 116 olive groves: herbicides decrease weed diversity, mowing promotes richer communities — [IOBC-WPRS bulletin](https://iobc-wprs.org/product/composition-and-biodiversity-of-weed-flora-in-established-olive-groves-of-southern-greece/); Albania (Vlora), 10 groves, >80 species, Poaceae and Fabaceae predominant, annuals more prominent where tillage is common — [Research Journal of Agricultural Science](https://www.rjas.ro/paper_detail/883)

**Other Turkish orchards (cross-check of the recurring list)**
- NW Marmara cherry/walnut/apple/almond/pear 2015–2018: 64 species, 30 families; Amaranthus retroflexus, Polygonum aviculare, Capsella bursa-pastoris among the dominant — [TURJAF](https://agrifoodscience.com/index.php/TURJAF/article/view/3017)
- Niğde apple 2006–2007: 87 species, 28 families, mean 101.8 weeds/m²; Agropyron repens highest frequency 84.6 %, Bromus tectorum 72.2 % — [Niğde Ömer Halisdemir University repository](https://acikerisim.ohu.edu.tr/items/6a6e5c15-9deb-4ea5-bcff-baf945b69f46)
- Gaziantep pistachio: 48 species, 21 families — [Düzce repository (summary in search)](https://acikerisim.duzce.edu.tr/items/b6b8bf07-2567-4975-a20c-5f3ec408492f)

**Mediterranean row-crop context (for corn/cotton later)**
- Andalusian cereals, 200 fields: 91 species, Lolium rigidum most frequent and abundant, Phalaris also highly frequent — [SJAR](https://sjar.revistas.csic.es/index.php/sjar/article/download/7022/5409/)
- Greek cotton drone dataset weeds: Johnson grass, purslane, field bindweed — [CoFly-WeedDB](https://pmc.ncbi.nlm.nih.gov/articles/PMC9483728/); Spanish maize/tomato drone dataset weeds: Chenopodium album, Convolvulus arvensis, Sorghum halepense, Lolium rigidum, Cyperus rotundus, Portulaca oleracea, Solanum nigrum, Datura ferox, Atriplex patula, Salsola kali — [DRONEWEED](https://pmc.ncbi.nlm.nih.gov/articles/PMC11719326/)

### Inferences
- A working "Turkish orchard" candidate list of ~20 taxa can be assembled from the surveys above and would cover the bulk of what the frames will show: perennials Cynodon dactylon, Sorghum halepense, Convolvulus arvensis, Cyperus rotundus, Agropyron (Elymus) repens; summer annuals Portulaca oleracea, Amaranthus retroflexus, Chenopodium album, Chenopodium murale, Xanthium strumarium, Echinochloa crus-galli, Solanum nigrum; winter/spring annuals Capsella bursa-pastoris, Polygonum aviculare, Sinapis arvensis, Rapistrum rugosum, Sonchus asper, Anthemis, Lolium spp., Bromus tectorum, Avena spp., Poa bulbosa, Hordeum bulbosum; and the Conyza complex (bonariensis in citrus, canadensis in vineyards). Which of these the product shows the operator should still be drawn from the existing catalogue with the survey citations attached, not from this list alone.
- "Dangerous" in this flora is a function of habit and resistance, not of name: rhizomatous/stoloniferous perennials (Cynodon, Sorghum halepense, Convolvulus, Cyperus) survive mowing and shallow tillage and spread from the patch; Conyza has documented glyphosate resistance in Turkish citrus. These deserve a priority flag independent of cover percentage, which argues for the product carrying a per-species "treatment-difficulty" attribute from the catalogue.
- Season splits the list roughly in half (54 spring vs 29 autumn species in Muğla citrus), which is the quantitative basis for Q5's date prior.

### Gaps
- The Kale apricot survey could not be opened in full (certificate error); frequency/density percentages per species are not available here, only the ranked lists.
- No olive-orchard flora survey from Aegean Turkey (the main olive region) was found; the Bursa survey is from Marmara.
- No Andalusian olive-grove survey naming Conyza/Cynodon/Sorghum as dominants was found; the Spanish-language literature ("flora arvense olivar") was not searched.
- EPPO and FAO flora references were not reached in this pass.

---

## Q4. How do growth-stage cues show in nadir imagery, which are measurable, and why does stage matter for treatment timing and priority?

### Takeaway
Nadir imagery exposes four measurable stage proxies — canopy/rosette diameter (equivalent diameter from blob area), leaf count only at sub-cm GSD, flower colour (yellow/white indices work in RGB), and seed-head/senescence colour change — while BBCH leaf stages beyond the first few are not separable at 1–2 cm/px; stage matters because glyphosate on Conyza works at rosette and fails at bolting/reproductive stage, and because a flowering patch is weeks from seed rain, which is the real cost.

### Cited Findings

**The scale to express it in**
- Hess et al. (1997) proposed an extended BBCH scale for crop and weed species; principal stages 0–9, two-digit codes; weed table uses true-leaf counts (11 = first true leaf, 12 = two ... 19 = nine or more), stage 2 side shoots/tillers, stage 3 stem elongation — [Wikipedia: BBCH-scale (weed), summarising Hess et al. 1997](https://en.wikipedia.org/wiki/BBCH-scale_(weed)); [Frontiers 2017 on BBCH framework](https://www.frontiersin.org/journals/plant-science/articles/10.3389/fpls.2017.01726/pdf)

**Stage from images: what has been measured**
- Turkish four-species study (seeds from Afyonkarahisar-Sinanpaşa), four growth-stage classes: EfficientNet 89.55 % on the 4-class ROI dataset; "classes 3 and 4 exhibited extreme similarity caused most of the prediction errors" (later stages blur together) — [ÇOMÜ repository record, 2025](https://acikerisim.comu.edu.tr/items/d72da664-16cb-4fa1-bb35-42c8ce157901)
- Rice BBCH 11/12/13 from nadir UAV at 3 m: HOG-SVM ≈ 85 % accuracy, precision, recall and F1 (84.9–85.9 %) — [Frontiers in Plant Science 2022](https://www.frontiersin.org/journals/plant-science/articles/10.3389/fpls.2022.914771/pdf)
- DRONEWEED labels its images as "early" vs "advanced" stage (BBCH14 vs BBCH17 maize; BBCH501 vs 509 tomato) rather than finer, at 0.17 cm/px — [DRONEWEED](https://pmc.ncbi.nlm.nih.gov/articles/PMC11719326/)
- Potato UAV time series pairs each flight with an estimated BBCH stage and growing-degree-days — a template for time-stamping weed frames — [ISPRS Archives XLIII-B3-2020](https://isprs-archives.copernicus.org/articles/XLIII-B3-2020/1521/2020/isprs-archives-XLIII-B3-2020-1521-2020.pdf)

**Size / canopy diameter**
- Per-plant canopy delineation from a UAV canopy-height time series with a Voronoi model identified 13,000 of 13,050 corn plants; vegetation indices removed soil and shadow from canopy area — crop, not weed — [preprints.org 202404.1076](https://preprints.org/manuscript/202404.1076/v1)
- Canopy cover from RGB vegetation indices: ExG performed best (potato); LAI–cover relationship is more linear early than late (onion), so area-based stage proxies drift after canopy closure — [Sustainability 14(11):6473](https://ideas.repec.org/a/gam/jsusta/v14y2022i11p6473-d823868.html); [onion LAI study (AGRIS)](https://agris.fao.org/search/en/records/65dfc75763b8185d9caed66e)
- No study was found that measures individual *weed* rosette diameter or canopy area from a UAV and validates it against ground measurement — [search result, see Gaps]

**Flowering and seed-head colour**
- Yellow weeds in alfalfa: RGB-based indices separated yellow-flowering weeds from green crop and avoided NDVI's soil confusion; proposed as input to site-specific herbicide maps — [CITA Aragón 2020](https://citarea.cita-aragon.es/bitstream/10532/4976/1/2020_087.pdf)
- Oxalis pes-caprae mapping with an RGB drone camera: flying during flowering makes species discrimination more reliable because of species-specific spectral differences — [Univ. Politecnica delle Marche IRIS](https://iris.univpm.it/handle/11566/286541)
- Leafy spurge flowering cover from UAV with hue-intensity-saturation thresholds: r² 0.64–0.93 against ground estimates; 30 m flight height gave the strongest relationships — [Cambridge Core article](https://www-cambridge-org.ezproxyberklee.flo.org/core/product/0B92790C0AB241040421C18CC1A0C0CB/core-reader)
- Canola NDYI from UAV multispectral tracked flowering intensity, R² 0.54–0.95 after thresholding flowering pixels; RGB counting of conspicuous yellow flowers is feasible — [Frontiers 2021](https://frontiersin.org/journals/plant-science/articles/10.3389/fpls.2021.686332/text); [Remote Sensing 14:4464](https://mdpi-res.com/d_attachment/remotesensing/remotesensing-14-04464/article_deploy/remotesensing-14-04464.pdf)
- Blackgrass at flowering (BCPC 2023): models had high accuracy but low precision, over-predicting around patches; NDVI added little for flowering plants; resolution and timing matter most — [BCPC 2023 slides](https://www.bcpc.org/wp-content/uploads/2023/11/8-Comont-BCPC-2023-Weeds-Final-compressed.pdf)
- Handheld app evidence that flowers carry the species signal: Pl@ntNet and Flora Incognita identify flower images better than leaf images (Estonian study) — [EUCYS 2021](https://eucys2021.usal.es/computing-11-2021/)

**Why stage matters for timing and priority**
- Turkish citrus/vineyard Conyza: "Glyphosate was more effective when it was applied at the earlier rosette stages" for susceptible and resistant biotypes; late treatment is the suggested main cause of poor control — [Kaya-Altop et al. 2023](https://acikkaynak.bilecik.edu.tr/items/ea102f08-64f7-4810-841e-bf468b81fe9b/full)
- Argentine C. bonariensis: at bolting, doses much higher than recommended were required for both biotypes; reproductive stage control was poor; ALS inhibitors gave excellent control at rosette at doses below the recommended rate — [INTA repository](https://repositorio.inta.gob.ar/handle/20.500.12123/3504)
- Horseweed greenhouse study: rosette most effectively controlled, then bolt; topped plants need paraquat + 2,4-D or dicamba — [Agronomy Journal 2019 111:3274–3280 (pestinfo wiki)](https://wiki.pestinfo.org/wiki/Agronomy_Journal_(2019)_111,_3274-3280)
- Weed-mapping studies choose flight date by weed stage: a wheat OBIA workflow tested altitudes and dates "to determine the best spatial resolution and wheat-weed growth stage" — [Frontiers 2018 1362](https://www.frontiersin.org/journals/plant-science/articles/10.3389/fpls.2018.01362/pdf); "early in the season is often the optimal treatment window", but small seedlings need very high spatial resolution — [PMC3795646](https://pmc.ncbi.nlm.nih.gov/articles/PMC3795646)

### Inferences
- At 1–2 cm/px, the honest stage proxies are (i) canopy area → equivalent diameter per blob, (ii) height only if a DSM is built, (iii) a flowering flag from hue thresholds (yellow for Brassicaceae/Sonchus/Oxalis-type, white for Capsella/Conyza heads at scale, purple-pink for Convolvulus is weak), (iv) senescence/seed-head bleaching from a drop in greenness while area stays. Leaf counting (BBCH 11–19) needs sub-cm pixels and is out of reach from the orthomosaic frames.
- A three-bin stage ("seedling / vegetative / flowering-or-seeding") expressed as a BBCH *range* is defensible; a two-digit BBCH code is not. The Turkish four-class study's confusion of its later two classes supports stopping at three bins.
- Stage should raise priority monotonically for the species where control window closes (Conyza past rosette) and for any flowering patch (seed rain). That makes "flowering seen" a more useful product output than a species name in many cases, and it is measurable now.
- Rosette diameter is the right size cue for Conyza, Capsella, Sonchus and Xanthium-type broadleaves; for grasses and mats (Cynodon, Portulaca) patch area and greenness persistence over dates are the only usable cues.

### Gaps
- No peer-reviewed study measures individual weed rosette diameter or BBCH stage from UAV RGB and validates it against ground truth; the canopy-area workflow is inferred from crop studies.
- The weed BBCH flowering codes (5x/6x) could not be read from the sources reached; Hess et al. (1997) original table not fetched.
- The four weed species in the Turkish growth-stage study are not named in the record reached (403 on the full page).
- No source quantified how much herbicide efficacy drops per BBCH step for Cynodon, Sorghum halepense or Convolvulus; the stage evidence is Conyza-centric.

---

## Q5. Phenology and season priors: using location, date and crop to narrow the candidate list before looking at pixels

### Takeaway
Hydrothermal-time emergence models exist for the key Mediterranean weeds (Conyza bonariensis Tb ≈ 10.6 °C, Ψb ≈ −0.70 MPa; Amaranthus retroflexus and Chenopodium album models from Italy and Croatia; Lolium rigidum, Avena sterilis, Galium), and Turkish orchard surveys show the species list roughly halves between spring and autumn, so a date-and-region prior can legitimately cut the candidate list before any pixel is looked at.

### Cited Findings
- Conyza bonariensis (Spain): hydrothermal germination model from constant temperature/water-potential tests; field emergence fitted with a Gompertz function; base temperature ≈ 10.6 °C, base water potential ≈ −0.70 MPa; emergence starts at ≈ 15 HTT, 50 % at ≈ 53 HTT, 95 % at ≈ 105 HTT; field emergence 61 % and "highly dependent on the rainfall" — [Zambrano-Navea, Bastida & González-Andújar 2013, Weed Research 53:213–220 (UHU record)](https://produccioncientifica.uhu.es/documentos/5e8cecc92999522d380c8037?lang=en)
- Amaranthus retroflexus and Chenopodium album in Italian maize: thermal-time models worked in years without dry periods; dry years required hydrothermal time; only hydrothermal time gave a reliable estimate across climates and sowing dates — [CNR IRIS record](https://iris.cnr.it/handle/20.500.14243/196065); Croatian populations' Tb/Ψb matched Italian ones only partly (Tb of C. album and Ψb of A. retroflexus) — [Agronomy 2021 (DOAJ)](https://doaj.org/article/669a2225359949baacde10251fcb735e)
- Mediterranean cereal weeds: emergence models for Avena sterilis (air thermal time, Weibull) and Lolium rigidum (soil thermal time); Conyza, Lolium and Galium hydrothermal models reviewed together — [SJAR review](https://sjar.revistas.csic.es/index.php/sjar/article/download/17876/5245)
- Season split in Turkish citrus: 54 species in spring vs 29 in autumn, annuals dominant — [Muğla citrus survey, Planta Daninha](https://www.scielo.br/j/pd/a/cdzN9HLf8McsXzGynrnKXtw/?lang=en)
- Altitude split in Turkish apricot: density rose as elevation fell, diversity rose with elevation (Kale, Malatya) — [Özal University record](https://acikerisim.ozal.edu.tr/items/b535f457-2fd3-439c-a81a-ac8e6252416b)
- Management as a prior: in olive groves where tillage is common, annuals dominate over perennials (Albania); herbicide use lowers diversity, mowing raises it (Greece) — [RJAS](https://www.rjas.ro/paper_detail/883); [IOBC-WPRS](https://iobc-wprs.org/product/composition-and-biodiversity-of-weed-flora-in-established-olive-groves-of-southern-greece/)
- Taranis schedules weeds into the *early* missions (emergence check + early weed pressure) and keeps monitoring later — a product example of a season-structured prior — [Taranis knowledge base](https://knowledge.taranis.ag/portal/en/kb/articles/how-taranis-tags-threats-in-field-insights)

### Inferences
- A light, mathematical prior is available and fits the founder's preference: per species, an emergence window as cumulative thermal or hydrothermal time from a start date (1 Jan or last tillage), with a crop/region membership table from the surveys in Q3. The result is a per-date candidate list with a plausibility weight, and it costs no pixels.
- The prior should be shown to the operator as "what is usually up at this date here", with its survey sources, not as a detection; this matches the existing catalogue rule (names with sources, never detections).
- Because the Conyza model's field emergence is "highly dependent on the rainfall", a daily rainfall feed (or the operator's irrigation record) materially improves the prior for the summer annuals; without it, the prior should be a thermal-time window with wide tolerance.

### Gaps
- No emergence model was found for Portulaca oleracea, Cynodon dactylon (regrowth from rhizome), Sorghum halepense or Convolvulus arvensis in a Mediterranean setting; for these the prior must rest on survey season splits only.
- No Turkish emergence-timing table (Türkiye Herboloji Derneği / Turkish Journal of Weed Science) was reached; the Turkish sources found are surveys, not phenology tables.
- No source gives Malatya-specific thermal-time calibrations; the Spanish/Italian parameters would be transferred untested.

---

## Q6. How should a credible product present a species proposal and express uncertainty, and how do competitors do it?

### Takeaway
Published and deployed practice converges on: a ranked top-k with a calibrated score, explicit confidence bands with words attached (WeedScan: <30 % unreliable, 30–50 low, 50–80 moderate, >80 high), evidence images beside the proposal, an abstain-and-route rule that sends low-confidence cases to a human, and a disclaimer that the score is not a warranty; competitors make species claims (Greeneye >200 species at 95.7 %; Sentera "99 % correlation", 94 % detection over 13,000 acres; Taranis tags "all identifiable species" in an image) without publishing per-species confusion or confidence, and none was found to expose uncertainty to the user.

### Cited Findings

**Deployed presentations**
- WeedScan (930+ Australian weeds and lookalikes): below 30 % "unreliable" and no public record allowed; 30–50 % low confidence, review the species profile before recording; 50–80 % moderate; above 80 % high "but reviewing the suggestion is still good practice"; consult an expert if doubt remains, especially for a possible native — [WeedScan Identify](https://weedscan.org.au/Identify1)
- Pl@ntNet API returns the most likely species with a confidence score plus URLs of similar pictures (visual evidence), and disclaims any liability for accuracy — [Pl@ntNet terms](https://my.plantnet.org/terms_of_use)
- Taranis: when weeds appear in an image, every identifiable weed species in that image is tagged "whenever possible" (other threats get one tag per image); about 1–3 images per acre are shown; the page says nothing about confidence scores, agronomist review, or species count — [Taranis knowledge base](https://knowledge.taranis.ag/portal/en/kb/articles/how-taranis-tags-threats-in-field-insights); Taranis markets "sub-millimeter" imagery and species-level weed and insect ID — [Taranis blog](https://www.taranis.com/blogs/one-acre-one-image-taranis-commitment-to-unparalleled-crop-intelligence/)
- Sentera Aerial WeedScout: company claims species pin-pointing of weeds "as small as ¼ inch", "about 99 % correlation with ground-truth", and 94 % weed detection accuracy over 13,000 acres in 2024; prescriptions to any precision sprayer within a day; acquired by John Deere — [Iowa State Extension](https://crops.extension.iastate.edu/post/drone-based-weed-mapping-targeted-spraying); [No-Till Farmer](https://no-tillfarmer.com/articles/13545-drone-mapping-technology-slashes-chemical-costs-by-70)
- Greeneye (sprayer-mounted, 40 fps): claims classification to species, >200 species, average accuracy 95.7 % "in real field conditions"; UNL trial 87 % post-emergence herbicide cut — [The Western Producer](https://www.producer.com/crops/greeneye-sees-all-knows-all/); [DTN](https://www.dtnpf.com/agriculture/web/ag/equipment/article/2022/08/26/greeneye-technologys-ai-enabled-weed)
- Carbon Bee SmartStriker X: RGB + hyperspectral cameras at 3 m spacing, "over 20 crop species and various weed types", modules per crop (grassland: docks, thistles, nettles, ragwort); £2,500/m, no subscription — [Farmers Weekly](https://www.fwi.co.uk/machinery/spraying-and-fertilising/sprayers/cereals-2026-lh-agro-offers-carbon-bee-spot-spraying-kit); [Profi](https://www.profi.co.uk/news/kuhn-works-intelligent-spot-sprayer/)
- Precision AI: onboard edge AI "can distinguish between individual plant species", weeds as small as two-leaf stage, trained on corn/soy/canola/lentils/peas/barley/wheat/oats; flexwing airframe; a technician cites >90 % in-crop hit rate as the economic bar — [Country Guide](https://www.country-guide.ca/crops/low-clearance-spraying/); [Grainews](https://www.grainews.ca/news/green-on-green-tech-prepares-for-airborne-launch/); [The Western Producer](https://www.producer.com/crops/drone-harnesses-artificial-intelligence/)
- Solvi (Gothenburg): plant counting, size and health metrics (PlantAI); no documented species-level weed feature — [Advexure listing](https://advexure.com/products/solvi-drone-analytics-for-field-trials-plant-level-insights); [Future Farming 2017](https://futurefarming.com/smart-farming/tools-data/swedish-software-makes-sense-of-drone-imagery)

**Research on calibration, abstention and top-k**
- Calibrated weed mapping (segmentation): poor calibration can waste herbicide; post-hoc calibration improved prediction reliability — [CEUR-WS Vol-4165 paper 1](https://ceur-ws.org/Vol-4165/paper1.pdf)
- Abstain-and-route: a confidence threshold accepts predictions above it and sends the rest to an expert; the confidence-based method was better calibrated than standard supervised models, which "tend to overrate their own predictions"; the threshold sets how much human effort to spend — [arXiv 2311.01064 (camera traps, not weeds)](https://arxiv.org/pdf/2311.01064)
- Average-K classification: vary the number of labels per image while averaging K, as an alternative to a fixed top-K for ambiguous inputs — [Salmon group abstract (CatalyzeX)](https://www.catalyzex.com/author/Joseph%20Salmon)
- Experts vs machines on French flora: experts themselves sometimes disagree; deep learning approached expert performance — [Plant Identification: Experts vs Machines (Montpellier)](https://esploro.umontpellier.fr/esploro/outputs/bookChapter/Plant-Identification-Experts-vs-Machines-in/9934955509311)
- Handheld apps on weeds: 11–67 % fully correct across eight apps (MSU) — the spread itself is the argument for showing rank and evidence rather than a single name — [AgWeb](https://www.agweb.com/news/crops/crop-production/are-you-spraying-right-weeds-apps-can-help)

### Inferences
- For Swardus, the presentation that matches both the evidence and the product's rules: (1) the *group* first (grass / broadleaf rosette / prostrate mat / twining), because that is what 1–2 cm/px supports; (2) a short ranked list of *catalogue* species consistent with the group and the date prior, each with its survey source; (3) a numeric score only when it comes from a model validated at this GSD, otherwise a verbal band in WeedScan's style; (4) the evidence crop from the source frame beside the proposal, and the Pl@ntNet "similar pictures" if that API is used; (5) a one-tap operator verdict (confirm / other / unsure) that becomes the only thing the map shows as a species; (6) an explicit "needs a close photo" state when confidence is below the floor, which doubles as the handheld-confirmation loop.
- Competitors sell a verdict; none found exposes a confusion matrix, per-species accuracy or a confidence band to the user. A product that shows its uncertainty and its evidence is differentiated, and consistent with the founder's "proposal, never a verdict" rule.
- Agronomists' trust will rest on two things the literature supports: calibration (a 70 % score should be right about 70 % of the time, checked on the operator's own verdicts) and an abstention rate that is honest. Both can be measured in-product from the confirm/other/unsure clicks without any external benchmark.

### Gaps
- No study was found that measures agronomist trust in top-k weed suggestions specifically; the calibration and abstention evidence comes from segmentation and camera-trap work.
- No competitor publishes a species list, per-species accuracy, or how (if at all) uncertainty is shown; all figures above are company claims relayed by trade press.
- The Taranis page does not state whether a human agronomist reviews weed tags before the farmer sees them.
