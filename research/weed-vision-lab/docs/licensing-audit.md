# ERFNet and PhenoBench licensing provenance audit

Read-only audit delegated on 2026-10-13 at the founder's request; recorded as delivered. Not legal advice. One correction it mandates for our own records: the upstream ERFNet PyTorch code is CC BY-NC 4.0 (NonCommercial, no ShareAlike), which `docs/license-inventory.md` previously misstated (now corrected); the matching docstring sentence in `src/weedlab/detect/erfnet.py` is left unchanged for now at the founder's instruction not to modify working code during Experiment 6 and is listed as a pending edit.

---

Four artifacts traced separately: architecture, implementation code, dataset, weights. Nothing was modified, installed or downloaded except source and text files into the scratchpad.

## Headline findings

1. **Our docstring and the inventory misstated Eromera's licence.** Both said CC BY-NC-SA 4.0. The actual `license.txt` in Eromera/erfnet_pytorch (and Eromera/erfnet) is **Attribution-NonCommercial 4.0 International** (CC BY-NC 4.0, no ShareAlike). README: "This work is licensed under a Creative Commons Attribution-NonCommercial 4.0 International License, which allows for personal and research use only. For a commercial license please contact the authors."
2. **The PhenoBench checkpoint was not initialised from Eromera's weights** per `config_erfnet.yaml`: `backbone: pretrained: false` (the `pretrained` branch downloads `erfnet_pretrained_cvt.pth`, an ImageNet/Cityscapes model from a sciebo link). Unverified against the checkpoint's own `hyper_parameters`; the paper says nothing about ERFNet initialisation.
3. **Our `erfnet.py` is a condensed derivative of PRBonn's file, which is itself a near-verbatim copy of Eromera's blocks with no notice retained.** Judgement (c) below.
4. **No licence is stated anywhere for the checkpoint**, and `semantic_segmentation/` has no LICENSE file.

## A. Code derivation

**(i) Eromera `train/erfnet.py`** (header "ERFNet full model definition for Pytorch / Sept 2017 / Eduardo Romera"): classes `DownsamplerBlock`, `non_bottleneck_1d`, `Encoder`, `UpsamplerBlock`, `Decoder`, `Net`; `nn.ModuleList` layers; `output_conv` on Decoder.

**(ii) PRBonn `erfnet_modified.py`**: no header, no copyright, no Eromera credit (credit exists only in `semantic_segmentation/CITATION.md`: "For ERFNet, you should cite: romera2017its"). `DownsamplerBlock.__init__`, `non_bottleneck_1d.__init__` and its forward body, and `UpsamplerBlock` are Eromera's lines verbatim (whitespace aside), including the fingerprints `padding=(1*dilated,0)`, `eps=1e-03` beside `eps=1e-3`, `if (self.dropout.p != 0):`, and the Decoder's `nn.ConvTranspose2d(16, num_classes, 2, stride=2, padding=0, output_padding=0, bias=True)` moved into a new `SegmentationHead`. PRBonn's additions: `instance_norm` modules, `apply_batch_norm/apply_instance_norm/apply_relu` flags, `ProjectionHead`, flat attributes `downsampler_block_01..03`, `enc_non_bottleneck_1d_01..13`, `dec_non_bottleneck_1d_01..04`, the `pretrained` download, `forward_ibn_net`.

**(iii) Ours**: classes `DownsamplerBlock`, `NonBottleneck1d` (renamed), `UpsamplerBlock`, `SegmentationHead`, `ERFNetModel`. Identical hyper-parameters (3/16/64/128; dropout 0.03/0.3/0; dilations 1 x5, 2,4,8,16 x2). Constructor expressions are the same as PRBonn's with only cosmetic edits (`padding=(dilated, 0)`); the `eps=1e-3` / `eps=1e-03` inconsistency and the `if self.dropout.p != 0` guard are carried over unchanged. Forward passes are PRBonn's main `forward` with the 13 explicit lines replaced by `setattr`/`getattr` loops and the block forwards chained into single expressions. Removed: `ProjectionHead`, `pretrained`, `forward_ibn_net`, the `apply_*` flags. Kept: the dead `instance_norm` modules (needed because the checkpoint has those tensors). Added: docstring, type hints, loader, normaliser, detector.

