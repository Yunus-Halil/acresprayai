# License inventory

Recorded separately per artifact. This is an inventory for founder review, not
legal advice; nothing here concludes whether a Swardus product would carry
share-alike or non-commercial obligations.

| Artifact | License as stated by its source | Where stated | Notes for Swardus |
|---|---|---|---|
| PhenoBench dataset v1.1.0 (images and annotations) | Website: **CC BY-SA 4.0** (https://www.phenobench.org/dataset.html). Archive `README.MD`: **CC BY-NC-SA 4.0** | both, verbatim, kept intact | **Working assumption, founder's decision 2026-10-13: CC BY-SA 4.0 per the official website.** The discrepancy with the shipped README is recorded here and not investigated further in this phase. This is an assumption for research planning, not a legal determination. Any training on, or redistribution of, the data or its derivatives still goes to the founder first. |
| PhenoBench devkit (`phenobench` 0.1.0 on PyPI) | MIT | `LICENSE` in the sdist | Loader, validator, evaluator. Fine to use and adapt with attribution. Its `eval` extra depends on torch, torchvision, torchmetrics 0.10.3. |
| PhenoBench baselines repository (PRBonn/phenobench-baselines) and its pretrained checkpoints | not yet inspected | | Each model directory may carry its own license (ERFNet, DeepLabV3+, Mask R-CNN, Panoptic DeepLab, Mask2Former, Faster R-CNN, YOLOv7). Checkpoints trained on CC BY-NC-SA data may inherit restrictions independent of the code license. To be recorded per model in Phase 7 before any download. |
| YOLOv7 (if used) | GPL-3.0 | upstream repository | Copyleft; a commercial integration question on its own. |
| Mask2Former (if used) | MIT code; some components (Swin backbones) under separate terms | upstream repository | To verify per checkpoint. |
| Detectron2 / torchvision Mask R-CNN | Apache-2.0 / BSD-3 | upstream | Code is permissive; weights trained on PhenoBench are the question. |
| Segment Anything (if used for promptable segmentation) | Apache-2.0 code and weights | upstream | Download size and CPU latency are the practical concerns, not the license. |
| numpy, scipy, scikit-image, matplotlib, pillow, pytest | BSD / BSD / BSD / PSF-style / MIT-CMU / MIT | PyPI | Research-only venv; not added to the production app. |
| This lab's code (`research/weed-vision-lab/`) | Swardus proprietary | `pyproject.toml` | Original work. Contains no dataset content. |
| Rendered panels and contact sheets under the output directory | Derivative of CC BY-NC-SA content | | Kept outside the repository and never published. The committed `reports/` hold only numbers and names. |

## Attribution to carry with any PhenoBench-derived figure or number

Weyler, Magistri, Marks, Chong, Sodano, Roggiolani, Chebrolu, Stachniss, Behley.
"PhenoBench: A Large Dataset and Benchmarks for Semantic Image Interpretation in
the Agricultural Domain." IEEE Transactions on Pattern Analysis and Machine
Intelligence, 2024. https://www.phenobench.org

## Open questions for the founder

1. The dataset is NonCommercial. Is evaluation-only use on a commercial product's research track acceptable to Swardus's counsel? (Common reading: research and benchmarking are fine; training a shipped model on it is not.)
2. Any pretrained checkpoint trained on PhenoBench carries the same question. Decide before Phase 7 downloads.
