// First visit (and after a change of terms): the pilot terms in brief, the two optional choices, agree and continue.
// Also the page where those choices are changed later (/app/consent).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type Consent, TERMS_VERSION, loadConsent, saveConsent } from "@/lib/pilot/consent";
import { supabase } from "@/integrations/supabase/client";

type AccessRow = { at: string; reason: string | null };

/**
 * Every time Swardus opened one of this person's Field Twins to troubleshoot. They can read their own rows and only
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
        <span><span className="font-medium">Access history</span><span className="block text-muted-foreground">See when your Field Twins were opened for troubleshooting.</span></span>
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

export function ConsentForm({ current, onDone, change = false }: { current: Consent | null; onDone: () => void; change?: boolean }) {
  const [troubleshooting, setTroubleshooting] = useState(current?.troubleshooting_access ?? false);
  const [research, setResearch] = useState(current?.research_use ?? false);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await saveConsent({ troubleshooting_access: troubleshooting, research_use: research }); onDone(); }
    catch (e) { toast.error("Not saved", { description: (e as Error).message }); }
    finally { setSaving(false); }
  };
  return (
    <div className="space-y-4 text-sm">
      {!change && (
        <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
          <li>This is an early version. What Swardus shows are observations to check, not advice: decisions about your field remain yours.</li>
          <li>Your photographs stay on your computer. Your Field Twins are saved privately in your account, and you can delete them at any time.</li>
          <li>We record how the app is used (what ran, how long it took, errors) to improve it. No photographs, file names or field locations.</li>
        </ul>
      )}
      <label className="flex items-start gap-3 rounded-md border p-3">
        <input type="checkbox" className="mt-1" checked={troubleshooting} onChange={e => setTroubleshooting(e.target.checked)} />
        <span><span className="font-medium">Let Swardus open my Field Twins to troubleshoot</span><span className="block text-muted-foreground">Optional. Without it, we look only at what you send us.</span></span>
      </label>
      <label className="flex items-start gap-3 rounded-md border p-3">
        <input type="checkbox" className="mt-1" checked={research} onChange={e => setResearch(e.target.checked)} />
        <span><span className="font-medium">Let my photograph crops and reviews help improve Swardus</span><span className="block text-muted-foreground">Optional. Never shared outside Swardus without asking you first.</span></span>
      </label>
      <p className="text-xs text-muted-foreground">The full <Link to="/pilot-terms" target="_blank" className="underline underline-offset-4">pilot terms and privacy notice</Link> (version {TERMS_VERSION}). You can change these choices at any time from Help.</p>
      <Button onClick={() => void save()} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}{change ? "Save my choices" : "I agree, continue"}</Button>
    </div>
  );
}

/** Wraps the app for a participant: asks once per terms version. The founder is not asked. */
export function ConsentGate({ required, children }: { required: boolean; children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "needed" | "ok">(required ? "loading" : "ok");
  const [current, setCurrent] = useState<Consent | null>(null);
  useEffect(() => {
    if (!required) return;
    let live = true;
    loadConsent().then(c => {
      if (!live) return;
      // The table not there yet (database not updated): do not lock the participant out over it.
      if (c === "unavailable") { setState("ok"); return; }
      setCurrent(c);
      setState(c && c.terms_version === TERMS_VERSION ? "ok" : "needed");
    }, () => { if (live) setState("needed"); });
    return () => { live = false; };
  }, [required]);
  if (state === "ok") return <>{children}</>;
  if (state === "loading") return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg space-y-4 rounded-lg border bg-card p-8 shadow-sm">
        <h1 className="font-display text-2xl">{current ? "The pilot terms have changed" : "Welcome to the Swardus pilot"}</h1>
        <ConsentForm current={current} onDone={() => setState("ok")} />
      </div>
    </div>
  );
}

/** /app/consent: change the two choices later. */
export default function ConsentPage() {
  const [current, setCurrent] = useState<Consent | null | undefined>(undefined);
  useEffect(() => { void loadConsent().then(c => setCurrent(c === "unavailable" ? null : c)); }, []);
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6 sm:p-10">
      <h1 className="font-display text-3xl">Your data choices</h1>
      {current === undefined ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <ConsentForm current={current} change onDone={() => toast.success("Your choices are saved")} />}
      <AccessHistory />
    </div>
  );
}