**Naming constraint:** the state dict fixes the attribute names (`conv`, `pool`, `bn`, `instance_norm`, `conv3x1_1`, `conv1x3_1`, `bn1`, `conv3x1_2`, `conv1x3_2`, `bn2`, `downsampler_block_01`, `enc_non_bottleneck_1d_06`, `segmentation_head.output_conv`, ...). It does not fix class names, the eps spelling, the dropout guard, argument order, or the forward-pass phrasing, and those all track the file lineage.

**Frank judgement: (c)**, a derivative of Eromera's file through PRBonn's, condensed and partly rewritten. It is not an independent re-implementation from the paper: it was written while reading PRBonn's file (the docstring says "ported from"), it reproduces expression-level fingerprints, and the `instance_norm` placeholders are PRBonn-specific. The hyper-parameters alone are the paper's and would be identical in any clean-room version.

## B. Architecture versus code licence

Commonly understood (not a legal conclusion): copyright protects the expression of a program, not the method or design it implements (idea/expression distinction). A network topology published in IEEE T-ITS is a method; the IEEE copyright on the paper does not restrict building what it describes, and CC BY-NC expressly does not license patents (Section 2(b)(2)), so patent exposure, if any, is independent of the code licence. No patent search was done (unverified). Creative Commons itself advises against CC licences for software, which adds uncertainty about how CC BY-NC applies to a roughly 100-line model definition. A lawyer would need to decide: whether what we took is protectable expression or unprotectable method (merger and thin-copyright arguments for short, functionally dictated code); whether our condensed file is "Adapted Material" under CC BY-NC; and the governing jurisdiction.

## C. PhenoBench baselines code licence

Root README: "License: Please see the licenses of the particular sub-folders." Also: "These are copies from the original repositories. We tried to make it transparent where the code originated with a link to the original repository." The full tree has licence files only at `panoptic_segmentation/panopticdeeplab/src/LICENSE` and `leaf_instance_segmentation/mask2former/src/Mask2Former/LICENSE`. **`semantic_segmentation/` has no LICENSE file**; it has `CITATION.md` (Romera citation) and a README ("We provide the weights of pretrained models."). No licence file means all rights reserved by default under copyright, with the README's deferral resolving to nothing. The root `CITATION.md` the README mentions does not exist (404). `erfnet_modified.py` carries no Eromera notice, so PRBonn's own copy appears not to satisfy CC BY-NC Section 3(a) attribution; that is their exposure, but it means our chain has no notice to inherit.

## D. The checkpoint

