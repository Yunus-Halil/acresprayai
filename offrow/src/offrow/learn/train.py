"""Training, with the augmentations that stand in for the flights we have not flown.

The public data was flown at 10 m, the operators fly at 100. The model has to
survive that gap on day one, so every training chip is randomly degraded to a
coarser ground sample distance (downsampled and brought back) before it is
seen. That is not a substitute for flown imagery at the real altitude; it is
what stops the model from learning a resolution nobody will give it.

Class imbalance is handled with loss weights rather than by throwing examples
away, calibration with temperature scaling on the validation split, and the
checkpoint that ships is the one with the best validation macro-F1, not the
last one.
"""

from __future__ import annotations

import json
import math
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset

from offrow.learn.examples import LABELS, Example, Manifest, load_chip, read_all
from offrow.learn.model import INPUT_PX, WeedNet, chip_to_tensor, device

LABEL_INDEX = {label: i for i, label in enumerate(LABELS)}


@dataclass
class TrainConfig:
    version: str = "weed-v1"
    epochs: int = 12
    batch_size: int = 64
    learning_rate: float = 3e-4
    weight_decay: float = 1e-4
    #: Probability a training chip is degraded to a coarser GSD.
    degrade_probability: float = 0.7
    #: Largest downsampling factor for the degradation (4 turns 5.5 mm into 22 mm).
    degrade_max_factor: float = 4.0
    #: Random rescale of the crop around the object, so framing is not a cue.
    scale_jitter: float = 0.15
    seed: int = 0
    num_workers: int = 0
    pretrained: bool = True
    #: Stop early after this many epochs without a better validation score.
    patience: int = 4


class ChipDataset(Dataset):
    """Chips from one or more manifests, resized to the model input on the fly."""

    def __init__(
        self, manifests: list[Manifest], split: str, augment: bool, config: TrainConfig
    ) -> None:
        self.items: list[tuple[Manifest, Example]] = [
            (m, e) for m in manifests for e in m.examples if e.split == split
        ]
        self.augment = augment
        self.config = config
        self.rng = np.random.default_rng(config.seed)

    def __len__(self) -> int:
        return len(self.items)

    def labels(self) -> np.ndarray:
        return np.array([LABEL_INDEX[e.label] for _, e in self.items], dtype=np.int64)

    def __getitem__(self, index: int):
        manifest, example = self.items[index]
        chip = load_chip(manifest.chip_path(example))
        if self.augment:
            chip = self._augment(chip)
        return chip_to_tensor(chip), LABEL_INDEX[example.label], index

    def _augment(self, chip: np.ndarray) -> np.ndarray:
        rng = self.rng
        h, w = chip.shape[:2]
        # Framing jitter: a slightly tighter or looser crop around the centre.
        s = 1.0 + rng.uniform(-self.config.scale_jitter, self.config.scale_jitter)
        side = int(max(4, min(h, w) * min(1.0, s)))
        y0, x0 = (h - side) // 2, (w - side) // 2
        chip = chip[y0 : y0 + side, x0 : x0 + side]
        # Orientation is not a feature of a weed.
        k = int(rng.integers(0, 4))
        chip = np.rot90(chip, k)
        if rng.random() < 0.5:
            chip = chip[:, ::-1]
        # Exposure and white balance move between flights; hue barely does.
        gain = rng.uniform(0.85, 1.15, size=(1, 1, 3)) * rng.uniform(0.85, 1.15)
        chip = np.clip(chip.astype(np.float32) * gain, 0, 255)
        # The altitude gap, as a resolution loss.
        if rng.random() < self.config.degrade_probability:
            factor = rng.uniform(1.0, self.config.degrade_max_factor)
            small = max(4, int(round(side / factor)))
            t = torch.from_numpy(np.ascontiguousarray(chip)).permute(2, 0, 1).unsqueeze(0)
            t = torch.nn.functional.interpolate(t, size=(small, small), mode="area")
            t = torch.nn.functional.interpolate(
                t, size=(side, side), mode="bilinear", align_corners=False
            )
            chip = t.squeeze(0).permute(1, 2, 0).numpy()
        return np.ascontiguousarray(chip).astype(np.uint8)


def class_weights(labels: np.ndarray) -> torch.Tensor:
    """Inverse-square-root frequency: rare classes count more, not absurdly more."""
    counts = np.bincount(labels, minlength=len(LABELS)).astype(np.float64)
    counts[counts == 0] = 1.0
    weights = 1.0 / np.sqrt(counts)
    weights = weights / weights.mean()
    return torch.tensor(weights, dtype=torch.float32)


