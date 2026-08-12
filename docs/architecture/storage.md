# Storage

Four private buckets. The browser never receives a bucket-wide credential — it gets short-lived
signed URLs minted by an edge function, or streams bytes through the `tile` proxy.

| Bucket | Path convention | Contents |
|---|---|---|
| `scans` | `{user_id}/odm/{odm_uuid}/all.zip` | The complete OpenDroneMap output archive, mirrored off the processing node |
| `orthos` | `{user_id}/{odm_uuid}.tif` | The extracted orthophoto GeoTIFF. This is the file TiTiler renders from |
| `tiles` | `{user_id}/{odm_uuid}/{z}/{x}/{y}.png` | Pre-baked XYZ map tiles |
| `field-reports` | `{user_id}/{field_id}/{task_id}/{timestamp}.pdf` | Generated mission report PDFs |

## Why paths start with the user id

Storage object policies key on the first path segment matching `auth.uid()`. That gives
per-user isolation at the storage layer, independent of whatever the application does.

For tiles this matters twice over. The `tile` edge function accepts only an `odm_uuid` from the
caller, looks up who owns that scan, and **rebuilds the storage key from the verified owner**.
The caller never supplies a path, so a crafted path cannot reach another tenant's objects.

Tiles baked before this scoping existed live at the un-prefixed key `{odm_uuid}/{z}/{x}/{y}.png`.
The `tile` function falls back to that path — but only *after* ownership has been verified, so
the fallback is not a hole.

## Signed URL lifetimes

| Purpose | TTL |
|---|---|
| Orthophoto for viewing / tiling | 6 hours |
| Orthophoto for AI preview | 15 minutes |
| `all.zip` download for the user | 10 minutes |
| `all.zip` for browser-side extraction | 30 minutes |
| Archived report PDF | 10 minutes |

## Reproducibility gap

> **Only the `scans` bucket is created by a migration.**

`orthos`, `tiles` and `field-reports` were created through the Supabase dashboard. A fresh
project **cannot** be provisioned from this repository alone — those three buckets and their
object policies must be recreated by hand, or captured in a new migration.

This is worth closing before anyone tries to stand up a second environment.

## Third-party exposure

Signed URLs to private orthophotos are handed to the public `titiler.xyz` service so it can
render tiles, previews and statistics. The imagery therefore transits infrastructure not
operated by us, for the lifetime of the signed URL.

Self-hosting TiTiler would close both this and the availability risk described in
[operations/limits.md](../operations/limits.md).
