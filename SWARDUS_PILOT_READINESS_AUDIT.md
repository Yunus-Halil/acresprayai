# Swardus: Founding Pilot Readiness Audit

2026-11-09 · read-only audit · nothing in the application was changed

## How to read this document

**What was audited.** Production `origin/main` at `736e06c`. The working branch `experiment/weed-vision-preview` (`8f33971`) has identical `src/`, `supabase/` and `vercel.json`; it adds only research scripts. The local `main` branch is stale (`9d61508`, 2026-10-23, 150 files behind) and was ignored.

**How.** Six independent read-only investigations, plus my own reading:
- security and data ownership;
- routes, navigation and design;
- Field Twin and Swardus Direct;
- the orthomosaic pipeline and spray tools;
- telemetry, feedback and pilot administration;
- reachability, dead code and dependencies.

Every Critical or High claim below was re-checked in the code by hand before it went in. Where two investigations disagreed, the code decided. For example, one review reported the `odm-asset` function as dead, but `src/pages/app/FieldDetail.tsx:153` calls it.

**Health signal.** `npx vitest run` gave:

| Result | Count |
|---|---|
| Test files | 169 |
| Tests passed | 2,255 |
| Skipped | 2 |
| Runner timeout errors | 1 |

The timeout is an RPC timeout under load, not a failing assertion.

**Evidence labels.**
- **[V]** verified in the code, with a file reference.
- **[I]** inferred from the code or the docs, not observed.
- **[D]** can only be checked in the Supabase dashboard, on Vercel, or live.

The Supabase connector was not authorised in this session, so no [D] item was checked. Nothing was tested in the live app.

---

## 1. Executive assessment

**Verdict: Swardus is not ready for an unaccompanied external pilot. It is ready for a founder-guided demonstration on known data.** The distance between the two is mostly product shape, access control and plumbing, not algorithms.

Today Swardus is closer to **A, a collection of engineering tools**, than to B, a coherent agricultural platform. A B-quality core is hidden inside it.

1. **The product your pilot journey describes exists, but no pilot can reach it.**
   - The journey runs photographs, then a Field Twin, then evidence, then verdicts, then reopening the work. That product is the Field Twin (Swardus Direct).
   - It is shown to exactly one hard-coded Gmail address (`src/lib/fieldTwin/reviewers.ts:3`) [V].
   - Every other account gets "The Field Twin is a prototype under review and is not open on this account yet." (`src/pages/app/FieldTwin.tsx:143-150`) [V].
2. **What a pilot account actually sees is a different product.** It is an orthomosaic and spray-operations workspace:
   - a Dashboard of spray KPIs, Drone Fleet, Spray Conditions and Schedule;
   - OpenDroneMap processing and Weed Scout;
   - a Flight Planner that exports a DJI Agras "prescription".

   It also has problems of its own:
   - a banner telling readers to remove it "before anyone outside the test uses it";
   - developer switches open to every user;
   - research vocabulary throughout;
   - an export path on which a spot nobody reviewed can end up in a spray file (section 6).
3. **The Field Twin itself is missing the pilot's essentials:**
   - no way to mark a finding correct or wrong;
   - no feedback channel;
   - no safe, automatic saving;
   - a saved-work list that shows internal ids and overwrites silently;
   - no accuracy statement in the viewer;
   - no check of the photographs before a build.
4. **Security.** Table-level row security is sound. Two edge-function flaws allow cross-account imagery access in principle (C1, C2), and signup is not enforced on the server.
5. **Operations.** There is no product telemetry, no error reporting, no in-app feedback, and no terms, privacy or consent text anywhere.
6. **The biggest technical unknown.** The Corn Field Twin has never been run on a real DJI corn flight with real photo headers. Its test twins are UAV3DCrop scenes with written-in headers [V `docs/features/corn-v1-field.md`].

**The five moves that matter most:**
1. Make the Field Twin the one pilot product. Hide, do not delete, the orthomosaic and spray workspace for pilot accounts.
2. Fix C1 and C2, and close signup on the server.
3. Make the twin journey whole:
   - a photo check before the build;
   - automatic saving into a real list of saved twins;
   - finding verdicts;
   - feedback;
   - an accuracy statement.
4. Add first-party build-outcome and error events, plus pilot terms with consent.
5. Build one real DJI corn flight end to end in a production browser before inviting anyone. Ideally the flight comes from Crop Compass or University of Maryland Extension. Write the operating envelope from that run.

### Readiness of each journey step today

| # | Journey step | Today | State |
|---|---|---|---|
| 1 | Invitation and access | `/apply` stores an application. There is no approve, no invite and no password set or reset. Google sign-in can create any account unless the dashboard switch is off [V, D]. | Broken |
| 2 | Understand Swardus and supported imagery | No onboarding and no "what imagery works" page. The landing page promises outputs a pilot cannot reproduce. | Missing |
| 3 | Upload photographs and field info | Exists in the Field Twin builder but is gated to one email. DJI photographs only. Crop is orchard or corn, defaulting to orchard. No photo check before the build [V]. | Gated, fragile |
| 4 | Process into a Field Twin | Runs in the browser. Work is lost if the tab closes. Saving needs an extra click [V]. | Works for the founder |
| 5 | Explore geometry, findings, uncertainty, photos | Good viewer with 112 px evidence crops. "Verified" means seen twice, which is easy to misread. Absolute accuracy is not shown [V]. | Mostly there |
| 6 | Mark findings correct, questionable or incorrect | Does not exist for twins [V]. | Missing |
| 7 | Report issues and feedback | No in-app channel. The only contact is a mailto link on the landing page [V]. | Missing |
| 8 | Reopen saved work | Works from any device. But the list shows raw ids, same-name twins overwrite each other, half-saved twins break, and boundary edits stay in one browser [V]. | Unreliable |

---

## 2. Map of the application today

### 2.1 Runtime picture

```
Browser (Vite + React SPA, PWA, hosted on Vercel)
│
├─ Public:   /  (landing)   /apply  (pilot application)   /auth  (sign-in: Google or email+password)
├─ Admin:    /admin/pilot-applications   (read-only list; edge function checks an email allowlist)
│
├─ STACK A: orthomosaic + spray operations (what every account sees)
│    /app (Dashboard) · /app/fields · /app/fields/:id (flight plan, upload, scan list)
│    /app/orthomosaic/:taskId  (opens in a NEW TAB, own chrome)
│        tabs: Field View · Weather · Weed Scout (or Treatment Grid) · Flight Planner · Reports · Flight Log · Settings
│    /app/fleet · /app/weather ("Spray Conditions") · /app/schedule
│
├─ STACK B: Swardus Direct / Field Twin (one reviewer email only)
│    /app/field-twin → TwinBuilder (Web Worker + helper pool, all in the browser) → FieldTwinView
│
├─ Developer surfaces: /app/photo (Photo Scout) · /app/weeds (Weed Library), registered for every user, linked
│    only when the per-browser "Developer tools" switch is on · /app/weed-vision and /dev/field-twin (dev builds only)
│
└─ Shared intelligence libraries (used by both stacks):
     lib/photoScout/pattern (pattern pass) · lib/weedVision/{fieldRows, layout/*, pressure, hotspots} ·
     lib/directGeoref (camera model, soil ties, colour weed rules) · lib/rowCrop (Corn V1 + stage readers) ·
     lib/cropProfiles · lib/plantingPractice · lib/sourceFrames

Supabase
  Auth ............ email/password + Google OAuth; handle_new_user creates a profile for anyone
  Postgres ........ about 27 tables, all user tables RLS'd by auth.uid() = user_id; no organisations
  Storage ......... scans, orthos (also holds Field Twins), tiles, field-reports, weed-chips, ground-truth (leftover)
  Edge functions .. odm-submit, odm-poll, odm-asset, ortho-import, ortho-url, bake-tiles, tile, ndvi-tile,
                    bench-detect, weather, pilot-apply, pilot-applications

External services
  ODM processing node (NodeODM / WebODM Lightning, paid by the token holder) · titiler.xyz (public demo service,
  renders tiles from signed ortho URLs) · OpenWeather / Open-Meteo · RainViewer · Nominatim · OSM tiles (twin
  surroundings) · Resend (pilot emails) · Roboflow (bench-detect) · local Python weed service on 127.0.0.1:8765
  (development builds only)
```

