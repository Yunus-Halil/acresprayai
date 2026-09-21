// weed-brain: describe one Weed Scout candidate, with its context, and say
// what it plausibly is. Never what to spray on it.
//
// Input (POST, signed-in user): the zoomed chip as base64 PNG, its ground
// scale, the event context (place, local time, season, nearest-station
// weather), the crop and growth stage, the row spacing, and the pipeline's
// measurements for the candidate.
//
// Output: a structured DESCRIPTION. Plausible groups with a likelihood and a
// reason, look-alikes, what a person on the ground should check, and caveats.
// The model is told, and the schema enforces, that it names no product and no
// rate. Decision support, not a prescription: the app identifies candidates
// and measures them; the operator decides.
//
// The key lives here and only here (ANTHROPIC_API_KEY). Without it the
// function answers `unconfigured` and the client shows that plainly rather
// than inventing a description.
import Anthropic from "npm:@anthropic-ai/sdk";
import { z } from "npm:zod";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-opus-5";
const MAX_CHIP_BYTES = 2_000_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const EstimateSchema = z.object({
  is_vegetation: z.boolean(),
  vegetation_confidence: z.number().min(0).max(1),
  summary: z.string(),
  growth_habit: z.string(),
  leaf_notes: z.string(),
  colour_notes: z.string(),
  plausible: z.array(z.object({
    group: z.string(),
    examples: z.array(z.string()),
    likelihood: z.enum(["high", "medium", "low"]),
    why: z.string(),
  })),
  crop_lookalike: z.string().nullable(),
  what_would_confirm: z.array(z.string()),
  caveats: z.array(z.string()),
});

const SYSTEM = `You are the identification assistant inside SwathWise, a precision-agriculture tool for US farmers and drone spray operators. You are shown one small top-down chip cut from a drone orthomosaic, plus everything the pipeline and the weather service know about where and when it was captured. Your job is to DESCRIBE what is visible and to estimate what it plausibly is, as decision support for a person who will verify it on the ground.

How to reason:
- Start from the imagery's limits. The chip's ground scale is given in centimetres per pixel; at 1 to 2 cm per pixel you can judge size, rough outline, growth habit (rosette, grassy, upright, prostrate), colour relative to the crop, and position relative to the crop rows. You cannot see leaf venation, hairs, or flowers. Say so when it matters.
- Use the context. Place, local time, season and recent weather narrow which weeds are likely to be at this size at this time in this part of the United States. The crop, its growth stage and the row spacing say what the planted plant should look like right now, and whether a green thing between rows can be the crop at all.
- Give GROUPS, not confident species. "Broadleaf rosette, likely a Brassica or a mustard-family winter annual" is honest at this scale; a species name is a guess and must be presented as one, as an example within a group.
- Always consider that it may be the crop: a volunteer, a double, a plant knocked off the row, or the row itself where the row fit is weak. Consider that it may not be vegetation: residue, a clod, a stone, standing water, shadow.
- State uncertainty in words and in the likelihood field. If the chip is too coarse or too ambiguous, say that plainly in the summary.

Hard rules:
- Never name a herbicide, a product, an active ingredient, a rate, a dose, or a spray recommendation of any kind. Do not describe what to apply. If you feel the urge to, write it into what_would_confirm as a ground check instead.
- Never claim a regional resistance status, a label restriction, or a legal requirement.
- Never state the identification as a fact. It is an estimate for a human to check.
- Plain language a farmer reads in sunlight on a phone. Short sentences.`;

