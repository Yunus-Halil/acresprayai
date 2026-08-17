# Identity and access control

## Sign-in

- **Email + password** via `supabase.auth.signUp` / `signInWithPassword`. Signup collects full
  name and farm name into user metadata and requires email confirmation.
- **Google OAuth** via `supabase.auth.signInWithOAuth`, redirecting to `/app`. Requires the
  Google provider enabled in the project's auth settings.
- A Postgres trigger on `auth.users` creates a `profiles` row automatically on signup.

Sessions persist in `localStorage` and auto-refresh. `RequireAuth` is the one route guard:
`AppLayout` wraps its shell in it for every `/app/*` route, and `/admin/pilot-applications` uses
it directly. It redirects to `/auth` when there is no user, and deliberately waits rather than
redirecting while the session is still restoring. The workspace route sits outside that shell and
checks the session itself.

**`RequireAuth` proves someone is signed in, not that they may see any particular data.** Every
customer of the product has an account. Anything sensitive still authorises server-side —
`/admin/pilot-applications` renders for any signed-in user, but its data comes from a function
that returns 403 to anyone off the admin allowlist.

## Authorisation model

| Surface | How access is enforced |
|---|---|
| Direct table reads/writes | RLS policy `auth.uid() = user_id` |
| Storage objects | Bucket policies keyed on the first path segment being the user's id |
| Edge functions (JSON) | `Authorization: Bearer <jwt>` → `auth.getUser()` → explicit `user_id` comparison against the target row |
| Map tile endpoints | JWT via header **or** `?token=`, then ownership lookup against `odm_tasks`; the storage key is rebuilt server-side from the verified owner |
| Pilot applications | JWT, then an **email allowlist** (`PILOT_ADMIN_EMAILS`) — these rows have no owner to compare against |

## The service-role rule

Edge functions use two Supabase clients:

```ts
// Scoped to the caller. Respects RLS. Used ONLY to resolve who is calling.
const supabase = createClient(URL, ANON_KEY, {
  global: { headers: { Authorization: auth } },
});
const { data: ud } = await supabase.auth.getUser();

// Bypasses RLS entirely. Every read/write through this MUST be preceded by an
// explicit ownership check.
const admin = createClient(URL, SERVICE_ROLE_KEY);
```

Any function touching `admin` without first comparing `row.user_id` to `ud.user.id` is a
tenancy bug. This pattern is followed by every function currently in the tree.

## Why tile endpoints are different

Leaflet requests map tiles as plain `<img>` GETs, which cannot carry an `Authorization` header.

`tile` and `ndvi-tile` therefore run with `verify_jwt = false` in `supabase/config.toml` and
perform their own verification via `_shared/tileAuth.ts`, accepting the session token from the
query string. The token in the URL is the live session JWT, and the client refreshes the tile
template whenever the session rotates — otherwise tiles would start returning 401 about an hour
into a session.

`tileAuth.ts` memoises both the token→user lookup and the uuid→owner lookup per warm instance, so
a full map viewport costs one auth round-trip rather than several hundred.

Responses from these endpoints are `Cache-Control: private` — they are user-scoped and must never
sit in a shared cache.

## Failure responses

Ownership failures and missing rows return the same **404** from every function. Distinguishing
them would let a caller probe which scan ids exist by watching status codes.

`odm-poll` used to return 404 for a missing scan but 403 for someone else's, which was exactly
that oracle. It is now uniform, and `src/test/edge/tenancy.test.ts` asserts the property across
every function so it cannot regress:

- Identical status **and body** for an unowned row versus a nonexistent one
- No storage read or write performed on a row the caller does not own
- 401 for an unauthenticated caller, with no storage access

The one deliberate exception is shape, not information: `ndvi-tile` serves a transparent pixel
for states an *owner* can legitimately hit (orthomosaic not ready), while still returning 404
when the caller has no claim to the scan.

## Known exposure

`analyze-scan` and `analyze-field` — an unauthenticated function accepting an arbitrary image
URL, and a dead sibling — have been deleted from the repository. **They may still be deployed.**
Removing the files stops them shipping; the deployed functions must be removed separately:

```bash
supabase functions delete analyze-scan
supabase functions delete analyze-field
```