### 2.2 How the two stacks differ

| | Stack A: orthomosaic workflow | Stack B: Field Twin (Swardus Direct) |
|---|---|---|
| Input | 5 to 200 drone images sent to ODM, or a finished GeoTIFF | Original DJI photographs, from 2 photographs up with no upper limit |
| Compute | Paid ODM node; tiles rendered by titiler.xyz | The user's browser: one worker and up to 6 helpers |
| Who drives the jobs | The open browser polls every 5 s; there is no cron anywhere in `supabase/` [V] | The open tab; nothing is resumable [V] |
| Stored | Raw photos, all.zip, orthophoto, tiles (up to about 80k per scan), reports, chips | twin.json.gz plus evidence atlases in `orthos/<uid>/field-twins/<id>/`, about 52 MB on the apricot twin. Raw photos are never uploaded [V] |
| Record of it | An `odm_tasks` row | **None.** Twins are found by listing a storage folder [V `src/lib/fieldTwin/store.ts:46-51`] |
| Crops | Orchard lattice; corn through the map-level pattern pass | Orchard (planting layout and colour weed rules) or corn (Corn V1 over every photograph) |
| Operator corrections | Weed Scout verdicts, hotspot reviews, planting-layout verdicts and the treatment grid, mostly on the server | Boundary accept or correct only, in localStorage [V] |
| Linked to Fields | Yes, the root object | No [V] |

### 2.3 Size and shape

| Measure | Value |
|---|---|
| src/ lines | 124.5k in 569 files (91.4k non-test) |
| Files reachable at runtime | 350 |
| Unreachable non-test files | 50 files, 5.3k lines |
| Main JS chunk, loaded on every visit including the landing page | 3.6 MB raw, about 1.1 MB gzip [V `dist/assets/index-CA99Ti77.js`, built 2026-11-05 from HEAD] |
| Largest components (lines) | `PlannerTab` 2,391 · `photoScout/pattern` 1,846 · `ReportsTab` 1,728 · `WeedScoutTab` 1,480 · `readRowCrop` 1,469 |

The main chunk contains Corn V1, Weed Scout, Leaflet, jsPDF, html2canvas and recharts.

---

## 3. Feature inventory

**Actions:**
- **KEEP**: essential for the pilot.
- **IMPROVE**: needed, but needs work.
- **HIDE**: keep in the codebase, keep out of the pilot user's experience.
- **DEPRECATE**: superseded; phase out.
- **INVESTIGATE**: unclear.

"Exposed" means visible to an ordinary signed-in account today. No action below deletes Corn V1, orchard code, research capability, or anything a newer system imports.

### 3.1 Access, shell and platform

| Feature | Where | Exposed | State | Superseded by / depends on | Action and reason |
|---|---|---|---|---|---|
| Landing page | `src/pages/Index.tsx`, `src/components/landing/*` | Public | Works. Says "closed testing, invite only". Promises "Each weed, outlined… Back to the photographs" [V]. | Sells Field Twin output | **IMPROVE**: claims must match what a pilot can reproduce |
| Pilot application | `src/pages/PilotApply.tsx`, `supabase/functions/pilot-apply`, table `pilot_applications` | Public | Works. Has the stale option "This fall (Aug–Oct)", no captcha or rate limit, and emails any supplied address [V]. | Resend | **IMPROVE**: refresh options, add abuse limits |
| Old waitlist | table `pilot_signups` | Anon insert | Dormant | Superseded by `pilot_applications` | **DEPRECATE** |
| Sign-in | `src/pages/Auth.tsx`, `src/lib/auth.tsx` | Public | Email and password plus Google. No password reset, magic link or invite acceptance [V]. | Supabase Auth | **IMPROVE** (P0) |
| Route guard | `src/components/RequireAuth.tsx` | All of /app | Checks for any session, never for approval [V] | — | **IMPROVE**: add a participant check |
| Admin applications page | `src/pages/admin/PilotApplications.tsx`, `functions/pilot-applications` | URL only | Read-only list. The edge function allowlist defaults to `yunus@swathwise.com` (`pilot-applications/index.ts:30`) [V]. | — | **IMPROVE**: becomes the founder pilot page |
| App shell and nav | `src/components/app/AppLayout.tsx` | Yes | Dashboard, Fields, Drone Fleet, Spray Conditions, Schedule. Field Twin for one email. Developer links by localStorage flag. Fixed 240 px sidebar, no mobile layout [V]. | — | **IMPROVE**: one pilot navigation |
| Dashboard | `src/pages/app/Dashboard.tsx` | Yes | "Operations Dashboard" of spray KPIs; no onboarding [V] | Stack A | **HIDE** for pilots; a pilot home replaces it |
| Units prompt and preference | `UnitsPrompt.tsx`, `lib/unitPreference.ts` | Yes | Works; synced to the profile [V] | — | **KEEP** |
| Developer mode flags | `src/hooks/useDeveloperMode.ts`; switches in Settings, "5. Analysis system" (`SettingsTab.tsx:370-415`) | **Yes, to every user** [V] | Swaps the analysis system and adds developer navigation | — | **HIDE**: founder role only |
| Error boundary | `src/components/app/TabErrorBoundary.tsx` | One tab only: Weed Scout, in `OrthomosaicViewer.tsx` [V] | A render error anywhere else blanks the page | — | **IMPROVE**: top-level boundary plus reporting |
| PWA service worker | `vite.config.ts` | Yes | Precache budget raised to 8 MB to fit the single chunk | — | **KEEP**; revisit with code splitting |
| Weather function | `functions/weather` | Yes | Works without a key through Open-Meteo. **No user check** [V]. | — | **IMPROVE**: authenticate |
| 404 page | `src/pages/NotFound.tsx` | Yes | Works | — | **KEEP** |

### 3.2 Field Twin and Swardus Direct (Stack B)

