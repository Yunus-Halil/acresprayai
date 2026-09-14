# offrow

Off-row vegetation detection in early-season corn from RGB drone imagery.
The research track. See `CLAUDE.md` for the full spec; this file is only how to run it.

**The one idea:** do not learn what corn looks like, learn where corn is. Corn is
planted in rows at a spacing the grower already knows, so vegetation between the rows
is by construction not the planted crop. That is geometry, not prediction.

**The output is a ranked review queue, never a verdict.** A human confirms.

## Status

| Step | Module | State |
|---|---|---|
| 1 | `sensor.py` | implemented |
| 2 | `datasets.py` | stub |
| 3 | `synth.py` | stub |
| 4 | `altitude.py` | stub |
| 5 | `io.py`, `vegetation.py` | stub |
| 6 | `rows.py` | stub |
| 7 | `blobs.py`, `candidates.py`, `grid.py` | stub |
| 8 | `eval.py` | stub |

Every stub raises `NotImplementedError`, and `tests/test_scaffold.py` enforces that.
`tests/test_required.py` holds the spec's list of must-pass tests as skips, each naming
the step that makes it real.

## Setup

```
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"     # Windows
.venv/bin/python -m pip install -e ".[dev]"         # POSIX
```

Python 3.11+. No GDAL command line dependency. No torch, no tensorflow, no pretrained
models: the current phase is geometric, and scikit-learn is permitted only for the
one-class anomaly step, which does not exist yet.

## Run

```
pytest
offrow sensor --sensor-mm 13.2 --px 8192 --focal-mm 8.8 --alt 30
offrow sensor --list
offrow sensor --catalog fourthirds-20mp --target-gsd-mm 5.5
```

`offrow --help` lists the rest of the commands. They exit with a message naming the
module that has to exist first.

## Rules that outrank convenience

1. No machine learning in the current phase.
2. Never load a full raster into memory. Windowed reads with overlap, and blobs that
   straddle a seam get merged, not double-counted or truncated.
3. All thresholds in ground units, never pixels. Convert at the call site.
4. Every function that touches imagery takes or derives a GSD. A result without a GSD
   attached is not a result.
5. No hardcoded sensor. Camera geometry is parameters.
6. Ranked candidates, never verdicts.

`data/` is gitignored. There is no drone for this work, so nothing may assume access to
new imagery; everything is developed against synthetic scenes and public datasets
resampled to simulate altitude. Any curve produced that way is labelled simulated.
