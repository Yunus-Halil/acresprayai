# Photo ground: the original photographs under a Field Twin (experiment, 2026-11-14)

**Status:** branch `experiment/photo-ground`, local only.
- Not merged, not pushed, not deployed.
- The dev preview (`/dev/field-twin`) is the only place it shows.
- Nothing about the normal build changed: the build code and the twin format are untouched on this branch.

The plan comes from [field-twin-visual-research-2026-11-14.md](field-twin-visual-research-2026-11-14.md), section 10.

## What it is

The flight's original RGB photographs are laid on the twin's ground through the cameras the build already solves.

**How each ground point is drawn:**
- It comes from the photograph whose nadir is nearest, among those whose footprint holds the point.
- Within 0.6 m of the next photograph's nadir distance it is blended linearly with that photograph.
- Colour is scaled by one gain per photograph and channel. The gains are solved from the overlaps, in log space with a prior towards 1 (Brown and Lowe's gain compensation).

**What it is honestly:**
- This is orthorectification onto the build's flat ground plane. No surface model, no dense matching, no ODM.
- Anything that stands up leans.
- No pixel is invented. Ground no photograph holds keeps the background colour.

**Two tiers, built and timed separately:**

| Tier | Source | Resolution | Role |
|---|---|---|---|
| Overview | each photograph's own camera preview, the MPF image the build already reads (a quarter decode when the file has none) | the finest zoom with pixels at least 3 cm and no finer than the preview's | always there, small |
| Detail | the full photographs, each decoded once and adding its share to the tiles it shows | the finest zoom no finer than 0.7× the camera pixel, plus one coarser zoom | from that zoom on, over the overview |

**Provenance.** `pg/ground.json` records the rule, every photograph's nadir and its gains, so any pixel traces to the photograph it came from.

**Code:**
- `src/lib/fieldTwin/photoGround.ts` (pure)
- `scripts/directGeoref/photoGround.ts` (tiers and timings)
- `scripts/directGeoref/photoGroundCheck.ts` (alignment)
- Dev serving in `vite.config.ts`
- `TwinMap` underlay
- `FieldTwinDevPreview` option
- In `TwinCanvasLayer`, over photographs up close: rows thin and translucent, plants as rings, so the seedlings under them show.

## Fields

All five local twins were used.

| Field | Photographs | Ground | Camera pixel | Cameras |
|---|---|---|---|---|
| Private corn flight (independent grower, M3M, V1–V2, dark seedlings) | 123 | 0.89 ha | 0.58 cm | the build's own (analysis record) |
| Day015 / Day023 / Day045 (UAV3DCrop test flights) | 40 each | 0.02–0.026 ha | 0.15–0.18 cm | aligned here as the build does (header only, 0 soil ties) |
| Apricot orchard (P4RTK) | 71 | 2.77 ha | 0.96 cm | aligned here as the build does (soil ties) |

## Results

### Times

Node, one thread, pure-JS JPEG (jpeg-js), so Chrome's decoder and a worker pool would be faster. Neither was measured.

| | Private corn | Apricot | Day023 |
|---|---|---|---|
| **Geometry ready (the build, unchanged; earlier measurements)** | 668 s Node (never built in a browser) | 21 s Chrome | 64 s Chrome |
| Overview: render + encode + gains + pyramid (the added work) | **6.5 s** | **4.4 s** | **0.6 s** |
| Overview: preview decodes (the build's photographs stage already does these) | 5.5 s | in camera read | in camera read |
| Detail: render + encode + pyramid (the added work) | **93 s** | **178 s** | 50 s |
| Detail: full decodes, one per photograph (the corn stage / atlas pass already decode these in the build) | 87 s | 62 s | 25 s |
| Seam measurement (not part of either tier) | 73 s | 59 s | 6 s |

**Conclusions on time:**
- **The overview fits inside a build.** It adds seconds to the existing stages (6.5 s on the hardest flight, in Node).
- **The detail tier does not fit inside a build.** It is minutes in Node. It must run after the twin is open, in the background, or the decodes must be shared with the corn stage.
- Neither tier delays geometry: the twin opens first either way.

### Storage

| | Overview | Detail |
|---|---|---|
| Private corn | 4.3 MB (**4.8 MB/ha**), 3.2 cm | 50.8 MB (**57 MB/ha**), 0.8 cm |
| Apricot | 4.0 MB (**1.5 MB/ha**), 6.2 cm | 191 MB (**69 MB/ha**), 0.78 cm |
| Day015 / 023 / 045 | 0.24–0.32 MB, 2.9 cm | 22–31 MB (about 1.1 GB/ha at 0.18 cm, because the cameras flew at 6 m) |

All tiles are JPEG q82, 256 px. MB/ha is over the photographed ground.

### In the browser

Chrome headless at 1440×900, local dev server, cache off, median of 3.

| | Private corn | Apricot | Day023 |
|---|---|---|---|
| Geometry ready (first frame, from navigation) | 0.26–0.39 s | 0.36–0.41 s | 0.22–0.25 s |
| Overview complete for the field view (from navigation) | 0.3–0.4 s | 0.40–0.45 s | 0.25–0.28 s |
| Field view, bytes | 252 KB | 250 KB | 168 KB |
| Close-up at detail zoom, bytes | 712 KB | 692 KB | 616 KB |
| JS heap | 31–35 MB | 56 MB | 24 MB |
| Pan frame / canvas draw | 10–16 ms / < 1 ms | 14–15 ms / < 1 ms | 11 ms / < 1 ms |

A local server says nothing about a rural link. At 5 Mbit/s the field view's 250 KB is about 0.4 s and a close-up about 1.1 s (calculated).

### Seams

The same ground is drawn from the two photographs either side of a seam. Their offset is measured by normalised cross-correlation at about 1.5 cm pixels, searching ±24 cm, coarse to fine.

| | Samples | Median | 90th percentile | Max | At the search edge |
|---|---|---|---|---|---|
| Private corn (soil ties, residual 6.3 cm) | 103 | **5.2 cm** | 12.9 cm | 30 cm | 2 |
| Apricot (soil ties; 2–4 m trees) | 63 | **5.5 cm** | 16.6 cm | 41 cm | 5 |
| Day015 / Day023 (header only) | 4 / 4 | 1.5 / 9.9 cm | — | — | 0 |
| Day045 | 0 | (no seam sample correlated) | | | |

- On ground with soil ties, seams agree at about the cameras' own accuracy.
- The orchard's tail is the trees' lean, as predicted.
- Gains ranged 0.80–1.17 on the private flight and 0.63–2.0 on the apricot, whose exposure varied.

### Do the twin's plants and rows sit on the plants in the imagery?

Read from the detail tiles:
- **Vegetation:** a pixel whose excess-green chroma is 0.03 above its tile's median.
- **A hit:** 20 % or more vegetation within 3 cm.
- **Control:** the same points moved half a row spacing across the rows, measured from the rows' own lines.

| | Twin's points on vegetation | Control (between the rows) |
|---|---|---|
| Private corn: certain plants (6,913 sampled) | **72.6 %** | 2.8 % |
| Private corn: confirmed row lines | **51.4 %** | 3.4 % |
| Day015 rows | **87 %** | 4.5 % |
| Day023 rows | **87 %** | 6.4 % |
| Day045 rows (canopy closing) | **96 %** | 28 % |

- **No systematic offset.** On the private flight, shifting the dots by up to ±10 cm in 2 cm steps finds the best fit at **0, 0**.
- **Misses are visible.** Of the vegetation within 5 cm of the private flight's confirmed rows, **65.5 % is more than 4 cm from any plant the twin located.** That green on the row has no dot: missed seedlings, or weeds on the row. This agrees with the roughly 50 % of plants located, and it is now visible in the imagery.

## What it looks like

Screenshots are in the session's scratchpad, not in the repo. The private flight's images are never committed.
- **Private corn, field view:** the field is recognisable: tracks, headland, the vehicle.
- **Private corn, close-up:** the seedlings show under thin rows with ringed plants, and stretches of seedlings with no ring are visible.
- **Day023:** the cyan rows sit on the real corn rows.
- **Apricot, close-up:** the weed outlines sit on the green patches and the crown circles on the trunks; long tree shadows are visible.

## Problems found and fixed during the experiment

1. **Straight seams along tile edges.** Each tile first kept its four nearest photographs, so neighbours chose differently. Now every photograph that can be the nearest anywhere in the tile (centre distance within the nearest's plus the tile diagonal plus the band) is a candidate.
2. **A ring of smeared imagery far outside the field.** Beyond its frame the lens model's distortion polynomial folds back, so far ground mapped into the picture. A ground point now belongs to a photograph only inside that photograph's own footprint.
3. **The alignment control shifted along the rows, not across them, on some fields.** That was a bug in the check, not the data: stored row directions are consistently counterclockwise from east. Across is now measured from the rows' lines.

## Limits

- **Flat plane.** Tall crops and trees lean: about 0.23 × height with nearest-nadir selection. Field relief is not modelled.
- **Header-only placement** (the test flights) gives seams of about 10 cm. Any flight without soil ties will look worse.
- **Detail encode.** Detail-tier storage is the dominant cost (57–69 MB/ha at 0.8 cm). Tiles are JPEG only; WebP would be about 25–34 % smaller (not tested).
- **The "unlocated" share counts weeds on the row too.** It is not a measured recall.
- **Not in production.**
  - Imagery is never uploaded.
  - The overview is not written by the in-browser build.
  - Participants never see it.
  - Storing growers' photographs needs a terms check.
- **Legend mismatch.** Over photographs the certain plants are drawn as rings, but the legend still shows the filled dot (experiment only).

## Recommended production architecture

1. **Overview inside the build** (seconds):
   - Written from the previews the photographs stage already holds, gains included.
   - Stored beside `twin.json` as a small tile set: 1.5–5 MB/ha measured.
   - Shown to everyone by default under the twin.
   - It makes the field recognisable and is the evidence the twin is drawn over.
2. **Detail after the twin opens:**
   - Cut in the background from each photograph while its full decode exists: during the corn stage for corn, the atlas pass for orchards.
   - Uploaded resumably and optionally on metered links: 57–69 MB/ha measured.
   - Fetched per view, about 0.7 MB for a close-up.
   - The twin and its findings never wait for it.
3. **Imagery-aware drawing:**
   - Over photographs, up close, the marks step back: thin rows, plants as rings.
   - "Not photographed" stays the background.
4. **Later:**
   - Per-photograph crops warped live in WebGL instead of pre-cut tiles. This removes the resampling and lets a user step through every photograph of a spot.
   - Seams routed through soil, for orchards.
5. **Before any of it:**
   - Your eye test of these screenshots and the dev preview.
   - The terms question on storing photographs.
