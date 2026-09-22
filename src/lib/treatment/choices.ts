// Reads and writes of `treatment_choices`: the operator's product and the
// label they verified for it. Owner-scoped rows; nothing here is shared.
import { supabase } from "@/integrations/supabase/client";
import type { TreatmentChoice } from "./quantities";

const COLS = "id, weed_catalog_id, weed_label, product_name, epa_reg_no, label_source, label_checked_on, label_crop, application_method, restrictions, rate_value, rate_unit, carrier_volume_value, carrier_unit, label_verified, notes";

const fromRow = (r: Record<string, unknown>): TreatmentChoice => ({
  id: String(r.id),
  weed_catalog_id: (r.weed_catalog_id as string | null) ?? null,
  weed_label: (r.weed_label as string | null) ?? null,
  product_name: String(r.product_name ?? ""),
  epa_reg_no: (r.epa_reg_no as string | null) ?? null,
  label_source: (r.label_source as string | null) ?? null,
  label_checked_on: (r.label_checked_on as string | null) ?? null,
  label_crop: (r.label_crop as string | null) ?? null,
  application_method: (r.application_method as string | null) ?? null,
  restrictions: (r.restrictions as string | null) ?? null,
  rate_value: r.rate_value == null ? null : Number(r.rate_value),
  rate_unit: (r.rate_unit as string | null) ?? null,
  carrier_volume_value: r.carrier_volume_value == null ? null : Number(r.carrier_volume_value),
  carrier_unit: (r.carrier_unit as string | null) ?? null,
  label_verified: r.label_verified === true,
  notes: (r.notes as string | null) ?? null,
});

/** Every choice the operator has saved, newest first. */
export async function listTreatmentChoices(): Promise<TreatmentChoice[]> {
  const { data, error } = await supabase.from("treatment_choices")
    .select(COLS)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(fromRow);
}

export type TreatmentChoiceInput = Omit<TreatmentChoice, "id"> & { field_id: string | null };

export async function saveTreatmentChoice(userId: string, input: TreatmentChoiceInput, id?: string): Promise<{ ok: true; choice: TreatmentChoice } | { ok: false; error: string }> {
  const row = {
    user_id: userId,
    field_id: input.field_id,
    weed_catalog_id: input.weed_catalog_id,
    weed_label: input.weed_label?.trim() || null,
    product_name: input.product_name.trim(),
    epa_reg_no: input.epa_reg_no?.trim() || null,
    label_source: input.label_source?.trim() || null,
    label_checked_on: input.label_checked_on || null,
    label_crop: input.label_crop?.trim() || null,
    application_method: input.application_method?.trim() || null,
    restrictions: input.restrictions?.trim() || null,
    rate_value: input.rate_value,
    rate_unit: input.rate_unit,
    carrier_volume_value: input.carrier_volume_value,
    carrier_unit: input.carrier_volume_value != null ? input.carrier_unit : null,
    label_verified: input.label_verified,
    notes: input.notes?.trim() || null,
  };
  const q = id
    ? supabase.from("treatment_choices").update(row as never).eq("id", id).select(COLS).single()
    : supabase.from("treatment_choices").insert(row as never).select(COLS).single();
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, choice: fromRow(data as unknown as Record<string, unknown>) };
}

export async function deleteTreatmentChoice(id: string): Promise<string | null> {
  const { error } = await supabase.from("treatment_choices").delete().eq("id", id);
  return error ? error.message : null;
}
