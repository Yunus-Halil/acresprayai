# Running and verifying

## Commands

| Command | Effect |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Vite dev server |
| `npm run build` | Production bundle |
| `npm run build:dev` | Development-mode bundle |
| `npm run preview` | Serve the built bundle |
| `npm test` | Vitest, single run |
| `npm run test:watch` | Vitest in watch mode |
| `npm run lint` | ESLint across the repo |

Typecheck without emitting: `npx tsc --noEmit -p tsconfig.app.json`

## Configuration

### Client — `.env`

Gitignored. Copy `.env.example` and fill in.

```
VITE_SUPABASE_PROJECT_ID=""
VITE_SUPABASE_URL=""
VITE_SUPABASE_PUBLISHABLE_KEY=""
```

These are public by nature — the anon key is safe in a browser bundle **because** RLS is enforced
on every table. If RLS were ever disabled on a table, this key would become a data leak.

### Server — Supabase edge function secrets

Never in the repo. Set with `supabase secrets set`.

| Secret | Purpose |
|---|---|
| `ODM_BASE_URL` | Processing node base URL |
| `ODM_AUTH_TOKEN` | Processing node token |
| `AI_API_KEY` | Vision provider key for `analyze-ortho` |
| `AI_GATEWAY_URL` | Optional. Any OpenAI-compatible `/chat/completions` endpoint. Defaults to Google's OpenAI-compatible endpoint |
| `AI_MODEL` | Optional. Defaults to `gemini-2.5-flash`; use `google/gemini-2.5-flash` on OpenRouter |
| `OPENWEATHER_API_KEY` | Optional — falls back to Open-Meteo |
| `ORTHO_EXTRACT_FROM_ZIP` | `"true"` only on a worker with more than 256 MB |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.

### Function JWT settings — `supabase/config.toml`

```toml
[functions.ndvi-tile]
verify_jwt = false

[functions.tile]
verify_jwt = false
```

Both verify the token themselves; see [architecture/auth.md](../architecture/auth.md). Every other
function relies on the platform gate **and** re-checks ownership.

### Google sign-in

Enable the Google provider in the Supabase project's auth settings with a client ID and secret
from Google Cloud Console, and list `https://<project-ref>.supabase.co/auth/v1/callback` as an
authorised redirect URI. Sign-in uses `supabase.auth.signInWithOAuth` directly — there is no
third-party auth shim.

## Deploying

```bash
supabase db push                    # migrations
supabase functions deploy odm-poll  # per function
```

All four storage buckets and their object policies are created by migrations, so `db push` is
sufficient to provision a fresh project. See
[architecture/storage.md](../architecture/storage.md).

## Test coverage

180 tests, all passing.

### Pure logic

| File | Tests | Covers |
|---|---|---|
| `src/test/geo.test.ts` | 28 | Geodesic area against known metre-sized squares in both hemispheres, winding independence, point-in-polygon, segment intersection, principal axis, rotation invariants, interior-point finding on concave rings, in-boundary routing |
| `src/test/mission.test.ts` | 24 | Sweep clipping to `boundary ∩ zone`, row counts, repeat interleaving, boustrophedon alternation, balanced sprayer on/off, altitude and speed per phase, distance-to-time derivation, QGC command encoding |
| `src/test/farmerSettings.test.ts` | 35 | Issue-to-cost mapping, growth stage with an injectable clock, legacy settings migration, boundary normalisation, drone spec resolution and aliases, spec-sheet coherence |
| `src/test/scanUpload.test.ts` | 18 | Resume sends only unaccepted images; a failing image does not abort the batch; transient retry; `name:size:lastModified` checkpoint keying; stale and mismatched checkpoints; `max_images` aborts immediately; 4xx not retried; commit failure keeps the checkpoint; pause and resume |

### Edge function contracts

These run the **real function code**. `vitest.config.ts` aliases the `https://esm.sh` imports to
local mocks, and `src/test/edge/harness.ts` stubs `Deno.env` / `Deno.serve` / `EdgeRuntime` and
provides an in-memory Supabase client. The database mock implements the slice of PostgREST the
functions use — including the `.or()` filter string the mirror lease depends on, since the lease
*is* that filter.

| File | Tests | Covers |
|---|---|---|
| `src/test/edge/odm-poll.test.ts` | 15 | Status mapping, upstream unreachability, HTML error pages, lease claim and release, concurrent poller exclusion, stale-lease reclaim, idempotent re-mirroring, the 4-attempt transient budget, explicit retry, cross-tenant isolation |
| `src/test/edge/bake-tiles.test.ts` | 14 | User-scoped keys, cursor held by a failed tile, never reporting done with failures, storage-failure accounting, resume from cursor, frozen zoom plan, poison-tile guard, rebake, upstream 503 and missing bounds |
| `src/test/edge/tile.test.ts` | 12 | Token via header or query, path rebuilt from the verified owner, legacy fallback only after ownership, path-parsing rejection, transparent-pixel misses, private caching |
| `src/test/edge/tenancy.test.ts` | 21 | Across all seven functions: identical response for unowned versus nonexistent, no storage touched for a foreign row, 401 unauthenticated, 404 never 403 |

Run just the edge tests with `npx vitest run src/test/edge`.

### Not covered

No component or integration tests. The workspace UI, planner UI and PDF generation are untested,
as is `analyze-ortho`'s prompt construction and response normalisation.

`src/test/workspace.smoke.test.tsx` (5 tests) covers the workspace shell: load sequence, tab-bar
render with only the default tab mounted, progress and error states, tile-bake driving, and
non-WGS84 rejection.

## Verifying a change to the pipeline

Anything touching `odm-poll`, `bake-tiles` or `scanUpload.ts` should be checked against the
failure table in [pipeline/resilience.md](../pipeline/resilience.md). In particular:

- Does a second concurrent poller still fail to claim the lease?
- Does a killed transfer still get reclaimed after the stale window?
- Does a failed tile still hold the bake cursor?
- Does an interrupted upload still resume without re-sending accepted images?
