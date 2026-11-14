# Field Twin: visual research and feasibility (2026-11-14)

This is research only. No code, model or data was changed, and nothing below is built.

The code was read at main `60398a7` (Corn plants first). The datasets used:
- the private corn flight from an outside grower: 123 DJI M3M photographs at 0.59 cm/px, V1-V2 seedlings, rows at 0.92 m. It is described anonymously because its imagery is never committed.
- three public UAV3DCrop corn test flights (Day015, Day023, Day045; 40 photographs each at 0.17 cm/px)
- the apricot orchard: 71 P4RTK photographs at 0.97 cm/px

**Labels used throughout**
- **[V]** verified in code, in stored outputs, or by measurement.
- **[H]** hypothesis, reasoned but not measured.
- **[S]** speculative.
- External claims carry their source.

---

## Summary

1. **What makes the twin look like CAD.** Most of it is presentation (my judgement from the trace below), and that can change today without new data. The rest is missing data.
   - *Presentation* [V]:
     - neon colours chosen to stand out over photographs, drawn on flat charcoal
     - widths in screen pixels rather than metres
     - five dash patterns used as the certainty code
     - every uncertain layer on by default at every detail stop
     - grey crosses for 40 % of all plant dots
     - each row drawn as many separate stubs
   - *Missing data* [V]:
     - **in production there is no imagery under the geometry**
     - plants are bare points with no size or footprint
     - the saved twin keeps no cameras, so photographs cannot be projected in the viewer.
2. **The fragmentation on the private corn twin is mostly representation, not detection.** It has 108 field rows (median 26.5 m, longest 138.5 m), stored and drawn as 1,158 alternating confirmed and unconfirmed stretches (median 2.9 m). The parent row is thrown away in the bundle. [V]
   - Detection limits are real and separate. Only about half the plants are located (3.4 per metre located against ~7 expected), and frame edges are soft. They are not what makes the picture look broken. [V/H]
3. **Seeing the field as a photograph needs no orthomosaic stage, but done honestly it *is* orthorectification onto a flat ground plane.** [V/external]
   - The cameras Swardus already solves can lay each photograph on the ground. Choosing, for each ground point, the photograph whose nadir is closest bounds the lean of anything standing above the ground to about 0.23 × its height, whatever the altitude.
     - Seedling corn: 1-6 cm, below the cameras' own 7.5 cm held-out residual. Honestly ortho-equivalent there.
     - Tasselled corn: about 0.6 m.
     - A 4 m tree: about 1 m. Not ortho-equivalent; crowns double or cut at seams.
   - So the photo layer is fine for early row crops. For tall crops it must carry a stated lean, and later have seams routed through soil.
4. **Nearly all the parts already exist.**
   - The build already finds the nearest-nadir photograph for every ground cell (the evidence raster, `bundle.ts:evidenceAndBoundary`). For corn it then throws the result away.
   - The corn stage already decodes every photograph at full size.
   - A dev-only script already cuts the photographs into map tiles through the build's cameras (`scripts/directGeoref/twinReferenceTiles.ts`): 65 MB, 249 s in Node for the 123-photo flight.
   - The viewer already has a tile layer and a swipe for it.
   - What is missing is a production path: the build writes the imagery, it is stored, and the viewer shows it.
5. **Recommendation:** a hybrid twin, *photographs first, measurements on top, evidence one tap away.* In order:
   - **(a)** honesty and representation fixes that need no new data
   - **(b)** a photo ground layer in two tiers:
     - a small whole-field image written into the twin
     - full-detail tiles uploaded in the background, loaded per view
   - **(c)** an evidence lens. Tap any plant, row, gap or weed to see every original photograph that saw it, with the object projected into each.
   - **(d)** stand composition along each row.
   - Plant sprites, procedural canopy and 3D are not recommended now (section 3).
6. **First experiment.** Dev only and fully reversible. Generate both photo tiers for the five local twins from the existing analysis records and cameras, and measure:
   - build time added
   - bytes per hectare
   - seam disagreement
   - whether plant dots sit on plants in the rendered imagery
   - then show them under a quieter "field" style in the dev preview for your eye test (section 10).

---

## 1. How the Field Twin works today

### 1.1 Pipeline, photographs to saved twin [V]

`src/lib/fieldTwin/build/pipeline.ts:166-255` runs the stages in this order:

