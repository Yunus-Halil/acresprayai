import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { fetchResilient, jsonSafe } from "../_shared/net.ts";
import { type RenderPlan, renderTileQuery, resolveRenderPlan } from "../_shared/renderPlan.ts";
import type { BandAnalysis } from "../_shared/bands.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SIGNED_TTL = 60 * 60 * 6;
const MIN_Z = 10;
// The deepest zoom ever baked: zoom 26 is 0.19 cm a pixel at 38 deg N, finer than any flight this app plans. Below
// it the orthophoto's own pixel decides (filePixelM): the shallowest zoom that still shows its detail, so a 6 cm
// orthophoto stops at zoom 21 and nothing is baked that cannot be shown. The cap was 23 until 2026-10-24 (1.61 cm
// at 30.5 deg N, coarser than a 1.07 cm corn flight: it cost the map half its edge sharpness) and 24 until
// 2026-10-25 (src/lib/orthoZoom.ts).
const MAX_Z_CAP = 26;
// Each zoom is four times the tiles of the one above. An automatic bake goes past zoom 23 (the old cap, never
// undercut) only while the whole pyramid fits AUTO_TILE_BUDGET: a 6 ha field at 1 cm is about 20,000 tiles to zoom
// 24. Deeper is on request (the scan panel's "Bake finer map tiles"), up to EXPLICIT_TILE_LIMIT, what one session of
// the client's bake loop carries (400 passes of 220 tiles).
const AUTO_FLOOR_Z = 23;
const AUTO_TILE_BUDGET = 60_000;
const EXPLICIT_TILE_LIMIT = 80_000;
// A zoom shows the orthophoto's detail when its pixel is no coarser than this many of the file's own pixels.
const SHOWS_DETAIL = 1.4;
const BATCH_PER_INVOCATION = 220; // tiles per HTTP call (keeps us well under 150s)
const CONCURRENCY = 12;
const TITILER = "https://titiler.xyz";

