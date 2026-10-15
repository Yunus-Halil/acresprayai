// The operator's word on a review area, kept per scan (migration 20261015150000,
// table `scan_hotspot_reviews`). Fails soft: a review that cannot be saved is
// still shown for the session, and a table that cannot be read is empty.
import { supabase } from "@/integrations/supabase/client";
import type { HotspotReview } from "./hotspots";

export type HotspotReviewRow = { hotspotId: string; verdict: HotspotReview; notes: string; updatedAt: string | null; paramsKey: string | null };

const VERDICTS = new Set<HotspotReview>(["confirmed", "dismissed", "uncertain"]);

export async function loadHotspotReviews(scanId: string): Promise<Record<string, HotspotReviewRow>> {
  const out: Record<string, HotspotReviewRow> = {};
  try {
    const q = await supabase.from("scan_hotspot_reviews").select("hotspot_id, verdict, notes, updated_at, params_key").eq("scan_id", scanId);
    if (q.error || !q.data) return out;
    for (const r of q.data as unknown as Array<{ hotspot_id: string; verdict: string; notes: string | null; updated_at: string | null; params_key: string | null }>) {
      if (!VERDICTS.has(r.verdict as HotspotReview)) continue;
      out[r.hotspot_id] = { hotspotId: r.hotspot_id, verdict: r.verdict as HotspotReview, notes: r.notes ?? "", updatedAt: r.updated_at, paramsKey: r.params_key };
    }
  } catch { /* an empty cache */ }
  return out;
}

export async function saveHotspotReview(input: { userId: string; scanId: string; hotspotId: string; verdict: HotspotReview; notes: string; paramsKey: string | null }): Promise<{ ok: boolean; error?: string }> {
  try {
    const row = { user_id: input.userId, scan_id: input.scanId, hotspot_id: input.hotspotId, verdict: input.verdict, notes: input.notes, params_key: input.paramsKey, updated_at: new Date().toISOString() };
    const up = await supabase.from("scan_hotspot_reviews").upsert(row as never, { onConflict: "scan_id,hotspot_id" });
    return up.error ? { ok: false, error: up.error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) };
  }
}

export async function deleteHotspotReview(scanId: string, hotspotId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const d = await supabase.from("scan_hotspot_reviews").delete().eq("scan_id", scanId).eq("hotspot_id", hotspotId);
    return d.error ? { ok: false, error: d.error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) };
  }
}
