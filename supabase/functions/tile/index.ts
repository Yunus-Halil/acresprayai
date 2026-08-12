import { admin, ownerOfOdmUuid, readToken, userIdFromToken } from "../_shared/tileAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Streams pre-baked tiles out of the private `tiles` bucket.
// URL shape: /tile/{odmUuid}/{z}/{x}/{y}.png?token=<session jwt>
//
// The caller only ever names the ODM uuid; the storage key is rebuilt here from
// the *verified* owner of that task, so a caller can never reach another
// tenant's objects by crafting a path.
const EMPTY_PNG = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
), c => c.charCodeAt(0));

// Out-of-coverage cells return a transparent pixel so Leaflet doesn't paint
// broken-tile icons across the map.
const blank = (maxAge: number) => new Response(EMPTY_PNG, {
  status: 200,
  headers: { ...corsHeaders, "Content-Type": "image/png", "Cache-Control": `public, max-age=${maxAge}` },
});

const deny = (status: number, message: string) => new Response(
  JSON.stringify({ error: message }),
  { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const m = url.pathname.match(/tile\/([0-9a-f-]{36})\/(\d+)\/(\d+)\/(\d+)\.png$/i);
    if (!m) return deny(400, "Bad tile path");
    const [, odmUuid, z, x, y] = m;

    const userId = await userIdFromToken(readToken(req, url));
    if (!userId) return deny(401, "Unauthorized");

    const owner = await ownerOfOdmUuid(odmUuid);
    // Same response whether the scan is missing or belongs to someone else, so
    // the endpoint can't be used to probe which uuids exist.
    if (!owner || owner !== userId) return deny(404, "Scan not found");

    // Tiles baked before ownership scoping live at the un-prefixed key.
    const candidates = [
      `${owner}/${odmUuid}/${z}/${x}/${y}.png`,
      `${odmUuid}/${z}/${x}/${y}.png`,
    ];
    for (const objectPath of candidates) {
      const { data } = await admin.storage.from("tiles").download(objectPath);
      if (data) {
        return new Response(data.stream(), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "image/png",
            // Tiles are immutable per scan, but the response is user-scoped -
            // keep it out of shared caches.
            "Cache-Control": "private, max-age=31536000, immutable",
          },
        });
      }
    }
    return blank(300);
  } catch (e) {
    return deny(500, String((e as Error)?.message ?? e));
  }
});
