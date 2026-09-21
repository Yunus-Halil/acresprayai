// Step 5, second half: walk the candidate up to the brain.
//
// The client for the `weed-brain` edge function, which holds the model key
// and the prompt. What goes up: the chip, its scale, the event context (place,
// local time, season, weather), the crop and growth stage, the row spacing,
// and the numbers the pipeline measured. What comes back: a DESCRIPTION with
// plausible groups and stated uncertainty, never a verdict and never a
// product or a rate. The estimate is stored beside the operator's own
// verdict, which is what the archive learns from; the estimate is the prior
// the operator corrects.
//
// A missing key, a refusal, or an error all come back as `unavailable` with a
// reason. Nothing here ever fabricates a description.
import { FN_BASE } from "@/components/app/workspace/constants";
import { supabase } from "@/integrations/supabase/client";
import type { EventContext } from "./context";
import type { Candidate } from "./types";
import { dataUrlToBase64 } from "./zoom";

export type Likelihood = "high" | "medium" | "low";

export type BrainEstimate = {
  is_vegetation: boolean;
  /** 0..1 that the chip shows a living plant at all. */
  vegetation_confidence: number;
  /** One or two sentences an operator reads first. */
  summary: string;
  growth_habit: string;
  leaf_notes: string;
  colour_notes: string;
  /** Plausible groups, most likely first. Groups, not species: the imagery cannot carry a species. */
  plausible: { group: string; examples: string[]; likelihood: Likelihood; why: string }[];
  /** Could this be the crop itself, a volunteer, or a double? */
  crop_lookalike: string | null;
  /** What a person on the ground should look at to settle it. */
  what_would_confirm: string[];
  caveats: string[];
};

export type BrainResult =
  | { kind: "estimate"; estimate: BrainEstimate; model: string; inputTokens: number | null; outputTokens: number | null }
  | { kind: "unavailable"; reason: "unconfigured" | "unauthorized" | "refused" | "malformed" | "error"; detail?: string };

export type BrainRequest = {
  candidate: Candidate;
  context: EventContext;
  crop: string;
  growthStage: string | null;
  rowSpacingM: number;
};

/** The wire shape the edge function accepts. Kept flat and explicit. */
export function brainPayload(req: BrainRequest) {
  const c = req.candidate;
  const chip = c.chip ? dataUrlToBase64(c.chip) : null;
  return {
    chip: chip ? { media_type: chip.mediaType, data: chip.data } : null,
    chip_span_m: c.chipSpanM,
    chip_gsd_m: c.chipGsdM,
    context: {
      captured_at: req.context.capturedAt,
      place: req.context.place,
      local_time: req.context.localTime,
      local_date: req.context.localDate,
      season: req.context.season,
      lat: req.context.lat,
      lng: req.context.lng,
      weather: req.context.observation,
    },
    crop: req.crop || null,
    growth_stage: req.growthStage,
    row_spacing_m: req.rowSpacingM,
    candidate: {
      kind: c.kind,
      score: c.score,
      distance_to_row_m: c.distanceToRowM,
      row_confidence: c.rowConfidence,
      anomaly_z: c.anomalyZ,
      anomaly_feature: c.anomalyFeature,
      blob: c.blob ? {
        area_m2: c.blob.areaM2,
        equiv_diameter_m: c.blob.equivDiameterM,
        width_m: c.blob.widthM,
        height_m: c.blob.heightM,
        extent: c.blob.extent,
        chroma_r: c.blob.chromaR,
        chroma_g: c.blob.chromaG,
        chroma_b: c.blob.chromaB,
        exg_mean: c.blob.exgMean,
        brightness: c.blob.brightness,
        gsd_m: c.blob.gsdM,
      } : null,
    },
  };
}

const LIKELIHOODS = new Set<Likelihood>(["high", "medium", "low"]);

/** Validate the estimate shape client-side too; a malformed answer is unavailable, not displayed. */
export function parseEstimate(raw: unknown): BrainEstimate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  if (typeof r.is_vegetation !== "boolean") return null;
  const summary = str(r.summary);
  if (!summary) return null;
  const plausible = Array.isArray(r.plausible)
    ? r.plausible.flatMap(p => {
        if (!p || typeof p !== "object") return [];
        const q = p as Record<string, unknown>;
        const group = str(q.group);
        const likelihood = str(q.likelihood) as Likelihood | null;
        if (!group || !likelihood || !LIKELIHOODS.has(likelihood)) return [];
        return [{ group, examples: strs(q.examples), likelihood, why: str(q.why) ?? "" }];
      })
    : [];
  const conf = Number(r.vegetation_confidence);
  return {
    is_vegetation: r.is_vegetation,
    vegetation_confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0,
    summary,
    growth_habit: str(r.growth_habit) ?? "",
    leaf_notes: str(r.leaf_notes) ?? "",
    colour_notes: str(r.colour_notes) ?? "",
    plausible,
    crop_lookalike: str(r.crop_lookalike),
    what_would_confirm: strs(r.what_would_confirm),
    caveats: strs(r.caveats),
  };
}

export async function askBrain(req: BrainRequest, timeoutMs = 120_000): Promise<BrainResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    if (!token) return { kind: "unavailable", reason: "unauthorized", detail: "Sign in to use the brain." };
    const res = await fetch(`${FN_BASE}/weed-brain`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(brainPayload(req)),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    if (!json || typeof json !== "object") {
      return { kind: "unavailable", reason: "error", detail: `HTTP ${res.status}` };
    }
    if (json.ok !== true) {
      const reason = (["unconfigured", "unauthorized", "refused", "malformed"].includes(json.reason)
        ? json.reason : "error") as Extract<BrainResult, { kind: "unavailable" }>["reason"];
      return { kind: "unavailable", reason, detail: json.detail ?? json.error };
    }
    const estimate = parseEstimate(json.estimate);
    if (!estimate) return { kind: "unavailable", reason: "malformed", detail: "The reply did not match the expected shape." };
    return {
      kind: "estimate",
      estimate,
      model: String(json.model ?? "unknown"),
      inputTokens: json.usage?.input_tokens ?? null,
      outputTokens: json.usage?.output_tokens ?? null,
    };
  } catch (e) {
    return { kind: "unavailable", reason: "error", detail: String((e as Error)?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}
