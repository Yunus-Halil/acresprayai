import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ODM_BASE_URL = (Deno.env.get("ODM_BASE_URL") ?? "").trim().replace(/^['"]|['"]$/g, "").replace(/\/$/, "");
const ODM_AUTH_TOKEN = (Deno.env.get("ODM_AUTH_TOKEN") ?? "").trim().replace(/^['"]|['"]$/g, "");

function odmUrl(path: string) {
  const u = new URL(`${ODM_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`);
  u.searchParams.set("token", ODM_AUTH_TOKEN);
  return u.toString();
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// NodeODM status codes
const STATUS = { QUEUED: 10, RUNNING: 20, FAILED: 30, COMPLETED: 40, CANCELED: 50 } as const;

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

    const { task_id } = await req.json();
    if (!task_id) return json({ error: "Missing task_id" }, 400);

    const { data: task, error: tErr } = await admin.from("odm_tasks")
      .select("*").eq("id", task_id).maybeSingle();
    if (tErr || !task) return json({ error: "Task not found" }, 404);
    if (task.user_id !== user.id) return json({ error: "Forbidden" }, 403);

    // Already completed - return cached info
    if (task.status === "completed" && task.output_path) {
      return json({ status: "completed", progress: 100, output_path: task.output_path });
    }
    if (task.status === "failed") return json({ status: "failed", error: task.error });
    if (!task.odm_uuid) return json({ status: task.status, progress: task.progress });

    // Ask ODM for status
    const infoRes = await fetch(odmUrl(`/task/${task.odm_uuid}/info`));
    const info = await infoRes.json();
    const code = info?.status?.code as number | undefined;
    const progress = typeof info?.progress === "number" ? info.progress : task.progress;

    if (code === STATUS.FAILED || code === STATUS.CANCELED) {
      const errMsg = info?.status?.errorMessage ?? "ODM reported failure";
      await admin.from("odm_tasks").update({ status: "failed", error: errMsg, progress }).eq("id", task.id);
      return json({ status: "failed", error: errMsg });
    }

    if (code !== STATUS.COMPLETED) {
      const s = code === STATUS.RUNNING ? "processing" : code === STATUS.QUEUED ? "queued" : task.status;
      await admin.from("odm_tasks").update({ status: s, progress }).eq("id", task.id);
      return json({ status: s, progress });
    }

    // COMPLETED - download all.zip and persist to storage
    const zipRes = await fetch(odmUrl(`/task/${task.odm_uuid}/download/all.zip`));
    if (!zipRes.ok || !zipRes.body) {
      await admin.from("odm_tasks").update({ status: "failed", error: "Download failed" }).eq("id", task.id);
      return json({ status: "failed", error: "Download failed" }, 502);
    }
    const blob = await zipRes.blob();
    const path = `odm/${user.id}/${task.odm_uuid}/all.zip`;
    const { error: upErr } = await admin.storage.from("scans").upload(path, blob, {
      contentType: "application/zip", upsert: true,
    });
    if (upErr) {
      await admin.from("odm_tasks").update({ status: "failed", error: upErr.message }).eq("id", task.id);
      return json({ status: "failed", error: upErr.message }, 500);
    }

    await admin.from("odm_tasks").update({
      status: "completed", progress: 100, output_path: path, error: null,
    }).eq("id", task.id);

    return json({ status: "completed", progress: 100, output_path: path });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});