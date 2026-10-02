# Source frames for plant-level evidence (architecture review)

Status: review plus the smallest V0, 2026-10-01. The orthomosaic stays the map. This is
about reading a finding from the photograph that saw it, at the photograph's resolution.

Hypothesis under test: *the orthomosaic provides spatial understanding; the original
photographs provide the plant-level visual evidence.* Verdict at the end of this document:
**cannot be tested on any scan that exists today, for a reason that is cheap to fix.**

Everything below was read from the repository and from the mirrored ODM archive of a real
scan (Testing Field 2, `odm_tasks.odm_uuid = dd0f6314`, 180 frames, ODM 4.3.2). Nothing is
inferred from documentation alone.

## 1. What the repository keeps about source images

| Question | Answer | Where |
|---|---|---|
| Source metadata retained after upload | **Nothing in Postgres beyond `odm_tasks.image_count`.** The browser keeps a resume checkpoint (`name:size:lastModified` per file) in localStorage until the batch commits. The only durable per-image record is `images.json` inside the mirrored `all.zip`, written by ODM after processing. | `scanUpload.ts:88`, `odm-submit/index.ts` (init/upload/commit), `odm-poll/index.ts:183` |
| Source images retained | **No.** Frames are streamed to the ODM node and never written to our storage. The node purged both test tasks (`/task/<uuid>/info` returns "no task table entry"). `all.zip` holds no JPEG (0 image entries in 1,267). | `odm-submit/index.ts:112-144`, `odm-poll` |
| EXIF GPS preserved | **Yes.** The uploader extracts the EXIF segment before downscaling and re-inserts it. All 180 `images.json` records carry lat, lng, GPS altitude. | `imagePrep.ts:27-98` |
| Downscaling | **Yes, and this is the finding of the review.** Any file over 1.5 MB is re-encoded to a 2,400 px long edge at JPEG quality 0.82. These 5,472 x 3,648 frames went to ODM as 2,400 x 1,600 (2.28x fewer pixels per side, 5.2x fewer pixels). The originals are then discarded. | `imagePrep.ts:57-98` (`maxEdge = 2400`) |
| XMP preserved | **No.** Canvas re-encoding drops every APP1 segment; `piexif` re-inserts only the EXIF one. DJI/senseFly write relative altitude, gimbal pitch and flight yaw in XMP, which is exactly what `offrow/ingest.py:149-155` reads. `images.json` shows `yaw`, `pitch`, `roll` null for every frame. | `imagePrep.ts`, `images.json` |

Per field the user asked about: latitude and longitude, yes; GPS altitude (above sea
level), yes; altitude above ground, **no** (XMP); focal length, yes (ODM derived
`focal_ratio` 0.7778 from it); camera make and model, yes; yaw, pitch, roll, **no** (XMP);
timestamp, yes (`utc_time`); image dimensions, yes, both the uploaded (2,400 x 1,600) and
the camera's (`exif_width` 5,472 x 3,648, which survives in EXIF).

The orthomosaic-import path (`orthoImport.ts`, `ortho-import` function) has no frames, no
EXIF and no reconstruction. A finding on an imported mosaic can never have a source
observation. The record must say so rather than carry an empty list that reads as "none found".

## 2. Exactly what ODM gives us

Contents of `scans/<user>/odm/dd0f6314/all.zip` (1,163.6 MB), by relevance to this work:

