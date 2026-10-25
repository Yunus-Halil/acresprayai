# Orthomosaic resolution and image quality audit (2026-10-24)

The field: "CORN FIELD TESTING", early-stage corn. 548 photographs from a DJI FC300X camera (Phantom 3 class), at
4000 × 3000 px with a 3.61 mm lens (20 mm equivalent). The flight was 24.5–25.4 m above the take-off point, at 30.55° N.
The complaint was that crop rows show on the map, but single plants are blurry when zoomed in.

**Short answer.** One stage of the pipeline lost real detail: the map's tile pyramid. It stopped at zoom 23, which is
1.61 cm a pixel at this latitude. The photographs hold detail at about 1.07 cm. On the same ground, the photographs'
edges measure 2.1 cm wide. At the zoom-23 tile pixel they measure 3.2 cm.

The rest of the softness comes from the camera itself, and no setting recovers it. Even in the original photographs, a
leaf edge spans 2 pixels.

## 1. Root cause and evidence

| Stage | What enters | Finding | Evidence |
|---|---|---|---|
| Capture | 4000 × 3000 JPEG, 4.7–5.8 MB each, ISO 100, f/2.8, 1/280–1/810 s | GSD ≈ **1.07 cm**. This is 25 m × 1.56 µm ÷ 3.61 mm, assuming 25 m above the crop; the relative altitude is above the take-off point, so terrain changes this. | EXIF/XMP of all 548 files |
| Motion during exposure | 2.4–2.6 m/s drone speed | 0.3–1.0 px. It does not track sharpness (r = −0.43), so it is not the blur. | XMP speed × exposure |
| Photo sharpness | — | Edge 10–90% width **2.0 px = 2.14 cm** at the image centre, 1.87–2.41 cm across the sample. That is ordinary for a small-sensor Bayer camera behind JPEG: soft, but real detail to about the 1 cm pixel. | 46 photos, centre and corner crops (method: §7) |
| Upload | The camera's own file | **No loss.** `prepareForODM` returns the original file (`ODM_UPLOAD_MAX_EDGE_PX = ∞`). | [imagePrep.ts](../../src/lib/imagePrep.ts) |
| ODM | `orthophoto-resolution 1`, `pc-quality high`, `dsm`, `skip-3dmodel`, `auto-boundary` | **No setting that sacrifices detail.** No `fast-orthophoto`, `resize-to` or `ignore-gsd`. ODM holds the orthophoto to its own GSD estimate, so asking for 1 cm means "as fine as the photos measure". | [odmOptions.ts](../../src/lib/odmOptions.ts) |
| Orthophoto storage | `odm_orthophoto.tif` as ODM wrote it | Stored whole in the `orthos` bucket; no re-encode. | [odm-poll](../../supabase/functions/odm-poll/index.ts) |
| **Tile pyramid** | the GeoTIFF, through TiTiler | **The loss.** `MAX_Z_CAP = 23` = **1.61 cm** at 30.55° N, coarser than the 1.07 cm photos. The same ground's edges go from 2.14 cm (photo) to **3.21 cm** (zoom-23 pixel, area average) and 3.21–3.62 cm (nearest neighbour, TiTiler's default resampling). At zoom 24 (0.80 cm) they measure 2.01 cm, the photo's own. Tiles are PNG, which is lossless. | [bake-tiles](../../supabase/functions/bake-tiles/index.ts); measurement in §3 |
| Browser | 256 px tiles in Leaflet | The map allowed one zoom past the tiles. The browser enlarges that last level bilinearly: 2× in CSS, and 4× in device pixels on a HiDPI screen. That only shows the tile's softness; it loses nothing more. | [FieldViewTab.tsx](../../src/components/app/workspace/FieldViewTab.tsx), [orthoZoom.ts](../../src/lib/orthoZoom.ts) |

The cap's comment said zoom 23 was "about 1.5 cm per pixel at mid latitudes, finer than any current scan". That was true
for the fields flown before. It is not true at 30° N for a 25 m flight with a 1/2.3" camera.

**Not measured:** the stored orthophoto itself. I couldn't read the private orthophoto and tiles from here (§8).
`npm run audit:resolution` measures them (§7). Until it runs, the orthophoto's GSD is *expected* to be about 1.0–1.07 cm,
not measured.

## 2. Source files and functions

- Upload: `src/lib/imagePrep.ts` (`prepareForODM`) and `src/lib/scanUpload.ts`. ODM options: `src/lib/odmOptions.ts`.
- ODM submit and poll: `supabase/functions/odm-submit`, `odm-poll`. The orthophoto lands in the `orthos` bucket.
- Tiles: `supabase/functions/bake-tiles` (TiTiler `/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png`, 256 px, PNG; `MAX_Z_CAP`).
  Tiles are served by `supabase/functions/tile`.
