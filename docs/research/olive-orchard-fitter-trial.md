# Planting-layout fitter on a public olive orchard (OliveTreeCrownsDb), 2026-10-19

An independent run of the browser-side planting-layout fitter (`src/lib/weedVision/layout/plantingLayout.ts`, driven headless by `scripts/bench/layoutTrial.ts`) on six raw frames of a public olive-orchard dataset at 1.67 cm/px, scored against the dataset's own per-tree boxes. Nothing in the repository was modified; all scripts written for this live in `D:\swardus-research\olive\scripts\`.

**Headline.** The fitter finds the rows (spacing and direction within a few percent of the labelled grid on every frame) but puts its plants on the grass between consecutive trees, not on the crowns: 3 of 820 labelled trees have a fitted plant within 0.6 m (0.4%), the median distance from a labelled tree to the nearest fitted plant is 2.93 m (half a spacing), and 595 of 602 fitted plants have no labelled tree centre within 1.2 m. The cause is measurable: the app's vegetation mask (excess green with an Otsu threshold) lights 64-82% of the ground outside the tree boxes and only 36-56% inside them on five of six frames. On a grassed olive orchard the silver-green canopy is less "green" than the sward, so the lattice phase-locks onto the inter-tree grass. Ring size cannot be assessed from this run (3 matches); the median ring radius over all plants is 2.43 m against a median half box side of 1.34 m.

## Dataset

