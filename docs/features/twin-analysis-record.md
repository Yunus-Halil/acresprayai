# The analysis record of a corn Field Twin

Status, 2026-11-10: built on `feature/corn-twin-sidecar`, **off** (`TWIN_ANALYSIS_ENABLED = false` in `src/lib/fieldTwin/analysisConfig.ts`), not merged, not deployed. Nothing in the app makes or saves one until that constant is true.

## Why

A saved twin keeps the field's findings and small crops of the photographs behind them. The build knew more, and discards it when its tab closes: what Corn V1 read in every photograph, where every aligned camera stood, where each finding lies in each photograph, and which pixels each crop was cut from. Without those the photographs can never be combined over the field again from the saved twin (`cornField` takes the reads and the cameras, not the twin). The record keeps them, so that later, and only if it is decided, the field's combination can be reproduced exactly, combined again with an operator's corrections, and new crops cut at a known place once the operator selects the original photographs again. None of that is built.

## What it is

One more private file beside the twin: `orthos/<user id>/field-twins/<twin id>/analysis.json.gz` (gzipped JSON, format `swardus-twin-analysis-v1`, `src/lib/fieldTwin/analysis.ts`).

| Part | What |
|---|---|
| `reads` | Corn V1's read of every photograph, exactly as the field combination received it (`CornPhotoRead`, no further rounding: rounding to whole pixels saved 8 % and broke reproduction on every test flight) |
| `frames` | every aligned camera (lens numbers, position, attitude, boresight) and the flat ground plane's height |
| `fieldOptions`, `engine` | the combination's settings and the versions that made it |
| `sightings` | where each weed observation and gap of the twin lies in each photograph that reported it, original-frame pixels, under the twin's own ids |
| `crops` | for each evidence crop (by its atlas cell, as the twin's evidence entry names it): the photograph and the square of it the crop was cut from |
| `photographs` | name, file size, pixel size, capture time |

Not in it: pixels, and any digest of the original files (to be added with the re-selection of originals, when that is built and checked).

## What it is not

- Not part of the twin. `twin.json` is the same with and without it (tested on a real build, byte for byte apart from the build time). It is not one of the bundle's files, the viewer never reads it, and `parseTwin` knows nothing of it.
- Not needed by anything. Every twin saved without one, and every orchard twin, opens exactly as before. Corn builds only.
- Not able to hurt a save. It is uploaded after the twin is saved and marked ready and the session has stopped guarding the tab, as a separate upload that reports its own failure and nothing else (`buildSession.ts`, `saveAnalysisApart`). A failed or unfinished upload leaves a whole twin without a record.
- Not shared. Same owner-only folder and storage rules as the twin; deleted with the twin; the founder's twin viewer signs only `twin.json(.gz)` and `atlas-N.jpg`, so it is never handed out even with troubleshooting permission. No export, no training, no other account.

## Measured

Real in-browser builds (Chrome 157, this desktop, 12 cores), the 40-photograph UAV3DCrop Day023 corn flight, two builds each way:

| | Without the record | With the record |
|---|---|---|
| Twin ready | 66.2 s, 66.1 s | 65.1 s, 65.1 s |
| Peak memory, all of the build's Chrome processes (sampled every 2 s) | 2.56, 2.61 GB | 2.65, 2.76 GB |
| The twin (rows, weed candidates, gaps, atlases) | 11 corn rows, 7, 0, 1 | the same |

The record of that build: 685 KB of JSON, 248 KB gzipped (17 ms in the browser), 40 photographs, 41,435 located plants, 18 crop sources, 11 weed observations' sightings. No difference in build time; the memory figures differ by less than the sampling can resolve (one decoded photograph is 84 MB; the record is under 1 MB).

From the earlier measurements on three flights (cached reads): 104 to 264 KB per 40 photographs, 1 to 2.6 MB extrapolated to the pilot's 400-photograph limit, a re-read of the field from the stored record identical to the build's in 11 to 37 ms. A record over 8 MB gzipped is not saved.

Not measured: a commercial DJI corn flight, Safari, a tablet, a real upload.

## Before it is switched on

1. The pilot terms say what is saved; the record adds camera positions and attitudes, every located plant's position in every photograph, file sizes and capture times. The terms need that sentence first (`docs/operations/pilot-access.md`, section 8).
2. Set `TWIN_ANALYSIS_ENABLED = true`. No migration and no function deploy are needed: the file goes to the folder the twin's files already go to, and the two new event names (`twin_analysis_saved`, `twin_analysis_failed`) fit the events table as it is.
3. To switch off again: the constant. Records already saved stay beside their twins until the twin is deleted.

## Tests

`src/test/fieldTwinAnalysis.test.ts` (contents, exact reproduction after a gzip round trip, inputs untouched, no pixels or digests, refusals, the real four-photograph build with and without), `fieldTwinAnalysisSave.test.tsx` (off as shipped, order of the two saves, failure and hang of the record's upload, orchard never asked), `fieldTwinAnalysisAccess.test.ts` (storage path and size cap, the pilot's storage rules as SQL, the founder's viewer).