| File | Size | What it is | Usable for |
|---|---|---|---|
| `odm_report/shots.geojson` | 87 KB | One feature per frame: optical centre as lon/lat/alt **and** UTM `translation`, `rotation` as an axis-angle vector (world to camera, OpenSfM convention), `camera` key, `capture_time`, `width`, `height`, `focal` | **Exact world to pixel projection.** The V1 geometry, already present. |
| `cameras.json` | 479 B | Calibrated lens: `brown` model, focal and principal point normalised by the longer side, k1 k2 k3 p1 p2 | Projection and footprints |
| `images.json` | 184 KB | ODM's parse of every frame's EXIF (fields listed in section 1) | Frame metadata table, blur estimate |
| `odm_georeferencing/coords.txt` | 9 KB | `WGS84 UTM 33N`, offset `324190 6006088`, then the GPS position of every frame in local metres | Cross-check only; shots.geojson already carries lon/lat |
| `odm_orthophoto/odm_orthophoto.tfw` | 6 lines | Ortho pixel to UTM: **0.0545 m per pixel**, origin 323934.94 E, 6006659.09 N | Ortho pixel to world (the ortho's true resolution) |
| `odm_report/stats.json` | 7 KB | 180 of 180 frames reconstructed, reprojection error 0.80 px, GPS error std 0.25 / 0.32 / 0.67 m (x y z), **average GSD 6.31 cm** | Trust and the ground-height estimate |
| `log.json` | 31 KB | ODM version 4.3.2 and every option: `orthophoto_resolution: 2.0` (requested; the tfw shows ODM clamped it to the real GSD), `dsm: false`, `dtm: false`, `fast_orthophoto: false`, `align: null`, `use_exif: false` | Knowing the orthophoto was not upsampled, and that no DSM exists |
| `odm_report/camera_mappings.npz` | 145 KB | A 1,600 x 2,400 undistortion lookup per camera model | Nothing for us; it is the report's lens map, **not** a per-pixel source index |
| `odm_georeferencing/odm_georeferenced_model.laz`, `entwine_pointcloud/` | 218 + 250 MB | The point cloud; z ranges 23 to 91 m across the site | Ground height, if read server-side (not on the client) |
| `odm_texturing/*` | 300 MB | Textured mesh | Not useful here |
| not present | | `opensfm/reconstruction.json`, `reference_lla.json`, `tracks.csv`, any DSM/DTM, any per-pixel source map | V2 multi-view work would want the first three; `dsm: true` produces the DSM |

Answers: camera positions, yes; camera orientations, yes; reconstruction metadata, yes;
georeferenced image footprints, **derivable** (not shipped; computed in V0 from the poses
and a ground height); image to orthomosaic transforms, derivable the same way; a
`shots.geojson`, yes; a reconstruction JSON, **no** (NodeODM's `all.zip` omits the
`opensfm/` directory). Which frames contributed to a given ortho pixel: **not recorded
anywhere**; it is computed by projecting the point into every frame, which is what V0 does.
Mapping a world coordinate to original pixel coordinates: **yes, exactly, for the uploaded
frame**, and by a fixed scale (5,472 / 2,400) for the camera's frame, since the lens is the
same and the intrinsics are normalised.

Verified on the data (`src/test/sourceFrames.test.ts`, fixture `src/test/fixtures/odm-dd0f6314`):

- The pose convention is OpenSfM's: `X_cam = R (X_world - C)`, camera looks along +z. All 180
  frames look down; this fixed wing carries no gimbal and sits a median **10.6 degrees, up to
  18.1 degrees, off nadir**. A footprint drawn as a rectangle under the GPS dot would be
  wrong by about 20 m at 118 m flying height.
- The ground point under each camera projects inside its frame, offset by exactly the tilt.
- Per-point GSD at the frame centre agrees with ODM's own average (6.31 cm) within 10%.
- Frame corners back-projected to the ground re-project to within 0.5 px.
- A point in the field is seen by many frames (80% forward overlap), and the ranking puts
  the frame that holds it nearest its centre first.

What could not be verified: a pixel. No photograph survives, so the projection has not been
checked against image content. That check is the first thing to run when a frame exists.

## 3. The resolution ladder for this scan (why the numbers in the brief were what they were)

| Stage | Pixel size | Note |
|---|---|---|
| Camera frame, 5,472 px, ~118 m AGL | **2.77 cm/px** | What the drone recorded. Discarded by the uploader. |
| Uploaded frame, 2,400 px | 6.31 cm/px | What ODM saw (its own `average_gsd`) |
| Orthophoto GeoTIFF | 5.45 cm/px | `tfw`; ODM clamps the requested 2.0 cm to the GSD |
| Map tiles, z20 at 54 N | 8.7 cm/px | What the scout's base pass and the patch test read |
| Sweep, z21 | 4.3 cm/px | Resampled from 5.45 cm content; no new detail |

So the orthomosaic lost almost nothing relative to the frames it was built from. The
detail the hypothesis counts on exists only in the frames we throw away in the browser.
On this scan, native frames would put **2.3x more pixels across a plant** than the ortho
(5.2x more pixels on it): a 10 cm seedling goes from 2 px to 4 px. Still far from the 2 cm/px
the classifier was trained toward; worth having, not a cure.

## 4. Proposed lookup pipeline

```
finding (centroid lat/lng, radius)            from weed_observations / the scout candidate
  -> ground height                            V0: median camera alt - ODM average flying height
                                              V1: sample the DSM (dsm: true)
  -> project into every posed frame           src/lib/sourceFrames/odm.ts  (done)
  -> keep frames that hold the whole finding  select.ts: coverage
  -> score                                    centrality, resolution, view angle, motion blur
                                              (pixel terms null until frames exist)
  -> best frame + pixel (u, v) + GSD          (done)
  -> crop at native scale                     needs the frame: blocked, see section 7
  -> classify the crop                        unchanged weed-v1; the record says where pixels came from
  -> attach to the finding                    source_observations on the row
```

V0 (geotag + estimated footprint) was **not built**: the poses are in every `all.zip`, and
the measured 10 to 18 degree tilt makes the geotag footprint wrong by tens of metres. The
brief's rule applies: no approximate geometry where ODM provides the exact kind.

V1 (poses + intrinsics) is what `src/lib/sourceFrames/` implements, with one named
approximation, the ground height, and one named gap, pixel validation.

V2 (multiple frames, fusion): the selection already returns every frame that holds the
finding, ranked. Fusion of classifier outputs across the top three is a later step and needs
the frames first. Consistency across views would also be the honest "projection confidence"
term: a finding whose crops from three frames do not look alike has a geometry or a height
problem.

Trade-offs: the ground-height error moves a projection by `(distance from frame centre /
flying height) x height error`; at the frame edge that is 0.6 m per metre of height error,
at the centre nearly zero. The selector's centrality term is there for that reason. A DSM
removes it; it costs ODM time and `dsm: true` on the commit options.

## 5. Schema

Proposal only; nothing applied. Follows the existing rule that every stored number says
where it came from.

```sql
scan_frames                               -- one row per photograph that went into a scan
  scan_id uuid REFERENCES odm_tasks, filename text, PRIMARY KEY (scan_id, filename)
  storage_path text                       -- null until frames are retained
  bytes bigint, sha256 text
  width int, height int                   -- the stored file
  exif_width int, exif_height int         -- what the camera produced
  downscaled boolean NOT NULL             -- width < exif_width
  camera_make text, camera_model text
  lat, lng, gps_altitude_m                -- EXIF; relative_altitude_m, gimbal_pitch_deg, yaw_deg
  relative_altitude_m, gimbal_pitch_deg, yaw_deg, pitch_deg, roll_deg   -- null unless XMP survived
  focal_mm, focal_35mm, exposure_s, iso, f_number, captured_at timestamptz

scan_reconstructions                      -- one row per scan: what ODM recovered
  scan_id uuid PRIMARY KEY
  odm_version text, options jsonb
  cameras jsonb                           -- cameras.json verbatim
  shots jsonb                             -- shots.geojson features (87 KB for 180 frames)
  reference_lat, reference_lng, reference_alt_m
  average_gsd_cm, reprojection_error_px, gps_error_m jsonb
  ground_altitude_estimate_m, ground_altitude_basis text   -- 'odm_average_gsd' | 'dsm'
  dsm_path text                           -- null until dsm: true
  extracted_at timestamptz

weed_observations
  + source_observations jsonb             -- [{filename, u, v, gsd_m, native_gsd_m, score, parts, fully_inside}], best first
  + source_views int                      -- how many frames held the centroid; null = not computed; 0 = none
  + inference_source text                 -- 'orthomosaic' | 'source_frame'; which pixels the stored prediction saw
  + inference_frame text, inference_gsd_m numeric
```

The normalised prediction (`classify/types.ts`) gains `source: { kind, frame, effectiveGsdM }`
so a stored prediction always says where its pixels came from, and later comparisons can
split model performance by source. `verdict_source` stays the ground-truth filter.

For the prototype library (`weed-identification-database-first.md`): `weed_prototypes`
already has `gsd_m`, `camera_key`, `altitude_m`, `view` and `origin_observation_id`. A
retained native crop becomes a prototype with `gsd_m = native_gsd_m` and the frame's
metadata; nothing in that schema has to change.

## 6. Minimal V0, what is built and what is next

Built (pure library, no pipeline or UI change, 13 tests on the real reconstruction):

- `src/lib/sourceFrames/odm.ts`: parse `cameras.json`, `shots.geojson`, `images.json`;
  `projectToFrame` (world to pixel with brown distortion), `pixelToGround`,
  `frameFootprint`, `offNadirDeg`, `groundAltitudeFromOdm`. Refuses fisheye and spherical
  lenses rather than projecting them wrong.
- `src/lib/sourceFrames/select.ts`: `selectFrames(set, finding)`: every frame that holds the
  centroid, whether the whole finding is inside, per-frame GSD in the uploaded and the
  camera-native frame, motion blur from speed and shutter, a score whose parts are named and
  whose unavailable parts (sharpness, exposure, occlusion) are null, best first.

Decided 2026-10-01 (founder): keep the originals in SwathWise storage, keep sending the
2,400 px copy to ODM, preserve every byte of metadata, no DSM until the flat-ground
approximation is shown to fail, no threshold or species work. Built the same day:

1. **Originals are kept** (`scanUpload.ts`). Each file goes to the `scans` bucket under
   `<user>/<scan>/frames/<name>` exactly as the camera wrote it (no decode, so EXIF and XMP
   survive), *before* the 2,400 px copy goes to ODM; a frame that cannot be kept is not sent
   on. `frames.json` next to them maps the camera's filename (what ODM's `images.json` uses)
   to the storage key, with size and type. Resume remembers which originals landed. Cost on
   this camera: about 1.4 GB per 180 frames.
