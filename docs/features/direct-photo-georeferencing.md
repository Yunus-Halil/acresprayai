# Direct photo georeferencing v0 (2026-10-26)

Experimental pathway: original drone photographs straight to georeferenced observations, with no orthomosaic, no
ODM run, no stitching and no ground control. A technical prototype beside the production orthomosaic pipeline, not a
replacement for it. Nothing in the production pipeline imports this code.

Test set: the 71 apricot-orchard photographs in `directtestimagery/` (the first field we tested; Phantom 4 RTK,
FC6310R, 5472 x 3648, 36 m above take-off, RTK fixed on every frame, 0.98 cm pixels at the frame centre). The folder
is gitignored; the photographs are only read.

## Step 1: what already existed

| Need | Where | Reused? |
|---|---|---|
| Original photograph storage | `scans/<user>/<odm_uuid>/frames/<name>` + `frames.json`; lookup contract `src/lib/sourceFrames/manifest.ts` (`lookupOriginal`), readers `sources.ts` / `scan.ts` | Not needed for v0 (local folder). The module takes bytes, so stored originals plug in unchanged |
| EXIF / XMP extraction | `src/lib/photoScout/exif.ts` (`app1Segments`, `parsePhotoHeader`: EXIF via piexif, XMP RelativeAltitude and GimbalPitch only) | Yes: the new reader builds on both and adds the rest of DJI's XMP |
| Camera calibration and orientation | `src/lib/sourceFrames/odm.ts`: OpenSfM brown lens and poses from an ODM run (`cameras.json`, `shots.geojson`), `pixelToGround` on a plane, footprints | Its local tangent plane (`toEnu` / `fromEnu`) is reused. Its cameras need an ODM reconstruction, which is exactly what this pathway removes |
| Geographic utilities | `src/lib/geo.ts` (planar field helpers), `odm.ts` tangent plane, `scripts/bench/utm.ts`, `weedVision/mapRun.ts` (`mercatorPx`) | `toEnu` / `fromEnu` |
| Vegetation segmentation, crop rows | `weedVision/fieldRows.ts` (`vegetationMask` ExGR, `coverMask`, `shadowMask`, `fieldRowsFromPixels`), `photoScout/pattern.ts` (single-photo rows + seed spacing, `measureComponents`), `weedVision/layout/plantingLayout.ts` | `vegetationMask` + `measureComponents` for v0 patches. Rows and the planting layout are the next detectors to run per photo (see next steps) |
| GeoJSON generation | No shared writer: `sourceFrames/odm.ts` reads ODM GeoJSON, `shapefile.ts` writes shapefiles, `weedVision/export.ts` CSV | The script writes plain GeoJSON FeatureCollections |
| Map rendering | Leaflet + react-leaflet; `components/app/workspace/DetectionOverlay.tsx` (frame detections on Weed Scout and Field View), `OrthoTileLayer.tsx`, `PatternLayer.tsx` | Not wired in v0. A standalone Leaflet viewer shows the result over satellite imagery |

## Step 2: the module, `src/lib/directGeoref/`

| File | What it does |
|---|---|
| `metadata.ts` | `parseDjiHeader`: position (XMP, 8 decimals), absolute and relative altitude, gimbal and flight yaw/pitch/roll, calibrated focal length and principal point, DewarpFlag / DewarpData, RTK flag and standard deviations |
| `projection.ts` | The camera model and `pixelToGround` / `groundToPixel`, `frameCorners`, `frameFootprint`, `groundSampleAt`. Pinhole with optional Brown distortion (Newton inversion; returns null rather than a wrong ray where the lens polynomial has no inverse) |
| `frame.ts` | `frameFromDji`: builds the camera from a header, records the basis of every input, refuses (with the reason) rather than guess. Uses per-unit DewarpData on a raw frame; treats DewarpFlag 1 as already undistorted |
| `homography.ts` | The four-corner shortcut, measured against the full ray cast |
| `objects.ts` | Green patches in a photograph (ExGR mask pooled to cells, connected components, convex outline) and their ground positions |
| `multiView.ts` | Pair matching, ray triangulation (3D position and height per patch), clustering into one position per real object |
| `calibrate.ts` | Camera-to-gimbal calibration and an effective ground plane, estimated from the flight's own overlap |

