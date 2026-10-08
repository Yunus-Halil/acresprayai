// A finished run, saved per scan and restored on the next visit.
//
// Two tables (migration 20261008150000): `scan_patterns`, one row per scan
// with the planting pattern and the slim result around it, and
// `scan_findings`, one row per candidate as the review screen reads it. The
// chip is not kept: it is a picture of imagery the app can render again, and
// the archive keeps one only once a verdict is saved (observations.ts).
// Verdicts stay in weed_observations, joined by (scan_id, candidate_id).
//
// Pure where it can be: packing, slimming and rebuilding are functions a test
// can run; only save and load touch the client. Both fail soft: a run that
// cannot be saved is still a run, and a scan with nothing saved is a scan
// that has not been scanned.
import { supabase } from "@/integrations/supabase/client";
import type { LatLng2 } from "../geo";
import type { BlobClass } from "../photoScout/pattern";
import { findingClassOf } from "./candidates";
import type { FieldPattern, PatternPlant } from "./fieldPattern";
import type { Candidate, ScoutParams, ScoutResult } from "./types";

/** Bumped when the saved shape changes; older rows are ignored, never misread. */
export const RUN_CACHE_VERSION = "weed-scout-v3-pattern";

/** Rows the findings are inserted in. */
export const FINDINGS_BATCH = 200;

const CLS: BlobClass[] = ["on pattern", "double", "between plants", "off-row", "unplaced"];

/** A plant as eight numbers and a string: lat, lng, class index, area, diameter, row, across, block, window id. */
export type PackedPlant = [number, number, number, number, number, number | null, number | null, number, string];

export type PackedPattern = Omit<FieldPattern, "plants"> & { packedPlants: PackedPlant[] };

export function packPattern(fp: FieldPattern): PackedPattern {
  const { plants, ...rest } = fp;
  return {
    ...rest,
    packedPlants: plants.map(p => [
      +p.centroid.lat.toFixed(8), +p.centroid.lng.toFixed(8), CLS.indexOf(p.cls), +p.areaM2.toFixed(4), +p.equivDiameterM.toFixed(3),
      p.rowIndex, p.distanceToRowM == null ? null : +p.distanceToRowM.toFixed(3), p.block, p.windowId,
    ]),
  };
}

export function unpackPattern(p: PackedPattern): FieldPattern {
  const { packedPlants, ...rest } = p;
  const plants: PatternPlant[] = packedPlants.map((q, i) => ({
    id: `${q[8]}:${i}`, windowId: q[8], block: q[7], centroid: { lat: q[0], lng: q[1] }, cls: CLS[q[2]] ?? "unplaced",
    areaM2: q[3], equivDiameterM: q[4], rowIndex: q[5], distanceToRowM: q[6],
  }));
  return { ...rest, plants };
}

/** The result without its candidates, its per-tile arrays and its plants spelled out. */
export type SlimResult = Omit<ScoutResult, "tiles" | "samples" | "scores" | "flags" | "candidates" | "pattern"> & { pattern: PackedPattern | null };

export function slimResult(r: ScoutResult): SlimResult {
  const { tiles: _t, samples: _s, scores: _sc, flags: _f, candidates: _c, pattern, ...rest } = r;
  return { ...rest, pattern: pattern ? packPattern(pattern) : null };
}

export type FindingRow = {
  candidate_id: string;
  kind: string;
  finding_class: string;
  lat: number;
  lng: number;
  area_m2: number;
  score: number;
  source_photo: string | null;
  candidate: Omit<Candidate, "chip">;
};

export function findingRow(c: Candidate): FindingRow {
  const { chip: _chip, ...rest } = c;
  return {
    candidate_id: c.id, kind: c.kind, finding_class: findingClassOf(c), lat: c.centroid.lat, lng: c.centroid.lng,
    area_m2: c.areaM2, score: c.score, source_photo: c.sourceImages?.best ?? null, candidate: rest,
  };
}

/** A run rebuilt from its rows: chips gone, per-tile arrays empty, `restoredAt` set. */
export function resultFromRows(pattern: { result: SlimResult; updated_at: string }, findings: { candidate: Omit<Candidate, "chip"> }[]): ScoutResult {
  const slim = pattern.result;
  return {
    ...slim,
    tiles: [], samples: [], scores: [], flags: [],
    pattern: slim.pattern ? unpackPattern(slim.pattern) : null,
    candidates: findings.map(f => ({ ...f.candidate, chip: null })).sort((a, b) => b.score - a.score),
    restoredAt: pattern.updated_at,
  };
}

export type SaveRunInput = { userId: string; fieldId: string | null; scanId: string; result: ScoutResult; params: ScoutParams };

/** Save a run, replacing what was saved before. Never throws: the outcome says. */
export async function saveRun(input: SaveRunInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId, fieldId, scanId, result, params } = input;
  try {
    const row = {
      user_id: userId, field_id: fieldId, scan_id: scanId, pass_version: RUN_CACHE_VERSION, params,
      summary: result.pattern?.summary ?? null, result: slimResult(result),
    };
    const up = await supabase.from("scan_patterns").upsert(row as never, { onConflict: "scan_id" });
    if (up.error) return { ok: false, error: up.error.message };
    const del = await supabase.from("scan_findings").delete().eq("scan_id", scanId);
    if (del.error) return { ok: false, error: del.error.message };
    const rows = result.candidates.map(c => ({ ...findingRow(c), user_id: userId, scan_id: scanId }));
    for (let i = 0; i < rows.length; i += FINDINGS_BATCH) {
      const ins = await supabase.from("scan_findings").insert(rows.slice(i, i + FINDINGS_BATCH) as never);
      if (ins.error) return { ok: false, error: ins.error.message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) };
  }
}

/** The last saved run for a scan, or null when there is none or it is from another version. Never throws. */
export async function loadRun(scanId: string): Promise<ScoutResult | null> {
  try {
    const p = await supabase.from("scan_patterns").select("result, updated_at, pass_version").eq("scan_id", scanId).maybeSingle();
    if (p.error || !p.data) return null;
    const pr = p.data as { result: SlimResult; updated_at: string; pass_version: string };
    if (pr.pass_version !== RUN_CACHE_VERSION) return null;
    const f = await supabase.from("scan_findings").select("candidate").eq("scan_id", scanId);
    if (f.error) return null;
    return resultFromRows(pr, (f.data ?? []) as { candidate: Omit<Candidate, "chip"> }[]);
  } catch {
    return null;
  }
}

/** The field read of a scan, for a card: the summary and when it was read. */
export async function loadPatternSummary(scanId: string): Promise<{ summary: FieldPattern["summary"] | null; candidates: number; at: string } | null> {
  try {
    const p = await supabase.from("scan_patterns").select("summary, updated_at, pass_version").eq("scan_id", scanId).maybeSingle();
    if (p.error || !p.data) return null;
    const pr = p.data as { summary: FieldPattern["summary"] | null; updated_at: string; pass_version: string };
    if (pr.pass_version !== RUN_CACHE_VERSION) return null;
    const c = await supabase.from("scan_findings").select("id", { count: "exact", head: true }).eq("scan_id", scanId);
    return { summary: pr.summary, candidates: c.count ?? 0, at: pr.updated_at };
  } catch {
    return null;
  }
}

export type { LatLng2 };