| Feature | Where | Exposed | State | Superseded by / depends on | Action and reason |
|---|---|---|---|---|---|
| Field Twin page | `src/pages/app/FieldTwin.tsx` | One email | A saved-twin dropdown of raw ids, "Add a twin from files", and "Build a twin from photographs" [V] | Store, builder, viewer | **IMPROVE**: becomes the pilot home and detail page |
| Reviewer gate | `src/lib/fieldTwin/reviewers.ts` | — | A hard-coded Gmail address, shipped in the bundle; the gate is UI-only [V] | — | **DEPRECATE** in favour of a server-side role |
| Builder panel | `src/components/app/fieldTwin/TwinBuilder.tsx` | One email | Picks files or a folder, a field name, a crop (orchard by default, or corn) and a weed tier. Uses research copy such as "soil ties", "atlases", "RF-DETR… on this GPU" and "Corn V1 3 to 7 s each" [V]. | Build pipeline | **IMPROVE**: photo check, no weed-tier choice, plain copy |
| Build pipeline | `src/lib/fieldTwin/build/*` (`runBuild`, `worker`, `pool`, `pipeline`, `cameras`, `rows`, `weeds`, `corn`, `bundle`) | Through the builder | Works on the apricot P4 RTK flight (71 photos) and on UAV3DCrop corn scenes with written-in headers. The test suite runs a real 4-photo corn build (28.7 s). There is no cap, and a dense solver wall is derived at about 300 to 500 photos [V, I]. | directGeoref, weedVision layout, photoScout pattern, rowCrop | **IMPROVE**: limits, reported refusals, cancel |
| DJI header reader and camera model | `src/lib/directGeoref/{metadata,frame,projection,adjust}.ts` | Through the build | Requires the DJI `drone-dji:` XMP fields (RelativeAltitude and gimbal angles), so every non-DJI make is refused [V]. A photo with no focal data drops silently and is not counted (`cameras.ts:43-51,138`) [V]. | — | **IMPROVE**: report every refusal |
| TIFF and P4 Multispectral input | `src/lib/fieldTwin/build/tiffPhotos.ts` | Through the build | Built. The band-shift sign is unverified and no real TIFF set has been run [V]. | geotiff | **HIDE** for the pilot (JPEG only) |
| Colour weed rules (orchard) | `directGeoref/green.ts`, `build/weeds.ts` | Through the build | Works in the browser. On a row crop it would call the crop "weeds" [V `pipeline.ts` comment]. | — | **KEEP**, for orchards only |
| Model weed tier (RF-DETR) | `lib/weedVision/client.ts`, through the local service | Dev builds only [V] | Needs 127.0.0.1:8765 | MaSC server tier (unshipped) | **HIDE** (already hidden at runtime) |
| Corn Field Twin | `build/corn.ts`, `lib/fieldTwin/cornField.ts`, `cornView.ts`, `CornPanels.tsx` | One email | Shows corn rows, weed candidates (confirmed, unconfirmed, contested) and stand gaps (confirmed, withheld), labelled review-only (`CornPanels.tsx:55,126`). **Never run on a real DJI corn flight.** Corn twins get no cultivated block [V]. | Corn V1 | **IMPROVE**: real-flight validation (P0) |
| Cultivated block inference | `src/lib/fieldTwin/boundary.ts`, `boundaryEvidence.ts` | One email | Works on the apricot flight (confidence 0.89). "Accept for operations" feeds nothing and is kept in localStorage [V]. | — | **IMPROVE**: store on the server; rename the button |
| Viewer (map, canvas layer, detail dial) | `FieldTwinView.tsx`, `TwinMap.tsx`, `TwinCanvasLayer.ts`, `lib/fieldTwin/style.ts` | One email | Simple, Standard and Full presets; Full adds Diagnostics [V] | Leaflet; OSM tiles straight from tile.openstreetmap.org | **KEEP**; pilots get Simple and Standard only |
| Explore Findings and heatmap | `FindingsPanel.tsx`, `lib/fieldTwin/{findings,heatmap,intelligence}.ts` | One email | Works for orchard. **Hidden on corn twins** [V `FieldTwinView.tsx:135,227-228`]. | — | **KEEP** |
| Inspector and evidence crops | `TwinInspector.tsx`, `EvidenceCrop.tsx` | One email | Crops from the original photos with the outline drawn on, stored at 112 px. There is no full-photo view [V]. | Atlases | **IMPROVE**: verdict buttons; decide the crop size |
| Reference orthomosaic | `FieldTwin.tsx:51-57`, under Full and then Diagnostics | Reviewer, in production | Lists the account's ODM scans [V] | Stack A tiles | **HIDE** |
| Twin store | `src/lib/fieldTwin/store.ts` | Through the page | Private per account. The id is a slug of the name plus the date, saved with `upsert: true`, so the same name on the same day overwrites [V `build/types.ts:109-114`, `store.ts:86`]. A half-finished save is listed and fails to open [V]. | `orthos` bucket | **IMPROVE**: registry table (P0) |
| Twin format | `src/lib/fieldTwin/types.ts` (`swardus-field-twin-v1`) | — | Strict check, no migration path [V] | — | **IMPROVE** (P1 version policy) |
| Dev twin preview | `src/pages/app/FieldTwinDevPreview.tsx`, `/__field-twin/` | Dev builds only [V] | Benchmark and screenshot tooling | — | **KEEP** (internal) |

### 3.3 Corn and crop intelligence

| Feature | Where | Exposed | State | Superseded by / depends on | Action and reason |
|---|---|---|---|---|---|
| Corn V1 (frozen baseline) | `src/lib/rowCrop/cornV1.ts` (fuses `adaptive.ts`, `greenPoints.ts` and `plantRows.ts`); tag `corn-v1.0`, branch `release/corn-v1` | Through Photo Scout (developer) and the twin (reviewer) | Review-only and curated. "Nothing tells corn from beet by look" [V]. | Field Twin corn | **KEEP**, frozen; no tuning during the pilot |
| Stage readers (emergence, establishment, mid, late) | `rowCrop/readRowCrop.ts`, `emergence.ts`, `fineSeedlings.ts`, `assess.ts` | Through Corn V1 and Photo Scout's stage selector | Layered under Corn V1 [V] | Corn V1 depends on them | **KEEP** as infrastructure; hide the forced stage selector |
| Photo Scout | `src/pages/app/PhotoScout.tsx`, `lib/photoScout/*` | Route open to every account by URL; nav link only with Developer tools [V] | Single-photo read; nothing saved. Its own header says it is for tuning [V]. | `photoScout/pattern` is used by Weed Scout and the twin | **HIDE** the page; keep the libraries |
| Crop profiles | `src/lib/cropProfiles/`, `crop-profiles/` | Indirect | Corn profile is experimental | Used by the pattern pass, grade and twin | **KEEP** |
| Orchard planting layout (lattice from 3 clicks) | `lib/weedVision/layout/*`, `CropRowsPanel.tsx`, table `field_planting_layouts` | In Weed Scout | Accepted on the real apricot map [V memory, I] | Used by the twin build (`build/rows.ts:7-10`) | **KEEP** |
| Planting practice catalogue | `src/lib/plantingPractice.ts` | Indirect | — | Layout | **KEEP** |
| Field rows from the whole map | `lib/weedVision/fieldRows.ts`, `patternRows.ts` | Indirect | — | Grade, hotspots, twin | **KEEP** |
| Nine vegetation and green masks | `directGeoref/green.ts`, `weedScout/vegetation.ts`, `photoScout/pattern.ts`, `weedVision/fieldRows.ts`, `rowCrop/seedlingGreen.ts`, `rowCrop/readRowCrop.ts`, `weedScout/sizing/segment.ts`, `weedVision/snap.ts`, `weedVision/register.ts` | — | Parallel implementations [V] | Corn V1 is frozen on some of them | **INVESTIGATE** after the pilot, only behind equivalence tests |
| Two production corn row paths | Corn V1 (Photo Scout, Corn twin), and the lattice pattern pass through `patternRows` (map Weed Scout, grade) [V] | — | Results can diverge | — | **INVESTIGATE** after the pilot |

### 3.4 Orthomosaic workflow (Stack A)

