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

// NodeODM task status codes
const ODM_STATUS = { QUEUED: 10, RUNNING: 20, FAILED: 30, COMPLETED: 40, CANCELED: 50 } as const;

// Candidate orthophoto download paths across NodeODM/WebODM versions.
const ORTHO_PATHS = [
  "download/orthophoto.tif",
  "download/odm_orthophoto/odm_orthophoto.tif",
  "download/odm_orthophoto.tif",
];

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
        // 1) Check task status on ODM first - never try to download until completed.
        const infoRes = await fetch(odmUrl(`/task/${task.odm_uuid}/info`));
        const info = await infoRes.json().catch(() => ({}));
        const code = info?.status?.code as number | undefined;
        if (code === ODM_STATUS.FAILED || code === ODM_STATUS.CANCELED) {
          const msg = info?.status?.errorMessage ?? "ODM reported failure";
          await admin.from("odm_tasks").update({ status: "failed", error: msg }).eq("id", task.id);
          return new Response(JSON.stringify({ error: `Processing failed: ${msg}` }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        if (code !== ODM_STATUS.COMPLETED) {
          const progress = typeof info?.progress === "number" ? Math.round(info.progress) : 0;
          const label = code === ODM_STATUS.RUNNING ? "processing" : code === ODM_STATUS.QUEUED ? "queued" : "pending";
          return new Response(JSON.stringify({ error: `Orthomosaic not ready yet (${label}, ${progress}%)`, status: label, progress }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // 2) Try known orthophoto paths in order.
        let tifRes: Response | null = null;
        let triedPaths: string[] = [];
        for (const p of ORTHO_PATHS) {
          const u = odmUrl(`/task/${task.odm_uuid}/${p}`);
          triedPaths.push(p);
          const r = await fetch(u);
          if (r.ok && r.body) { tifRes = r; break; }
          // consume body so we don't leak
          try { await r.arrayBuffer(); } catch { /* noop */ }
        }

        if (!tifRes) {
          // 3) Task is complete but no orthophoto - list assets for diagnostics.
          let assets: unknown = null;
          try {
            const a = await fetch(odmUrl(`/task/${task.odm_uuid}/info`));
            const aj = await a.json();
            assets = aj?.imagesCount !== undefined ? { imagesCount: aj.imagesCount } : null;
          } catch { /* noop */ }
          console.warn("[ortho-url] no orthophoto for", task.odm_uuid, "tried:", triedPaths);
          return new Response(JSON.stringify({
            error: "Processing completed but ODM did not produce an orthomosaic. This usually means the input images had insufficient overlap (need 70-80%).",
            tried: triedPaths,
            assets,
          }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const { error: tifErr } = await admin.storage.from("orthos").upload(orthoPath, tifRes.body!, {
          contentType: "image/tiff",
          upsert: true,
        });
        if (tifErr) {
          return new Response(JSON.stringify({ error: `Upload failed: ${tifErr.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        path = orthoPath;
        await admin.from("odm_tasks").update({ ortho_path: orthoPath }).eq("id", task.id);
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