2. **The reconstruction is read from the archive on first open** (`sourceFrames/scan.ts`).
   The four small members are pulled out of the mirrored `all.zip` with range requests on a
   signed URL (`zipRange.ts`: end-of-central-directory, central directory, member; zip64
   aware) and stored under `<user>/odm/<scan>/reconstruction/`; later opens read those. No
   edge function, no migration, and it works on every scan that has an archive, including
   the old ones with no frames.
3. **The popup says what the frames can offer** (`sourceFrames/spot.ts`, `SpotPopup`
   "Measurements"): how many frames saw the spot, the best one and its pixel, tilt, edge
   distance and blur estimate, and the spot's width in pixels in the ortho chip, the uploaded
   frame and the camera's frame. When there is nothing it says why: imported mosaic, no
   archive, not seen, or "the original was not kept for this scan".
4. **The side-by-side** (`sourceFrames/crop.ts`, `WeedScoutTab.compareNative`): with the
   original kept, cut the same ground span around the projected pixel at native scale, score
   it with the same weed-v1, and show both chips with GSD, spot width and the model's
   number. Nothing is saved. Exercised only by unit tests until a scan with kept frames
   exists; the first such scan must also be used to validate the projection on real pixels
   before the comparison is read.

Still ahead: `dsm: true` only if sloped fields show the ground-plane error; a persisted
`inference_source` on stored predictions once the comparison has been looked at.

