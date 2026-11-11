// The one screen a participant sees before the app (first visit, and again after a change of terms): what the pilot
// is, what is saved and who sees it, one optional choice, one button. Also the page where that choice is changed later
// and the access history is read (/app/consent).
//
// Agreeing to the terms is required and is one action. Research use of imagery is a separate choice on the same
// screen: never ticked for the participant, never needed to continue, and never carried over from earlier terms.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type Consent, type ConsentRead, TERMS_VERSION, agreedToCurrent, readConsent, researchChoice, saveConsent } from "@/lib/pilot/consent";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

type AccessRow = { at: string; reason: string | null };

/**
 * Every time Swardus opened one of this person's Field Twins, with the reason given. They can read their own rows and only
 * their own (the admin_access_log policy). A quiet, secondary part of the page: closed until the person opens it,
 * and read from the database only then. Nothing announces an opening; the list is there for whoever looks.
 * A read that fails says so: it must never be shown as "not opened".
 */
function AccessHistory() {
  const [open, setOpen] = useState(false);
  // null: not read yet (or being read). "unread": the read failed.
  const [rows, setRows] = useState<AccessRow[] | "unread" | null>(null);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next || Array.isArray(rows)) return;
    setRows(null);
    supabase.from("admin_access_log" as never).select("at, reason").order("at", { ascending: false }).limit(100)
      .then(({ data, error }) => setRows(error || !data ? "unread" : (data as AccessRow[])), () => setRows("unread"));
  };
  return (
    <section className="border-t pt-1">
      <button type="button" onClick={toggle} aria-expanded={open} aria-controls="access-history" className="flex min-h-[44px] w-full items-start gap-2 py-2 text-left text-sm">
        <ChevronRight className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
        <span><span className="font-medium">Access history</span><span className="block text-muted-foreground">See when Swardus opened your Field Twins.</span></span>
      </button>
      {open && (
        <div id="access-history" className="pb-2 pl-6 text-sm">
          {rows === null ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />
            : rows === "unread" ? <p className="text-muted-foreground">The history could not be read just now. Close this section and open it again to retry.</p>
            : rows.length === 0 ? <p className="text-muted-foreground">Your Field Twins have not been opened.</p>
            : <ul className="space-y-1">{rows.map((r, i) => <li key={i}>{new Date(r.at).toLocaleString()}{r.reason ? `: ${r.reason}` : ""}</li>)}</ul>}
        </div>
      )}
    </section>
  );
}

const RESEARCH_LABEL = "Crops of my photographs, with my reviews of them, may also be used as examples to improve how Swardus reads fields.";

/** The optional research choice. Its own control, never part of the agreement itself. */
function ResearchChoice({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex min-h-[44px] items-start gap-3 rounded-md border p-3">
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>
        <span className="font-medium">Optional. </span>{RESEARCH_LABEL}
        <span className="block text-muted-foreground">Not needed to take part. Nothing is used this way today, and you can change this at any time under Help.</span>
      </span>
    </label>
  );
}

/** The agreement: a short account of the pilot, the optional choice, and the one button. */
export function AgreementForm({ current, onDone, save = saveConsent }: { current: Consent | null; onDone: () => void; /** Where the agreement is recorded (the development preview records nothing). */ save?: typeof saveConsent }) {
  // Off unless ticked here: an answer given under earlier terms is not carried over.
  const [research, setResearch] = useState(false);
  const [saving, setSaving] = useState(false);
  const agree = async () => {
    setSaving(true);
    try { await save({ research_use: research }); onDone(); }
    catch (e) { toast.error("Not saved", { description: `${(e as Error).message}. Check your connection and try again.` }); }
    finally { setSaving(false); }
  };
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">{current
        ? "The terms now say three things they did not say before: Swardus's founder may open your saved Field Twins to evaluate the pilot, with every opening recorded; corn Field Twins keep the build's working data; and research use of imagery is asked again below."
        : "The pilot is free and experimental. You build Field Twins from your own drone photographs, check what Swardus found, and tell us where it was wrong. That is how it improves."}</p>
      <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
        <li>What Swardus shows are observations to check, not advice. It does not recommend treatments, products or rates, and decisions about your field remain yours.</li>
        <li>Your photographs stay on your device. What is saved to your account is the Field Twin: the map with its positions, small crops of your photographs around the findings and, for corn, the build's working data (camera positions and what was read in each photograph, no images). You can delete a Field Twin at any time.</li>
        <li>To run the pilot, Swardus's founder sees your reviews, your feedback and how the app performed for you, and may open your saved Field Twins to evaluate results and look into problems. Every opening is recorded, and you can see the list under Help.</li>
      </ul>
      <ResearchChoice checked={research} onChange={setResearch} />
      <p className="text-xs text-muted-foreground">By continuing you agree to the <Link to="/pilot-terms" target="_blank" className="underline underline-offset-4">pilot terms and privacy notice</Link> (version {TERMS_VERSION}).</p>
      <Button size="lg" className="min-h-[44px] w-full sm:w-auto" onClick={() => void agree()} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Agree &amp; Continue</Button>
    </div>
  );
}

