// The participant's agreement to the pilot terms and their one optional choice (public.pilot_consents). Each
// change is a new row; the newest is in force. A new TERMS_VERSION asks everyone again.
//
// What an agreement row means, by the version it was given under:
//
//   pilot-2026-11-v1   two optional choices: troubleshooting access (the founder may open their Field Twins) and
//                      research use. Both were the participant's own ticks.
//   pilot-2026-11-v2   the terms themselves say the founder may open the participant's saved Field Twins to evaluate
//                      the pilot and look into problems, every opening recorded where the participant can read it.
//                      Agreeing to them is what allows it, so the row is written with that access on. Research use
//                      of imagery stays a separate choice, off unless ticked.
//
// The server opens a participant's twin only when their newest row has `troubleshooting_access` (pilot-admin,
// openTwin). The column keeps its first name; under v2 it reads "the founder may open this participant's Field
// Twins". A participant who agreed to v1 keeps exactly what they chose there until they agree to v2 themselves.
import { supabase } from "@/integrations/supabase/client";

/** Bump when the terms change in substance; participants are asked again. */
export const TERMS_VERSION = "pilot-2026-11-v2";
/** False until the founder has approved the wording (docs/operations/pilot-access.md): the terms page says it is a draft. */
export const TERMS_APPROVED = false;

export type Consent = { terms_version: string; troubleshooting_access: boolean; research_use: boolean; created_at: string };

/** The newest agreement as it was read: there, not there, could not be read, or the table is not in this database yet. */
export type ConsentRead = { status: "agreed"; consent: Consent } | { status: "none" } | { status: "unread" } | { status: "unavailable" };

export async function readConsent(): Promise<ConsentRead> {
  try {
    const { data, error } = await supabase.from("pilot_consents").select("terms_version, troubleshooting_access, research_use, created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) return /does not exist|PGRST205|schema cache/i.test(`${error.code ?? ""} ${error.message}`) ? { status: "unavailable" } : { status: "unread" };
    return data ? { status: "agreed", consent: data as Consent } : { status: "none" };
  } catch { return { status: "unread" }; }
}

/** The newest agreement, or null when there is none or it could not be read (callers that only act on a positive answer). */
export async function loadConsent(): Promise<Consent | null | "unavailable"> {
  const r = await readConsent();
  return r.status === "agreed" ? r.consent : r.status === "unavailable" ? "unavailable" : null;
}

/** Whether a participant with this newest agreement is through to the app: they agreed to the terms in force. */
export const agreedToCurrent = (c: Consent | null): boolean => !!c && c.terms_version === TERMS_VERSION;

/**
 * The research choice to show: what the participant chose under the terms in force, and otherwise off. A choice made
 * under earlier terms is never carried over: it was an answer to a different question.
 */
export const researchChoice = (c: Consent | null): boolean => (agreedToCurrent(c) ? c!.research_use : false);

/**
 * Record agreement to the terms in force, with the research choice. Agreeing is what lets the founder open the
 * participant's Field Twins (see the top of this file), so the row always says so.
 */
export async function saveConsent(choices: { research_use: boolean }): Promise<void> {
  const { error } = await supabase.from("pilot_consents").insert({ terms_version: TERMS_VERSION, troubleshooting_access: true, research_use: choices.research_use } as never);
  if (error) throw new Error(error.message);
}
