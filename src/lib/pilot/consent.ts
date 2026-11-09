// The participant's agreement to the pilot terms and their two optional choices (public.pilot_consents). Each
// change is a new row; the newest is in force. A new TERMS_VERSION asks everyone again.
import { supabase } from "@/integrations/supabase/client";

/** Bump when the terms change in substance; participants are asked again. */
export const TERMS_VERSION = "pilot-2026-11-v1";
/** False until the founder has approved the wording (docs/operations/pilot-access.md): the terms page says it is a draft. */
export const TERMS_APPROVED = false;

export type Consent = { terms_version: string; troubleshooting_access: boolean; research_use: boolean; created_at: string };

export async function loadConsent(): Promise<Consent | null | "unavailable"> {
  const { data, error } = await supabase.from("pilot_consents").select("terms_version, troubleshooting_access, research_use, created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return /does not exist|PGRST205|schema cache/i.test(`${error.code ?? ""} ${error.message}`) ? "unavailable" : null;
  return (data as Consent | null) ?? null;
}

export async function saveConsent(choices: { troubleshooting_access: boolean; research_use: boolean }): Promise<void> {
  const { error } = await supabase.from("pilot_consents").insert({ terms_version: TERMS_VERSION, ...choices } as never);
  if (error) throw new Error(error.message);
}