function userText(body: Record<string, unknown>): string {
  const ctx = (body.context ?? {}) as Record<string, unknown>;
  const cand = (body.candidate ?? {}) as Record<string, unknown>;
  const blob = (cand.blob ?? null) as Record<string, unknown> | null;
  const wx = (ctx.weather ?? null) as Record<string, unknown> | null;
  const lines: string[] = [];
  lines.push("EVENT CONTEXT");
  lines.push(`Place: ${ctx.place ?? "unknown"} (${ctx.lat}, ${ctx.lng})`);
  lines.push(`Captured: ${ctx.captured_at} UTC; local ${ctx.local_date ?? "?"} ${ctx.local_time ?? "?"}; season ${ctx.season}`);
  if (wx) {
    lines.push(`Weather at ${wx.stationName ?? wx.station ?? "nearest station"} (${wx.distanceMi ?? "?"} mi away): ` +
      `${wx.sky ?? "sky not reported"}, ${wx.tempF ?? "?"} F, wind ${wx.windMph ?? "?"} mph ${wx.windDir ?? ""}`.trim());
  } else {
    lines.push("Weather: no station observation available.");
  }
  lines.push("");
  lines.push("FIELD");
  lines.push(`Crop: ${body.crop ?? "not stated"}; growth stage: ${body.growth_stage ?? "not stated"}; row spacing: ${body.row_spacing_m ?? "?"} m`);
  lines.push("");
  lines.push("CANDIDATE (measured by the pipeline, never a verdict)");
  lines.push(`Why it was flagged: ${cand.kind}`);
  if (cand.distance_to_row_m != null) {
    lines.push(`Distance from nearest fitted row centreline: ${(Number(cand.distance_to_row_m) * 100).toFixed(0)} cm (row-fit confidence ${cand.row_confidence ?? "?"})`);
  } else {
    lines.push("No row model was available for this ground.");
  }
  if (cand.anomaly_z != null) lines.push(`Tile deviates from the field on "${cand.anomaly_feature}" by ${Number(cand.anomaly_z).toFixed(1)} typical deviations`);
  if (blob) {
    lines.push(`Blob: ${(Number(blob.equiv_diameter_m) * 100).toFixed(0)} cm equivalent diameter, ${(Number(blob.width_m) * 100).toFixed(0)} x ${(Number(blob.height_m) * 100).toFixed(0)} cm box, ` +
      `extent ${Number(blob.extent).toFixed(2)}, chromaticity r ${Number(blob.chroma_r).toFixed(3)} g ${Number(blob.chroma_g).toFixed(3)} b ${Number(blob.chroma_b).toFixed(3)}, ExG ${Number(blob.exg_mean).toFixed(3)}, measured at ${(Number(blob.gsd_m) * 100).toFixed(2)} cm/px`);
  } else {
    lines.push("No vegetation component: the whole tile read as not-average.");
  }
  lines.push("");
  lines.push("CHIP");
  lines.push(body.chip
    ? `The attached image spans ${Number(body.chip_span_m ?? 0).toFixed(2)} m across at ${(Number(body.chip_gsd_m ?? 0) * 100).toFixed(2)} cm/px, upscaled with no smoothing so every visible square is one real pixel. North is up.`
    : "No chip could be rendered for this candidate; describe from the numbers only and say so.");
  lines.push("");
  lines.push("Describe what is visible and estimate what it plausibly is, following the rules.");
  return lines.join("\n");
}

const BANNED = /\b(glyphosate|atrazine|dicamba|2,4-d|mesotrione|paraquat|metolachlor|acetochlor|oz\/ac|fl oz|lb\/ac|l\/ha|gal\/ac|rate of|apply|spray)\b/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, reason: "error", detail: "POST only" }, 405);

  // A signed-in user, not merely a valid anon JWT.
  const auth = req.headers.get("Authorization") ?? "";
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json({ ok: false, reason: "unauthorized", detail: "Sign in to use the brain." }, 401);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json({ ok: false, reason: "unconfigured", detail: "ANTHROPIC_API_KEY is not set on the weed-brain function." });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: "error", detail: "Body must be JSON." }, 400);
  }
  const chip = body.chip as { media_type?: string; data?: string } | null;
  if (chip && (typeof chip.data !== "string" || chip.data.length > MAX_CHIP_BYTES)) {
    return json({ ok: false, reason: "error", detail: "Chip missing or too large." }, 400);
  }

  const client = new Anthropic({ apiKey });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (chip?.data) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: (chip.media_type ?? "image/png") as "image/png", data: chip.data },
    });
  }
  content.push({ type: "text", text: userText(body) });

  try {
    // Server-side refusal fallback is on by default for Claude Opus 5: on a
    // policy decline the API re-runs the request on a fallback model in the
    // same call, routed by refusal category.
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4096,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(EstimateSchema), effort: "medium" },
    } as never) as unknown as Anthropic.Beta.BetaMessage;

    if (response.stop_reason === "refusal") {
      return json({ ok: false, reason: "refused", detail: (response as { stop_details?: { explanation?: string } }).stop_details?.explanation ?? "The model declined." });
    }
    const text = response.content.filter(b => b.type === "text").map(b => (b as { text: string }).text).join("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return json({ ok: false, reason: "malformed", detail: "The model's reply was not JSON." });
    }
    const check = EstimateSchema.safeParse(parsed);
    if (!check.success) return json({ ok: false, reason: "malformed", detail: check.error.message });

    // Belt and braces on the one hard rule: a product or a rate in any prose
    // field turns the whole answer into "unavailable" rather than reaching a
    // farmer.
    const prose = JSON.stringify(check.data);
    if (BANNED.test(prose)) {
      return json({ ok: false, reason: "malformed", detail: "The reply mentioned a product or a rate, which this tool never relays." });
    }

    return json({
      ok: true,
      model: response.model,
      estimate: check.data,
      usage: { input_tokens: response.usage?.input_tokens ?? null, output_tokens: response.usage?.output_tokens ?? null },
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ ok: false, reason: "unconfigured", detail: "ANTHROPIC_API_KEY was rejected." });
    if (e instanceof Anthropic.RateLimitError) return json({ ok: false, reason: "error", detail: "Rate limited; try again shortly." });
    if (e instanceof Anthropic.APIError) return json({ ok: false, reason: "error", detail: `API ${e.status}: ${e.message}` });
    return json({ ok: false, reason: "error", detail: String((e as Error)?.message ?? e) });
  }
});
