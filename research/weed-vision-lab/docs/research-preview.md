# Weed Vision Research Preview: the temporary Swardus integration

Branch `experiment/weed-vision-preview` (from `research/weed-vision-lab`). Private, local,
non-commercial research use only. The ERFNet checkpoint and its code lineage carry
unresolved commercial permissions (`docs/licensing-audit.md`); nothing here may be
deployed, merged into `main`, or used for customer deliverables.

## What it is

A dev-only page at `/app/weed-vision` ("Weed Vision Research Preview") that uploads
a photograph to a local Python service (`weedlab.service`, Flask, loopback only),
which runs the research detectors and returns weed instances with pixel geometry.
The page draws outlines, fills and numbers over the photo in the existing
`PhotoViewer` (zoom, pan), shows per-weed measurements on click, compares two
algorithms, exports JSON and CSV, and, if a reference mask is supplied, scores the
prediction against it (scoring only, after inference).

## Launch

Two terminals.

```
# 1. the research service (research venv on D:; loads the checkpoint on start)
cd research\weed-vision-lab
D:\swardus-research\weed-vision-lab-venv\Scripts\python scripts\serve_research_api.py
#   -> http://127.0.0.1:8765/weed-vision/health

# 2. the app, with the flag, in development mode
#    put VITE_WEED_VISION_PREVIEW=true in .env (next to the Supabase values), then
npm run dev
#   -> http://localhost:8080/app/weed-vision  (sign in as usual; turn on Developer tools in
#      Settings for the sidebar entry, or type the URL)
```

Stop the service with Ctrl+C in its terminal. Stop the app the same way.

Options on the page: algorithm (the registry below), processing scale (1.0 =
native; see the resolution ladder before using less), tile size and overlap
(1024 / 128 default), a second algorithm for comparison, a reference PNG for
scoring. Export JSON (the full result), instances CSV, summary CSV.

## Algorithms (`weedlab.service.algorithms`)

| name | what | benchmark |
|---|---|---|
| `selected` = `erfnet_erode1` | ERFNet weed class, 1 px erosion, 8-connected components, no size floor (Experiment 5) | reports/postprocess/S3_erode_1 |
| `erfnet_argmax` | ERFNet weed class, plain components (Experiment 4A) | reports/postprocess/A1_argmax |
| `erfnet_erode1_watershed` | as selected plus adaptive distance-transform watershed (Experiment 5 C2, optional) | reports/postprocess/C2_erode1_adaptive_h4_p5_s0.50 |
| `exg_fixed_0.08` | ExG on chromaticity above 0.08, components (Phase 3). Vegetation, not weeds | reports/baseline/exg_fixed_t0.08 |
| `exg_hyst_0.10_0.03` | ExG hysteresis (Experiment 4B) | reports/baseline/exg_hyst_h0.10_l0.03 |

ERFNet runs tiled (`weedlab.service.tiling`): the image, optionally area-downsampled
by `scale`, is cut into `tile` x `tile` windows with `overlap` px overlap; each
window is z-scored and run exactly like a PhenoBench image; softmax maps are
blended with a linear ramp across the overlap; argmax, erosion and components run
once on the blended full-size map, so a weed on a tile seam is one instance. Images
smaller than a tile are reflect-padded. The last tile row and column are shifted to
end at the image edge.

## Result schema (`schema_version: weed-vision-preview-result-1`)

Top level: `run_id`, `research_only: true`, `image {filename, format, bytes, width, height, exif, coordinate_system}`,
`processing {scale, width, height, tiles, tile_px, overlap_px}`, `algorithm {name, label, family, benchmark, description, requested, separation}`,
`model {loaded, checkpoint_path, checkpoint_sha256, load_ms, error, threads, licence_note}` (null for colour algorithms),
`versions {service, lab}`, `count`, `instances[]`, `crop_regions_px` (ERFNet crop class, outer polygons, or null),
`pixel_fractions {weed, crop}`, `timings_ms {rescale, inference_tiling_setup, inference_preprocess, inference_forward, inference_blend, inference_total, postprocess_mask, components, algorithm_total, geometry_and_polygons, crop_regions, total, decode, request_total}`,
`memory {peak_working_set_mb}`, `warnings[]`, `measurement_note`, and `evaluation` when a reference was supplied.