| Feature | Where | Exposed | State | Superseded by / depends on | Action and reason |
|---|---|---|---|---|---|
| Fields list and create | `src/pages/app/Fields.tsx`, `lib/fields/` | Yes | Works. Shows the Virginia banner to everyone (`lib/weedCatalog/region.ts:31-34`) [V]. | Root of Stack A | **HIDE** for pilots; **KEEP** in code |
| Field page | `src/pages/app/FieldDetail.tsx` | Yes | Survey plan, upload and scan list. Warns "Progress only advances while the app is open" (`:580`) [V]. | — | **HIDE** for pilots |
| Survey flight planner (KMZ) | `FlightPlanCard.tsx`, `FlightPlanModal.tsx`, `lib/flightPlan/*`, `lib/wpml.ts` | Yes | Air 3S enum read from a KMZ, "not flight tested" (`flightPlan/camera.ts:55-64`). No ground pixel size shown [V]. | — | **HIDE**; P2 flight guide for twins |
| ODM upload, submit and poll | `lib/scanUpload.ts`, `lib/odmOptions.ts`, `functions/odm-submit`, `odm-poll` | Yes | Works while a browser polls. No quota, and `commit` forwards client-supplied options to ODM [V]. | Paid ODM node | **HIDE** for pilots; quota and cron only if it returns |
| Ortho import (GeoTIFF) | `ImportOrthomosaicForm.tsx`, `lib/orthoImport.ts`, `functions/ortho-import` | Yes | Built; manual QA still owed [I] | ortho-url, bake-tiles | **HIDE**; likely route for historical imagery later (P2) |
| ortho-url, bake-tiles, tile, ndvi-tile | `supabase/functions/*` | Indirect | Work. Depend on the free public titiler.xyz, which receives 6-hour signed URLs of farm imagery [V]. Affected by **C1** (section 6). | — | **IMPROVE**: security fixes now, TiTiler decision later |
| odm-asset proxy | `functions/odm-asset` | Indirect, through the probe at `FieldDetail.tsx:153` | **C2** path traversal [V] | Could fold into ortho-url | **IMPROVE** now; **INVESTIGATE** folding it in |
| Orthomosaic workspace | `src/pages/app/OrthomosaicViewer.tsx` | Yes, in a new tab | Seven tabs. The footer shows "scan <uuid>" and "build <sha>" [V]. | — | **HIDE** for pilots |
| Field View, compare, timelapse | `workspace/FieldViewTab.tsx`, `ScanTimeline.tsx`, `SwipeCompare.tsx`, `Timelapse.tsx` | Yes | Works; some layers labelled "experimental" [V] | — | **HIDE** for pilots |
| Weed Scout, simple view (default) | `components/app/weedVision/SimpleWeedFinder.tsx` | Yes | No "Find weeds" button in production because the model is dev-only; only rows, hotspots and the pressure grade. Never run on a real scan [V, I]. | — | **HIDE** for pilots |
| Weed Scout, advanced view ("Show all options") | `workspace/WeedScoutTab.tsx`, `ScanSummary.tsx`, `lib/weedScout/*` | Yes | Research parameters (z-thresholds, sweep windows), default verdicts, and "Save N spots and open the Flight Planner" [V] | — | **HIDE**; fix the default-verdict path before it returns |
| Baseline detector and Benchmark panel | `BenchmarkPanel.tsx`, `CloserLook.tsx:429`, `functions/bench-detect` | **Yes**, not gated by developer mode [V] | Calls Roboflow on our key with any public model id; returns 503 when the key is unset | — | **HIDE**: founder only |
| Model detections, Closer Look model | `ModelDetectionLayer.tsx`, `CloserLook.tsx` | Dev builds only [V] | Needs the local service | — | **HIDE** (already) |
| Two-stage prototype | `lib/weedVision/twoStage/*`, `TwoStagePanel.tsx` | Panel dev-only; its layer is always mounted [V] | Saved 7 % in its own trial | — | **DEPRECATE** (mark, do not delete) |
| Weed pressure grade and hotspots | `lib/weedVision/pressure/grade.ts`, `hotspots.ts`, `PressurePanel.tsx`, `HotspotPanel.tsx` | Yes | Map-only; accuracy unmeasured; never writes a rate [V] | Field Twin heatmap | **KEEP** in code; **HIDE** for pilots |
| Treatment Grid | `TreatmentTab.tsx`, `lib/treatmentGrid*.ts`, `findSimilar.ts`, `gridMigrate.ts` | Only when the Weed Scout switch is off | Explicit cell decisions. The planner still imports its zones (`PlannerTab.tsx:343`) [V]. | — | **HIDE**; **KEEP** as the safest treatment path |
| Scan assessment snapshots | `lib/scanAssessment.ts`, table `scan_findings` | Indirect | — | Reports | **KEEP** |
| Legacy `ai_analysis` (Gemini) | Read at `ReportsTab.tsx:125`, `ScanTimeline.tsx:67,356` | Read and clear only | Superseded by scanAssessment | — | **DEPRECATE** |
| Weed catalog and Library | `lib/weedCatalog/*`, `pages/app/WeedLibrary.tsx`, `weed_catalog_*` tables | Route open by URL [V] | Virginia-only, while the pilot is in Maryland | — | **HIDE** |
| Source frames (kept originals) | `lib/sourceFrames/*` | Yes | Doubles storage per scan [I]. "Keep original photos" is shown even when they are already kept [V]. | Closer Look; the twin (`sourceFrames/odm`) | **KEEP** as infrastructure |
| Weed-v1 ONNX chip classifier | `lib/weedScout/classify/onnxClassifier.ts` | Indirect | Downloads 13.9 MB of wasm and a 1.8 MB model **before** the resolution gate refuses the chips [I]. Shows no discrimination at 4 to 15 cm per pixel [memory]. | — | **INVESTIGATE** |

### 3.5 Spray operations