### Validated on real pixels (2026-10-02)

Scan `cf8f8230` ("Weed detection Test Field", 189 senseFly S.O.D.A. frames, originals kept
after the fact with "Keep original photos": 187 of 189 landed at 5,472 x 3,648). The
projection check: take frame 0097's centre pixel, intersect its ray with the estimated
ground plane (ODM average GSD implies 56.9 m), project that point into the three best
other frames (tilts 11, 21 and 28 degrees, edge distances 136 to 514 px), cut 700 px at
native scale around each projected pixel.

Result: every crop shows the same ground, the crosshair on or between the same pair of
wheel tracks with the same pale patch beside them. The spread between frames is about
30 to 50 cm (25 to 40 native pixels), the size of error a 1 m ground-height mistake makes
at 28 degrees of tilt, and no worse. So the poses, the lens model and the pixel
conventions are right, and the remaining error is the ground height, as predicted. At
1.2 cm/px the individual plants in the pale patch are resolved; the ortho chip of the same
ground at 5.5 cm/px shows a smear.

Not yet done: a DSM would take the residual down; it is not needed until a sloped field
shows the ground-plane error mattering. The check script lives in the scratch tooling
for now and should become a repo test when a second scan with originals exists.

## 7. Diagnostic plan: orthomosaic crop against native crop

