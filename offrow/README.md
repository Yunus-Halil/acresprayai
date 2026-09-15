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
| 3 | `synth.py` | implemented |
| 4 | ~~`altitude.py`~~ | cancelled: the ladder is flown |
| 5 | `io.py`, `vegetation.py` | implemented |
| 6 | `rows.py` | implemented |
| 7 | `blobs.py`, `candidates.py`, `grid.py` | implemented |
| 8 | `eval.py` | matching and binned recall done; curves and sweep outstanding |

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

## Weed size is binned, never pooled

Recall is always reported per ground-truth weed diameter, with edges at 4, 8, 16 and
32 cm. Those are octaves anchored on the 3 cm seedling the flight spec targets: at 5.5
mm/px they land at 7.3, 14.5, 29 and 58 px across, so the first edge sits just above the
4 px detection floor and the second right at the 15 px shape floor.

USU has **zero** labelled weeds under 8 cm; 93 percent of its truth is 16 cm or larger.
A pooled recall number from it measures a different, easier problem. The smallest bin is
the only one that speaks to the flight spec, and the public sets do not populate it, so
the recall-versus-GSD curve bounds the problem from above rather than estimating it.
`synth.py` defaults to a 3 cm weed for exactly this reason.

## Environment: GDAL is checked at runtime, not assumed

`rasterio`, `pyproj` and `pyogrio` were blocked on this machine by an Application
Control policy and later were not, with no change to the install. So availability is a
runtime fact: `io.py` and `synth.py` both go through a backend seam, `offrow backends`
says which is active, and asking for one that cannot load raises rather than silently
using the other. GeoJSON never touches GDAL.

## The altitude ladder is flown, not simulated

There is no `altitude.py`. A real drone flies the ladder and the rungs are measured.
`eval.gsd_sweep()` takes a scene per GSD. Synthetic scenes can still be rendered
natively at several GSDs, which exercises a detector across resolutions on known truth
and is still not flying.

The synthetic finding that rows survive 1.7 to 11 mm/px unchanged, while a 3 cm weed
goes from 17.6 px to 2.7, stands as an **untested upper bound** from synthetic imagery.
The part worth keeping is that the angle search is the fragile step, not the sampling:
project an axis-aligned profile through rows running at 23 degrees and it is noise at
every resolution. `rows.py`'s confidence metric is where that gets handled.

## Row geometry: check the phase, not the angle

Angle and pitch are easy to check and were exact through two separate phase bugs, each
of which put every centerline at a random offset. The test that catches them compares
the fitted model against known crop positions, which sit on centerlines by construction.
Uniform noise on a 76 cm pitch averages 19 cm; a fit that has found the rows leaves the
planter jitter, about 1.5 cm.

Row confidence is split into an angle part and a pitch part because they fail
separately: one row gives a perfect direction and no spacing at all. Real rows score
0.98, noise at the same vegetation coverage scores 0.22, a closed canopy scores 0.00,
and a model with nothing above the floor refuses to be queried.

```
offrow backends
```

## The detector, end to end

```
offrow detect --ortho field.tif --boundary field.geojson --row-spacing-in 30 \
              --out candidates.geojson
offrow grid   --candidates candidates.geojson --cell-m 10 --out review.geojson
```

`detect` fits rows from the ortho, extracts blobs window by window, applies headland
and boundary exclusions **before** scoring, and emits a queue ranked by normalised
off-row distance. `grid` aggregates that into 10 m review cells sorted by worst
candidate. Nothing in either output calls anything a weed; there is a test for that.

The area floor in `blobs.py` is 1 cm2, not the 4 the spec named. A 3 cm weed has about
5 cm2 of leaf area, so a 4 cm2 floor deleted two thirds of them while buying no
reduction in false positives at all. See `FLIGHT.md` for why that number cannot be
settled without flown imagery.

## Rules that outrank convenience

1. No machine learning in the current phase.
2. Never load a full raster into memory. Windowed reads with overlap, and blobs that
   straddle a seam get merged, not double-counted or truncated.
3. All thresholds in ground units, never pixels. Convert at the call site.
4. Every function that touches imagery takes or derives a GSD. A result without a GSD
   attached is not a result.
5. No hardcoded sensor. Camera geometry is parameters.
6. Ranked candidates, never verdicts.

`data/` is gitignored. Synthetic scenes and public datasets carry development; flown
imagery is arriving. Anything not captured by a camera at the GSD it claims is labelled
as what it is, and synthetic numbers are never quoted outside this repo.