Inputs, each with its stated basis in the output:

| Input | Source on this flight |
|---|---|
| Camera position | XMP GpsLatitude / GpsLongtitude, RTK fixed (1.0 to 1.4 cm horizontal standard deviation) |
| Camera height | XMP RelativeAltitude (height above take-off) |
| Intrinsics | XMP CalibratedFocalLength 3666.67 px, principal point at the centre. This equals the nominal 8.8 mm / 2.41 um design value, not a per-unit calibration |
| Lens distortion | DewarpFlag 1 and no DewarpData: distortion removed in camera, frame treated as a pinhole. DJI does not document the flag; this reading matches Pix4D's handling of in-camera dewarped frames |
| Attitude | XMP GimbalYaw/Pitch/RollDegree, world-referenced. Checked on this flight: gimbal roll stays 0 while the aircraft rolls up to 23 degrees, gimbal yaw follows flight yaw on straight legs. Gimbal yaw fits the overlap better than flight yaw (pair rotation residual 0.79 against 1.00 degrees) |
| Angle order | `ZYX` (yaw, pitch, roll) by default; `ZXY` (the gimbal's motor order) available. They agree whenever roll is 0, which is every straight-leg frame. The few turn frames are too poorly overlapped to choose between them (ray miss 0.46 against 0.42 m) |
| Camera-to-gimbal boresight | Identity in the header model; estimated from the overlap by `calibrate.ts` |
| Ground | Declared flat plane at take-off height; moved by the calibration. A `surface` ground (a DEM function) is supported, with the same vertical datum enforced |

Conventions: continuous pixel coordinates (top-left corner of the image is 0,0); camera x right, y down, z out of
the lens; yaw clockwise from north; at yaw 0 and pitch -90 the top of the photograph faces north. Outputs are
latitude/longitude plus height in the camera's datum, and east/north metres from the camera's nadir point.

### The four-corner idea

Knowing the four corners on the ground is enough to place every other pixel, on two conditions. The interpolation
between the corners must be projective (a homography), not bilinear. The ground must be flat with no lens distortion
left. On a tilted turn frame (pitch -93.7, roll -1.9), bilinear interpolation is off by more than 5 cm; the
homography matches the full ray cast to under a micrometre (tests). The viewer draws each photograph exactly this
way: its four projected corners become a CSS homography.

## Results on the apricot flight

Run: `npx vite-node scripts/directGeoref/run.ts` (71 photographs in about 70 s, then about 20 s of matching and
calibration). Output in `data/direct-georef/apricot/`: `index.html` (viewer), GeoJSON of footprints, patches,
multi-view positions and the DJI_0301 hand labels, `report.md`, `summary.json`.

- **Patches.** 33,981 green patches were projected from the 71 photographs. 1,353 of them were seen in 2 or more
  photographs (median 4) and placed by triangulation. The pair triangulations of one patch spread by 0.19 m
  (median).
- **Header-only placement has a systematic error.** Soil marks are a measurement independent of the patch
  detector, measured by phase correlation of soil-only windows between photographs. Legs flown in opposite
  directions were 1.87 m apart, across the track; consecutive photographs on one leg were 0.30 m apart. The error
  flips with heading, so it sits in the camera's own frame. A camera mounted about 2 degrees off the gimbal axes
  explains it, and so does an off-centre principal point. The header can carry neither.
- **The overlap calibrates it.** The estimate across settings is a tilt across the image of 2.0 to 2.2 degrees,
  along it of -0.1 to 0, and a spin of -0.5 to -0.6. The effective ground is 0.4 to 0.5 m above take-off. This is
  four numbers for the whole flight, not a per-photo correction.

| Soil-texture misregistration (independent check) | Header only | Calibrated |
|---|---|---|
| Same heading, consecutive photographs | 0.30 m | 0.15 to 0.21 m |
| Opposite headings, neighbouring legs | 1.87 m | 0.62 to 0.78 m |

- **Plants above the soil.** Small, low patches agree best: median ray miss 0.15 m, and the best quarter within
  0.07 m. Crowns over 1 m² miss by 0.27 m and triangulate at about 0.8 m above the soil. Their visible green
  centroid moves with the viewing angle. A flat-ground projection of a crown is therefore off by roughly
  (distance from the photo centre) x (crown height) / (camera height). Triangulating across photographs removes
  that.
- **Tried and dropped.** A sloped ground plane came out at 0.4 % east and made the soil check slightly worse, so
  the option exists but is off by default. Flight yaw in place of gimbal yaw was worse.

What is NOT shown: absolute accuracy against surveyed ground truth. Everything above is internal agreement between
photographs plus the RTK camera positions. The orthomosaic of this field was not available offline to compare
against.

## The four hardware problems, answered with this flight's numbers

1. **Pitch / roll / gimbal error.** Real, and the largest error here: about 2 degrees of camera-to-gimbal offset,
   worth about 0.9 m on the ground per photograph. It is constant for the flight, so the overlap measures it and
   removes most of it. Per-photo attitude jitter looks small: per-photo yaw offsets have a standard deviation of
   0.6 degrees, which includes the detector's noise. The attitude angles in the header are used for every photo;
   nothing assumes perfect nadir.
2. **Cheap GPS.** Not tested yet: this flight is RTK, so positions are good to centimetres. Without RTK, positions
   are off by metres, and differently per photo. The same overlap that measured the boresight can measure per-photo
   position offsets. Matched soil or patches between neighbours tie the photos together; the drone's GPS fixes the
   whole block on the map. That is "visual odometry" done as a joint adjustment rather than a chain: chaining photo
   to photo from one home point accumulates drift over a field. Averaging all the noisy GPS fixes through the ties
   does not drift. This keeps the orthomosaic's strength (images agree with each other) without building the
   mosaic.
3. **Lens distortion.** Handled in the model (Brown coefficients from DewarpData, or a checkerboard calibration);
   this camera dewarps in-camera. Residual distortion would show as disagreement that grows toward the frame edges.
   It is not separated out yet.
4. **Terrain.** The flat-ground answer moves a point by (distance from the nadir point) x (height error) / (flying
   height): 0.35 m at 25 m out for a 0.5 m error at 36 m. On this field the soil sits within about 0.5 m of take-off
   height. The module accepts a terrain function, and the same overlap gives heights directly (the triangulated
   heights above), so a coarse ground model from the photos themselves is the natural next ground model.

## Next steps, not built

- Calibrate on soil texture (the phase correlation used as the check) with half the photo pairs held out for
  checking. This should remove the remaining along-track offset between opposite legs, which a small pitch offset or
  a shutter timing delay would cause.
- Per-photo position adjustment from the overlap, to make non-RTK drones usable (problem 2). Test it by adding GPS
  noise to these RTK positions and measuring how much the overlap recovers.
- Run the existing row and planting-layout detectors per photograph and project rows and trees, not only green
  patches.
- Bring the viewer into the app (Weed Scout / Field View) once the result is accepted by eye.

## Sources

- Agroscope: single-image direct georeferencing by affine homography for dock detection, under 0.82 m at 30 m with
  an RTK drone (https://ira.agroscope.ch/en-US/publication/59424).
- ISPRS Archives 2025: multi-view plant detections projected by direct georeferencing and clustered, close to bundle
  block adjustment (https://isprs-archives.copernicus.org/articles/XLVIII-2-W11-2025/235/2025/).
- Niu et al., ISPRS Annals 2024: Phantom 4 RTK direct georeferencing without GCPs
  (https://isprs-annals.copernicus.org/articles/X-1-2024/169/2024/).
- Pix4D on DJI angle conventions (https://support.pix4d.com/hc/en-us/articles/202558969) and on dewarped frames
  (https://community.pix4d.com/t/undistorted-images-detected/34319).
- DJI SDK forum on the gimbal angle order and frame
  (https://sdk-forum.dji.net/hc/zh-cn/community/posts/14209771603353-What-order-are-gimbal-rotations-applied-in-Along-what-reference-frame).
