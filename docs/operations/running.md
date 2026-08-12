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
| `LOVABLE_API_KEY` | AI gateway key for `analyze-ortho` |
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

## Deploying

```bash
supabase db push                    # migrations
supabase functions deploy odm-poll  # per function
```

All four storage buckets and their object policies are created by migrations, so `db push` is
sufficient to provision a fresh project. See
[architecture/storage.md](../architecture/storage.md).

## Test coverage

80 tests, all passing.

| File | Tests | Covers |
|---|---|---|
| `src/test/geo.test.ts` | 28 | Geodesic area against known metre-sized squares in both hemispheres, winding independence, point-in-polygon, segment intersection, principal axis, rotation invariants, interior-point finding on concave rings, in-boundary routing |
| `src/test/mission.test.ts` | 24 | Sweep clipping to `boundary ∩ zone`, row counts, repeat interleaving, boustrophedon alternation, balanced sprayer on/off, altitude and speed per phase, distance-to-time derivation, QGC command encoding |
| `src/test/farmerSettings.test.ts` | 27 | Issue-to-cost mapping, growth stage with an injectable clock, legacy settings migration, boundary normalisation, drone spec resolution and aliases, spec-sheet coherence |
| `src/test/example.test.ts` | 1 | Placeholder |

### Not covered

No component or integration tests. The workspace, planner UI, PDF generation and every edge
function are untested. The highest-value additions would be:

1. Edge function contract tests, especially the `odm-poll` lease logic
2. An integration test for the upload resume path
3. A smoke test that the workspace renders with a mocked scan

## Verifying a change to the pipeline

Anything touching `odm-poll`, `bake-tiles` or `scanUpload.ts` should be checked against the
failure table in [pipeline/resilience.md](../pipeline/resilience.md). In particular:

- Does a second concurrent poller still fail to claim the lease?
- Does a killed transfer still get reclaimed after the stale window?
- Does a failed tile still hold the bake cursor?
- Does an interrupted upload still resume without re-sending accepted images?