def macro_f1(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    f1s = []
    for c in range(len(LABELS)):
        tp = int(np.sum((y_true == c) & (y_pred == c)))
        fp = int(np.sum((y_true != c) & (y_pred == c)))
        fn = int(np.sum((y_true == c) & (y_pred != c)))
        denom = 2 * tp + fp + fn
        f1s.append(2 * tp / denom if denom else 0.0)
    return float(np.mean(f1s))


@torch.no_grad()
def predict_logits(
    model: WeedNet, loader: DataLoader, dev: torch.device
) -> tuple[np.ndarray, np.ndarray]:
    model.eval()
    logits, labels = [], []
    for x, y, _ in loader:
        logits.append(model(x.to(dev)).float().cpu().numpy())
        labels.append(y.numpy())
    if not logits:
        return np.zeros((0, len(LABELS))), np.zeros((0,), dtype=np.int64)
    return np.concatenate(logits), np.concatenate(labels)


def fit_temperature(logits: np.ndarray, labels: np.ndarray) -> float:
    """Temperature scaling: one scalar that minimises validation NLL."""
    if len(labels) == 0:
        return 1.0
    z = torch.tensor(logits, dtype=torch.float32)
    y = torch.tensor(labels, dtype=torch.long)
    log_t = torch.zeros(1, requires_grad=True)
    opt = torch.optim.LBFGS([log_t], lr=0.1, max_iter=100)

    def closure():
        opt.zero_grad()
        loss = nn.functional.cross_entropy(z / log_t.exp(), y)
        loss.backward()
        return loss

    opt.step(closure)
    t = float(log_t.exp().item())
    return float(min(10.0, max(0.1, t)))


@dataclass
class TrainResult:
    version: str
    checkpoint: Path
    best_epoch: int
    best_val_macro_f1: float
    temperature: float
    epochs_run: int
    train_examples: int
    val_examples: int
    seconds: float
    history: list[dict]


def train(examples_dir: Path, out_dir: Path, config: TrainConfig | None = None) -> TrainResult:
    config = config or TrainConfig()
    torch.manual_seed(config.seed)
    manifests = read_all(Path(examples_dir))
    if not manifests:
        raise FileNotFoundError(f"no manifests under {examples_dir}; build examples first")
    train_set = ChipDataset(manifests, "train", augment=True, config=config)
    val_set = ChipDataset(manifests, "val", augment=False, config=config)
    if len(train_set) == 0:
        raise ValueError("the train split is empty")
    dev = device()
    model = WeedNet(pretrained=config.pretrained).to(dev)
    weights = class_weights(train_set.labels()).to(dev)
    criterion = nn.CrossEntropyLoss(weight=weights)
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=config.learning_rate, weight_decay=config.weight_decay
    )
    steps = max(1, math.ceil(len(train_set) / config.batch_size)) * config.epochs
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer, max_lr=config.learning_rate, total_steps=steps
    )
    train_loader = DataLoader(
        train_set,
        batch_size=config.batch_size,
        shuffle=True,
        num_workers=config.num_workers,
        drop_last=False,
    )
    val_loader = DataLoader(
        val_set, batch_size=config.batch_size, shuffle=False, num_workers=config.num_workers
    )

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    checkpoint = out_dir / f"{config.version}.pt"
    best_f1, best_epoch, since_best = -1.0, -1, 0
    history: list[dict] = []
    started = time.time()
    for epoch in range(config.epochs):
        model.train()
        total, n = 0.0, 0
        for x, y, _ in train_loader:
            x, y = x.to(dev), y.to(dev)
            optimizer.zero_grad()
            loss = criterion(model(x), y)
            loss.backward()
            optimizer.step()
            scheduler.step()
            total += float(loss.item()) * len(y)
            n += len(y)
        logits, labels = predict_logits(model, val_loader, dev)
        f1 = macro_f1(labels, logits.argmax(-1)) if len(labels) else float("nan")
        history.append({"epoch": epoch, "train_loss": total / max(1, n), "val_macro_f1": f1})
        improved = len(labels) == 0 or f1 > best_f1
        if improved:
            best_f1, best_epoch, since_best = (f1 if len(labels) else 0.0), epoch, 0
            torch.save({"state_dict": model.state_dict(), "config": asdict(config)}, checkpoint)
        else:
            since_best += 1
            if since_best >= config.patience:
                break
    # Calibrate the best checkpoint on the validation split, then save it with the
    # temperature inside.
    state = torch.load(checkpoint, map_location=dev)
    model.load_state_dict(state["state_dict"])
    logits, labels = predict_logits(model, val_loader, dev)
    temperature = fit_temperature(logits, labels)
    model.temperature.fill_(temperature)
    torch.save(
        {
            "state_dict": model.state_dict(),
            "config": asdict(config),
            "classes": list(LABELS),
            "input_px": INPUT_PX,
            "temperature": temperature,
            "best_epoch": best_epoch,
            "best_val_macro_f1": best_f1,
            "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "sources": [str(m.directory) for m in manifests],
        },
        checkpoint,
    )
    result = TrainResult(
        version=config.version,
        checkpoint=checkpoint,
        best_epoch=best_epoch,
        best_val_macro_f1=best_f1,
        temperature=temperature,
        epochs_run=len(history),
        train_examples=len(train_set),
        val_examples=len(val_set),
        seconds=time.time() - started,
        history=history,
    )
    (out_dir / f"{config.version}.train.json").write_text(
        json.dumps({**asdict(result), "checkpoint": str(checkpoint)}, indent=1)
    )
    return result


def load_model(checkpoint: Path, dev: torch.device | None = None) -> tuple[WeedNet, dict]:
    dev = dev or device()
    state = torch.load(Path(checkpoint), map_location=dev)
    model = WeedNet(pretrained=False)
    model.load_state_dict(state["state_dict"])
    model.to(dev).eval()
    return model, state