- **Owner:** presumably University of Bonn and the PhenoBench authors (site footer "Copyright 2023 University of Bonn"; served from `ipb.uni-bonn.de`). Not stated explicitly for the file.
- **Licence stated for the weights:** none, anywhere read (baselines READMEs, website, paper, IPB directory, which returns 403 with no notice). The paper only says "baselines with code, checkpoints, and predictions publicly available".
- **Dataset licence, both verbatim:** website dataset.html: "We distribute the data under Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0) license." plus "We appreciate donations of any amount you feel appropriate from commercial users." PRBonn/phenobench README FAQ: "CC-BY-SA International 4.0 license, which allows research but also commercial usage as long as the dataset is properly attributed ... and distributed with the same license if altered or modified." Local archive `D:\Drive2downloads\PhenoBench-v110\PhenoBench\README.MD` ("version 1.1.0 (December 2023)"): "We distribute the data under Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0) ... you may not use this work for commercial purposes". The Voxel51 Hugging Face card notes the same conflict and advises confirming directly with the authors at photogrammetry@uni-bonn.de.
- **Does the dataset licence attach to weights?** Positions: (a) under BY-SA, ShareAlike reaches only "Adapted Material"; whether a model is Adapted Material is contested and generally argued to turn on whether the weights reproduce copyrightable content of the images (unverified against CC's own guidance); (b) under BY-NC, the restriction is on use of the data, so training for a commercial product is the live question regardless of whether the weights are a derivative; (c) whether weights are copyrightable at all is unsettled. Which licence governs the copy we hold (archive text versus website text) is itself unresolved.
- **Does the training-code licence attach?** The output of running a program is generally not a derivative of the program unless it embeds the program's expression; so Eromera's CC BY-NC and PRBonn's unlicensed code are unlikely to reach the weights by that route, and the weights were not initialised from Eromera's trained models (config). Needs counsel to confirm.

## E. Summary table

| Artifact | Owner | Licence as evidenced | Evidence | Uncertain | Commercial permission needed? |
|---|---|---|---|---|---|
| ERFNet architecture | Romera et al. (design); IEEE (paper text) | Not a licensed artifact; method published | Eromera READMEs; CITATION.md | Patents not searched | Research: no. Product: probably not for the design itself; needs counsel |
| Eromera erfnet_pytorch code | Eduardo Romera et al. | CC BY-NC 4.0 ("personal and research use only") | `license.txt`, README | Applicability of CC to code; scope of "Adapted Material" | Research: no. Product: yes if our file is Adapted Material (likely on current text); or clean-room re-implementation |
| PRBonn erfnet_modified.py | University of Bonn / authors | None stated (all rights reserved by default); README defers to an absent sub-folder licence | tree listing, root README | Their own CC BY-NC compliance | Research: tolerated by publication, no grant. Product: needs counsel or permission |
| Our erfnet.py | Swardus | Proprietary per pyproject, but derivative (c) of the two above | file comparison | Whether protectable expression was copied | Same as the two rows above |
| PhenoBench dataset v1.1.0 | University of Bonn | Website: CC BY-SA 4.0; archive README: CC BY-NC-SA 4.0 | dataset.html, README.MD, phenobench FAQ | Which text governs | Research: no. Product trained on it: under BY-SA no (share-alike caveats); under BY-NC-SA yes; needs counsel |
| semantic-seg-erfnet.ckpt | University of Bonn / authors (presumed) | None stated | baselines READMEs, IPB 403 | Everything: ownership statement, licence, dataset attachment | Research: no stated grant beyond "publicly available". Product: needs counsel, likely explicit permission |

## Actions that would resolve each uncertainty

1. Correct the docstring and inventory: Eromera is CC BY-NC 4.0, not BY-NC-SA. (Inventory corrected 2026-10-13; docstring pending.)
2. Email photogrammetry@uni-bonn.de: (a) which dataset licence governs v1.1.0; (b) the licence of `semantic-seg-erfnet.ckpt` and the `semantic_segmentation` code; (c) confirm ERFNet was trained from scratch.
3. Email the ERFNet authors for a commercial licence of `erfnet_pytorch`, or re-implement the architecture clean-room from the T-ITS paper by someone who has not read either file, keeping only the state-dict key names as a specification; or avoid loading PRBonn's checkpoint at all.
4. Confirm `pretrained: false` from the checkpoint's `hyper_parameters` via `inspect_checkpoint` (read-only).
5. Train own weights on permissively licensed or own data for anything shipped.
6. Counsel question list: CC on code, Adapted Material for condensed ports, weights as derivative of BY-SA or BY-NC-SA data, jurisdiction.

## Sources read

Local: `research\weed-vision-lab\src\weedlab\detect\erfnet.py`; the fetched `erfnet_modified.py`; `docs\license-inventory.md`; `docs\pretrained-models.md`; `D:\Drive2downloads\PhenoBench-v110\PhenoBench\README.MD`.

Web: https://raw.githubusercontent.com/Eromera/erfnet_pytorch/master/license.txt ; .../master/train/erfnet.py ; .../master/README.md ; https://raw.githubusercontent.com/Eromera/erfnet/master/license.txt ; .../erfnet/master/README.md ; https://github.com/Eromera/erfnet_pytorch ; https://github.com/Eromera/erfnet ; https://raw.githubusercontent.com/PRBonn/phenobench-baselines/main/README.md ; .../main/CITATION.md (404) ; .../main/semantic_segmentation/README.md ; .../semantic_segmentation/CITATION.md ; .../semantic_segmentation/config/config_erfnet.yaml ; .../semantic_segmentation/modules/module.py ; .../modules/__init__.py ; .../modules/erfnet/erfnet_modified.py ; https://api.github.com/repos/PRBonn/phenobench-baselines/git/trees/main?recursive=1 ; https://api.github.com/repos/PRBonn/phenobench-baselines/contents/semantic_segmentation ; https://raw.githubusercontent.com/PRBonn/phenobench/main/README.md ; https://www.phenobench.org/dataset.html ; https://www.phenobench.org/benchmarks.html ; https://arxiv.org/abs/2306.04557 ; https://arxiv.org/html/2306.04557v2 ; https://arxiv.org/pdf/2306.04557v2 ; https://huggingface.co/datasets/Voxel51/PhenoBench_Raw ; https://docs.voxel51.com/dataset_zoo/datasets_hf/phenobench.html ; https://www.ipb.uni-bonn.de/html/projects/phenobench/semantic_segmentation/ (403). Web searches on the PhenoBench licence and checkpoint licence found no additional statements from PRBonn.
