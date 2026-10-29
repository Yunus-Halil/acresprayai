# Swardus Direct: Hugging Face research and technology audit (2026-10-28)

A preliminary engineering review of Hugging Face datasets, models and research assets against the Swardus Direct
pipeline as it is in this repository today. No production code was changed for this audit. The licence
classifications are an engineer's reading of the published terms, not legal advice; every YELLOW item names what
a lawyer would have to confirm.

Method: four parallel sweeps of the Hugging Face API (UAV datasets, crop and weed detection models, geospatial
reconstruction assets, foundation models), about 90 dataset and 45 model search terms, each candidate verified by
its file tree, card, licence file and linked paper rather than by the card's claims; byte-range reads of image
headers (EXIF, XMP, GeoTIFF tags) and parquet shard heads where geolocation had to be checked in the files
themselves. Then every finding was compared against the code in `src/lib/directGeoref`, `src/lib/fieldTwin` and
`research/weed-vision-lab`. About 46 MB were downloaded in total, no archives; no Swardus code, imagery,
credentials or customer data left this machine.

## Executive summary

1. **Nothing on Hugging Face replaces a Swardus component outright.** No model is trained on centimetre-scale
   nadir drone imagery of fields with a clean licence; no crop-row model or dataset exists there at all; the
   drone-scale field-boundary model (Delineate Anything) is AGPL; the learned feature matchers solve a harder
   problem than Swardus's soil-texture correlation and would be slower on a CPU, not faster.
2. **The one asset that changes a product decision is infrastructure, not weights:** the OpenVINO INT8 and
   rfdetr.cpp GGUF builds of RF-DETR Seg-Large (Apache-2.0) show that a Seg-L-class model fits in 34 to 45 MB for
   CPU inference. Re-exporting Swardus's own PhenoBench fine-tune that way is the realistic "laptop without a GPU"
   model tier. Neither repo publishes CPU timings; they have to be measured here.
3. **Three dataset families supply what Swardus Direct actually needs: raw overlapping frames with absolute GPS,
   gimbal angles and DJI calibration under CC BY 4.0.** The su-fmi Phantom 4 Multispectral sunflower series
   (2025: RTK-fixed, PPK files, 50 m flights, 2.6 cm/px; 2024: emergence to maturity at 2 to 40 m; 2023: 41
   dates), the AIDroneMap vineyard flight (Mavic 3 Multispectral RGB JPEGs, RTK-fixed to 3 cm, 1.06 cm/px, 145
   frames), and, inside AgML's parquet shards, ImageWeeds-aerial (North Dakota weeds at 2.5 m) and the Texas
   cotton weed set (Autel at 15 m) whose original EXIF and XMP survive. None is corn, soybean or wheat with
   annotations and GPS together.
4. **The best annotated row-crop sets ship no geolocation on Hugging Face.** WeedsGalore (maize, 2.5 mm/px,
   CC BY 4.0) and PhenoBench (sugar beet, 1 mm/px) are 600 and 1024 px crops without EXIF; their orthomosaics
   and originals live at GFZ and phenobench.org. They remain per-photograph benchmarks, not twin-level ones.
5. **PhenoBench's licence is a loose end for Swardus's own model.** The site says CC BY-SA 4.0; the README inside
   the official zip says CC BY-NC-SA 4.0. Swardus's RF-DETR checkpoint is fine-tuned on it. Attribution is owed
   either way; whether share-alike or non-commercial propagates to weights is unsettled and needs legal review
   before the model tier ships to paying customers.
6. **Most weed checkpoints on Hugging Face are unusable commercially:** Ultralytics-trained files inherit
   AGPL-3.0 (Ultralytics: "All Ultralytics YOLO trained models fall under the AGPL-3.0 License by default"),
   SegFormer fine-tunes inherit NVIDIA's non-commercial source licence, CropAndWeed derivatives inherit a
   non-commercial clause that names trained models as derivative works, and the closest drone match
   (smAIL-WS, Mavic 2 Pro at 1 mm/px, crop versus weed) has no licence at all.
7. **DINOv2 (Apache-2.0) is the one foundation asset with a published drone-weed result** (Picon et al.
   2025: frozen DINOv2 features, vegetation-versus-soil confusion as the main failure under ground-to-drone
   shift), which is exactly Swardus's weed-versus-crown-shoot-versus-soil-versus-shadow problem. A small
   embedding head from the operator's own verdicts is the cheapest experiment with real upside; it belongs in the
   desktop tier, not the 50 ms laptop tier.
8. **Zero-shot proposals on a new crop are available under Apache-2.0** (Grounding DINO, OWLv2, SAM 2.1; Florence-2
   under MIT) but have no published results on nadir drone weeds and cost GPU time. SAM 3 and DINOv3 are
   stronger and carry Meta's custom, revocable licences (YELLOW).
9. **Satellite and geospatial foundation models (Prithvi, Clay, DOFA, SatMAE, DINOv3-SAT, AgriFM) do not apply
   at 1 cm/px**; the DINOv3 paper shows a plain web-image backbone beating them on their own benchmarks. This
   closes the question rather than opening it.
10. **Terrain, which Swardus ignores (flat ground plane), has no cheap learned answer.** The metric route needs no
    model: per-tie-point heights in the existing bundle adjustment. Depth Anything V2 Small (Apache, ONNX in the
    browser) can flag slope; Depth Anything 3 Small/Base with pose conditioning could return a coarse terrain in
    minutes on a CPU; MapAnything is the only model that ingests RTK poses and returns metric geometry, at
    1.2 B parameters.

## 1. Swardus Direct as it stands (from the code, not the roadmap)

### 1.1 Pipeline and methods

| Stage | Where | Method | Measured on the 71-photograph apricot flight (Phantom 4 RTK, 5472 × 3648, 0.98 cm/px at 36 m) |
|---|---|---|---|
| Photographs | `build/photos.ts`, `browserPhotos.ts`, `tiffPhotos.ts` | DJI JPEG (EXIF + drone-dji XMP: RTK position, altitude, gimbal angles, calibrated focal length, dewarp), the camera's 960 × 640 MPF preview for the cheap stages; since this evening RGB TIFF and DJI P4 Multispectral band sets (geotiff.js) | 1.5 s in the browser (preview), 3 s in Node |
| Cameras | `directGeoref/soilTies.ts`, `fft.ts`, `adjust.ts`, `build/cameras.ts` | Pinhole on a flat ground plane at take-off height; photographs aligned to each other by phase correlation of bare-soil texture windows (64² at 4 to 6 cm); Levenberg-Marquardt with 4 flight-wide + 5 per-photo parameters (east, north, yaw, two tilts, 1° prior) | 9 s with 6 helper workers, 26 s with one; ties agree to 6 to 7 cm (held-out 7.5 cm) |
| Rows and trees | `build/rows.ts`, `weedVision/fieldRows.ts`, `weedVision/layout/plantingLayout.ts` | Rule-based tree-row reader and planting-layout fitter (lattice from three positions, grown on an 8 cm raster of green, shadow and cover); trees reconciled across photographs by ray intersection; rows as peaks of across-offsets, kept on evidence | 4 s; 1,037 trees, 13 rows |
| Weeds, model tier | `build/weeds.ts`, `weedVision/client.ts`, the service in `research/weed-vision-lab` (Flask, PyTorch ROCm) | RF-DETR Seg-Large (36 M parameters, 504 px input) fine-tuned on PhenoBench, 1024 px tiles at 128 px overlap, confidence 0.5; answers cached by file digest | 8.4 s per photograph on an RX 9060 XT (10 min per flight); about 4 h on a 4-core CPU; 230 of 414 hand-labelled weeds found at twin level |
| Weeds, colour tier (no model) | `directGeoref/green.ts`, `build/weeds.ts` | ExGR relative to the soil level of each tile, 1-pixel cells, a contrast rule for tiny patches, crown discs cut out and swept through the tree height, patches split at distance-transform peaks | 50 ms per photograph; 312 of 414 labelled weeds at twin level, with three times the model's candidate count (labels not exhaustive) |
| Reconciliation | `directGeoref/reconcile.ts` | Sightings linked when their rays meet (miss under 10 cm + a quarter of the size), one per photograph, union-find; the colour tier links by ground-outline overlap and absorbs pieces; position = the point nearest all rays; verified = seen in 2+ photographs | 1 s (model), about 60 s for 175 k colour patches |
| Boundary | `fieldTwin/boundary.ts`, `boundaryEvidence.ts` | Rows + photographs: an evidence raster (soil, canopy, cover, road, foreign, unseen) sampled from the nearest-nadir photograph; probes from row ends and outer rows; blocks of rows scored; confidence per vertex; failure codes; never an operational limit until accepted | 0.17 s; 1.361 ha, confidence 0.89 |
| Pressure and zones | `fieldTwin/intelligence.ts`, `pressure/grade.ts`, `heatmap.ts` | Percent cover of verified candidates per 2 m treatment unit, fixed bands, grade by crop group at published action points, scouting regions by cover | 0.1 s |
| Opening | `fieldTwin/scene.ts`, the canvas renderer | One canvas, polygons drawn as themselves, twin.json gzipped at rest | 9 MB (model tier), 26 MB (colour tier) |

