// The participant's own word on a finding: correct, not sure, or wrong, with an optional note (public.twin_reviews,
// migration 20261109150000). Kept apart from what Swardus measured: a review never changes a finding's status in the
// twin, and the twin never overwrites a review. The algorithm's label at the time of the review is stored beside
// it, so "seen in 2 photographs, reviewer says wrong" can be counted later.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { track } from "@/lib/pilot/telemetry";

export type Verdict = "correct" | "unsure" | "wrong";
export const VERDICT_LABEL: Record<Verdict, string> = { correct: "Correct", unsure: "Not sure", wrong: "Wrong" };

/** What can be reviewed: the twin's own objects, by kind and id, and the field boundary. */
export type FindingKind = "weed" | "tree" | "vegetation" | "patch" | "region" | "zone" | "corn_row" | "corn_weed" | "corn_gap" | "boundary";

export type Review = {
  finding_kind: FindingKind; finding_id: string; verdict: Verdict; note: string | null;
  algorithm_status: string | null; payload: unknown; updated_at: string;
  /** What the reviewer says it is, on a corn finding they marked wrong (twin_reviews.says, migration 20261110120000). */
  says?: string | null;
};

/**
 * "Wrong" made useful on a corn finding: what the reviewer says is there instead. The reviewer's word only, stored
 * beside the algorithm's label; nothing reads it back into the twin. The same lists are enforced by the database.
 * Corn in the row and corn outside it are separate answers: what the plant is, and whether it belongs to the planted
 * row, are two different facts (volunteer corn is corn, and still unwanted). No answer names a weed species: the
 * photographs do not support one.
 */
export type SaysOption = { value: string; label: string };
export const SAYS_OPTIONS: Partial<Record<FindingKind, { ask: string; options: SaysOption[] }>> = {
  corn_weed: { ask: "What is it?", options: [
    { value: "corn_in_row", label: "Corn, in the row" },
    { value: "corn_off_row", label: "Corn, outside the row" },
    { value: "soil_or_residue", label: "Soil or residue" },
    { value: "other", label: "Something else" },
  ] },
  corn_gap: { ask: "What is there?", options: [
    { value: "plants_present", label: "Corn plants are there" },
    { value: "not_planted", label: "Not planted here" },
    { value: "other", label: "Something else" },
  ] },
  corn_row: { ask: "What is wrong with it?", options: [
    { value: "no_row", label: "No row here" },
    { value: "row_misplaced", label: "A row, drawn in the wrong place" },
    { value: "not_corn", label: "A row, but not corn" },
    { value: "other", label: "Something else" },
  ] },
};
export const saysLabel = (kind: FindingKind, says: string | null | undefined): string | null =>
  (says && SAYS_OPTIONS[kind]?.options.find(o => o.value === says)?.label) || null;

/** A finding's kind in words, as the reviewer and the founder read it. */
export const KIND_LABEL: Record<FindingKind, string> = {
  weed: "Weed candidate", tree: "Tree", vegetation: "Green growth", patch: "Weed patch", region: "Weed pressure region", zone: "Scouting zone",
  corn_row: "Corn row", corn_weed: "Weed candidate", corn_gap: "Stand gap", boundary: "Field boundary",
};
const KINDS = Object.keys(KIND_LABEL) as FindingKind[];
export const isFindingKind = (v: unknown): v is FindingKind => typeof v === "string" && (KINDS as string[]).includes(v);

/** "Weed candidate 12": the kind and the finding's own number (the boundary has none). */
export const findingLabel = (kind: string, id: string | number): string =>
  (isFindingKind(kind) ? (kind === "boundary" ? KIND_LABEL.boundary : `${KIND_LABEL[kind]} ${id}`) : `${kind.replace(/_/g, " ")} ${id}`);

/**
 * What Swardus called a finding when it was reviewed, in words: the twin's own states (twin_reviews.algorithm_status),
 * unchanged. The machine's reading, kept beside the reviewer's; neither replaces the other.
 */
export function machineSaid(kind: string, status: string | null | undefined): string {
  if (kind === "corn_weed") return status === "confirmed" ? "Weed candidate, confirmed" : status === "contested" ? "Weed candidate, contested" : "Weed candidate, not confirmed";
  if (kind === "corn_row") return status === "corn" ? "Corn row" : "Row, crop not confirmed";
  if (kind === "corn_gap") return status === "confirmed" ? "Stand gap, confirmed" : "Stand gap, withheld";
  if (!status) return "Not recorded";
  // The same words the twin's inspector uses for these states.
  if (kind === "weed") return status === "verified" ? "Weed candidate, seen in 2+ photographs" : status === "single view" ? "Weed candidate, seen in one photograph" : status === "on a tree" ? "Detection on a tree crown" : `Weed candidate, ${status}`;
  if (kind === "tree") return "Crop tree";
  if (kind === "vegetation") return "Green growth, not classed";
  if (kind === "patch") return "Patch of weed candidates";
  if (kind === "region" || kind === "zone") return "Weed pressure";
  if (kind === "boundary") return status === "rows" ? "Boundary from the crop rows" : `Inferred boundary, confidence ${status}`;
  return status;
}

export const reviewKey = (kind: FindingKind, id: string | number) => `${kind}:${id}`;
const BASE_COLUMNS = "finding_kind, finding_id, verdict, note, algorithm_status, payload, updated_at";
const COLUMNS = `${BASE_COLUMNS}, says`;
type DbError = { code?: string; message?: string } | null;
/** The database has no `says` column yet (the app was deployed before migration 20261110120000): reviews work as before, without it. */
const missingSays = (e: DbError) => !!e && /\bsays\b/.test(e.message ?? "") && /42703|PGRST204|does not exist|schema cache/i.test(`${e.code ?? ""} ${e.message ?? ""}`);
const missingTable = (e: DbError) => !!e && /does not exist|PGRST205|schema cache/i.test(`${e.code ?? ""} ${e.message ?? ""}`);
/** null until the database has answered once. */
let saysColumn: boolean | null = null;
/** Whether "what is it" answers can be saved (false when the database has not been updated). */
export const saysAvailable = () => saysColumn !== false;

