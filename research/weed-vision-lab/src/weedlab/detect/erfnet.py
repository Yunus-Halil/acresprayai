"""The PhenoBench ERFNet semantic-segmentation baseline, run on CPU from the official checkpoint.

Architecture ported from PRBonn/phenobench-baselines `semantic_segmentation/modules/erfnet/erfnet_modified.py`
(read 2026-10-13; the `pretrained` download branch and the `forward_ibn_net`
variant are left out, neither is used by the published checkpoint's test path).
ERFNet itself is Romera et al. 2018; the upstream PyTorch implementation is
licensed CC BY-NC-SA 4.0 (see docs/license-inventory.md).

Preprocessing, exactly as the baseline's `datasets/pdc.py` test path:
  1. torchvision ToTensor: uint8 RGB to float [0, 1], CHW.
  2. SingleImageNormalizer: each channel z-scored by its own mean and std
     (torch.std, unbiased) plus 1e-17; no global statistics.
  3. Centre crop 1024 x 1024 (a no-op for PhenoBench images).
Inference: `ERFNetModel.forward`, argmax over 3 classes: 0 background, 1 crop,
2 weed. Partial classes 3 and 4 were mapped to 1 and 2 for training, so the
network has no notion of "partial".

Provenance: the checkpoint was trained on the PhenoBench train split (the
baseline config trains on `train`, validates on `val`). Our dev_tune and
dev_check are subsets of that train split, so every number from this model on
them is IN-SAMPLE. See the Phase 4 report for how that is labelled.

The detector output follows weedlab.detect.classical.DetectionResult so the
same scorer applies: components of the weed class (`erfnet_weed`) or of the
crop-or-weed classes (`erfnet_veg`), 8-connected, no size floor.
"""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from scipy import ndimage

from weedlab.detect.classical import STRUCT8, DetectionResult

BACKGROUND, CROP, WEED = 0, 1, 2


class DownsamplerBlock(nn.Module):
    def __init__(self, ninput: int, noutput: int):
        super().__init__()
        self.conv = nn.Conv2d(ninput, noutput - ninput, (3, 3), stride=2, padding=1, bias=True)
        self.pool = nn.MaxPool2d(2, stride=2)
        self.bn = nn.BatchNorm2d(noutput, eps=1e-3)
        self.instance_norm = nn.InstanceNorm2d(noutput, affine=True)  # present in the checkpoint, unused in forward

    def forward(self, x):
        out = torch.cat([self.conv(x), self.pool(x)], 1)
        return F.relu(self.bn(out))


class NonBottleneck1d(nn.Module):
    def __init__(self, chann: int, dropprob: float, dilated: int):
        super().__init__()
        self.conv3x1_1 = nn.Conv2d(chann, chann, (3, 1), stride=1, padding=(1, 0), bias=True)
        self.conv1x3_1 = nn.Conv2d(chann, chann, (1, 3), stride=1, padding=(0, 1), bias=True)
        self.bn1 = nn.BatchNorm2d(chann, eps=1e-03)
        self.conv3x1_2 = nn.Conv2d(chann, chann, (3, 1), stride=1, padding=(dilated, 0), bias=True, dilation=(dilated, 1))
        self.conv1x3_2 = nn.Conv2d(chann, chann, (1, 3), stride=1, padding=(0, dilated), bias=True, dilation=(1, dilated))
        self.bn2 = nn.BatchNorm2d(chann, eps=1e-03)
        self.instance_norm = nn.InstanceNorm2d(chann, affine=True)  # in the checkpoint, unused in forward
        self.dropout = nn.Dropout2d(dropprob)

    def forward(self, x):
        out = F.relu(self.conv3x1_1(x))
        out = F.relu(self.bn1(self.conv1x3_1(out)))
        out = F.relu(self.conv3x1_2(out))
        out = self.bn2(self.conv1x3_2(out))
        if self.dropout.p != 0:
            out = self.dropout(out)
        return F.relu(out + x)


