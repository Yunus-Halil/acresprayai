# Corn: public overhead imagery with weeds (and stand), for benchmarking

Research date: 2026-10-23. Nothing was downloaded. "Verified" means the dataset's own page (repository, Zenodo record
or paper) was fetched this session and the facts below come from it; anything else is in the unverified list.
Already known and not repeated in full: [Zenodo 5089956](https://zenodo.org/records/5089956) (Texas A&M 2015, Phantom 3
corn raw frames, CC0, about 15 m, plant counting).

## Verified datasets

| Dataset | URL / DOI | Licence | Size | Camera, height, GSD | Stage, dates | Region, fields | Labels | Frames or ortho | Caveats |
|---|---|---|---|---|---|---|---|---|---|
| USU-Corn-WeedDB (Bhandari et al., 2026) | [arXiv 2606.06709](https://arxiv.org/abs/2606.06709), [10.5281/zenodo.20044178](https://doi.org/10.5281/zenodo.20044178) | CC BY 4.0 | 2.4 GB zip | Autel EVO II Dual 640T V2 RGB, about 10 m AGL, about 0.48 cm/px | stage not stated; one date, 27 Jun 2025 | Cache Valley, Utah, USA; ONE commercial forage-corn field | Bounding boxes, 3 weeds: common lambsquarters, redroot pigweed (53.86% of boxes), green foxtail; 800 labelled 640 x 640 tiles, 10,539 boxes; 8,000 unlabelled tiles; 366 source images | tiles cut from 366 full-resolution images; whether originals with EXIF are in the zip not stated | Single field and date: no field-level split possible. Corn itself not labelled. Boxes, not masks |
| WeedsGalore (Celikkan et al., WACV 2025) | [arXiv 2502.13103](https://arxiv.org/abs/2502.13103), [GitHub GFZ/weedsgalore](https://github.com/GFZ/weedsgalore), data at [doidata.gfz.de](https://doidata.gfz.de/weedsgalore_e_celikkan_2024/) | Data CC BY; code Apache-2.0 | 0.4 GB dataset; 12 GB GeoTIFF orthos (separate) | DJI Phantom 4 Multispectral (RGB + 5 mono bands, 2.08 MP each), 5 m, 0.25 cm (2.5 mm) | 4 dates: 25 May, 30 May, 6 Jun, 15 Jun 2023; sown 9 May; first date V1 (almost no weeds), last near full cover; herbicide 12 Jun | Marquardt, Potsdam, Germany; ONE field, about 1,840 m² | Semantic + instance masks (polygons, SAM-assisted, expert reviewed): maize, amaranth, barnyard grass, quickweed, weed other (6-class incl. background) or crop/weed (3-class); 156 images (104/26/26) | annotated central 600 x 600 px crops of RAW frames; 4 orthos unlabelled | Spatial split by field patch, never by date: same location never in two splits. One field. RGB here is the P4M's band stack, not a consumer RGB camera; 0.25 cm is far finer than our usual imagery |
| CropAndWeed (Steininger et al., WACV 2023) | [GitHub cropandweed-dataset](https://github.com/cropandweed/cropandweed-dataset), [AIT page](https://publications.ait.ac.at/en/datasets/cropandweed-dataset/), [paper](https://openaccess.thecvf.com/content/WACV2023/html/Steininger_The_CropAndWeed_Dataset_A_Multi-Modal_Learning_Approach_for_Efficient_Crop_WACV_2023_paper.html) | NON-COMMERCIAL only ("for non-commercial purposes"); AIT page: "All rights are reserved, including ... AI training" | more than 8k images, about 112k instances; storage not stated | camera and height not stated on the pages read (near-ground, not UAV, per the paper's framing; not verified) | 2019 to 2022 | region not stated on the pages read (Austria likely, AIT; not verified) | 74 crop and weed species; boxes with stem points, semantic masks; per-image soil, moisture, lighting tags; maize variants Maize1/Maize2 exist per the Hugging Face mirror (snippet) | near-ground photos | Licence rules out commercial use by Swardus; benchmark-only for internal research at most, check with a lawyer first |
| MatchPlant data (Sangjan et al., USDA-ARS) | [10.5281/zenodo.14856123](https://zenodo.org/records/14856123); paper 10.1016/j.atech.2026.102421 | CC BY 4.0 | 1.6 GB (images 1.2 GB) | 20 MP RGB on a UAV; height and GSD not stated | 2021 season; stage not stated | location not stated (USDA-ARS Plant Genetics Research Unit is in Columbia, Missouri; not verified) | Bounding boxes per maize plant, COCO; no weeds | undistorted frames, projected to an ODM orthomosaic | Stand/planting positions only, no weeds; research plots, not a commercial field |
| INRAE UAV multicrop plant counting (David et al.) | [Zenodo 4890370](https://zenodo.org/records/4890370); preprint 10.1101/2021.04.27.441631 | CC BY 4.0 | 844 MB | not stated on the record | not stated on the record | France (INRAE); about 16,247 labelled plants (snippet) | Bounding boxes per plant (snippet); maize, sugar beet, sunflower | not stated | No weeds; details only in the preprint |
| Maize Seedling Detection Dataset, MSDD | [arXiv 2509.15181](https://arxiv.org/abs/2509.15181); related [10.3390/agronomy16161605](https://doi.org/10.3390/agronomy16161605) | CC BY-NC-SA 4.0 (arXiv page) | not stated | aerial RGB; camera, height, GSD not stated | detection most reliable V4 to V6 | not stated | single / double / triple plant classes; no weeds | not stated | No download link found; non-commercial |

## Unverified candidates (page not fetched, or nothing usable on it)

| Candidate | What is claimed | Why unverified |
|---|---|---|
| Roboflow Universe [musa-hxuil/corn_weed](https://universe.roboflow.com/musa-hxuil/corn_weed) | CC BY 4.0, object detection, no description | imaging source (drone or handheld) unknown (snippet) |
| Roboflow Universe [emad-yousry/corn-weed](https://universe.roboflow.com/emad-yousry/corn-weed) | CC BY 4.0; bluegrass-weed, corn-crop, sedge-weed | no description; imaging source unknown (snippet) |
| Roboflow Universe [tps-klzw4/plent-ar3by](https://universe.roboflow.com/tps-klzw4/plent-ar3by) | public domain, weed and corn | no description (snippet) |
| Das et al. UAV object detection, Mendeley [10.17632/sx2tphzvcw.1](https://data.mendeley.com/datasets/sx2tphzvcw/1) | drone images 4096 x 3072, weed and crop | crop not confirmed as corn (snippet) |
| Agriculture-Vision (Chiu et al., CVPR 2020) | arXiv abstract (fetched): RGB + NIR aerial images "as high as 10 cm per pixel", 3,432 US farmlands, nine field-anomaly patterns; snippet: weed cluster is one of them, 94,986 chips of 512 x 512, splits 56,944 / 18,334 / 19,708 | platform, crops and licence not on the abstract; AWS registry says licence "provided in the bucket" (Intelinair) (snippet). At 10 cm/px it is field-pattern scale, coarser than all our drone imagery; [arXiv 2001.01306](https://arxiv.org/abs/2001.01306), [AWS registry](https://registry.opendata.aws/intelinair_agriculture_vision/) |
| MaSC raw maize frames + homographies (University of Missouri, 2024) | Phantom 4 Pro / Mavic 2 Pro video frames, 10 to 30 m, V2 to V10, on Google Drive; code on GitHub dek8v5/MaizeStandCounting_MaSC | paper fetched ([arXiv 2510.07580](https://arxiv.org/html/2510.07580v1), CC BY-NC-SA 4.0 for the paper), data licence and contents not checked; no weed labels |
| Velumani et al. 2021 maize plant boxes | 8 French sites, 0.3 cm, 3 to 5 leaves | data "available from the corresponding authors upon request" ([PMC8404552](https://pmc.ncbi.nlm.nih.gov/articles/PMC8404552/)): not public |
| WeedMap (Sa et al. 2018) | sugar beet, multispectral UAV orthos | note only: not corn |
| Plant Seedlings (Aarhus) | handheld top-down seedling photos incl. maize, 12 species | note only: single plants on trays/soil, not field overhead |
| Haug and Ostermann 2014 | carrot field robot images | note only: not corn |
| Kaggle / GitHub "corn weed dataset" | many small sets | not searched in depth this session |

## Recommended benchmark split

1. **Split by field and by acquisition, never by tile.** Tiles from one frame, or frames from one flight, share light,
   soil, stage and weed species; a random tile split measures memory, not generalisation. WeedsGalore already splits
   by field patch across dates (same location never in two splits), which is the model to copy.
2. **Hold out whole datasets.** Because USU-Corn-WeedDB and WeedsGalore are each one field, use one as development and
   the other as the held-out test, and Zenodo 5089956 (Texas, 2015) as a third held-out site for stand and rows.
3. **Report per stage and per GSD.** WeedsGalore's four dates give an early-to-closure series; report the first date
   (V1, almost no weeds) separately as a false-positive test.
4. **Resample to our GSD before scoring.** Both weed sets are 0.25 to 0.5 cm; our imagery is often 1 to 3 cm. Velumani
   showed downsampled fine imagery flatters results compared to native coarse imagery, so treat any score on
   downsampled data as an upper bound.
5. **Our use is algorithmic, not training.** Swardus trains no new models; these sets are scoring material for row,
   stand, cover and weed-segmentation rules.

## Licence notes

- CC BY 4.0 (USU-Corn-WeedDB, MatchPlant, INRAE 4890370) and CC BY (WeedsGalore data): commercial use allowed with
  attribution. Keep the citation with any derived figure.
- CC0: Zenodo 5089956.
- Non-commercial: CropAndWeed (and the AIT page reserves AI-training rights), MSDD (CC BY-NC-SA). Do not use in the
  product or in published product claims.
- Roboflow Universe sets: per-project licence; many are re-uploads of other sets without provenance, so check origin
  before relying on the stated licence.
