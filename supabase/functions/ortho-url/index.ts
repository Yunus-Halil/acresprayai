import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Unzip, UnzipInflate } from "https://esm.sh/fflate@0.8.2";

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
// Stream-extract just `odm_orthophoto/odm_orthophoto.tif` from a zip without ever
// holding the full archive in memory (edge functions have a tight RAM cap).
async function extractOrthoFromZipStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array | null> {
  return await new Promise<Uint8Array | null>((resolve, reject) => {
    const matcher = /odm_orthophoto[\\/]odm_orthophoto\.tif$/i;
    const fallbackMatcher = /(^|[\\/])orthophoto\.tif$/i;
    let matchedChunks: Uint8Array[] | null = null;
    let matchedSize = 0;
    let matchedName: string | null = null;
    let resolved = false;

    const unz = new Unzip((file) => {
      if (resolved) return;
      const isPrimary = matcher.test(file.name);
      const isFallback = !matchedName && fallbackMatcher.test(file.name);
      if (!isPrimary && !isFallback) return;
      // Prefer primary - if we previously captured a fallback, replace it.
      if (isPrimary) {
        matchedChunks = [];
        matchedSize = 0;
      }
      matchedName = file.name;
      console.log(`[ortho-url] zip match: ${file.name}`);
      file.ondata = (err, chunk, final) => {
        if (resolved) return;
        if (err) { resolved = true; reject(err); return; }
        if (!matchedChunks) matchedChunks = [];
        matchedChunks.push(chunk);
        matchedSize += chunk.byteLength;
        if (final && file.name === matchedName) {
          resolved = true;
          const out = new Uint8Array(matchedSize);
          let off = 0;
          for (const c of matchedChunks) { out.set(c, off); off += c.byteLength; }
          resolve(out);
        }
      };
      file.start();
    });
    unz.register(UnzipInflate);

    const reader = stream.getReader();
    const pump = async () => {
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (resolved) { try { reader.cancel(); } catch {} return; }
          const { value, done } = await reader.read();
          if (done) { unz.push(new Uint8Array(0), true); break; }
          if (value && value.byteLength) unz.push(value, false);
        }
        if (!resolved) resolve(null);
      } catch (e) {
        if (!resolved) { resolved = true; reject(e); }
      }
    };
    pump();
  });
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
      return json({ error: "Missing task_id" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: task } = await admin.from("odm_tasks")
      .select("id, user_id, odm_uuid, ortho_path, output_path, status, progress, field_id").eq("id", taskId).maybeSingle();
    // Never disclose whether the row exists for someone else - same 404 either way.
    if (!task || task.user_id !== ud.user.id) {
      return json({ error: "Scan not found." }, 404);
    }

    // Lazy backfill: if the ortho hasn't been uploaded yet, pull it now.
    let path = task.ortho_path as string | null;

    // Maybe the client already extracted+uploaded the .tif in a previous call.
    // Check the `orthos` bucket for the expected path before re-querying ODM.
    if (!path && task.odm_uuid) {
      const expected = `${ud.user.id}/${task.odm_uuid}.tif`;
      const { data: listing } = await admin.storage.from("orthos")
        .list(ud.user.id, { search: `${task.odm_uuid}.tif` });
      if (listing?.some((o: any) => o.name === `${task.odm_uuid}.tif`)) {
        path = expected;
        await admin.from("odm_tasks").update({ ortho_path: expected }).eq("id", task.id);
      }
    }

    if (!path) {
      try {
        // 1) Check task status on ODM first - never try to download until completed.
        const currentInfo = task.odm_uuid ? await getOdmInfo(task.odm_uuid) : null;
        const info = currentInfo?.info ?? {};
        const code = info?.status?.code as number | undefined;

        if (code === ODM_STATUS.FAILED || code === ODM_STATUS.CANCELED) {
          const msg = info?.status?.errorMessage ?? "ODM reported failure";
          if (task.status !== "completed") {
            await admin.from("odm_tasks").update({ status: "failed", error: msg }).eq("id", task.id);
            return json({ error: `Processing failed: ${msg}` }, 409);
          }
        }
        if (code !== ODM_STATUS.COMPLETED && task.status !== "completed") {
          const progress = typeof info?.progress === "number" ? Math.round(info.progress) : 0;
          const label = code === ODM_STATUS.RUNNING ? "processing" : code === ODM_STATUS.QUEUED ? "queued" : "pending";
          return json({ error: `Orthomosaic not ready yet (${label}, ${progress}%)`, status: label, progress }, 409);
        }

        // 2) Try downloading the orthophoto directly from ODM (works on self-hosted NodeODM).
        //    ONLY ever pull this scan's own ODM uuid. The processing node is shared by
        //    every tenant, so falling back to "any completed task on the node" would
        //    attach another farm's orthomosaic to this scan.
        let tifBytes: Uint8Array | null = null;
        let matchedUuid: string | null = null;
        let triedDownloads: { url: string; status: number }[] = [];
        if (task.odm_uuid) {
          const result = await fetchOrthophoto(task.odm_uuid);
          triedDownloads = result.tried;
          if (result.response) {
            tifBytes = new Uint8Array(await result.response.arrayBuffer());
            matchedUuid = task.odm_uuid;
          }
        }

        // 3) Fallback: extract orthophoto from the all.zip we already stored.
        //    Required for WebODM Lightning (spark*.webodm.net) which only serves all.zip.
        // 3) Fallback: extract orthophoto from the all.zip we already stored.
        //    DISABLED on WebODM Lightning - the unzip exceeds the 256 MB edge memory cap.
        //    Kept here behind an explicit feature flag so a self-hosted backend with a
        //    larger worker can enable it later.
        const allowZipExtract = (Deno.env.get("ORTHO_EXTRACT_FROM_ZIP") ?? "").toLowerCase() === "true";
        if (!tifBytes && task.output_path && allowZipExtract) {
          console.log("[ortho-url] direct ODM downloads failed; extracting orthophoto from stored all.zip", task.output_path);
          const { data: signedZip, error: signErr } = await admin.storage.from("scans")
            .createSignedUrl(task.output_path, 60 * 10);
          if (signErr || !signedZip?.signedUrl) {
            console.warn("[ortho-url] could not sign zip:", signErr?.message);
          } else {
            try {
              const zipRes = await fetch(signedZip.signedUrl);
              if (!zipRes.ok || !zipRes.body) {
                console.warn("[ortho-url] zip fetch failed:", zipRes.status);
              } else {
                tifBytes = await extractOrthoFromZipStream(zipRes.body);
                if (tifBytes) {
                  matchedUuid = task.odm_uuid;
                  console.log(`[ortho-url] extracted orthophoto: ${tifBytes.byteLength} bytes`);
                }
              }
            } catch (e) {
              console.error("[ortho-url] streaming unzip failed:", (e as Error)?.message);
            }
          }
        }

        if (!tifBytes || !matchedUuid) {
          // ODM didn't give us the .tif directly (WebODM Lightning case).
          // Hand the extraction off to the browser to avoid the 256 MB edge memory cap:
          //   1) sign a download URL for the all.zip in the `scans` bucket
          //   2) mint a signed upload URL for the `orthos` bucket
          //   3) the client streams the zip, extracts odm_orthophoto.tif, PUTs it back
          if (task.output_path && task.odm_uuid) {
            const uploadPath = `${ud.user.id}/${task.odm_uuid}.tif`;
            const [{ data: zipSigned, error: zipErr }, { data: upSigned, error: upErr }] = await Promise.all([
              admin.storage.from("scans").createSignedUrl(task.output_path, 60 * 30),
              admin.storage.from("orthos").createSignedUploadUrl(uploadPath),
            ]);
            if (!zipErr && !upErr && zipSigned?.signedUrl && upSigned?.token) {
              return json({
                needsExtract: true,
                zipUrl: zipSigned.signedUrl,
                upload: { path: uploadPath, token: upSigned.token, bucket: "orthos" },
                uuid: task.odm_uuid,
              }, 202);
            }
            console.warn("[ortho-url] could not prepare extraction handoff", { zipErr: zipErr?.message, upErr: upErr?.message });
          }
          console.warn("[ortho-url] no orthophoto found", JSON.stringify({ uuid: task.odm_uuid, triedDownloads, output_path: task.output_path }));
          return json({
            error: "Processing completed but the orthomosaic file is missing. The processing node did not produce odm_orthophoto.tif (likely insufficient image overlap).",
          }, 422);
        }

        const orthoPath = `${ud.user.id}/${matchedUuid}.tif`;
        const { error: tifErr } = await admin.storage.from("orthos").upload(orthoPath, tifBytes, {
          contentType: "image/tiff",
          upsert: true,
        });
        if (tifErr) {
          return json({ error: `Upload failed: ${tifErr.message}` }, 500);
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

    // Fetch TileJSON from titiler server-side to avoid browser CORS on titiler.xyz.
    // The tile URL template embeds the (fresh) signed URL, so Leaflet can request
    // tiles directly as <img> requests (no CORS preflight on image GETs).
    let tilejson: any = null;
    try {
      const tjUrl = `https://titiler.xyz/cog/WebMercatorQuad/tilejson.json?url=${encodeURIComponent(signed.signedUrl)}&tilesize=256`;
      const tjRes = await fetch(tjUrl);
      const tjText = await tjRes.text();
      try { tilejson = tjText ? JSON.parse(tjText) : null; } catch { tilejson = null; }
      if (!tjRes.ok) {
        console.warn("[ortho-url] titiler tilejson failed:", tjRes.status, tjText.slice(0, 400));
      }
    } catch (e) {
      console.warn("[ortho-url] titiler tilejson error:", (e as Error)?.message);
    }

    return json({ url: signed.signedUrl, expires_in: SIGNED_TTL, tilejson });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});