class UpsamplerBlock(nn.Module):
    def __init__(self, ninput: int, noutput: int):
        super().__init__()
        self.conv = nn.ConvTranspose2d(ninput, noutput, 3, stride=2, padding=1, output_padding=1, bias=True)
        self.bn = nn.BatchNorm2d(noutput, eps=1e-3)

    def forward(self, x):
        return F.relu(self.bn(self.conv(x)))


class SegmentationHead(nn.Module):
    def __init__(self, num_classes: int):
        super().__init__()
        self.num_classes = num_classes
        self.output_conv = nn.ConvTranspose2d(16, num_classes, 2, stride=2, padding=0, output_padding=0, bias=True)

    def forward(self, x):
        return self.output_conv(x)


class ERFNetModel(nn.Module):
    def __init__(self, num_classes: int = 3):
        super().__init__()
        self.num_classes = num_classes
        self.downsampler_block_01 = DownsamplerBlock(3, 16)
        self.downsampler_block_02 = DownsamplerBlock(16, 64)
        for k in range(1, 6):
            setattr(self, f"enc_non_bottleneck_1d_{k:02d}", NonBottleneck1d(64, 0.03, 1))
        self.downsampler_block_03 = DownsamplerBlock(64, 128)
        for k, d in zip(range(6, 14), (2, 4, 8, 16, 2, 4, 8, 16)):
            setattr(self, f"enc_non_bottleneck_1d_{k:02d}", NonBottleneck1d(128, 0.3, d))
        self.upsampler_block_01 = UpsamplerBlock(128, 64)
        self.dec_non_bottleneck_1d_01 = NonBottleneck1d(64, 0, 1)
        self.dec_non_bottleneck_1d_02 = NonBottleneck1d(64, 0, 1)
        self.upsampler_block_02 = UpsamplerBlock(64, 16)
        self.dec_non_bottleneck_1d_03 = NonBottleneck1d(16, 0, 1)
        self.dec_non_bottleneck_1d_04 = NonBottleneck1d(16, 0, 1)
        self.segmentation_head = SegmentationHead(num_classes)

    def forward(self, x):
        x = self.downsampler_block_01(x)
        x = self.downsampler_block_02(x)
        for k in range(1, 6):
            x = getattr(self, f"enc_non_bottleneck_1d_{k:02d}")(x)
        x = self.downsampler_block_03(x)
        for k in range(6, 14):
            x = getattr(self, f"enc_non_bottleneck_1d_{k:02d}")(x)
        x = self.upsampler_block_01(x)
        x = self.dec_non_bottleneck_1d_01(x)
        x = self.dec_non_bottleneck_1d_02(x)
        x = self.upsampler_block_02(x)
        x = self.dec_non_bottleneck_1d_03(x)
        x = self.dec_non_bottleneck_1d_04(x)
        return self.segmentation_head(x)


def inspect_checkpoint(path: Path) -> dict:
    """Keys, prefixes, epoch and hyper-parameters, without building the model."""
    ck = torch.load(path, map_location="cpu", weights_only=False)
    sd = ck.get("state_dict", ck)
    prefixes = sorted({k.split(".")[0] for k in sd})
    return {
        "top_level_keys": sorted(ck.keys()) if isinstance(ck, dict) else [],
        "n_tensors": len(sd),
        "key_prefixes": prefixes,
        "epoch": ck.get("epoch"),
        "global_step": ck.get("global_step"),
        "pytorch_lightning_version": ck.get("pytorch-lightning_version"),
        "hyper_parameters": {k: str(v)[:200] for k, v in ck.get("hyper_parameters", {}).items()} if isinstance(ck.get("hyper_parameters"), dict) else str(ck.get("hyper_parameters"))[:500],
        "sample_keys": list(sd)[:5],
        "head_shape": [list(v.shape) for k, v in sd.items() if k.endswith("segmentation_head.output_conv.weight")],
    }


