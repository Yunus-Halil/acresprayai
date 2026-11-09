import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { NOT_IN_PILOT, isOdmUuid, isPlainAssetName, pilotRole } from "../_shared/access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const ODM_BASE_URL = (Deno.env.get("ODM_BASE_URL") ?? "").trim().replace(/^['"]|['"]$/g, "").replace(/\/$/, "");
const ODM_AUTH_TOKEN = (Deno.env.get("ODM_AUTH_TOKEN") ?? "").trim().replace(/^['"]|['"]$/g, "");

function odmUrl(path: string) {
  const u = new URL(`${ODM_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`);
  u.searchParams.set("token", ODM_AUTH_TOKEN);
  return u.toString();
}

async function verifyTaskBelongsToUser(uuid: string, userId: string) {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data } = await admin.from("odm_tasks").select("user_id").eq("odm_uuid", uuid).maybeSingle();
  return data?.user_id === userId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const uuid = url.searchParams.get("uuid");
    const probe = url.searchParams.get("probe");
    const tile = url.searchParams.get("tile"); // z/x/y
    const asset = url.searchParams.get("asset"); // raw asset path
    const info = url.searchParams.get("info"); // "task" | "ortho"

    // The uuid is interpolated into the node's URL below, so anything that is not an ODM uuid stops here.
    if (!isOdmUuid(uuid)) {
      return new Response(JSON.stringify({ error: "Missing uuid" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auth: accept token in Authorization header OR ?token=<jwt> (for Leaflet tile URLs)
    const auth = req.headers.get("Authorization") ?? (url.searchParams.get("token") ? `Bearer ${url.searchParams.get("token")}` : "");
    if (!auth) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: ud } = await supabase.auth.getUser();
    if (!ud.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Founder-only during the pilot: this proxies the shared, paid processing node.
    {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      if ((await pilotRole(admin, ud.user.id)) !== "founder") {
        return new Response(JSON.stringify(NOT_IN_PILOT), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // Same 404 whether the scan is missing or someone else's - no existence oracle.
    if (!(await verifyTaskBelongsToUser(uuid, ud.user.id))) {
      return new Response(JSON.stringify({ error: "Scan not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Probe whether an orthomosaic asset exists
    if (probe === "ortho") {
      const r = await fetch(odmUrl(`/task/${uuid}/info`));
      const info = await r.json().catch(() => ({}));
      const available = Array.isArray(info?.imagesCount ? info?.availableAssets : info?.availableAssets)
        && (info.availableAssets ?? []).some((a: string) => /orthophoto|orthomosaic/i.test(a));
      return new Response(JSON.stringify({ available }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Info passthrough: ?info=task | ?info=ortho
    if (info === "task") {
      const r = await fetch(odmUrl(`/task/${uuid}/info`));
      const j = await r.json().catch(() => ({}));
      return new Response(JSON.stringify(j), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (info === "ortho") {
      // Try TileJSON first (most reliable), then fall back to metadata
      let j: any = {};
      let status = 200;
      try {
        const r1 = await fetch(odmUrl(`/task/${uuid}/orthophoto/tiles.json`));
        if (r1.ok) {
          j = await r1.json();
        } else {
          const r2 = await fetch(odmUrl(`/task/${uuid}/orthophoto/metadata`));
          status = r2.status;
          j = await r2.json().catch(() => ({}));
        }
      } catch (e) {
        j = { error: String((e as Error)?.message ?? e) };
        status = 500;
      }
      return new Response(JSON.stringify(j), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Tile passthrough: ?tile=z/x/y
    if (tile) {
      const m = tile.match(/^(\d+)\/(\d+)\/(\d+)$/);
      if (!m) return new Response("bad tile", { status: 400, headers: corsHeaders });
      const [, z, x, y] = m;
      const r = await fetch(odmUrl(`/task/${uuid}/orthophoto/tiles/${z}/${x}/${y}.png`));
      if (!r.ok) return new Response("tile not found", { status: r.status, headers: corsHeaders });
      return new Response(r.body, {
        headers: { ...corsHeaders, "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
      });
    }

    // Raw ODM assets can be huge; never proxy orthophotos or files over 10MB to the browser.
    if (asset) {
      // One plain file name, never a path: "../" (decoded or not) would walk out of this task's assets to other node
      // endpoints with the server's ODM token, such as the list of every task on the node.
      if (!isPlainAssetName(asset)) {
        return new Response(JSON.stringify({ error: "Unknown asset" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (/orthophoto|orthomosaic|\.tiff?$/i.test(asset)) {
        return new Response(JSON.stringify({ error: "Raw orthomosaic downloads are disabled. Use tiled viewing." }), {
          status: 413,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const r = await fetch(odmUrl(`/task/${uuid}/assets/${encodeURIComponent(asset)}`));
      // A response that does not say how big it is is treated as too big: the limit cannot be enforced otherwise.
      const lenHeader = r.headers.get("Content-Length");
      const len = lenHeader != null && /^\d+$/.test(lenHeader) ? Number(lenHeader) : Infinity;
      if (len > 10_000_000) {
        await r.body?.cancel();
        return new Response(JSON.stringify({ error: "Asset is too large for direct browser download. Use tiled viewing." }), {
          status: 413,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(r.body, {
        status: r.status,
        headers: { ...corsHeaders, "Content-Type": r.headers.get("Content-Type") ?? "application/octet-stream" },
      });
    }

    return new Response(JSON.stringify({ error: "Specify probe, tile, or asset" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});