For each candidate the scout produces on a scan with retained frames:

```
Finding <id>                  kind, diameter, centroid
ORTHOMOSAIC                   chip at sweep zoom: GSD, target width in px, Laplacian variance, weed-v1 p
SOURCE FRAME <filename>       crop at native scale: GSD, target width in px, Laplacian variance, weed-v1 p
                              view angle, edge distance, blur estimate, frames that saw it
```

Developer-only, inside the existing Weed Scout popup's "Measurements" disclosure, plus one
CSV export per scan for the batch comparison. Measured over a scan:

- target width in pixels, ortho vs native (expected ratio 2.3 on this camera);
- sharpness (variance of the Laplacian on the vegetation mask), ortho vs native;
- weed-v1 `pWeed` on both, and whether the distribution separates by operator verdict
  (`verdict_source = 'operator'` rows only): report AUROC for each source;
- a human read: for 30 to 50 findings, can a person tell what it is from the ortho chip, from
  the native crop, from neither.

Threshold stays where it is until that table exists.

## 8. Image footprint visualisation

Supported by what exists: camera dots (`shots.geojson` points), flight path (dots in
`capture_time` order), footprint when selected (`frameFootprint`, with the ground-height
caveat drawn as what it is), "which frames saw this finding" (`selectFrames`). All of it
needs the reconstruction persisted (section 6, step 2); none of it needs the frames. Not
built in this pass.

## 9. Blockers and missing metadata

1. **No source frame exists for any scan**, in storage or on the node. The crop and the
   side-by-side cannot run until step 1 of section 6 ships and a scan is flown through it.
2. **The uploader destroys 5.2x of the pixels** the hypothesis depends on.
3. **XMP is dropped**, so altitude above ground, gimbal pitch and yaw are gone; the
   reconstruction recovers pose anyway, but the EXIF-level blur and altitude checks in
   `offrow/ingest.py` cannot run on uploaded frames.
4. **No DSM**: ground height is estimated, with the error stated above.
5. **No `opensfm/` directory** in `all.zip`: V2 (tracks, per-pixel source) would need it; the
   node would have to be asked for it separately while the task still exists.
6. Imported orthomosaics carry nothing; the record must say "no frames", not "none found".
7. Pixel validation of the projection is pending until one frame exists.

## 10. Recommendation

Yes, it can be added without destabilising anything, and the review changes what to do first.

- The lookup is a pure module that reads files ODM already produces; the pipeline, the
  verdict contract and weed-v1 are untouched. Shipped as V0 with its tests.
- The decision that matters is not architectural: **keep the originals**. Until then every
  "native" crop would come from a 2,400 px frame and show the same 6 cm/px the ortho already
  has, and the comparison would prove nothing.
- The hypothesis itself is plausible on the arithmetic (2.3x) and unproven on pixels. It
  gets its test on the next flight, the same flight the detection foundation and the species
  layer are waiting for, provided the frames from it are kept.
