"""Where the dataset and the outputs live on this machine.

Resolution order for the dataset root: an explicit argument, the environment
variable WEEDLAB_PHENOBENCH_ROOT, then configs/local.json. Whatever is found is
then searched for the real root (the folder that holds train/images), so the
folder the archive was extracted into works as well as the nested PhenoBench
folder inside it. Nothing is hardcoded to one machine.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

ENV_ROOT = "WEEDLAB_PHENOBENCH_ROOT"
ENV_OUTPUT = "WEEDLAB_OUTPUT_DIR"

LAB_DIR = Path(__file__).resolve().parents[2]
CONFIG_DIR = LAB_DIR / "configs"
LOCAL_CONFIG = CONFIG_DIR / "local.json"
DEFAULT_OUTPUT_DIR = LAB_DIR / "outputs"

SETUP_HINT = (
    "PhenoBench was not found. Extract PhenoBench-v110.zip somewhere outside the "
    "repository and point the lab at it with one of:\n"
    "  * the --root argument of the script\n"
    f"  * the environment variable {ENV_ROOT}\n"
    f"  * {LOCAL_CONFIG} with a 'phenobench_root' key (see local.example.json)\n"
    "The expected layout is <root>/train/images/*.png with the five annotation "
    "folders beside images (see docs/phenobench-setup.md)."
)


class DatasetNotFound(FileNotFoundError):
    """Raised when no usable PhenoBench root can be found. Carries setup instructions."""


def _read_local_config() -> dict:
    if not LOCAL_CONFIG.exists():
        return {}
    with LOCAL_CONFIG.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ValueError(f"{LOCAL_CONFIG} must contain a JSON object")
    return data


def looks_like_root(path: Path) -> bool:
    """A PhenoBench root holds train/images and val/images (test has images only)."""
    return (path / "train" / "images").is_dir() and (path / "val" / "images").is_dir()


def find_dataset_root(candidate: Path) -> Path | None:
    """Return the real root at or one level below `candidate`, or None.

    Handles the archive's own nesting (PhenoBench-v110/PhenoBench/...) without
    guessing further down than one level: a deeper search could pick up some
    unrelated copy and silently change which data an experiment ran on.
    """
    candidate = Path(candidate).expanduser()
    if not candidate.is_dir():
        return None
    if looks_like_root(candidate):
        return candidate
    nested = candidate / "PhenoBench"
    if looks_like_root(nested):
        return nested
    children = [c for c in candidate.iterdir() if c.is_dir() and looks_like_root(c)]
    if len(children) == 1:
        return children[0]
    return None


def resolve_dataset_root(explicit: str | os.PathLike | None = None) -> Path:
    """Find the dataset root or raise DatasetNotFound with setup instructions."""
    tried: list[str] = []
    candidates: list[tuple[str, str]] = []
    if explicit:
        candidates.append(("argument", str(explicit)))
    if os.environ.get(ENV_ROOT):
        candidates.append((ENV_ROOT, os.environ[ENV_ROOT]))
    local = _read_local_config()
    if local.get("phenobench_root"):
        candidates.append((str(LOCAL_CONFIG), str(local["phenobench_root"])))
    for source, value in candidates:
        root = find_dataset_root(Path(value))
        if root is not None:
            return root
        tried.append(f"{source}: {value}")
    detail = ("\nTried:\n  " + "\n  ".join(tried)) if tried else "\nNo location was configured."
    raise DatasetNotFound(SETUP_HINT + detail)


def resolve_output_dir(explicit: str | os.PathLike | None = None) -> Path:
    """Where generated panels, manifests and caches go. Created if missing."""
    if explicit:
        out = Path(explicit)
    elif os.environ.get(ENV_OUTPUT):
        out = Path(os.environ[ENV_OUTPUT])
    else:
        local = _read_local_config()
        out = Path(local["output_dir"]) if local.get("output_dir") else DEFAULT_OUTPUT_DIR
    out = out.expanduser()
    out.mkdir(parents=True, exist_ok=True)
    return out
