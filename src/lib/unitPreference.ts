// The account's unit system, on the profile row.
//
// The store in hooks/useUnitSystem.ts is what every screen reads, and it is
// deliberately synchronous and storage-free so it can be tested without a
// network. This module is the one place that talks to the database about it:
// read the profile once at sign-in, write it whenever the choice changes. Kept
// apart from the hook so the hook never imports the Supabase client.
import { supabase } from "@/integrations/supabase/client";
import type { UnitSystem } from "./units";

const isSystem = (v: unknown): v is UnitSystem => v === "metric" || v === "imperial";

/** The saved choice, or null when this account has never made one. */
export async function loadUnitPreference(userId: string): Promise<UnitSystem | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("unit_system")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return isSystem(data?.unit_system) ? data.unit_system : null;
}

/** Best-effort. A failed write leaves the browser's copy in place; nothing else depends on it. */
export async function saveUnitPreference(userId: string, sys: UnitSystem): Promise<boolean> {
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, unit_system: sys }, { onConflict: "id" });
  if (error) console.error("[units] could not save preference:", error.message);
  return !error;
}
