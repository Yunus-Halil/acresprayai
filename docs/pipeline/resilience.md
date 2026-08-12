# Resilience

How the orthomosaic pipeline behaves when things go wrong. This is the document to read before
changing anything in `odm-poll`, `bake-tiles` or `scanUpload.ts`.

## Principle

Every failure in this pipeline is either **transient** (retry it) or **permanent** (tell the
farmer why). Nothing is allowed to become a silent hang, and no state is unrecoverable. An
unbounded retry loop is indistinguishable from a hang to the person watching it, so every wait
ends in something actionable.

## Failure modes and their handling

### 1 · Duplicate concurrent transfers

**Was:** the client polls every 5s. During a mirror the status stayed `processing`, so every tick
saw a completed ODM task and started *another* full multi-gigabyte download and upload of the
same archive.

**Now:** the transfer is claimed with a conditional UPDATE. Only the worker whose UPDATE matched
a row proceeds:

```ts
const { data: claimed } = await admin.from("odm_tasks")
  .update({ status: "mirroring", mirror_started_at: now })
  .eq("id", task.id)
  .or(`status.in.(queued,processing,uploading),and(status.eq.mirroring,mirror_started_at.lt.${staleCutoff})`)
  .select("id, mirror_attempts");
if (!claimed?.length) return json({ status: "mirroring", progress: 99 });
```

This is an atomic `UPDATE … WHERE` in Postgres. Losing the race is normal and returns quietly.

### 2 · Transfer killed mid-flight

**Was:** `EdgeRuntime.waitUntil` gives no completion guarantee. An instance recycled mid-transfer
left the scan pinned at 99% forever, with nothing to retry it.

**Now:** the lease carries `mirror_started_at`. A lease older than **15 minutes** is considered
dead and the next poll reclaims it. Generous, because a large archive legitimately takes a while.

### 3 · Transient upstream failure marked permanent

**Was:** one 502 from the node → `status: failed`, permanently.

**Now:** transient failures release the lease and increment `mirror_attempts`. Only after
**4 consecutive** attempts is the scan actually marked failed, with the attempt count in the
message. `isTransient()` in `_shared/net.ts` makes the call.

### 4 · No timeouts anywhere

**Was:** every external call was a bare `fetch`. A hung socket held an edge invocation until the
platform killed it.

**Now:** all external calls go through `fetchResilient()` with a hard per-attempt timeout and
exponential backoff with full jitter.

| Call | Timeout | Attempts |
|---|---|---|
| ODM task info | 20s | 3 |
| ODM orthophoto | 120s | 1 (streaming) |
| ODM `all.zip` | 240s | 1 (streaming) |
| TiTiler tilejson | 30s | 3 |
| TiTiler tile | 20s | 3 |

Streaming calls are never retried — the body can only be read once.

Retryable statuses: `408, 425, 429, 500, 502, 503, 504, 522, 524`. Anything else is the server's
real answer and is returned to the caller to branch on.

### 5 · Unguarded JSON parsing

**Was:** `await infoRes.json()` threw when an upstream proxy returned an HTML error page. The
client's `.catch(() => {})` swallowed it and the scan silently never advanced.

**Now:** `jsonSafe()` returns `null` instead of throwing, and the caller reports the upstream
status without touching the scan's own state.

### 6 · Failed tiles counted as done

**Was:** a tile whose storage upload failed was still counted as complete. `tiles_baked` then
latched `true` over a map with permanent holes and no way to re-bake.

**Now:**

- Only tiles that actually stored — or that TiTiler reports as outside the imagery (404/204) —
  count as settled.
- Any failure holds the cursor: progress is tracked by **index**, not by a success count.
  Workers finish out of order, so advancing by "number succeeded" would step over failures.
  The cursor rewinds to the first unresolved tile.
- A pass with failures never reports `done`, so the client keeps driving.
- `?rebake=1` clears the latch entirely to repair a map after the fact.

Re-doing a handful of already-stored tiles is free (`upsert`); skipping one is a permanent hole.

**Poison-tile guard:** if a tile fails every retry on 3 consecutive passes the cursor would never
move, so the baker steps over it and logs loudly. One transparent tile beats a hung bake.

### 7 · Non-deterministic tile list

**Was:** the zoom range was re-derived from TiTiler on every invocation. If `maxzoom` came back
different, `total` changed, the counters reset, and the resume cursor pointed at the wrong tile —
silently skipping some.

**Now:** `tiles_plan_locked` freezes `tiles_min_zoom` / `tiles_max_zoom` after the first pass.

### 8 · All-or-nothing uploads

**Was:** two concurrent uploads, one retry per image, failures collected and thrown at the end.
An image failing at #140 of 200 destroyed the whole batch, left the scan stuck in `uploading`
forever, and cost the farmer the data allowance for the 140 images that had landed.

On a metered rural connection this was the difference between using the product and not.

**Now:** `src/lib/scanUpload.ts`

- Each image retries independently, 4 attempts with exponential backoff
- One image failing does **not** abort the run; failures are reported so they can be retried
- Progress is checkpointed to `localStorage` after every accepted image
- An interrupted batch resumes: only images not already accepted are re-sent
- The upload can be paused deliberately, and resumed later
- A genuinely permanent rejection (node batch-size limit) aborts immediately rather than
  burning data on 199 more doomed attempts
- The server counts accepted images in `upload_received`, so a stalled scan can be diagnosed
  without trusting the browser

Files are identified across page loads by `name:size:lastModified`.

### 9 · Unbounded viewer retry

**Was:** a 409 from `ortho-url` scheduled another attempt in 5s, forever.

**Now:** bounded at 40 attempts with backoff easing from 5s to 30s (~15 minutes), then an
explicit message with a **Try again** control. The bake loop similarly stops after 8 consecutive
zero-progress passes.

## Retry entry points

| Where | Effect |
|---|---|
| Scan card → **Retry** | `odm-poll` with `{ retry: true }` — clears the failure, resets attempt counters, re-enters the status machine |
| Upload card → **Start / resume** | Re-runs `uploadScan`, sending only missing images |
| Upload card → **Discard saved progress** | Clears the checkpoint for a clean start |
| Workspace error → **Try again** | Re-runs the whole load sequence |
| `bake-tiles?rebake=1` | Clears the tile latch and re-bakes from zero |

## What is still not guaranteed

- **No server-side scheduler.** Recovery is driven by a client polling. A scan whose owner never
  reopens the app will sit in `mirroring` until someone does. A cron sweep reclaiming stale
  leases would close this.
- **No dead-letter surface.** Repeatedly failing scans are visible only on their own field page.
- **Upload checkpoints are per-browser.** Starting on a phone and resuming on a laptop re-sends
  everything, since the checkpoint lives in `localStorage`. `upload_received` on the server makes
  a cross-device version possible but it is not wired up.
