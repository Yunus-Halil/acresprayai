# Scan lifecycle

The critical path, end to end. Every step is real; nothing here is stubbed or simulated.

## Status machine

```
        ┌──────────┐
        │ uploading│ ← row created at init; images streaming to the node
        └────┬─────┘
             │ commit
        ┌────▼─────┐
        │  queued  │ ← node has accepted the task, not started
        └────┬─────┘
        ┌────▼─────┐
        │processing│ ← reconstruction running (progress 0–100)
        └────┬─────┘
        ┌────▼─────┐
        │ mirroring│ ← an edge worker holds the transfer lease, copying
        └────┬─────┘   outputs into storage (progress pinned at 99)
        ┌────▼─────┐
        │completed │ ← output_path + ortho_path set
        └──────────┘

  any ──► failed   ← recoverable; the Retry control re-enters the machine
```

`mirroring` is the state that used to be invisible. Without it, two pollers could both decide a
completed task needed mirroring and start duplicate multi-gigabyte transfers.

## 1 · Select images

Minimum 5, maximum 200 per scan. The UI recommends 30–200 overlapping nadir shots at 70–80%
overlap.

## 2 · GPS pre-flight check

The first five images are parsed for GPS EXIF tags. Without GPS, OpenDroneMap produces an
ungeoreferenced result that lands at latitude 0, longitude 0 in the Atlantic.

- No GPS in the sample → blocking confirmation dialog
- Partial GPS → non-blocking warning

## 3 · Downscale, preserving EXIF

Any image over 1.5 MB is redrawn to a maximum edge of **2400 px** at JPEG quality 0.82.

Canvas re-encoding strips EXIF, so the original EXIF block is extracted first with `piexifjs`
and re-injected into the resized file. Without that step GPS is lost and step 2 was pointless.

See [operations/limits.md](../operations/limits.md) for the resolution trade-off this represents.

## 4 · Init, upload, commit

Handled by `src/lib/scanUpload.ts`.

- **init** creates the task on the node and the `odm_tasks` row.
- **upload** sends images two at a time, each prepared just-in-time so a large batch never sits
  in memory at once. Every image retries independently up to 4 times with exponential backoff.
  Progress is checkpointed to `localStorage` after each success.
- **commit** starts the reconstruction. The session token is refreshed first, because a long
  upload outlives a JWT.

An interrupted batch **resumes**: only images not already accepted are re-sent. See
[pipeline/resilience.md](resilience.md).

## 5 · Poll while the node reconstructs

The field page polls every 5 seconds while any task is in an active state. Real reconstruction
takes 10 minutes to several hours depending on image count.

Poll responses carry an `upstream` field when the processing node itself is unreachable — the
scan is left alone in that case rather than being marked failed.

## 6 · Mirror outputs to storage

On completion the poller **claims a lease** (a conditional UPDATE to `mirroring`) so exactly one
worker performs the transfer, then:

1. Streams `all.zip` into the `scans` bucket
2. Pulls the orthophoto GeoTIFF into the `orthos` bucket
3. Sets `status = completed`

If the orthophoto is not directly downloadable — WebODM Lightning only exposes the archive —
that step is skipped and `ortho-url` back-fills later, including via browser-side zip extraction.

## 7 · Bake tiles

The workspace drives `bake-tiles` in a loop, showing a progress count, until every zoom level
from z10 to native is rendered into the `tiles` bucket.

The zoom range is **frozen on the first pass** so the tile list stays deterministic across
invocations. A pass with unresolved tiles never reports `done`, so holes get retried rather than
latched over.

After this the map loads as static tiles rather than hitting TiTiler on every pan.

## 8 · Sanity-check georeferencing

TileJSON bounds are validated as WGS84 — latitude within ±90, longitude within ±180. Projected
(UTM) coordinates are rejected with an explicit "re-process this scan" error rather than flying
the map off to a black void.

## What each stage can leave behind

| Stage | Partial state | Recovered by |
|---|---|---|
| Upload | Some images on the node, `status = uploading` | Client checkpoint; re-select the same images and press Start |
| Mirror | `status = mirroring`, lease held | Lease expires after 15 min and the next poll reclaims it |
| Mirror | `status = failed` after 4 transient attempts | Retry control on the scan card |
| Bake | `tiles_baked = false`, cursor parked at a failed tile | Next bake pass retries exactly those tiles |
| View | Ortho not ready | Bounded backoff, then a Try again control |
