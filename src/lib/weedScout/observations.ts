// The archive: one row per candidate an operator chose to keep.
//
// This is the database the species estimates will be built from, and the
// data the scout itself learns from (feedback.ts). Every row carries the chip
// (in the private `weed-chips` bucket), the event context, the crop and
// stage, the pipeline's measurements, the feature vector the scout compares
// on, the in-house estimate, and above all the operator's own verdict. The
// verdict is the label; everything else is the feature. Rows are written by a
// human action, never by the pipeline on its own, so the archive holds what
// someone looked at and decided, not everything a threshold happened to pass.
//
// Owner-scoped by RLS like every other table. The national dataset is a
// later, separate, consented step; nothing here shares anything.
import { supabase } from "@/integrations/supabase/client";
import { type Identification, type IdentificationStatus, isStatedFinding } from "../weedCatalog/identification";
import { type Inference, type Prediction, readPrediction } from "./classify/types";
import { findingClassOf } from "./candidates";
import type { EventContext } from "./context";
import { featureVectorOf } from "./feedback";
import type { Candidate, CandidateKind, FeedbackRow, FindingClass, ScoutParams } from "./types";
import { dataUrlToBase64 } from "./zoom";

export const PIPELINE_VERSION = "weed-scout-v2";
export const CHIP_BUCKET = "weed-chips";

/**
 * The operator's label. The review flow offers three: weed, not a weed
 * (removed), unsure. `crop` and `not_vegetation` are older, finer dismissals
 * that existing rows carry; they read as "not a weed" everywhere.
 */
export type Verdict = "weed" | "not_weed" | "unsure" | "crop" | "not_vegetation";
export const VERDICTS: { value: Verdict; label: string }[] = [
  { value: "weed", label: "Weed" },
  { value: "not_weed", label: "Not a weed" },
  { value: "unsure", label: "Unsure" },
];
export const ALL_VERDICTS: readonly Verdict[] = ["weed", "not_weed", "unsure", "crop", "not_vegetation"];
/** True for every verdict that means "remove this from the weed set". */
export const isDismissal = (v: Verdict | null | undefined): boolean => v === "not_weed" || v === "crop" || v === "not_vegetation";

const KINDS = new Set<CandidateKind>([
  "not-average region", "field outlier", "off-row vegetation", "vegetation outlier", "off-row and outlier",
]);

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
  created_at: string;
  /** What the scout offered, if anything. Never a finding. */
  suggested_catalog_id: string | null;
  suggestion_basis: string | null;
  /** What the operator said. Only confirmed / edited are findings. */
  identification_status: IdentificationStatus;
  catalog_id: string | null;
  identification_source: string | null;
  identification_basis: string | null;
  /** The model's word on this spot when it was saved, or null when no model scored it. Never the label. */
  prediction: StoredPrediction | null;
  model_version: string | null;
  /** Whether a person set the verdict, or it was saved as proposed. Null on rows older than the column. */
  verdict_source: VerdictSource | null;
  finding_class: FindingClass | null;
  /** Whether the model was asked about this spot when it was saved. Null on rows older than the column. */
  inference: Inference | null;
};

/** `operator`: a person set it on this spot. `default`: saved as the scout proposed it. */
export type VerdictSource = "operator" | "default";

export type StoredPrediction = NonNullable<ReturnType<typeof readPrediction>>;

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
  verdict: Verdict | null;
  /** Null keeps whatever an earlier save recorded (see `verdictSourceFor`). */
  verdictSource: VerdictSource | null;
  /** Free species text when no identification was made; ignored when one was (the label wins). */
  species: string | null;
  notes: string | null;
  /** The suggestion that was on screen, so the archive knows what was shown and why. */
  suggestion: { catalogId: string; basis: string } | null;
  /** The operator's identification. UNIDENTIFIED when they made none. */
  identification: Identification;
};

/**
 * The identification columns for a row, as one pure step so the rule can be
 * tested: a suggestion never becomes the label, a confirmation carries the
 * suggested id, an unidentified or rejected row carries no catalog id, and
 * the free species text survives only when nothing was identified.
 */
