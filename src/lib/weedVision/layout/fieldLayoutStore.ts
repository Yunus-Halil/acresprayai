// A field's planting layout, kept per field (migration 20261019120000, table
// `field_planting_layouts`) with a copy in this browser, so a layout survives a
// table that is not there yet and is read back at once on the next visit.
// Fails soft both ways: nothing here throws.
import { supabase } from "@/integrations/supabase/client";
import { storageKey } from "../../storage";
import type { PlantingLayout } from "./readLayout";

const localKey = (fieldId: string) => storageKey("plantingLayout", fieldId);

function valid(x: unknown): x is PlantingLayout {
  const l = x as PlantingLayout;
  return !!l && l.version === 1 && Array.isArray(l.blocks) && l.blocks.every(b => Array.isArray(b?.points) && b.points.length === 3 && b.points.every(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng)))
    && (l.verdicts === undefined || (Array.isArray(l.verdicts) && l.verdicts.every(v => Number.isFinite(v?.lat) && Number.isFinite(v?.lng) && typeof v?.crop === "boolean")));
}

export async function loadFieldLayout(fieldId: string): Promise<PlantingLayout | null> {
  try {
    const q = await supabase.from("field_planting_layouts" as never).select("layout").eq("field_id", fieldId).maybeSingle();
    const row = q.data as unknown as { layout?: unknown } | null;
    if (!q.error && row && valid(row.layout)) return row.layout;
  } catch { /* the browser's copy */ }
  try { const raw = localStorage.getItem(localKey(fieldId)); const l = raw ? JSON.parse(raw) : null; return valid(l) ? l : null; } catch { return null; }
}

export async function saveFieldLayout(input: { fieldId: string; userId: string | null; layout: PlantingLayout }): Promise<{ ok: boolean; savedTo: "field" | "browser"; error?: string }> {
  try { localStorage.setItem(localKey(input.fieldId), JSON.stringify(input.layout)); } catch { /* private mode */ }
  if (!input.userId) return { ok: true, savedTo: "browser" };
  try {
    const up = await supabase.from("field_planting_layouts" as never).upsert({ user_id: input.userId, field_id: input.fieldId, layout: input.layout, updated_at: new Date().toISOString() } as never, { onConflict: "field_id" });
    return up.error ? { ok: true, savedTo: "browser", error: up.error.message } : { ok: true, savedTo: "field" };
  } catch (e) {
    return { ok: true, savedTo: "browser", error: (e as Error)?.message ?? String(e) };
  }
}

export async function deleteFieldLayout(fieldId: string): Promise<void> {
  try { localStorage.removeItem(localKey(fieldId)); } catch { /* none */ }
  try { await supabase.from("field_planting_layouts" as never).delete().eq("field_id", fieldId); } catch { /* none */ }
}
