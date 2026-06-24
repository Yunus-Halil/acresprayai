import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Tiny public proxy that streams pre-baked tiles from the private `tiles`
// bucket. URL shape: /tile/{odmUuid}/{z}/{x}/{y}.png
// Leaflet hits this with plain <img> GETs - no auth, cached aggressively.
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const EMPTY_PNG = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
), c => c.charCodeAt(0));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    // Strip the "/tile" or "/functions/v1/tile" prefix - whatever's left is the path inside the bucket.
    const m = url.pathname.match(/tile\/(.+\.png)$/);
    if (!m) return new Response("bad path", { status: 400, headers: corsHeaders });
    const objectPath = m[1];

    const { data, error } = await admin.storage.from("tiles").download(objectPath);
    if (error || !data) {
      // Return a 1x1 transparent PNG so Leaflet doesn't show broken-tile icons
      // for out-of-coverage cells.
      return new Response(EMPTY_PNG, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=300",
        },
      });
    }
    return new Response(data.stream(), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    return new Response(String((e as Error)?.message ?? e), { status: 500, headers: corsHeaders });
  }
});