| Stage | What happens | Code |
|---|---|---|
| Headers | The first 1 MB of each file is read: DJI XMP gives lat/lng, RelativeAltitude, gimbal yaw/pitch/roll and DewarpData. A photograph is refused if any of these are missing. | `browserPhotos.ts:11`, `photos.ts:41-44`, `directGeoref/frame.ts:37-101` |
| Photographs | Reads the camera's own MPF preview, not the full image: 960×640 on the P4, 960×720 on the M3M, about 250 KB. It gives a grey raster and a green mask per photo; the fallback is a quarter decode. | `mpf.ts`, `photos.ts:25-54` |
| Cameras | Soil-texture phase-correlation ties between photos whose centres are within 45 m, coarse then fine. Then a Levenberg-Marquardt fit with Huber weights: 4 global terms, then per-photo dE/dN (3 cm prior), yaw and tilts (1° prior). The ground is a **flat plane** at take-off height plus a fitted offset; a terrain grid exists but is unused. Lens model: DJI DewarpData Brown k1-k3 p1 p2 when present. | `cameras.ts:136-184`, `soilTies.ts`, `adjust.ts`, `projection.ts:111-191` |
| Corn | Each photograph is decoded at **full size** (84 MB RGBA; at most 3 at once). Corn V1 reads rows and plants per photo. `cornField` builds lattice rows; `cornPlantsFirst` projects every plant sighting, registers photos to each other (offset votes, 5 rounds) and merges sightings into one dot per plant (at least 2 photos). Rows are then drawn through the plants. | `build/corn.ts`, `cornField.ts`, `cornPlants.ts:134-173`, `plantsFirst.ts` |
| Orchard | Trees and rows from the preview rasters; weeds (colour tier or model). | `build/rows.ts`, `build/weeds.ts` |
| Bundle | The twin JSON, plus evidence crops: 112 px squares from the full-size original, packed 18×18 into 2016 px `atlas-N.jpg` at q0.72. | `bundle.ts` |
| Evidence and boundary | Samples a classified ground raster (0.25 m cells, nearest-nadir photo per cell, from the preview pixels), then infers the cultivated block. **For corn, the block inference finds no "reliable rows" (they need 4 or more trees), so the raster is discarded and `boundary` is null.** | `bundle.ts:330-412`, `boundary.ts:105, 573` |

### 1.2 Camera accuracy [V]
- **Apricot, held out:**
  - header only: 2.09 m
  - 4 global terms: 0.50 m
  - full model: 0.07 m (90th percentile 0.17 m)
  - The preview and the quarter decode give the same result (7.5 cm). Source: `docs/features/direct-photo-georeferencing-experiments.md`, speed plan.
- **Private corn flight:** 69,384 ties, header residual 0.59 m, fitted residual 0.063 m (training only; no hold-out run).
- **Public test flights:** no ties (no EXIF; poses from the dataset), so "local" placement.

### 1.3 What a stored corn twin contains [V]

`types.ts:150-197` defines `TwinBundle` and `TwinCorn`.

- **Plants:** parallel arrays `points` (lat/lng), `certainty`, and `photos`, which is a **count**, not ids.
  - Certainty classes:
    - 0 = certain on a row (≥3 photos and ≥30 % of the photos covering it)
    - 1 = probable (on a certain row at a whole number of seed spacings)
    - 2 = seen, on no row
    - 3 = between two rows, not the crop
  - No size, footprint, colour, photo ids, pixel positions, spread or reason.
- **Rows:** `{status corn|unconfirmed, line, lengthM, seenBy, cornBy, coveredBy, why}`.
  - In plants-first builds each *stretch* is stored as a row.
  - **The parent row id is lost** (it survives only inside the `why` text).
  - `seenBy`, `cornBy` and `coveredBy` are written as 0 (`bundle.ts:169`).
- **Gaps:** cornField gaps exist only when the lattice fallback is used. With plants-first rows `gaps` is `[]` (`bundle.ts:181`), and the notes say so.
- **Weeds:** position, area (no outline), votes, the photos' names, and evidence crops.
- **Coverage:** `footprints`, four corners per photograph. There is no "seen by 2 or more" polygon for corn.
- **Cameras:** only summary statistics. **There are no per-photo poses or intrinsics in the twin.**
  - The separate `analysis.json.gz` record keeps full frames (pose, Brown distortion, boresight, ground height), every per-photo read, sightings and crop sources.
  - The viewer never reads it, and it exists only for the founder and for participants on approved terms (`analysis.ts`, `analysisAccess.ts`).
- **Thrown away after the build:**
  - every pixel except the evidence crops
  - masks, ties, per-photo poses (in the twin)
  - the plant registration shifts
  - the plant-to-photo membership
  - the corn evidence raster

