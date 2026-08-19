import { admin, readToken, taskById, userIdFromToken } from "../_shared/tileAuth.ts";
import { type BandAnalysis, type VegetationIndex, analyseBands, expressionFor } from "../_shared/bands.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const TITILER = "https://titiler.xyz";
const SIGNED_TTL = 60 * 60 * 6; // 6h

// Per-instance memory cache so we don't re-mint a signed URL on every tile.
type Cached = { url: string; bands: BandAnalysis; expires: number };
const cache = new Map<string, Cached>();

const EMPTY_PNG = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
), c => c.charCodeAt(0));

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

// Why the failures are distinguished:
//   `denied`     the caller does not own this scan (or it does not exist - the
//                two are deliberately indistinguishable). Answered with 404, to
//                match the `tile` endpoint rather than quietly serving a blank.
//   `unavailable` a legitimate transient state for the owner: the orthomosaic
//                isn't ready yet, or the tile service is unhappy. Answered with
//                a transparent pixel so the map doesn't fill with broken tiles.
type ResolveFailure = { error: string; status: number; reason: "denied" | "unavailable" };

// Verifies the caller owns the scan, then resolves (and memoises) its COG.
// The ownership check runs before the cache lookup so a cached entry can never
// be served to a different user.
async function resolveTaskCog(
  taskId: string,
  userId: string,
): Promise<Cached & { taskId: string } | ResolveFailure> {
  const task = await taskById(taskId);
  // Identical response for "no such scan" and "not yours" - no existence probe.
  if (!task || task.userId !== userId) {
    return { error: "Scan not found", status: 404, reason: "denied" };
  }

  const now = Date.now();
  const hit = cache.get(taskId);
  if (hit && hit.expires > now + 60_000) return { ...hit, taskId };

  if (!task.orthoPath) {
    return { error: "Orthomosaic not ready", status: 409, reason: "unavailable" };
  }

  const { data: signed, error: sErr } = await admin.storage.from("orthos")
    .createSignedUrl(task.orthoPath, SIGNED_TTL);
  if (sErr || !signed?.signedUrl) {
    return { error: "Could not sign orthomosaic URL", status: 500, reason: "unavailable" };
  }

  // Band roles are a property of the file and never change for a given scan,
  // so they are resolved once and stored on the row. The per-instance memo
  // above still avoids re-signing the URL; this avoids re-probing TiTiler on
  // every cold start. Clearing odm_tasks.band_mapping forces a re-probe.
  let bands = task.bandMapping as BandAnalysis | null;
  if (!bands?.fingerprint) {
    bands = analyseBands(null);
    try {
      const r = await fetch(`${TITILER}/cog/info?url=${encodeURIComponent(signed.signedUrl)}`);
      if (r.ok) bands = analyseBands(await r.json());
    } catch { /* fall through with the conservative RGB default */ }
    console.log(`[ndvi-tile] ${taskId}: ${bands.reason}`);
    await admin.from("odm_tasks").update({ band_mapping: bands }).eq("id", taskId);
  }

  const entry: Cached = { url: signed.signedUrl, bands, expires: now + (SIGNED_TTL - 600) * 1000 };
  cache.set(taskId, entry);
  return { ...entry, taskId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*\/ndvi-tile/, "");

    // Leaflet can't set headers on <img> requests, so the session JWT may also
    // arrive as ?token=. Either way it is verified before anything is served.
    const userId = await userIdFromToken(readToken(req, url));
    if (!userId) return json({ error: "Unauthorized" }, 401);

    // ---- INFO endpoint -----------------------------------------------------
    // GET /ndvi-tile/info?task_id=...
    if (path.startsWith("/info")) {
      const taskId = url.searchParams.get("task_id");
      if (!taskId) return json({ error: "task_id required" }, 400);
      const r = await resolveTaskCog(taskId, userId);
      if ("error" in r) return json({ error: r.error }, r.status);
      const expr = expressionFor(r.bands);
      return json({
        bands: r.bands.total,
        spectralBands: r.bands.spectral,
        hasAlpha: r.bands.hasAlpha,
        hasNDVI: r.bands.hasNDVI,
        ambiguousMultispectral: r.bands.ambiguousMultispectral,
        // Which physical band each role resolved to, and how it was determined,
        // so the legend can say not just which index is shown but why.
        roles: r.bands.roles,
        method: r.bands.method,
        available: r.bands.available,
        fingerprint: r.bands.fingerprint,
        reason: r.bands.reason,
        ...expr,
      });
    }

    // ---- TILE endpoint -----------------------------------------------------
    // GET /ndvi-tile/{taskId}/{z}/{x}/{y}.png
    const m = path.match(/^\/([0-9a-f-]{36})\/(\d+)\/(\d+)\/(\d+)\.png$/i);
    if (!m) return new Response("bad path", { status: 400, headers: corsHeaders });
    const [, taskId, z, x, y] = m;

    const r = await resolveTaskCog(taskId, userId);
    if ("error" in r) {
      // Refuse outright when the caller has no claim to the scan; serve a
      // transparent pixel only for states an owner can legitimately hit.
      if (r.reason === "denied") return json({ error: r.error }, r.status);
      return new Response(EMPTY_PNG, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "image/png", "Cache-Control": "private, max-age=30" },
      });
    }
    const requested = url.searchParams.get("index") as VegetationIndex | null;
    const { expression } = expressionFor(r.bands, requested ?? "ndvi");
    const tu = new URL(`${TITILER}/cog/tiles/WebMercatorQuad/${z}/${x}/${y}.png`);
    tu.searchParams.set("url", r.url);
    tu.searchParams.set("expression", expression);
    tu.searchParams.set("rescale", "-1,1");
    tu.searchParams.set("nodata", "0");
    // ?raw=1 omits the colormap, so TiTiler returns an 8-bit GREYSCALE ramp of
    // the same -1..1 rescale. That is cleanly invertible client side:
    //
    //     index = -1 + (grey / 255) * 2      (precision ~0.008)
    //
    // The colormapped default is NOT invertible — rdylgn is non-monotonic in
    // RGB, so two different index values can share a colour. Anything that
    // needs NUMBERS rather than a picture must pass raw=1; sampling the default
    // tiles looks like it yields NDVI and does not.
    if (url.searchParams.get("raw") !== "1") {
      tu.searchParams.set("colormap_name", "rdylgn");
    }

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
        // Deterministic per task, but user-scoped - never let a shared cache hold it.
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (e) {
    return new Response(String((e as Error)?.message ?? e), { status: 500, headers: corsHeaders });
  }
});