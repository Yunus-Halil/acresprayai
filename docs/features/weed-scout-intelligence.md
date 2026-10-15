# Weed Scout field intelligence: from thousands of detections to review areas

Stage A audit and plan, 2026-10-15. Stage B status is at the end.

## What exists and is reused (nothing here is rewritten)

| piece | where | role in the new system |
|---|---|---|
| RF-DETR / ERFNet service | `research/weed-vision-lab/src/weedlab/service` (one process, both models) | the detector; untouched |
| per-photo scoring, grounding, repeat-sighting merge | `src/lib/weedVision/frames.ts` (`groundFrameResult`, `mergeAcrossFrames`), `frameRunStore.ts` | raw observations per photo (`rawByTask`), unique plants (`plants`), kept per photo in `scan_frame_detections` |
| row context | `src/lib/weedVision/rowFilter.ts` on the photo pass's saved reads (`scan_photo_reads`) | each weed carries `rowStatus` off-row / on-crop / on-row / no-rows; the pattern's reliability is "a row read exists for this photo" |
| field boundary clipping | `frameRunStore.setFrameRunBoundary` + `outside` count | plants outside the field are kept in the raw rows, hidden from the map |
| Level 3 rendering | `src/components/app/weedVision/ModelDetectionLayer.tsx` (dot canvas below zoom 18, outlines in view above) | the detections mode, unchanged |
| original-photo evidence | `CloserLook.tsx` with `ringCandidate` + `spotSources` (any area opens in the photos that saw it), per-photo model run | the hotspot's evidence view |
| operator decisions and handoff | `applyAnnotation` → `user_annotations` (explicit click only), `saveAll` → Flight Planner | unchanged; a hotspot never becomes a treatment zone by itself |
| map helpers | `FitBounds`, `MouseReadout`, `useMapEvents` zoom gating pattern (`VegetationLayer`) | zoom-to-hotspot, level-of-detail |

Data flow today: service result → `groundFrameResult` (+ `rowContext`) → raw per photo → `mergeAcrossFrames` → `withinField` → `plants` →
`ModelDetectionLayer`. The new layer sits after `plants`: `plants` → `buildHotspots` → Priority / Heatmap views. Raw rows and unique
plants are never altered by it; toggling a view recomputes nothing.

## Aggregation (`src/lib/weedVision/hotspots.ts`, pure)

- Work in local metres (`toEnu` on the scan's reference), never in pixels: a cell is `cellM` metres (default 2 m).
- Only weeds off the rows or in photos without a row read occupy cells. Weeds the pattern put on a crop plant or a row line do not
  start areas (an orchard's tree rows would otherwise all be hotspots); they are counted inside an area as "classification to review".
- An occupied cell has at least `minPlants` unique weeds or `minCoveredM2` of candidate weed canopy. Occupied cells that touch
  (8-connected) form one area. Unique plants, not observations: the repeat-sighting merge already ran.
- An area's geometry is the union of its cells (grid-aligned, honest about its resolution) plus a convex hull for the map.
- Signals per area, all measured: unique weeds, raw observations, candidate covered canopy (m², only when every plant has a valid
  ground sampling), area of the cells (m²), density (weeds / m²), off-row / on-row / no-row counts, confidence mean and the share under
  `lowConfidence`, distinct photos.
- **Review priority** = weighted sum of each signal normalised by the field's own maximum, weights in the params and shown with every
  area as plain-language reasons. Low confidence raises priority slightly (review, not dismissal). No severity, no treatment claim.
- Isolated weeds (no occupied cell) stay in `isolated`, counted in the summary and inspectable in the detections mode.
- Stable ids: the area's centre on a 4 m grid, so a re-run with the same settings keeps the same ids while the centre stays put.

Fallback without rows: every weed is "no-rows"; the off-row signal is skipped and the reasons say the field has no row read.

## Interface

Three modes in the Model detections panel, default **Priority**: hotspot outlines ranked and numbered, a summary line
("N areas flagged for review; K with concentrated off-row vegetation; M with classification to review; P isolated findings"), a ranked
list; selecting an area zooms to it and opens its card (signals, reasons, confidence, photos, review buttons, open the photos, mark on
the field explicitly). **Heatmap**: the occupied cells shaded by candidate covered canopy per cell, on one canvas. **Detections**: the
existing Level 3 layer. Confirmed / dismissed / uncertain reviews persist per scan and area id (`scan_hotspot_reviews`); they colour the
outline and are never overwritten by a rescan (a rescan may add new areas).

## Risks

- Area ids move if a cluster's centre moves more than 4 m between runs; reviews are then orphaned, kept in the table, and listed.
- Row reliability is binary (read / not read); the pattern's own confidence is not yet exposed per photo.
- Covered canopy sums the model's masks at the photo's ground sampling; it is a candidate figure, labelled so, never an acreage claim.
- Clipping uses the field boundary when one exists, else the orthomosaic bounds; both are rectangles or rings on a flat plane.
- Performance: aggregation runs only when plants change (already throttled to one publish per two seconds during a run).

## Tests

`src/test/weedVisionHotspots.test.ts`: grid and connectivity, min-occupancy thresholds, isolated plants preserved, on-row weeds do not
seed areas but are counted, unique-versus-observation counts, covered area null when a plant has no sampling, ranking order and reasons,
no-row fallback, stable ids, summary counts. Store and panel tests extended for modes and reviews.

## Stage B status (2026-10-15)

Built and wired, on branch `experiment/weed-vision-preview`:

- `src/lib/weedVision/hotspots.ts`: the grid grouping, signals, review priority with reasons, isolated findings, heatmap cells, summary line. Tests `src/test/weedVisionHotspots.test.ts` (8).
- `frameRunStore.ts`: areas recomputed only when plants or grouping settings change (`patchFrameRun`); `viewMode`, `selectHotspot` (+ map focus), `reviewHotspot` / `restoreHotspotReviews` / `orphanedReviews`; clipping falls back to the orthomosaic bounds when the field has no boundary.
- `scan_hotspot_reviews` (migration 20261015150000) and `hotspotReviewCache.ts`: confirmed / dismissed / uncertain + notes per scan and area id; never overwritten by a rescan; orphaned reviews listed.
- `HotspotLayer.tsx`: Priority outlines numbered by rank and coloured by review, selected area's cells shaded from zoom 17, `HotspotFocus` flies to the selection; `HeatmapLayer` shades occupied cells on one canvas. `ModelDetectionLayer` draws every plant only in Detections mode, and the selected area's plants close in under Priority.
- `HotspotPanel.tsx`: view switch (Priority default), summary sentence, ranked list, the area card (measurements, row context, confidence, reasons, photos count), Open the photos (the closer look on the area's outline, with the per-photo model run available there), Confirm / Uncertain / Dismiss + notes, Mark on the field (confirmed areas only, explicit, an ordinary `user_annotations` row), and "Numbers behind this view" for the report.
- Field View shows the Priority outlines and the Detections plants read-only.

Not done, owed: before/after screenshots on the vineyard field (Yunus takes them); the implementation report's field numbers come from
"Numbers behind this view" on the real scan; the row pattern's own confidence per photo (binary read / not read today); heatmap
legend; agronomist interviews to set the priority weights.