### 1.4 The viewer [V]
- **Map and canvas.**
  - Leaflet 1.9 with one custom `L.Canvas` (`TwinCanvasLayer.ts:83`, `_draw` replaced at :385). Canvas 2D only, no WebGL; `three` is installed but unused.
  - Geometry is pre-projected once into zoom-0 Web Mercator typed arrays with a 4 m grid index (`scene.ts`).
  - Redraws happen on move or zoom end.
- **Base.**
  - Charcoal `#171a18`, with OpenStreetMap at 22 % opacity fading out as you zoom.
  - None at all on "local" twins (the public test flights).
- **Corn layer** (`drawCorn`, `TwinCanvasLayer.ts:686-806`; colours `style.ts:149-161`):

| Element | Look | Meaning | Default |
|---|---|---|---|
| Corn row | cyan `#00e6ff`, solid, 1.5-6 px | stretch with plants seen along it | on |
| Unconfirmed row | amber `#ffbe00`, dash 7/5 | "row probably continues, no plant confirmed" (plants-first), or a planted row whose crop is unconfirmed (lattice) | **on at every detail stop** (`cornUncertain: true` in the shared preset, `style.ts:65`) |
| Plant 0 / 1 | pale lavender dot / ring, 1.4-4 px | certain / probable | on from 12 px per metre |
| Plant 2 / 3 | grey dot / grey X | on no row / between rows | on from 12 px per metre |
| Weed | confirmed red disc, unconfirmed grey dashed, contested violet dashed; equal-area circle, minimum 3-4 px | | on |
| Gap | orange solid / grey dashed | confirmed / withheld | on (none in plants-first builds) |
| Photographed hull | dark fill + **hatch over the whole hull** | see 2.2 | on |

- **Detail.** Corn ignores the Detail dial except for vegetation. Plant markers depend only on px per metre.
- **Evidence.**
  - Tapping a corn weed or gap shows 1-2 original-photo crops from the atlases (`EvidenceCrop.tsx`).
  - **Rows and plants have no evidence, and plants cannot be tapped** (`pickAt`, :955).
- **Imagery under the twin:**
  - **(a)** The dev-only photograph tiles (`twinReferenceTiles.ts`), served by a Vite dev middleware and shown only at `/dev/field-twin`.
  - **(b)** The founder-only ODM scan reference on `/app/field-twin`, which a Direct twin normally has no scan for.
  - **Participants never see imagery.**
- **Performance.**
  - Apricot draws in 0.3-1.6 ms; pans median 11 ms; opens in 491 ms (twin.json 8.7 MB plain / 1.7 MB gzip).
  - Synthetic 1M observations: ready in 4.7 s, field draw 95 ms, heap 697 MB.
  - Corn rows and gaps are looped in full every frame with no viewport cull (`:725-733, :785-790`), a small fix.
- **Mobile.**
  - Below 820 px the panels fold into a bottom sheet.
  - The left column (272 px) and mini-map are fixed.
  - Touch uses Leaflet's defaults.

### 1.5 Bottlenecks [V, quoted]

| Build | Time | Where it goes |
|---|---|---|
| Apricot, Chrome with 6 helpers | **21 s** to the twin, atlases done at 24 s | cameras 9.2 s |
| Corn Day023 (40 photos), Chrome | **64 s** | corn stage 57 s (4.1 s per photo per worker); peak 2.7 GB |
| Private 123-photo corn flight, Node | **668 s** | cameras 209 s, corn 438 s |

- The private flight's build has **never been run in a browser**.
- The evidence raster on that flight took 0.4 s (`report.json`).
- **I found no recorded ~15-second build.** The nearest is the 21 s apricot build in Chrome. Treat 15 s as a target, not a measured fact.

---

## 2. Why it looks the way it does

### 2.1 Presentation, which can change without new data [V]
1. **Colours meant for photographs on a charcoal ground.** The corn colours are "the Photo Scout colours" (`style.ts:149`): saturated cyan, amber, red and violet chosen to stand out over a photograph. On `#171a18` they read as neon linework.
2. **Pixel widths.** Rows are 1.5-6 px whatever the zoom, plants 1.4-4 px dots, edges 1 px. A 15 cm seedling at 160 px/m is about 24 px across but is drawn as an 8 px dot.
3. **Dashes carry certainty in five different patterns** (rows, weeds, gaps, boundary support, footprints).
4. **Uncertain layers on by default.** On the private flight's plants-first twin: 528 cyan stretches against 630 amber dashed ones, plus 13,818 grey crosses (40 % of dots) up close.
5. **Stretches drawn as separate rows.** 108 field rows appear as 1,158 stubs alternating solid and dashed (median 2.9 m), which reads as broken geometry. This is mainly a data-shape choice (parent row discarded, `bundle.ts:169`).

