"""From a checkpoint to a file the browser can run, with its papers attached.

The ONNX graph takes ``N x 3 x 96 x 96`` floats in [0, 1] and returns
calibrated logits; normalisation and temperature are inside it. The sidecar
JSON states the version, the classes, the input contract, the chip span rule
and the scorecard summary, so the app can show an operator what is behind a
number and refuse a model whose contract it does not understand.

Every export is checked against PyTorch on random input before it is written,
and the quantised copy against the float one, because a silently wrong export
is a model that lies with a straight face.
"""

from __future__ import annotations

import json
import shutil
import time
from pathlib import Path

import numpy as np
import torch

from offrow.learn.examples import MAX_SPAN_M, MIN_SPAN_M, SPAN_PER_DIAMETER
from offrow.learn.model import CLASSES, INPUT_PX, WeedNet

MANIFEST_NAME = "manifest.json"


def export_onnx(model: WeedNet, path: Path, opset: int = 17) -> Path:
    model = model.cpu().eval()
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.rand(2, 3, INPUT_PX, INPUT_PX)
    # The torch.export-based exporter (the default since PyTorch 2.9). The batch
    # dimension is declared dynamic so the browser can send one chip or a hundred.
    batch = torch.export.Dim("batch", min=1, max=4096)
    torch.onnx.export(
        model,
        (dummy,),
        str(path),
        input_names=["chips"],
        output_names=["logits"],
        dynamic_shapes={"x": {0: batch}},
        opset_version=opset,
        dynamo=True,
        external_data=False,
    )
    _verify(model, path)
    return path


def quantize(path: Path, out: Path) -> Path:
    """Dynamic int8 quantisation of the weights: a quarter of the download, same contract."""
    import onnx
    from onnxruntime.quantization import QuantType, quantize_dynamic

    out = Path(out)
    # The torch.export exporter leaves per-tensor shape annotations that the
    # quantiser's shape inference then contradicts. Drop them and re-infer.
    graph = onnx.load(str(path))
    del graph.graph.value_info[:]
    graph = onnx.shape_inference.infer_shapes(graph)
    clean = out.with_suffix(".clean.onnx")
    onnx.save(graph, str(clean))
    try:
        quantize_dynamic(str(clean), str(out), weight_type=QuantType.QInt8)
    finally:
        clean.unlink(missing_ok=True)
    return out


def _verify(model: WeedNet, path: Path, batch: int = 4, tolerance: float = 1e-3) -> None:
    import onnxruntime as ort

    x = torch.rand(batch, 3, INPUT_PX, INPUT_PX)
    with torch.no_grad():
        expected = model(x).numpy()
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    got = session.run(["logits"], {"chips": x.numpy()})[0]
    if not np.allclose(expected, got, atol=tolerance):
        raise RuntimeError(
            f"ONNX export disagrees with PyTorch by up to {np.abs(expected - got).max():.4f}"
        )


def agreement(float_path: Path, quant_path: Path, batch: int = 32, seed: int = 0) -> float:
    """Fraction of random inputs on which the quantised model picks the same class."""
    import onnxruntime as ort

    rng = np.random.default_rng(seed)
    x = rng.random((batch, 3, INPUT_PX, INPUT_PX), dtype=np.float32)
    a = ort.InferenceSession(str(float_path), providers=["CPUExecutionProvider"]).run(
        ["logits"], {"chips": x}
    )[0]
    b = ort.InferenceSession(str(quant_path), providers=["CPUExecutionProvider"]).run(
        ["logits"], {"chips": x}
    )[0]
    return float((a.argmax(-1) == b.argmax(-1)).mean())


