import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const TITILER = "https://titiler.xyz";
const SIGNED_TTL = 60 * 60 * 6; // 6h

// Per-instance memory cache so we don't re-mint a signed URL on every tile.
type Cached = { url: string; bands: number; expires: number };
const cache = new Map<string, Cached>();

const EMPTY_PNG = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
), c => c.charCodeAt(0));

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

// Pick the NDVI-style expression for TiTiler based on band count.
// - 4+ bands  -> assume RGB+NIR, real NDVI = (NIR - Red)/(NIR + Red)
// - 3 bands   -> RGB only, fake it with VARI = (G - R)/(G + R - B)
function expressionFor(bands: number): { expression: string; index: "ndvi" | "vari"; label: string } {
  if (bands >= 4) {
    return { expression: "(b4-b1)/(b4+b1)", index: "ndvi", label: "NDVI (NIR-R)/(NIR+R)" };
  }
  return { expression: "(b2-b1)/(b2+b1-b3)", index: "vari", label: "VARI (G-R)/(G+R-B)" };
}

async function resolveTaskCog(taskId: string): Promise<Cached & { taskId: string } | { error: string; status: number }> {
  const now = Date.now();
  const hit = cache.get(taskId);
  if (hit && hit.expires > now + 60_000) return { ...hit, taskId };

  const { data: t, error } = await admin.from("odm_tasks")
    .select("ortho_path").eq("id", taskId).maybeSingle();
  if (error || !t?.ortho_path) return { error: "Orthomosaic not ready", status: 404 };

  const { data: signed, error: sErr } = await admin.storage.from("orthos")
    .createSignedUrl(t.ortho_path as string, SIGNED_TTL);
  if (sErr || !signed?.signedUrl) return { error: "Could not sign orthomosaic URL", status: 500 };

  // Probe band count once.
  let bands = 3;
  try {
    const r = await fetch(`${TITILER}/cog/info?url=${encodeURIComponent(signed.signedUrl)}`);
    if (r.ok) {
      const info = await r.json();
      if (typeof info?.count === "number") bands = info.count;
    }
  } catch { /* fall through with bands=3 */ }

  const entry: Cached = { url: signed.signedUrl, bands, expires: now + (SIGNED_TTL - 600) * 1000 };
  cache.set(taskId, entry);
  return { ...entry, taskId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*\/ndvi-tile/, "");

    // ---- INFO endpoint -----------------------------------------------------
    // GET /ndvi-tile/info?task_id=...
    if (path.startsWith("/info")) {
      const taskId = url.searchParams.get("task_id");
      if (!taskId) return json({ error: "task_id required" }, 400);
      const r = await resolveTaskCog(taskId);
      if ("error" in r) return json({ error: r.error }, r.status);
      const expr = expressionFor(r.bands);
      return json({ bands: r.bands, ...expr });
    }

    // ---- TILE endpoint -----------------------------------------------------
    // GET /ndvi-tile/{taskId}/{z}/{x}/{y}.png
    const m = path.match(/^\/([0-9a-f-]{36})\/(\d+)\/(\d+)\/(\d+)\.png$/i);
    if (!m) return new Response("bad path", { status: 400, headers: corsHeaders });
    const [, taskId, z, x, y] = m;

    const r = await resolveTaskCog(taskId);
    if ("error" in r) {
      return new Response(EMPTY_PNG, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "image/png", "Cache-Control": "public, max-age=30" },
      });
    }
    const { expression } = expressionFor(r.bands);
    const tu = new URL(`${TITILER}/cog/tiles/WebMercatorQuad/${z}/${x}/${y}.png`);
    tu.searchParams.set("url", r.url);
    tu.searchParams.set("expression", expression);
    tu.searchParams.set("rescale", "-1,1");
    tu.searchParams.set("colormap_name", "rdylgn");
    tu.searchParams.set("nodata", "0");

    const tr = await fetch(tu.toString());
    if (!tr.ok) {
      return new Response(EMPTY_PNG, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "image/png", "Cache-Control": "public, max-age=60" },
      });
    }
    const buf = await tr.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "image/png",
        // Tiles are deterministic per task; long cache is fine.
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    return new Response(String((e as Error)?.message ?? e), { status: 500, headers: corsHeaders });
  }
});