### 2.2 Honesty defects found [V]
- **"Not observed" is wrong.**
  - The hatch fills the whole photographed hull (`TwinCanvasLayer.ts:413-415`, clipped to the hull, not to unseen ground). The block fill then covers only the block.
  - So **photographed ground outside the block is labelled "not observed"** in the key (`FieldTwinView.tsx:576`).
  - The hull is convex, so real holes in coverage are never shown as such.
- **"Held by 0 of the 0 photographs."** Plants-first stretches are written with zero counts (`bundle.ts:169`), and the row inspector and list print those zeros (`CornPanels.tsx:37, 204`).
- **No legend for plants.**
  - Participants see dots, rings, grey dots and crosses with no key entry; the explanation is in the founder-only Correct rows panel (`FieldTwinView.tsx:411, 566`).
  - "Between rows, not the crop" drawn as an X at 40 % of all dots is easily read as "dead plant".
- **Rows count stretches.** The panel's "N rows" counts stretches, not rows.
- **Plant dots and footprints are in slightly different frames.** The plants-first registration moves each photograph's plants (mean kept at zero) but the shifts are not stored. Footprints, weeds and any projected imagery use the unshifted cameras. The size of this difference is not measured. [H: centimetres, within the residual]

### 2.3 Missing data, which styling cannot fix [V]
- **No imagery in production.** Nothing is uploaded from a Direct build except evidence crops.
- **No per-plant size or footprint.** The green pieces exist during the read (`greenPoints.ts`) and are reduced to centroids.
- **No cameras in the twin.** Projecting photos in the viewer, or projecting objects back into photos, needs the analysis record or a new `frames` section.
- **No continuous stand signal along a row**, and no gaps from plants-first rows.
- **No corn cultivated block, and no "seen by 2 or more" coverage for corn.**
- **Local (test) twins have no place on Earth,** so they can never have a basemap. Their own photographs are the only possible ground.

### 2.4 Clean against fragmented reconstructions [V]

| Twin | Rows | Mean row | Unconfirmed share | Median photos holding a confirmed row |
|---|---|---|---|---|
| Day015 | 16 | 13.3 m | 15 % | 100 % |
| Day023 | 17 | 11.8 m | 17 % | 97 % |
| Day045 | 25 | 11.7 m | 42 % | 64 % |
| Private, as shipped | 111 | 18.9 m | 96 % | 86 % (unconfirmed rows 2 of 19) |
| Private, dark rule | 265 | 17.2 m | 33 % | 89 % |
| Private, plants first | 108 rows / 1,158 stretches | 51.5 m per row | 35 % | not stored |

- **The public flights look clean** because each block is tiny (about 0.02 ha, 15-19 m rows seen by nearly every photograph), the pixel is 3.5× finer, and the shipped read already sees those plants.
- **The private flight's cleanliness problem has four separate causes:**
  - dark seedlings: fixed by the dark rule; located plants per photo 149 → 1,737
  - soft frame edges: 96 % of row length was in the middle three-fifths of the frame
  - a read share of 0.57, which also suppresses gaps
  - headland vegetation strung into rows: removed by cornField v3
- **What remains:** about half the plants located, which produces the confirmed/unconfirmed alternation. That alternation is a *detection* limit made to *look* worse by drawing it as separate stubs.
- A photo layer would make the recall gap visible: imagery showing plants with no dot. That is honest, and section 9 covers the risk.

---

## 3. The possibilities

### A. The original photographs on the ground

