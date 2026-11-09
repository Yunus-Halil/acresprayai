// Field Twins: the pilot's home. Every saved twin, newest first, with what it is (crop, flight, photographs) and
// whether it is whole; a build running in this tab; the way to start a new one.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Loader2, Pencil, Plus, Shapes, Trash2 } from "lucide-react";
import { toast } from "sonner";
import Seo from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import { type TwinRecord, deleteTwin, effectiveStatus, listTwinRecords, renameTwin } from "@/lib/fieldTwin/registry";
import { sessionBusy, useBuildSession } from "@/lib/fieldTwin/buildSession";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtArea } from "@/lib/units";
import { track } from "@/lib/pilot/telemetry";
import { useReviewCounts } from "@/lib/fieldTwin/reviews";

const CROP: Record<string, string> = { corn: "Corn", orchard: "Orchard" };
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null);

function StatusChip({ status }: { status: TwinRecord["status"] }) {
  if (status === "ready") return null;
  if (status === "saving") return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900"><Loader2 className="h-3 w-3 animate-spin" />Saving</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-900"><AlertTriangle className="h-3 w-3" />Not saved completely</span>;
}

export default function TwinsHome() {
  const { user } = useAuth();
  const nav = useNavigate();
  const units = useUnitSystem();
  const session = useBuildSession();
  const [records, setRecords] = useState<TwinRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<TwinRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const reviews = useReviewCounts(records?.map(r => r.id) ?? []);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try { setRecords(await listTwinRecords(user.id)); } catch { setError("Your Field Twins could not be loaded. Check your connection and try again."); }
  }, [user]);
  useEffect(() => { void load(); }, [load]);
  // A save finishing in this tab updates the list.
  useEffect(() => { if (session.status === "saved" || session.status === "saving") void load(); }, [session.status, load]);

  const saveName = async () => {
    if (!renaming) return;
    setBusy(true);
    try { await renameTwin(renaming.id, renaming.name); setRenaming(null); await load(); }
    catch (e) { toast.error("Not renamed", { description: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const confirmDelete = async () => {
    if (!deleting || !user) return;
    setBusy(true);
    try {
      await deleteTwin(user.id, deleting);
      track("twin_deleted", { twinId: deleting.id, outcome: "ok" });
      toast.success(`"${deleting.name}" deleted`);
      setDeleting(null);
      await load();
    } catch (e) {
      toast.error("Not deleted", { description: `${(e as Error).message}. Nothing was removed from the list; try again.` });
    } finally { setBusy(false); }
  };

  const building = session.status !== "saved" && session.status !== "cancelled";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 sm:p-10">
      <Seo title="Field Twins, Swardus" noindex />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Founding pilot</div>
          <h1 className="font-display text-3xl">Field Twins</h1>
        </div>
        <Button onClick={() => nav("/app/twins/new")} disabled={sessionBusy(session)}><Plus className="h-4 w-4" />New Field Twin</Button>
      </header>

      {session.status !== "idle" && building && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <span>
            {session.status === "building" ? <>Building <span className="font-medium">{session.name}</span>. Keep this tab open.</>
              : session.status === "saving" ? <>Saving <span className="font-medium">{session.name}</span> to your account. Keep this tab open.</>
              : session.status === "save-failed" ? <><span className="font-medium">{session.name}</span> was built but did not save.</>
              : <>The build of <span className="font-medium">{session.name}</span> stopped.</>}
          </span>
          <Button size="sm" variant="outline" asChild><Link to="/app/twins/new">See progress</Link></Button>
        </div>
      )}

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}<Button size="sm" variant="outline" onClick={() => void load()}>Try again</Button>
        </div>
      )}

      {records == null && !error ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>
      ) : records && records.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <Shapes className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-3 font-display text-xl">Your first Field Twin</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
            Pick the photographs from one drone flight over a corn field or an orchard. Swardus builds a map of the field from them, with the crop rows, what departs from the planting, and the photographs behind every finding for you to check.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={() => nav("/app/twins/new")} disabled={sessionBusy(session)}><Plus className="h-4 w-4" />New Field Twin</Button>
            <Button variant="outline" asChild><Link to="/app/help">Which photographs work</Link></Button>
          </div>
        </div>
      ) : records ? (
        <ul className="divide-y rounded-lg border bg-card" aria-label="Your Field Twins">
          {records.map(r => {
            const status = effectiveStatus(r);
            const facts = [CROP[r.crop ?? ""], fmtDay(r.captured_at) && `flown ${fmtDay(r.captured_at)}`, r.photographs != null && `${r.photographs.toLocaleString()} photographs`, r.area_ha != null && fmtArea(r.area_ha * 10_000, units).text].filter(Boolean);
            const rc = reviews.get(r.id);
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  {renaming?.id === r.id ? (
                    <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void saveName(); }}>
                      <Input autoFocus value={renaming.name} onChange={e => setRenaming({ ...renaming, name: e.target.value })} aria-label="Field Twin name" className="max-w-sm" />
                      <Button size="sm" type="submit" disabled={busy}>Save</Button>
                      <Button size="sm" type="button" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                    </form>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {status === "ready"
                        ? <Link to={`/app/twins/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                        : <span className="font-medium">{r.name}</span>}
                      <StatusChip status={status} />
                    </div>
                  )}
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    {facts.length ? facts.join(" · ") : `Saved ${fmtDay(r.created_at)}`}
                    {rc && rc.reviewed > 0 && <> · {rc.reviewed.toLocaleString()} finding{rc.reviewed === 1 ? "" : "s"} reviewed</>}
                  </div>
                  {status === "incomplete" && <p className="mt-1 text-xs text-muted-foreground">Some of its files did not reach your account{r.error ? ` (${r.error})` : ""}. It cannot be opened; delete it and build it again from the photographs.</p>}
                </div>
                <div className="flex items-center gap-1">
                  {status === "ready" && <Button size="sm" asChild><Link to={`/app/twins/${r.id}`}>Open</Link></Button>}
                  <Button size="sm" variant="ghost" onClick={() => setRenaming({ id: r.id, name: r.name })} aria-label={`Rename ${r.name}`}><Pencil className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(r)} aria-label={`Delete ${r.name}`} disabled={session.status !== "idle" && session.record?.id === r.id && sessionBusy(session)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <AlertDialog open={!!deleting} onOpenChange={o => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>The Field Twin, its photograph crops and your reviews of its findings are removed from your account. This cannot be undone. Your original photographs are not affected.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={e => { e.preventDefault(); void confirmDelete(); }} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
