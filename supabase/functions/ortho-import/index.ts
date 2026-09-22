// Import an already-finished GeoTIFF orthomosaic as a scan, with no ODM
// reconstruction involved.
//
// The client has already parsed the file's own header (src/lib/orthoImport.ts,
// using geotiff.js) and refused anything ungeoreferenced, geographic, non-metre,
// non-square-pixel or rotated — the same conditions offrow/io.py checks, and
// for the same reason: fail at the door, not three screens later as a black
// map or a wrong-coloured one. This function trusts that check the way
// odm-submit trusts the client's own GPS-EXIF check on drone photos; the
// server's job is auth, ownership and storage, not re-parsing a TIFF.
//
// TWO CALLS, like odm-submit's init/commit, because the file itself never
// touches this function. `init` mints a signed upload URL so the browser PUTs
// the GeoTIFF straight to Supabase Storage — a multi-hundred-megabyte COG
// through an edge function's own request body is exactly the failure mode
// odm-poll's `all.zip` handling exists to avoid, and there is no reason to
// re-invent that here when the storage API already does it for free. `commit`
// confirms the object landed, then writes the scan row.
//
// EVERYTHING DOWNSTREAM ALREADY WORKS. ortho-url skips straight past its ODM
// branch whenever `ortho_path` is already set, bake-tiles reads `band_mapping`
// straight off the row without probing when it already carries a `roles`
// mapping methodically arrived at, and the workspace (including Weed Scout)
// only ever needs a taskId with a boundary and a tile URL. So this function
// writes exactly the row those paths already expect, nothing more.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { type BandRole, type BandRoles, operatorBandAnalysis } from "../_shared/bands.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ROLES: BandRole[] = ["red", "green", "blue", "nir", "rededge"];

/** `{red: 3, green: 2, blue: 1}` -> validated BandRoles, or null if malformed. */
function parseRoles(raw: unknown, bandCount: number): BandRoles | null {
  if (!raw || typeof raw !== "object") return null;
  const roles: BandRoles = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ROLES.includes(k as BandRole)) return null;
    const idx = Number(v);
    if (!Number.isInteger(idx) || idx < 1 || idx > bandCount) return null;
    roles[k as BandRole] = idx;
  }
  return roles;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Missing Authorization" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "";
    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    // ---- INIT: verify the field, mint a signed upload slot -----------------
    if (action === "init") {
      const fieldId = String(body.field_id ?? "");
      if (!fieldId) return json({ error: "Missing field_id" }, 400);

      const { data: field } = await admin.from("fields")
        .select("id, user_id").eq("id", fieldId).maybeSingle();
      if (!field || field.user_id !== user.id) return json({ error: "Field not found" }, 404);

      const odmUuid = crypto.randomUUID();
      const path = `${user.id}/${odmUuid}.tif`;

      const { data: signed, error: signErr } = await admin.storage
        .from("orthos").createSignedUploadUrl(path);
      if (signErr || !signed) {
        return json({ error: `Could not prepare the upload: ${signErr?.message ?? "unknown error"}` }, 500);
      }

      // Row exists from the start so a dropped upload leaves a visible,
      // deletable "uploading" scan rather than nothing at all — the same
      // honesty FieldDetail's scan history already gives a stalled ODM scan.
      const { data: row, error: insErr } = await admin.from("odm_tasks").insert({
        user_id: user.id,
        field_id: fieldId,
        odm_uuid: odmUuid,
        status: "uploading",
        image_count: 0,
      }).select("id").single();
      if (insErr) return json({ error: insErr.message }, 500);

      return json({ task_id: row.id, odm_uuid: odmUuid, path, token: signed.token });
    }

    // ---- COMMIT: confirm the object landed, write the finished scan --------
    if (action === "commit") {
      const taskId = String(body.task_id ?? "");
      if (!taskId) return json({ error: "Missing task_id" }, 400);

      const { data: task } = await admin.from("odm_tasks")
        .select("id, user_id, odm_uuid").eq("id", taskId).maybeSingle();
      // Same 404 whether the scan is missing or someone else's - no existence oracle.
      if (!task || task.user_id !== user.id) return json({ error: "Scan not found" }, 404);
      if (!task.odm_uuid) return json({ error: "Scan has no upload slot" }, 409);

      const path = `${user.id}/${task.odm_uuid}.tif`;
      const { data: listing, error: listErr } = await admin.storage
        .from("orthos").list(user.id, { search: `${task.odm_uuid}.tif` });
      if (listErr || !listing?.some(o => o.name === `${task.odm_uuid}.tif`)) {
        await admin.from("odm_tasks").update({
          status: "failed",
          error: "The uploaded file did not reach storage. Check your connection and try importing again.",
        }).eq("id", task.id);
        return json({ error: "Upload did not complete" }, 422);
      }

      const bandCount = Number(body.band_count);
      if (!Number.isInteger(bandCount) || bandCount < 1) {
        return json({ error: "Missing or invalid band_count" }, 400);
      }
      const roles = parseRoles(body.band_mapping, bandCount);
      if (!roles || roles.red === undefined || roles.green === undefined || roles.blue === undefined) {
        return json({ error: "band_mapping must name at least red, green and blue bands" }, 400);
      }
      const bandMapping = operatorBandAnalysis(bandCount, roles);

      const { error: updErr } = await admin.from("odm_tasks").update({
        status: "completed",
        progress: 100,
        ortho_path: path,
        band_mapping: bandMapping,
        error: null,
      }).eq("id", task.id);
      if (updErr) return json({ error: updErr.message }, 500);

      return json({ ok: true, task_id: task.id, odm_uuid: task.odm_uuid });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
