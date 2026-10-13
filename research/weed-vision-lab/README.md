# Swardus Weed Vision Research Lab

Isolated research code for autonomous weed detection, weed instance segmentation
and physical canopy measurement, evaluated on PhenoBench v1.1.0. Nothing here is
imported by the production Swardus application, and nothing here imports from it.

This is a research project, not a feature. Numbers in `reports/` are what was
measured, with the subset, the configuration and the hardware written next to
them. A rendered overlay is a picture, not a result.

## Rules this lab works under

1. Production code, dependencies, build config, database and mapping pipeline are not touched.
2. No commit or push without explicit approval.
3. No images, annotations or checkpoints go to third-party services.
4. No multi-gigabyte downloads, no model training or fine-tuning, without approval.
5. No accuracy claim without an independent reference annotation to score against.
6. No manual clicks, boxes or scribbles at inference time.
7. Reference annotations score predictions; they never steer the autonomous pipeline.
8. Benchmark subsets and evaluation criteria do not change to improve a number. Failed predictions stay in the metrics.

## Layout

```
research/weed-vision-lab/
  README.md              this file
  pyproject.toml         the package (weedlab) and its research-only dependencies
  requirements.txt       the same dependencies for a plain pip install
  configs/               experiment configs; local.json (gitignored) holds this machine's paths
  src/weedlab/           the library: config, PhenoBench reader, instance extraction, visualisation
  scripts/               runnable experiments; each writes under the output directory
  tests/                 synthetic-fixture tests that need no dataset
  docs/                  audit, setup guide, annotation notes, license inventory
  reports/               small committed summaries (JSON, CSV, Markdown); pictures stay out
  outputs/               gitignored default output location (this machine uses D: instead)
```

## Setup

The lab uses its own virtual environment. On this machine it lives on D: because
C: is nearly full:

```
py -3.12 -m venv D:\swardus-research\weed-vision-lab-venv
D:\swardus-research\weed-vision-lab-venv\Scripts\python -m pip install -e research\weed-vision-lab
```

Copy `configs/local.example.json` to `configs/local.json` and set `phenobench_root`
to the extracted dataset (the folder that holds `train/`, `val/`, `test/`, or the
folder that contains that nested `PhenoBench` folder) and `output_dir` to a
location outside the repository with a few gigabytes free. See
`docs/phenobench-setup.md` for the exact expected layout.

## Running

All scripts accept `--root` and `--out` to override the config.

```
python scripts/profile_split.py --split train      # per-image inventory of plants, weeds, sizes, dates
python scripts/select_smoke_images.py              # choose the ten smoke images by the documented rule
python scripts/smoke_test.py                       # render the seven panels per image and the contact sheet
python scripts/profile_instances.py                # Phase 2: every weed instance, geometry and context (multiprocess)
python scripts/build_soil_subset.py                # Phase 2: size bands, categories A-D, plot-aware splits, manifest, report
python scripts/render_subset_sheets.py             # Phase 2: candidate and rejected contact sheets
python scripts/run_classical_baseline.py --split dev_tune --method exg_fixed --exg-t 0.08   # Phase 3: detect, score, panels
python scripts/compare_baselines.py --split dev_tune                                         # one table over every run
python scripts/run_classical_baseline.py --split dev_tune --method erfnet_weed               # Experiment 4A: official ERFNet checkpoint, CPU
python scripts/run_classical_baseline.py --split dev_tune --method exg_hyst --hyst 0.10 0.03 # Experiment 4B: hysteresis
python scripts/render_method_comparison.py --split dev_tune --run-a exg_fixed_t0.08 --run-b erfnet_weed   # side-by-side panels
python -m pytest                                   # synthetic tests, no dataset needed
python -m pytest -m dataset                        # tests that read the real dataset
```

## Status

- Milestone 3 (ten-image smoke test): done, `reports/smoke10/`.
- Milestone 4 (profile and soil-only subset `soil_only_v1`): done, `reports/subset/soil_only_v1/` (report, inspection, manifest, splits, stats).
- Milestone 5 (classical baseline, Phase 3): done, `reports/baseline/` (per-run summaries, comparisons, `phase3-report.md`). Pretrained-model inventory in `docs/pretrained-models.md`.
- Milestone 6 (Experiment 4: official ERFNet checkpoint on CPU versus colour, plus hysteresis): done, `reports/baseline/phase4-report.md`. ERFNet numbers on dev splits are in-sample.
- Next: see the recommendation at the end of `reports/baseline/phase4-report.md`.

ERFNet needs the checkpoint at the path in `scripts/run_classical_baseline.py` (`--ckpt` to override) and the CPU torch wheel: `pip install --index-url https://download.pytorch.org/whl/cpu torch` into the lab venv.

`docs/repository-audit.md` records what was in the repository before the lab.

## Dataset attribution

PhenoBench: Weyler, Magistri, Marks, Chong, Sodano, Roggiolani, Chebrolu,
Stachniss, Behley. "PhenoBench: A Large Dataset and Benchmarks for Semantic Image
Interpretation in the Agricultural Domain", IEEE TPAMI, 2024. The dataset README
shipped with v1.1.0 states the license as CC BY-NC-SA 4.0. See
`docs/license-inventory.md` before any commercial use question is decided.
