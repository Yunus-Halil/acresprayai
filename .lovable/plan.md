# Field-First Workflow with OpenDroneMap

Rework the app so every scan lives inside a Field. A Field is created first, then the farmer uploads raw drone images, which are pushed to OpenDroneMap (ODM). ODM outputs an orthomosaic + 3D model + point cloud, which we store and tie to the field's scan history. Zones, anomalies, and spray recs all hang off a specific scan within a field.

## New User Flow

```text
1. /app/fields                  -> list of fields (empty state if none)
2. "New Field"                  -> name, crop type, optional notes
                                   -> redirect to /app/fields/:id (field detail)
3. /app/fields/:id              -> field dashboard
                                     - Boundary section (drawn after first scan, editable)
                                     - Scans timeline (newest first)
                                     - "Upload Drone Images" CTA
4. Upload flow                  -> drag-drop folder of JPG/TIFF
                                     - creates a Scan row (status=uploading)
                                     - uploads to storage bucket
                                     - kicks off ODM task
                                     - polls status -> processing -> complete
5. /app/fields/:id/scans/:scanId-> ortho viewer + 3D model + zones + anomalies
                                     - if first scan, auto-set field boundary from ortho footprint
```

The current loose "FieldMap" page becomes the scan viewer reached via a specific field+scan.

## Data Model Changes

Wipe existing test data. New/updated tables:

- **fields** (extend): add `crop_type`, `notes`, `boundary geometry` already exists; keep but allow null until first scan
- **scans** (extend): require `field_id NOT NULL`, add `status` (uploading|queued|processing|complete|failed), `odm_task_id`, `image_count`, `captured_at`, `ortho_url`, `model_3d_url`, `point_cloud_url`, `dsm_url`
- **odm_tasks** (already exists): link to scan via `scan_id`
- **zones**, **anomalies**, **spray_recommendations**: enforce `scan_id NOT NULL`, and derive `field_id` through scan
- Storage bucket: `drone-uploads` (private) for raw images, `scan-outputs` (private, signed URLs) for ODM results

## OpenDroneMap Integration

ODM exposes a REST API (NodeODM/WebODM). Two viable hosting options:

1. **WebODM Lightning** (managed SaaS, `webodm.net`) — paid per-task, easiest. Needs `WEBODM_LIGHTNING_TOKEN`.
2. **Self-hosted NodeODM** — user gives us a URL + token. Needs `NODEODM_URL`, `NODEODM_TOKEN`.

Recommend Lightning to start; let the user swap to self-hosted via secrets later. Either way we hit it from an edge function — never from the browser.

Edge functions to add:
- `odm-create-task` — receives `scan_id`, signs upload URLs OR streams uploaded files from our bucket to ODM, creates an ODM task, stores `odm_task_id` on the scan
- `odm-poll-task` — invoked by client polling or cron; checks ODM status, on complete downloads `orthophoto.tif`, `odm_textured_model.glb`, `point_cloud.laz`, writes them to `scan-outputs` bucket, updates scan row
- `odm-cancel-task` — for the user-cancel button

## Pages / Components

New / changed:
- `src/pages/app/Fields.tsx` — list of fields, "New Field" dialog
- `src/pages/app/FieldDetail.tsx` — field dashboard with scan history
- `src/pages/app/NewScan.tsx` — drone image upload + ODM kickoff
- `src/pages/app/ScanViewer.tsx` — replaces current `FieldMap.tsx`; loads scan ortho + zones
- `src/components/app/Model3DViewer.tsx` — render `.glb` from ODM via `@react-three/fiber` + `drei`
- Sidebar: change "Field Map" to "Fields"

Routes:
```text
/app/fields
/app/fields/:fieldId
/app/fields/:fieldId/scans/new
/app/fields/:fieldId/scans/:scanId
```

## Migration / Wipe

Single migration:
1. `truncate` anomalies, spray_recommendations, zones (crop_zones), scans, orthomosaics, odm_tasks, fields — cascade
2. Add new columns + NOT NULL constraints
3. Add storage buckets via tool
4. RLS: all tables already user-scoped via field_id → user_id chain; add policies for new columns

## Open Questions for Me to Decide as I Build

- Use WebODM Lightning by default (will need user to add a token via add_secret on first upload). Self-hosted NodeODM as fallback.
- 3D viewer with `three` + `@react-three/fiber` (lightweight, GLB-friendly).
- Polling on the client every 10s while scan is in `queued`/`processing`.

## Out of Scope (for now)

- Multi-scan comparison view (NDVI deltas over time) — data model supports it, UI later
- Mobile capture app
- Stitching previews before full ODM run

---

Approve and I'll start with the migration + Fields list page, then wire the upload + ODM edge functions.