- **OliveTreeCrownsDb: A High-Resolution UAV Dataset for Detection and Segmentation in Agricultural Computer Vision**, Mendeley Data, version 3, published 2024-12-23, DOI 10.17632/xym8rd2srf.3. Contributors (as listed by the dataset record): Youness Hnida, Mohamed Adnane Mahraz, Ali Achebour, Ali Yahyaouy, Jamal Riffi, Hamid Tairi; Universite Sidi Mohamed Ben Abdellah, Faculte des Sciences Dhar El Mahraz, Fes.
- **Citation text.** The dataset page's citation widget did not render in the fetched page, so the citation is assembled from the record's metadata in Mendeley Data's standard form: *Hnida, Youness; Mahraz, Mohamed Adnane; Achebour, Ali; Yahyaouy, Ali; Riffi, Jamal; Tairi, Hamid (2024), "OliveTreeCrownsDb: A High-Resolution UAV Dataset for Detection and Segmentation in Agricultural Computer Vision", Mendeley Data, V3, doi: 10.17632/xym8rd2srf.3.*
- **Licence as read.** The page shows "CC BY 4.0" (confirmed on https://data.mendeley.com/datasets/xym8rd2srf/3). The record's licence field reads, verbatim: *"Creative Commons Attribution 4.0 International" (short name "CC BY 4.0", http://creativecommons.org/licenses/by/4.0): "You can share, copy and modify this dataset so long as you give appropriate credit, provide a link to the CC BY license, and indicate if changes were made, but you may not do so in a way that suggests the rights holder has endorsed you or your use of the dataset. Note that further permission may be required for any content within the dataset that is identified as belonging to a third party."*
- **Method as stated by the authors** (record's "method" field): "In the Meknes region of Morocco, a DJI Phantom 4 RTK drone captured 46 high-resolution images over the study farm at an altitude of 74.7 meters", segmented into 1x1 (original), 3x3, 6x6 and 9x9 grids, each annotated for olive tree crowns; plus a point cloud, a DEM, an orthophoto and KML. No GSD is stated anywhere in the record.
- **Contents** (from the record's file list, 2.27 GB in all): 46 raw frames `DJI_0364.JPG` to `DJI_0409.JPG` (5472 x 3648, ~8.5 MB each) with one Pascal-VOC `.xml` and one YOLO `.txt` per frame (one class, "0"); the tiled sets; and the terrain products.
- **Downloaded** (into `D:\swardus-research\olive\data\`, every file's SHA-256 checked against the record): all 46 raw-frame `.xml` files (0.7 MB), six raw frames with their `.txt` (51 MB), and one 4 MB terrain file (`DEM_Meknas.txt`, fetched while looking for a readme, unused). No download failed.

## Frames and ground truth

The six frames were chosen from the 46 by the boxes alone (`pick_frames.py`): for each frame the median nearest-neighbour distance between box centres and the share of trees whose nearest neighbour lies within 15% of that median. All 46 frames score 0.87-1.00 on that share (it is one regular orchard); the six were taken from the top of the ranking, spread along the flight, with 94 to 186 trees each: DJI_0365, 0369, 0380, 0386, 0395, 0407. XML and YOLO box counts agree on all six.

- **Pixel size.** Each frame's XMP carries `RelativeAltitude` 60.97-61.12 m (height above take-off), focal length 8.8 mm, camera FC6310R (13.2 mm sensor width over 5472 px). GSD = 61.05 x 0.0132 / 5472 / 0.0088 = **0.0167 m/px**, derived the same way as the repository's own 0.99 cm/px for DJI_0301 (height above take-off, not above the trees). The 1.78 cm/px quoted for this dataset would correspond to 65 m; the difference (6%) scales every metre figure below by the same factor and changes nothing about where the plants fall. The labelled grid at 0.0167 m/px: nearest-neighbour median 5.20-5.46 m per frame; median box side 2.68 m (half side 1.34 m).
- **Ground truth.** The box centre of each tree is a "crop" label; there are no weed labels. The frames carry a single cultivar block; DJI_0395 also has a hedge row of old, much larger olives (half box side up to 4.1 m) along a cereal field, and DJI_0386 a farmyard with three large trees at its edge.
- **Stand-in maps.** `prep_olive.py` reproduces `research/weed-vision-lab/scripts/prep_two_stage_trial.py` (same meta.json keys, `z23.rgba`, `z22.rgba`, box-filter resampling, north-up placement at the EXIF position) with the GSD passed explicitly, the labels taken from the boxes, and two extra keys (`boxes` in z23 global pixels and the derived `clicks`). The repository script could not be used as is: its frame folder, GSD and label file are constants in the source. Scale frame to z23: 1.078; z23 raster 5899 x 3933; z22 2949 x 1966.
- **Clicks.** `layoutTrial.ts` derives DJI_0301's clicks from the labels with windows of 2.5-4 m (neighbour) and 4-7 m (next row) that no 5.3 m olive grid satisfies, so the same rule was applied with the windows set by the labelled spacing: the tree nearest the frame centre, its nearest labelled neighbour, and the nearest tree standing at least half a spacing off that row line. Clicks were passed with `--clicks` as z23 global pixels.

## Exact commands

From `D:\swardus-research\olive\scripts\` (Python 3.12, Pillow 12.3, numpy 2.5; every Python call with `-I`):

```
curl -sS -L "https://data.mendeley.com/public-api/datasets/xym8rd2srf" -o _dataset.json
python -I download.py _dataset.json ../data/raw_xml fd777185-6a7f-4b76-8e16-8104e35fe736 ""
python -I download.py _dataset.json ../data/raw_jpg b162deb5-11ea-4018-9663-58c925f3d3f2 "DJI_0365.JPG,DJI_0369.JPG,DJI_0380.JPG,DJI_0386.JPG,DJI_0395.JPG,DJI_0407.JPG"
python -I download.py _dataset.json ../data/raw_txt 3be482a7-764e-48c6-b0eb-601bd75b246c "DJI_0365.txt,DJI_0369.txt,DJI_0380.txt,DJI_0386.txt,DJI_0395.txt,DJI_0407.txt"
python -I pick_frames.py ../data/raw_xml
python -I exif_info.py ../data/raw_jpg/*.JPG
python -I prep_olive.py --jpg ../data/raw_jpg --xml ../data/raw_xml --out ../trial --gsd 0.0167 DJI_0365 DJI_0369 DJI_0380 DJI_0386 DJI_0395 DJI_0407
```

From the repository root, one run per frame with that frame's `clicks` from its `meta.json` (shown for DJI_0380):

```
npx vite-node scripts/bench/layoutTrial.ts -- --dir D:/swardus-research/olive/trial --frame DJI_0380 --clicks "1041388834.94,858653593.34;1041388878.60,858653244.60;1041389188.00,858653562.62" --out olive
```

(The other five: DJI_0365 `1041397037.72,858660710.23;1041396906.74,858661043.33;1041396673.35,858660647.70`; DJI_0369 `1041394239.12,858658809.27;1041394602.41,858658779.62;1041394177.13,858659170.94`; DJI_0386 `1041387542.45,858651921.66;1041387562.40,858652264.47;1041387886.89,858651983.65`; DJI_0395 `1041393176.11,858650008.84;1041393553.42,858650062.74;1041393580.91,858649710.77`; DJI_0407 `1041398573.42,858659672.44;1041398558.87,858660024.42;1041398207.44,858659750.60`.) Each run's stdout is kept as `trial/<frame>/trial-olive.log`; the trial writes `layout-olive.png` and `cover-olive.json` beside the frame.

Scoring, again from the scripts folder:

```
python -I compare_rings.py ../trial olive DJI_0365 DJI_0369 DJI_0380 DJI_0386 DJI_0395 DJI_0407   # -> trial/compare-olive.json
python -I mask_stats.py ../trial DJI_0365 DJI_0369 DJI_0380 DJI_0386 DJI_0395 DJI_0407
python -I surround_split.py ../trial olive DJI_0365 DJI_0369 DJI_0380 DJI_0386 DJI_0395 DJI_0407
python -I crops.py ../trial olive ../figures DJI_0380:centre DJI_0365:centre DJI_0395:centre DJI_0386:centre DJI_0369:centre DJI_0407:centre
```

`compare_rings.py` maps the boxes into the trial's raster with the trial's own transform (z23 global / 2 - z22 origin, divided by k = round(0.08 / mpp22) = 3; raster 0.0929 m/px, equal to the `rasterMpp` the trial prints) and takes the ring x, y, r from `cover-olive.json`. A tree is found when a fitted plant lies within 0.6 m of its box centre (the trial's own rule); "rings on nothing labelled" is a fitted plant with no box centre within 1.2 m (and, beside it, the weaker rule: a plant centre outside every box grown by 1.2 m on each side). The box-area-in-ring share is sampled on a 40 x 40 grid over the box.

## Per-frame results

| frame | trees labelled | plants fitted | found (<= 0.6 m) | missed: median (min) nearest plant, m | rings on nothing labelled, centre / edge rule | fitted along / across / angle (start) | fit score | gaps | rows | ring r median, m | merged | fitMs / rasterMs | mask lit in boxes / outside |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DJI_0365 | 143 | 123 | 0 | 2.79 (1.15) | 122 / 36 | 5.51 / 5.54 / 118.1 (5.54 / 5.61 / 111.5) | 0.824 | 8 | 12 | 2.50 | 118 | 147 / 72 | 0.56 / 0.82 |
| DJI_0369 | 155 | 145 | 1 | 2.90 (0.97) | 143 / 58 | 5.78 / 5.56 / -4.4 (5.65 / 5.51 / -4.7) | 0.806 | 4 | 11 | 2.43 | 139 | 126 / 75 | 0.52 / 0.78 |
| DJI_0380 | 186 | 114 | 0 | 2.96 (1.34) | 114 / 37 | 5.03 / 5.12 / -77.7 (5.44 / 5.37 / -82.9) | 0.676 | 21 | 11 | 2.26 | 113 | 124 / 73 | 0.47 / 0.64 |
| DJI_0386 | 115 | 66 | 0 | 3.12 (1.64) | 66 / 13 | 5.40 / 5.69 / 89.4 (5.32 / 5.27 / 86.7) | 0.523 | 4 | 8 | 2.41 | 55 | 96 / 78 | 0.36 / 0.46 |
| DJI_0395 | 94 | 79 | 2 | 2.71 (0.88) | 75 / 29 | 5.99 / 5.57 / 12.0 (5.90 / 5.46 / 8.1) | 0.461 | 3 | 11 | 2.43 | 67 | 92 / 76 | 0.41 / 0.40 |
| DJI_0407 | 127 | 75 | 0 | 3.33 (1.67) | 75 / 32 | 5.65 / 5.50 / 86.7 (5.46 / 5.61 / 92.4) | 0.704 | 5 | 8 | 2.49 | 70 | 113 / 81 | 0.51 / 0.72 |

Columns: "fitted along / across / angle" are metres and degrees from the trial's `fitted` block, with the lattice the three clicks started from in brackets; "gaps", "rows", "fit score", "merged" (plants whose crown ran into other green) are the trial's own; "mask lit" is the share of z22 pixels above the app's excess-green threshold (replicated in `mask_stats.py`, Otsu clamped to 0.25 on five frames, 0.237 on DJI_0380) inside the labelled boxes against everywhere else. Runtime: `fitMs` 92-147 ms and `rasterMs` 72-81 ms per frame on a 983 x 656 raster (the fit only; the trial's vegetation mask and row reader are outside both timers).

## Overall

- **Tree recall: 3 / 820 = 0.4%** (a fitted plant within 0.6 m of the box centre). Missed trees: nearest fitted plant median 2.93 m; 2 of 817 under 1 m, 379 over 3 m.
- **Rings on nothing labelled: 595 / 602** fitted plants by the centre rule (no box centre within 1.2 m); 205 / 602 by the edge rule. The ring radius is 2.26-2.50 m (median 2.43 m over all 602), so most rings do overlap the boxes of the two trees they sit between, which is what the edge rule counts.
- **Ring against box, matched trees only (n = 3):** ring radius over half the box's mean side 0.53, 0.35 and 0.23 (median 0.35); share of the box's area inside the ring 0.23, 0.10 and 0.04. Two of the three are the large hedge olives of DJI_0395 (half side 2.7-4.1 m) ringed at 0.95 m. This is not a measurement of ring sizing; there are too few matches.
- **Ring against box, unmatched:** median ring radius 2.43 m (602 plants) against median half box side 1.34 m (820 boxes), a ratio of medians of 1.81. Every ring but a handful is "merged" (578 of 602) and sits at the half-spacing cap, because the green the flood fill grows into is the sward, not a crown.
- **By ground cover** (`surround_split.py`, mask lit share in a 1 m annulus round the box): grassy surround (>= 0.6 lit) 1 / 671 found, mixed 0 / 98, bare (< 0.3) 2 / 51. The bare-soil rows of DJI_0380 (26 trees on ploughed ground) were not found either: one lattice is fitted per frame and its phase is set by the grassy majority.
- **The clicked trees themselves:** the nearest fitted plant to the 18 click positions lies 1.35-2.21 m away for 9 of them and 2.68-10.97 m for the other 9. Even the operator-anchored plants (state `operator`, 1-3 per frame) ended 1.4-1.9 m off the clicked crown, moved by the 1 m anchor search plus the 0.5 m re-centring toward the brighter green beside the tree.

## Figures

Each crop is a 30 m window at the frame's centre: yellow = dataset boxes, magenta = fitted plant centre and ring (drawn by `crops.py` from `cover-olive.json`; the trial's own 40-dot green rings are invisible on grass), cyan = the fitted rows, red crosses = the fitter's gaps, white circles = the clicks.

- `olive-orchard-fitter-trial/crop-DJI_0380-centre.jpg`: the clearest case. Rows pass through the trees; every plant centre sits on the grass between two crowns along the row, each ring covering two half-crowns. The two white click circles are on crowns; the nearest magenta centres are 1.4-1.9 m from them.
- `olive-orchard-fitter-trial/crop-DJI_0365-centre.jpg`: the same phase lock, with the lattice also drifting sideways (fitted angle 118.1 against 111.5 at the start) so that rings sit beside crowns as well as between them.
- `olive-orchard-fitter-trial/crop-DJI_0395-centre.jpg`: the orchard edge. Rings continue across the cereal stubble (no trees labelled there), the hedge row of large old olives gets small rings (0.95 m) on two of them, and the regular block to the right shows the between-trees placement again.
- `olive-orchard-fitter-trial/overview-DJI_0386.jpg` (half size): the whole frame. The lattice stops after the right-hand block (66 plants for 115 trees: the left half of the orchard, roughly four columns of boxes, gets no plant at all), and a column of rings runs down the roadside hedge of shrubs on the left, which carries no boxes.

Overviews for all six frames are in `figures/overview-<frame>.png`; the dataset boxes drawn on the raw frames are in `trial/_thumb_DJI_0380.png` and `trial/_thumb_DJI_0395.png`.

## Reading

1. **Rings off the crown, systematically.** This is not a sizing error or an occasional merge: on all six frames the plants are placed half a spacing along the row from the trees. The fitter's objective is green under the plant and bare between plants; on a grassed olive orchard in April the sward is the greener thing. The mask numbers make the mechanism plain (lit share outside the boxes exceeds the share inside on five of six frames, and on the sixth, DJI_0395, they are equal at 0.40 because half that frame is a cereal field). The row direction and spacing survive because the trees and the grass between them share the same lattice; only the phase is wrong.
2. **Merged neighbours.** With the grass connecting every crown, 578 of 602 rings are "merged" and sit at the half-spacing cap (2.26-2.50 m), so the ring says nothing about the crown. On the repository's own frames (cover crop mown or bare between trees) this cap is rarely hit; here it is the norm.
3. **Skipped rows and blocks.** DJI_0386 fits 8 rows and 66 plants for 115 trees: the lattice did not propagate across the left half of the block, and instead followed a roadside hedge. DJI_0380 (186 trees, the densest frame) got 114 plants and 21 gaps: with the phase wrong, many expected positions fall where the mask is darker (a crown's shadow side) and are declared gaps. DJI_0407 and DJI_0386 both found well under two thirds of the labelled trees as plants even before asking whether the plants are on trees.
4. **Operator anchors do not hold.** The clicked trees are the ground truth the operator supplied, yet their plants moved 1.4-1.9 m off the crown. On this ground cover the anchor search (1.0 m) and re-centring (0.5 m) pull toward the sward.
5. **What this does and does not say.** The planting-layout fitter, as built, assumes the plants are the greenest thing on their lattice; it holds on the repository's orchard frames and fails on a grassed olive orchard with silver-green canopies. It is a mask problem before it is a lattice problem: the lattice found the right spacing and direction on every frame (within 0.4 m and 7 degrees of the labelled grid, from three clicks). The rings-versus-boxes measurement that this trial was set up to make cannot be made until the plants land on the crowns; the scripts and the stand-in maps are ready to rerun the moment a mask that separates olive canopy from sward is available (the trial has no switch for that today; it calls `vegetationMask` from `fieldRows.ts` directly).

Not computed here: anything about weeds (the dataset has no weed labels), the tiled sets, the orthophoto, or any other frame of the 46.

## Files

- `D:\swardus-research\olive\data\` raw downloads (untrusted, read only): `raw_jpg/`, `raw_xml/`, `raw_txt/`, `root/`.
- `D:\swardus-research\olive\scripts\` `download.py`, `pick_frames.py`, `exif_info.py`, `prep_olive.py`, `compare_rings.py`, `mask_stats.py`, `surround_split.py`, `crops.py`, and the record's JSON `_dataset.json`.
- `D:\swardus-research\olive\trial\<frame>\` `meta.json`, `z22.rgba`, `z23.rgba`, `layout-olive.png`, `cover-olive.json`, `trial-olive.log`; `trial\compare-olive.json` holds every number in the tables.
- `D:\swardus-research\olive\figures\` the crops and overviews.
- Copied to the repository as `docs/research/olive-orchard-fitter-trial.md` with four figures beside it (uncommitted).