import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-odm-uuid, x-action, x-field-id, x-image-count",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ODM_BASE_URL = (Deno.env.get("ODM_BASE_URL") ?? "").trim().replace(/^['"]|['"]$/g, "").replace(/\/$/, "");
const ODM_AUTH_TOKEN = (Deno.env.get("ODM_AUTH_TOKEN") ?? "").trim().replace(/^['"]|['"]$/g, "");

function odmUrl(path: string, extra: Record<string, string> = {}) {
  const u = new URL(`${ODM_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`);
  u.searchParams.set("token", ODM_AUTH_TOKEN);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

    const action = req.headers.get("x-action") ?? "";

    // ---- INIT ----
    if (action === "init") {
      const fieldId = req.headers.get("x-field-id") || null;
      const imageCount = parseInt(req.headers.get("x-image-count") ?? "0", 10);

      const fd = new FormData();
      fd.append("name", `acrespray-${Date.now()}`);
      const initRes = await fetch(odmUrl("/task/new/init"), { method: "POST", body: fd });
      const initJson = await initRes.json();
      if (!initRes.ok || !initJson.uuid) {
        return json({ error: "ODM init failed", detail: initJson }, 502);
      }

      const { data: row, error } = await admin.from("odm_tasks").insert({
        user_id: user.id,
        field_id: fieldId,
        odm_uuid: initJson.uuid,
        status: "uploading",
        image_count: imageCount,
      }).select().single();
      if (error) return json({ error: error.message }, 500);

      return json({ task_id: row.id, odm_uuid: initJson.uuid });
    }

    // ---- UPLOAD (one image per request, streamed) ----
    if (action === "upload") {
      const odmUuid = req.headers.get("x-odm-uuid");
      if (!odmUuid) return json({ error: "Missing x-odm-uuid" }, 400);

      // Verify the task belongs to this user
      const { data: task } = await admin.from("odm_tasks")
        .select("id, user_id").eq("odm_uuid", odmUuid).maybeSingle();
      if (!task || task.user_id !== user.id) return json({ error: "Forbidden" }, 403);

      // Forward the original multipart body verbatim
      const contentType = req.headers.get("content-type") ?? "";
      const upRes = await fetch(odmUrl(`/task/new/upload/${odmUuid}`), {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: req.body,
        // @ts-ignore - Deno fetch requires duplex when streaming a request body
        duplex: "half",
      });
      const upJson = await upRes.json().catch(() => ({}));
      if (!upRes.ok || upJson.error) return json({ error: "Upload failed", detail: upJson }, 502);
      return json({ ok: true });
    }

    // ---- COMMIT (start processing) ----
    if (action === "commit") {
      const { odm_uuid, options } = await req.json();
      if (!odm_uuid) return json({ error: "Missing odm_uuid" }, 400);

      const { data: task } = await admin.from("odm_tasks")
        .select("id, user_id").eq("odm_uuid", odm_uuid).maybeSingle();
      if (!task || task.user_id !== user.id) return json({ error: "Forbidden" }, 403);

      const fd = new FormData();
      if (options) fd.append("options", JSON.stringify(options));
      const cRes = await fetch(odmUrl(`/task/new/commit/${odm_uuid}`), { method: "POST", body: fd });
      const cJson = await cRes.json().catch(() => ({}));
      if (!cRes.ok || cJson.error) return json({ error: "Commit failed", detail: cJson }, 502);

      await admin.from("odm_tasks").update({ status: "processing", progress: 0 }).eq("id", task.id);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});