| Feature | Where | Exposed | State | Action and reason |
|---|---|---|---|---|
| Flight Planner (spray) | `workspace/PlannerTab.tsx`, `lib/mission.ts`, `missionStats.ts`, `tankProfile.ts`, `dronePhysics.ts`, `zoneGroups.ts`, `flightBlocks.ts` | Yes | Section titled "Application rate", prefilled 15, 25 and 40 L/ha, described as "the dose the prescription raster is built from" (`PlannerTab.tsx:1659-1681`, `farmerSettings.ts:194`) [V] | **HIDE** for pilots; rename to application volume when it returns |
| DJI Agras export | `lib/exporters.ts:70-112`, `djiAgras.ts`, `shapefile.ts` | Yes | Never checked against a known-good package (`docs/features/export-formats.md`). The gate checks only boundary, zones and a rate above 0 [V]. | **HIDE**; **IMPROVE** before it returns |
| QGroundControl waypoints, WPML route | `exporters.ts`, `wpml.ts` | Waypoints yes; WPML filtered out | — | **HIDE** |
| Treatment choices (operator's product from its label) | `TreatmentPanel.tsx`, `lib/treatment/*`, table `treatment_choices` | Yes | Good decision-support shape; the export does not require it [V] | **KEEP** in code |
| Job estimate, Agras profiles | `JobEstimatePanel.tsx`, `jobEstimate.ts`, `agrasProfiles.ts` | Yes | Works | **HIDE** |
| Reports PDF | `components/app/ReportsTab.tsx`, `reportRecord.ts`, `reportReconcile.ts` | Yes | Prints "RATE (COMPUTED)" and a savings line. Reads only the grid snapshot, so it shows nothing for Weed Scout work [V, I]. | **HIDE**; P2 a findings report for twins |
| Flight Log, Mark as Flown | `workspace/FlightLogTab.tsx`, `SettingsTab.tsx` | Yes | Works | **HIDE** |
| Schedule | `pages/app/Schedule.tsx`, `lib/schedule.ts` | Yes | Works; stores a `dose_l_ha` field | **HIDE** |
| Drone Fleet | `pages/app/Fleet.tsx` | Yes | "Predicted endurance", shown with a sparkle icon, is a straight line from a typed battery percentage [V] | **HIDE** |
| Spray Conditions | `pages/app/Weather.tsx`, `lib/sprayWindow.ts`, `sprayBoard.ts` | Yes | Works | **HIDE** for pilots; a candidate to bring back early |

### 3.6 Dead code, duplication, repository hygiene

| Item | Evidence | Action |
|---|---|---|
| `components/app/PolygonMap.tsx` and `lib/ndvi.ts` | No importer [V] | **DEPRECATE** |
| 32 unused shadcn files in `components/ui/`, plus `use-mobile.tsx`, `NavLink.tsx` and two unused barrels | No importer [V] | **DEPRECATE** |
| Unused dependencies: `three`, `@react-three/*`, `three-stdlib`, `framer-motion`, `date-fns`, `jszip`, `leaflet-draw`, `@hookform/resolvers`, plus the radix and other packages used only by the dead ui files | Import grep [V] | **DEPRECATE** |
| `WeedVisionPreview` chunk emitted in production | Unconditional `lazy()` in `App.tsx:26` [V] | **IMPROVE**: gate the import as `FieldTwinDevPreview` already is |
| `lib/weedVision/flag.ts` says to delete `src/lib/weedVision` with the branch | Production code (twin, grade, layout) imports it [V] | **IMPROVE**: rewrite the note now, because following it would break production |
| Hashed duplicate ORT wasm (13.9 MB) beside `public/ort/` | `dist/assets` [V] | **INVESTIGATE** |
| Unreferenced `public/screens`, `public/film`, `cockpit-sim.*`, `placeholder.svg` | Grep [V] | **DEPRECATE** |
| Research and bench libraries in src: `rwMeasure`, `sizing/validate`, `detectionEval`, `structure/trace`, `imageSharpness`, `cropProfiles/load` | Used only by scripts and tests [V] | **KEEP**; isolate later |
| Stale docs, listed below | [V] | **IMPROVE** |
| Stale local `main` branch | 150 files behind `origin/main` [V] | Fast-forward it |

The stale docs are:
- `data-model.md`: table count and cascade behaviour.
- `storage.md`: bucket count and URL signing.
- `auth.md`: signup and the cache header.
- `limits.md`: still says zoom 23.
- `export-formats.md`: lists a GeoJSON export that does not exist.
- `swardus-direct-limits`: still says corn is "not wired".

---

## 4. The ideal pilot journey

**Guiding rule: the participant makes three decisions, then reviews what Swardus found.** The decisions are which field, which crop and which photographs. Everything else is decided for them.

**0. Before access (founder, manual).**
- An application arrives and the founder has a short call.
- The founder sends the pilot terms and invites the participant from Supabase, or later from an "Approve and invite" button.
- Historical imagery from Crop Compass is a separate, written data agreement handled outside the product.

**1. First sign-in.** The invitation link signs them in. They set a password, or use Google with the invited address. One first-run screen asks for consent:
- **Required:** the pilot terms and privacy notice, and operational telemetry (counts, timings and errors; never pixels or field coordinates).
- **Optional:** letting Swardus open their twins to troubleshoot, and letting Swardus use their imagery for research. Each is a separate, revocable tick.

**2. Home: "Your fields".**
- A list of their Field Twins, showing field name, crop, flight date, photograph count, status (building, ready, incomplete) and reviewed findings (for example, 12 of 40).
- One primary button, "New field twin", plus a "What imagery works" link and "Send feedback".
- The empty state explains in three lines what Swardus does and shows a picture of a finished twin.

**3. New field twin.**
1. **Field name and crop.** The crop is Corn or Orchard, with no default, and the screen says "Other crops are not supported yet."
2. **Photographs.** The participant picks the flight's folder. Swardus checks it first and shows:
   - how many photographs it can use;
   - the camera;
   - the estimated ground resolution and the area covered;
   - any warnings, in plain words. Examples: "6 photographs have no position and will be left out", "These photographs are not from a DJI drone", "This flight is larger than the pilot supports; pick one block", "Your photographs are about 3 cm per pixel; corn findings need about 1 cm".

   It refuses to start when nothing usable remains.
3. **Build.** The stages read in plain words ("Placing your photographs", "Finding the crop rows", "Looking for weeds and gaps", "Saving"), with elapsed time. The screen says "Keep this tab open", and leaving the page asks for confirmation. The twin saves itself, with no extra click.

**4. Explore.** The map opens on the field, with:
- rows, plants or trees, findings and the cultivated block;
- a plain legend: "Seen in two or more photographs", "Seen in one photograph", "Photographs disagree";
- an accuracy line, such as "Positions come from the drone's GPS, without RTK; expect the map to sit 1 to 3 m from satellite imagery", or the RTK equivalent;
- a permanent note: "Review-only: these are observations to check, not treatment decisions".

Clicking any finding shows the photographs that saw it.

**5. Review.**
- Every finding has three buttons, **Correct**, **Not sure** and **Wrong**, plus an optional note.
- A filter shows the unreviewed findings.
- Verdicts are stored on the server and never change the algorithm's own status.
- The field boundary works the same way, with "Looks right" or "Needs correction".

**6. Feedback.** "Send feedback" is in the header on every screen. Any error screen has "Report this problem", which attaches the page, the twin and the error text.

**7. Return.** A week later, on any device, Home shows the same twins with their verdicts.

**What the participant never sees:** algorithm or model names and versions, weed-tier choices, diagnostics, the reference orthomosaic, build hashes, developer switches, spray planning, rates and exports.

**What imagery works.** To publish after the real-flight run (P0-11):
- **Drone:** a DJI drone whose photographs carry position and gimbal metadata.
- **Camera angle:** pointing straight down.
- **File type:** JPEG.
- **Size:** one block per twin, within the photograph count set by the validation run. The code has no cap. A solver wall is derived at about 300 to 500 photographs, and nothing above 71 has been built.
- **Overlap:** as in `docs/research/swardus-direct-limits-2026-11-02.md`, which requires 80/80.
- **Altitude for corn:** roughly 1 cm per pixel.
- **Computer:** a recent desktop or laptop with Chrome or Edge. The build needs OffscreenCanvas, module workers and Compression Streams, and the limits doc calls mobile "not possible".

---

## 5. Gap analysis

| Step | What exists | Gap | Severity |
|---|---|---|---|
| Access | Application form; RLS per user | No server-side approval. Google and auth-API signup open unless switched off [D]. No invite, password set or reset. Admin allowlist on the old domain. | **P0** |
| Understand | Landing copy | No onboarding and no supported-imagery page. The landing page promises per-weed outlines that pilots cannot get. | **P0** |
| Reach the twin | Page exists | Hard-coded single-email gate; not linked from anything else | **P0** |
| Upload | Builder with a file and folder picker | No photo check before the build. Photos without focal data drop silently. Non-DJI photos are refused one by one. No cap. The orchard default turns a row crop's crop into "weeds". The TIFF path is unverified. Duplicate file names across DJI subfolders collide [V, I]. | **P0** |
| Process | In-browser worker pool | Closing the tab loses everything, with no warning. Cancel waits for the current step. Saving needs an extra click. Closing the panel after a build discards it [V]. | **P0** |
| Corn on a real flight | Corn V1 over a field | Never run with real DJI headers. Soil ties found 0 on the corn test flights, so placement fell back to headers ("a metre or more"), which weakens the multi-photograph agreement that "confirmed" relies on [V docs, I outcome]. | **P0** (validation) |
| Explore | Strong viewer | "Verified" reads as human-verified. Absolute accuracy and RTK status are never shown after reopening. Corn twins lack Explore Findings and a block. Evidence crops are 112 px. | **P0** (labels, accuracy); P1 (crops) |
| Review | Nothing for twins | No verdict UI, table or storage; the boundary accept sits in localStorage | **P0** |
| Feedback | mailto on the landing page | No in-app channel. Errors are caught and shown but never reported, and there is only one error boundary. | **P0** |
| Reopen | Storage per account | Raw-id list, silent overwrite, half-saved twins listed, no delete, no format migration | **P0** (registry); P1 (migration) |
| Founder visibility | Edge function logs, `odm_tasks` | No record of twin builds at all; no events; no dashboard | **P0** (events); P1 (dashboard) |
| Trust and consent | One sentence on the apply form | No terms, privacy notice, consent or deletion procedure | **P0** |

### What will go wrong with real imagery today

| Scenario | Current behaviour | Pilot fix |
|---|---|---|
| Photographs without GPS | Refused one by one. The build stops if fewer than 2 remain ("no photograph holds a camera") [V]. | The photo check lists them before the build |
| Non-DJI drone (Autel, Parrot, senseFly, phone) | Every photograph refused, because there is no `drone-dji:` XMP [V] | Say "DJI only" up front; the check says so in plain words |
| DJI camera other than the Phantom 4 RTK | Untested. Without calibration data the EXIF focal length is used ("metre-level at the edges"), and that caveat is dropped [V]. | Validation run; show the caveat |
| Mixed cameras | Accepted. Flight-wide corrections are shared, and only the first camera is recorded [V]. | Warn or refuse |
| Oblique photographs | No pitch check; projected onto flat ground [V] | Refuse pitch steeper than a threshold |
| Very large flight | No cap, full-resolution decodes and a dense solver; the tab may run out of memory [V, I] | A cap from the validation run; block-size guidance |
| High-megapixel cameras (48 to 50 MP) | Memory per decode roughly triples [I] | Include in the cap |
| Unsupported crop | Orchard is the default, and the corn reader cannot tell corn from soybean [V] | Explicit crop choice; "not supported" copy |
| Refresh or close mid-build | Everything lost, with no warning [V] | Unload guard, honest copy, automatic save |
| Save interrupted | The folder is listed, twin.json is missing, and the twin fails to open [V] | Registry status `incomplete`, with Retry |
| Same field name twice in one day | Overwrites silently [V] | UUID ids |
| Format change later | Strict v1 parsing, so old twins refuse to open [V] | Version policy (P1) |
| Duplicate builds | Not detected. Costs only browser time and about 50 MB of storage [V]. | Duplicate warning (P1) |
| Misleading confidence | "Verified" means two photographs agree [V] | Rename it; add the human verdict tier |
| Wrong position on the map | No absolute accuracy shown. Altitude is relative to the take-off point. Slopes are untested [V]. | Show the placement note; state the envelope |
| Deploy during a session | A build-worker failure gets a reload message, but lazy page chunks and helpers do not [V, I] | A general chunk-load error handler |

---

## 6. Security, privacy and data reliability

**What is sound:**
- every user table has RLS on `auth.uid() = user_id`, with no permissive policies on user data;
- every bucket is private and scoped to the user's folder;
- no secret reaches the client bundle (the only JWT in `dist` is the anon key);
- the Field Twin never uploads raw photographs.

The problems are at the edges.

### Critical

**C1. A user can point server functions at storage paths they do not own** [V code, I exploit].
- **The cause.** `odm_tasks` grants `UPDATE` to `authenticated` with `FOR ALL USING/WITH CHECK (auth.uid() = user_id)` (`supabase/migrations/20260617142810_*.sql:15-23`). No trigger or column grant protects `odm_uuid`, `ortho_path`, `output_path` or `status`.
- **`ortho-url`.** It checks only `task.user_id === caller` (`supabase/functions/ortho-url/index.ts:157`). It then signs whatever `ortho_path` holds with the service role for six hours and returns the link (`:162`, `:295`). `bake-tiles` and `ndvi-tile` do the same.
- **`odm-poll` and `ortho-url`.** Both download from the shared ODM node using the row's `odm_uuid`. Setting your own row to another user's ODM uuid makes the server copy that user's ODM output into your folder.
- **What an attacker needs.** Knowledge of a victim's path or ODM uuid. C2 can supply that.

**C2. Path traversal in the processing-asset proxy** [V code, D node behaviour].
- **The cause.** `odm-asset` builds `/task/${uuid}/assets/${asset}` from a raw query parameter. The only filter is a regex against orthophoto names (`supabase/functions/odm-asset/index.ts:125-131`). URL parsing resolves `../`, so a request can reach other node endpoints, such as a task list, with the server's ODM token.
- **A gap in the size guard.** The 10 MB limit treats a missing `Content-Length` as 0.
- **It is live.** `FieldDetail.tsx:153` calls this function.

Both must be fixed before any external account exists. That holds even if Stack A is hidden from pilots, because any signed-in account can call these functions directly.

### High

**H1. Invite-only is enforced only in the UI.**
- `Auth.tsx` removed the signup form, but Google OAuth and the auth API still create accounts unless "Allow new users to sign up" is switched off [V comment, D switch].
- `handle_new_user` creates a profile for anyone.
- Nothing on the server checks approval.

**H2. No quotas on paid or heavy processing** [V].
- `odm-submit` allows unlimited jobs and forwards client options to the paid node.
- `bench-detect` spends Roboflow credit on any public model.
- `bake-tiles ?rebake` drives up to 80k tiles through titiler.xyz.
- The `orthos` and `scans` buckets accept 10 GiB objects, and `field-reports` and `weed-chips` have no limits.

**H3. Deleting does not delete** [V].
- Field and scan deletes remove rows only; no code calls `storage.remove`.
- Users cannot delete their tiles, and ODM node tasks are never removed.
- `user_annotations` has no foreign keys.
- There is no account deletion or data export.

That conflicts with any privacy promise you make to pilots.

**H4. Unreviewed spots can reach a spray file (product safety)** [V]. The path, step by step:
1. `defaultVerdict` makes every vegetation spot a "weed" (`WeedScoutTab.tsx:250`).
2. `ScanSummary.tsx:57` says "Every spot is already decided."
3. "Save N spots and open the Flight Planner" writes them as ordinary annotations, with no record that the verdict was a default.
4. The planner treats annotations as operator-authored. Its own comment says "the planner never sprays anything a model drew and a human did not confirm" (`PlannerTab.tsx:353-356`), and that is no longer true.
5. The planner fills in 25 L/ha by default.
6. The Agras gate checks only boundary, zones and a rate above 0 (`exporters.ts:79-83`).

Saved defaults also feed the scout's learning (`observations.ts:269-274`). The path is reachable today under "Show all options". It does not touch Corn V1 or the Field Twin. Hiding Stack A removes the exposure, but the fix is owed before the workflow returns to anyone.

### Medium

- **M1. Farm imagery goes to a third party.** Six-hour signed URLs of farm orthophotos go to the public demo service `titiler.xyz`, with no agreement or SLA.
- **M2. The pilot form can be abused.** There is no captcha or rate limit, and it sends a confirmation to any supplied address, including attacker-controlled text. Both application tables also accept direct anonymous inserts.
- **M3. The admin addresses are out of date.** The admin allowlist and the notification address default to `yunus@swathwise.com`, while the public address is now `yunus@swardus.com`. The check does not look at `email_confirmed_at` [V, D secret values].
- **M4. `weather` has no user check.** It spends the OpenWeather quota. This was open item B in the 2026-08-20 audit and is still unfixed.
- **M5. `odm_uuid` is not unique.** Lookups by it use `.maybeSingle()`, so a duplicate row turns a victim's tiles and uploads into 404s. Insert checks verify only `user_id`, never that a referenced `field_id` or `scan_id` belongs to the caller.
- **M6. The CSP collects nothing.** It runs in report-only mode with no `report-uri`. HSTS is not set in `vercel.json` [D: whether Vercel adds it].
- **M7. OpenStreetMap tile usage.** Twin surroundings load straight from `tile.openstreetmap.org`. Check its usage policy for a commercial pilot [I].

### Low

- The session JWT travels in `?token=` URLs for tiles.
- `odm-asset` serves tiles with `Cache-Control: public`.
- A personal Gmail address (the reviewer list) ships in the bundle.
- Developer routes are registered for every user. This is harmless, because the data stays per user.
- Policies remain for a nonexistent `orthomosaics` bucket, and the `ground-truth` bucket is left over.
- Leaked-password protection was off at the last audit [D].

### Data reliability

- **Twins** overwrite silently, half-saved twins are listed, the v1 format is strict with no migration, and boundary decisions live in one browser's localStorage [V].
- **Other work lives only in the browser** [V]:
  - pattern-row confirmations;
  - pen annotations;
  - two-stage labels;
  - saved weather farms;
  - the report's pilot name;
  - unsaved flight drafts;
  - the upload resume checkpoint.

  These keys use four different prefixes.
- **Stack A jobs** stall without an open browser. The ODM node's own retention could expire outputs before anyone polls [I].
- **The security docs overstate the protection** on several points: `docs/architecture/auth.md`, `storage.md` and `docs/security-audit.md` (see section 3.6).

### Only checkable in the dashboard or live [D]

1. The "Allow new users to sign up" switch, the Google provider, email confirmation and leaked-password protection.
2. `PILOT_ADMIN_EMAILS` and `PILOT_NOTIFY_TO`, and who owns `yunus@swathwise.com`.
3. Deployed `verify_jwt` per function, and whether the deleted `analyze-*` functions are still deployed.
4. Which migrations are applied. Two code comments say some could not be pushed at one point (`src/hooks/useUnitSystem.ts:6-9`, `src/lib/weedVision/layout/fieldLayoutStore.ts:1-3`).
5. Bucket flags and size limits as applied.
6. Whether the ODM node answers `/task/list` and `../` paths.
7. HSTS on the live domain.

---

## 7. Pilot monitoring and feedback

### What exists

| Need | State | Evidence |
|---|---|---|
| Invited and approved accounts | **Partial.** Applications are stored, but there is no status, approval, invite or participant record. | `20260817160000_pilot_applications.sql`; `functions/pilot-applications` |
| Organisations and members | **Missing** | No table or policy |
| Upload outcomes | **Partial.** `odm_tasks.status`, `error` and `progress` exist, but there is no completion time and retries overwrite the error. | `20260812120000_scan_pipeline_resilience.sql` |
| Twin builds and durations | **Missing on the server.** Timings are computed in the browser (`build/pipeline.ts`), shown once, then discarded. | `TwinBuilder.tsx:152` |
| Feature usage | **Missing.** No analytics and no events table; the CSP `connect-src` would block vendors anyway. | grep |
| Errors | **Partial.** Shown, never reported. One boundary and no global handler. | `src/main.tsx`, `TabErrorBoundary.tsx` |
| Session replay | **Missing** | — |
| Finding corrections | **Partial.** On the server for Stack A only: `weed_observations.verdict` with `verdict_source`, `scan_hotspot_reviews`, `field_planting_layouts`, `treatment_choices`. **Nothing for twins.** | migrations `20260921120000`, `20261015150000` |
| Feedback | **Missing** in the app | mailto only, at `src/components/landing/Access.tsx:21` |
| Return usage | **Not read** by any code; `auth.users.last_sign_in_at` exists | — |
| Consent and terms | **Missing** | — |

### The smallest system worth building

Reuse the pattern the codebase already trusts:
- tables the client can insert into but nobody can read through the API;
- one founder-only edge function that checks an allowlist before reading them. `pilot-applications` already works this way.

**Six tables:**

| Table | Purpose | Who writes | Who reads |
|---|---|---|---|
| `pilot_participants` | user_id, application_id, status (invited, active, paused, ended), invited_at, onboarded_at, role (participant or founder), notes | Founder (service role) | Server checks; founder |
| `consents` | user_id, kind (terms, telemetry, troubleshooting_access, research_use), version, granted_at, revoked_at | Participant | Participant (own); founder |
| `field_twins` | id (uuid), user_id, name, crop, captured_at, photographs, camera, placement (rtk or gnss), status (building, saving, ready, incomplete), format version, created_at | Participant | Participant (own) |
| `twin_finding_reviews` | user_id, twin_id, finding kind and id, verdict (correct, unsure, wrong), note, at | Participant | Participant (own); founder (counts) |
| `app_events` | user_id, at, name, twin_id (id only), duration_ms, outcome, error code and text (truncated), stage timings, counts, camera model, app version | Participant (insert only) | Founder only |
| `feedback` | user_id, at, route, twin_id, kind (problem, idea, finding), text | Participant | Founder |

**About ten events are enough:**
- `session_start`
- `twin_check_done`, with counts of usable and refused photographs and the reasons
- `twin_build_started`, `twin_build_finished`, `twin_build_failed`, `twin_build_cancelled`
- `twin_saved`, `twin_save_failed`
- `twin_opened`
- `finding_reviewed`
- `feedback_sent`
- `client_error`

**Hard rule for events:** no pixels, no file names, no coordinates and no boundaries. Field geometry is participant data, not telemetry.

**Founder view, in two phases:**
1. **For the first guided participants:** a few saved SQL queries in the Supabase dashboard. They cover participants, builds with outcome and duration, failures, feedback, reviews and last sign-in.
2. **When that gets tedious:** extend `/admin/pilot-applications` into `/admin/pilot`, backed by one allowlisted function that returns non-imagery columns only.

**Imagery access is a separate privilege:**
- Telemetry never includes imagery, and the founder view never signs storage URLs.
- Troubleshooting a twin requires an active `troubleshooting_access` consent from that participant, and every access is logged.
- For the pilot, the simplest honest version is manual: the participant chooses to send you a link to the flight or the twin.
- Research use is its own optional, revocable consent.
- Historical imagery from Crop Compass needs its own written agreement.

**Not for the pilot:**
- Session replay, which would record field imagery.
- Third-party product analytics.
- Sentry, unless the event table proves insufficient. If it is added later, scrub URLs and keep replay off.

---

## 8. The highest-impact simplifications

1. **One product for the pilot: the Field Twin.**
   - Pilot accounts get Home (their twins), New twin, the twin viewer, Help and Feedback.
   - The orthomosaic and spray workspace is hidden from them by a server-side role, not deleted.
   - In one move, that takes the Virginia banner, ODM costs, the titiler exposure, the spray export path, five navigation entries and seven workspace tabs out of the pilot.
2. **Remove decisions the participant should not make.**
   - The weed tier is fixed: colour rules for orchard, Corn V1 for corn.
   - The Detail dial offers Simple and Standard only.
   - No reference orthomosaic, no Diagnostics, no TIFF option and no stage selector.
3. **One server-side role instead of three gates.**
   - Today there are three: the hard-coded reviewer email, the localStorage developer flags, and `import.meta.env.DEV` checks.
   - A `role` on the participant record replaces the first two. The DEV checks stay for development builds.
4. **Saving is automatic, and a twin is a record.** The `field_twins` table makes possible the list, the status, names, deletion and verdicts.
5. **Split the bundle by route.**
   - Today the landing page downloads about 1.1 MB gzip of app code, Corn V1 included.
   - Lazy routes cut that for every visitor on a rural connection.
   - The change is mechanical and low risk.
6. **One vocabulary for the pilot path:**

   | Today | Pilot wording |
   |---|---|
   | soil ties agree to N cm | photographs agree to N cm |
   | atlases, evidence crops | photographs |
   | verified | seen in 2 or more photographs |
   | single view | seen once |
   | Corn V1 | Corn |
   | Accept for operations | Boundary looks right |
   | Diagnostics | not shown |
7. **Keep processing in the browser for the pilot.**
   - It costs you nothing per build.
   - Raw photographs stay on the participant's machine, a real privacy advantage worth saying out loud.
   - It avoids building a job system now.
   - The price is a block-size limit and a tab that must stay open. State both plainly.
8. **Retire the dead weight after P0, not before.** The dead files and unused dependencies in section 3.6 are safe to remove, but none of them affects a pilot user. Do it as one tidy-up commit in P1.

---

## 9. Roadmap

### P0: required before any external participant gets access

Order matters: the security and access items come first, because nothing else is safe without them.

| # | Item | Depends on | Acceptance criteria |
|---|---|---|---|
| P0-1 | **Fix C1 and C2, and tighten the edge functions.** Make `odm_uuid`, `ortho_path`, `output_path`, `status` and the tile columns non-updatable by `authenticated`, using column grants or a BEFORE UPDATE trigger. Add `UNIQUE(odm_uuid)`. Check that every signed path starts with the caller's id. Allowlist `asset` in `odm-asset` and reject `/`, `..` and encoded forms. Make `bench-detect` founder-only. Authenticate `weather`. | — | New edge tests in `src/test/edge/`: a tampered `ortho_path` gets 403; a traversal `asset` gets 400; a non-founder `bench-detect` call gets 403; an anonymous `weather` call gets 401. Existing tenancy tests still pass. |
| P0-2 | **Close the door and open the invite.** Switch signups off [D]. Create `pilot_participants`. Enforce it on the server with a before-user-created auth hook or an allowlist check, plus an RLS helper. Invite from the dashboard. Add password reset and magic-link sign-in (`shouldCreateUser: false`). Point the admin and notification secrets at the swardus.com address. | — | An uninvited Google account cannot create an account. An invited address can sign in from its email, set a password, sign out and back in, and reset a forgotten password. |
| P0-3 | **Pilot product shape.** Add a role (founder or participant). Participants get a pilot navigation (Home, Help, Feedback, Sign out) and the Field Twin. Stack A routes redirect home. Hide the developer switches, "Show all options", the Benchmark panel, the reference orthomosaic, Diagnostics and the build stamp. The role replaces the reviewer email list. | P0-2 | Signed in as a participant, the only reachable screens are Home, New twin, the twin viewer, Help and Feedback. Typing `/app/fields`, `/app/photo` or `/app/orthomosaic/x` lands on Home. The founder account sees everything as today. |
| P0-4 | **Twin registry and safe saving.** Add the `field_twins` table with UUID ids. Save automatically when the build finishes. Warn on leaving the page during the build and the save. A half-saved twin shows as "incomplete" with Retry, not as broken. Home lists name, crop, date, photographs and status. Delete removes the row and the stored files. | P0-3 | Two same-name builds on the same day give two twins. Closing the tab mid-save leaves an "incomplete" entry that can be deleted. A twin saved on one computer opens on another. Existing founder twins still open, after a one-time backfill. |
| P0-5 | **Photo check before the build.** Before any processing, report unreadable files, missing position, missing DJI metadata, missing focal data, mixed cameras, oblique pitch, duplicate names, and counts over the cap set by P0-11. Compare the estimated ground resolution with what the crop needs. No photograph drops silently. | P0-11, for the limits | Fixture folders for each case produce one plain sentence each. The build cannot start below the minimum. Every photograph left out is counted in the result. |
| P0-6 | **Finding review.** Add `twin_finding_reviews`. Give every finding in the inspector Correct, Not sure and Wrong plus a note, with an "unreviewed" filter and counts. Move the boundary decision to the server. Rename the algorithm states as in section 8. Store and show the algorithm's status and the participant's verdict separately. | P0-4 | Verdicts survive a reload and a different device. A verdict never changes the algorithm's status. Home shows reviewed counts. |
| P0-7 | **Feedback and error capture.** Add the `feedback` table and a header button. Add a top-level error boundary and a global `error`/`unhandledrejection` handler. A chunk-load failure shows "reload". The founder gets an email notification through the existing Resend pattern. | P0-3 | A forced render error shows a recovery screen with "Report this problem" and writes a `client_error` event. Participant feedback reaches the founder's inbox within a minute. |
| P0-8 | **Build telemetry.** Add `app_events` with the events in section 7, insert-only, with no imagery or coordinates. | P0-4 | One saved SQL query lists every participant build with outcome, duration, photographs used and refused, camera and error text. |
| P0-9 | **Trust and plain language on the pilot path.** Show the placement note (RTK or GNSS) and an accuracy line in the viewer. Add a review-only line on findings. Give the crop no default. Apply the vocabulary table to the pilot screens. Add a "What imagery works" page. Align the landing claims with what a pilot can reproduce. | P0-11, for the envelope | A grep of participant-visible strings finds none of Corn V1, RF-DETR, atlas, soil ties, diagnostics, ODM or orthomosaic. You read every pilot screen and sign off. |
| P0-10 | **Terms, privacy, consent and deletion.** Publish pilot terms and a privacy page. Add a first-run consent screen that writes to `consents`: terms and telemetry required; troubleshooting access and research use optional. Write and test a runbook that deletes one participant's data (rows and stored files). | P0-2 | A participant cannot build before accepting. Consent rows exist and can be revoked. Run on a test account, the runbook leaves no rows and no stored files. |
| P0-11 | **One real flight, end to end.** Build one real DJI corn flight, plus one orchard flight if orchards are in scope. Use production Chrome on a laptop like a participant's. Check the result by eye. Record the operating envelope: cameras tested, photograph count, area, altitude, overlap, time and memory. | None; can start now, in parallel | A written envelope exists and feeds P0-5 and P0-9. The flight builds inside the envelope. A flight outside it is refused with a clear reason. |
| P0-12 | *Conditional:* **if any participant keeps access to Stack A** (decision D1), fix H4 before they get it. Export only operator-confirmed annotations, storing the verdict source on `user_annotations`. Require acknowledgement of default volumes, or a treatment choice, before export. Keep defaults out of the learning. Rename "rate" and "dose" to application volume. | D1 | An all-default "Save N spots" produces no exportable zone until each zone is confirmed. |

**Suggested sequence:**
1. Start P0-11 immediately, in parallel. It needs the founder's flight and the founder's eye.
2. P0-1, then P0-2, then P0-3.
3. P0-4. Then P0-5 (once P0-11's limits are known), P0-6 and P0-8.
4. P0-7, P0-9 and P0-10.
5. A guided test with one friendly participant, on a call with them.

### P1: after the first guided test

- **Founder pilot page** (`/admin/pilot): participants, last sign-in, builds and failures, reviews and feedback, through one allowlisted function. *Acceptance:* no imagery column and no signed URL is ever returned.
- **Route-level code splitting.** *Acceptance:* the landing page downloads under about 300 KB of gzip JavaScript (target to confirm), and the corn reader is not in the landing chunk.
- **Larger evidence crops, or a consented "open the full photograph" path.** Depends on D3.
- **Twin format version policy, with a migration test.** *Acceptance:* a v1 twin still opens after any format change.
- **Duplicate-flight warning**, from the registry.
- **"Approve and invite" button** on the admin page, plus `status` and `decided_at` on applications.
- **Storage cleanup** on field and scan deletion, and account data export.
- **Quotas and limits:** quotas on `odm-submit` and `bake-tiles`, size limits on every bucket, and abuse limits on `pilot-apply`.
- **CSP and HSTS:** give the CSP a report endpoint, then enforce it. Set HSTS.
- **Fix H4** (default verdict to export) even while Stack A stays hidden.
- **Move the remaining localStorage operator work to the server:** pattern-row confirmations and annotations.
- **Tidy-up:**
  - remove the dead files and unused dependencies;
  - gate the WeedVisionPreview import;
  - rewrite the deletion note in `weedVision/flag.ts`;
  - fast-forward local `main`;
  - correct the stale docs.

### P2: later capabilities

- Organisations, teams and sharing, if Crop Compass staff need to share fields.
- Server-side twin builds for flights beyond the browser's limit.
- Soybean and other row crops, and crop identity.
- Twins linked to fields, so flights compare over time.
- A twin findings report, and a findings export (GeoJSON or shapefile) for review.
- Stack A back as "import a finished map", for historical imagery.
- A flight-planning guide for twin-quality flights.
- The decision on self-hosting TiTiler, and ODM polling by cron.
- The MaSC server tier.
- Species estimation from patch, place and season.
- One shared vegetation module, behind equivalence benches.
- A view-only mobile viewer.
- Spray operations as its own product, after the Agras package is validated on hardware.

### What not to build now

- New detection models, Corn V1 tuning, or another corn research cycle. Corn V1 stays frozen at `corn-v1.0` for the pilot.
- Server-side processing or a job queue for twins.
- An administration platform beyond one founder page.
- Organisations or role hierarchies.
- Billing and plans.
- Third-party analytics, session replay or an error-monitoring vendor.
- A new design system or a visual redesign. The pilot path needs a copy pass and fewer controls, not new styling.
- New crops, or multispectral and TIFF support, in the pilot.
- Getting the spray planner or the Agras export ready for the pilot.
- Offline mode.
- Building twins on mobile.
- Automatic species identification.

---

## 10. Decisions that need your approval

1. **D1. Pilot product scope.**
   - Recommendation: the Field Twin only for participants, with Stack A hidden by role and not deleted.
   - Exposing both instead requires P0-12, the Virginia-region fix and ODM quotas, adds ODM cost exposure, and doubles the onboarding.
2. **D2. Crops and stages in the pilot.**
   - Corn V1 cannot tell corn from soybean, and Maryland farms often grow both.
   - Recommendation: corn only (plus orchard if a partner has one), stated plainly.
   - Confirm which corn growth stages you will accept, from the Corn V1 envelope.
3. **D3. Raw photographs.**
   - Recommendation: they stay on the participant's machine. Support and research access happen only by explicit, consented sharing.
   - Uploading originals would allow full-photograph evidence and easier troubleshooting, at the cost of storage and privacy obligations.
   - A smaller alternative is larger stored evidence crops.
4. **D4. Access mechanics.**
   - Recommendation: switch signups off, invite from the dashboard, add a server-side participant check, and add magic-link and password-reset sign-in.
   - Leave the in-app "Approve and invite" button for P1.
5. **D5. Telemetry stance.** Recommendation: a first-party events table only. No vendors, no replay, and no imagery or coordinates in events.
6. **D6. Consent wording and research use.**
   - The terms, privacy notice and research consent need your wording, and ideally a lawyer's review.
   - Crop Compass's historical imagery needs a separate written agreement before any of it is used.
7. **D7. Spray and prescription features.**
   - Recommendation: hidden for the pilot.
   - Long term, confirm that "decision support, never a product rate" also governs the planner. The rate, dose and prescription wording then gets renamed when the planner returns.
8. **D8. Release discipline during the pilot.**
   - Today every change is pushed to `main` and deployed, so it reaches participants' open browsers.
   - Recommendation: do pilot work on branches from `origin/main`, test it yourself before each merge, tag releases, and freeze deploys briefly during a participant's session.
   - This changes the current push-everything-to-main habit, so it is your call.
9. **D9. Accounts.**
   - Recommendation: one account per person for the pilot, with no shared logins.
   - If Crop Compass needs several people on one field, that is the trigger for organisations in P2.
10. **D10. Evidence size and storage per twin.**
    - An orchard twin is about 52 MB today. Bigger crops build more trust and use more storage.
    - Decide it together with D3.

---

*Wired and visible: no. This is an audit. No application code, configuration, database or deployment was changed.*