def load_model(path: Path, prefix: str = "network.") -> ERFNetModel:
    """Load the Lightning checkpoint into the bare model; strict, so a mismatch is an error, not a silent skip."""
    ck = torch.load(path, map_location="cpu", weights_only=False)
    sd = ck["state_dict"] if "state_dict" in ck else ck
    stripped = {}
    for k, v in sd.items():
        if k.startswith(prefix):
            stripped[k[len(prefix):]] = v
        elif "." in k and not k.startswith(("criterion", "metric")):
            stripped[k] = v
    model = ERFNetModel(num_classes=3)
    missing, unexpected = model.load_state_dict(stripped, strict=False)
    if missing or unexpected:
        raise RuntimeError(f"checkpoint does not match the model: missing {missing[:5]}..., unexpected {unexpected[:5]}...")
    model.eval()
    return model


def preprocess(rgb: np.ndarray) -> torch.Tensor:
    """ToTensor then per-channel z-score, as the baseline's SingleImageNormalizer."""
    x = torch.from_numpy(np.array(rgb, dtype=np.uint8, copy=True)).permute(2, 0, 1).float() / 255.0
    out = torch.empty_like(x)
    for c in range(3):
        ch = x[c]
        out[c] = (ch - ch.mean()) / (ch.std() + 1e-17)
    return out.unsqueeze(0)


@torch.no_grad()
def predict_semantics(model: ERFNetModel, rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, dict]:
    """Return (argmax class map uint8, softmax weed probability float32, timings_ms)."""
    t: dict[str, float] = {}
    t0 = time.perf_counter()
    x = preprocess(rgb)
    t["preprocess"] = (time.perf_counter() - t0) * 1000.0
    t1 = time.perf_counter()
    logits = model(x)
    t["forward"] = (time.perf_counter() - t1) * 1000.0
    t2 = time.perf_counter()
    prob = torch.softmax(logits, dim=1)[0]
    cls = torch.argmax(logits, dim=1)[0].to(torch.uint8).numpy()
    weed_p = prob[WEED].numpy().astype(np.float32)
    t["postprocess"] = (time.perf_counter() - t2) * 1000.0
    return cls, weed_p, t


def detect_erfnet(model: ERFNetModel, rgb: np.ndarray, variant: str = "erfnet_weed") -> tuple[DetectionResult, np.ndarray]:
    """Components of the weed class (erfnet_weed) or of crop-or-weed (erfnet_veg). Returns (result, class map)."""
    t0 = time.perf_counter()
    cls, weed_p, t = predict_semantics(model, rgb)
    if variant == "erfnet_weed":
        mask = cls == WEED
    elif variant == "erfnet_veg":
        mask = cls != BACKGROUND
    else:
        raise ValueError(variant)
    t2 = time.perf_counter()
    labels, n = ndimage.label(mask, structure=STRUCT8)
    labels = labels.astype(np.int32)
    t["components"] = (time.perf_counter() - t2) * 1000.0
    t3 = time.perf_counter()
    records = []
    if n:
        objects = ndimage.find_objects(labels, max_label=n)
        areas = np.bincount(labels.ravel(), minlength=n + 1)
        sums = ndimage.sum_labels(weed_p, labels, index=np.arange(1, n + 1))
        cy, cx = zip(*ndimage.center_of_mass(mask, labels, index=np.arange(1, n + 1)))
        for k in range(1, n + 1):
            ys, xs = objects[k - 1]
            records.append({
                "det_id": k, "area_px": int(areas[k]),
                "bbox_x0": int(xs.start), "bbox_y0": int(ys.start), "bbox_x1": int(xs.stop), "bbox_y1": int(ys.stop),
                "centroid_x": float(cx[k - 1]), "centroid_y": float(cy[k - 1]),
                "score": float(sums[k - 1] / areas[k]),  # mean weed probability inside the component
            })
    t["measure"] = (time.perf_counter() - t3) * 1000.0
    t["total"] = (time.perf_counter() - t0) * 1000.0
    res = DetectionResult(method=variant, closing=False, labels=labels, n=int(n), records=records,
                          timings_ms={k: round(v, 3) for k, v in t.items()}, threshold=None,
                          vegetation_fraction=float((cls != BACKGROUND).mean()))
    return res, cls