| Variant | What it is honestly | Fit |
|---|---|---|
| **A1. Pre-cut tile pyramid** (what `twinReferenceTiles.ts` does) | Planar orthorectification. Each zoom-24 tile comes from one photo (the nearest centre among photos holding the tile), with an exact camera model on a 5×5 grid, nearest-neighbour sampling, and 2×2 averages for lower zooms. **An orthophoto on a flat surface model**, with no DSM, blending or colour balance. | Works today in dev. Measured on the private flight: 2,984 tiles, 60.7 MB, 66 MB/ha (zoom 24 = 0.79 cm/px, slightly coarser than the native 0.59 cm), 249 s in Node with a pure-JS JPEG decoder. |
| **A2. Per-photo crops warped live in the browser** | Each photo is cropped to its nearest-nadir (Voronoi) cell plus a feather margin and stored in its own pixel geometry. The viewer warps it onto the ground through the camera model with a subdivided mesh in WebGL; Allmaps does this for historical maps in Leaflet ([docs](https://docs.allmaps.org/packages/warpedmaplayer)). | The same orthorectification, done at view time. Nothing is resampled at build time, every pixel stays traceable to one photograph, and the viewer can switch which photo shows a spot. Costs a WebGL layer and a new dependency (Allmaps is beta). |
| **A3. A coarse whole-field image** | The existing evidence pass (nearest-nadir photo per cell, preview pixels) writing colour at about 3-5 cm instead of classes at 25 cm. **A low-resolution planar orthophoto.** | Almost free in compute (the pass took 0.4 s at 25 cm [V]; 4 cm means about 39× more cells, plus a 4 cm cell is about 1.2 preview pixels [H: 5-20 s, measure]). [H: about 1-3 MB/ha as WebP] Fits in the twin; no upload of photographs. Shows tracks, headlands, soil and row texture, but **not seedlings** (3 cm/px makes a V1-V2 plant 1.5-5 px). |
| **A4. Drone's-eye evidence** | No warping at all: show the original photograph(s) and project the twin's objects into them (the reverse direction). | The most honest view, real pixels as captured, and it uses Swardus's distinctive asset: many views of every plant. PIX4D's Virtual Inspector and Drone2Map do this for click-to-original ([PIX4D](https://support.pix4d.com/hc/en-us/articles/115005856226)). Needs cameras in the twin and the pixels (originals in session, uploads later). |

**How far tall things lean on a flat plane** (external research, calculated; displacement Δ = h·R/(H−h), with R the distance from the nadir point).

Nearest-nadir selection at 75/75 overlap bounds R at about 0.23H, so Δ is at most about 0.23·h whatever the altitude. Allowing any photo out to its corner gives about 0.9·h.

| Object | Nearest-nadir | Worst case (corner) |
|---|---|---|
| Corn V2-V4, 0.15-0.25 m | ≤ 3.5-6 cm | 14-23 cm |
| Corn V8, 0.6 m | ≤ 14 cm | 55 cm |
| Tasselled corn, 2.5 m | ≤ 0.6 m | > 2 m |
| Orchard tree, 4 m | ≤ ~1 m | ~4 m |

So seed-to-V4 corn is honestly ortho-equivalent. Tall corn and trees need a stated lean, and later seams routed through soil (between rows, between crowns) using the vegetation mask. That is still DSM-free. Terrain relief behaves the same way: a field that is not flat needs the terrain grid `adjust.ts` already supports. Sources: [Brown & Lowe gain compensation and blending](https://courses.cs.washington.edu/courses/cse576/07sp/notes/ijcv2007.pdf); [Voronoi seamline networks](https://uwaterloo.ca/geospatial-intelligence/sites/default/files/uploads/files/automatic_generation_of_seamline_networks_using_area_voronoi_diagrams_with_overlap.pdf); [ODM fast-orthophoto](https://docs.opendronemap.org/arguments/fast-orthophoto).

**Plain verdict.** Any of A1-A3 *is* an orthomosaic in substance: planar, from our own cameras, with no dense reconstruction. Calling it something else would be dishonest. What Swardus avoids is not orthorectification but **the photogrammetry stage**: dense matching, the DSM, a remote ODM node, minutes to hours. The cameras come from the existing build, and the imagery is a by-product of photographs the build already decodes. Only A4 involves no rectification at all.

### B. Rebuilding the field from the detected plants
- **B1. Plants drawn at their measured size.** This needs a per-plant footprint (area, or a short outline) kept from the green pieces in the plant read; about 2-8 bytes per plant [H]. It turns dots into a scaled stand map and lets the size rule change symbols into outlines. Low risk. Worth adding with the evidence lens.
- **B2. Plant cut-outs from the best photograph.** Every pixel is real, but over a synthetic ground they **hide the soil, weeds and missed plants around each plant**, which is exactly the context a scout needs. At 34,678 plants and about 1-2 KB per 48 px cut-out that is 35-70 MB [H], the same order as the photo tiles, which already contain every plant *and* their surroundings. Useful only as a gallery in the inspector. **Not as the ground.**
- **B3. Procedural canopy** (drawn plants placed at detections). This fabricates appearance and suggests completeness: on the private flight it would draw about 35k plants where about 70k stand. **Rejected for anything that looks like a picture.** A stylised density band, clearly a symbol, is the acceptable form (section 6).
- **B4. 2.5D/3D.**
  - At seedling stage, plant height (5-25 cm) is at or below the camera residual. Nadir-only 70-80 % overlap gives a nearly flat textured plane.
  - Gaussian splatting needs a CUDA GPU for minutes to around an hour ([3DGS](https://huggingface.co/papers/2308.04079.md)). Crop studies use multi-angle capture ([UAV3DCrop](https://arxiv.org/abs/2608.06404), [maize nadir against oblique](https://www.botany.one/2020/06/positions-matter-drones-using-nadir-and-oblique-photography-on-maize-fields/)).
  - **Not meaningful for corn now.** Possibly an offline orchard tier later, for crown height and lean [S].

### C. Hybrid
Photographs as the ground, measured objects over them, evidence state carried by the objects, and findings above all. This beats either alone:
- An imagery-only map gives no stand count, rows, certainty or field-wide findings. That is what conventional ortho products sell, after hours of processing.
- Geometry-only (today) gives no recognisability and no way to check anything by eye. You have said you trust only what you see drawn over imagery.

The hybrid's distinctive property is that **every symbol can be checked against the photographs it came from.** This is the recommended direction (section 5).

### D. Other approaches
- **D1. "Coverage as data."** A per-cell count of photographs that saw the ground, and at what best view angle. It can be computed in the viewer from the footprints today; better from the cameras. This replaces the wrong hatch with real states: unseen, seen once, seen by 2 or more. Cheap and directly about honesty.
- **D2. Row stand strip.** Each field row drawn as one band, shaded by *plants located per metre* against the row's expected spacing. Industry patterns sample instead: about 1 count per acre (Sentera), gap bubbles (DroneDeploy). A per-row continuous strip goes further. **Caveat:** located is not present; on the private flight about half are located. The label must say "located" until recall is measured on a labelled set.
- **D3. Value-suppressing palettes** for any density surface. As uncertainty grows, colours merge so the map refuses to state a precise value ([Correll et al. CHI 2018](https://www.tableau.com/research/publications/value-suppressing-uncertainty-palettes)).
- **D4. Flip between photographs.** With A2 or A4, let the user step through every photograph that saw a spot. Plants moving with wind, shadows and seams become visible rather than hidden. Not found in the products reviewed [S: it would differentiate].
- **D5. Live mosaicking during flight** (OpenREALM, DroneDeploy Live Map). This is a different product: a phone or controller app. Out of scope.

---

## 4. Feasibility

| Need | Exists? | New data or work |
|---|---|---|
| Nearest-nadir photo per ground point | Yes (`evidenceAndBoundary`, `twinReferenceTiles.ts`) | Write colour instead of classes; keep it for corn |
| Full-size pixels during the build | Yes for corn (corn stage decodes each photo) | Cut detail tiles while the photo is decoded, rather than a second decode |
| Cameras in the viewer | Only in the analysis record | Add `frames` to the twin: about 123 × 200 B ≈ 25 KB [H] |
| Photographs after the build | No (crops only) | Upload tiles (A1) or per-photo cell crops (A2); originals optional |
| Plant footprint | No | Keep area per plant from `greenPoints` |
| Plant to photograph link | No (count only) | Store photo indices per plant (the analysis record can rebuild them) |
| Parent row of a stretch | Lost in bundle | Store `rowId` per stretch |
| Gaps from plants-first rows | Not built | Detection work, not visualisation |
| Plants-first registration shifts | Not stored | Store per photo, or measure that they are negligible |
| Corn coverage of 2+ views | No | Compute from cameras (D1) |

**What would resolve the remaining uncertainty (all measurable on the five local twins):**
1. Time and bytes for the coarse image (A3) at 3, 4 and 5 cm.
2. Time and bytes for detail tiles cut from the already-decoded full-size photo, in Node and in Chrome (OffscreenCanvas `drawImage` with an affine transform per 2 m tile against per-pixel sampling).
3. Seam disagreement: phase-correlate overlapping cells of neighbouring photographs on soil and report the median and 90th-percentile offset. Expect about the 7.5 cm residual.
4. Alignment of dots to imagery: the share of certain plant dots within 3 cm of vegetation pixels in the rendered imagery, compared with the same measure taken through each dot's own original photographs (the diagnostic used this vegetation-within-3-cm measure for row points).
5. Exposure steps at seams before and after per-photo gain.
6. The eye test.

---

## 5. Recommended architecture

**Layers, bottom to top:**
1. **Ground.**
   - Photo imagery when present: coarse whole-field image, then detail tiles.
   - Otherwise a light neutral ground.
   - Charcoal is kept only for "outside the photographed area".
2. **Coverage state.** Unseen ground hatched, seen-once ground marked, both from cameras (D1).
3. **Measured objects.** Rows as one line per field row, plants, weeds, gaps. Metric widths where real sizes are known; symbols with a stated minimum size otherwise.
4. **Inferred and uncertain objects.** Quiet, off in the default view, one switch away.
5. **Findings.** Zones, row stand strip, priorities.
6. **Evidence lens on tap.** Original photographs that saw the object, with it projected in each.

**The build adds one side output, not a stage.**
- **While cameras are known:** the coarse image from the preview raster the build already holds, as part of `evidenceAndBoundary`.
- **During the corn stage's full-size decode** (orchard: the atlas pass, which also decodes full size): the detail tiles each photo owns under the nearest-nadir rule, with a feathered margin and a per-photo gain solved from overlaps.
- The twin opens as soon as the vectors and coarse image are ready, the same pattern as "twin first, atlases after" (`assembleBundle`).
- Detail tiles upload in the background and are fetched per view through the existing `CachedTileLayer`.

**Why A1 (pre-cut tiles) before A2 (live warp):**
- A1 reuses the dev script, Leaflet's tile layer and static storage. It needs no WebGL and works on any phone.
- A2 is better long-term: traceable pixels, flipping between photos (D4), no resampling, smaller storage. It can replace A1 later behind the same layer contract.

**Orchards:** the same layers, with the lean stated, and seams routed through soil later (section 8, phase 5).

---

## 6. Proposed user experience

**One map, two lenses, and founder diagnostics.** Three peer modes would split one question ("what is in my field, and can I trust it?") into screens. Engineering is not a user mode.

- **Field lens (default).**
  - The photographs as ground, confirmed findings, rows quiet.
  - Zoomed out: the coarse image plus findings zones and the row stand strip.
  - Zoomed in: as the detail imagery resolves plants (zoom 23 and finer, about 1.6 cm/px or finer [V]), geometry thins to outlines and ticks so the photograph shows. A press-and-hold or swipe compares with and without symbols.
  - Uncertain items: off, with a count in the panel ("630 row stretches not confirmed: show").
- **Evidence lens (review).**
  - The imagery desaturated; every object coloured by state: observed / inferred / withheld / unseen.
  - The coverage count, and plants by certainty class with a legend.
  - This is where a consultant verifies or corrects, and where the row editor belongs.
- **Founder diagnostics** (existing Full / Layers / Diagnostics): footprints, ties, lattice rows, raw per-photo reads.

**Tap anything** (plant, row, gap, weed, zone):
- A sheet listing the photographs that saw it, nearest-nadir first, each with the object projected and the photo's view angle.
- The verdict counts, in words.
- Plants and rows become tappable; today they are not.

**Default visible against on demand:**

| Visible by default | On demand |
|---|---|
| Photographs; the photographed area | Footprints, ties, raw reads |
| Confirmed rows (one line per row) | Unconfirmed stretches |
| Located plants at plant zoom | "Between rows" and "on no row" dots |
| Confirmed weeds and gaps | Unconfirmed and contested weeds, withheld gaps |
| Unseen ground hatch, stated scale | Coverage count map |
| Findings and stand strip | Lattice rows, cultivated-block evidence |

**Mobile.**
- The same layers, with a tile budget for the viewport (detail tiles only in view).
- The evidence sheet as a bottom sheet showing one photo at a time with swipe.
- On a slow link the coarse image is always there; detail arrives when it can.

---

## 7. Performance

| Item | Measured [V] | Estimated [H], to benchmark |
|---|---|---|
| Coarse image (A3) | evidence pass 0.4 s at 0.25 m cells (private flight) | 5-20 s at 4 cm; 1-3 MB/ha WebP |
| Detail tiles (A1) | 249 s Node, pure-JS decode, 123 photos; 66 MB/ha (zoom 24, JPEG q82) | Far less if cut from the corn stage's existing decode with canvas transforms; WebP about 25-34 % smaller ([Google WebP study](https://developers.google.com/speed/webp/docs/webp_study)) |
| Native-resolution zoom 25 | none | about 190 MB/ha (not recommended by default) |
| Upload | none | 66 MB/ha at 5 Mbit/s ≈ 110 s/ha; a 50 ha farm ≈ 1.5 h, so background, resumable, optional on metered links |
| Storage | none | 50 ha ≈ 3.3 GB per flight at zoom 24 JPEG |
| Viewer | Leaflet tiles: viewport ~50 tiles × 256 KB decoded ≈ 13 MB; vectors measured to 100k in under 8 ms per draw | No WebGL needed for A1; A2 needs WebGL2 (98.9 % of Windows browsers, [web3dsurvey](https://web3dsurvey.com/webgl2)) and tiles ≤ 2048 px |
| First useful twin | 21-64 s builds today; the 123-photo flight never built in a browser | Coarse image adds seconds; detail tiles must not delay opening |

**What must be benchmarked before any commitment:**
- browser build time of the 123-photo flight (never measured)
- marginal cost of tile cutting in Chrome
- the size of the coarse image
- upload time on a throttled link
- open-to-first-imagery on a mid-range phone

---

## 8. Roadmap

| Phase | Content | Depends on | Size | Accept when |
|---|---|---|---|---|
| **0. Honesty and representation** | Hatch only unseen ground (from footprint union, not hull); fix "0 of 0"; store `rowId` per stretch and draw one line per row with its stretches as a state along it; plant legend for all users; uncertain layers off by default, with counts; cull corn rows by viewport | none | S (2-4 days) | On all five twins the key matches what is drawn; no zero counts; the private flight reads as 108 rows; your eye test |
| **1. First experiment** (section 10) | Coarse and detail photo layers in dev, measured | none | S-M (3-5 days) | Numbers in section 10 met; your eye test |
| **2. Photo ground in production** | Build side output, background upload, storage path, viewer layer for participants, gain and feathering, terms check for storing photographs | 1, your go, terms | M-L (2-3 weeks) | Imagery under every new twin; first open not slower; tile alignment ≤ held-out residual; participants consented |
| **3. Evidence lens** | `frames` in the twin, plant to photo indices, tap any object to see all views with the projection; plants tappable | 2 (or originals in session) | M (1-2 weeks) | Every confirmed object shows ≥ 2 views with its projection inside the object's own extent |
| **4. Stand composition** | Plant footprints; row stand strip (located per metre against expected); value-suppressing palette; gaps from plants-first rows | 0, 3; detection work for gaps | M + detection | Strip agrees with a hand count on 10 rows of one public flight |
| **5. Ambitious** | Live warp of per-photo crops in WebGL (A2) with photo flipping (D4); seams through soil; terrain surface from ties; orchard lean statement | 2 | L | Storage below A1; seams invisible on soil; tree crowns not doubled at seams |

---

## 9. Risks and open questions

- **The imagery will show what the twin missed.** On the private flight about half the plants have no dot. This is honest, and it is the trust mechanism, but the first impression may be "it missed half". It needs words: "located by Swardus", not "plants".
- **A planar photo layer can be mistaken for a survey-grade ortho.** It needs a stated accuracy (±7.5 cm held out on the apricot; none measured on corn) and a stated lean for tall crops.
- **Seams and exposure.** M3M auto exposure varies between frames. Gain compensation is required before showing participants.
- **Dot-to-imagery offset** from the unstored plants-first registration shifts: unmeasured.
- **Bandwidth and storage** for rural operators and for Supabase costs at farm scale. Detail tiles must be optional and resumable.
- **Consent.** Storing growers' photographs is a new kind of data from participants. It needs a check against the approved pilot terms before production.
- **Orchards:** crowns lean up to about 1 m at seams until seams are routed through soil.
- **Unresolved:**
  - whether a 3-5 cm coarse image is recognisable enough to justify itself
  - the real browser cost of cutting tiles
  - whether people want photo flipping (D4)
  - what operators actually do with the stand strip.

---

## 10. Recommended first experiment

**"Photo ground", dev only, five twins, no production or model change.**
1. A script that, from each twin's cameras, writes:
   - **(a)** the coarse whole-field image at 3, 4 and 5 cm from the preview pixels, nearest-nadir per cell, bilinear
   - **(b)** detail tiles at zoom 24 by nearest-nadir with a 1 m feathered margin and per-photo gain from overlaps
   - Corn twins use their analysis records; the apricot twin needs a Node camera run.
   - It starts from `twinReferenceTiles.ts` and adds feathering, gain and the coarse image.
2. Record time per tier (Node; Chrome for the coarse image), bytes per hectare, seam offset on soil, and the dot-on-vegetation share on rendered imagery against originals.
3. A dev-preview "field" style alongside today's: imagery ground, confirmed only, one line per row (from `why` until `rowId` exists), plants as small rings that thin out at native zoom.

**Done means:**
- the coarse image is 5 MB/ha or less
- the detail tier is 70 MB/ha or less
- the coarse image costs 20 s or less on the private flight
- the median seam offset on soil is 7.5 cm or less
- plant dots sit on vegetation in the rendered imagery about as often as in the originals
- you judge the result on Day023, the private flight and the apricot

Everything stays in the dev route and local folders, so deleting the script and style undoes it.
