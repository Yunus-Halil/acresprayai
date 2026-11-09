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
};

export const reviewKey = (kind: FindingKind, id: string | number) => `${kind}:${id}`;
const COLUMNS = "finding_kind, finding_id, verdict, note, algorithm_status, payload, updated_at";
const missingTable = (e: { code?: string; message?: string } | null) => !!e && /does not exist|PGRST205|schema cache/i.test(`${e.code ?? ""} ${e.message ?? ""}`);

export async function loadReviews(twinId: string): Promise<Map<string, Review>> {
  const { data, error } = await supabase.from("twin_reviews").select(COLUMNS).eq("twin_id", twinId);
  if (error) { if (missingTable(error)) return new Map(); throw new Error(error.message); }
  return new Map(((data ?? []) as Review[]).map(r => [reviewKey(r.finding_kind, r.finding_id), r]));
}

export async function saveReview(twinId: string, r: { kind: FindingKind; id: string | number; verdict: Verdict; note?: string | null; algorithmStatus?: string | null; payload?: unknown }): Promise<Review> {
  const row = {
    twin_id: twinId, finding_kind: r.kind, finding_id: String(r.id), verdict: r.verdict,
    note: r.note?.trim() ? r.note.trim().slice(0, 2000) : null, algorithm_status: r.algorithmStatus ?? null, payload: r.payload ?? null,
  };
  const { data, error } = await supabase.from("twin_reviews").upsert(row as never, { onConflict: "user_id,twin_id,finding_kind,finding_id" }).select(COLUMNS).single();
  if (error || !data) throw new Error(error?.message ?? "the review was not saved");
  track("finding_reviewed", { twinId, detail: { kind: r.kind, verdict: r.verdict, status: r.algorithmStatus ?? null, note: !!row.note } });
  return data as Review;
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
  return { reviews, error, save, clear };
}

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