The browser build of the apricot flight (colour tier, six helpers) reaches a twin in about 21 s plus the atlases
a few seconds later; with the rebuilt colour tier expect under a minute. The "15 seconds" in the brief is the
right order of magnitude for the cameras-and-rows core, not for a model-tier build.

### 1.2 Dependencies that matter for integration

- Browser: TypeScript, Web Workers (an ES-module build worker plus a pool of helpers), `createImageBitmap` /
  `OffscreenCanvas` for JPEG, `geotiff@3` for TIFF, `onnxruntime-web@1.30` already in the bundle (the Weed Scout
  classifier), `piexifjs` for EXIF. No PyTorch, no OpenCV in the product.
- Node scripts: `jpeg-js`, the same TypeScript stages; `vite-node`.
- The weed service (dev only): Python, Flask, PyTorch on ROCm, `rfdetr` (Apache-2.0 code), the PhenoBench devkit
  (MIT). The service is not deployed with the product; the live site builds twins without a model.
- Supabase storage for twins; no GPU anywhere in production.

### 1.3 Supported imagery

DJI JPEGs with the drone-dji XMP block (RTK or plain GPS, gimbal angles, calibrated focal length) are the only
fully exercised input. RGB TIFFs and DJI multispectral band sets were added this evening and are not yet tested on
a real set. Images without a position, a relative altitude or gimbal angles are refused with the reason. Direct has
no orthomosaic path (the app's separate ortho import exists for GeoTIFFs).

### 1.4 What is validated and what is not

- Validated by measurement: camera alignment (held-out ties 7.5 cm); the boundary (a benchmark with ablations,
  no hand-drawn reference); the weed tiers against 414 hand labels on one photograph (not exhaustive).
- Validated by Yunus's eye: the planting layout on the real apricot map (2026-10-21).
- Not validated: any field other than the apricot orchard (one site, one date, bare soil, one camera); grassed
  orchards and row crops at map scale; the TIFF path; the model tier's precision; terrain (the ground is a
  plane); the multispectral band alignment's sign.

### 1.5 Where an external asset would plug in

| Interface | File | What an asset must provide |
|---|---|---|
| `PhotoSource` | `build/types.ts` | header bytes, decode at a ratio, preview, crops; any format that yields DJI-style metadata |
| `WeedDetector` | `build/types.ts`, `weedVision/client.ts` | per-photograph instances with pixel centroid, area, polygon, class, score; optionally a tile list |
| Observations → `reconcile` | `directGeoref/reconcile.ts` | pixel centroid, equivalent diameter, outline; anything per photograph becomes a twin object |
| Row/tree reader | `build/rows.ts` | per-photograph tree positions and crown radii, or rows as lines |
| Camera alignment | `build/cameras.ts` | pixel-to-pixel ties between overlapping photographs (`SoilTie`): any matcher's correspondences could replace or add to the phase-correlation ties |
| Evidence classes | `fieldTwin/boundaryEvidence.ts` | per-cell classes of the ground (soil, cover, road, canopy) |

### 1.6 Bottlenecks today

1. The model tier's cost (8 s per photograph on a GPU, hours on a CPU) and its domain (sugar-beet ground-robot
   training data applied to orchard drone imagery).
2. Weed-versus-crown-shoot discrimination near trees, where the colour tier and the model both raise candidates.
3. The flat-ground assumption: a sloped field would shear the alignment.
4. One site: every rule carries the apricot field's numbers.
5. Twin size with the colour tier (26 MB).

## 2. Ranked dataset inventory

"GPS verified" means the agent read it from an actual file in the repository (EXIF via PIL, XMP by regex, GeoTIFF
tags, or the first JPEG inside a parquet shard); "documented" means the card or paper says so and no file was
read; "none" means a file was read and carries nothing. GSD marked "computed" is RelativeAltitude divided by
CalibratedFocalLength from the XMP of one sample image.

