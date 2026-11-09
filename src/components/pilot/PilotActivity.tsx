// The founder's view of how the pilot goes, on the pilot desk: who is using Swardus, which builds worked and which
// did not (and where), what participants said about findings, and their feedback. From pilot-admin's "activity";
// no imagery, no paths.
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { pilotAdmin } from "@/lib/pilot/adminClient";

type Person = { user_id: string; name: string; organisation: string | null; role: string; status: string; last_sign_in_at: string | null; last_active_at: string | null; sessions: number; twins: number; twins_incomplete: number; builds_ok: number; builds_failed: number; builds_cancelled: number; saves_failed: number; median_build_ms: number | null; reviews: number; errors: number };
type Build = { at: string; who: string; outcome: string; duration_ms: number | null; photographs: number | null; used: number | null; refused: number | null; crop: string | null; camera: string | null; stage: string | null; error: string | null };
type Activity = {
  people: Person[]; builds: Build[];
  checks: { at: string; who: string; files?: number; usable?: number; stops?: number; warnings?: number; camera: string | null }[];
  errors: { at: string; who: string; name: string; error: string | null }[];
  reviews: { total: number; byKind: Record<string, { correct: number; unsure: number; wrong: number }>; notes: { at: string; who: string; twin: string; kind: string; status: string | null; verdict: string; note: string }[] };
  feedback: { id: string; created_at: string; who: string; kind: string; message: string; route: string | null; twin: string | null; status: string }[];
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");
const mins = (ms: number | null) => (ms == null ? "" : ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : `${Math.round(ms / 1000)} s`);
const th = "whitespace-nowrap px-3 py-2 text-left font-medium";
const td = "px-3 py-2 align-top";

function Table({ head, children, min = 720 }: { head: string[]; children: React.ReactNode; min?: number }) {
  return (
    <div className="overflow-x-auto rounded border">
      <table className="w-full border-collapse text-sm" style={{ minWidth: min }}>
        <thead><tr className="border-b bg-muted/50">{head.map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody className="[&_tr]:border-b [&_tr:last-child]:border-0">{children}</tbody>
      </table>
    </div>
  );
}

export default function PilotActivity() {
  const [data, setData] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await pilotAdmin<Activity>("activity")); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const mark = async (id: string, status: "seen" | "done") => {
    try { await pilotAdmin("feedback-status", { id, status }); void load(); } catch (e) { toast.error("Not changed", { description: (e as Error).message }); }
  };

  const participants = data?.people.filter(p => p.role === "participant") ?? [];
  const newFeedback = data?.feedback.filter(f => f.status === "new").length ?? 0;

  return (
    <section className="space-y-6" aria-label="Pilot activity">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl">How the pilot is going</h2>
          <p className="text-sm text-muted-foreground">The last 90 days. Counts, timings, errors, reviews and feedback only: no photographs or field locations.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Refresh</Button>
      </div>
      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {!data && !error && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {data && (
        <>
          <div>
            <h3 className="mb-2 font-medium">Participants</h3>
            {participants.length === 0 ? <p className="text-sm text-muted-foreground">Nobody has been invited yet.</p> : (
              <Table head={["Who", "Last signed in", "Last active", "Days used", "Field Twins", "Builds ok / failed / cancelled", "Typical build", "Reviews", "Errors"]} min={900}>
                {participants.map(p => (
                  <tr key={p.user_id}>
                    <td className={td}><div>{p.name}</div><div className="text-xs text-muted-foreground">{p.organisation ?? ""}{p.status !== "active" ? ` · ${p.status}` : ""}</div></td>
                    <td className={td}>{when(p.last_sign_in_at)}</td>
                    <td className={td}>{when(p.last_active_at)}</td>
                    <td className={td}>{p.sessions}</td>
                    <td className={td}>{p.twins}{p.twins_incomplete ? <span className="text-amber-700"> (+{p.twins_incomplete} not saved)</span> : null}</td>
                    <td className={td}>{p.builds_ok} / <span className={p.builds_failed ? "text-destructive" : ""}>{p.builds_failed}</span> / {p.builds_cancelled}{p.saves_failed ? <span className="text-destructive"> · {p.saves_failed} saves failed</span> : null}</td>
                    <td className={td}>{mins(p.median_build_ms)}</td>
                    <td className={td}>{p.reviews}</td>
                    <td className={td}><span className={p.errors ? "text-destructive" : ""}>{p.errors}</span></td>
                  </tr>
                ))}
              </Table>
            )}
          </div>

          <div>
            <h3 className="mb-2 font-medium">Feedback {newFeedback ? <span className="ml-1 rounded-full bg-amber-200 px-2 text-xs text-amber-950">{newFeedback} new</span> : null}</h3>
            {data.feedback.length === 0 ? <p className="text-sm text-muted-foreground">No feedback yet.</p> : (
              <ul className="space-y-2">
                {data.feedback.map(f => (
                  <li key={f.id} className={`rounded-md border p-3 text-sm ${f.status === "new" ? "border-amber-300 bg-amber-50/60" : ""}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{f.who} · {when(f.created_at)} · {f.kind}{f.twin ? ` · ${f.twin}` : ""}{f.route ? ` · ${f.route}` : ""}</span>
                      <span className="flex gap-1">
                        {f.status === "new" && <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => void mark(f.id, "seen")}>Seen</Button>}
                        {f.status !== "done" && <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => void mark(f.id, "done")}>Done</Button>}
                        {f.status === "done" && <span>done</span>}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">{f.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-2 font-medium">Builds</h3>
            {data.builds.length === 0 ? <p className="text-sm text-muted-foreground">No builds yet.</p> : (
              <Table head={["When", "Who", "Result", "Time", "Photographs (used / left out)", "Crop", "Camera", "Where it stopped"]} min={900}>
                {data.builds.map((b, i) => (
                  <tr key={i}>
                    <td className={td}>{when(b.at)}</td><td className={td}>{b.who}</td>
                    <td className={td}><span className={b.outcome === "failed" ? "text-destructive" : ""}>{b.outcome}</span></td>
                    <td className={td}>{mins(b.duration_ms)}</td>
                    <td className={td}>{b.photographs ?? ""}{b.used != null ? ` (${b.used} / ${b.refused ?? 0})` : ""}</td>
                    <td className={td}>{b.crop ?? ""}</td><td className={td}>{b.camera ?? ""}</td>
                    <td className={td}>{b.outcome === "failed" ? <><div>{b.stage ?? ""}</div><div className="text-xs text-muted-foreground">{b.error}</div></> : ""}</td>
                  </tr>
                ))}
              </Table>
            )}
          </div>

          <div>
            <h3 className="mb-2 font-medium">What participants said about the findings ({data.reviews.total})</h3>
            {data.reviews.total === 0 ? <p className="text-sm text-muted-foreground">No reviews yet.</p> : (
              <>
                <Table head={["Finding (what Swardus said)", "Correct", "Not sure", "Wrong"]} min={480}>
                  {Object.entries(data.reviews.byKind).sort((a, b) => (b[1].correct + b[1].unsure + b[1].wrong) - (a[1].correct + a[1].unsure + a[1].wrong)).map(([k, c]) => (
                    <tr key={k}><td className={td}>{k}</td><td className={td}>{c.correct}</td><td className={td}>{c.unsure}</td><td className={td}><span className={c.wrong ? "text-destructive" : ""}>{c.wrong}</span></td></tr>
                  ))}
                </Table>
                {data.reviews.notes.length > 0 && (
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {data.reviews.notes.map((n, i) => <li key={i}><span className="text-muted-foreground">{n.who} on {n.twin}, {n.kind}{n.status ? ` (${n.status})` : ""}: {n.verdict}.</span> {n.note}</li>)}
                  </ul>
                )}
              </>
            )}
          </div>

          {data.errors.length > 0 && (
            <div>
              <h3 className="mb-2 font-medium">Errors</h3>
              <Table head={["When", "Who", "What", "Message"]} min={640}>
                {data.errors.map((e, i) => <tr key={i}><td className={td}>{when(e.at)}</td><td className={td}>{e.who}</td><td className={td}>{e.name}</td><td className={`${td} text-xs`}>{e.error}</td></tr>)}
              </Table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