function lon2tileX(lon: number, z: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function lat2tileY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

type Tile = { z: number; x: number; y: number };

const metresPerPixel = (lat: number, z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

/** How many tiles the pyramid from minZ to maxZ holds over these bounds. */
function tileCount(bounds: [number, number, number, number], minZ: number, maxZ: number): number {
  const [w, s, e, n] = bounds;
  let total = 0;
  for (let z = minZ; z <= maxZ; z++) {
    total += (Math.abs(lon2tileX(e, z) - lon2tileX(w, z)) + 1) * (Math.abs(lat2tileY(s, z) - lat2tileY(n, z)) + 1);
  }
  return total;
}

/**
 * The orthophoto's own ground pixel in metres, from TiTiler's /cog/info (its width and its bounds in the file's own
 * CRS); null when it cannot be read. Geographic bounds (degrees) are converted at the field's latitude, and Web
 * Mercator metres are taken back to ground metres. TiTiler's own maxzoom stays the floor wherever this is used, so
 * a CRS read wrongly here (a projection in feet) can only leave the bake where it was.
 */
async function filePixelM(cogUrl: string, lat: number): Promise<number | null> {
  try {
    const r = await fetchResilient(`${TITILER}/cog/info?url=${encodeURIComponent(cogUrl)}`, { timeoutMs: 30_000, attempts: 2, label: "bake:info" });
    if (!r.ok) { await r.body?.cancel().catch(() => {}); return null; }
    const info = await jsonSafe<{ bounds?: number[]; width?: number; crs?: string }>(r);
    const b = info?.bounds, w = info?.width;
    if (!Array.isArray(b) || b.length !== 4 || !w) return null;
    const dx = Math.abs(b[2] - b[0]) / w;
    const cos = Math.cos((lat * Math.PI) / 180);
    const geographic = Math.abs(b[0]) <= 180 && Math.abs(b[2]) <= 180 && Math.abs(b[2] - b[0]) < 1;
    const m = geographic ? dx * 111_320 * cos : /3857|900913/.test(info?.crs ?? "") ? dx * cos : dx;
    return m > 0 && Number.isFinite(m) ? m : null;
  } catch {
    return null;
  }
}

/** The shallowest zoom whose pixel is no coarser than `tolerance` file pixels, within MIN_Z..MAX_Z_CAP. */
function zoomShowing(pixelM: number, lat: number, tolerance: number): number {
  for (let z = MIN_Z; z <= MAX_Z_CAP; z++) if (metresPerPixel(lat, z) <= pixelM * tolerance) return z;
  return MAX_Z_CAP;
}

function buildTileList(bounds: [number, number, number, number], minZ: number, maxZ: number): Tile[] {
  const [w, s, e, n] = bounds;
  const out: Tile[] = [];
  for (let z = minZ; z <= maxZ; z++) {
    const x0 = lon2tileX(w, z);
    const x1 = lon2tileX(e, z);
    const y0 = lat2tileY(n, z);
    const y1 = lat2tileY(s, z);
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        out.push({ z, x, y });
      }
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: ud } = await supabase.auth.getUser();
    if (!ud.user) return json({ error: "Unauthorized" }, 401);

    const url = new URL(req.url);
    const taskId = url.searchParams.get("task_id");
    // ?rebake=1 clears the completion latch so a map with holes can be repaired.
    const rebake = url.searchParams.get("rebake") === "1";
    // ?depth=N re-plans the zoom range of a scan already baked, keeping its render plan and every tile it has. The
    // list runs coarse to fine, so a deeper plan only appends the new levels and the cursor resumes at the first new
    // tile; a shallower one only shortens the plan (the deeper tiles stay in storage, unused), which is how a
    // deepening is undone. N is held to one level past the file's own maxzoom (TiTiler's zoom NEAREST the file's
    // pixel, which can be coarser than it: a 1.2 cm file at 30 deg N rounds to zoom 23, 1.61 cm), so every pixel the
    // orthophoto has reaches the map, oversampled at most twice and never invented, and nothing past MAX_Z_CAP.
    const depthParam = url.searchParams.get("depth");
    const depth = depthParam != null && /^\d{1,2}$/.test(depthParam) ? Number(depthParam) : null;
    if (depthParam != null && depth == null) return json({ error: "depth must be a zoom level" }, 400);
    if (!taskId) return json({ error: "Missing task_id" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: task } = await admin.from("odm_tasks")
      .select("id, user_id, odm_uuid, ortho_path, band_mapping, tiles_baked, tiles_done, tiles_total, tiles_failed, tiles_min_zoom, tiles_max_zoom, tiles_plan_locked")
      .eq("id", taskId).maybeSingle();
    if (!task || task.user_id !== ud.user.id) return json({ error: "Not found" }, 404);
    if (!task.odm_uuid || !task.ortho_path) return json({ error: "Orthomosaic not ready" }, 409);

    if (rebake) {
      await admin.from("odm_tasks").update({
        tiles_baked: false, tiles_done: 0, tiles_failed: 0, tiles_plan_locked: false,
      }).eq("id", task.id);
      task.tiles_baked = false;
      task.tiles_done = 0;
      task.tiles_failed = 0;
      task.tiles_plan_locked = false;
    }

    if (depth != null && rebake) return json({ error: "depth and rebake are separate actions" }, 400);
    if (depth != null && (!task.tiles_plan_locked || task.tiles_min_zoom == null || task.tiles_max_zoom == null)) {
      return json({ error: "This scan's tiles have no stored plan yet. Re-render the map tiles first." }, 409);
    }

    if (task.tiles_baked && depth == null) {
      return json({ done: true, completed: task.tiles_done, total: task.tiles_total, failed: 0 });
    }

    // Mint a fresh signed URL for the COG so TiTiler can read it.
    const { data: signed, error: sErr } = await admin.storage
      .from("orthos").createSignedUrl(task.ortho_path, SIGNED_TTL);
    if (sErr || !signed?.signedUrl) return json({ error: sErr?.message ?? "Could not sign the orthomosaic" }, 500);
    const cogUrl = signed.signedUrl;

    // ---- Determine the tile plan ------------------------------------------
    // The zoom range is frozen on the first pass. Re-deriving it from TiTiler on
    // every invocation made the tile list non-deterministic: if maxzoom came
    // back different, `total` changed, the counters reset, and the resume index
    // pointed at the wrong tile - silently skipping some and leaving holes.
    let minZ: number;
    let maxZ: number;
    let bounds: [number, number, number, number] | null = null;

    const tjRes = await fetchResilient(
      `${TITILER}/cog/WebMercatorQuad/tilejson.json?url=${encodeURIComponent(cogUrl)}&tilesize=256&nodata=0`,
      { timeoutMs: 30_000, attempts: 3, label: "bake:tilejson" },
    );
    if (!tjRes.ok) return json({ error: `Tile service unavailable (${tjRes.status}). Try again shortly.` }, 503);
    const tj = await jsonSafe<{ bounds?: number[]; maxzoom?: number }>(tjRes);
    const b = tj?.bounds;
    if (!Array.isArray(b) || b.length !== 4) {
      return json({ error: "The orthomosaic has no usable geographic bounds. Re-process this scan." }, 422);
    }
    bounds = [b[0], b[1], b[2], b[3]];

    const fileMaxZoom = typeof tj?.maxzoom === "number" ? Math.ceil(tj.maxzoom) : null;
    const lat = (bounds[1] + bounds[3]) / 2;
    let pixelM: number | null = null;
    let limitedBy: "tiles" | null = null;
    if (depth != null) {
      // On request: every pixel the file has, oversampled at most twice. Without the file's pixel, one level past
      // TiTiler's zoom, which is the zoom NEAREST the file's pixel and can be coarser than it.
      pixelM = await filePixelM(cogUrl, lat);
      const fileZ = pixelM ? Math.max(fileMaxZoom ?? MIN_Z, zoomShowing(pixelM, lat, 1)) : (fileMaxZoom ?? MAX_Z_CAP) + 1;
      minZ = task.tiles_min_zoom!;
      maxZ = Math.max(minZ, Math.min(depth, MAX_Z_CAP, fileZ));
      while (maxZ > minZ && maxZ > task.tiles_max_zoom! && tileCount(bounds, minZ, maxZ) > EXPLICIT_TILE_LIMIT) { maxZ--; limitedBy = "tiles"; }
    } else if (task.tiles_plan_locked && task.tiles_min_zoom != null && task.tiles_max_zoom != null) {
      minZ = task.tiles_min_zoom;
      maxZ = task.tiles_max_zoom;
    } else {
      pixelM = await filePixelM(cogUrl, lat);
      const fileZ = Math.max(fileMaxZoom ?? MIN_Z, pixelM ? zoomShowing(pixelM, lat, SHOWS_DETAIL) : (fileMaxZoom ?? MAX_Z_CAP));
      minZ = MIN_Z;
      maxZ = Math.max(minZ, Math.min(MAX_Z_CAP, fileZ));
      while (maxZ > AUTO_FLOOR_Z && tileCount(bounds, minZ, maxZ) > AUTO_TILE_BUDGET) { maxZ--; limitedBy = "tiles"; }
    }
    const filePixelCm = pixelM ? Math.round(pixelM * 10000) / 100 : null;

    // ---- Determine how the tiles are rendered -----------------------------
    // Band order, display stretch and nodata come from the file itself and are
    // persisted, so every pass (and every rebake) of one scan renders the same
    // way. See _shared/renderPlan.ts for why each parameter exists.
    type StoredBands = BandAnalysis & { render?: RenderPlan };
    const stored = task.band_mapping as StoredBands | null;
    let renderQS: string;
    // A rebake re-derives the plan: rebaking exists to repair tiles rendered
    // wrongly, and reusing the plan that rendered them would repair nothing.
    if (stored?.render && !rebake) {
      renderQS = renderTileQuery(stored.render);
    } else {
      const { bands: resolvedBands, plan, authoritative } =
        await resolveRenderPlan(TITILER, cogUrl, stored ?? null);
      renderQS = renderTileQuery(plan);
      if (authoritative) {
        await admin.from("odm_tasks")
          .update({ band_mapping: { ...resolvedBands, render: plan } })
          .eq("id", task.id);
      }
    }

    const list = buildTileList(bounds, minZ, maxZ);
    const total = list.length;

    if (depth != null) {
      // A shallower (or equal) plan is already baked in full; a deeper one resumes at its first new tile.
      const already = Math.min(task.tiles_baked ? (task.tiles_total ?? 0) : (task.tiles_done ?? 0), total);
      await admin.from("odm_tasks").update({
        tiles_total: total, tiles_max_zoom: maxZ, tiles_done: already, tiles_baked: already >= total, tiles_failed: 0,
      }).eq("id", task.id);
      task.tiles_done = already;
      task.tiles_failed = 0;
      if (already >= total) return json({ done: true, completed: total, total, failed: 0, minZ, maxZ, fileMaxZoom, filePixelCm, limitedBy });
    } else if (!task.tiles_plan_locked || task.tiles_total !== total) {
      await admin.from("odm_tasks").update({
        tiles_total: total,
        tiles_min_zoom: minZ,
        tiles_max_zoom: maxZ,
        tiles_plan_locked: true,
        tiles_done: Math.min(task.tiles_done ?? 0, total),
      }).eq("id", task.id);
    }

    const startIdx = Math.min(task.tiles_done ?? 0, total);
    const endIdx = Math.min(total, startIdx + BATCH_PER_INVOCATION);
    const batch = list.slice(startIdx, endIdx);

    let cursor = 0;
    let failed = 0;
    // Workers complete out of order, so progress must be tracked by INDEX, not by
    // a success count: advancing the cursor by "number succeeded" would step over
    // tiles that failed and re-do ones that didn't. The cursor may only advance
    // to the first unresolved tile.
    let firstFailedOffset = batch.length;
    const noteFailure = (offset: number) => {
      failed++;
      if (offset < firstFailedOffset) firstFailedOffset = offset;
    };

    // The render query carries nodata (transparent collar), band order and any
    // display stretch — all derived from the file, all persisted, so no two
    // passes of one scan can render differently. See _shared/renderPlan.ts.
    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= batch.length) return;
        const { z, x, y } = batch[i];
        const tileUrl = `${TITILER}/cog/tiles/WebMercatorQuad/${z}/${x}/${y}.png?url=${encodeURIComponent(cogUrl)}${renderQS}`;
        try {
          const r = await fetchResilient(tileUrl, { timeoutMs: 20_000, attempts: 3, label: "bake:tile" });
          if (r.status === 404 || r.status === 204) {
            // Genuinely outside the imagery footprint. Nothing to store, and the
            // tile endpoint serves a transparent pixel for these.
            await r.body?.cancel().catch(() => {});
            continue;
          }
          if (!r.ok) {
            await r.body?.cancel().catch(() => {});
            noteFailure(i);
            continue;
          }
          const bytes = new Uint8Array(await r.arrayBuffer());
          if (bytes.byteLength === 0) continue;
          // User-scoped key: the `tile` function rebuilds this path from the
          // verified owner, so tiles can never be read cross-tenant.
          const path = `${task.user_id}/${task.odm_uuid}/${z}/${x}/${y}.png`;
          const { error: upErr } = await admin.storage.from("tiles").upload(path, bytes, {
            contentType: "image/png",
            upsert: true,
          });
          if (upErr) {
            console.warn(`[bake-tiles] upload failed ${path}: ${upErr.message}`);
            noteFailure(i);
          }
        } catch (e) {
          console.warn(`[bake-tiles] tile ${z}/${x}/${y} error: ${(e as Error)?.message}`);
          noteFailure(i);
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    // Re-doing a handful of already-stored tiles is free (upsert); skipping one
    // is a permanent hole. So on any failure the cursor rewinds to it.
    let advanced = firstFailedOffset;

    // Poison-tile guard: if a tile fails every retry on several consecutive
    // passes the cursor would never move and the client would loop forever.
    // After a few stalls, step over it. One transparent tile beats a hung bake.
    const priorStalls = advanced === 0 ? (task.tiles_failed ?? 0) : 0;
    if (advanced === 0) {
      if (priorStalls >= 3) {
        const t = batch[0];
        console.error(`[bake-tiles] skipping unresolvable tile ${t.z}/${t.x}/${t.y} after ${priorStalls} stalled passes`);
        advanced = 1;
      }
    }

    const newDone = startIdx + advanced;
    const reachedEnd = newDone >= total;
    // A pass with unresolved tiles never marks the bake complete, so the client
    // keeps driving and the holes get filled rather than latched over.
    const done = reachedEnd && failed === 0;

    await admin.from("odm_tasks").update({
      tiles_done: newDone,
      // Doubles as the stall counter when no progress was made.
      tiles_failed: advanced === 0 ? priorStalls + 1 : failed,
      tiles_baked: done,
    }).eq("id", task.id);

    return json({
      done, completed: newDone, total, failed,
      batch: batch.length, minZ, maxZ, fileMaxZoom, filePixelCm, limitedBy,
      // Tells the client to keep going even though the cursor barely moved.
      retrying: failed > 0 && !done,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