def sidecar(
    version: str, state: dict, card: dict | None, quantized: bool, file_name: str, size_bytes: int
) -> dict:
    overall = (card or {}).get("overall", {})
    weed = overall.get("per_class", {}).get("weed", {})
    return {
        "version": version,
        "file": file_name,
        "bytes": size_bytes,
        "quantized": quantized,
        "classes": list(CLASSES),
        "input": {
            "layout": "NCHW",
            "px": INPUT_PX,
            "range": "0..1 (divide RGB by 255; ImageNet normalisation is inside the graph)",
            "span_rule": {
                "per_diameter": SPAN_PER_DIAMETER,
                "min_m": MIN_SPAN_M,
                "max_m": MAX_SPAN_M,
            },
        },
        "output": "calibrated logits; softmax gives probabilities",
        "temperature": state.get("temperature"),
        "trained_at": state.get("trained_at"),
        "sources": state.get("sources", []),
        "scorecard": {
            "test_examples": overall.get("n"),
            "weed_recall": weed.get("recall"),
            "weed_precision": weed.get("precision"),
            "weed_auroc": overall.get("weed_auroc"),
            "ece": overall.get("ece"),
            "by_source": {
                s: {
                    "n": v.get("n"),
                    "weed_recall": v.get("per_class", {}).get("weed", {}).get("recall"),
                }
                for s, v in (card or {}).get("by_source", {}).items()
            },
            "weed_recall_by_diameter": (card or {}).get("weed_recall_by_diameter", {}),
        },
        "caveat": (
            "A bootstrap trained on public corn imagery flown at 10 m, synthetic scenes "
            "and the operators' "
            "own verdicts. Its number is a suggestion with a probability; the operator decides."
        ),
        "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def publish(
    checkpoint: Path,
    version: str,
    app_models_dir: Path,
    card: dict | None,
    quantize_weights: bool = True,
) -> dict:
    """Export, verify, quantise, write the sidecar and the app's model manifest."""
    from offrow.learn.train import load_model

    model, state = load_model(Path(checkpoint), torch.device("cpu"))
    app_models_dir = Path(app_models_dir)
    app_models_dir.mkdir(parents=True, exist_ok=True)
    float_path = app_models_dir / f"{version}.fp32.onnx"
    export_onnx(model, float_path)
    shipped = float_path
    quantized = False
    if quantize_weights:
        q = app_models_dir / f"{version}.onnx"
        quantize(float_path, q)
        agree = agreement(float_path, q)
        if agree < 0.95:
            raise RuntimeError(
                f"quantised model agrees with the float one on only {agree:.0%} of inputs"
            )
        shipped, quantized = q, True
        float_path.unlink()
    else:
        shipped = float_path.rename(app_models_dir / f"{version}.onnx")
    meta = sidecar(version, state, card, quantized, shipped.name, shipped.stat().st_size)
    (app_models_dir / f"{version}.json").write_text(json.dumps(meta, indent=1))
    manifest = {"current": version, "models": {version: meta}}
    manifest_path = app_models_dir / MANIFEST_NAME
    if manifest_path.exists():
        try:
            old = json.loads(manifest_path.read_text())
            manifest["models"] = {**old.get("models", {}), version: meta}
        except json.JSONDecodeError:
            pass
    manifest_path.write_text(json.dumps(manifest, indent=1))
    return meta


def remove_version(app_models_dir: Path, version: str) -> None:
    app_models_dir = Path(app_models_dir)
    for suffix in (".onnx", ".json", ".fp32.onnx"):
        p = app_models_dir / f"{version}{suffix}"
        if p.exists():
            p.unlink()
    manifest_path = app_models_dir / MANIFEST_NAME
    if manifest_path.exists():
        m = json.loads(manifest_path.read_text())
        m.get("models", {}).pop(version, None)
        if m.get("current") == version:
            m["current"] = next(iter(m["models"]), None)
        manifest_path.write_text(json.dumps(m, indent=1))


def copy_scorecard(card_path: Path, app_models_dir: Path) -> Path:
    target = Path(app_models_dir) / f"{Path(card_path).stem}.scorecard.json"
    shutil.copyfile(card_path, target)
    return target
