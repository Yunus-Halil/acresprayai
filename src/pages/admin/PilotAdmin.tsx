// The founder's pilot admin panel: everything about the pilot in one place, from one snapshot of first-party
// records (pilot-admin "snapshot"), refreshed every two minutes while open. Founder only, here and on the server.
//   /admin/pilot?tab=overview|people|builds|twins|reviews|feedback|errors|access|invites|health
//   /admin/pilot/people/:id    one person
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import Seo from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { pilotAdmin } from "@/lib/pilot/adminClient";
import { type Snapshot, errorGroups } from "@/lib/pilot/adminData";
import { cn } from "@/lib/utils";
import { AccessSection, BuildsSection, ErrorsSection, FeedbackSection, OverviewSection, ReviewsSection, TwinsSection } from "@/components/pilot/admin/sections";
import { PeopleSection, PersonDetail } from "@/components/pilot/admin/People";
import { InvitesSection } from "@/components/pilot/admin/Invites";
import { HealthSection } from "@/components/pilot/admin/Health";
import { ago } from "@/components/pilot/admin/ui";

export const TABS = [
  ["overview", "Overview"], ["people", "People"], ["builds", "Builds"], ["twins", "Field Twins"], ["reviews", "Reviews"],
  ["feedback", "Feedback"], ["errors", "Errors"], ["access", "Data access"], ["invites", "Invites & applications"], ["health", "System health"],
] as const;
type Tab = (typeof TABS)[number][0];
const REFRESH_MS = 120_000;

export default function PilotAdmin() {
  const [params, setParams] = useSearchParams();
  const { id: personId } = useParams();
  const nav = useNavigate();
  const tab: Tab = personId ? "people" : ((TABS.map(t => t[0]) as string[]).includes(params.get("tab") ?? "") ? params.get("tab") as Tab : "overview");
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSnap(await pilotAdmin<Snapshot>("snapshot")); setError(null); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); setTick(n => n + 1); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const open = (t: string) => { if (personId) nav(`/admin/pilot?tab=${t}`); else setParams({ tab: t }); };
  const counts: Partial<Record<Tab, number>> = snap ? {
    feedback: snap.feedback.filter(f => f.status === "new").length,
    errors: errorGroups(snap).length,
    people: snap.members.filter(m => m.role === "participant").length,
  } : {};
  const missing = snap ? Object.entries(snap.missing).filter(([, v]) => v).map(([k]) => k) : [];

  return (
    <div className="min-h-screen bg-background">
      <Seo title="Pilot admin, Swardus" noindex />
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Founding pilot</div>
            <h1 className="font-display text-2xl">Pilot admin</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{snap ? `Updated ${ago(snap.generated_at)}` : ""}</span>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Refresh</Button>
            <Button variant="ghost" size="sm" asChild><Link to="/app">Back to Swardus</Link></Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6" aria-label="Admin sections">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" onClick={() => open(id)} aria-current={tab === id ? "page" : undefined}
              className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", tab === id ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {label}{counts[id] ? <span className={cn("ml-1.5 rounded-full px-1.5 text-[11px]", id === "people" ? "bg-muted" : "bg-amber-200 text-amber-950")}>{counts[id]}</span> : null}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}{snap ? " (showing the last loaded data)" : ""}</p>}
        {missing.length > 0 && <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">The database is not fully updated for the pilot (missing: {missing.join(", ")}). Apply the pilot migrations; see System health.</p>}
        {tab === "health" ? <HealthSection />
          : !snap ? (!error && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>)
          : personId ? <PersonDetail snap={snap} userId={personId} onChanged={() => void load()} />
          : tab === "overview" ? <OverviewSection snap={snap} onOpenTab={open} />
          : tab === "people" ? <PeopleSection snap={snap} />
          : tab === "builds" ? <BuildsSection snap={snap} />
          : tab === "twins" ? <TwinsSection snap={snap} />
          : tab === "reviews" ? <ReviewsSection snap={snap} />
          : tab === "feedback" ? <FeedbackSection snap={snap} onChanged={() => void load()} />
          : tab === "errors" ? <ErrorsSection snap={snap} />
          : tab === "access" ? <AccessSection snap={snap} />
          : <InvitesSection snap={snap} onChanged={() => void load()} />}
      </main>
    </div>
  );
}
