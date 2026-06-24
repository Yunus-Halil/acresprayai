import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
    if (!taskId) return json({ error: "Missing task_id" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: task } = await admin.from("odm_tasks")
      .select("id, user_id, odm_uuid, ortho_path, tiles_baked, tiles_done, tiles_total, tiles_min_zoom, tiles_max_zoom")
      .eq("id", taskId).maybeSingle();
    if (!task || task.user_id !== ud.user.id) return json({ error: "Not found" }, 404);
    if (!task.odm_uuid || !task.ortho_path) return json({ error: "Orthomosaic not ready" }, 409);

    if (task.tiles_baked) {
      return json({ done: true, completed: task.tiles_done, total: task.tiles_total });
    }

    // Mint a fresh signed URL for the COG so TiTiler can read it.
    const { data: signed, error: sErr } = await admin.storage
      .from("orthos").createSignedUrl(task.ortho_path, SIGNED_TTL);
    if (sErr || !signed?.signedUrl) return json({ error: sErr?.message ?? "sign failed" }, 500);
    const cogUrl = signed.signedUrl;

    // Get bounds + native max zoom from TiTiler once.
    const tjRes = await fetch(`https://titiler.xyz/cog/WebMercatorQuad/tilejson.json?url=${encodeURIComponent(cogUrl)}&tilesize=256`);
    if (!tjRes.ok) return json({ error: `tilejson failed (${tjRes.status})` }, 502);
    const tj = await tjRes.json();
    const b = tj?.bounds;
    if (!Array.isArray(b) || b.length !== 4) return json({ error: "tilejson missing bounds" }, 502);
    const maxNative = Math.min(MAX_Z_CAP, typeof tj?.maxzoom === "number" ? Math.ceil(tj.maxzoom) : MAX_Z_CAP);
    const minZ = MIN_Z;
    const maxZ = Math.max(minZ, maxNative);

    const list = buildTileList([b[0], b[1], b[2], b[3]], minZ, maxZ);
    const total = list.length;

    // Initialize counters on first call.
    if (!task.tiles_total || task.tiles_total !== total) {
      await admin.from("odm_tasks").update({
        tiles_total: total,
        tiles_min_zoom: minZ,
        tiles_max_zoom: maxZ,
        tiles_done: Math.min(task.tiles_done ?? 0, total),
      }).eq("id", task.id);
    }

    const startIdx = Math.min(task.tiles_done ?? 0, total);
    const endIdx = Math.min(total, startIdx + BATCH_PER_INVOCATION);
    const batch = list.slice(startIdx, endIdx);

    let cursor = 0;
    let completedInBatch = 0;

    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= batch.length) return;
        const { z, x, y } = batch[i];
        const tileUrl = `https://titiler.xyz/cog/tiles/WebMercatorQuad/${z}/${x}/${y}.png?url=${encodeURIComponent(cogUrl)}`;
        try {
          const r = await fetch(tileUrl);
          if (!r.ok) {
            // Skip out-of-coverage tiles - count as done but don't store.
            completedInBatch++;
            continue;
          }
          const bytes = new Uint8Array(await r.arrayBuffer());
          if (bytes.byteLength === 0) { completedInBatch++; continue; }
          const path = `${task.odm_uuid}/${z}/${x}/${y}.png`;
          const { error: upErr } = await admin.storage.from("tiles").upload(path, bytes, {
            contentType: "image/png",
            upsert: true,
          });
          if (upErr) console.warn(`[bake-tiles] upload failed ${path}:`, upErr.message);
          completedInBatch++;
        } catch (e) {
          console.warn(`[bake-tiles] tile ${z}/${x}/${y} error:`, (e as Error)?.message);
          completedInBatch++;
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    const newDone = startIdx + completedInBatch;
    const done = newDone >= total;
    await admin.from("odm_tasks").update({
      tiles_done: newDone,
      tiles_baked: done,
    }).eq("id", task.id);

    return json({ done, completed: newDone, total, batch: batch.length, minZ, maxZ });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});