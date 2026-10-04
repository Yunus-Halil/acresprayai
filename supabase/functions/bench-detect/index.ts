// bench-detect: the baseline detector for the in-app Layer 2 benchmark.
//
// The browser cuts a crop from a kept original (or takes the ortho chip),
// sends it here, and this function forwards it to Roboflow with a key that
// lives only in the function's secrets. The browser never sees the key; it
// gets back the normalised result (_shared/roboflow.ts), the same shape the
// terminal benchmark records.
//
// Developer tooling behind an operator's sign-in. The platform JWT gate is on
// (no config.toml entry), and the user is resolved again here so an invalid
// token is a 401 and not a free call against the key. Nothing is stored;
// nothing here reads or writes a scan. The detector is an experimental
// yardstick and is never a treatment input.
//
//   POST { image: <base64, bare or data URL>, mime: "image/jpeg" | "image/png",
//          model?: "<project>/<version>", confidence?: 0..100 }
//   -> ModelResult (200), or { status: "API_ERROR", error } with 400 / 401 / 413 / 503
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import {
  DEFAULT_ROBOFLOW_MODEL, type ModelResult, callRoboflow,
} from "../_shared/roboflow.ts";

/** Base64 characters, so about 6 MB of image. A crop is tens of kilobytes; this is a sanity bound. */
const MAX_IMAGE_B64 = 8_000_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const refuse = (error: string, status: number): Response =>
  json({ status: "API_ERROR", modelId: null, count: 0, maxConfidence: null, meanConfidence: null, detections: [], imageWidth: null, imageHeight: null, elapsedMs: null, error } satisfies ModelResult, status);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return refuse("POST only", 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return refuse("Missing auth", 401);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: ud } = await supabase.auth.getUser();
  if (!ud?.user) return refuse("Unauthorized", 401);

  let body: { image?: unknown; mime?: unknown; model?: unknown; confidence?: unknown };
  try { body = await req.json(); } catch { return refuse("Body must be JSON", 400); }
  const mime = body.mime === "image/png" ? "image/png" : body.mime === "image/jpeg" ? "image/jpeg" : null;
  if (!mime) return refuse("mime must be image/jpeg or image/png", 400);
  if (typeof body.image !== "string" || !body.image) return refuse("image (base64) is required", 400);
  const image = body.image.replace(/^data:[^;]+;base64,/, "");
  if (!/^[A-Za-z0-9+/=\s]+$/.test(image.slice(0, 4096))) return refuse("image is not base64", 400);
  if (image.length > MAX_IMAGE_B64) return refuse("image too large for the detector", 413);
  const model = typeof body.model === "string" && /^[A-Za-z0-9._-]+\/\d+$/.test(body.model) ? body.model : DEFAULT_ROBOFLOW_MODEL;
  const confidence = typeof body.confidence === "number" && body.confidence >= 0 && body.confidence <= 100 ? body.confidence : undefined;

  const apiKey = (Deno.env.get("ROBOFLOW_API_KEY") ?? "").trim();
  if (!apiKey) return refuse("ROBOFLOW_API_KEY is not set on the server", 503);

  const endpoint = (Deno.env.get("ROBOFLOW_API_URL") ?? "").trim() || undefined;
  const result = await callRoboflow({ apiKey, model, endpoint, confidence }, image, mime);
  return json(result, 200);
});
