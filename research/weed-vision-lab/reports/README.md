# Reports

Small, committed summaries of what was run. Pictures are regenerated from the
scripts and live under the output directory (see `configs/local.json`).

| Folder | Contents | Produced by |
|---|---|---|
| `smoke10/` | Milestone 3 report, per-image manifest (JSON), per-instance table (CSV), summary table | `scripts/smoke_test.py` |
| `profile/` | Per-image inventory of every train and val image: counts, sizes, dates, isolation flags, validation issues | `scripts/profile_split.py` |

Every file names the dataset version, the split, the image ids and the lab
version it came from. Numbers are reproducible from the config next to them.
