# Two-stage weed intelligence: audit, benchmark plan, candidates, smallest prototype

Investigation of 2026-10-19 on branch `experiment/weed-vision-preview`. Nothing in the product was changed. Every number
below was measured on this machine (Ryzen 5 9600X, 6 cores / 12 threads, 31 GB RAM, Radeon RX 9060 XT under ROCm 7.2.1 on
Windows) unless it is marked as estimated. No accuracy claim is made anywhere in this document: no independently labelled
field exists yet, and the one smoke check below runs on the development field with non-exhaustive labels.

Reproduce:

```
# service path and Stage 1 costs (writes D:\swardus-research\weed-vision-lab-outputs\two-stage-2026-10-19\)
powershell -ExecutionPolicy Bypass -File D:\swardus-research\rfdetr-exp7\worktree\research\rfdetr-exp7\scripts\run_gpu_job.ps1 `
  -Python D:\swardus-research\rfdetr-exp7\venv-rocm\Scripts\python.exe -Sentinel <out>\gpu_done.txt -Log <out>\gpu.log -Err <out>\gpu.err `
  -WorkingDirectory research\weed-vision-lab\scripts -Job "profile_two_stage.py --mode gpu --out <out>"
# same with --mode cpu --threads 4,12 and sentinel cpu_done.txt (cpu mode reads the gpu run's instances)
# app-side per-plant costs (Node)
npx vite-node research/weed-vision-lab/scripts/two_stage_app_cost.ts
```

---

## 1. Technical audit: where the time goes today

### 1.1 The current pipeline

Simple mode's *Find weeds* (`SimpleWeedFinder.tsx` -> `startMapRun` in `src/lib/weedVision/frameRunStore.ts`):

1. **Plan**: the field is cut into 1536 px chunks of the orthomosaic at its deepest baked zoom (z23, 1.47 cm/px at 38° N,
   about 22.6 m), each read with a 96 px overlap (`mapRun.ts`).
