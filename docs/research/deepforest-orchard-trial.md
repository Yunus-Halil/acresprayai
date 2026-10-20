# DeepForest pretrained tree-crown detector on Swardus orchard frames

Date: 2026-10-19. Research trial only; nothing under `src/` or `research/` was touched, no commit was made, the frames and labels were read-only.

## Question

Does the pretrained DeepForest tree model (`weecology/deepforest-tree`, RetinaNet, one class "Tree") find the young cultivated trees in our DJI orchard frames, scored against the hand labels for DJI_0301? Does it merge neighbours? Does it box weed clumps?

## Setup (reproducible)

Everything lives under `D:\swardus-research\deepforest\`:

```
D:\swardus-research\deepforest\
  venv\                     Python 3.12.10 venv (CPU torch)
  hf-cache\                 Hugging Face cache (HF_HOME) with the weights
  scripts\run_trial.py      the whole trial: downsample, predict_tile, map back, overlay, score, time
  out\                      per-frame CSVs, overlays, timings.csv, scores_DJI_0301.csv, run_info.json, run_log.txt
  requirements-frozen.txt   pip freeze of the venv
  pip-torch.log, pip-deepforest.log
  report.md                 this file
```

Commands (PowerShell; pip cache and temp kept on D:):

```powershell
$env:PIP_CACHE_DIR='D:\swardus-research\pip-cache'; $env:TMP='D:\swardus-research\tmp'; $env:TEMP='D:\swardus-research\tmp'
& C:\Users\Yunus\AppData\Local\Programs\Python\Python312\python.exe -m venv D:\swardus-research\deepforest\venv
& D:\swardus-research\deepforest\venv\Scripts\python.exe -m pip install --upgrade pip
& D:\swardus-research\deepforest\venv\Scripts\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
& D:\swardus-research\deepforest\venv\Scripts\python.exe -m pip install deepforest
$env:HF_HOME='D:\swardus-research\deepforest\hf-cache'
& D:\swardus-research\deepforest\venv\Scripts\python.exe D:\swardus-research\deepforest\scripts\run_trial.py --factors 5 8 10 --out D:\swardus-research\deepforest\out
```

CPU torch was installed first so that `pip install deepforest` kept it (it did; no CUDA wheel was pulled). No install or download error occurred.

### Versions

| Package | Version |
|---|---|
| Python | 3.12.10 |
| deepforest | 2.1.0 |
| torch | 2.14.1+cpu |
| torchvision | 0.29.1+cpu |
| pytorch-lightning | 2.6.6 |
| numpy / pandas / pillow | 2.5.2 / 3.0.6 / 12.3.0 |
| timm / transformers | 1.0.30 / 5.12.1 |

Full list: `D:\swardus-research\deepforest\requirements-frozen.txt` (93 packages).

### Weights

- Loaded with `deepforest.main.deepforest().load_model("weecology/deepforest-tree")` (the 2.x API; `use_release()` is gone). The library downloads from Hugging Face itself; `revision` = `main`, snapshot commit `cc21436bc5d572dde8ff5f93c1e71a32f563cace`, `model.safetensors` 129 MB, 32.3 M parameters, `label_dict {"Tree": 0}`, `num_classes 1`. The backbone download `resnet50-0676ba61.pth` (98 MB, torchvision) went to `C:\Users\Yunus\.cache\torch\hub\checkpoints\` because torchvision ignores HF_HOME; it can be deleted or moved with `TORCH_HOME` if C: matters.
- Default config used: `score_thresh 0.1`, `nms_thresh 0.05`, architecture `retinanet`.

### Licence and training data (from the repo and model card, read 2026-10-19)

- Code: MIT License, "Copyright (c) 2019, Ben Weinstein" (`LICENSE` in weecology/DeepForest).
- Weights: the Hugging Face model card for `weecology/deepforest-tree` carries the metadata `License: mit`. No separate terms are attached to the weights.
- Training data, as the model card and the "Prebuilt models" doc describe it: a semi-supervised approach in which "millions of moderate quality annotations are generated using a LiDAR unsupervised tree detection algorithm, followed by hand-annotations of RGB imagery from select sites". Papers: Weinstein et al. 2019, *Remote Sensing*, "Individual Tree-Crown Detection in RGB Imagery Using Semi-Supervised Deep Learning Neural Networks" (single site); Weinstein et al. 2020, *Ecological Informatics* (cross-site comparison); Weinstein et al. 2020, *Methods in Ecology and Evolution*, "DeepForest: A Python package for RGB deep learning tree crown delineation". The underlying imagery is the NEON Airborne Observation Platform RGB over US forest sites (from the papers; the current model card itself does not name NEON or the sites).
- Resolution, from the "How do I make the predictions better?" doc: "The prebuilt model was trained on 10cm data at 400px crops." and "The model is sensitive to predicting new image resolutions that differ." The doc says cross-resolution prediction "should be explored carefully" and that "training a proper model with local data is the best chance at getting good performance."

So: forest canopies at 10 cm/px, from aircraft; not orchards, not drones, not 1 cm/px.

## Method

- Frames: DJI_0301, 0303, 0312, 0320, 0327 (5472 x 3648, ~0.99 cm/px, nadir, April, young trees in rows ~5.1 m apart, ~3.2 m along the row).
- Each frame was downsampled by a factor of 5, 8 and 10 with a box filter (PIL `Image.BOX`), giving 4.95, 7.92 and 9.9 cm/px (1094x730, 684x456, 547x365 px). The downsampled RGB array was passed to `predict_tile(image=..., patch_size=400, patch_overlap=0.25)`, default score threshold 0.1, default tile-merge `iou_threshold 0.15`. Boxes were multiplied back to original pixels.
- Outputs per frame and factor: `out\<frame>_ds<f>.csv` (xmin, ymin, xmax, ymax, score in original px, plus centre and size in px and m) and `out\<frame>_ds<f>_overlay.png` (boxes in red on a 1/4-scale copy; on DJI_0301 the labels are drawn too: green rings = labelled trees, yellow rings = labelled weeds).
- Scoring on DJI_0301 against the 104 labelled trees (`cls == "crop"`): a tree is *found* if some box contains its point or some box centre is within 1.2 m (121 px) of it. *Boxes on a labelled tree* = boxes that contain at least one labelled tree point (not precision: unlabelled trees may exist, and labels are only points). *Weeds called trees* = boxes whose centre is within 1.2 m of a labelled weed point and not within 1.2 m of any labelled tree. Weed labels are not exhaustive, so that count is a floor.
- Timing: wall time of `predict_tile` only (frame load and resize excluded), CPU, 11 torch threads on a 12-core machine. Peak RAM is the process peak working set (psutil `peak_wset`), which includes the model and the loaded frame.

## Results

### DJI_0301 against the 104 labelled trees

| Factor | cm/px | Boxes | Trees found | Recall | Boxes on a labelled tree | Share of boxes on a labelled tree | Boxes holding 2+ trees | Weeds called trees | Median box (w x h) | Median score |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 4.95 | 137 | 100 | **96.2 %** | 97 | 70.8 % | 0 | 10 | 1.49 x 1.48 m | 0.44 |
| 8 | 7.92 | 90 | 82 | 78.8 % | 80 | 88.9 % | 1 | 1 | 2.14 x 1.98 m | 0.46 |
| 10 | 9.90 | 73 | 70 | 67.3 % | 68 | 93.2 % | 1 | 2 | 2.28 x 2.18 m | 0.46 |

Where the boxes that are not on a labelled tree sit (DJI_0301):

| Factor | Contain a tree point | Centre within 1.2 m of a tree but not containing it (shadow or part of a crown) | Near a tree and a weed, containing neither | Near a labelled weed only | Near nothing labelled |
|---|---|---|---|---|---|
| 5 | 97 | 16 | 4 | 10 | 10 |
| 8 | 80 | 2 | 0 | 1 | 7 |
| 10 | 68 | 1 | 0 | 2 | 2 |

Boxes per labelled tree at factor 5: 95 trees have exactly one box, 1 tree has two boxes, 8 have none (4 of those are still "found" by the 1.2 m centre rule). No box holds two trees at factor 5; one box does at 8 and at 10.

The four trees missed at factor 5 (labels 14, 33, 43, 56; contact sheet `out\DJI_0301_ds5_missed_trees.png`) are the smallest plants in the frame: a stake with a few leaves, well under 1 m across, next to boxed neighbours. Their omission is a size limit, not a confusion.

### All five frames: boxes, time, memory (CPU)

| Factor | cm/px | Boxes per frame (min / mean / max) | Seconds per frame (mean / max) | Peak RSS |
|---|---|---|---|---|
| 5 | 4.95 | 137 / 147 / 157 | 5.0 / 5.5 | 1.15 GB |
| 8 | 7.92 | 76 / 85 / 97 | 1.9 / 2.1 | 1.15 GB |
| 10 | 9.90 | 58 / 68 / 78 | 1.1 / 1.1 | 1.15 GB |

Per-frame rows are in `out\timings.csv`. Model load (first run, including the HF download) took about 34 s; after that, loading is a few seconds. Resizing a 5472 x 3648 JPEG adds ~0.5 s per frame outside the timed window.

## Reading

**Does it find the young trees?** Yes, at 5 cm/px: 100 of 104 labelled trees on DJI_0301, and the four it misses are the tiny ones. At the resolution it was trained for (10 cm/px) it finds only two thirds; at 8 cm/px about four fifths. The trees here are ~2 m crowns, which at 10 cm/px are ~20 px wide, below what the forest-canopy model keys on, so the "expected 10 cm" guidance does not transfer to this orchard. Half the training scale is the useful setting, with the known cost below.

**Does it merge neighbours?** No. Rows are 5.1 m apart and trees 3.2 m along the row, and crowns are ~2 m, so neighbours do not touch; at factor 5 no box holds two labelled trees, and at 8 and 10 one box does. Boxes at factor 5 are *smaller* than the crowns (median 1.5 m against ~2.2 m at factor 10), so the failure mode at 5 is the opposite: it sometimes splits a crown or boxes the crown's shadow as a second object (16 near-tree boxes that do not contain the stem point, 1 tree with two boxes). At 8 and 10 the boxes are crown-sized and the splitting all but disappears.

**Does it box weed clumps?** Yes, and this is the real limit. On DJI_0301 at factor 5, 10 boxes sit on labelled weed points with no tree near, and 10 more sit on nothing labelled; by eye these are weed patches and shadow fragments. On DJI_0320 (no labels; see `out\DJI_0320_ds5_overlay.png`) it boxes the orchard trees on the right, the younger planting on the left, *and* dozens of scrub and weed patches along the farm track, all as "Tree". The model answers "green roundish blob", not "cultivated tree". Nothing in it knows about rows or planting spacing.

**Runtime.** 5 s per frame at factor 5 on CPU, 1.1 GB. Fine for a batch job, too slow for in-browser, and it needs a Python service with torch and a 129 MB weight file.

## Decision input

- As a tree *proposer*, DeepForest at factor 5 is a usable, zero-training baseline: 96 % recall, no neighbour merging, 5 s/frame on CPU, MIT licence on code and weights.
- It cannot be used alone: about 30 % of its boxes on DJI_0301 are not on a labelled tree (shadows, crown fragments, weed clumps), and on a frame with field-edge scrub it boxes the scrub freely. Any use would have to sit behind the planting-layout rows (`planting-layout`: 100/104 labelled trees fall within 0.5 m of a row) and reject off-row boxes, and would still need a size or score gate for crown fragments and shadow boxes.
- Compared with what we already have: the row reader already places 100/104 trees on rows from three clicks; DeepForest adds an independent per-tree box (size, position) at 96 % recall without clicks, nothing more. If the question is "which plants in the row are trees and which are weeds", the current model does not separate them; a local fine-tune on our own labels (the doc's own advice) would be the next step, and it would be a training job, not a configuration change.
- Not measured: performance on summer or canopy-closed orchards, non-nadir frames, other crops, and the real count of unlabelled trees on DJI_0301 (so the 70.8 % "boxes on a labelled tree" at factor 5 is a floor, not precision).

## Files

- Script: `D:\swardus-research\deepforest\scripts\run_trial.py`
- Outputs: `D:\swardus-research\deepforest\out\` (15 CSVs, 15 overlays, `timings.csv`, `scores_DJI_0301.csv`, `run_info.json`, `run_log.txt`, `DJI_0301_ds5_missed_trees.png`)
- A smoke run (DJI_0301, factor 10 only) is in `D:\swardus-research\deepforest\out_smoke\`; its numbers match the main run.
- Copy of this report: `C:\Users\Yunus\Desktop\acrespraydevelopmentg\acresprayai\docs\research\deepforest-orchard-trial.md` (uncommitted).