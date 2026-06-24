
# From mockup to actually working: the core loop

Goal: a real farmer flies their spray drone, exports an orthomosaic from their drone software, and the system maps their field, lets them label crop zones, ingests NDVI, flags problems, and produces a spray plan. No fake data in this loop.

The mockup pages (Live Field 3D, Fleet Intel, sample PDF) stay as marketing/demo surfaces. The new flow lives alongside them as the real product.

---

## The 5-step user journey

```text
1. Upload orthomosaic (GeoTIFF / large JPG+world file)
        |
2. System extracts: bounds, GSD, preview tiles, elevation if present
        |
3. Farmer draws polygons on the orthomosaic → labels crop + variety
   System auto-computes area (ha), perimeter, row direction
        |
4. Farmer uploads NDVI orthomosaic (or we derive from multispectral bands)
   System overlays it on the same georeferenced canvas
   AI annotates anomalies (low-NDVI clusters, edge stress, pest patterns)
   Farmer can add/edit annotations
        |
5. System generates spray plan per anomaly
   (chemical, dose L/ha, target polygons, total volume, weather window)
   Exports as mission file + PDF record
```

Everything renders in the existing 3D field view — the orthomosaic becomes the ground texture, polygons become the crop zones, NDVI becomes a toggleable overlay, annotations become the spray boxes.

---

## What gets built

### Step 1-2: Orthomosaic ingest
- New page `/app/fields/:id/map` — drag-and-drop orthomosaic upload
- Storage bucket `orthomosaics` (private, RLS scoped to user)
- Edge function `ortho-process`: reads GeoTIFF header → extracts bounds (EPSG:4326), GSD (m/px), width/height; generates a web-friendly preview (downscaled JPG) + a small thumbnail; stores metadata
- New table `orthomosaics`: field_id, storage_path, preview_path, bounds (geography), gsd_m_per_px, width_px, height_px, captured_at, kind ('rgb' | 'ndvi' | 'multispectral')

### Step 3: Polygon crop editor
- Leaflet (or MapLibre) canvas with the orthomosaic as an image overlay at its real bounds
- Draw tool: click-to-place vertices, close polygon, label with crop type + variety + planting date
- New table `crop_zones`: field_id, name, crop, variety, polygon (geography), area_ha (computed via PostGIS `ST_Area`), planted_at, notes
- Area auto-computed server-side from the polygon — that's the "GSD × polygon size" math, done correctly with geodesic area instead of pixel counting

### Step 4: NDVI overlay + AI annotation
- Same upload flow, marked `kind='ndvi'`. Rendered as a colored overlay (red→yellow→green) on top of the RGB ortho, opacity slider
- Edge function `analyze-ndvi`: samples NDVI values inside each crop zone polygon → mean, p10, p90, stressed-area %, clusters low-NDVI pixels into anomaly polygons → calls Lovable AI to label likely cause (drought stress, nutrient deficiency, pest pressure, waterlogging) given crop type + values
- New table `anomalies`: zone_id, polygon, ndvi_mean, severity, ai_label, ai_reasoning, user_label, user_notes, status ('open'|'dismissed'|'sprayed')
- Farmer can edit AI labels, draw new anomalies manually, dismiss false positives

### Step 5: Spray recommendations
- Edge function `recommend-spray`: per open anomaly → maps (crop, ai_label, severity) to a chemical class + dose range (small JSON lookup table seeded with common Virginia row crops — corn, soy, wheat, tobacco). Returns chemical, dose L/ha, total volume, target polygon, suggested time-of-day given weather
- New table `spray_recommendations`: anomaly_id, chemical, dose_l_ha, total_l, target_polygon, weather_window_start/end, status
- Approve → creates a row in existing `jobs` table → shows up in the Mission Planner
- PDF export of the spray record (chemical, dose, area, operator, timestamp) for compliance

### 3D field view, real version
- `RealisticField3D` gets a `fieldId` prop. When present:
  - Ground plane uses the orthomosaic preview as texture, sized to true bounds
  - Crop zones extruded as colored regions per crop
  - NDVI overlay toggle uses the real NDVI image
  - Anomaly markers replace the mock spray boxes

---

## Technical notes

- **GeoTIFF parsing**: use `geotiff.js` in the edge function (Deno-compatible). Reading the header for bounds + GSD is cheap; we don't need to tile the whole raster server-side for v1 — a downscaled preview JPG is enough to render.
- **PostGIS**: enable the extension via migration. Polygons stored as `geography(Polygon, 4326)`. Area via `ST_Area(polygon::geography) / 10000` for hectares.
- **Storage**: one private bucket `orthomosaics`. RLS: users can read/write only paths prefixed with their own `user_id/`.
- **NDVI from multispectral**: out of scope for v1. v1 expects the farmer's drone software (DJI Terra, Pix4Dfields, DroneDeploy — all standard with spray drones) to export the NDVI ortho directly. We accept it as an upload. Computing NDVI from raw multispectral bands is a v2 backend job.
- **Lovable AI**: used in `analyze-ndvi` for anomaly labeling. Prompt includes crop type, NDVI stats, anomaly shape/location relative to field. Free Gemini tier.
- **File size**: orthomosaics can be 200MB-2GB. v1 caps at ~500MB and warns above that; resumable uploads are v2.

---

## What this plan does NOT do (intentionally)

- Live drone telemetry / DJI Cloud API — that's the "after this" phase you mentioned
- Multi-user farm orgs, roles, billing
- Compliance certifications, audit chain-of-custody
- Computing NDVI from raw bands
- Mobile-native app

Those are real things to build later. They don't belong in the first real-loop milestone.

---

## Build order (one PR per step, in this order)

1. PostGIS migration + `orthomosaics` / `crop_zones` / `anomalies` / `spray_recommendations` tables + storage bucket + RLS
2. Orthomosaic upload UI + `ortho-process` edge function
3. Polygon editor page (Leaflet + draw tools) + crop labeling
4. 3D field view wired to real field data (orthomosaic texture + extruded zones)
5. NDVI upload + overlay + `analyze-ndvi` edge function
6. Spray recommendations + PDF compliance export

Confirm and I'll start with step 1.
