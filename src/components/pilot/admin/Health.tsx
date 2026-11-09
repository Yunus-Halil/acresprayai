// System health: what the founder must fix for the pilot to work, read live from the server (sign-ups, email
// confirmation, email sending, the database, stray accounts, stuck saves, unread feedback).
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp, Loader2, OctagonX, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pilotAdmin } from "@/lib/pilot/adminClient";
import { Section } from "./ui";

export type Check = { id: string; label: string; status: "ok" | "warn" | "fail" | "unknown"; detail: string };

const ICON = {
  ok: <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-label="ok" />,
  warn: <AlertTriangle className="h-5 w-5 text-amber-600" aria-label="warning" />,
  fail: <OctagonX className="h-5 w-5 text-destructive" aria-label="needs fixing" />,
  unknown: <CircleHelp className="h-5 w-5 text-muted-foreground" aria-label="unknown" />,
};
const WORD = { ok: "OK", warn: "Check", fail: "Fix", unknown: "Unknown" };

export function HealthSection() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setChecks((await pilotAdmin<{ checks: Check[] }>("health")).checks); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const order = { fail: 0, warn: 1, unknown: 2, ok: 3 };
  return (
    <Section title="System health" hint="Read live from the server. Fix the red ones before inviting anyone; the steps are in docs/operations/pilot-access.md."
      actions={<Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Check again</Button>}>
      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {!checks && !error && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {checks && (
        <ul className="divide-y rounded-md border bg-card">
          {[...checks].sort((a, b) => order[a.status] - order[b.status]).map(c => (
            <li key={c.id} className="flex items-start gap-3 px-4 py-3 text-sm">
              {ICON[c.status]}
              <div><div className="font-medium">{c.label} <span className="ml-1 text-xs font-normal text-muted-foreground">{WORD[c.status]}</span></div><div className="text-muted-foreground">{c.detail}</div></div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
