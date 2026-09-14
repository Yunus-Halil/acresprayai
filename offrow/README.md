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
| 2 | `datasets.py` | implemented |
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
offrow sensor --cruise 15 --frame-interval 1 --frontlap 0.75 --duty 0.55
```

### The crossover altitude

Coverage cost is piecewise, not quadratic. Ground speed is the smaller of cruise speed
and what the frame interval allows at the required frontlap, so above the crossover the
aircraft is cruise-limited and coverage falls off linearly as you descend; below it the
camera binds and the fall-off goes quadratic. On the spec sensor at 15 m/s, 1 s and 75
percent frontlap the crossover is 53.3 m, and 30 m costs 7.1x the flying of 120 m rather
than the 16x a quadratic-everywhere model predicts. `crossover_altitude_m()` is a
first-class output for that reason.

Flight-count ratios are geometry and survive. Both acres/hour columns depend on cruise
speed, frame interval, sidelap and duty cycle, which are assumptions and are parameters.

`offrow --help` lists the rest of the commands. They exit with a message naming the
module that has to exist first.

## A frame is not a field

Both public datasets ship tiles cut out of orthomosaics, and a tile is too small to
carry a row model:

| | tile | rows at 30 in | reassembled | rows |
|---|---:|---:|---:|---:|
| DRONEWEED | 1000 px @ 1.7 mm = 1.70 m | 2.2 | filenames carry no tile origin | - |
| USU-Corn-WeedDB | 640 px @ 4.8 mm = 3.07 m | 4.0 | 12.9 x 17.8 m | 16.9 |

`row_fit_feasibility()` computes this from the published descriptor without
downloading anything, and every coverage report ends with it. USU filenames encode the
tile origin (`10m_cache (1036)_x1024_y512.jpg`), so `stitch()` puts a source frame back
together; DRONEWEED files are named species plus a counter, so unless the VOC `path`
field kept the original partition name, those tiles cannot be reassembled at all.

A stitched mosaic has complete imagery and partial truth. `Mosaic.truth_footprint_m2`
says how much of it the annotations cover, because a detection outside that footprint is
unjudgeable, not wrong.

```
offrow fetch   --dataset usu-corn-weeddb
offrow inspect --dataset usu-corn-weeddb --row-spacing-in 30 --mosaic --complete --samples 3
```

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