2. **Image preparation (browser)**: 49 to 64 map tiles per chunk are fetched through the tile cache, drawn on a canvas,
   enlarged up to 2x (`upscaleFor`, toward the photographs' ~1 cm), and JPEG-encoded at q95.
3. **Rows**: the field's tree rows are read once from the map (`fieldRows.ts`), or each chunk's rows are read off-thread.
4. **Inference (service)**: the chunk is uploaded to the local Flask service, decoded, cut into 1024 px tiles with 256 px
   overlap, and each tile goes through `RFDETRSegLarge.predict`. The model resizes every tile to its **504 px** input.
5. **Instance-mask processing (service)**: per tile, every full-tile boolean mask is reduced to a box-local mask; masks
   from different tiles are fused; fused masks are painted into two dense label images; every instance then gets contours,
   a simplified polygon, max span, oriented box, convex hull and solidity (`extract_instances`).
6. **Coordinate transformation (browser)**: each instance whose centre is in the chunk's own square is placed by Web
   Mercator inverse (`groundMapResult`), polygon thinned to 40 vertices.
7. **Persistence**: one `scan_frame_detections` row per chunk with every detection as JSON (`frameRunCache.ts`).
8. **Clustering**: every 2 s during the run, all plants are re-merged, filtered to the boundary, re-tagged against the rows,
   and regrouped into 2 m review cells (`hotspots.ts`).
9. **Rendering**: below zoom 18 every plant is a dot on one canvas; from zoom 18 up to 1,500 outlines in view are drawn as
   react-leaflet polygons, each snapped onto the green under it in 8 ms background slices (`snap.ts`, `snapStore.ts`).

### 1.2 Measured: the service, one call

Steady-state run (second repetition after warm-up). "Map chunk" is a 1728 px crop of DJI_0301 shaped exactly as `mapRun.ts`
sends one; its content is at the photo's 0.99 cm/px, not the map's 1.47 cm/px, so its detection counts are illustrative.

| Stage | Photo DJI_0301, 5472x3648, 35 tiles | Map chunk, enlarged 2x, 1024 px tiles (today) |
|---|---|---|
| `model.predict` (network + rfdetr mask decode) | 4.79 s (55%) | 3.38 s (69%) |
| full-tile masks to box-local masks | 1.62 s (18%) | 0.65 s (13%) |
| contours + polygons | 1.36 s (16%) | 0.43 s (9%) |
| span, oriented box, hull | 0.71 s (8%) | 0.29 s (6%) |
| fusion + rasterise | 0.09 s (1%) | 0.04 s (1%) |
| **total in the service** | **8.76 s** | **4.89 s** |
| weeds / crop plants returned | 481 / 96 | 177 / 16 |
| result JSON | 1.07 MB | 0.32 MB |
| peak GPU memory / process working set | 487 MB / 2.08 GB | 452 MB / 2.08 GB |

Probes on 8 photo tiles: network forward alone 122 ms of 131 ms per `predict`; batch 4 gives 126 ms per tile (4%);
`include_source_image=False` and threshold 0.9 change nothing measurable. Frame decode 90 ms. Load 2.7 s, warm-up 2.6 s.

**Finding 1. About 45% of the photo path is Python post-processing, not the model.** The box-local step scans every
full 1024x1024 mask with `np.nonzero` although the model already returns a box; contours and shape measures are computed for
every instance whether anyone looks at it or not.

**Finding 2. The 2x enlargement buys nothing the model sees.** RF-DETR shrinks each 1024 px tile to 504 px, so an enlarged
chunk in 1024 px tiles and an unenlarged chunk in 512 px tiles give the model the same sampling and the same 25 tiles:

| Same chunk | Model px per chunk px | Tiles | Service time | Weeds | Upload |
|---|---|---|---|---|---|
| enlarged 2x, 1024 px tiles (today) | 0.98 | 25 | 4.89 s | 177 | 4.5 MB |
| 1x, 512 px tiles | 0.98 | 25 | 3.91 s (-20%) | 169 | 1.8 MB |
| 1x, 1024 px tiles | 0.49 | 4 | 1.09 s | 74 (-58%) | 1.8 MB |

The enlargement costs four times the mask pixels, browser resampling and a 2.5x larger upload. The last row shows
resolution does matter: halving the model's sampling loses more than half the weeds on this chunk.

**Finding 3. RF-DETR is GPU-only in practice.** On the CPU it takes **6.0 s per tile with 4 threads** and 8.6 s with 12
(oversubscribed), so about 3.5 min per photo and 2.5 min per map chunk.

### 1.3 Field-scale economics (estimated from the measurements)

A large field needs about 20 chunks per hectare at z23; a 1 ha square needs 36 because edge chunks count whole.

| Per hectare | GPU (RX 9060 XT) | CPU only, 4 threads |
|---|---|---|
| RF-DETR everywhere, today's map path | 1.6 to 2.9 min | 50 to 90 min |
| 10 ha field | 16 to 29 min | 8 to 15 h |

### 1.4 Measured: the app side (Node, synthetic instances, per-plant cost)

Synthetic instances shaped like the service's answer, at the upper density DJI_0301 suggests (about 9,800 plants per
hectare; the photo itself has about 3,000 per hectare at threshold 0.5).

| Step | 1 ha (9.8 k plants) | 10 ha (98 k plants) |
|---|---|---|
| coordinate transformation (`groundMapResult`) | 37 ms | 294 ms |
| boundary filter + hotspot grouping, **repeated every 2 s while a run goes** | 25 ms | 208 ms |
| JSON written to `scan_frame_detections` | **42 MB** | **423 MB** |
| snap compute per outline (plus its tile fetch and decode, not measured) | 0.38 ms | |

**Finding 4. Persistence is the scaling hazard, not compute.** Each plant is stored as about 4.3 KB of JSON: the
40-vertex outline twice (photo pixels and lat/lng) plus its metadata. That is 13 to 42 MB per hectare. A reload
(`loadFrameRuns`) downloads all of it before anything is drawn.