| # | Dataset | GPS and pose in the files | Licence | Images | GSD | Crop, place | Swardus use |
|---|---|---|---|---|---|---|---|
| 1 | [AIDroneMap/aidm-vineyard](https://huggingface.co/datasets/AIDroneMap/aidm-vineyard) ([-small](https://huggingface.co/datasets/AIDroneMap/aidm-vineyard-small)) | **Verified**: EXIF GPS + full DJI M3M XMP, RtkFlag 50 (fixed, σ 2.6 / 3.2 / 5.5 cm), NTRIP fields, UTCAtExposure, DewarpData | GREEN CC BY 4.0 (LICENSE file + manifest; attribution "AIDroneMap, provided by ITALDRONI") | 145 (73 small) loose JPG 5280 × 3956, 1.63 GiB | 1.06 cm/px computed at 39.6 m | vineyard, Italy, 2024-12-24 (dormant), no annotations | A second site through the twin builder: same input as the apricot flight (RTK JPEG), rows of vines, grass between rows (the colour tier's known weak case) |
| 2 | [su-fmi/sunflower-density-estimation-2025](https://huggingface.co/datasets/su-fmi/sunflower-density-estimation-2025) | **Verified**: EXIF GPS + DJI XMP, RtkFlag 50 (σ ≈ 3 cm), PPK files (.obs, .MRK, .bin), georeferenced orthos (.tfw, .prj EPSG:4326) | GREEN CC BY 4.0 (card and README "Use Constraints: CC BY 4.0") | about 1,700 JPG + 8,750 band TIF, 4 dates | 2.6 cm/px computed at 50 m; 3 / 5 / 10 m point sets 0.16 to 0.5 cm/px | sunflower, one field, Bulgaria, May to June 2025 (emergence to 14 cm) | The first real P4 Multispectral set for the new TIFF band path; RTK overlap flights for the camera solver at a coarser pixel |
| 3 | [su-fmi/sunflower-density-estimation-2024](https://huggingface.co/datasets/su-fmi/sunflower-density-estimation-2024) | **Verified**: EXIF GPS + DJI XMP, RtkFlag 16 (no fix, σ 1 to 2.7 m), PPK raw per flight (re-processable), orthos | GREEN CC BY 4.0 | 1,392 JPG + 7,416 TIF, 12 dates | 6.3 cm/px at 120 m; 2 / 5 / 10 / 20 / 40 m sets 0.1 to 2.1 cm/px | sunflower, Bulgaria, April to July 2024 (3 to 172 cm plants) | Growth stages for the row reader; a metre-level-GPS flight to test the solver's reliance on RTK |
| 4 | [Project-AgML/ImageWeeds_aerial_weed_detection](https://huggingface.co/datasets/Project-AgML/ImageWeeds_aerial_weed_detection) | **Verified inside parquet**: original JPEG bytes keep EXIF GPS + DJI XMP (FC6310S, RelativeAltitude 2.5 m, gimbal −90°, RtkFlag 0) on the first image of one shard | GREEN CC BY 4.0 (card + Mendeley 10.17632/8kjcztbjz2.2) | 551 images 5472 × 3648, 2,388 boxes, 5 weed classes | about 0.07 cm/px computed at 2.5 m | weeds in North Dakota fields, Phantom 4 Pro V2, 2021 | A second labelled per-photograph benchmark for the colour rules and the model, on a different soil and camera height |
| 5 | [Project-AgML/cotton_weed_detection](https://huggingface.co/datasets/Project-AgML/cotton_weed_detection) | **Verified inside parquet**: EXIF GPS, Autel XMP Camera:Yaw/Pitch, AboveGroundAltitude 14.97 m, EPSG:4326 | GREEN CC BY 4.0 (card + Mendeley 10.17632/sx2tphzvcw.1) | 262 images 4096 × 3072, 50,812 boxes (weed / cotton) | not documented; about 0.4 to 0.5 cm/px at 15 m (estimate) | cotton early to mid stage, Texas Panhandle, Autel EVO II Dual 640T V3, May 2024 | Dense boxes on a row crop at a Swardus-like height; a non-DJI header (Autel pitch convention differs: 0 = nadir) |
| 6 | [Voxel51/weeds-galore](https://huggingface.co/datasets/Voxel51/weeds-galore) (+ [Project-AgML mirror](https://huggingface.co/datasets/Project-AgML/WeedsGalore_maize_segmentation)) | **None**: 600 × 600 PNG tiles without metadata chunks; orthomosaics (12 GB) only at GFZ | GREEN CC BY 4.0 (card; GitHub "distributed under the Creative Commons Attribution (CC BY) Licence") | 156 tiles (780 rows with bands) | 2.5 mm/px documented at 5 m | maize, one field, Potsdam, 4 dates May to June 2023, P4 Multispectral | Species-level masks on maize for the colour tier's per-photograph bench; already on this machine (D:) |
| 7 | [Project-AgML/USU-Corn-WeedDB_detection](https://huggingface.co/datasets/Project-AgML/USU-Corn-WeedDB_detection) | **None** in the HF tiles; full-resolution frames only in the Zenodo zip (GPS not verified) | GREEN CC BY 4.0 (card + Zenodo 20044178) | 800 tiles 640 × 640, 10,539 boxes, 3 weed species | 0.48 cm/px documented at about 10 m | forage corn, Utah, 2025-06-27, Autel | The only corn weed set with boxes at a Swardus-like GSD; the Zenodo originals (2.4 GB) may carry GPS |
| 8 | [Project-AgML/sugar_beet_weed_detection](https://huggingface.co/datasets/Project-AgML/sugar_beet_weed_detection) (PaimioSB2023) | **None** in the HF tiles; raw drone zips at Zenodo (not verified) | GREEN CC BY 4.0 (card + Zenodo 10716274) | 18,593 tiles 1280 × 1280, 338 k boxes | not documented; Parrot Anafi at 4 m | sugar beet seedlings, Finland, June and July 2023 | Volume of labelled seedlings for a small-object benchmark |
| 9 | [Voxel51/PhenoBench_Raw](https://huggingface.co/datasets/Voxel51/PhenoBench_Raw) (+ AgML and other copies) | **None**: 1024 × 1024 PNG crops; the paper says originals are GNSS-georeferenced but they are not released | YELLOW: site CC BY-SA 4.0, README in the official zip CC BY-NC-SA 4.0 (conflict + share-alike) | 2,872 crops (1,407 / 772 / 693) | 1 mm/px documented at 21 m (PhaseOne iXM-100) | sugar beet, Klein-Altendorf, 3 dates 2020 (+ 2021 test field) | Already the training set of Swardus's model; the licence loose end in the summary |
| 10 | [su-fmi/msi-drone-crop-surveys](https://huggingface.co/datasets/su-fmi/msi-drone-crop-surveys) | **Verified**: EXIF GPS + DJI XMP in the JPG and in each band TIF (RtkFlag 16), orthos; the TIFF's IFD sits after the pixels (offset 4,160,008 of 4,177,249 bytes), as `tiffHeader.ts` assumes | GREEN CC BY 4.0 | 17,052 captures (1 JPG + 5 TIF), 259 flights, 41 dates; about 373 GB raw + 78 GB orthos | 6.3 cm/px computed at 120 m | sunflower, Bulgaria, April to September 2023 | Multi-temporal test material; too coarse for weeds |
| 11 | [KaraAgroAI/Drone-based-Agricultural-Dataset-for-Crop-Yield-Estimation](https://huggingface.co/datasets/KaraAgroAI/Drone-based-Agricultural-Dataset-for-Crop-Yield-Estimation) | **Documented only** (datasheet: "all images have location information (GPS coordinates) and timestamps") | GREEN CC BY 4.0 (card + datasheet) | 8,784 (Ghana, 16000 × 13000) + 6,086 (Uganda, 4000 × 3000); zips 3.75 + 4.34 + 11.1 + 17.7 GB | not documented; 2 to 10 m, oblique and top views | cashew, cocoa, coffee trees | Tree crops under canopy; oblique views do not suit the nadir pipeline |
| 12 | [Project-AgML/CoFly-Weed-DB_weed_segmentation](https://huggingface.co/datasets/Project-AgML/CoFly-Weed-DB_weed_segmentation) | not verified; the source says nothing about GPS | YELLOW: card and Zenodo CC BY 4.0, GitHub repository GPL-3.0 | 201 images 1280 × 720, 3 weed classes, masks | not documented; P4 Pro at 5 m | cotton, Greece | Small; licence conflict to resolve with the authors |
| 13 | [Project-AgML/Sesame_Aerial_weed_segmentation](https://huggingface.co/datasets/Project-AgML/Sesame_Aerial_weed_segmentation) | not verified; 480 × 352 patches | GREEN CC BY 4.0 | 160 patches | 0.33 cm/px documented at about 4.6 m | sesame and tobacco, Pakistan, 2020, NGB camera (no red band) | Marginal: no red band, patches |
| 14 | [Arvin26/soybean-pest-resistance-orthomosaic](https://huggingface.co/datasets/Arvin26/soybean-pest-resistance-orthomosaic) | **Not verified** (gated 401); the tree shows 484 to 643 raw `UAV IMAGES/DJI_NNNN.JPG` per flight, ODM orthos with .tfw, plot boundaries .gpkg | YELLOW: CC BY 4.0 but manual gating with terms the agent could not read | 7,396 JPG, 22 orthos, 76 GB, 12 flights | not documented | soybean, 30 genotypes, Brazil, January to April 2025 | The only soybean raw-frame series with a permissive tag; request access and read the terms |
| 15 | [Project-AgML/maize_seedling_msdd_detection](https://huggingface.co/datasets/Project-AgML/maize_seedling_msdd_detection) / [dek8v5/MSDD](https://huggingface.co/datasets/dek8v5/MaizeSeedlingDetectionDataset_MSDD) | **None**: 1920 × 1920 PNG fragments cut from video; the paper used homography, no GPS | RED CC BY-NC-SA 4.0 (dek8v5 README and arXiv); the AgML copy says "unknown" | 3,152 frames, 163,921 boxes | about 0.5 cm/px at 4.5 m documented | maize nurseries V2 to V12, Missouri, 2019 to 2022 | Research-only: stand counting at emergence (the Taranis strength to match) |
| 16 | [Arvin26/Mavic3M-Anhumas-Soybean-breeding-2026](https://huggingface.co/datasets/Arvin26/Mavic3M-Anhumas-Soybean-breeding-2026) | **Not verified** (gated); tree shows M3M band TIFs + RGB JPG + PPK .nav/.obs/.bin/.MRK per flight | RED CC BY-NC-ND 4.0 | 37,268 TIF + 8,355 JPG, 20 flights, about 450 GB | 10 m AGL documented | soybean plots, Brazil, 10 dates 2026 | Research-only: the richest multi-date PPK row-crop series found |
| 17 | [viarias/remote_sensing_2018_weedmap](https://huggingface.co/datasets/viarias/remote_sensing_2018_weedmap) (WeedMap) | script-only loader pulling ETH zips; georeferencing not verified; no raw frames | YELLOW: loader says GPL-3.0; the ETH record returned HTTP 500 twice | 766 + 204 RedEdge, 428 + 272 Sequoia tiles | about 1 cm documented | sugar beet, Switzerland and Germany, 2017 | Multispectral tiles; licence unverified |
| 18 | [Project-AgML/UAV_weed_plant_detection](https://huggingface.co/datasets/Project-AgML/UAV_weed_plant_detection) | **None**: 8192 × 5460 JPEGs without APP1 | GREEN CC BY 4.0 (4TU) | 2,507 images, 2,972 boxes | not documented | artificial plants placed in grass, Wageningen, 2024 | Not weeds; a small-object detection curiosity |
| 19 | [Terrygz/Fast-Lodging-Detection](https://huggingface.co/datasets/Terrygz/Fast-Lodging-Detection) | **Verified GeoTIFF** tags (ModelPixelScale 0.0609 m, WGS 84 / UTM 45N) on grid tiles; raw frames on Baidu only | RED / unknown: no licence anywhere | 22,010 tiles about 529 × 526 | 6.1 cm/px | lodging, China, 2024 and 2025 | Not usable, off-topic |
| 20 | [links-ads/gaia-vineyard-uav-dataset](https://huggingface.co/datasets/links-ads/gaia-vineyard-uav-dataset) | **None**: 141 PNG orthoimage crops, only gsd.csv | RED / unknown: no licence, no card | 141 PNG, 3 winemakers × 11 to 12 dates | 1.5 to 10 cm from gsd.csv | vineyards, Spain, Portugal, Italy | Not usable |
| 21 | [Voxel51/CropAndWeed](https://huggingface.co/datasets/Voxel51/CropAndWeed) | not UAV (ground rig), no GPS | RED custom non-commercial ("you may not use the dataset or any derivative work for commercial purposes") | 8,034 images + masks | n/a | 74 species, Austria | Research-only; it also taints every model trained on it |
| 22 | [Project-AgML/soybean_weed_uav_brazil](https://huggingface.co/datasets/Project-AgML/soybean_weed_uav_brazil) | **None**: SLIC superpixel segments | RED CC BY-NC 3.0 | 15,336 segments from 400 UAV images | not documented | soybean, Brazil, 2017 | Research-only |
| 23 | [Project-AgML/MTDC_Maize_Tassels_Detection_Counting_Dataset](https://huggingface.co/datasets/Project-AgML/MTDC_Maize_Tassels_Detection_Counting_Dataset) | **None**; the "UAV" claim is doubtful (fixed cameras by the file names) | GREEN CC BY 4.0 | 361 images, 13,564 tassels | n/a | maize tassels, China | Off-topic |
| 24 | [Project-AgML/ws_dino_weed_segmentation](https://huggingface.co/datasets/Project-AgML/ws_dino_weed_segmentation) | not verified | GREEN CC BY 4.0 | 19 images | not documented | sugar beet and sorghum, Germany, DJI | Too small |
| 25 | [Project-AgML/weed_crop_detection](https://huggingface.co/datasets/Project-AgML/weed_crop_detection) (NDSU 13-class) | EXIF shows a Canon camera and a Windows photo editor: handheld | GREEN CC BY 4.0 | 1,120 images, 17,693 boxes | n/a | 8 crops + 5 weeds, North Dakota | Species reference, not drone |

Also seen and set aside (not UAV, or not imagery): the three-season and cross-season weed sets (smartphone; the
latter CC BY-NC), MH_Weed16 (handheld), maize_weed_detection (Nigeria, re-saved without EXIF), paddy_weed,
weed_segmentation_france (robot), sugarbeet_weed_segmentation (Bonn robot, GPL-3), the Latvian handheld set
under three names, CitrusFarm (ground robot), MaizeField3D and other 3D sets (NC or point clouds only), the
BonsaiRobotics vineyard video (NC), GWHD (ground rigs), and a gated non-agricultural photogrammetry sample under
a custom evaluation licence.

Where the key part is not on Hugging Face: WeedsGalore's orthomosaics and 16-bit bands at
https://doidata.gfz.de/weedsgalore_e_celikkan_2024/ (CC BY 4.0); PhenoBench's 129 k unlabelled patches and the
official zip at phenobench.org; USU-Corn-WeedDB's full-resolution frames at Zenodo 20044178 (CC BY 4.0, 2.4 GB);
PaimioSB2023's raw drone zips at Zenodo 10716274 (CC BY 4.0). The earlier memory of verified raw-frame sets on
Zenodo and ETH (corn, soybean, wheat, cotton; `public-crop-drone-datasets`) still stands beside this list and is
not on Hugging Face.

## 3. Ranked model inventory

| # | Model | Task | Licence | Weights present | Training domain | Reported figure (source) | Swardus use |
|---|---|---|---|---|---|---|---|
| 1 | RF-DETR Seg family: [Roboflow/rf-detr-seg-large](https://huggingface.co/Roboflow/rf-detr-seg-large), [OpenVINO/rfdetr_seg_large-int8-ov](https://huggingface.co/OpenVINO/rfdetr_seg_large-int8-ov), [mudler/rfdetr-cpp-seg-large](https://huggingface.co/mudler/rfdetr-cpp-seg-large) (GGUF), [onnx-community/rfdetr_medium-ONNX](https://huggingface.co/onnx-community/rfdetr_medium-ONNX) | Instance segmentation (COCO heads; the base Swardus fine-tunes) | GREEN (Apache-2.0 code and Seg weights; DINOv2 backbone Apache-2.0; only the XL/2XL detection and the Plus package are PML 1.0) | Yes: safetensors 145 MB; OpenVINO INT8 34 MB; GGUF q8 45 MB, q4_K 36 MB; ONNX fp32 121 / int8 33 MB | COCO | Seg-L 47.1 AP on COCO, 8.8 ms on a T4 with TensorRT (README); GGUF q8 mask IoU 0.994 against PyTorch on 7 images; no CPU latency anywhere | The CPU model tier: re-export Swardus's PhenoBench checkpoint to OpenVINO INT8 (nncf) or GGUF (rfdetr.cpp) and measure |
| 2 | [facebook/dinov2-small](https://huggingface.co/facebook/dinov2-small), [dinov2-base](https://huggingface.co/facebook/dinov2-base) | Self-supervised backbone, 22 M / 87 M, patch 14 | GREEN Apache-2.0 | Yes | LVD-142M web photos | Picon et al. 2025 (arXiv 2508.07514): frozen DINOv2 species F1 0.44 under ground-to-drone shift against 0.14 for DeepLabV3+; vegetation-class F1 0.88; failures "stem primarily from vegetation–soil confusion" | Frozen patch embeddings + a small head from operator verdicts: weed versus crown shoot versus soil versus shadow; anomaly maps; desktop tier (7 to 20 s per photograph on a CPU for ViT-S, estimate) |
| 3 | XFeat (+ LighterGlue): [vismatch/xfeat](https://huggingface.co/vismatch/xfeat), [litert-community/xfeat-litert](https://huggingface.co/litert-community/xfeat-litert), [kornia/xfeat](https://huggingface.co/kornia/xfeat) | Keypoints and descriptors for tie points | GREEN Apache-2.0 (code and weights) | Yes; 1.4 MB fp16 TFLite | MegaDepth | 27 FPS at VGA on an i5-1135G7 (paper); AUC@5 42.6 / 50.2 | Fallback ties where the soil-texture correlation peak is weak (grass, shadow edges); an ONNX and a LiteRT build exist for the browser |
| 4 | [facebook/sam2.1-hiera-tiny](https://huggingface.co/facebook/sam2.1-hiera-tiny) / small | Promptable segmentation | GREEN Apache-2.0 | Yes | SA-1B, SA-V | General purpose | Tight outlines from a box or click; class-agnostic region proposals; a click-drawn boundary |
| 5 | LightGlue + ALIKED / DISK: [vismatch/aliked-lightglue](https://huggingface.co/vismatch/aliked-lightglue), [bukuroo/ALIKED-LightGlue-ONNX](https://huggingface.co/bukuroo/ALIKED-LightGlue-ONNX), [ETH-CVG/lightglue_disk](https://huggingface.co/ETH-CVG/lightglue_disk) | Learned matcher with context | GREEN (LightGlue Apache-2.0 weights and code; ALIKED BSD-3; DISK Apache); SuperPoint variants RED | Yes; ONNX graphs | MegaDepth | Matcher 20 FPS at 512 keypoints on an i7 (GitHub); DISK 1.2 FPS at VGA on an i5 | Same role as XFeat with more context; heavier extractor |
| 6 | [IDEA-Research/grounding-dino-tiny](https://huggingface.co/IDEA-Research/grounding-dino-tiny) / base | Open-vocabulary detector, 172 M / 233 M | GREEN Apache-2.0 | Yes | O365, GoldG, Cap4M | 52.5 AP COCO zero-shot (card) | Zero-shot proposals on a new crop (GPU); no drone-weed result published |
| 7 | [google/owlv2-base-patch16-ensemble](https://huggingface.co/google/owlv2-base-patch16-ensemble) | Open-vocabulary detector, 155 M, 960 px | GREEN Apache-2.0 | Yes; ONNX exports | CLIP data + COCO/OpenImages heads | none on the card | As 6, plus image-conditioned queries: "find more like this patch" from one operator mark |
| 8 | [depth-anything/Depth-Anything-V2-Small-hf](https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf), [onnx-community/depth-anything-v2-small](https://huggingface.co/onnx-community/depth-anything-v2-small) | Monocular relative depth, 25 M | GREEN Apache-2.0 for Small (Base and Large CC BY-NC) | Yes; ONNX for the browser | general | none on the card | An "is the ground flat?" prior per frame; not metric |
| 9 | [depth-anything/DA3-SMALL](https://huggingface.co/depth-anything/DA3-SMALL), [DA3-BASE](https://huggingface.co/depth-anything/DA3-BASE), [DA3METRIC-LARGE](https://huggingface.co/depth-anything/DA3METRIC-LARGE) | Any-view depth and pose with pose conditioning | GREEN for these sizes (LARGE-1.1 conflicting; GIANT and NESTED CC BY-NC) | Yes | general | beats VGGT "by an average of 44.3 % in camera pose accuracy" (abstract) | A coarse terrain over the flight from RTK poses, minutes on a CPU (estimate) |
| 10 | [microsoft/Florence-2-base](https://huggingface.co/microsoft/Florence-2-base) / large | Seq2seq VLM with detection and grounding | GREEN MIT | Yes; ONNX exports | FLD-5B | zero-shot COCO mAP 34.7 / 37.5 | Cheapest open-vocabulary detector on a GPU; weak on small objects, 768 px |
| 11 | [somaankhan/Weedsgalore-Unet](https://huggingface.co/somaankhan/Weedsgalore-Unet) | Semantic segmentation, 6 classes (maize + 4 weed classes) | GREEN licence (MIT weights; WeedsGalore CC BY 4.0) / YELLOW on verification (no architecture code, unknown input channels) | Yes: 31 MB state dict | UAV maize at 2.5 mm/px (P4M at 5 m) | "98 % pixel acc, 0.42 mIoU" (self-reported, one line) | Cheap to try, low expected transfer (4× finer pixels than Swardus, one field) |
| 12 | [weecology/deepforest-tree](https://huggingface.co/weecology/deepforest-tree) | Tree crown detection | GREEN MIT | Yes: 129 MB | airborne NEON RGB (about 10 cm/px, prior knowledge) | none on the card | Already trialled in this repository on the olive and apricot orchards (`docs/research/deepforest-*`); the row-based crown reader was kept |
| 13 | Fields of the World: [fieldsoftheworld/ftw-q](https://huggingface.co/fieldsoftheworld/ftw-q), [ftw-prue-ccby](https://huggingface.co/fieldsoftheworld/ftw-prue-ccby) | Field-boundary segmentation from Sentinel-2 | GREEN CC BY 4.0 (the "full" and PlanetScope checkpoints RED) | Yes; ONNX with dynamic size | 10 m Sentinel-2 | object F1 0.526 (card) | A coarse parcel prior where the rows run out; nothing at centimetre scale |
| 14 | Efficient LoFTR: [zju-community/efficientloftr](https://huggingface.co/zju-community/efficientloftr) | Detector-free semi-dense matcher | YELLOW (HF weights Apache; GitHub licence changed 2026-09-15 to a registration licence) | Yes | MegaDepth | AUC@5 56.4 against SP+LG 49.9 | Best matcher on low texture; no CPU figure; registration obligation |
| 15 | [facebook/dinov3-vits16-pretrain-lvd1689m](https://huggingface.co/facebook/dinov3-vits16-pretrain-lvd1689m), ConvNeXt-T | Self-supervised backbone | YELLOW ("DINOv3 License": royalty-free, no non-commercial clause, must ship the Agreement, revocable on breach, gated) | Yes (gated) | LVD-1689M | on weeds no better than DINOv2 (arXiv 2511.04288: F1 0.91 against 0.91) | Only if DINOv2 proves too weak; the legal review is the cost |
| 16 | [facebook/sam3](https://huggingface.co/facebook/sam3) | Promptable concept segmentation, 860 M | YELLOW ("SAM License", custom, gated) | Yes (gated) | 4 M-concept web data | LVIS 48.5 mask AP (README) | Offline label bootstrapping on a GPU; not a product path |
| 17 | [facebook/map-anything-apache](https://huggingface.co/facebook/map-anything-apache) | Metric multi-view reconstruction taking poses and intrinsics | GREEN Apache-2.0 | Yes: 4.9 GB | mixed | "outperforms or matches specialist feed-forward models" (paper) | Terrain from RTK poses, server-side only (1.23 B parameters) |
| 18 | [pasqualedem/DistillFSS_WeedMap_DCAMA_5shot](https://huggingface.co/pasqualedem/DistillFSS_WeedMap_DCAMA_5shot) | Few-shot weed segmentation, 138 M | YELLOW (MIT weights and code; the DCAMA teacher has no licence file; WeedMap licence unverified) | Yes: 555 MB | WeedMap sugar beet, multispectral | mIoU 44.4 at 5 shots against 51.0 for plain fine-tuning; 62.0 against 64.2 at 50 shots (README) | A data point, not a model: few-shot lost to plain fine-tuning on the one weed set |
| 19 | [haiquanua/weed_swin](https://huggingface.co/haiquanua/weed_swin), [weed_detr](https://huggingface.co/haiquanua/weed_detr), [machinelearningzuu DETR fine-tunes](https://huggingface.co/machinelearningzuu/detr-resnet-50_finetuned-weed-detection) | Detection (lettuce/spinach beds; unnamed labels) | YELLOW (MIT / Apache tags on unknown data, no cards) | Yes | unknown | none | Student artefacts; not worth the download |
| 20 | [facebook/VGGT-1B-Commercial](https://huggingface.co/facebook/VGGT-1B-Commercial) | Feed-forward cameras, depth, tracks | YELLOW (custom gated licence, commercial except military; derivatives under the same terms) | Yes (gated) | mixed | Co3D AUC@30 90.4 | A GPU-only reconstruction; VGGT-1B and Omega RED |
| 21 | [smAIL-WS/uav_weed_detection](https://huggingface.co/smAIL-WS/uav_weed_detection) | Crop versus weed detection, 5 architectures | RED as published (no licence declared; YOLO files AGPL) | Yes: Grounding DINO 2.08 GB, DINO 582 MB, RetinaNet 457 MB, YOLO 53 / 117 MB | path names say EWIS1 (Mavic 2 Pro at 5 m, about 1 mm/px, maize and sorghum; inferred) | none | The closest drone match found; worth an e-mail to the owner, not a download |
| 22 | [MykolaL/DelineateAnything](https://huggingface.co/MykolaL/DelineateAnything), [torchgeo/delineate-anything-s](https://huggingface.co/torchgeo/delineate-anything-s) | Field instance segmentation at 0.25 to 10 m | RED for a closed product (AGPL-3.0 through Ultralytics) | Yes: 17.6 / 125 MB | FBIS-73M, 61 countries | mAP@0.5 0.632 / 0.720 on FBIS | Only with an Ultralytics enterprise licence |
| 23 | Ultralytics weed checkpoints: [JacobsFarmextra/grassland_weeds](https://huggingface.co/JacobsFarmextra/grassland_weeds), [NvMayMay/weedblaster-vision-yolov8s](https://huggingface.co/NvMayMay/weedblaster-vision-yolov8s), [vicdxxx/Weed_YOLO_Models_for_Smart_Sprayer](https://huggingface.co/vicdxxx/Weed_YOLO_Models_for_Smart_Sprayer), YOLO-World mirrors | Detection and segmentation | RED (AGPL-3.0 by Ultralytics' terms; weedblaster also on the non-commercial CropAndWeed set) | Yes | handheld grassland; ground rig; unknown | mask mAP50-95 0.583 (val only); precision 0.96 / 0.85; none | Not usable; listed to close the question |
| 24 | SegFormer fine-tunes: [FranciscoGaribaldi/segformer_B5_corn_weed](https://huggingface.co/FranciscoGaribaldi/segformer_B5_corn_weed), [koushikn/segformer-finetuned-Maize-10k-steps-sem](https://huggingface.co/koushikn/segformer-finetuned-Maize-10k-steps-sem) | Semantic segmentation (corn / weed; maize) | RED (NVIDIA SegFormer source licence: "may be used or intended for use non-commercially", whatever the card tag says) | Yes: 339 MB each | unknown | mIoU 0.917 at the last step with Maize IoU 0 for most of training | Not usable |
| 25 | SuperPoint / SuperGlue: [magic-leap-community/superpoint](https://huggingface.co/magic-leap-community/superpoint) | Keypoints and matching | RED ("ACADEMIC OR NON-PROFIT ORGANIZATION NONCOMMERCIAL RESEARCH USE ONLY") | Yes | MegaDepth | AUC@5 49.9 | Not usable |

Repositories found with no usable weights or no information are listed in the evidence section. No PhenoBench-
trained checkpoint, no orchard weed checkpoint and no Roboflow-org weed model exist on Hugging Face.

## 4. Geospatial research opportunities (reconstruction, positioning, reconciliation)

- **Replacing the soil-texture correlation.** Swardus solves a translation-dominant alignment on a known-pose,
  near-nadir, near-planar problem and reaches 6 to 7 cm in 9 to 26 s in the browser. Every learned matcher solves
  a harder, more general problem (unknown rotation, scale and viewpoint), was trained on tourist landmarks or
  indoor scans, and publishes nothing on repetitive crop rows. Extrapolated from the published VGA numbers,
  XFeat plus LightGlue over 71 frames and about 200 pairs lands at one to two minutes of PyTorch on a laptop CPU:
  slower, not faster. Accuracy would still be bounded by the five-parameter camera model and the flat plane, not
  by the matcher. Verdict: keep the correlation as the primary; XFeat (Apache, 1.4 MB, ONNX and LiteRT builds) is
  the licence-clean fallback for windows whose correlation peak is weak, and the dormant vineyard set with grass
  between rows is the place to test it.
- **Terrain.** Nothing is both cheap and metric. The cheapest metric route needs no model: per-tie-point heights in
  the existing bundle adjustment (RTK and the calibrated focal already give the metric frame). Depth Anything V2
  Small (Apache, ONNX in the browser) can flag slope or terraces as a relative height field; Depth Anything 3
  SMALL/BASE with pose conditioning could return a 10 to 20 cm/px terrain over the flight in minutes on a CPU;
  MapAnything is the only model that ingests RTK poses and returns metric geometry, as a 1.2 B-parameter server
  job.
- **Cross-image object reconciliation.** No asset does this. The building block would be a learned descriptor at
  each detection (XFeat or ALIKED patch descriptors) matched under the existing ray gate; DINOv2 patch features
  (Apache) are the licence-clean stronger option, DINOv3 the YELLOW one.
- **Field boundary.** The drone-scale model (Delineate Anything) is AGPL; the CC BY Fields of the World models work
  at 10 m and could hand the row-based engine a parcel prior where the rows run out, nothing finer; SAM 2.1 is the
  clean promptable segmenter for a click-drawn boundary. The row-and-evidence engine in `boundary.ts` has no
  Hugging Face competitor at centimetre scale.
- **Crop rows.** Zero assets. The planting-layout fitter stands.
- **Tiling.** SAHI (MIT) wraps RF-DETR, RT-DETR, Grounding DINO and others; the service already tiles and the view
  pruning was measured at 5 to 8 % on this flight, so there is nothing to gain here.
- **Licence notes.** The `vismatch` and `image-matching-models` hubs are wrappers whose repos hold placeholder
  safetensors and pull weights from upstream at runtime; their Apache or MIT tags describe the wrapper, not the
  weights. Efficient LoFTR's licence changed six weeks ago. DA3-LARGE-1.1's licence conflicts between the card and
  the GitHub table. The AerialMegaDepth fine-tunes have no LICENSE file and inherit MASt3R's non-commercial terms.

## 5. Commercial compliance matrix

A preliminary engineering reading. "Train" means commercial training or fine-tuning; "deploy" means commercial
inference in the product. Attribution is required by every CC BY asset and by Apache's NOTICE.

| Asset | Declared licence (where read) | Commercial use | Train | Deploy | Share-alike / attribution / other | Colour | Needs legal review |
|---|---|---|---|---|---|---|---|
| AIDroneMap vineyard | CC BY 4.0 (LICENSE file, manifest) | yes | yes | yes | attribution string required | GREEN | no |
| su-fmi sunflower 2025 / 2024 / 2023 | CC BY 4.0 (card and README) | yes | yes | yes | attribution | GREEN | no |
| ImageWeeds aerial (AgML) | CC BY 4.0 (card, Mendeley) | yes | yes | yes | attribution | GREEN | no |
| cotton_weed_detection (AgML) | CC BY 4.0 (card, Mendeley) | yes | yes | yes | attribution | GREEN | no |
| WeedsGalore | CC BY 4.0 (card; GitHub) | yes | yes | yes | attribution (Celikkan et al. 2025) | GREEN | no |
| USU-Corn-WeedDB, PaimioSB2023, Sesame, ws_dino, NDSU 13-class, MTDC, UAV_weed_plant, KaraAgro | CC BY 4.0 | yes | yes | yes | attribution | GREEN | no |
| PhenoBench | site CC BY-SA 4.0; official zip README CC BY-NC-SA 4.0 | conflicting | share-alike at best | unsettled for weights | share-alike or non-commercial | YELLOW | **yes: Swardus's own model is trained on it** |
| Arvin26 soybean 2025 | CC BY 4.0 tag, manual gating, terms unread | probably | probably | probably | unknown gate terms | YELLOW | yes (read the gate) |
| CoFly-Weed-DB | CC BY 4.0 (Zenodo, card) against GPL-3.0 (GitHub) | unclear | unclear | unclear | which licence covers the images | YELLOW | yes |
| WeedMap | loader GPL-3.0; ETH record unreachable | unknown | unknown | unknown | | YELLOW | yes |
| Arvin26 soybean 2026 | CC BY-NC-ND 4.0 | no | no | no | no derivatives | RED | research only |
| MSDD, soybean_weed_uav_brazil, cross-season weeds | CC BY-NC-SA 4.0 / CC BY-NC 3.0 / CC BY-NC | no | no | no | | RED | research only |
| CropAndWeed | custom: "you may not use the dataset or any derivative work for commercial purposes"; trained models named as derivatives | no | no | no | no redistribution | RED | research only |
| Terrygz lodging, links-ads GAIA, smAIL-WS, AgriCLIP | no licence | no (all rights reserved) | no | no | | RED | contact the owners |
| RF-DETR Seg (all sizes), rfdetr package, OpenVINO INT8 build, GGUF build | Apache-2.0 (README: "Apache-designated model weights are licensed under Apache License 2.0") | yes | yes | yes | NOTICE | GREEN | no (XL/2XL detection and the Plus package are PML 1.0: not used) |
| DINOv2 | Apache-2.0 | yes | yes | yes | | GREEN | no |
| XFeat, LightGlue, DISK, ALIKED (BSD-3), Tiny RoMa code (MIT), SAHI (MIT), SAM 2.1, Grounding DINO, OWLv2, Florence-2 (MIT), Depth Anything V2 Small, DA3 Small/Base/Metric-Large, MapAnything-Apache, FTW CC-BY checkpoints, Prithvi, Clay, DOFA (CC BY), SatMAE++ | Apache-2.0 / MIT / BSD-3 / CC BY 4.0 as named | yes | yes | yes | attribution; BSD notice in binaries for ALIKED | GREEN | no |
| Weedsgalore-Unet | MIT weights over CC BY data | yes | yes | yes | attribution | GREEN (unverified model) | no |
| deepforest-tree | MIT | yes | yes | yes | | GREEN | no |
| DINOv3 (web and SAT) | "DINOv3 License": royalty-free, no non-commercial clause, must ship the Agreement, acknowledge in publications, trade-control bans, revocable on breach | appears yes | appears yes | appears yes | notice and redistribution duties | YELLOW | yes |
| SAM 3, SYNTOM-SAM3 | "SAM License" (same structure as DINOv3's; patent-litigation termination) | appears yes | appears yes | appears yes | as above | YELLOW | yes |
| VGGT-1B-Commercial | custom gated licence, "excluding military applications", derivatives only under the same terms | yes | yes | yes | gated; weights deleted on termination | YELLOW | yes |
| Efficient LoFTR | HF weights Apache-2.0; GitHub "Project Registration License v1.0" since 2026-09-15 (free with registration) | yes with registration | yes | yes | registration before use | YELLOW | yes |
| BioCLIP family | MIT weights over partly non-commercial data (GBIF CC BY-NC, FathomNet, BIOSCAN) | unsettled | unsettled | unsettled | | YELLOW | yes (and off-domain) |
| DistillFSS | MIT; the DCAMA teacher has no licence file | unclear | unclear | unclear | | YELLOW | yes (and off-domain) |
| haiquanua / machinelearningzuu / glean4 / vicdxxx weed checkpoints | MIT or Apache tags on unknown data; vicdxxx produced with Ultralytics (AGPL) | doubtful | doubtful | doubtful | provenance unknown | YELLOW / RED | not worth it |
| Delineate Anything, YOLO-World mirrors, grassland_weeds, weedblaster, smart-sprayer YOLOs | AGPL-3.0 (Ultralytics: "All Ultralytics YOLO trained models fall under the AGPL-3.0 License by default"); GPL-3.0 for YOLO-World upstream | no for a closed web product | no | no | enterprise licence available from Ultralytics | RED | only if the enterprise licence is bought |
| SegFormer-based weed models | NVIDIA SegFormer source licence: "may be used or intended for use non-commercially" | no | no | no | | RED | no |
| SuperPoint, SuperGlue, LightGlue-SuperPoint | Magic Leap non-commercial research only | no | no | no | | RED | no |
| MASt3R, DUSt3R, AerialMegaDepth fine-tunes | CC BY-NC-SA 4.0 + non-commercial checkpoint data | no | no | no | | RED | no |
| Depth Anything V2 Base/Large, DA3 Giant/Nested, VGGT-1B, VGGT-Omega, SatMAE original, Scale-MAE | CC BY-NC 4.0 or non-commercial research licences | no | no | no | | RED | no |

Unresolved questions for a lawyer, in order of consequence for Swardus: (1) PhenoBench's two licence texts and
whether share-alike or non-commercial terms reach a model fine-tuned on it; (2) whether Ultralytics' claim over
weights produced with its code is enforceable, which decides nothing today because Swardus uses none; (3) the
DINOv3 and SAM 3 custom licences, only if those models are ever adopted; (4) the CoFly and WeedMap licence
conflicts, only if those datasets are used.

## 6. Build versus integrate

| Swardus component | Candidate technology | Verdict | Why |
|---|---|---|---|
| Camera alignment (soil-texture correlation + small bundle adjustment) | XFeat, LightGlue, Efficient LoFTR, VGGT, MapAnything | **Leave; benchmark XFeat as a fallback** | 6 to 7 cm in seconds on a CPU already; the matchers are general, slower and unproven on rows; XFeat only where the correlation peak is weak |
| Terrain (none; flat plane) | Depth Anything V2 Small, DA3 Small/Base, MapAnything | **Build the metric route; benchmark DA V2 Small as a flag** | per-tie-point heights in the existing solver cost nothing and stay metric; a monocular depth map can at least warn when the plane is wrong |
| Weed model tier (RF-DETR Seg-L on a GPU) | OpenVINO INT8 and GGUF builds of RF-DETR; Weedsgalore-Unet; the smAIL-WS Grounding DINO | **Improve by re-export** | the same architecture at 34 to 45 MB on a CPU is the laptop model tier; no clean-licence weed checkpoint beats the in-house fine-tune; the one drone match has no licence |
| Weed colour tier (rules, 50 ms) | DINOv2 embeddings; Grounding DINO / OWLv2 proposals | **Keep; benchmark a DINOv2 head on the crown-shoot problem** | the rules out-recall the model on the labelled frames; the open question is precision near crowns, which is where frozen DINOv2 features have published value |
| Reconciliation (ray intersection; outline overlap) | none on Hugging Face; descriptors as a building block | **Leave** | no asset reconciles objects across views; a descriptor gate is a later refinement |
| Rows and trees (planting-layout fitter) | deepforest-tree (already trialled), SAM 2.1 for crowns | **Leave** | the fitter was accepted by eye on the real map; no row asset exists; DeepForest lost the olive and apricot trials in this repository |
| Field boundary (rows + evidence) | Delineate Anything (AGPL), FTW (10 m), SAM 2.1 | **Leave; optional FTW prior** | nothing operates at centimetre scale under a clean licence; the engine already reports confidence and failure codes |
| Pressure and zones | none | **Leave** | agronomic rules, not a vision problem |
| Photo formats (DJI JPEG, TIFF, P4M band sets) | su-fmi and AIDroneMap data as test material | **Validate with the data** | the TIFF path and the band alignment sign are untested; these sets are the test |
| Benchmarking (414 labels on one frame) | ImageWeeds aerial, cotton, USU corn, WeedsGalore | **Integrate as benchmarks** | four more labelled sets, two with GPS in the files, on other soils, crops and heights |

## 7. Top five immediate experiments

### 7.1 A CPU model tier from the in-house RF-DETR checkpoint
- Hypothesis: the PhenoBench-fine-tuned Seg-L checkpoint, exported to OpenVINO INT8 or rfdetr.cpp GGUF q8, runs a
  1024 px tile in under 1.5 s on a 4-core laptop CPU with recall within 5 % of the fp32 GPU run.
- Assets: `OpenVINO/rfdetr_seg_large-int8-ov` (the recipe: nncf post-training quantisation), `mudler/rfdetr-cpp-seg-large`
  (the GGUF converter in rfdetr.cpp), the in-house checkpoint on D:.
- Dependencies: OpenVINO 2026.1+, nncf, or rfdetr.cpp; the saved answers in `data/direct-georef/apricot/m1` as the
  fp32 reference; `labelcheck.py` and `colourBench.ts --variants model` for the labels.
- Steps: export; run DJI_0301 and the four covering frames; compare instances against the fp32 answers (count,
  mask IoU) and the labels; time per tile on this machine with the GPU disabled and, if available, a 4-core laptop.
- Expected benefit: a model tier for the laptop target in tens of minutes per flight instead of hours.
- Success: ≤ 1.5 s per tile at 4 threads, labelled recall within 5 % of fp32, mask IoU against fp32 ≥ 0.9 median.
- Complexity: medium (2 to 3 days; the service must load a second backend).
- Failure modes: INT8 recall loss on small weeds; ROCm-trained weights exporting badly; rfdetr.cpp lacking the
  fine-tuned head's class count.

### 7.2 DINOv2-S patch embeddings for the crown-shoot problem
- Hypothesis: a kNN or linear head on frozen DINOv2-S/14 patch features, trained from the 414 labels plus the
  crown positions, raises the colour tier's share of candidates near a label from 21 % to at least 30 % at no
  more than 10 % recall loss, and runs in under 20 s per photograph on a CPU through ONNX Runtime.
- Assets: `facebook/dinov2-small` (Apache-2.0); `onnxruntime-web` already in the bundle.
- Dependencies: the colour tier's candidates with outlines (`build/weeds.ts`), DJI_0301's labels, the quarter decode.
- Steps: embed 518 px tiles of the five covering frames; pool features under each candidate's outline; train a head
  on labelled candidates (weed / crown shoot / soil / shadow by the labels and the crown masks); score the rest;
  measure against the labels and the drawn checks; time it.
- Expected benefit: the one precision lever for the rules-only tier with published evidence behind it.
- Success: near-label share ≥ 30 %, recall ≥ 0.9 of today's, ≤ 20 s per photograph on this CPU.
- Complexity: medium (3 to 4 days).
- Failure modes: 14 cm patch tokens too coarse for 10 cm weeds; the head learning the apricot field only; the labels
  not exhaustive enough to measure precision (a second labelled set from 7.4 helps).

### 7.3 A second site through the twin builder: the AIDroneMap vineyard
- Hypothesis: the builder aligns the 145 Mavic 3 Multispectral RTK frames (1.06 cm/px, dormant vines, grass between
  rows) to within 10 cm and finds the vine rows.
- Assets: `AIDroneMap/aidm-vineyard-small` (73 frames, 0.9 GB) then the full set.
- Dependencies: none new; the builder as it is.
- Steps: build in the browser with the colour tier; read the camera report (ties, residual, rejections by "green or
  outside"); look at the rows and the boundary by eye; run the camera stage with XFeat ties as a second pass if the
  correlation starves on grass.
- Expected benefit: the first non-apricot, non-Phantom field; a grass-between-rows case the colour tier is known to
  mis-read.
- Success: held-out ties ≤ 10 cm; vine rows found at the right pitch; an honest list of what broke.
- Complexity: low (1 day) plus the XFeat pass (2 days).
- Failure modes: too few bare-soil windows for the correlation (the whole point of the test); the fitter expecting
  tree crowns, not vine canopies; winter light.

### 7.4 The P4 Multispectral band path on real data
- Hypothesis: the TIFF band-set path builds a usable twin from the su-fmi 2025 flight (RTK, 50 m, 2.6 cm/px) and the
  band-shift sign is right.
- Assets: `su-fmi/sunflower-density-estimation-2025`, one flight folder (99 captures, about 2.2 GB).
- Dependencies: `tiffPhotos.ts` as shipped; the DJI guide's RelativeOpticalCenter definition.
- Steps: build from the band files alone; check the colour alignment by eye on a crop; compare against the same shot's
  JPEG; read the camera residual at the coarser pixel.
- Expected benefit: a validated multispectral input and the first sunflower field.
- Success: colour fringes under 2 pixels on the aligned composite; held-out ties ≤ 15 cm at 2.6 cm/px.
- Complexity: low (1 day) if the sign is right, 2 if it must flip.
- Failure modes: the sign; the 16-bit stretch mis-reading radiometric bands; 1600 × 1300 frames too small for the
  64² tie windows at 2.6 cm (16 cm windows).

### 7.5 Two more labelled benchmarks for the weed tiers
- Hypothesis: the colour tier's advantage over the model on the apricot labels holds on other soils and heights.
- Assets: `Project-AgML/ImageWeeds_aerial_weed_detection` (ND weeds at 2.5 m, GPS in EXIF) and
  `Project-AgML/cotton_weed_detection` (Texas cotton at 15 m, 50 k boxes).
- Dependencies: a loader from parquet to JPEG bytes (the EXIF survives); `colourBench.ts` generalised to boxes
  instead of points; per-photograph only (no overlapping flights).
- Steps: run the rules and the GPU model on 50 frames of each; recall of boxes by candidate centres; candidates per
  box; drawn checks.
- Expected benefit: the first measurement off the apricot field; the cotton set has exhaustive boxes, which the
  apricot labels are not.
- Success: a table with both tiers on both sets and the drawn pictures; no number is a target.
- Complexity: low (1 to 2 days).
- Failure modes: the 2.5 m set's 0.7 mm pixels are a different regime (the rules' tile sizes are in pixels); the
  Autel pitch convention (0 = nadir) tripping the header parser.

## 8. Download plan (Windows PowerShell, Hugging Face CLI)

Install once, then pull selectively. Sizes are from the file trees; anything over 100 MB needs Yunus's approval
before it runs, and the first command of each block stays under that.

```powershell
# Once
pip install -U huggingface_hub
# Optional, for gated or rate-limited repos: hf auth login

# 1. AIDroneMap vineyard: five RTK frames (about 61 MB) to read the headers and try the builder
hf download AIDroneMap/aidm-vineyard-small --repo-type dataset --local-dir D:\hf\aidm-vineyard-small `
  --include "LICENSE" "manifest.json" "README.md" "images/DJI_20241224105113_000[1-5]_D.JPG"
# The whole small set (73 frames, about 0.9 GB) when approved:
# hf download AIDroneMap/aidm-vineyard-small --repo-type dataset --local-dir D:\hf\aidm-vineyard-small

# 2. su-fmi sunflower 2025: one capture point of one flight (JPG + 5 band TIFs, about 22 MB) for the TIFF path
hf download su-fmi/sunflower-density-estimation-2025 --repo-type dataset --local-dir D:\hf\su-fmi-2025 `
  --include "README.md" "02.06.2025/aerial/100FPLAN/DJI_0010.*" "02.06.2025/aerial/100FPLAN/100_Timestamp.MRK"
# One whole flight (99 captures, about 2.2 GB) when approved:
# hf download su-fmi/sunflower-density-estimation-2025 --repo-type dataset --local-dir D:\hf\su-fmi-2025 --include "02.06.2025/aerial/100FPLAN/*"

# 3. ImageWeeds aerial: the card and one parquet shard (shards hold about 55 original JPEGs each; expect 300 to 500 MB,
#    so this needs approval; the card alone is under 100 MB)
hf download Project-AgML/ImageWeeds_aerial_weed_detection --repo-type dataset --local-dir D:\hf\imageweeds-aerial `
  --include "README.md"
# hf download Project-AgML/ImageWeeds_aerial_weed_detection --repo-type dataset --local-dir D:\hf\imageweeds-aerial --include "data/train-00000-of-00010.parquet"
```

Reading the EXIF out of a parquet row in Python: `pyarrow.parquet.read_table(path, columns=["image"])`, take
`row["image"]["bytes"]`, hand the bytes to the existing `parseDjiHeader` (JPEG) through a small script, or to
PIL's `getexif()`. Nothing in these plans touches a gated repository.

## 9. Evidence and uncertainty

Verified by reading files: the AIDroneMap frame `images/DJI_20241224105113_0001_D.JPG` (EXIF GPS, RtkFlag 50,
NTRIP, DewarpData); su-fmi 2025 `02.06.2025/aerial/100FPLAN/DJI_0010.JPG` (RtkFlag 50, σ 2.5 / 3.4 / 9 cm,
CalibratedFocalLength 1913.33) and the 2024 and 2023 siblings (RtkFlag 16); su-fmi 2023 `DJI_0011.TIF` (XMP in the
band TIF, IFD after the pixels); the first JPEG inside one ImageWeeds shard (FC6310S, RelativeAltitude 2.5 m) and
one cotton shard (Autel XL709, AboveGroundAltitude 14.97 m); WeedsGalore, PhenoBench, USU and PaimioSB tiles
(no metadata chunks); the Terrygz GeoTIFF tags; the RF-DETR README licence paragraphs; the Ultralytics licence
page; the NVIDIA SegFormer licence; the CropAndWeed LICENCE; the LightGlue, XFeat, RoMa, MapAnything, FTW,
DINOv3, SAM 3 and VGGT licence texts; the BioCLIP dataset cards.

Could not be verified:
- EXIF persistence across every row of the AgML parquet sets (one shard head each was read; AgML re-encodes
  rotated images in at least one set).
- Both Arvin26 soybean repositories (gated): file contents, RTK, access terms.
- GPS in the original files of KaraAgro, USU (Zenodo), PaimioSB (Zenodo), CoFly, Sesame, ws_dino.
- WeedMap's licence (the ETH record returned HTTP 500 twice); CoFly's licence conflict (GPL on GitHub, CC BY on
  Zenodo); PhenoBench's licence conflict (BY-SA on the site, BY-NC-SA in the zip's README).
- Sizes of the su-fmi 2024 and 2025 sets (2023 counted exactly: 372.5 GB raw); all "computed" GSDs come from one
  sample image each.
- Every CPU timing for 20-megapixel frames: extrapolated from published VGA or GPU numbers; nothing in this audit
  was run. The in-house 8 s per photograph for a 36 M segmenter on a GPU suggests the GPU estimates for the
  open-vocabulary detectors are optimistic.
- Whether smAIL-WS trained on EWIS1 (inferred from a path name) and the architectures of its `dino_*` and `rn_*`
  files; the Weedsgalore-Unet's encoder, input channels and the 0.42 mIoU claim; the class names and provenance of
  the smart-sprayer YOLO files; the training data of the haiquanua and machinelearningzuu checkpoints.
- DA3-LARGE-1.1's licence (card Apache, GitHub table read as CC BY-NC); whether Efficient LoFTR's earlier
  Apache-tagged weights remain Apache; the AerialMegaDepth fine-tunes' licence (no file); Depth Anything V2
  Metric-Outdoor cards carry no licence tag; the AgriFM upstream licence; Pl@ntNet's image terms for SimDINOv2.
- The DeepForest architecture and NEON GSD, Grounding DINO tiny's parameter count, SAM 2.1's encoder sizes and
  the RF-DETR ONNX export API are from the agents' prior knowledge, not from the cards read today.
- The Hugging Face `search=` endpoint matches repository names, not tags: a weed model or UAV dataset named
  without weed / crop / UAV / maize / drone in its id would not have surfaced.
- The DINOv2 drone-weed numbers come from one group's two papers (frozen encoders, sub-millimetre pixels at 6 m),
  not from 1 cm/px imagery.

Repositories found with no usable weights or information: kb-01/Cotton_Weed_Detection, Helenachallita/SugarBeetModel,
QtahaQ/WeedMaize-YOLO-Clean, Thundervamsi/weed_detection, Sudan4313/corn-phenotyping-models,
hxb123/Lily_and_Weed_Detection_YOLO12, aarohi1822/multi-crop-weed-model, ivliev123/crop_weed_detection_models_part_1,
rishikrishna/mh-weed16-yolov8, Vigneshtrill/Agribot_Weed_Detection, akhand2210093/weed-detection-weights,
Shreyaswali/weed-detection-yolov8, almas-alz/vgg_unet_cotton_weed_segmentation, PawelMar/Yolo-Lettuce-Segmentation-v2,
metabit1000/vegetation_segmentation_models, Vastu027123/USU-Corn-WeedDB (empty, tagged CC BY-NC), the three
personal "agriclip" uploads, and the LibreYOLO org (Apache and MIT YOLO re-implementations with Roboflow-100
datasets including `weed-crop-aerial`, CC BY 4.0, 1,176 aerial images, no trained weed weights).

## 10. Final prioritisation

Scores out of 100: relevance 25, licence 20, quality or capability 20, geospatial utility 15, integration 10,
expected operational improvement 10.

| Rank | Asset | Rel. | Lic. | Qual. | Geo | Int. | Impr. | Score |
|---|---|---|---|---|---|---|---|---|
| 1 | RF-DETR OpenVINO INT8 / GGUF builds (the recipe for the in-house checkpoint) | 25 | 20 | 16 | 10 | 8 | 9 | **88** |
| 2 | AIDroneMap vineyard (RTK M3M JPEGs at 1 cm) | 22 | 20 | 12 | 15 | 10 | 7 | **86** |
| 3 | su-fmi sunflower 2025 (RTK P4M, PPK, orthos) | 20 | 20 | 15 | 15 | 8 | 7 | **85** |
| 4 | su-fmi sunflower 2024 (growth stages, 2 to 40 m) | 19 | 20 | 14 | 13 | 8 | 6 | **80** |
| 5 | ImageWeeds aerial (ND weeds, EXIF intact) | 18 | 20 | 14 | 10 | 7 | 7 | **76** |
| 6 | cotton_weed_detection (Texas, 50 k boxes, Autel) | 18 | 20 | 14 | 9 | 6 | 7 | **74** |
| 7 | DINOv2-S/B embeddings | 18 | 20 | 14 | 4 | 8 | 8 | **72** |
| 8 | XFeat (+ LighterGlue) | 16 | 20 | 14 | 10 | 6 | 4 | **70** |
| 9 | WeedsGalore (maize masks, on D: already) | 17 | 20 | 15 | 2 | 8 | 6 | **68** |
| 10 | USU-Corn-WeedDB (corn boxes at 0.48 cm; Zenodo originals) | 17 | 20 | 13 | 4 | 7 | 6 | **67** |
| 11 | PaimioSB2023 (sugar beet seedlings, 338 k boxes) | 14 | 20 | 15 | 3 | 6 | 5 | **63** |
| 12 | LightGlue + ALIKED / DISK | 14 | 19 | 14 | 9 | 5 | 3 | **64** |
| 13 | SAM 2.1 tiny / small | 12 | 20 | 15 | 4 | 7 | 4 | **62** |
| 14 | su-fmi 2023 (41 dates at 6 cm) | 12 | 20 | 12 | 12 | 5 | 3 | **64** |
| 15 | Grounding DINO / OWLv2 (zero-shot proposals) | 12 | 20 | 14 | 2 | 4 | 5 | **57** |
| 16 | PhenoBench (already used; licence loose end) | 18 | 8 | 18 | 2 | 8 | 2 | **56** |
| 17 | Depth Anything V2 Small (ONNX) | 10 | 20 | 11 | 8 | 7 | 3 | **59** |
| 18 | Depth Anything 3 Small / Base | 10 | 18 | 12 | 10 | 4 | 3 | **57** |
| 19 | Weedsgalore-Unet | 12 | 17 | 6 | 2 | 6 | 3 | **46** |
| 20 | Arvin26 soybean 2025 (gated CC BY) | 16 | 10 | 13 | 10 | 3 | 4 | **56** |
| 21 | FTW ftw-q / ftw-prue-ccby | 7 | 20 | 10 | 8 | 6 | 2 | **53** |
| 22 | Efficient LoFTR | 12 | 10 | 16 | 8 | 3 | 3 | **52** |
| 23 | DINOv3 (web) | 14 | 8 | 15 | 4 | 5 | 4 | **50** |
| 24 | MapAnything-Apache | 8 | 20 | 14 | 10 | 2 | 2 | **56** |
| 25 | SAM 3 | 10 | 8 | 17 | 2 | 3 | 4 | **44** |
| 26 | smAIL-WS uav_weed_detection | 20 | 0 | 8 | 4 | 3 | 5 | **40** |
| 27 | Delineate Anything v2 | 10 | 2 | 15 | 8 | 4 | 3 | **42** |
| 28 | MSDD maize seedlings (NC) | 14 | 0 | 14 | 2 | 4 | 4 | **38** |
| 29 | Arvin26 soybean 2026 (NC-ND) | 16 | 0 | 15 | 12 | 2 | 3 | **48**, research only |
| 30 | Satellite foundation models (Prithvi, Clay, DOFA, SatMAE++) | 2 | 20 | 12 | 5 | 2 | 0 | **41**, not for Direct |

### The next seven days

1. Day 1: pull the five AIDroneMap frames and the one su-fmi 2025 capture (both under 100 MB); read both headers
   through `parseDjiHeader`; fix whatever the Mavic 3 Multispectral and P4M XMP do differently. Ask Yunus for
   approval of the 0.9 GB and 2.2 GB pulls.
2. Days 2 to 3: build the vineyard twin (experiment 7.3); record the camera report and the drawn twin; if the
   correlation starves on grass, prepare the XFeat tie pass as an offline experiment (not in the product).
3. Days 3 to 4: the su-fmi band set through the TIFF path (7.4); settle the band-shift sign by eye.
4. Days 4 to 6: export the in-house RF-DETR checkpoint to OpenVINO INT8 (7.1); measure tile latency on this CPU
   and recall against the saved fp32 answers; decide whether the laptop model tier is minutes or still hours.
5. Day 7: write the PhenoBench licence question up for a lawyer with both texts attached; start the DINOv2
   embedding experiment (7.2) only after the second labelled set (7.5) exists, so precision can be measured on
   exhaustive boxes.

None of this changes production code until each experiment has its numbers and its drawn check.