export function identificationColumns(input: Pick<SaveObservationInput, "species" | "suggestion" | "identification">) {
  const id = input.identification;
  const stated = isStatedFinding(id);
  const status: IdentificationStatus = stated ? id.status : (id.status === "rejected" ? "rejected" : "unidentified");
  return {
    suggested_catalog_id: input.suggestion?.catalogId ?? null,
    suggestion_basis: input.suggestion?.basis ?? null,
    identification_status: status,
    catalog_id: stated ? id.catalogId : null,
    identification_source: stated ? id.source : null,
    identification_basis: stated ? id.basis : null,
    identified_at: stated ? new Date().toISOString() : null,
    species: stated ? id.label!.trim() : (input.species?.trim() || null),
  };
}

/**
 * The model columns for a row. Only sent when a model scored this spot on this
 * page: a re-save with no model loaded (runtime failed, model withdrawn) must
 * not null out the prediction an earlier save recorded, and an upsert only
 * touches the columns it is given. The verdict never passes through here.
 */
export function predictionColumns(c: Pick<Candidate, "prediction">): { prediction: Prediction; model_version: string } | Record<string, never> {
  return c.prediction ? { prediction: c.prediction, model_version: c.prediction.modelVersion } : {};
}

/**
 * Who decided this save's verdict. A spot the operator touched this run (a
 * verdict press, including pressing the one already shown, or a name) is
 * theirs. An untouched spot already in the archive keeps what the archive says
 * (null: send nothing). An untouched new spot was saved as proposed.
 */
export function verdictSourceFor(touchedThisRun: boolean, alreadySaved: boolean): VerdictSource | null {
  if (touchedThisRun) return "operator";
  return alreadySaved ? null : "default";
}

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
    geometry: c.region ? c.region.rings : null,
    area_m2: c.areaM2,
    tile_count: c.region?.tileCount ?? null,
    class: c.region?.klass ?? null,
    blob_z: c.blobZ,
    blob_z_feature: c.blobZFeature,
    vector: featureVectorOf(c, input.params.rowSpacingM),
    estimate: c.estimate,
    estimate_model: c.estimate?.model ?? null,
    // The model's word beside the operator's, never in its place.
    ...predictionColumns(c),
    // What the finding is, and whether the model was asked about it.
    finding_class: findingClassOf(c),
    ...(c.inference ? { inference: c.inference } : {}),
    verdict: input.verdict,
    ...(input.verdictSource ? { verdict_source: input.verdictSource } : {}),
    notes: input.notes,
    verdict_at: input.verdict ? new Date().toISOString() : null,
    pipeline_version: PIPELINE_VERSION,
    params: input.params,
    // species, the suggestion and the identification, by the one rule.
    ...identificationColumns(input),
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
    .select("id, candidate_id, scan_id, tile_id, lat, lng, captured_at, place, local_time, season, kind, score, chip_path, verdict, species, notes, created_at, suggested_catalog_id, suggestion_basis, identification_status, catalog_id, identification_source, identification_basis, prediction, model_version, verdict_source, finding_class, inference")
    .eq("scan_id", scanId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as (Omit<ObservationRow, "prediction"> & { prediction: unknown })[])
    .map(r => ({ ...r, prediction: readPrediction(r.prediction) }));
}

/**
 * Every verdict the operator has ever saved, as the scout consumes it. Rows
 * without a vector (saved by the first pipeline version) cannot be compared
 * and are left out; they still count in the archive.
 */
export async function loadFeedback(): Promise<FeedbackRow[]> {
  const { data, error } = await supabase.from("weed_observations")
    .select("kind, verdict, species, vector, field_id")
    .not("verdict", "is", null)
    .not("vector", "is", null)
    .limit(5000);
  if (error) throw new Error(error.message);
  const out: FeedbackRow[] = [];
  for (const r of (data ?? []) as unknown as { kind: string; verdict: string; species: string | null; vector: unknown; field_id: string | null }[]) {
    if (!KINDS.has(r.kind as CandidateKind)) continue;
    if (!Array.isArray(r.vector) || !r.vector.every(v => typeof v === "number" && Number.isFinite(v))) continue;
    if (!ALL_VERDICTS.includes(r.verdict as Verdict)) continue;
    out.push({
      kind: r.kind as CandidateKind,
      verdict: r.verdict as FeedbackRow["verdict"],
      species: r.species,
      vector: r.vector as number[],
      fieldId: r.field_id,
    });
  }
  return out;
}