**Finding 5 (from the code, not measured in a browser).** `ModelDetectionLayer` recomputes from the whole session object,
so every progress tick re-filters every plant and redraws the dot canvas. With 100 k plants that is the likeliest source of
lag during a run. Rendering frame times, `fieldRows` read time on a real map, tile download time and Supabase latency for
large rows are **not measured**; a Chrome Performance recording during one *Find weeds* run would settle them.

### 1.5 What already exists for Stage 1 and Stage 2

- `hotspots.ts` already turns plants into 2 m cells, connected areas, a heat map and review priorities. It is the right
  output shape for Stage 1, but today it is computed **from** Stage 2: the full RF-DETR run must finish first.
- `fieldRows.ts` reads orchard tree rows from the map at about 4 cm, with its own vegetation mask. Not yet checked on the
  real map.
- The photo pass reads planting patterns for row crops; it mistakes weed strips for rows on orchards.
- `mapRun.ts` chunks, the service and its cache are reusable as the Stage 2 executor once it accepts a list of windows.
- ExG vegetation rules (TypeScript and Python), ERFNet (research-only, see 3.2) and onnxruntime-web (used by weed-v1) are in
  the codebase.

---

## 2. Stage 1 candidates: measured cost and a smoke check

### 2.1 Cost on the CPU (DJI_0301, 20 megapixels)

| Candidate | Processing scale | Time per photo, 4 threads | Per hectare at map sampling (estimated) |
|---|---|---|---|
| 1. ExG vegetation (rows not included) | full | 0.45 s | about 1 s |
| | quarter (about 4 cm/px) | 0.05 s | about 0.1 s |
| 2. ERFNet semantic, crop / weed / soil | full | 7.6 s | about 17 s |
| | half | 1.9 s | about 4 s |
| 3. Student-sized network (LR-ASPP MobileNetV3, 3.2 M parameters, untrained: cost only) | full, per 1024 px tile | 0.11 s | about 5 to 7 s |
| | per 512 px tile | 0.03 s | |
| Reference: RF-DETR per 1024 px tile | 504 px input | 6.0 s | 50 to 90 min |

Candidate 3's network is about 55 times cheaper per tile than RF-DETR on the CPU;
whether it can learn the task is unknown.

### 2.2 Smoke check: does the ranking point at weeds?

DJI_0301, 1 m cells. The question is how many of the cells holding at least one labelled weed fall inside the top-ranked
cells when only a share of the field is inspected. **Not a validation**: one frame of the development field, labels not
exhaustive (414 weed points in 311 cells), recall of labelled cells only, no precision or false-hotspot rate possible.

| Share of cells inspected | RF-DETR full detail | ExG, no rows, quarter scale | ERFNet P(weed) full | ERFNet half | Random |
|---|---|---|---|---|---|
| 10% | 0.28 | 0.01 | 0.07 | 0.05 | 0.13 |
| 20% | 0.60 | 0.06 | 0.22 | 0.19 | 0.23 |
| 30% | 0.70 | 0.21 | 0.44 | 0.37 | 0.34 |
| 50% | 0.78 | 0.59 | 0.75 | 0.68 | 0.52 |

What this shows, within those limits:

- In an orchard, raw greenness ranks **worse than random**: the greenest cells are tree canopy and the labelled weeds are in
  the alleys. A colour Stage 1 is meaningless here without the tree-row geometry. That is a hypothesis to test, not a result.
- ERFNet, trained on sugar beet, is close to random at the budgets that matter (10 to 20%). Trees are called weed.
- RF-DETR at full detail itself finds only 60% of labelled weed cells in its top 20% and 78% in its top half. A Stage 1 that
  copies RF-DETR inherits that ceiling. RF-DETR agreement must never be reported as recall.

---

## 3. The candidates assessed

### 3.1 Candidate 1: RGB vegetation + crop-row geometry

