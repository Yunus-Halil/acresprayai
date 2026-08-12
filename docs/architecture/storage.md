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

## Provisioning

All four buckets and their object policies are created by migrations. A fresh project can be
provisioned from this repository with `supabase db push`.

| Bucket | Created in | Policies |
|---|---|---|
| `scans` | `20260520165803` | Owner-scoped SELECT/INSERT/DELETE, plus UPDATE from `20260629155456` |
| `orthos` | `20260812140000` | Owner-scoped SELECT/INSERT/UPDATE/DELETE |
| `tiles` | `20260812140000` | `service_role` only — see below |
| `field-reports` | `20260812140000` | Owner-scoped SELECT/INSERT/UPDATE/DELETE |

Every owner-scoped policy uses the same predicate:

```sql
bucket_id = '<bucket>' AND (storage.foldername(name))[1] = auth.uid()::text
```

`20260812140000` is idempotent — bucket inserts are `ON CONFLICT DO NOTHING` and every policy is
dropped before being recreated — so it is safe to run against the existing project.

### Why `tiles` has no authenticated policy

Deliberate. Authenticated users never touch that bucket directly: `bake-tiles` writes with the
service-role key, and the `tile` function reads with it, rebuilding the object path from the
*verified owner* of the scan rather than from caller input. A direct-read policy would widen the
surface for no benefit.

### Historical note

Object policies for `orthos` and `field-reports` already existed in earlier migrations
(`20260624045526`, `20260629155456`, `20260629183542`) — only the **bucket rows** were missing,
which is why the dashboard-created project worked while a fresh one would not.

`20260812140000` also closed a real gap: the `field-reports` UPDATE policy had `USING` but no
`WITH CHECK`, so a user could update one of their own objects into another user's folder.

There are also inert policies referencing a bucket named `orthomosaics` (migration
`20260624020628`) from an earlier iteration. No code references that bucket and it is not
created anywhere; the policies are harmless but misleading.

## Third-party exposure

Signed URLs to private orthophotos are handed to the public `titiler.xyz` service so it can
render tiles, previews and statistics. The imagery therefore transits infrastructure not
operated by us, for the lifetime of the signed URL.

Self-hosting TiTiler would close both this and the availability risk described in
[operations/limits.md](../operations/limits.md).