export async function loadReviews(twinId: string): Promise<Map<string, Review>> {
  const select = (columns: string) => supabase.from("twin_reviews").select(columns).eq("twin_id", twinId) as unknown as PromiseLike<{ data: Review[] | null; error: DbError }>;
  let { data, error } = await select(saysColumn === false ? BASE_COLUMNS : COLUMNS);
  if (missingSays(error)) { saysColumn = false; ({ data, error } = await select(BASE_COLUMNS)); }
  else if (!error) saysColumn ??= true;
  if (error) { if (missingTable(error)) return new Map(); throw new Error(error.message); }
  return new Map((data ?? []).map(r => [reviewKey(r.finding_kind, r.finding_id), r]));
}

export async function saveReview(twinId: string, r: { kind: FindingKind; id: string | number; verdict: Verdict; note?: string | null; algorithmStatus?: string | null; payload?: unknown; says?: string | null }): Promise<Review> {
  const base = {
    twin_id: twinId, finding_kind: r.kind, finding_id: String(r.id), verdict: r.verdict,
    note: r.note?.trim() ? r.note.trim().slice(0, 2000) : null, algorithm_status: r.algorithmStatus ?? null, payload: r.payload ?? null,
  };
  // Only a corn finding marked wrong carries an answer, and only one from its own list; anything else clears it.
  const says = r.verdict === "wrong" && saysLabel(r.kind, r.says) ? r.says! : null;
  const upsert = (withSays: boolean) => supabase.from("twin_reviews").upsert((withSays ? { ...base, says } : base) as never, { onConflict: "user_id,twin_id,finding_kind,finding_id" }).select(withSays ? COLUMNS : BASE_COLUMNS).single();
  // Kinds without answers are written exactly as before the column existed.
  const withSays = saysColumn !== false && !!SAYS_OPTIONS[r.kind];
  let { data, error } = await upsert(withSays);
  if (withSays && missingSays(error)) { saysColumn = false; ({ data, error } = await upsert(false)); }
  if (error || !data) throw new Error(error?.message ?? "the review was not saved");
  const saved = data as unknown as Review;
  track("finding_reviewed", { twinId, detail: { kind: r.kind, verdict: r.verdict, status: r.algorithmStatus ?? null, note: !!base.note, ...(saved.says ? { says: saved.says } : {}) } });
  return saved;
}

export async function deleteReview(twinId: string, kind: FindingKind, id: string | number): Promise<void> {
  const { error } = await supabase.from("twin_reviews").delete().eq("twin_id", twinId).eq("finding_kind", kind).eq("finding_id", String(id));
  if (error) throw new Error(error.message);
}

/** A twin's reviews, with save and clear that update the map at once. `null` while loading. */
export function useTwinReviews(twinId: string | null) {
  const [reviews, setReviews] = useState<Map<string, Review> | null>(twinId ? null : new Map());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!twinId) { setReviews(new Map()); return; }
    let live = true;
    loadReviews(twinId).then(m => { if (live) setReviews(m); }).catch(e => { if (live) { setError((e as Error).message); setReviews(new Map()); } });
    return () => { live = false; };
  }, [twinId]);
  const save = useCallback(async (r: Parameters<typeof saveReview>[1]) => {
    if (!twinId) throw new Error("This Field Twin is not saved to your account yet, so it cannot be reviewed.");
    const saved = await saveReview(twinId, r);
    setReviews(m => new Map(m ?? []).set(reviewKey(r.kind, r.id), saved));
    return saved;
  }, [twinId]);
  const clear = useCallback(async (kind: FindingKind, id: string | number) => {
    if (!twinId) return;
    await deleteReview(twinId, kind, id);
    setReviews(m => { const n = new Map(m ?? []); n.delete(reviewKey(kind, id)); return n; });
  }, [twinId]);
  // Known once the reviews have loaded (the load is what finds out whether the database has the column).
  return { reviews, error, save, clear, canSay: reviews !== null && saysAvailable() };
}

/** Tests only. */
export function __resetSaysColumn() { saysColumn = null; }

export type ReviewCount = { reviewed: number; correct: number; unsure: number; wrong: number };

/** Review counts per twin, for the list. Silent (empty) if reviews cannot be read. */
export function useReviewCounts(twinIds: string[]): Map<string, ReviewCount> {
  const [counts, setCounts] = useState<Map<string, ReviewCount>>(new Map());
  const key = twinIds.join(",");
  useEffect(() => {
    if (!twinIds.length) { setCounts(new Map()); return; }
    let live = true;
    supabase.from("twin_reviews").select("twin_id, verdict, finding_kind").in("twin_id", twinIds).then(({ data }) => {
      if (!live) return;
      const m = new Map<string, ReviewCount>();
      for (const r of (data ?? []) as { twin_id: string; verdict: Verdict; finding_kind: string }[]) {
        if (r.finding_kind === "boundary") continue;
        const c = m.get(r.twin_id) ?? { reviewed: 0, correct: 0, unsure: 0, wrong: 0 };
        c.reviewed++; c[r.verdict]++;
        m.set(r.twin_id, c);
      }
      setCounts(m);
    }, () => undefined);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return counts;
}