Off-row vegetation per 2 m cell = vegetation fraction minus what the row or tree geometry explains. Uncertainty from the
row read (no rows, low explained share, irregular spacing), shadow fraction, low vegetation contrast, and distance from
validated GSD.

- **For**: no training, so no learned domain to fall out of; about 0.1 to 1 s per hectare on the CPU, so it can run in the
  browser for every farmer, offline; failure is detectable (the row read says when it failed); the parts exist
  (`fieldRows.ts`, `vegetationMask`, `hotspots.ts`).
- **Against**: weeds inside the row are invisible to it; closed canopy, drilled or broadcast crops (wheat, hay, pasture)
  have no rows; green cover crops, residue, shadows and yellow-green seedlings (ExG-ExR failed on them in Phase 3) break
  the colour rule. It gives vegetation pressure, never species.
- **Expected failure cases to collect**: weeds in the crop row; tree drip lines; weed strips mistaken for rows (seen with
  the photo pass); headlands; late-season closed canopy; low-sun shadows.

### 3.2 Candidate 2: a small semantic network (crop / weed / background)

- **ERFNet** is the only one in hand. Its code derives from CC BY-NC sources and its checkpoint has no stated licence
  (`research/weed-vision-lab/docs/licensing-audit.md`). That makes it **research-only as a comparator**, regardless of
  accuracy, and the smoke check gives no reason to fight for it.
- A permissively licensed small network (LR-ASPP or DeepLabV3 on MobileNetV3, BSD-3 in torchvision) trained on public
  crop/weed data inherits the same domain gap as RF-DETR (sugar beet, close range, no trees). In practice this candidate
  only becomes useful once it is trained on Swardus fields, and then it **is** candidate 3.

### 3.3 Candidate 3: a lightweight student from audited RF-DETR predictions + human corrections

- **For**: the cheapest learned option at inference (0.03 s per 512 px tile on 4 CPU threads; ONNX in the browser is
  plausible); it can learn the field's context (trees, tracks, rows) that colour cannot.
- **Against**: RF-DETR's errors become its labels: trees called weed about half the time, tiny weeds rarely found, seam cuts.
  Correcting that needs human labels on many independent fields, the scarcest resource here. Leakage is easy: overlapping
  photos and the orthomosaic share pixels, and re-flights share the seed bank.
- **Verdict**: the most promising long-term Stage 1, and the most expensive to make honest. Train it only after the
  evaluation harness exists and candidate 1 has shown where geometry fails.

---

## 4. Proposed two-stage design

**Stage 1 (CPU, whole field)**: a 2 m cell grid on the orthomosaic with, per cell, a weed-pressure estimate (off-row
vegetation fraction, later the student's coverage), an uncertainty with its reasons, and a validity flag. Hotspot candidates
are connected cells above a pressure threshold, as `hotspots.ts` groups them today. No per-plant polygons.

**Stage 2 (RF-DETR, selectively)** runs on map windows covering:

1. every hotspot candidate, ranked by priority;
2. every uncertain cell (no rows, shadow, out-of-envelope);
3. a **random audit**: a spatially stratified sample of the remaining cells (for example 5%, at least 30 cells, one draw per
   20 m block), drawn with a recorded seed.

Windows are merged into chunk-sized requests so the GPU stays busy. The audit result is reported as it is: *"RF-DETR found
weeds in k of n randomly checked cells outside the flagged areas (x%, 95% interval a to b%)"*. That measures disagreement
with RF-DETR, not true misses. If the audit's miss share passes a threshold, the field is shown as uncertain and the
inspection widens.

**Cost**: Stage 2 time scales with the inspected share. At 20% inspected, the GPU work is about a fifth of today's (about
20 to 35 s per hectare). In a very weedy field the share can approach 100% and two-stage saves little; the share is measured
per field and shown.