Each instance: `id` (1-based, stable within a run, in label order), `centroid_px [x, y]`, `bbox_px [x0, y0, x1, y1]`,
`area_px`, `max_span_px`, `span_endpoints_px`, `perpendicular_span_px`, `obb {length_px, width_px, angle_deg}`,
`equivalent_diameter_px`, `solidity`, `pieces`, `touches_border`, `tiny`, `score`, `score_kind`, `polygons_px [[[x, y], ...], ...]`,
`area_px_at_processing_scale`, `flags[]`, and `mask_rle_processing_scale` when `include_rle=1`.

Coordinates: original image pixels, x right, y down, pixel centres at integer positions, whatever the processing scale.
Definitions: `weedlab.phenobench.geometry.measure_mask` (max span = farthest pair of pixel centres; perpendicular span
= extent across that axis; oriented box = minimum-area rectangle; solidity = area over convex hull area) and
`weedlab.service.instances` (polygons = outer contours at 0.5 of a 1 px padded crop, simplified at 0.8 px; holes not returned).
Units are pixels only. No centimetres, no coordinates, no calibration.

Evaluation (`POST /weed-vision/evaluate`): the reference PNG (16-bit instance ids, or 8-bit nonzero = weed) is scored with
the lab's matcher after inference: TP / FP / FN at IoU 0.5 and recall at 0.3, mask IoU, pixel precision and recall, count error,
instance IoU median, per-reference and per-detection rows, and TP / FP / missed region polygons for the overlay.

## Endpoints

`GET /weed-vision/health`, `GET /weed-vision/algorithms`, `POST /weed-vision/detect` (multipart `image`; form `algorithm`,
`scale`, `tile`, `overlap`, `include_rle`, `include_crop`, `async`), `GET /weed-vision/jobs/<id>`, `POST /weed-vision/evaluate`
(adds `reference`). Limits: 120 megapixels, 120 MB, 64 px minimum side. The service refuses to bind anything but loopback.
The app reaches it through the Vite dev proxy `/weed-vision-api` (no CORS headers anywhere).

## Files

New application files (all inside the branch):

- `src/lib/weedVision/flag.ts`, `client.ts`, `export.ts`, `compare.ts`
- `src/components/app/weedVision/WeedOverlay.tsx`
- `src/pages/app/WeedVisionPreview.tsx`
- `src/test/weedVision.test.tsx`

Modified application files (every change is marked `WEED-VISION-PREVIEW` in a comment):

- `src/App.tsx`: lazy import and a flag-gated `<Route path="weed-vision">`
- `src/components/app/AppLayout.tsx`: a flag-gated sidebar entry under Developer tools, plus the `FlaskConical` icon import
- `src/components/app/workspace/PhotoViewer.tsx`: optional `onPhotoClick(x, y)` prop (a click under 4 px of movement); no behaviour change without it
- `vite.config.ts`: `loadEnv` import and a dev-only proxy entry
- `src/vite-env.d.ts`: the variable's type
- `.env.example`: the variable, commented out

New research files (lab, not the app): `src/weedlab/service/` (`tiling.py`, `instances.py`, `algorithms.py`, `app.py`),
`scripts/serve_research_api.py`, `scripts/resolution_ladder.py`, `tests/test_service.py`, this document, `docs/licensing-audit.md`.
The research venv gained `flask` (and `torch` earlier). No production dependency changed.

## Feature flag

`VITE_WEED_VISION_PREVIEW=true` in `.env`, read by `isWeedVisionPreviewEnabled()` together with `import.meta.env.DEV`.
A production build (`npm run build`) never registers the route or the proxy, whatever the variable says; the page is a
lazy chunk that nothing loads. No database migration, no schema change, no Supabase call is made by the page.

## Disable, stop, remove

1. Disable: remove or comment `VITE_WEED_VISION_PREVIEW` in `.env`; restart `npm run dev`. The route, the sidebar entry and the proxy vanish.
2. Stop the service: Ctrl+C in its terminal (or close it). It holds no state.
3. Remove entirely (reversible): `git checkout research/weed-vision-lab` and delete the branch `experiment/weed-vision-preview`
   (`git branch -D experiment/weed-vision-preview`) once nothing on it is wanted; `main` was never touched. The lab's service
   code lives on the research branch only if committed there; otherwise it goes with the experiment branch.
