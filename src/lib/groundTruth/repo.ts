// Reading the patches to walk to, and writing what was found there.
import { supabase } from "@/integrations/supabase/client";
import { FINDING_CLASS_LABEL } from "@/lib/weedScout/candidates";
import type { FindingClass } from "@/lib/weedScout/types";
import { type GroundTruthInput, type WalkPatch, groundTruthRow } from "./walk";

export const GROUND_TRUTH_BUCKET = "ground-truth";

type ObservationRow = {
  id: string; candidate_id: string; scan_id: string | null; field_id: string | null; lat: number; lng: number;
  kind: string; class: string | null; finding_class: string | null; verdict: string | null; area_m2: number | null; crop: string | null;
};

/**
 * The flagged patches of a scan: every spot the operator saved from Weed
 * Scout, kept, unsure or removed alike. A removed spot visited on foot is as
 * much a label as a kept one.
 */
export async function listWalkPatches(scanId: string): Promise<WalkPatch[]> {
  const { data, error } = await supabase.from("weed_observations")
    .select("id, candidate_id, scan_id, field_id, lat, lng, kind, class, finding_class, verdict, area_m2, crop")
    .eq("scan_id", scanId)
    .order("score", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ObservationRow[]).map(r => ({
    observationId: r.id,
    candidateId: r.candidate_id,
    scanId: r.scan_id,
    fieldId: r.field_id,
    lat: r.lat,
    lng: r.lng,
    label: r.class ?? (r.finding_class ? FINDING_CLASS_LABEL[r.finding_class as FindingClass] ?? r.finding_class : r.kind),
    verdict: r.verdict,
    areaM2: r.area_m2,
    crop: r.crop,
  }));
}

/** Visits recorded on this field, by spot id. */
export async function visitsBySpot(fieldId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("ground_truth").select("candidate_id").eq("field_id", fieldId);
  if (error) throw new Error(error.message);
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { candidate_id: string | null }[]) {
    if (r.candidate_id) out[r.candidate_id] = (out[r.candidate_id] ?? 0) + 1;
  }
  return out;
}

/** Names this person has written before, most used first: a typing aid, not a suggestion about any patch. */
export async function pastSpeciesNames(limit = 20): Promise<string[]> {
  const { data } = await supabase.from("ground_truth").select("species").limit(1000);
  const count = new Map<string, number>();
  for (const r of (data ?? []) as { species: { name?: string }[] | null }[]) {
    for (const s of r.species ?? []) {
      const n = s?.name?.trim();
      if (n) count.set(n, (count.get(n) ?? 0) + 1);
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(e => e[0]);
}

/**
 * Save one visit. The row first (its id names the photo folder), then the
 * photos, then the row is told where they are. A photo that fails to upload
 * is reported; the record stands without it.
 */
export async function saveGroundTruth(input: GroundTruthInput, userId: string, photos: File[]): Promise<{ id: string; photoErrors: string[] }> {
  const { data, error } = await supabase.from("ground_truth").insert(groundTruthRow(input, userId) as never).select("id").single();
  if (error) throw new Error(error.message);
  const id = (data as { id: string }).id;
  const paths: string[] = [];
  const photoErrors: string[] = [];
  for (let i = 0; i < photos.length; i++) {
    const f = photos[i];
    const ext = (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${userId}/${input.patch.fieldId ?? "no-field"}/${id}/${i + 1}.${ext}`;
    const { error: upErr } = await supabase.storage.from(GROUND_TRUTH_BUCKET).upload(path, f, { contentType: f.type || "image/jpeg", upsert: true });
    if (upErr) photoErrors.push(`${f.name}: ${upErr.message}`); else paths.push(path);
  }
  if (paths.length) {
    const { error: updErr } = await supabase.from("ground_truth").update({ photo_paths: paths } as never).eq("id", id);
    if (updErr) photoErrors.push(`photos uploaded but not linked: ${updErr.message}`);
  }
  return { id, photoErrors };
}