- Display depth: `src/lib/orthoZoom.ts` (`ORTHO_MAX_NATIVE_ZOOM`, `MAP_MAX_ZOOM`) and `src/lib/bakedZoom.ts` (the stored
  `tiles_max_zoom`). Both feed every Leaflet ortho layer.
- Analysis reads:
  - Weed Scout scan: `src/lib/weedScout/pipeline.ts` (`stitchTiles`; its GSD comes from the raster, `rasterGsdM`).
  - Treatment grid: `TreatmentTab.tsx`.
  - Map runs and Stage 1: `src/lib/weedVision/mapRun.ts` (zoom 23 at most, `metresPerPixel`).
  - Row reader: `fieldRows.ts` (zoom 23 at most).
  - Pattern pass: `fieldPattern.ts` (zoom 22 at most).
  - Weed Scout photo pass, size and Closer look: the original photographs.

## 3. Measurements

Edge width is the median 10–90% rise of the strongest edges, in pixels × the stage's pixel. The map stages were
simulated on the same photo crops: the photos stand in for the orthophoto, because the real orthophoto could not be
read (§8).

| Stage | Pixel | Edge width, median (10th–90th percentile) |
|---|---|---|
| Photo, centre | 1.07 cm | 2.14 cm (2.14–2.41) |
| Photo, corner | 1.07 cm | 2.14 cm (1.87–2.41) |
| Zoom-23 tile pixel, area average | 1.61 cm | 3.21 cm (3.21–4.02) |
| Zoom-23 tile pixel, nearest (TiTiler) | 1.61 cm | 3.62 cm (3.21–4.02) |
| Zoom-24 tile pixel | 0.80 cm | 2.01 cm (2.01–2.21) |

A side-by-side picture of the same 2.6 m of corn at the three pixels was made from DJI_0200. It isn't committed, because
the photographs are field data. In it, zoom 23 turns leaf edges blocky and breaks up the thin leaves, while zoom 24
matches the photo.

**Before and after on the map:** before, close-ups stopped at zoom 23 (1.61 cm). After the scan is deepened, they reach
zoom 24 (0.80 cm). That carries every pixel of a ~1 cm orthophoto, oversampled about 1.3× and never invented.

## 4. Actual orthomosaic GSD

**Not measured** (§8). Expected 1.0–1.07 cm: requested 1 cm, held by ODM to its GSD estimate, from 1.07 cm photos.
`npm run audit:resolution -- --field "CORN FIELD TESTING"` reports it from the GeoTIFF's transform, along with its
size, compression, overviews and tiling.

## 5. Processing configuration changes

None to ODM. The options already ask for the most the photographs hold. Recommended settings, not applied:

- **Keep:** `orthophoto-resolution 1`, `pc-quality high`, `dsm`, `skip-3dmodel`, `auto-boundary`. Keep ODM's default
  lossless `orthophoto-compression` (DEFLATE).
- **Never use:** `fast-orthophoto`, a JPEG orthophoto, or `ignore-gsd` (it renders past the photos' own detail).
- **`pc-quality ultra`:** only with a measured gain. The orthophoto is textured from the photographs themselves, and
  ultra costs about four times the compute.
- **`cog` (overviews inside the GeoTIFF):** worth trying for faster bakes. It doesn't change the deepest zoom.
- **`feature-quality`:** its default only affects matching.
- **Unverified on our node:** none of these were checked against the processing node's ODM version (the node needs a
  token only the server holds).
- **One flight per scan:** 19 of these 548 photographs (DJI_0530–0548) were taken on 2017-04-27, a month after the other
  529 (2017-03-30), with a different home point. If they went into the same scan, the mosaic blends two growth stages
  wherever they overlap. The uploader does not warn about mixed dates today. That check is proposed, not built.

## 6. Frontend rendering changes

- `bake-tiles` `MAX_Z_CAP` changes from 23 to 24. New scans follow the file. TiTiler's maxzoom is the zoom nearest the
  file's pixel, so a 6 cm map still stops at 21.
- `ORTHO_MAX_NATIVE_ZOOM` changes from 23 to 24, and `MAP_MAX_ZOOM` from 24 to 25 (one level of plain enlargement, as
  before).
- **Existing scans are not touched.** Their tile plan is locked at their depth. The scan panel's **Bake finer map tiles**
  button (shown on scans baked to 23) calls `bake-tiles?depth=24`:
  - It bakes only the new zoom level.
  - It uses the scan's stored render plan.
  - It keeps every existing tile and the orthophoto.
  - It is held to one level past the file's own zoom: at most 2× oversampled, never invented.
  - `depth=23` undoes it.