**When a field is outside validated conditions** (GSD, sun elevation, shadow fraction, soil colour, vegetation fraction, row
read, operator-entered crop and growth stage outside the hold-out fields where the method passed), the map shows *"Uncertain:
outside validated conditions (reason)"* and the candidate areas, never a weed map.

---

## 5. Benchmark plan

### 5.1 Data and leakage rules

- **Unit of independence: the field.** Every frame of a field, the orthomosaic made from them, and every re-flight of
  the same field belong to one split. No random tile or image splits.
- **Development field**: the current orchard (DJI_0301 and its map). It is used to build and tune, and never to report.
- **Minimum go/no-go set: 6 hold-out fields**, chosen before any tuning: 2 orchards or vineyards, 2 wide-row crops
  (corn, soybean), 1 drilled small grain, 1 pasture or hay. On at least 3 of them, fly two altitudes (about 1 and 3 cm/px);
  on at least 2, two lighting conditions (high sun and low sun or overcast). Record soil type and colour (Piedmont red
  clay, dark loam, no-till residue). Claims across crops need about 12 fields.
- **Thresholds are frozen** on the development field and declared before scoring a hold-out field. A threshold changed
  after seeing a hold-out field moves that field to development.
- **Student model**: pseudo-labels and corrections only from training fields; evaluation only against human labels on
  hold-out fields; never RF-DETR as truth.

### 5.2 Labels: cells, not plants

The deliverable is pressure, so the labels are cells. Per hold-out field: 200 cells of 2 m, drawn at random and labelled
blind (no model overlay, as `annotate.html` already enforces), each with a coverage class (0, under 1%, 1 to 5%, 5 to 25%,
over 25%) and "high-priority patch: yes / no"; plus the outline of every patch the operator knows of. Double-label 10% of
cells to measure agreement. This is far cheaper than plant masks and matches what is reported.

### 5.3 Metrics (per field, then the median and worst field)

| Metric | Definition |
|---|---|
| High-priority hotspot recall (primary) | share of truth high-priority patches (coverage over 25% or area over 25 m², fixed in advance) touched by a flagged area; Wilson 95% interval |
| Hotspot recall | the same for every truth patch (coverage 5% or more, area 4 m² or more) |
| False hotspot rate | flagged areas with under 1% labelled coverage, over flagged areas; plus the flagged share of the field |
| Recall at a review budget | the curve of 2.2, at 10, 20 and 30% of the area |
| Coverage error | per-cell mean absolute error in percentage points; field-level bias of total weed cover |
| Uncertainty calibration | error rate per uncertainty bin; uncertain cells must be the wrong ones |
| Audit agreement | Stage 2 random-audit positive share versus the human labels of the same cells |
| Cost | time per hectare on GPU and on 4 CPU threads, peak memory, bytes stored per hectare |
| Weighted loss | 10 per missed high-priority patch, 2 per other missed patch, 1 per false hotspot; the operating point is chosen on the development field and frozen |

Failure cases are kept as a gallery per field: every missed high-priority patch and the 10 worst false hotspots.

### 5.4 Comparisons, in order

- **E0**: RF-DETR everywhere on each field. The reference for cost and for "agreement", never for truth.
- **E1**: candidate 1 with row geometry and the Stage 2 router, on the same fields.
- **E2**: the student, only if E1 fails a crop type it should cover.
- ERFNet runs alongside as a research comparator only.

### 5.5 Go/no-go for candidate 1

On the hold-out fields with readable rows: high-priority recall of at least 0.9 against the human labels, with Stage 2 GPU
time at most 40% of E0's. Fields without rows must show "uncertain", not a map. If it passes there and fails on drilled
crops, that failure is where the student is worth training.

---

## 6. Recommendation: the smallest meaningful prototype

**Candidate 1 plus the router, offline, scored by a cell-level harness.** Concretely:

1. A script, not app code, that takes a scan's map and boundary, reads the rows with `fieldRows.ts`, and writes a 2 m grid
   of off-row vegetation fraction with uncertainty reasons.
