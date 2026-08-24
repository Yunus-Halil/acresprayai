# Edge functions

Eleven Deno functions in `supabase/functions/`. All answer `OPTIONS` with permissive CORS headers.
All except the two tile endpoints and `pilot-apply` require a `Bearer` JWT and re-verify
ownership before touching anything.

Shared modules live in `_shared/`:

- **`net.ts`** — `fetchResilient` (timeout + backoff), `jsonSafe`, `isTransient`, `HttpError`
- **`tileAuth.ts`** — token extraction (header or `?token=`), memoised user and owner lookups
- **`cors.ts`** — shared CORS headers
- **`email.ts`** — plain-text send via Resend. Best effort: returns a result, never throws
- **`pilotApplication.ts`** — the pilot form's fields, options and validation, shared with the browser

---

## `odm-submit` — create a task and stream images

**Auth:** JWT required.

A single `POST` endpoint switched by an `x-action` header.

### `x-action: init`
Headers: `x-field-id`, `x-image-count`.

Verifies the field belongs to the caller, calls `/task/new/init` on the node, inserts an
`odm_tasks` row with `status = "uploading"` and `upload_expected`.

Returns `{ task_id, odm_uuid }`.

### `x-action: upload`
Headers: `x-odm-uuid`. Body: multipart with one `images` part.

Verifies task ownership, forwards the body **verbatim as a stream** to
`/task/new/upload/{uuid}`, then increments `upload_received`.

A node-side "max images" rejection is surfaced as HTTP **413** with `code: "max_images"` so the
client aborts the batch instead of retrying 199 more times.

### `x-action: commit`
Body: `{ odm_uuid, options? }`.

Starts processing. On failure it writes `status = "failed"` plus the error onto the task so the
UI stops polling.

---

## `odm-poll` — advance status, mirror outputs

**Auth:** JWT required. **Body:** `{ task_id, retry? }`.

Verifies ownership, asks the node for task info, and maps NodeODM status codes onto the row:

| Code | Meaning |
|---|---|
| 10 | queued |
| 20 | running |
| 30 | failed |
| 40 | completed |
| 50 | cancelled |

`{ retry: true }` on a `failed` or `mirroring` task clears the error, resets `mirror_attempts`,
and re-enters the status machine.

On completion it **claims a transfer lease** (see [resilience.md](resilience.md)) and does the
heavy work in `EdgeRuntime.waitUntil`:

1. `all.zip` → `scans` bucket (skipped if `output_path` already set)
2. Orthophoto GeoTIFF → `orthos` bucket (skipped if `ortho_path` already set)
3. `status = completed`

Both steps are idempotent, so a reclaimed lease resumes rather than repeating.

**It only ever fetches this scan's own `odm_uuid`.** The processing node is shared by every
tenant, so a "try any completed task" fallback would attach another farm's imagery to this scan.
That bug existed and was removed; do not reintroduce it.

If the node is unreachable, the response carries an `upstream` field and the scan's own state is
left untouched.

---

## `ortho-url` — signed GeoTIFF URL + TileJSON

**Auth:** JWT required. **Query:** `?task_id=`.

Returns `{ url, expires_in, tilejson }` where `url` is a 6-hour signed URL to the orthophoto and
`tilejson` is fetched server-side from TiTiler (avoiding a browser CORS preflight).

Back-fills lazily. If `ortho_path` is empty it checks the bucket, then tries to download the
orthophoto from the node, and — for WebODM Lightning, which only serves `all.zip` — returns
**202** with `{ needsExtract, zipUrl, upload }` so the browser can stream-extract the GeoTIFF
itself and PUT it back. This exists because unzipping a multi-gigabyte archive exceeds the 256 MB
edge memory cap.

| Status | Meaning |
|---|---|
| 200 | Ready; signed URL and tilejson returned |
| 202 | Browser-side extraction handoff |
| 409 | Not ready; includes `status` and `progress` |
| 422 | Completed but no orthophoto was produced (usually insufficient image overlap) |
| 404 | Not yours, or nonexistent — deliberately indistinguishable |

---

## `bake-tiles` — render the GeoTIFF into map tiles

**Auth:** JWT required. **Query:** `?task_id=`, optional `?rebake=1`.

Called repeatedly until it answers `{ done: true }`. Each invocation renders up to **220 tiles**
at concurrency 12, then persists the cursor so the next call resumes.

Zoom range is z10 up to `min(20, tilejson.maxzoom)`, **frozen after the first pass**
(`tiles_plan_locked`).

Response: `{ done, completed, total, failed, batch, minZ, maxZ, retrying }`.

`retrying: true` means the cursor barely moved because tiles failed — the client should keep
driving but back off.

`?rebake=1` clears `tiles_baked`, `tiles_done` and `tiles_failed` to repair a map with holes.

---

## `tile` — serve a pre-baked tile

