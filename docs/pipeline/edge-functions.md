# Edge functions

Nine Deno functions in `supabase/functions/`. All answer `OPTIONS` with permissive CORS headers.
All except the two tile endpoints require a `Bearer` JWT and re-verify ownership before touching
anything.

Shared modules live in `_shared/`:

- **`net.ts`** — `fetchResilient` (timeout + backoff), `jsonSafe`, `isTransient`, `HttpError`
- **`tileAuth.ts`** — token extraction (header or `?token=`), memoised user and owner lookups
- **`cors.ts`** — shared CORS headers

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

Band count decides the maths:

| Bands | Index | Expression |
|---|---|---|
| 4+ (multispectral, NIR present) | True NDVI | `(b4-b1)/(b4+b1)` |
| 3 (ordinary RGB) | VARI — a visible-light proxy, **not** NDVI | `(b2-b1)/(b2+b1-b3)` |

Rendered by TiTiler with `rescale=-1,1` and the `rdylgn` colormap.

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

## `analyze-ortho` — run the vision model

**Auth:** JWT required. **Body:** `{ task_id, boundary, field_settings }`.

The entire AI capability of the product. See [features/ai-analysis.md](../features/ai-analysis.md)
for the full contract.

---

## `weather` — normalised forecast proxy

**Auth:** JWT required. **Query:** `?lat=&lon=`.

Calls OpenWeather One Call 3.0 and falls back to Open-Meteo (no key required) on 401/403/5xx.
Both normalise to one shape:

```
{ tz, tz_offset, current, hourly[48], daily[7] }
```

Temperature in °C, wind in km/h, precipitation in mm.