4. Or, keeping the branch: `research/weed-vision-lab/scripts/preview_cleanup.py --plan` lists every new and modified application
   file; `--confirm` restores the modified files from `research/weed-vision-lab` and deletes the new ones. It never touches `.env`,
   user data, the database or anything outside that list.

Confirmation: `git diff research/weed-vision-lab..experiment/weed-vision-preview --stat` shows exactly the files above; reverting
them or discarding the branch restores the application byte for byte.

## RF-DETR Seg-Large as a service algorithm (2026-10-15)

`rfdetr_seg_large` (family `rfdetr`, model `rfdetr`) is the Experiment 7 checkpoint
(`D:\swardus-research\rfdetr-exp7\runs\seg_large\checkpoint_best_total.pth`, epoch 75 EMA; env `WEEDLAB_RFDETR_CKPT`,
flag `--rfdetr-ckpt`; `--rfdetr-device cuda|cpu`). It needs the ROCm environment, which now also hosts ERFNet on CPU:

```
D:\swardus-research\rfdetr-exp7\venv-rocm\Scripts\python.exe scripts\serve_research_api.py
```

Differences from the ERFNet algorithms, all additive to the result schema:

- `instances[].class` is `"weed"`; `crop_instances[]` holds the crop plants with the same geometry fields and `class: "crop"`;
  `crop_regions_px` still carries their outlines for older clients; `classes` lists what the algorithm can say.
- `instances[].score` is the detector's confidence (`score_kind: "detector_confidence"`), cut at the form field `threshold`
  (0.05 to 0.95, default `default_threshold` 0.5 from the registry; `processing.threshold` echoes it).
- `instances[].fused_from_tiles`: predictions of one plant from overlapping tiles are fused (duplicate: mask IoU >= 0.5;
  seam fragment: intersection >= 0.6 of the smaller mask; same class, different tiles only).
- `GET /health` has `models: {erfnet, rfdetr}` (each `loaded`, `checkpoint_sha256`, `error`, and for RF-DETR `device`,
  `resolution`, `architecture`); `model` stays the ERFNet holder. A 503 names which checkpoint is missing.
- Timings: `inference_forward` (GPU), `inference_fusion`, `rasterize`, `geometry_and_polygons`; `memory.peak_gpu_mb`.
- One inference at a time on the GPU (the holder's lock). The first request after start-up pays the MIOpen kernel search
  unless the service was started with preload (default), which warms the model up on a blank tile.
- Known runtime caveat: with torch 2.9.1+rocm7.2.1 the Python process hangs at exit after inference. The service is
  long-lived; if Ctrl+C does not return, stop it with `Stop-Process`. Never add `os._exit` / `TerminateProcess`.

Benchmark for the label (PhenoBench val, 772 images, IoU 0.5, lab matcher): weed precision 0.54 / recall 0.58 at
threshold 0.3 (0.63 / 0.56 at 0.5), tiny weeds 0.16, crop-as-weed 0.27 per image; ERFNet + erosion on the same images
0.38 / 0.76, tiny 0.46, crop-as-weed 0.71. Full report: `research/rfdetr-exp7/reports/evaluation_final/`.

## Weed Scout: model detections over the scan's photographs

The Weed Scout tab (developer mode) has a "Model detections" panel (`src/components/app/weedVision/ModelDetectionsPanel.tsx`):
pick an algorithm from this service, a confidence cut and a tile size, and run it over every kept original of the scan.
Each photo's instances are carried to the ground through the camera pose (`src/lib/weedVision/frames.ts`, the same ray
and ground plane as the detector boxes), saved per photo (`scan_frame_detections`, migration 20261015120000, keyed by
run version + settings + checkpoint hash), and the same plant seen from several photos is merged to one (best view kept,
`seenIn` lists the rest). The plants draw on the Weed Scout map and on Field View (`ModelDetectionLayer`); a plant's card
shows class, confidence, size and photos, and "Mark on the field" writes an ordinary `user_annotations` row
(issue type "Weed pressure"). Nothing is marked without that click.