- **Analysis is separate from display.** `ANALYSIS_MAX_ZOOM = 23` holds the Weed Scout scan, the treatment grid, Weed
  Scout's map and the photo aligner where their thresholds and benchmarks were set. The row reader, pattern pass and map
  runs already capped themselves. Every analysis computes its pixel from the raster it reads. Raising the analysis zoom
  is a separate, measured change.
- No sharpening anywhere, and no resampling setting changed. TiTiler's nearest-neighbour resampling stays, because the
  existing scans' tiles were rendered with it.

## 7. Verification

- **Tests:**
  - `resolutionChain.test.ts` pins the chain: the original file reaches ODM, 1 cm is requested with no speed options,
    the bake cap equals the display cap, zoom 24 is finer than a 1.07 cm flight at 30.55° N, tiles are PNG, and analysis
    stays at 23.
  - `bake-tiles.test.ts` checks: a new bake follows the file to 24 and stops; a deepening bakes only the new level with
    the stored plan; it goes at most one level past the file; `depth=23` undoes it; malformed or conflicting requests are
    refused.
  - `scanTimeline.test.tsx` checks the button appears only on scans baked to 23 and asks for `depth=24`, never a rebake.
  - `imageSharpness.test.ts` checks the edge measure against edges of known blur: 2.563 σ ± 0.6 px.
  - `utm.test.ts` checks the UTM conversion against a published point.
- **Edge-width method:** validated before use.
  - Synthetic edges read 1.25 / 2.75 / 5.0 px against 1.28 / 2.56 / 5.13 expected.
  - Added blur widens the reading, and downsampling narrows it.
  - A first spectral cutoff metric failed this check (blur *raised* it) and was discarded.
- **Measuring the real artifacts:** `npm run audit:resolution -- --field "<name>"` (read-only; service-role key in the
  environment, as for `bench:frames`). It prints the orthophoto's pixel, format and overviews, then the edge width of the
  same 12 m in the orthophoto and in the two deepest tile zooms.

## 8. Remaining limitations

- **Real artifacts not measured.** The stored orthophoto and tiles of this field were not measured: reading them needs
  the project's service-role key, and fetching it was declined in this session. The tile-stage loss above is simulated
  on the photographs. If ODM's orthophoto is softer than the photos, zoom 24 recovers less than the simulation shows.
- **Unproven on a real deepen.** No real scan has been deepened yet.
- **Bake cost.** Zoom 24 is four times the tiles of zoom 23: about 15,000 more PNG tiles for this ~6 ha field, roughly
  1.5–2 GB at 100–150 kB per tile. It also means more requests to the public titiler.xyz.
- **Camera limit.** No pipeline change makes this camera sharper. Each young corn plant is 15–25 px across; each leaf is
  1–3 px wide.
- **Whether 25 m is above the crop** depends on the terrain against the take-off point; it was not checked.

## 9. Recommended settings for Swardus

- **Capture for early corn and single weeds:** about 1 cm GSD or finer, sharpness over coverage. 20–25 m with a 1/2.3"
  camera, or higher with a 1" sensor. Shutter fast enough that motion stays under 1 px: speed × exposure < GSD. One date
  per scan.
- **ODM:** the current options (§5).
- **Tiles:** bake to the file's own zoom, up to 24 (now the default). Deepen older 1 cm scans from the scan panel when a
  close look matters.
- **Analysis:** keep reading at zoom 23 or coarser until the move to 24 is measured on a real map. Plant-scale work (size,
  closer look, model on photos) already reads the original photographs, which stay the sharpest source the field has.

## Update 2026-10-25: the chain opened to the flight's own pixel

- **ODM** is asked for 0.1 cm (`odmOptions.ts`), which it caps at its GSD estimate. The orthophoto comes back at the
  photographs' own pixel; the 1 cm request had held lower flights to 1 cm.
- **Tiles** go to the orthophoto's own pixel, read by `bake-tiles` from the file's size and extent (`/cog/info`). The
  bake picks the shallowest zoom whose pixel is within 1.4 file pixels, up to zoom 26, never shallower than TiTiler's
  zoom.
  - **Automatic bakes** go past zoom 23 only while the pyramid fits 60,000 tiles.
  - **"Bake finer map tiles"** goes as deep as the file's pixel allows, up to 80,000 tiles.
- **Analysis:** the readers keep their own pixel.
  - The row readers stay at 3–5 cm, the pattern pass at 5 cm, and the field scan sizes by cell.
  - The weed hotspots now read at the finest pixel the map has, within 250 million pixels, which takes a few minutes.
    They count a 3 × 3 pixel patch, where the 4 cm read counted 30 cm².
  - The summary names the pixel read.
  - The grade still reads at the crop profile's pixel (3 cm for corn).
- **Limits measured:** Stage 1 runs about 20 ms a million pixels; fetching the tiles is most of a fine read.
- **Not yet done:** none of it has run on a fine real flight. `resolution-ceiling-test.md` is the test.
