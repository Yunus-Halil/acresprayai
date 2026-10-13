# PhenoBench devkit and baselines: what exists and what to reuse

Read-only investigation of https://github.com/PRBonn/phenobench and
https://github.com/PRBonn/phenobench-baselines on 2026-10-13 (a delegated
read of the READMEs, configs, test and predict scripts, licences, and HTTP HEAD
requests on the checkpoint URLs). Nothing was downloaded, cloned, installed or
run. Scores are the paper's test-set numbers (arXiv 2306.04557v2); no val-set
numbers are published. Items marked "unverified" were not confirmed from source.

## Model inventory

Checkpoint URLs are under `https://www.ipb.uni-bonn.de/html/projects/phenobench/`; all answered HEAD 200.

| Model (directory) | Task | Weed vs crop in output | Individual plants | Architecture / stack | Checkpoint | Test score |
|---|---|---|---|---|---|---|
| ERFNet (`semantic_segmentation`) | semantic | yes, ids 0/1/2 | no, pixels only | ERFNet encoder-decoder; Lightning 1.6.2, torch 1.10.1+cu113, Python 3.8 | `semantic-seg-erfnet.ckpt`, 25.1 MB | mIoU 85.98; crop 94.30, weed 64.37, soil 99.28 |
| DeepLabV3+ R50 (`semantic_segmentation`) | semantic | yes | no | DeepLabV3+ ResNet-50, OS 8, trained from scratch; same stack | `semantic-seg-deeplab.ckpt`, 477.6 MB | mIoU 85.97; weed 64.59 |
| Mask R-CNN (`panoptic_segmentation/rcnn`) | plant instances | yes, label per detection | yes | plain torchvision `maskrcnn_resnet50_fpn(num_classes=3)`, trained from scratch; Python 3.8, CUDA 11.3 | `rcnn/panoptic_segmentation/last.pt`, 525.9 MB, dict key `model_state_dict` | PQ 65.79; crop 67.61, weed 31.30 |
| Panoptic-DeepLab | plant instances | yes | yes | MobileNetV2 backbone; Docker torch 1.10/cu11.3 | `PanopticDeeplab/model.pth`, 31.2 MB | PQ 57.97; weed 22.61 |
| Mask2Former | plant instances | yes | yes | detectron2 v0.6, ResNet-50, 100 queries, compiled MSDeformAttn CUDA ops | `Mask2former/model.pth`, 176.5 MB | PQ 69.99; weed 40.39 (best) |
| Faster R-CNN (`plant_detection/rcnn`) | plant boxes | yes | boxes | torchvision `fasterrcnn_resnet50_fpn`, from scratch | `rcnn/plant_detection/last.pt`, 494.4 MB | mAP 40.43; weed AP 17.62 |
| YOLOv7 (`plant_detection/yolov7`) | plant boxes | yes (soil/crop/weed) | boxes | WongKinYiu/yolov7 submodule, img 1024 | `YOLOv7/yolov7_plant_detection.pt`, 74.9 MB | mAP 60.48; weed AP 37.91 |
| Mask R-CNN / Mask2Former leaves | leaf instances | no (crop leaves) | leaves | as above | 525.9 MB / 176.5 MB | PQ leaf 59.74 / 57.50 |
| Weyler et al., HAPT (`hiearchical_panoptic_segmentation`) | crops + crop leaves | no weed instances (HAPT: weed as a semantic class only) | crops, leaves | BranchedERFNet; HAPT on Google Drive | 27.5 MB; HAPT size not stated | PQ 40.49; HAPT PQ 65.27, weed IoU 61.11 |

Notes from the code:

- Semantic nets normalise each image by its own per-channel mean and standard deviation (not ImageNet statistics), centre-crop 1024 at test, and write uint8 argmax PNGs (ids 0/1/2). Labels 3 and 4 were mapped to 1 and 2 for training.
- Mask R-CNN scales images by 1/255 only; test uses NMS 0.5, score over 0.6, mask over 0.5; `.cuda()` is hard-coded and `torch.load` has no `map_location`.
- YOLOv7 inference: `detect.py --img-size 1024 --conf-thres 0.0 --iou-thres 0.65 --save-txt --save-conf`.
- The plant_detection README links the same `last.pt` for Faster R-CNN and Mask R-CNN (probably a README error; unverified).

## Direct answers

