import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { fetchResilient, jsonSafe } from "../_shared/net.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SIGNED_TTL = 60 * 60 * 6;
const MIN_Z = 10;
const MAX_Z_CAP = 20;
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
    if (!taskId) return json({ error: "Missing task_id" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: task } = await admin.from("odm_tasks")
      .select("id, user_id, odm_uuid, ortho_path, tiles_baked, tiles_done, tiles_total, tiles_failed, tiles_min_zoom, tiles_max_zoom, tiles_plan_locked")
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

    if (task.tiles_baked) {
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

    if (task.tiles_plan_locked && task.tiles_min_zoom != null && task.tiles_max_zoom != null) {
      minZ = task.tiles_min_zoom;
      maxZ = task.tiles_max_zoom;
    } else {
      const maxNative = Math.min(MAX_Z_CAP, typeof tj?.maxzoom === "number" ? Math.ceil(tj.maxzoom) : MAX_Z_CAP);
      minZ = MIN_Z;
      maxZ = Math.max(minZ, maxNative);
    }

    const list = buildTileList(bounds, minZ, maxZ);
    const total = list.length;

    if (!task.tiles_plan_locked || task.tiles_total !== total) {
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

    // `nodata=0` is what keeps the black collar out of the baked tiles. An ODM
    // orthophoto is a rectangle with the flight footprint in the middle and
    // zeroes everywhere else; without this, TiTiler has no reason to think 0 is
    // special and bakes it as opaque black, which then sits over the basemap as
    // a hard rectangle around the field. With it, the collar becomes alpha 0.
    //
    // The trade is that a genuinely pure-black pixel inside the footprint also
    // goes transparent. On real crop imagery that is close to nonexistent, and
    // a stray transparent pixel is far cheaper than burying the whole basemap.
    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= batch.length) return;
        const { z, x, y } = batch[i];
        const tileUrl = `${TITILER}/cog/tiles/WebMercatorQuad/${z}/${x}/${y}.png?url=${encodeURIComponent(cogUrl)}&nodata=0`;
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
      batch: batch.length, minZ, maxZ,
      // Tells the client to keep going even though the cursor barely moved.
      retrying: failed > 0 && !done,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
