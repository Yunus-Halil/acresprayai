// Who gets an analysis record (analysis.ts) beside their corn Field Twins, and the one place the app asks the device
// to send the records still waiting on it (analysisOutbox.ts).
//
// The founder's own account: yes. A participant: only under approved pilot terms that say what the record is, and
// only once that participant has agreed to those terms. No version of the terms says so yet
// (TERMS_DISCLOSING_ANALYSIS is empty), so today no participant's build makes one and none of their choices is read.
//
// This decides what the app does, as everything in the browser does; it guards a disclosure, not the data. The record
// only ever goes to the signed-in account's own folder, which the storage rules enforce whatever the app thinks.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePilot } from "@/lib/pilot/access";
import { TERMS_APPROVED, TERMS_VERSION, loadConsent } from "@/lib/pilot/consent";
import { TERMS_DISCLOSING_ANALYSIS, TWIN_ANALYSIS_ENABLED } from "./analysisConfig";
import { flushAnalysisOutbox, forgetAccountPending } from "./analysisOutbox";
import { sessionBusy } from "./buildSession";

export type TermsInForce = { version: string; approved: boolean; disclosing: readonly string[] };
const IN_FORCE: TermsInForce = { version: TERMS_VERSION, approved: TERMS_APPROVED, disclosing: TERMS_DISCLOSING_ANALYSIS };

/** Whether any participant could be allowed under these terms (false: their choices need not even be read). */
export const openToParticipants = (terms: TermsInForce = IN_FORCE, enabled: boolean = TWIN_ANALYSIS_ENABLED): boolean =>
  enabled && terms.approved && terms.disclosing.includes(terms.version);

/** Whether builds by this account make and save the record. `agreedTerms` is the version the participant last agreed to. */
export function analysisAllowed(who: { serverRole: "founder" | "participant"; agreedTerms: string | null }, terms: TermsInForce = IN_FORCE, enabled: boolean = TWIN_ANALYSIS_ENABLED): boolean {
  if (!enabled) return false;
  if (who.serverRole === "founder") return true;
  return openToParticipants(terms, enabled) && who.agreedTerms === terms.version;
}

/**
 * The same for the signed-in account. The founder previewing the participant experience is still the founder's own
 * account and data. False until known, and false when a participant's agreement could not be read.
 */
export function useAnalysisAllowed(terms: TermsInForce = IN_FORCE): boolean {
  const { access } = usePilot();
  const serverRole = access.status === "member" ? access.serverRole : null;
  const ask = serverRole === "participant" && openToParticipants(terms);
  const [agreed, setAgreed] = useState<string | null>(null);
  useEffect(() => {
    if (!ask) { setAgreed(null); return; }
    let live = true;
    loadConsent().then(c => { if (live) setAgreed(c && c !== "unavailable" ? c.terms_version : null); }, () => { if (live) setAgreed(null); });
    return () => { live = false; };
  }, [ask]);
  return serverRole !== null && analysisAllowed({ serverRole, agreedTerms: agreed }, terms);
}

/** How long after the app opens the waiting records are looked at (the page's own loading goes first). */
const SETTLE_MS = 4_000;

/**
 * For the signed-in app: send this account's waiting records a little after the app opens, and whenever the
 * connection comes back. Nothing happens for an account that gets no record, and nothing while a build is running or
 * saving in this tab. When the account signs out, what still waits for it on this device is removed.
 */
export function useAnalysisOutbox(userId: string | null | undefined): void {
  const allowed = useAnalysisAllowed();
  useEffect(() => {
    if (!allowed || !userId) return;
    const go = () => { if (!sessionBusy()) void flushAnalysisOutbox(userId); };
    const timer = setTimeout(go, SETTLE_MS);
    window.addEventListener("online", go);
    const { data } = supabase.auth.onAuthStateChange(event => { if (event === "SIGNED_OUT") void forgetAccountPending(userId); });
    return () => { clearTimeout(timer); window.removeEventListener("online", go); data.subscription.unsubscribe(); };
  }, [allowed, userId]);
}
