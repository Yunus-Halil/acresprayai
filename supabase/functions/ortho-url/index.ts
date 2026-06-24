import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { unzipSync, strFromU8 } from "https://esm.sh/fflate@0.8.2";

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

function safeOdmUrl(path: string) {
  const u = new URL(`${ODM_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`);
  if (ODM_AUTH_TOKEN) u.searchParams.set("token", "[redacted]");
  return u.toString();
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

// NodeODM task status codes
const ODM_STATUS = { QUEUED: 10, RUNNING: 20, FAILED: 30, COMPLETED: 40, CANCELED: 50 } as const;

// Candidate orthophoto download paths across NodeODM/WebODM versions.
const ORTHO_PATHS = [
  "download/odm_orthophoto/odm_orthophoto.tif",
  "download/orthophoto.tif",
  "download/odm_orthophoto.tif",
];

type OdmTaskSummary = {
  uuid: string;
  statusCode: number | null;
  status: string | null;
  progress: number | null;
  name: string | null;
  createdAt: string | null;
};

function readStatusCode(task: any): number | null {
  const raw = task?.status?.code ?? task?.statusCode ?? task?.status_code ?? task?.code;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

function normalizeOdmTasks(payload: any): OdmTaskSummary[] {
  let raw: any = payload;
  if (Array.isArray(payload?.tasks)) raw = payload.tasks;
  else if (Array.isArray(payload?.results)) raw = payload.results;
  else if (payload?.tasks && typeof payload.tasks === "object") raw = Object.values(payload.tasks);
  if (!Array.isArray(raw)) return [];

  return raw.map((task: any) => ({
    uuid: String(task?.uuid ?? task?.id ?? task?.taskId ?? task?.task_id ?? ""),
    statusCode: readStatusCode(task),
    status: typeof task?.status === "string" ? task.status : task?.status?.name ?? task?.status?.label ?? null,
    progress: typeof task?.progress === "number" ? Math.round(task.progress) : null,
    name: task?.name ?? task?.options?.name ?? null,
    createdAt: task?.created_at ?? task?.createdAt ?? task?.dateCreated ?? task?.created ?? null,
  })).filter((task) => task.uuid);
}

async function listOdmTasks(): Promise<{ tasks: OdmTaskSummary[]; source: string; error?: string }> {
  for (const path of ["/tasks", "/task/list"]) {
    const res = await fetch(odmUrl(path));
    const text = await res.text();
    let payload: any = null;
    try { payload = text ? JSON.parse(text) : null; } catch { /* noop */ }
    console.log(`[ortho-url] GET ${safeOdmUrl(path)} -> ${res.status}`, text.slice(0, 1000));
    if (!res.ok) continue;
    const tasks = normalizeOdmTasks(payload);
    console.log("[ortho-url] ODM tasks:", JSON.stringify(tasks));
    return { tasks, source: path };
  }
  return { tasks: [], source: "/tasks", error: "Could not list ODM tasks" };
}

async function getOdmInfo(uuid: string) {
  const path = `/task/${uuid}/info`;
  const res = await fetch(odmUrl(path));
  const text = await res.text();
  let info: any = {};
  try { info = text ? JSON.parse(text) : {}; } catch { info = { raw: text.slice(0, 1000) }; }
  console.log(`[ortho-url] GET ${safeOdmUrl(path)} -> ${res.status}`, text.slice(0, 1000));
  return { res, info };
}

async function fetchOrthophoto(uuid: string) {
  const tried: { url: string; status: number }[] = [];
  for (const p of ORTHO_PATHS) {
    const path = `/task/${uuid}/${p}`;
    const r = await fetch(odmUrl(path));
    tried.push({ url: safeOdmUrl(path), status: r.status });
    console.log(`[ortho-url] GET ${safeOdmUrl(path)} -> ${r.status}`);
    if (r.ok && r.body) return { response: r, tried };
    try { await r.arrayBuffer(); } catch { /* noop */ }
  }
  return { response: null, tried };
}

// WebODM Lightning (spark*.webodm.net) does NOT expose individual asset downloads -
// only `all.zip`. As a fallback we open the zip we already mirrored into the `scans`
// bucket and extract `odm_orthophoto/odm_orthophoto.tif`.
async function extractOrthoFromZip(zipBytes: Uint8Array): Promise<Uint8Array | null> {
  const entries = unzipSync(zipBytes, {
    filter: (file) => /odm_orthophoto[\\/]odm_orthophoto\.tif$/i.test(file.name) || /(^|[\\/])orthophoto\.tif$/i.test(file.name),
  });
  const names = Object.keys(entries);
  console.log("[ortho-url] zip entries matched:", names);
  if (!names.length) return null;
  // Prefer the canonical path if present
  const preferred = names.find(n => /odm_orthophoto[\\/]odm_orthophoto\.tif$/i.test(n)) ?? names[0];
  return entries[preferred];
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
    const debug = url.searchParams.get("debug");
    if (debug === "tasks") {
      const listed = await listOdmTasks();
      return json({ tasks: listed.tasks, source: listed.source, error: listed.error });
    }
    const probeUuid = url.searchParams.get("probe");
    if (probeUuid) {
      const paths = [
        "download/all.zip",
        "download/odm_orthophoto/odm_orthophoto.tif",
        "download/orthophoto.tif",
        "download/odm_orthophoto.tif",
        "download/odm_orthophoto.tar.gz",
        "download/orthophoto.png",
        "download",
        "output",
        "assets",
        "orthophoto/tiles.json",
        "orthophoto/metadata",
      ];
      const results: any[] = [];
      for (const p of paths) {
        const path = `/task/${probeUuid}/${p}`;
        try {
          const r = await fetch(odmUrl(path), { method: "GET" });
          const ct = r.headers.get("content-type") ?? "";
          let body: string | null = null;
          if (ct.includes("json") || ct.startsWith("text/")) body = (await r.text()).slice(0, 400);
          else { try { await r.arrayBuffer(); } catch {} }
          results.push({ p, status: r.status, contentType: ct, body });
        } catch (e) {
          results.push({ p, error: String((e as Error)?.message ?? e) });
        }
      }
      return json({ uuid: probeUuid, results });
    }
    if (!taskId) {
      return json({ error: "Missing task_id" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: task } = await admin.from("odm_tasks")
      .select("id, user_id, odm_uuid, ortho_path, output_path, status, progress, field_id").eq("id", taskId).maybeSingle();
    if (!task || task.user_id !== ud.user.id) {
      const listed = await listOdmTasks();
      return json({ error: "Scan record not found. ODM task list is included so the completed task can be identified.", odm_tasks: listed.tasks }, 404);
    }

    // Lazy backfill: if the ortho hasn't been uploaded yet, pull it now.
    let path = task.ortho_path as string | null;
    if (!path) {
      try {
        // 1) Check task status on ODM first - never try to download until completed.
        const currentInfo = task.odm_uuid ? await getOdmInfo(task.odm_uuid) : null;
        const info = currentInfo?.info ?? {};
        const code = info?.status?.code as number | undefined;
        const listed = await listOdmTasks();

        if (code === ODM_STATUS.FAILED || code === ODM_STATUS.CANCELED) {
          const msg = info?.status?.errorMessage ?? "ODM reported failure";
          if (task.status !== "completed") {
            await admin.from("odm_tasks").update({ status: "failed", error: msg }).eq("id", task.id);
            return json({ error: `Processing failed: ${msg}`, odm_tasks: listed.tasks }, 409);
          }
        }
        if (code !== ODM_STATUS.COMPLETED && task.status !== "completed") {
          const progress = typeof info?.progress === "number" ? Math.round(info.progress) : 0;
          const label = code === ODM_STATUS.RUNNING ? "processing" : code === ODM_STATUS.QUEUED ? "queued" : "pending";
          return json({ error: `Orthomosaic not ready yet (${label}, ${progress}%)`, status: label, progress, odm_tasks: listed.tasks }, 409);
        }

        // 2) Try downloading the orthophoto directly from ODM (works on self-hosted NodeODM).
        const candidateUuids = new Set<string>();
        if (task.odm_uuid) candidateUuids.add(task.odm_uuid);
        for (const t of listed.tasks) {
          if (t.statusCode === ODM_STATUS.COMPLETED) candidateUuids.add(t.uuid);
        }

        let tifBytes: Uint8Array | null = null;
        let matchedUuid: string | null = null;
        const triedDownloads: { uuid: string; requests: { url: string; status: number }[] }[] = [];
        for (const uuid of candidateUuids) {
          const result = await fetchOrthophoto(uuid);
          triedDownloads.push({ uuid, requests: result.tried });
          if (result.response) {
            tifBytes = new Uint8Array(await result.response.arrayBuffer());
            matchedUuid = uuid;
            break;
          }
        }

        // 3) Fallback: extract orthophoto from the all.zip we already stored.
        //    Required for WebODM Lightning (spark*.webodm.net) which only serves all.zip.
        if (!tifBytes && task.output_path) {
          console.log("[ortho-url] direct ODM downloads failed; extracting orthophoto from stored all.zip", task.output_path);
          const { data: zipBlob, error: dlErr } = await admin.storage.from("scans").download(task.output_path);
          if (dlErr || !zipBlob) {
            console.warn("[ortho-url] could not download stored zip:", dlErr?.message);
          } else {
            const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
            console.log(`[ortho-url] stored zip size: ${zipBytes.byteLength} bytes`);
            try {
              tifBytes = await extractOrthoFromZip(zipBytes);
              if (tifBytes) matchedUuid = task.odm_uuid;
            } catch (e) {
              console.error("[ortho-url] unzip failed:", (e as Error)?.message);
            }
          }
        }

        if (!tifBytes || !matchedUuid) {
          console.warn("[ortho-url] no orthophoto found", JSON.stringify({ listed: listed.tasks, triedDownloads, output_path: task.output_path }));
          return json({
            error: "Completed, but no orthophoto could be retrieved from ODM or the stored archive.",
            odm_tasks: listed.tasks,
            tried: triedDownloads,
            stored_zip: task.output_path,
          }, 422);
        }

        const orthoPath = `${ud.user.id}/${matchedUuid}.tif`;
        const { error: tifErr } = await admin.storage.from("orthos").upload(orthoPath, tifBytes, {
          contentType: "image/tiff",
          upsert: true,
        });
        if (tifErr) {
          return json({ error: `Upload failed: ${tifErr.message}`, odm_tasks: listed.tasks }, 500);
        }
        path = orthoPath;
        await admin.from("odm_tasks").update({
          odm_uuid: matchedUuid,
          status: "completed",
          progress: 100,
          ortho_path: orthoPath,
          error: null,
        }).eq("id", task.id);
      } catch (e) {
        return json({ error: String((e as Error)?.message ?? e) }, 500);
      }
    }
    if (!path) {
      return json({ error: "No orthomosaic available" }, 404);
    }

    const { data: signed, error: sErr } = await admin.storage.from("orthos").createSignedUrl(path, SIGNED_TTL);
    if (sErr || !signed?.signedUrl) {
      return json({ error: sErr?.message ?? "sign failed" }, 500);
    }
    return json({ url: signed.signedUrl, expires_in: SIGNED_TTL });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});