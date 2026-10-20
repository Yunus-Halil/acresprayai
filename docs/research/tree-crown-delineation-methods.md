# Tree crown delineation from RGB orthomosaics: methods survey for Swardus

Date: 2026-10-19. Scope: delineating each cultivated tree's crown in an orchard orthomosaic (1-3 cm/px, nadir, Air 3S / Phantom-class RGB, no height model yet, offline on an ordinary PC) so that inter-row weeds are not taken for crop and crowns are not taken for weeds. We already have the planting lattice (rows ~5.1 m, trees ~3.2 m). Every number below is quoted from the cited source; where only an abstract or a search index was readable, that is marked. Nothing here was run on our data.

## Summary

The literature is consistent on three points. (1) In regular orchards, local-maxima plus marker-controlled watershed on a vegetation index reaches near-perfect tree counts and >95% crown delineation accuracy *when the background is clean* ([Dong et al. 2020](https://doaj.org/article/ad3264b10f944eebafd99082435c184e)). (2) Every classical pipeline, including height-based ones, collapses where weeds are dense: a CHM + watershed pipeline fell from ~94% to 46.9% detection score in a weedy citrus block, "heavily penalised by false positives from weeds and merged crowns" ([Daiaeddine et al. 2026](https://ijg.journals.publicknowledgeproject.org/index.php/journal/article/view/5077)). (3) The single prior that orchard papers lean on is the *known tree spacing* ([Cue La Rosa et al. 2020](https://research.ibm.com/publications/fcrn-based-multi-task-learning-for-automatic-citrus-tree-detection-from-uav-images)). We already have that prior. The smallest high-yield change is therefore lattice-seeded marker-controlled watershed bounded by neighbour mid-planes, measured on the 104-tree / 414-weed frame (Section 4).

## 1. Classical methods (RGB only)

| Method | Needs | Known failure modes | Orchard accuracy reported |
|---|---|---|---|
| Local maxima (LM) + marker-controlled watershed (MCWS) | A "height-like" surface: DSM/CHM, or a smoothed vegetation index; a smoothing radius tuned to crown size | Over-segmentation of broadleaf crowns ("non-conical shape of crown causes multiple local maxima identified within a single broadleaf crown", [Mu et al. 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC6286954)); weeds become extra maxima; merged crowns when no saddle exists; "depend on parameters that must be tuned for each site" ([Yu et al. 2022](https://api.crossref.org/works/10.3390/rs14020295)) | Apple + pear, SfM DSM + ExGR, LM + MCWS: tree-count F-score ~99%, crown delineation PA/UA >95%, crown-area RMSE 0.72 / 0.48 m², diameter RMSE 0.39 / 0.26 m, slight overestimation ([Dong et al. 2020](https://doaj.org/article/ad3264b10f944eebafd99082435c184e), abstract only, full text not readable). Peach, <1 cm/px DSM, convex-mask markers + MCWS: crown-width RMSE 0.08 / 0.15 m vs manual (n=12) ([Mu et al. 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC6286954)). Young plantation forest with CHM: LM F1 ~87.9%, MCWS ~85.9% ([Yu et al. 2022](https://api.crossref.org/works/10.3390/rs14020295)) |
| Region growing bounded by neighbour mid-planes (lattice/Voronoi cells) | Tree positions (we have them); a vegetation mask | Weeds touching the crown inside the cell get absorbed; a missing tree leaves an empty cell that collects weeds; off-lattice trees | Citrus FCRN that "requires the nominal spacing between adjacent trees as a priori information": 95-99% on 8-year-old trees with overlapping crowns at 9.5 cm/px; "detecting tree seedlings and tree gaps remains a challenge" (seedling recall 59-100%) ([Cue La Rosa et al. 2020](https://research.ibm.com/publications/fcrn-based-multi-task-learning-for-automatic-citrus-tree-detection-from-uav-images)) |
| ExG / ExGR / NExG + Otsu | Only RGB; a bimodal green-vs-soil histogram | Weeds are green too ("the color appearance of weeds is similar to that of citrus trees", [Chen et al. 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6960911)); shadow and soil are not separable by an index pixelwise ("Spectral indices are not able to discriminate between Soil and Shadow", [Poblete-Echeverria et al. 2017](https://api.crossref.org/works/10.3390%2FRS9030268)) | Vineyard: SI + Otsu gave the best canopy detection; SI as input to ANN/RF reached ~0.98 for Plant/Soil/Shadow ([Poblete-Echeverria et al. 2017](https://api.crossref.org/works/10.3390%2FRS9030268)). Pear at 1.6 cm/px: OTSU MIoU 65.33% vs U-Net 84.75% ([Frontiers 2024](https://www.frontiersin.org/journals/plant-science/articles/10.3389/fpls.2024.1393592/full)) |
| Texture / colour classifier on candidate blobs | Labelled tree vs non-tree blobs | Still "did not divide any trees" that overlap; weedy backgrounds under-extract candidates | Citrus, Otsu on relative red-green map + linear SVM on 80 colour/GLCM/LBP features: correct-segmentation rate 85.27 +/- 9.43%; weed areas were sometimes "segmented as trees" ([Chen et al. 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6960911)) |

Young trees: no RGB-only orchard paper found reporting accuracy on small trees specifically; the citrus seedling recall above (59-100%) is the closest. Marked as a gap.

### 1.1 Implementation sketch: lattice-seeded MCWS (browser, TypeScript)

```ts
// 1. Vegetation surface. ExG = 2G - R - B on 0..1 floats; optional ExGR = ExG - (1.4R - G).
//    Smooth with a Gaussian whose sigma ~ 0.25 * expected crown radius in px (removes leaf texture).
// 2. Markers: one per lattice position (NOT local maxima -> avoids Mu et al.'s over-segmentation).
//    Snap each marker to the ExG maximum within r_snap (e.g. 0.5 m) of the predicted position.
//    Marker label = tree index; everything with ExG < otsu(ExG) is pre-labelled "background".
// 3. Hard boundaries: for each pixel, the lattice cell is the nearest predicted tree position
//    (Voronoi of the lattice = neighbour mid-planes). A flood may not cross a cell boundary.
// 4. Priority-flood watershed on -ExG from the markers (binary heap keyed on -ExG; 4- or 8-connected),
//    stopping at background pixels and cell boundaries.
// 5. Crown = labelled region. Reject/clip: distance from marker > r_max (e.g. 0.6 * row spacing);
//    region area < a_min flags "young or missing tree"; a cell whose region never passes the
//    ExG threshold near the marker is a gap, and its green pixels are candidate weeds.
// 6. Weeds = green pixels not in any crown region; weeds touching a crown are those adjacent
//    to the crown boundary with ExG above threshold outside the clipped radius.
```

Cost: O(N log N) in pixels; a 10k x 10k frame is feasible in a Web Worker with typed arrays. Python equivalent: `skimage.segmentation.watershed(-exg, markers, mask=veg & cells)`.

### 1.2 Shadow and understory handling

- Shadow: indices alone cannot separate shadow from soil ([Poblete-Echeverria et al. 2017](https://api.crossref.org/works/10.3390%2FRS9030268)). Practical rule from the same paper: feed the index plus HSV brightness to a small trained classifier; the walnut study instead masks a pixel as canopy only "if both DSM and NExG identify it as vegetation" ([Freeman et al. 2024, arXiv 2401.01375](https://arxiv.org/html/2401.01375v2)). Without a DSM, use lattice geometry: shaded grass that is green and inside a cell but outside r_max is weed, not crown.
- Understory weeds merged with crown: the only reported cures are a learned mask (U-Net 93.6% vs CHM 46.9%, [Daiaeddine et al. 2026](https://ijg.journals.publicknowledgeproject.org/index.php/journal/article/view/5077)) or a blob classifier ([Chen et al. 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6960911)). Lattice clipping is a geometric substitute that no paper tests directly (unverified for our case).

## 2. Pretrained deep-learning detectors usable offline

| Model | URL | Licence code / weights | Training data and GSD | Expects | Output | CPU practical? | Dependencies, size | Published results |
|---|---|---|---|---|---|---|---|---|
| DeepForest `weecology/deepforest-tree` | [GitHub](https://github.com/weecology/DeepForest), [HF](https://huggingface.co/weecology/deepforest-tree), [docs](https://deepforest.readthedocs.io/en/latest/user_guide/02_prebuilt.html) | MIT / MIT (HF card says "License: mit") | "Millions of moderate-quality annotations generated by a LiDAR-based unsupervised tree detection algorithm, plus hand-annotated RGB" from NEON forests; trained on 10 cm data with 400 px crops ([docs](https://deepforest.readthedocs.io/en/v1.5.0/user_guide/10_better.html)) | ~10 cm/px; docs: "Retraining the model on data at the desired resolution is likely less of an issue than using the release model directly on novel resolutions" | Boxes | Yes; docs show CPU default, `m.to("cuda")` optional ([install](https://deepforest.readthedocs.io/en/latest/getting_started/install.html)) | `pip install deepforest`; torchvision + PyTorch Lightning; 32.3M params. Install size not stated (unverified; torch dominates) | FORESTS: F1 0.52 on a temperate deciduous forest (Gan et al. 2023, quoted on [detectree2 README](https://github.com/PatBall1/detectree2)). ORCHARD: apple detection F1 86.24% after training with hard negative mining ([Jemaa et al. 2023](https://doaj.org/article/cf2bf7ed54574096800366a19f827432)); whether the DeepForest baseline was zero-shot is unverified (PDF unreadable). Docs: prebuilt models are "the starting point for further training" |
| detectree2 | [GitHub](https://github.com/PatBall1/detectree2), weights on [Zenodo 15863800](https://zenodo.org/records/15863800) | MIT / CC BY 4.0 | Tropical closed canopy (Paracou, Danum, Sepilok) aeroplane ~1 m (`230717_base`), UAV ~5 cm (`230729_05dates`), urban Cambridge, generalist `250312_flexi`; 3.5 GB total ([model garden](https://github.com/PatBall1/detectree2/tree/master/model_garden)) | ~100 m tiles; UAV model "~5 cm" | Masks (Mask R-CNN) | Not stated; Detectron2 build required, "GPU access with CUDA is recommended" for training | PyTorch >= 1.8, torchvision, Detectron2, GDAL/rasterio/fiona via conda | FORESTS only: F1 0.57 vs DeepForest 0.52 (Gan et al. 2023, on README). No orchard numbers found |
| Restor TCD | [GitHub](https://github.com/restor-foundation/tcd) | Apache 2.0 / **CC BY-NC 4.0** (non-commercial) | OAM-TCD, "optimised for 0.1 m/px" | 10 cm | Masks (Mask R-CNN) or semantic (SegFormer, NVIDIA research licence; U-Net MIT) | Not stated | conda or Docker | Excluded for Swardus by the weights licence |
| SAM (for prompt-based crown masks) | [GitHub](https://github.com/facebookresearch/segment-anything) | Apache 2.0 / Apache 2.0 ("The model is licensed under the Apache 2.0 license") | SA-1B, not aerial | Any; point prompts could be our lattice positions | Masks | Heavy encoder; "CUDA support is strongly recommended"; mask decoder exportable to ONNX | PyTorch | No orchard metric found; a 2023 Drones paper compared Mask R-CNN, YOLOv3 and SAM for orchard crowns inside ArcGIS Pro (unverified, not fetched) |

Orchard-specific models: none found with both code and weights under a verified permissive licence.
- Apple: YOLO vs DeepForest ([Jemaa et al. 2022, ISPRS](https://isprs-archives.copernicus.org/articles/XLIII-B4-2022/661/2022/)) notes "apple trees are overlapping over the UAV images"; MPAPR R-CNN (PointRend head) for apple canopies ([Frontiers 2022](https://www.frontiersin.org/journals/plant-science/articles/10.3389/fpls.2022.1041791/epub)); no weights located.
- Citrus: CURI-YOLOv7, ~90% mAP ([Remote Sensing 2023](https://www.mdpi.com/2072-4292/15/19/4647)); no code link located (unverified).
- Olive: YOLOv11/12 benchmarks reporting 0.987 mAP on an "OTD" dataset ([ITU 2026](https://research.itu.edu.tr/en/publications/benchmarking-yolo-and-transformer-based-detectors-for-olive-tree-/)) and a Split_Olive dataset on Zenodo ([FESB](https://covio.fesb.unist.hr/publications)); weights availability unverified.
- Almond, vineyard: no pretrained crown model found.
- Training-data GSD mismatch: DeepForest at 10 cm vs our 1-3 cm means a 3.2 m tree is ~32 px there and 100-300 px here; the docs' own guidance is to retrain at the target resolution ([docs](https://deepforest.readthedocs.io/en/v1.5.0/user_guide/10_better.html)). Downsampling our frames to 10 cm before inference is the cheap alternative (unverified on our data).

## 3. Is RGB photogrammetry height the decisive crop-vs-weed signal?

Evidence says: strong for mature trees over short cover, not decisive, and unreliable for the young trees we care about.

- For: a CHM + watershed pipeline matched U-Net (~94%) in a structurally simple citrus block and "crown area recovered almost perfectly" ([Daiaeddine et al. 2026](https://ijg.journals.publicknowledgeproject.org/index.php/journal/article/view/5077)). In a pear orchard a U-Net on DSM alone (MIoU 83.37%) nearly matched RGB+DSM (84.75%) and beat Otsu (65.33%) ([Frontiers 2024](https://www.frontiersin.org/journals/plant-science/articles/10.3389/fpls.2024.1393592/full)). LM/MCWS on a CHM gave F1 ~86-88% in a young plantation ([Yu et al. 2022](https://api.crossref.org/works/10.3390/rs14020295)).
- Against: the same citrus CHM pipeline dropped to 46.9% in the weedy block because "the height threshold lost discriminative power where weeds and crowns were close in height" ([Daiaeddine et al. 2026](https://ijg.journals.publicknowledgeproject.org/index.php/journal/article/view/5077)). In the pear DSM "there were weeds in the ground part" and the ground "has some thickness", producing canopy artefacts under a fixed 0.2 m threshold ([Frontiers 2024](https://www.frontiersin.org/journals/plant-science/articles/10.3389/fpls.2024.1393592/full)).
- Minimum height: on young radiata pine (0.4-6.1 m, Phantom 4 Pro SfM) height R² 0.94, RMSE 18.5%, mean bias -0.38 m, and "a minimum threshold of 1 m, under which the accuracy of height measurements using ULS and SfM significantly declines" ([Hartley et al. 2020](https://doaj.org/article/800d2413ec2e4ba5be38e62d9af96e77)). A separate young-plantation study found accuracy lower for trees under 1 m ([Remote Sensing 2021](https://doaj.org/article/8c3f4dd036b5483e976014c6e2f1f603), abstract only). A eucalyptus abstract claimed sub-1 cm GSD *worsened* height (R² 0.01) and 3 cm GSD with calibration gave R² 0.85 ([sciforum 33612](https://sciforum.net/paper/33612), page not retrievable: unverified).
- Practical reading: a young tree under ~1 m and a weed patch of 0.3-0.8 m are within SfM's bias (~0.4 m); height cannot separate them. Above ~1.5-2 m crown height with mown or sparse cover, height is a clean cue and should be ANDed with ExG as in the walnut study ([Freeman et al. 2024](https://arxiv.org/html/2401.01375v2)).
- ODM provides it: `--dsm` ("ground + objects"), `--dtm` ("ground only"), `--dem-resolution` default 5 cm "capped by a ground sampling distance (GSD) estimate", and `--smrf-threshold` default 0.5 m is the ground/non-ground elevation threshold ([ODM arguments](https://docs.opendronemap.org/arguments/)). CHM = DSM - DTM is not an ODM output; it is one raster subtraction on our side.

## 4. Ranked recommendation

1. **Lattice-seeded marker-controlled watershed on ExG, bounded by neighbour mid-planes (Section 1.1).** Smallest change: we already have positions and the ExG mask; what changes is that the *markers come from the lattice* (not local maxima) and the *flood cannot cross a cell boundary*. This directly targets the two named failure modes: merged crowns get a seam at the mid-plane; inter-row weeds are outside any cell radius and stay weeds. Evidence base: spacing prior gave 95-99% on overlapping citrus ([Cue La Rosa et al. 2020](https://research.ibm.com/publications/fcrn-based-multi-task-learning-for-automatic-citrus-tree-detection-from-uav-images)); marker-controlled rather than treetop seeds avoids broadleaf over-segmentation ([Mu et al. 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC6286954)); LM + MCWS on ExGR reached ~99% count F-score on apple/pear ([Dong et al. 2020](https://doaj.org/article/ad3264b10f944eebafd99082435c184e)). Runs in the browser, no new dependency.
2. **Per-cell young/missing-tree logic.** A cell whose flood never exceeds a_min at the marker is a gap; green there is weed. This is where every method is weakest (seedling recall 59-100%, [Cue La Rosa et al. 2020](https://research.ibm.com/publications/fcrn-based-multi-task-learning-for-automatic-citrus-tree-detection-from-uav-images)), so make it an explicit state rather than a silent miss.
3. **Blob classifier for ambiguous green inside the cell radius.** Small colour + texture features (GLCM/LBP as in [Chen et al. 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6960911)) trained on our 104 crowns vs 414 weed points. Cheap, in-browser, and it addresses the "weed merged with crown" case that geometry alone does not.
4. **ODM CHM as an AND gate, mature trees only.** Worth adding once ODM runs in the pipeline, with a per-field minimum-height rule (not below ~1 m, [Hartley et al. 2020](https://doaj.org/article/800d2413ec2e4ba5be38e62d9af96e77)); do not expect it to resolve young trees or tall weeds ([Daiaeddine et al. 2026](https://ijg.journals.publicknowledgeproject.org/index.php/journal/article/view/5077)).
5. **DeepForest fine-tune (boxes) as a cross-check, not the delineator.** MIT code and weights, CPU inference, but 10 cm training GSD and forest results only; 104 boxes is a small fine-tune set. Use its box count against the lattice count on the four unlabelled frames. detectree2 is deferred: Detectron2 under ROCm/Windows is a build risk and its weights are forest/urban.

### What to measure on the labelled frame (104 trees, 414 weed points)

| Metric | How | Why |
|---|---|---|
| Tree recall | labelled tree centre falls inside exactly one crown region | counts merges (two centres in one region) and misses separately |
| Crown precision | crown regions with no labelled tree centre | detects weed blobs promoted to crop |
| Weed-in-crown rate | of 414 weed points, share inside a crown region | the "weed taken for crop" error, the one that hides weeds |
| Crown-in-weed rate | labelled tree pixels (or a 0.5 m disc around the centre) flagged as weed | the "crown taken for weed" error |
| Young-tree stratum | same metrics on the smallest third of crowns by region area | where every method is weakest; report separately |
| Stability | tree count and total crown area on the four unlabelled frames vs the lattice count | catches parameter brittleness ([Yu et al. 2022](https://api.crossref.org/works/10.3390/rs14020295)) |
| Boundary IoU | only if the 104 labels are polygons (unverified; if points, skip) | crown-area bias, which Dong et al. report as slight overestimation |

Baseline first (current ExG mask, no lattice seeds), then the same metrics after step 1, then after step 3. No target numbers are set here; the orchard papers above suggest counts near 99% are achievable in clean blocks and that the weedy-block number is the one to watch.

## Unverified and not found

- Dong et al. 2020 and Jemaa et al. 2022/2023 full texts (PDFs retrieved but not text-readable here); numbers come from abstracts.
- Eucalyptus GSD-vs-height claim (page 404).
- Any orchard-specific detector with downloadable weights and a stated licence.
- Install footprint of DeepForest / detectree2 on this PC.
- Whether the 104 tree labels are points or polygons.
