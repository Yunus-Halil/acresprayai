"""``offrow learn``: build the examples, train, score, publish.

The order is the order of the pipeline, and each step refuses without the one
before it. ``publish`` runs the gate; it does not ship a version that scores
worse than the last on the frozen test split unless told to with ``--force``,
and it says why either way.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import typer

app = typer.Typer(
    no_args_is_help=True, help="The learning track: examples, training, scorecards, export."
)

DEFAULT_DATA = Path("data")
DEFAULT_EXAMPLES = Path("data/examples")
DEFAULT_MODELS = Path("data/models")
DEFAULT_REPORTS = Path("reports")
DEFAULT_APP_MODELS = Path("../public/models")


@app.command("build-examples")
def build_examples(
    source: str = typer.Option(..., "--source", help="usu | synth | operator"),
    root: Path = typer.Option(DEFAULT_DATA, "--root", help="Dataset cache (for usu)."),
    examples: Path = typer.Option(DEFAULT_EXAMPLES, "--examples", help="Where manifests live."),
    seeds: int = typer.Option(24, "--seeds", help="Synthetic scenes to render."),
    limit_frames: int = typer.Option(0, "--limit-frames", help="For a quick USU build; 0 is all."),
    negatives_per_frame: int = typer.Option(
        10, "--negatives-per-frame", help="Clear-ground chips sampled per USU frame."
    ),
    export_dir: Path = typer.Option(
        None, "--export-dir", help="Operator export from pull-verdicts."
    ),
) -> None:
    """Cut labelled chips from one source into its own manifest."""
    from offrow.learn import sources

    if source == "usu":
        m = sources.build_usu(
            root,
            examples / "usu-corn-weeddb",
            negatives_per_frame=negatives_per_frame,
            limit_frames=limit_frames or None,
        )
    elif source == "synth":
        m = sources.build_synth(examples / "synth", seeds=range(seeds))
    elif source == "operator":
        m = sources.build_operator(export_dir or (examples / "operator"), examples / "operator")
    else:
        raise typer.BadParameter("source must be usu, synth or operator")
    typer.echo(json.dumps(m.summary(), indent=1))
    typer.secho(f"wrote {m.path}", bold=True)


@app.command("pull-verdicts")
def pull_verdicts_cmd(
    examples: Path = typer.Option(DEFAULT_EXAMPLES, "--examples"),
    url: str = typer.Option(None, "--url", envvar="SUPABASE_URL"),
    key: str = typer.Option(None, "--service-key", envvar="SUPABASE_SERVICE_ROLE_KEY"),
) -> None:
    """Export every operator verdict with a chip. Needs the service role key in the environment."""
    from offrow.learn import sources

    if not url or not key:
        raise typer.BadParameter(
            "set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --url and --service-key"
        )
    out = sources.pull_verdicts(url, key, examples / "operator")
    rows = json.loads(Path(out).read_text())
    typer.echo(f"{len(rows)} observations with a verdict and a chip written to {out}")
    typer.echo("next: offrow learn build-examples --source operator")


@app.command()
def summary(examples: Path = typer.Option(DEFAULT_EXAMPLES, "--examples")) -> None:
    """Counts by source, label, split and weed size, before anything is trained."""
    from offrow.learn.examples import combined_summary, read_all

    manifests = read_all(examples)
    if not manifests:
        typer.secho(f"no manifests under {examples}", fg=typer.colors.RED)
        raise typer.Exit(1)
    typer.echo(json.dumps(combined_summary(manifests), indent=1))


@app.command()
def train(
    version: str = typer.Option("weed-v1", "--version"),
    examples: Path = typer.Option(DEFAULT_EXAMPLES, "--examples"),
    models: Path = typer.Option(DEFAULT_MODELS, "--models"),
    epochs: int = typer.Option(12, "--epochs"),
    batch_size: int = typer.Option(64, "--batch-size"),
    learning_rate: float = typer.Option(3e-4, "--lr"),
    no_pretrained: bool = typer.Option(
        False, "--no-pretrained", help="Random init; for tests without network."
    ),
) -> None:
    """Train on the train split, pick the best epoch on val, calibrate, save a checkpoint."""
    from offrow.learn import train as train_mod

    config = train_mod.TrainConfig(
        version=version,
        epochs=epochs,
        batch_size=batch_size,
        learning_rate=learning_rate,
        pretrained=not no_pretrained,
    )
    result = train_mod.train(examples, models, config)
    typer.echo(
        json.dumps(
            {
                k: (str(v) if isinstance(v, Path) else v)
                for k, v in result.__dict__.items()
                if k != "history"
            },
            indent=1,
        )
    )
    typer.secho(f"checkpoint {result.checkpoint}", bold=True)


@app.command()
def evaluate(
    version: str = typer.Option("weed-v1", "--version"),
    examples: Path = typer.Option(DEFAULT_EXAMPLES, "--examples"),
    models: Path = typer.Option(DEFAULT_MODELS, "--models"),
    reports: Path = typer.Option(DEFAULT_REPORTS, "--reports"),
    split: str = typer.Option("test", "--split"),
) -> None:
    """Score a checkpoint on the frozen test split and write reports/<version>.json."""
    from offrow.learn import evaluate as eval_mod
    from offrow.learn.train import load_model

    model, _ = load_model(models / f"{version}.pt")
    card = eval_mod.scorecard(model, examples, version, split=split)
    path = eval_mod.write_scorecard(card, reports)
    o = card["overall"]
    weed = o.get("per_class", {}).get("weed", {})
    typer.echo(
        f"test examples {o.get('n')}  accuracy {o.get('accuracy')}  "
        f"weed recall {weed.get('recall')}  "
        f"weed precision {weed.get('precision')}  AUROC {o.get('weed_auroc')}  ECE {o.get('ece')}"
    )
    for s, v in card["by_source"].items():
        w = v.get("per_class", {}).get("weed", {})
        typer.echo(
            f"  {s}: n {v.get('n')}  weed recall {w.get('recall')}  precision {w.get('precision')}"
        )
    for b, v in card["weed_recall_by_diameter"].items():
        typer.echo(f"  weeds {b}: n {v['n']}  recall {v['recall']:.3f}")
    previous = eval_mod.latest_scorecard(reports, exclude_version=version)
    g = eval_mod.gate(previous, card)
    typer.secho(
        f"gate: {'PASS' if g.passed else 'FAIL'}  " + "; ".join(g.reasons),
        fg=typer.colors.GREEN if g.passed else typer.colors.RED,
        bold=True,
    )
    typer.secho(f"wrote {path}", bold=True)


@app.command()
def publish(
    version: str = typer.Option("weed-v1", "--version"),
    models: Path = typer.Option(DEFAULT_MODELS, "--models"),
    reports: Path = typer.Option(DEFAULT_REPORTS, "--reports"),
    app_models: Path = typer.Option(
        DEFAULT_APP_MODELS, "--app-models", help="The app's public/models directory."
    ),
    force: bool = typer.Option(False, "--force", help="Ship even if the gate fails."),
    no_quantize: bool = typer.Option(False, "--no-quantize"),
) -> None:
    """Export to ONNX for the browser, if the scorecard passes the gate."""
    from offrow.learn import evaluate as eval_mod
    from offrow.learn import export as export_mod

    card_path = reports / f"{version}.json"
    if not card_path.exists():
        typer.secho(
            f"no scorecard at {card_path}; run: offrow learn evaluate --version {version}",
            fg=typer.colors.RED,
        )
        raise typer.Exit(1)
    card = json.loads(card_path.read_text())
    previous = eval_mod.latest_scorecard(reports, exclude_version=version)
    g = eval_mod.gate(previous, card)
    typer.secho(
        f"gate: {'PASS' if g.passed else 'FAIL'}  " + "; ".join(g.reasons),
        fg=typer.colors.GREEN if g.passed else typer.colors.RED,
        bold=True,
    )
    if not g.passed and not force:
        raise typer.Exit(2)
    meta = export_mod.publish(
        models / f"{version}.pt", version, app_models, card, quantize_weights=not no_quantize
    )
    export_mod.copy_scorecard(card_path, app_models)
    typer.echo(f"{meta['file']}: {meta['bytes'] / 1e6:.2f} MB, quantized={meta['quantized']}")
    typer.secho(f"published {version} to {app_models}", bold=True)


@app.command()
def env() -> None:
    """Which device training will use, and whether the ML extras are installed."""
    try:
        import onnxruntime
        import torch
        import torchvision
    except ImportError as e:  # pragma: no cover
        typer.secho(f"missing: {e}. Install with: pip install -e '.[learn]'", fg=typer.colors.RED)
        raise typer.Exit(1) from e
    from offrow.learn.model import device

    typer.echo(
        f"torch {torch.__version__}, torchvision {torchvision.__version__}, "
        f"onnxruntime {onnxruntime.__version__}"
    )
    typer.echo(f"device: {device()}")
    typer.echo(
        f"SUPABASE_URL set: {bool(os.environ.get('SUPABASE_URL'))}; "
        f"service key set: {bool(os.environ.get('SUPABASE_SERVICE_ROLE_KEY'))}"
    )
