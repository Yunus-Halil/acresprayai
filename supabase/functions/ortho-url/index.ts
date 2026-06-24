import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const ODM_BASE_URL = (Deno.env.get("ODM_BASE_URL") ?? "").trim().replace(/^['"]|['"]$/g, "").replace(/\/$/, "");
const ODM_AUTH_TOKEN = (Deno.env.get("ODM_AUTH_TOKEN") ?? "").trim().replace(/^['"]|['"]$/g, "");
const SIGNED_TTL = 60 * 60 * 6; // 6 hours

function odmUrl(path: string) {
  const u = new URL(`${ODM_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`);
  if (ODM_AUTH_TOKEN) u.searchParams.set("token", ODM_AUTH_TOKEN);
  return u.toString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: ud } = await supabase.auth.getUser();
    if (!ud.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const url = new URL(req.url);
    const taskId = url.searchParams.get("task_id");
    if (!taskId) {
      return new Response(JSON.stringify({ error: "Missing task_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: task } = await admin.from("odm_tasks")
      .select("id, user_id, odm_uuid, ortho_path").eq("id", taskId).maybeSingle();
    if (!task || task.user_id !== ud.user.id) {
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Lazy backfill: if the ortho hasn't been uploaded yet, pull it now.
    let path = task.ortho_path as string | null;
    if (!path && task.odm_uuid) {
      const orthoPath = `${ud.user.id}/${task.odm_uuid}.tif`;
      try {
        const tifRes = await fetch(odmUrl(`/task/${task.odm_uuid}/download/orthophoto.tif`));
        if (tifRes.ok && tifRes.body) {
          const { error: tifErr } = await admin.storage.from("orthos").upload(orthoPath, tifRes.body, {
            contentType: "image/tiff",
            upsert: true,
          });
          if (!tifErr) {
            path = orthoPath;
            await admin.from("odm_tasks").update({ ortho_path: orthoPath }).eq("id", task.id);
          } else {
            return new Response(JSON.stringify({ error: `Upload failed: ${tifErr.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        } else {
          return new Response(JSON.stringify({ error: `ODM has no orthophoto (status ${tifRes.status})` }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      } catch (e) {
        return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    if (!path) {
      return new Response(JSON.stringify({ error: "No orthomosaic available" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: signed, error: sErr } = await admin.storage.from("orthos").createSignedUrl(path, SIGNED_TTL);
    if (sErr || !signed?.signedUrl) {
      return new Response(JSON.stringify({ error: sErr?.message ?? "sign failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ url: signed.signedUrl, expires_in: SIGNED_TTL }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});