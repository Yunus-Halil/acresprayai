# Limits and gaps

Everything here is true of the current build. Do not assume otherwise from the UI copy.

## Not built

- **No live telemetry.** Nothing connects to a real drone. Battery, signal and health on a fleet
  drone are values the user typed; the endurance chart is a linear extrapolation, not a reading.
- **No autonomous execution.** The product produces a waypoint file. A human loads it into a
  flight controller and flies it.
- **No mobile-first UI.** The app shell uses a fixed 240px sidebar and the workspace is a
  seven-tab desktop environment. A `use-mobile` hook exists but the workspace does not use it.
- **No offline capability.** Every screen requires a live connection.
- **No 3D model or point cloud viewer.** ODM produces both and they sit inside `all.zip`, but
  nothing renders them. `three` and `@react-three/fiber` are in the dependency tree unused.
- **No cross-field reporting.** Reports are per-scan, inside the workspace.
- **No team or multi-user accounts.** Every row belongs to exactly one user.
- **No billing, quotas or usage limits.**
- **No internationalisation.** English only, hardcoded. No i18n library is present. Currency is
  configurable per field; language and units are not.
- **No server-side scheduler.** Recovery is driven by a client polling — see
  [pipeline/resilience.md](../pipeline/resilience.md).

## Constraints to design around

### Images are downscaled to 2400 px

On a 20 MP sensor this discards roughly 70% of linear resolution before photogrammetry, roughly
tripling ground sample distance. It is a deliberate upload-speed trade — and a genuine benefit on
a slow connection — but it is currently invisible and not adjustable. It should become a quality
setting the farmer chooses.

### NDVI needs 4+ bands

Ordinary RGB drones get VARI, a visible-light proxy that is **not** NDVI. The UI names which is
in use and the AI's permissions change accordingly. This is honest degradation, not a gate.

### Private imagery transits a third party

Signed orthophoto URLs are handed to the public `titiler.xyz` service for rendering. Two
consequences:

1. **Availability.** If TiTiler rate-limits or goes down, every map in the product breaks
   simultaneously, worldwide. It is a single point of failure not under our control.
2. **Data sovereignty.** Farm imagery leaves our infrastructure, which matters for some
   jurisdictions.

Self-hosting TiTiler closes both.

### The ODM node is shared across tenants

All ownership enforcement happens in the edge functions, which is why they never fall back to
"any completed task on the node". That fallback existed once and cross-contaminated scans between
users. Do not reintroduce it.

### Processing cost scales per scan

Photogrammetry is the expensive part. WebODM Lightning bills per task, so free usage scales
linearly into a cost. Self-hosted NodeODM converts that to a fixed infrastructure cost — the
difference between subsidising a hundred farmers and a hundred thousand. The
`ORTHO_EXTRACT_FROM_ZIP` flag already anticipates a self-hosted worker with more memory.

### Upload limits

Minimum 5, maximum 200 images per scan. The processing node imposes its own ceiling on top and
will reject a batch that exceeds it (surfaced as a 413 that aborts the run immediately).

### Weather reaches the planner via a cache

All three weather consumers — the Weather tab, the standalone `/app/weather` screen and the
planner — now share one client (`src/lib/weather.ts`), one normalisation path through the
`weather` edge function, and one 20-minute `localStorage` entry.

The planner still *reads* rather than fetches: if nothing has populated the cache for that
location, battery estimates run without wind or temperature adjustment. There is no error — the
numbers are simply less accurate.

### Boundary is required for assessment and planning

By design. Without it the treatment grid would lattice neighbouring land.

### Defaults are US-centric

`unit_system` defaults to `imperial` and costs are per-acre. Currency is now a per-field setting
(`FarmerSettings.currency`, ISO 4217) formatted through `Intl.NumberFormat` and threaded into the
AI prompt — but it still **defaults** to USD, and the app remains English-only with no i18n
library. Switching currency relabels; it never converts, since the farmer types prices in their
own currency.

### Pagination is partial

The field list and scan history page 24 rows at a time with a "load more" control
(`src/lib/pagination.ts`). Other reads — flight logs, annotations, archived reports — are still
unbounded `select("*")`. Fine at current scale.

### Inert policies for a dead bucket

Migration `20260624020628` declares object policies for a bucket named `orthomosaics`, from an
earlier iteration. No code references it and the bucket is never created, so the policies are
inert — but they are misleading when auditing storage access. Safe to drop.

## Deployment cleanup outstanding

`analyze-scan` and `analyze-field` were deleted from the repository but may still be **deployed**:

```bash
supabase functions delete analyze-scan
supabase functions delete analyze-field
```

`analyze-scan` accepted an arbitrary image URL with no authentication.