**Auth:** `verify_jwt = false`; verified in code. Token via header or `?token=`.

URL: `/tile/{odm_uuid}/{z}/{x}/{y}.png?token=<jwt>`

Verifies the token, looks up who owns that `odm_uuid`, and rebuilds the storage key from the
**verified owner** — the caller only ever names the scan, never a path.

Falls back to the legacy un-prefixed key for tiles baked before scoping. Misses return a 1×1
transparent PNG so Leaflet does not paint broken-tile icons. `Cache-Control: private`.

---

## `ndvi-tile` — vegetation index overlay

**Auth:** `verify_jwt = false`; verified in code.

- `/ndvi-tile/info?task_id=` → `{ bands, expression, index, label }`
- `/ndvi-tile/{task_id}/{z}/{x}/{y}.png?token=` → a coloured tile

Failure handling distinguishes two cases. A caller with no claim to the scan gets **404**,
matching `tile` rather than being quietly served a blank. States an owner can legitimately hit —
orthomosaic not ready, tile service unhappy — get a transparent pixel so the map does not fill
with broken tiles.

Band **roles** decide the maths — never band count or band order. See
band resolution in `supabase/functions/_shared/bands.ts`; the short version is that ODM
writes RGB orthos as RGBA, and no two multispectral sensors agree on band order, so both must be
resolved rather than assumed.

`/info` reports the resolved roles, the method used (`descriptions`, `colorinterp`, `convention`,
`profile`, `unresolved`), which indices are available, and a `fingerprint`.

The resolved mapping is stored on `odm_tasks.band_mapping`, so TiTiler is probed once per scan
rather than on every cold start. Setting that column to null forces a re-probe.

Tiles are rendered by TiTiler with `rescale=-1,1` and the `rdylgn` colormap. `?index=` selects
between the available indices (`ndvi`, `ndre`, `vari`), defaulting to NDVI.

**Tile URLs embed the fingerprint.** Tiles are cached `private, max-age=86400`, so without it a
corrected mapping would keep serving day-old tiles rendered with the previous expression, and the
fix would never reach the person looking at the map.

Ownership is checked **before** the memoised COG lookup, so a cached entry can never be served to
a different user.

---

## `odm-asset` — proxy individual node assets

**Auth:** JWT required. **Query:** `?uuid=` plus one of `probe=ortho`, `info=task|ortho`,
`tile=z/x/y`, `asset=<path>`.

Verifies task ownership first. Raw orthophoto and TIFF downloads are refused with **413**, as is
any asset over 10 MB — these would stall the browser, and the tiled path exists for exactly this
reason.

---

## `analyze-ortho` — REMOVED

**Auth:** JWT required. **Body:** `{ task_id, boundary, field_settings }`.

Deleted 2026-08-24 along with the whole legacy vision path; the treatment grid (client-side, src/lib/findSimilar.ts) is the analysis system and calls no model. See src/lib/scanAssessment.ts
for the per-scan snapshot it writes instead.

---

## `pilot-apply` — accept a pilot application

**Auth:** `verify_jwt = false`. Applicants are not signed in. **Body:** the form's fields.

Validates with the shared `_shared/pilotApplication.ts` validator — the same one the browser
runs, but this copy is the authority — then inserts with the service-role key and sends the
notification email.

| Status | Meaning |
|---|---|
| 200 | Saved. Body carries `id` and `notified: true \| false` |
| 422 | Validation failed; body carries per-field `errors` |
| 405 | Not a POST |
| 500 | The insert failed. Nothing was saved and nothing was sent |

Email is **best effort and never fails the request**: an application saved but not emailed is
recoverable from the admin view, one lost to a mail provider's bad minute is not.

The form posts here rather than inserting through PostgREST so that the notification cannot be
skipped. See [features/pilot-applications.md](../features/pilot-applications.md).

---

## `pilot-applications` — read the pilot pipeline

**Auth:** JWT required, **plus** an email allowlist (`PILOT_ADMIN_EMAILS`).

`pilot_applications` has no readable SELECT policy for any role, so this is the only way rows
come back out. Returns up to 500, newest first, `Cache-Control: private, no-store`.

| Status | Meaning |
|---|---|
| 200 | Rows |
| 401 | No token, or a token resolving to nobody |
| 403 | Signed in but not on the allowlist |

403 rather than the uniform 404 used elsewhere: that 404 exists to stop a caller probing which
scan ids exist, and there is no id to probe here.

---

## `weather` — normalised forecast proxy

**Auth:** JWT required. **Query:** `?lat=&lon=`.

Calls OpenWeather One Call 3.0 and falls back to Open-Meteo (no key required) on 401/403/5xx.
Both normalise to one shape:

```
{ tz, tz_offset, current, hourly[48], daily[7] }
```

Temperature in °C, wind in km/h, precipitation in mm.
