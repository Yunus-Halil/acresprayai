# Photo ground: controlled integration (2026-11-14)

**Status:**
- Branch `feature/photo-ground`, local only. Not pushed, merged or deployed.
- Behind `VITE_FIELD_TWIN_PHOTO_GROUND=1`, which is off unless a deployment sets it.
- Follows [photo-ground-experiment-2026-11-14.md](photo-ground-experiment-2026-11-14.md).

## What is built

| Part | What it does | Where |
|---|---|---|
| Overview in the build | After the twin and its atlases are posted, the worker lays the camera previews on the ground: nearest-nadir photograph per point, 0.6 m feathered seams, per-photograph gains. It posts the tiles and a manifest (cameras, gains, zooms, rule). The twin, its files and every stage before are unchanged (tested byte for byte). | `photoGround.overviewGround`, `pipeline.ts` (`photoGround` option, `cutGround`), `worker.ts`, `runBuild.ts` (`ground` promise) |
| Kept in the browser only | The overview is never one of the twin's files and is never uploaded. The build session keeps it with the photographs this tab built from, for the twin page. | `buildSession.ts`, `TwinOpen.tsx` |
| Viewer layer | A Photographs panel: show or hide, what it is, and the flight's files on this device. Overview tiles go in their own pane under the canvas. Over photographs, up close, rows are thin and plants are rings. The key says so ("bold ring", "faint dashed ring", "Dark: not photographed"). | `PhotoGround.tsx`, `TwinMap.tsx` (`ResolvedTileLayer`), `FieldTwinView.tsx`, `CornPanels.tsx` (`CornLegend overPhotos`) |
| Detail on demand | "Sharper photographs for this view" cuts the tiles over the view from the full photographs on this device, in a worker, each photograph decoded once. They are kept while the page is open, never stored. | `photoAccess.cutDetail`, `build/groundDetailWorker.ts` |
| Evidence | Selecting a plant, row stretch, weed candidate, gap, tree or vegetation patch shows "Every photograph that saw it": up to 4 photographs, nearest nadir first. Each is cropped from the original at the object's own size, with the twin's place ringed. | `photoAccess.evidenceViews`, `photoGround.viewsOf`, `PhotoEvidence` |
| Plants selectable | Plants can be tapped where they are drawn. The inspector says what the plant is drawn as and how many photographs located it, and says it is not a stand count. | `TwinCanvasLayer.pickAt`, `CornInspector` |
| Off switch | With the flag off: no stage runs, no overview fetch, no panel, no evidence section, and the geometry-only key. | `photoGroundFlag.ts`; tests |

## Measurements

All are on this machine, in headless Chrome or Node.

### The 123-photograph corn flight, built in the browser

This is the first browser build of this flight. Each column is a single run.