2. A router that picks the hotspot, uncertain and 5% random-audit cells and runs RF-DETR on those windows only, through the
   existing service.
3. A scorer that compares the result with E0 on the same map and with human cell labels: the development orchard first,
   then at least 2 independent fields as soon as they are flown and labelled.

Why this one: it needs no training and no new model; it reuses the row reader, the hotspot grid, the map chunks and the
service; it answers the two questions that decide everything else (does geometry rescue colour, and how much GPU does
routing save without losing high-priority patches); and the harness, the audit and the labels carry over unchanged to the
student. The smoke check says the first question is open: without geometry, colour points at the trees.

**Blocking input**: labelled independent fields. Without them the prototype can report cost and agreement with RF-DETR,
and nothing about accuracy.

### Independent quick wins on today's path (shares measured, savings not yet measured after a change)

1. Send map chunks at 1x with 512 px tiles: -20% service time, -60% upload, same model sampling.
2. Build box-local masks from the model's boxes instead of scanning full-tile masks: 18% of photo time.
3. Compute polygons and shape measures only for instances that will be shown or inspected: 25% of photo time.
4. Store compact records (centre, area, score, class, a ring of at most 12 points) or per-cell aggregates: today 4.3 KB per
   plant, 13 to 42 MB per hectare.
5. Make the map layer depend on the plants, not the whole session, so progress ticks stop redrawing every dot (to confirm
   with a browser profile).
6. On CPU, run RF-DETR with 4 threads, not 12 (6.0 s against 8.6 s per tile). Batching is not worth it (4%).

---

## 7. Built on 2026-10-19 (after approval)

### 7.1 Quick wins, measured before and after (same inputs, same machine)

| Service time | Before | After |
|---|---|---|
| Photo DJI_0301 (photo runs now ask for lite geometry) | 8.76 s | 6.52 s (-26%) |
| Box-local mask step inside it | 1.62 s | 0.05 s |
| Map chunk as the app sends it (was enlarged 2x, now 1x with shrunk tiles, lite) | 4.89 s, 4.5 MB upload | 3.55 s (-27%), 1.8 MB |

Detections are identical on the photo (481 weeds, 96 crop plants). On the map chunk the count went from 177 to 169
because the tile seams fall in different places; whether either is closer to the truth is not known.
The remaining post-processing cost is the contours (1.5 s per photo); outlines are still drawn for every weed.

What changed: `rfdetr.py` (extents from row and column projections), `instances.py` (`geometry=lite`), `mapRun.ts`
(`mapTiling`: same model sampling, no enlargement), `frameRunCache.ts` (`compactDetection`: map plants stored without the
chunk-pixel outline, coordinates rounded to about 1 cm), `ModelDetectionLayer.tsx` (keyed on the plants, stable click
handler), RF-DETR on CPU with the service's thread count. Old saved runs stay readable; a map run at today's settings
gets a new cache key and runs once more.

### 7.2 The prototype

Built inside the app rather than as a script: the map tiles, the row reader and the model service only meet in the
browser. Weed Scout > Show all options > "Two-stage weed pressure (prototype)". Code in `src/lib/weedVision/twoStage/`
(stage1, router, score, twoStageStore), `TwoStagePanel.tsx`, `TwoStageLayer.tsx`; tests in
`src/test/weedVisionTwoStage.test.ts` (a synthetic orchard).

One design correction found while testing: a cell that is mostly crop row is described as such but no longer sends its
window to the model. Weeds inside the row band are set aside as the crop whoever finds them, and in the synthetic orchard
that reason alone routed every window.

### 7.3 Still owed

- One real run on the orchard map: Stage 1, the routed inspection, then the reference, to see the real inspected share
  and the agreement figures.
- Blind cell labels: at least 30 on the orchard (200 per field is the plan), then the hold-out fields of section 5.1.
  Labels live in the browser until exported.
- Browser timings for Stage 1 and the layers on a real field; the synthetic field (40 m) read in about 0.25 s in tests.
