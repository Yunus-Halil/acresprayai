import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { fetchResilient, fetchStream, isTransient, jsonSafe } from "../_shared/net.ts";

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
function safeOdmUrl(path: string) {
  const u = new URL(`${ODM_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`);
  if (ODM_AUTH_TOKEN) u.searchParams.set("token", "[redacted]");
  return u.toString();
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// NodeODM status codes
const STATUS = { QUEUED: 10, RUNNING: 20, FAILED: 30, COMPLETED: 40, CANCELED: 50 } as const;
const ORTHO_PATHS = [
  "download/odm_orthophoto/odm_orthophoto.tif",
  "download/orthophoto.tif",
  "download/odm_orthophoto.tif",
];

// A mirror lease older than this is assumed dead (the edge instance was recycled
// mid-transfer) and may be reclaimed by the next poll. Generous, because a large
// all.zip legitimately takes a while.
const LEASE_STALE_MS = 15 * 60_000;
// Consecutive transient failures tolerated before the scan is really marked failed.
const MAX_MIRROR_ATTEMPTS = 4;

async function fetchOrthophoto(uuid: string): Promise<Response | null> {
  for (const p of ORTHO_PATHS) {
    const path = `/task/${uuid}/${p}`;
    try {
      const r = await fetchStream(odmUrl(path), 120_000, "odm-poll:ortho");
      console.warn(`[odm-poll] GET ${safeOdmUrl(path)} -> ${r.status}`);
      if (r.ok && r.body) return r;
      await r.body?.cancel().catch(() => {});
    } catch (e) {
      console.warn(`[odm-poll] ${safeOdmUrl(path)} failed: ${(e as Error)?.message}`);
    }
  }
  return null;
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

    const body = await req.json().catch(() => ({}));
    const { task_id, retry } = body as { task_id?: string; retry?: boolean };
    if (!task_id) return json({ error: "Missing task_id" }, 400);

    const { data: task, error: tErr } = await admin.from("odm_tasks")
      .select("*").eq("id", task_id).maybeSingle();
    if (tErr || !task) return json({ error: "Task not found" }, 404);
    if (task.user_id !== user.id) return json({ error: "Forbidden" }, 403);

    // Explicit user-driven retry: clear the failure and let the flow below
    // re-evaluate from whatever ODM currently reports.
    if (retry && (task.status === "failed" || task.status === "mirroring")) {
      await admin.from("odm_tasks").update({
        status: task.odm_uuid ? "processing" : "uploading",
        error: null,
        mirror_attempts: 0,
        mirror_started_at: null,
      }).eq("id", task.id);
      task.status = task.odm_uuid ? "processing" : "uploading";
      task.error = null;
      task.mirror_attempts = 0;
    }

    // Terminal / no-op states.
    if (task.status === "completed" && task.output_path) {
      return json({ status: "completed", progress: 100, output_path: task.output_path });
    }
    if (task.status === "failed") {
      return json({ status: "failed", error: task.error, retryable: true });
    }
    if (!task.odm_uuid) return json({ status: task.status, progress: task.progress });

    // Another worker is mirroring. Report progress and leave it alone unless its
    // lease has gone stale, in which case fall through and try to reclaim it.
    if (task.status === "mirroring") {
      const startedAt = task.mirror_started_at ? Date.parse(task.mirror_started_at) : 0;
      const stale = !startedAt || Date.now() - startedAt > LEASE_STALE_MS;
      if (!stale) {
        return json({ status: "mirroring", progress: task.progress ?? 99 });
      }
      console.warn(`[odm-poll] reclaiming stale mirror lease for ${task.id}`);
    }

    // ---- Ask ODM where the reconstruction is up to -------------------------
    let info: Record<string, unknown> | null = null;
    try {
      const infoRes = await fetchResilient(odmUrl(`/task/${task.odm_uuid}/info`), {
        timeoutMs: 20_000, attempts: 3, label: "odm-poll:info",
      });
      info = await jsonSafe(infoRes);
      if (!infoRes.ok || !info) {
        // Upstream is unhappy but the scan itself is fine. Report the last known
        // state and let the client poll again rather than failing the scan.
        return json({
          status: task.status, progress: task.progress,
          upstream: `processing node returned ${infoRes.status}`,
        });
      }
    } catch (e) {
      return json({
        status: task.status, progress: task.progress,
        upstream: `processing node unreachable: ${(e as Error)?.message}`,
      });
    }

    const status = info?.status as { code?: number; errorMessage?: string } | undefined;
    const code = status?.code;
    const progress = typeof info?.progress === "number" ? info.progress : task.progress;

    if (code === STATUS.FAILED || code === STATUS.CANCELED) {
      // A reconstruction failure is genuinely permanent - retrying the same
      // images produces the same result. Surface why.
      const errMsg = status?.errorMessage ?? "The processing node could not reconstruct this scan";
      await admin.from("odm_tasks").update({ status: "failed", error: errMsg, progress }).eq("id", task.id);
      return json({ status: "failed", error: errMsg, retryable: false });
    }

    if (code !== STATUS.COMPLETED) {
      const s = code === STATUS.RUNNING ? "processing" : code === STATUS.QUEUED ? "queued" : task.status;
      await admin.from("odm_tasks").update({ status: s, progress }).eq("id", task.id);
      return json({ status: s, progress });
    }

    // ---- COMPLETED: claim the transfer lease -------------------------------
    // A conditional UPDATE is the whole concurrency control. The client polls
    // every 5s and a large transfer runs for minutes, so without this every tick
    // started another full download+upload of the same multi-gigabyte archive.
    const staleCutoff = new Date(Date.now() - LEASE_STALE_MS).toISOString();
    const { data: claimed } = await admin.from("odm_tasks")
      .update({
        status: "mirroring",
        progress: 99,
        mirror_started_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .or(`status.in.(queued,processing,uploading),and(status.eq.mirroring,mirror_started_at.lt.${staleCutoff})`)
      .select("id, mirror_attempts");

    if (!claimed?.length) {
      // Someone else got there first. Perfectly normal with concurrent pollers.
      return json({ status: "mirroring", progress: 99 });
    }
    const attemptNo = (claimed[0].mirror_attempts ?? 0) + 1;

    const zipPath = `${user.id}/odm/${task.odm_uuid}/all.zip`;

    const releaseTransient = async (reason: string) => {
      // Hand the lease back so the next poll retries, unless we've burned the
      // whole budget - only then is it a real failure the user needs to see.
      if (attemptNo >= MAX_MIRROR_ATTEMPTS) {
        await admin.from("odm_tasks").update({
          status: "failed",
          error: `${reason} (after ${attemptNo} attempts)`,
          mirror_started_at: null,
          mirror_attempts: attemptNo,
        }).eq("id", task.id);
      } else {
        console.warn(`[odm-poll] transient mirror failure ${attemptNo}/${MAX_MIRROR_ATTEMPTS}: ${reason}`);
        await admin.from("odm_tasks").update({
          status: "processing",
          mirror_started_at: null,
          mirror_attempts: attemptNo,
        }).eq("id", task.id);
      }
    };

    const transfer = async () => {
      try {
        // 1) Mirror the full archive. Skip if a previous attempt already did it.
        if (!task.output_path) {
          const zipRes = await fetchStream(
            odmUrl(`/task/${task.odm_uuid}/download/all.zip`), 240_000, "odm-poll:zip",
          );
          if (!zipRes.ok || !zipRes.body) {
            await zipRes.body?.cancel().catch(() => {});
            await releaseTransient(`Could not download results from the processing node (${zipRes.status})`);
            return;
          }
          const { error: uploadError } = await admin.storage.from("scans").upload(zipPath, zipRes.body, {
            contentType: "application/zip",
            upsert: true,
          });
          if (uploadError) {
            await releaseTransient(`Storage upload failed: ${uploadError.message}`);
            return;
          }
        }

        // 2) Pull the orthophoto GeoTIFF so TiTiler can render it.
        //    ONLY this scan's own uuid: the node is shared across tenants, so a
        //    "any completed task" fallback would store another farm's imagery.
        //    A miss here is NOT fatal - ortho-url can back-fill later, including
        //    via the browser-side zip extraction path.
        let orthoStored: string | null = task.ortho_path ?? null;
        if (!orthoStored) {
          try {
            const tifRes = await fetchOrthophoto(task.odm_uuid);
            if (tifRes?.body) {
              const storedPath = `${user.id}/${task.odm_uuid}.tif`;
              const { error: tifErr } = await admin.storage.from("orthos").upload(storedPath, tifRes.body, {
                contentType: "image/tiff",
                upsert: true,
              });
              if (!tifErr) orthoStored = storedPath;
              else console.error("[odm-poll] ortho upload failed:", tifErr.message);
            } else {
              console.warn(`[odm-poll] no orthophoto asset on ODM for ${task.odm_uuid}; ortho-url will back-fill`);
            }
          } catch (e) {
            console.error("[odm-poll] ortho fetch failed:", (e as Error)?.message);
          }
        }

        await admin.from("odm_tasks").update({
          status: "completed",
          progress: 100,
          output_path: zipPath,
          ortho_path: orthoStored,
          error: null,
          mirror_started_at: null,
          mirror_attempts: 0,
        }).eq("id", task.id);
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (isTransient(e)) await releaseTransient(msg);
        else {
          await admin.from("odm_tasks").update({
            status: "failed", error: msg, mirror_started_at: null,
          }).eq("id", task.id);
        }
      }
    };

    // @ts-expect-error EdgeRuntime is provided by the Supabase Edge runtime
    EdgeRuntime.waitUntil(transfer());

    return json({ status: "mirroring", progress: 99 });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
