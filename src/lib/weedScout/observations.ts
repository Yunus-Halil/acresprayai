// The archive: one row per candidate an operator chose to keep.
//
// This is the database the species estimates will be built from. Every row
// carries the chip (in the private `weed-chips` bucket), the event context,
// the crop and stage, the pipeline's measurements, the brain's estimate if
// one was asked for, and above all the operator's own verdict. The verdict is
// the label; everything else is the feature. Rows are written by a human
// action, never by the pipeline on its own, so the archive holds what someone
// looked at and decided, not everything a threshold happened to pass.
//
// Owner-scoped by RLS like every other table. The national dataset is a
// later, separate, consented step; nothing here shares anything.
import { supabase } from "@/integrations/supabase/client";
import type { BrainEstimate } from "./brain";
import type { EventContext } from "./context";
import type { Candidate, ScoutParams } from "./types";
import { dataUrlToBase64 } from "./zoom";

export const PIPELINE_VERSION = "weed-scout-v1";
export const CHIP_BUCKET = "weed-chips";

export type Verdict = "weed" | "crop" | "not_vegetation" | "unsure";
export const VERDICTS: { value: Verdict; label: string }[] = [
  { value: "weed", label: "Weed" },
  { value: "crop", label: "Crop" },
  { value: "not_vegetation", label: "Not vegetation" },
  { value: "unsure", label: "Unsure" },
];

export type ObservationRow = {
  id: string;
  candidate_id: string;
  scan_id: string | null;
  tile_id: string;
  lat: number;
  lng: number;
  captured_at: string;
  place: string | null;
  local_time: string | null;
  season: string;
  kind: string;
  score: number;
  chip_path: string | null;
  verdict: Verdict | null;
  species: string | null;
  notes: string | null;
  brain: unknown | null;
  created_at: string;
};

export type SaveObservationInput = {
  userId: string;
  fieldId: string | null;
  scanId: string;
  candidate: Candidate;
  context: EventContext;
  crop: string;
  growthStage: string | null;
  params: ScoutParams;
  gsdM: number;
  brain: { estimate: BrainEstimate; model: string } | null;
  verdict: Verdict | null;
  species: string | null;
  notes: string | null;
};

const base64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** Storage key for a chip. First segment is the owner, which is what the bucket policy keys on. */
export const chipPath = (userId: string, scanId: string, candidateId: string) =>
  `${userId}/${scanId}/${candidateId}.png`;

/** Upload a chip; null when there was none. Throws on a storage error. */
export async function uploadChip(userId: string, scanId: string, candidateId: string, dataUrl: string | null): Promise<string | null> {
  if (!dataUrl) return null;
  const parsed = dataUrlToBase64(dataUrl);
  if (!parsed) return null;
  const path = chipPath(userId, scanId, candidateId);
  const { error } = await supabase.storage.from(CHIP_BUCKET)
    .upload(path, base64ToBytes(parsed.data), { contentType: parsed.mediaType, upsert: true });
  if (error) throw new Error(`Chip upload failed: ${error.message}`);
  return path;
}

/** Signed URL for a stored chip, an hour long. */
export async function chipUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(CHIP_BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

/**
 * Write one observation. Upserts on (scan, candidate) so re-saving after a
 * verdict change updates the row rather than duplicating it.
 */
export async function saveObservation(input: SaveObservationInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const c = input.candidate;
  let chip_path: string | null = null;
  try {
    chip_path = await uploadChip(input.userId, input.scanId, c.id, c.chip);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const row = {
    user_id: input.userId,
    field_id: input.fieldId,
    scan_id: input.scanId,
    candidate_id: c.id,
    tile_id: c.tileId,
    lat: c.centroid.lat,
    lng: c.centroid.lng,
    captured_at: input.context.capturedAt,
    local_time: input.context.localTime,
    local_date: input.context.localDate,
    season: input.context.season,
    place: input.context.place,
    time_zone: input.context.timeZone,
    weather: input.context.observation,
    crop: input.crop || null,
    growth_stage: input.growthStage,
    row_spacing_m: input.params.rowSpacingM,
    gsd_m: input.gsdM,
    chip_gsd_m: c.chipGsdM,
    chip_span_m: c.chipSpanM,
    chip_path,
    kind: c.kind,
    score: c.score,
    distance_to_row_m: c.distanceToRowM,
    row_confidence: c.rowConfidence,
    anomaly_z: c.anomalyZ,
    anomaly_feature: c.anomalyFeature,
    features: c.blob,
    brain: input.brain?.estimate ?? null,
    brain_model: input.brain?.model ?? null,
    verdict: input.verdict,
    species: input.species,
    notes: input.notes,
    verdict_at: input.verdict ? new Date().toISOString() : null,
    pipeline_version: PIPELINE_VERSION,
    params: input.params,
  };
  const { data, error } = await supabase.from("weed_observations")
    .upsert(row as never, { onConflict: "scan_id,candidate_id" })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: (data as { id: string }).id };
}

export async function listObservations(scanId: string): Promise<ObservationRow[]> {
  const { data, error } = await supabase.from("weed_observations")
    .select("id, candidate_id, scan_id, tile_id, lat, lng, captured_at, place, local_time, season, kind, score, chip_path, verdict, species, notes, brain, created_at")
    .eq("scan_id", scanId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ObservationRow[];
}