export function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6">
      <div className="w-full max-w-lg space-y-4 rounded-lg border bg-card p-6 shadow-sm sm:p-8">
        <h1 className="font-display text-2xl">{title}</h1>
        {children}
      </div>
    </div>
  );
}

/**
 * Wraps the app for a participant: nothing behind it is shown until their newest agreement is to the terms in force.
 * The founder is not asked. An agreement that cannot be read is never taken for "agreed", and never for "not yet
 * agreed" either: the screen says it could not check, and tries again.
 */
export function ConsentGate({ required, children }: { required: boolean; children: React.ReactNode }) {
  const [read, setRead] = useState<ConsentRead | null>(null);
  const [agreed, setAgreed] = useState(false);
  const check = useCallback(() => { setRead(null); void readConsent().then(setRead); }, []);
  useEffect(() => { if (required) check(); }, [required, check]);
  // The table not there yet (a database not updated for the pilot): do not lock the participant out over it.
  if (!required || agreed || read?.status === "unavailable" || (read?.status === "agreed" && agreedToCurrent(read.consent))) return <>{children}</>;
  if (!read) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  if (read.status === "unread") {
    return (
      <Screen title="We could not open Swardus">
        <p className="text-sm text-muted-foreground">We could not check your pilot agreement. Check your connection and try again.</p>
        <Button onClick={check}>Try again</Button>
      </Screen>
    );
  }
  const earlier = read.status === "agreed" ? read.consent : null;
  return (
    <Screen title={earlier ? "The pilot terms have changed" : "Welcome to the Swardus founding pilot"}>
      <AgreementForm current={earlier} onDone={() => setAgreed(true)} />
    </Screen>
  );
}

/** /app/consent: the optional choice, changed later, and the access history. */
export default function ConsentPage() {
  const { user } = useAuth();
  const [read, setRead] = useState<ConsentRead | null>(null);
  const [research, setResearch] = useState(false);
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => { setRead(null); void readConsent().then(r => { setRead(r); setResearch(researchChoice(r.status === "agreed" ? r.consent : null)); }); }, []);
  useEffect(() => { load(); }, [load, user?.id]);
  const current = read?.status === "agreed" && agreedToCurrent(read.consent) ? read.consent : null;
  const save = async () => {
    setSaving(true);
    try { await saveConsent({ research_use: research }); toast.success("Your choice is saved"); load(); }
    catch (e) { toast.error("Not saved", { description: (e as Error).message }); }
    finally { setSaving(false); }
  };
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6 sm:p-10">
      <h1 className="font-display text-3xl">Your data choices</h1>
      {!read ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
        : read.status === "unread" ? <div className="space-y-3 text-sm"><p className="text-muted-foreground">Your choices could not be read just now. Check your connection and try again.</p><Button variant="outline" onClick={load}>Try again</Button></div>
        : current ? (
          <div className="space-y-4 text-sm">
            <ResearchChoice checked={research} onChange={setResearch} />
            <Button className="min-h-[44px]" onClick={() => void save()} disabled={saving || research === current.research_use}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Save my choice</Button>
            <p className="text-muted-foreground">Under the <Link to="/pilot-terms" target="_blank" className="underline underline-offset-4">pilot terms</Link> you agreed to (version {current.terms_version}), Swardus's founder may open your saved Field Twins to evaluate the pilot and look into problems. Every opening is listed below. To end that, write to us or leave the pilot.</p>
          </div>
        ) : <p className="text-sm text-muted-foreground">There is nothing to choose for this account.</p>}
      <AccessHistory />
    </div>
  );
}
