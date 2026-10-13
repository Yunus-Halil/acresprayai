# Repository audit (2026-10-13)

What was in the Swardus repository before the lab was created, and how the lab
stays apart from it.

## Existing research relevant to this lab

| Path | Exists | What it is | Reusable? |
|---|---|---|---|
| `src/lib/rwMeasure/` (tape, canopy, measure, geometry, types) | yes, 897 lines TS | Close-range ruler-referenced canopy measurement, `rw-measure-v1` | Calibration (`tape.ts`) and the span/perpendicular/equivalent-diameter definitions (`geometry.ts`, `types.ts`) are the reference for Phase 6 Experiment C. TypeScript; the lab will call it via the existing `npm run rw:measure` runner rather than port it. |
| `scripts/rwmeasure/run.ts` | yes | Runner over `measurementrealworldimages/rawimagery` | Produces `results.json`, `measurements.csv`, per-image result JSON with the canopy outline in pixels. Those outputs are the physical-calibration inputs for Phase 6. |
| `src/test/rwMeasure.test.ts` | yes | Unit tests for the above | Untouched. |
| `measurementrealworldimages/` | yes: `rawimagery/` (gitignored), `results/` | 15 tape photographs, results, per-image review templates | The only calibrated imagery in the repository. No field ground truth exists for any of them (`groundTruth` blocks empty), so they can validate scale, not canopy accuracy. |
| `docs/features/real-world-measurement.md` | yes | The experiment's report | Its findings are preserved as-is; see "Prior findings" below. |
| `src/lib/weedScout/` | yes | The production detector (vegetation, blobs, candidates, sizing, structure) | Not imported by the lab. Whether its vegetation and blob stage can be run on PhenoBench as the "existing Swardus detection logic" baseline is a Phase 3 question; it runs in the browser via onnxruntime-web and would need a Node harness, not a Python import. |
| `offrow/` | yes | A separate Python research package (own venv, pyproject, tests) for off-row corn detection | The precedent for an isolated Python track inside the repo. Not a dependency. Its venv was used only to probe the dataset once; the lab has its own. |
| `evaluation/` | yes | Open-row benchmark labels and scorer (TypeScript) | Unrelated imagery; not used. |

## Prior findings preserved from the close-range experiment

From `docs/features/real-world-measurement.md` and the committed results:

- Ruler calibration from tick periodicity worked in 14 of 15 photographs with a stated uncertainty; one was refused.
- Automatic target selection was the pipeline's guess in nine of fifteen and flagged in six.
- Complete canopy segmentation was generally unsuccessful in dense grass: green-colour segmentation fragmented leaves and took in surrounding vegetation.
- Aggressive morphological opening removed thin structures; a shaded leaf more than 0.7 cm from the rest was lost.
- Physical measurements were produced but never validated against a field measurement.

Nothing in that experiment is modified by this lab.

## Isolation strategy

- All lab code lives in `research/weed-vision-lab/` as a standalone Python package (`weedlab`). Nothing under `src/`, `scripts/`, `supabase/`, `package.json` or the build config was changed.
- Python 3.12 virtual environment at `D:\swardus-research\weed-vision-lab-venv` (C: has 2 GB free). Dependencies: numpy, pillow, scipy, scikit-image, matplotlib, pytest. No torch yet.
- Dataset stays at `D:\Drive2downloads\PhenoBench-v110\PhenoBench`; the lab reads it in place. Nothing is copied into the repository.
- Generated panels, contact sheets, profiles and caches go to `D:\swardus-research\weed-vision-lab-outputs` (set in `configs/local.json`, which is gitignored). `reports/` holds only small JSON, CSV and Markdown summaries; `reports/**/*.png` is ignored.
- The lab's `.gitignore` covers outputs, the local config, venvs and rendered pictures.

## Machine

AMD Ryzen 5 9600X (6 cores), 31 GB RAM, AMD Radeon RX 9060 XT (no CUDA; GPU inference for torch models is not available on this machine through the usual path). Python 3.12.10. Windows 11.

## Production files

`git status` after the lab was created shows only `research/weed-vision-lab/` as new, plus the pre-existing untracked `.codex/`. No tracked file was modified.