| | main e96fabb, no flag | `feature/photo-ground`, flag on |
|---|---|---|
| Twin ready | **178.3 s** | 169.3 s |
| Atlases done | 179.3 s | 170.4 s |
| Overview ready | — | **175.6 s** (the overview took 6.2 s, after the atlases) |
| Overview | — | 259 files, 6.0 MB (6.7 MB/ha) |
| Stages | photographs 3.3 s, cameras 60.8 s, corn 112.6 s, evidence 1.1 s | 2.6 s, 59.5 s, 105.7 s, 1.1 s |
| Peak memory (all of the benchmark's Chrome processes) | 2.78 GB (largest process 2.33 GB) | 2.76 GB (2.31 GB) |
| Console errors | none | none |

- The roughly 9 s difference in twin-ready time is run-to-run variance; nothing before the overview changed.
- The Node build of the same flight was 668 s, so the browser is about 3.7× faster.

### Overview made by the build's own code (Node, pure-JS decoder)

| Field | Time | Of which preview decode | Overview | Pixel | Source |
|---|---|---|---|---|---|
| Private corn | 11.1 s | 5.9 s | 4.27 MB | 3.18 cm | the camera's own previews |
| Apricot | 3.6 s | ~0 | 4.04 MB | 6.2 cm | the camera's own previews |
| Day015 / 023 / 045 | 0.6–0.8 s | | 0.24–0.32 MB | 2.86 cm | quarter decodes (no previews in these files) |

### In the viewer, flag on

Dev server, 1440×900.

| | Private corn | Day023 | Day015 | Day045 | Apricot |
|---|---|---|---|---|---|
| Geometry ready | 0.28–0.92 s | 0.24–0.28 s | 0.28–0.37 s | 0.26–0.30 s | 0.34–0.46 s |
| Overview tiles, field view | 25 | 25 | 25 | 25 | 55 |
| Detail for a close view | 1.4 s, 28 tiles, 8 photographs | 2.0 s, 35, 6 | 1.8 s, 30, 6 | 1.9 s, 35, 7 | 0.9 s, 35, 4 |
| Evidence (4 photographs) | 0.48 s | 0.58 s | 0.59 s | 0.61 s | 0.48 s |
| JS heap | 28 MB | 22 MB | 22 MB | 22 MB | 45 MB |

With the flag off, the same twins open with no photo request at all.

### Alignment

- **Same geometry as the experiment.** The integrated code's per-pixel photograph choice and pixel coordinates are the experiment's, tested on 132 tiles and 8.65 million pixels of the private flight's real cameras, with 0 differing. The experiment's alignment results therefore stand:
  - certain plants on vegetation 72.6 % against 2.8 % at half a row spacing, no systematic offset
  - rows 87 / 87 / 96 % against 4.5 / 6.4 / 28 % on the test flights
  - seams with a 5.2 cm median where soil ties exist
- **Synthetic test.** Photographs cut from one rendered field reproduce the field pixel for pixel (mean error under 25 grey levels at 3 cm). A photograph brightened 1.3× is balanced to within 0.7–0.85 of its neighbours.
- **Seen in the screenshots.** On the header-only test flights, with no soil ties, the drawn rows sit a few centimetres off the plant rows at 0.18 cm a pixel: seams of about 10 cm, as measured.

## The seven checks before participants

| # | Check | Result |
|---|---|---|
| 1 | Alignment and visual accuracy on the test fields | **Passed.** Geometry identical to the measured experiment; synthetic reproduction test; screenshots of all five fields. The header-only offset is stated in the text above. |
| 2 | Browser performance on the 123-photograph corn flight | **Measured.** 169–178 s to the twin; the overview 6.2 s later; peak memory unchanged at 2.8 GB. |
| 3 | The photographs never imply certainty beyond the detections | **Passed.** Nothing new is drawn as found. The text says "the twin's marks are what Swardus located; the photographs show what was there, including plants it did not locate". Every plant says "not a stand count". |
| 4 | Original photograph evidence from selected findings | **Built.** Plants, row stretches, weeds, gaps, trees and vegetation; up to 4 photographs each; sized to the object. |
| 5 | Legend over the photographs | **Fixed.** Bold and dashed rings as drawn; "Dark: not photographed"; the orchard key says the same. |
| 6 | Photo retention and participant permissions | **Nothing new is retained.** The terms say "Your full original drone photographs are not uploaded. Small evidence crops cut from them are saved" and that the analysis record "holds no photographs and no image data". The overview stays in this browser, and detail and evidence read files on this device. **Saving the overview to accounts (about 5–7 MB/ha) would need the terms changed first.** |
| 7 | Can be disabled without affecting the Field Twin | **Passed.** Real-flight test: twin and files byte-identical with it on. UI test: flag off shows nothing and fetches nothing. Full suite 2,739 passed. |

## Limits and open questions

- **A reopened twin has no photographs.** The overview lives only in the tab that built it. Showing it later means storing it, which needs the terms changed, or re-opening the photographs.
- **Detail tiles are lost on reload.** Cutting them again takes a second or two.
- **Opening 100+ photographs on an iPad has not been tried.** The picker takes multiple files; folder picking is not used.
- **The overview's JPEG** is 6.0 MB in Chrome against 4.3 MB from jpeg-js at the same quality setting. WebP is not tried.
- **Tall crops and trees lean** (flat plane), and header-only flights show their seam offsets.
- **Each browser build was run once**; repeat runs would give a spread.

## Recommendation for participant rollout

**Not yet.** In order:
1. **Your eye test**, flag on, in the dev preview and on a fresh build: http://localhost:8093.
2. **Decide retention.**
   - Either keep it local-only for participants (no terms change; photographs only in the tab that built the twin, or after re-opening the files),
   - or change the terms to store the overview (about 5–7 MB/ha) so every reopened twin has it.
3. **An iPad test** of opening the photographs and of evidence.
4. **Production with the feature for the founder's account only**, then participants. This needs a per-account gate: the flag today is per deployment.