1. **Weed versus crop automatically:** every plant-level model (ERFNet, DeepLabV3+, Mask R-CNN, Panoptic-DeepLab, Mask2Former, Faster R-CNN, YOLOv7). The leaf and hierarchical models do not give weed instances.
2. **Individual weed instance masks:** Mask R-CNN, Panoptic-DeepLab, Mask2Former. The detectors give boxes; the semantic nets need connected components, like our classical baseline.
3. **Checkpoints:** all downloadable from the IPB server, 25 MB to 526 MB. HAPT only via Google Drive. The torchvision models were trained from scratch on PhenoBench (`pretrained=None`), so they carry no ImageNet or COCO licence baggage; they do carry the dataset's.
4. **Official evaluator on our format:** yes. `phenobench-eval` reads `<prediction_dir>/<subfolder>/<exact reference filename>.png` through PIL into int32, so uint16 PNGs work. Layout: `semantics/` for the semantic task; `semantics/` plus `plant_instances/` for panoptic; `plant_bboxes/<stem>.txt` (`label cx cy w h score`, normalised) for plant detection. Filenames must match the split's reference names exactly. The panoptic evaluator assigns each predicted instance's class per pixel from the predicted semantic map, ignores id 0, matches greedily at IoU over 0.5, and ignores reference instances with visibility at or below 0.5. The `eval` extra pins `torchmetrics==0.10.3`; whether that installs on Python 3.12 is unverified.
5. **Windows, AMD GPU, CPU:** no model ships a CPU or DirectML path; all were run on CUDA in Docker. Pure-PyTorch models (ERFNet, DeepLab, torchvision Mask R-CNN and Faster R-CNN, YOLOv7, Panoptic-DeepLab) can run CPU-only with a current CPU torch wheel if the training wrappers are bypassed (strip the Lightning prefix from state-dict keys, `map_location='cpu'`, reimplement the normaliser). The pinned Lightning 1.6.2 / torch 1.10 stacks will not install on Python 3.12. Mask2Former needs detectron2 v0.6 (no Windows wheels) and compiled CUDA deformable-attention ops: not a plausible path on this machine.
6. **Licences:** devkit MIT. The baselines README defers to sub-folder licences, but `semantic_segmentation`, `rcnn`, `weyler` and `HAPT` have no LICENSE file (not stated). Panoptic-DeepLab Apache-2.0; vendored Mask2Former MIT; YOLOv7 GPL-3.0. No checkpoint carries a licence statement. Any checkpoint trained on PhenoBench inherits the dataset question recorded in `license-inventory.md`.

## Recommendation for the comparison against the classical baseline

1. **First choice: ERFNet semantic checkpoint (25 MB) plus our own connected components.** Lightest dependency (CPU torch plus the roughly 150-line model file), the highest weed pixel IoU of all the baselines (64.4), and the same output modality as the classical detector, so the comparison isolates "learned colour and texture" from everything else. Risks: the state-dict key prefix and the exact per-image normaliser must be reproduced (unverified until tried).
2. **Second choice: torchvision Mask R-CNN panoptic checkpoint (526 MB).** Class-labelled weed instances with one torchvision call and a `map_location='cpu'` load; no detectron2. Weed PQ 31.3 is modest and CPU inference at 1024 x 1024 will be slow; cross-version key compatibility is likely but unverified.
3. Mask2Former is the best scorer (weed PQ 40.4) and is not runnable here.

Both downloads need the founder's approval (rule 8) and a CPU torch wheel in the lab venv (about 200 MB, also an install to approve). The `eval` extra of the devkit is not needed for either: the lab's own scorer already reproduces the greedy IoU-0.5 matching and adds the category and size-band views the official tool lacks.

## Sources read by the investigation

Baselines: repository root README, `.gitmodules`, the GitHub tree API; `semantic_segmentation/` (README, requirements, both configs, test.py, postprocessor, image normaliser, dataset, ERFNet and DeepLab model files); `panoptic_segmentation/` (rcnn README, test.py, environment.yml, config, model, dataloaders; panopticdeeplab README, Dockerfile, requirements, LICENSE, config, predict.py); `leaf_instance_segmentation/mask2former/` (README, Dockerfile, requirements, configs, Mask2Former LICENSE, predict.py, evaluator); `plant_detection/` (rcnn README, test.py, environment, model; yolov7 README, Dockerfile, data yaml); `hiearchical_panoptic_segmentation/` (HAPT and weyler READMEs, requirements, report.py) and PRBonn/HAPT. Devkit: README, pyproject, LICENSE, the evaluation scripts and the validator. Also phenobench.org benchmarks and dataset pages, arXiv 2306.04557, the YOLOv7 licence and detect.py, and HEAD requests on the twelve checkpoint URLs. Not reachable: the baselines root CITATION.md, the mask2former symlinked README, HAPT `main/requirements.yml`.
