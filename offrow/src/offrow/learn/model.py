"""The classifier, and the one input contract the browser and the trainer share.

A small pretrained backbone (MobileNetV3-small) with a three-way head. Small on
purpose: it has to run in a browser on a hundred chips without anyone noticing,
and the chips are 96 pixels across, which is what a plant looks like from a
mapping flight anyway.

**The input contract** is the whole reason this file exists apart from
``train.py``: an RGB chip, square, ``INPUT_PX`` across, values in [0, 1], cut
at :func:`~offrow.learn.examples.object_span_m` around the object. ImageNet
normalisation is folded into the graph so the browser does exactly one thing:
resize and divide by 255. Temperature scaling is folded in too, so the exported
logits are already calibrated and softmax in the browser gives a probability
that means what it says.
"""

from __future__ import annotations

import numpy as np
import torch
from torch import nn

from offrow.learn.examples import LABELS

INPUT_PX = 96
CLASSES = tuple(LABELS)
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


class WeedNet(nn.Module):
    """MobileNetV3-small with a 3-class head, normalisation and temperature inside."""

    def __init__(self, pretrained: bool = True) -> None:
        super().__init__()
        from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small

        weights = MobileNet_V3_Small_Weights.IMAGENET1K_V1 if pretrained else None
        self.backbone = mobilenet_v3_small(weights=weights)
        in_features = self.backbone.classifier[-1].in_features
        self.backbone.classifier[-1] = nn.Linear(in_features, len(CLASSES))
        self.register_buffer("mean", torch.tensor(IMAGENET_MEAN).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor(IMAGENET_STD).view(1, 3, 1, 1))
        #: Set by temperature scaling after training. 1.0 means uncalibrated.
        self.register_buffer("temperature", torch.ones(1))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """``x``: N x 3 x H x W in [0, 1]. Returns calibrated logits."""
        x = (x - self.mean) / self.std
        return self.backbone(x) / self.temperature


def chip_to_tensor(chip: np.ndarray, input_px: int = INPUT_PX) -> torch.Tensor:
    """HxWx3 uint8 chip to 3 x input_px x input_px float in [0, 1], antialiased."""
    t = torch.from_numpy(np.ascontiguousarray(chip[:, :, :3])).permute(2, 0, 1).float() / 255.0
    if t.shape[1] != input_px or t.shape[2] != input_px:
        t = torch.nn.functional.interpolate(
            t.unsqueeze(0),
            size=(input_px, input_px),
            mode="bilinear",
            antialias=True,
            align_corners=False,
        ).squeeze(0)
    return t.clamp_(0.0, 1.0)


def device() -> torch.device:
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def probabilities(logits: torch.Tensor) -> torch.Tensor:
    return torch.softmax(logits, dim=-1)
