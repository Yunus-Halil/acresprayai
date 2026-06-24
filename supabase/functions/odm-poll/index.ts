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

    // COMPLETED - stream all.zip into storage through the service-role client.
    // Do not manually construct a Storage REST Authorization header here: if the
    // key is missing/malformed it becomes "Bearer undefined" and Storage returns
    // "Invalid Compact JWS". The Supabase client handles the auth header safely.
    // Keep the user's id as the first folder so existing read policies allow the
    // frontend to create signed URLs for completed outputs.
    const path = `${user.id}/odm/${task.odm_uuid}/all.zip`;
    const orthoPath = `${user.id}/${task.odm_uuid}.tif`;

    // Mark as uploading so the client knows we're transferring
    await admin.from("odm_tasks").update({ status: "processing", progress: 99 }).eq("id", task.id);

    // Run the heavy transfer in the background and return immediately.
    // The next poll tick will see status=completed once the upload finishes.
    const transfer = (async () => {
      try {
        const zipRes = await fetch(odmUrl(`/task/${task.odm_uuid}/download/all.zip`));
        if (!zipRes.ok || !zipRes.body) {
          await admin.from("odm_tasks").update({ status: "failed", error: "Download failed" }).eq("id", task.id);
          return;
        }
        const { error: uploadError } = await admin.storage.from("scans").upload(path, zipRes.body, {
          contentType: "application/zip",
          upsert: true,
        });
        if (uploadError) {
          await admin.from("odm_tasks").update({
            status: "failed",
            error: `Storage upload failed: ${uploadError.message}`,
          }).eq("id", task.id);
          return;
        }

        // Also pull the orthophoto GeoTIFF into the public-ish `orthos` bucket
        // so TiTiler can render it via a short-lived signed URL.
        let orthoStored: string | null = null;
        try {
          const candidates = [
            "download/orthophoto.tif",
            "download/odm_orthophoto/odm_orthophoto.tif",
            "download/odm_orthophoto.tif",
          ];
          let tifRes: Response | null = null;
          for (const p of candidates) {
            const r = await fetch(odmUrl(`/task/${task.odm_uuid}/${p}`));
            if (r.ok && r.body) { tifRes = r; break; }
            try { await r.arrayBuffer(); } catch { /* noop */ }
            console.warn(`ortho candidate ${p} -> ${r.status}`);
          }
          if (tifRes) {
            const { error: tifErr } = await admin.storage.from("orthos").upload(orthoPath, tifRes.body!, {
              contentType: "image/tiff",
              upsert: true,
            });
            if (!tifErr) orthoStored = orthoPath;
            else console.error("ortho upload failed:", tifErr.message);
          } else {
            console.warn("no orthophoto produced for", task.odm_uuid);
          }
        } catch (e) {
          console.error("ortho fetch failed:", (e as Error)?.message);
        }

        await admin.from("odm_tasks").update({
          status: "completed",
          progress: 100,
          output_path: path,
          ortho_path: orthoStored,
          error: null,
        }).eq("id", task.id);
      } catch (e) {
        await admin.from("odm_tasks").update({ status: "failed", error: String((e as Error)?.message ?? e) }).eq("id", task.id);
      }
    })();

    // @ts-ignore - EdgeRuntime is provided by Supabase Edge Functions
    EdgeRuntime.waitUntil(transfer);

    return json({ status: "processing", progress: 99 });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});