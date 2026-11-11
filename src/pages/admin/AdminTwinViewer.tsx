// A participant's Field Twin, read-only, for troubleshooting. The server opens it only while the participant allows
// troubleshooting access, and logs the opening (with the reason typed here) where the participant can see it.
//
// Reached from the Field Twins list, or from a review on the pilot desk. From a review the page carries what the
// review said (router state, for showing only) and the finding it is about (`?finding=corn_weed:12`); once the twin
// is open that finding is selected, if and only if the saved twin holds it under that exact kind and id
// (reviewFocus.ts). Nothing here opens anything by itself: the reason is still asked for and the founder still
// presses the button, so every opening is one deliberate, logged act. The address and the state decide nothing about
// access; pilot-admin does.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import Seo from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pilotAdmin } from "@/lib/pilot/adminClient";
import { gunzipText } from "@/lib/fieldTwin/store";
import { type TwinBundle, parseTwin } from "@/lib/fieldTwin/types";
import { VERDICT_LABEL, type Verdict, findingLabel, isFindingKind, machineSaid, saysLabel } from "@/lib/fieldTwin/reviews";
import FieldTwinView from "@/components/app/fieldTwin/FieldTwinView";
import { isLocatable, parseFocus } from "@/components/app/fieldTwin/reviewFocus";

type Opened = { twin: { id: string; name: string; user_id: string }; files: Record<string, string> };

/** The review a twin was opened from: shown beside the twin, never written anywhere. */
export type ReviewContext = { kind: string; id: string; verdict: Verdict; says: string | null; note: string | null; status: string | null; at: string; who: string };
export type ViewerState = { from?: string; review?: ReviewContext };

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v ? v.slice(0, max) : null);
/** Router state is whatever the history entry holds: read it as untrusted, keep only what has the right shape. */
function readState(state: unknown, twinFinding: string | null): { from: string | null; review: ReviewContext | null } {
  const s = (state && typeof state === "object" ? state : {}) as Record<string, unknown>;
  const from = typeof s.from === "string" && /^\/admin\/pilot(\?|\/|$)/.test(s.from) ? s.from : null;
  const r = (s.review && typeof s.review === "object" ? s.review : null) as Record<string, unknown> | null;
  const kind = text(r?.kind, 20), id = text(r?.id, 64), verdict = r?.verdict;
  if (!r || !kind || !id || !isFindingKind(kind) || (verdict !== "correct" && verdict !== "unsure" && verdict !== "wrong")) return { from, review: null };
  // The context must be about the finding the address names (or about one that cannot be selected at all).
  if (twinFinding !== null ? twinFinding !== `${kind}:${id}` : isLocatable(kind)) return { from, review: null };
  return { from, review: { kind, id, verdict, says: text(r.says, 40), note: text(r.note, 2000), status: text(r.status, 64), at: text(r.at, 40) ?? "", who: text(r.who, 200) ?? "The participant" } };
}

function ReviewNote({ review, dark = false }: { review: ReviewContext; dark?: boolean }) {
  const said = review.verdict === "wrong" && isFindingKind(review.kind) ? saysLabel(review.kind, review.says) : null;
  const dim = dark ? "text-neutral-400" : "text-muted-foreground";
  return (
    <dl className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs ${dark ? "text-neutral-200" : ""}`} aria-label="The review this was opened from">
      <dt className={dim}>Finding</dt><dd>{findingLabel(review.kind, review.id)}</dd>
      <dt className={dim}>Swardus</dt><dd>{machineSaid(review.kind, review.status)}</dd>
      <dt className={dim}>{review.who}</dt><dd>{VERDICT_LABEL[review.verdict]}{said ? `: ${said.charAt(0).toLowerCase()}${said.slice(1)}` : ""}</dd>
      {review.note && <><dt className={dim}>Their note</dt><dd className="whitespace-pre-wrap">{review.note}</dd></>}
    </dl>
  );
}

export default function AdminTwinViewer() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const focus = parseFocus(params.get("finding"));
  const { from, review } = readState(location.state, focus ? `${focus.kind}:${focus.id}` : null);
  const [reason, setReason] = useState(() => (review ? `Looking at your review of ${findingLabel(review.kind, review.id).toLowerCase()} (marked ${VERDICT_LABEL[review.verdict].toLowerCase()})` : ""));
  const [state, setState] = useState<{ status: "ask" } | { status: "opening" } | { status: "error"; message: string } | { status: "open"; twin: TwinBundle; name: string; files: Record<string, string> }>({ status: "ask" });
  // What became of the finding asked for, once the twin is open: its label in the saved twin, or not there.
  const [found, setFound] = useState<{ status: string } | "missing" | null>(null);
  const onFocus = useCallback((f: { status: string } | null) => setFound(f ?? "missing"), []);
  const urls = useRef(new Map<string, Promise<string>>());
  useEffect(() => () => { for (const p of urls.current.values()) void p.then(u => URL.revokeObjectURL(u)).catch(() => undefined); }, []);

  const openIt = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ status: "opening" });
    try {
      const o = await pilotAdmin<Opened>("twin-open", { twin_id: id, reason: reason.trim() || null });
      const gz = o.files["twin.json.gz"];
      const res = await fetch(gz ?? o.files["twin.json"]);
      if (!res.ok) throw new Error(`the twin's file could not be downloaded (${res.status})`);
      const text = gz ? await gunzipText(await res.blob()) : await res.text();
      const parsed = parseTwin(JSON.parse(text));
      if ("reason" in parsed) throw new Error(parsed.reason);
      setState({ status: "open", twin: parsed.twin, name: o.twin.name, files: o.files });
    } catch (err) {
      setState({ status: "error", message: (err as Error).message });
    }
  };

  const atlasUrl = useCallback((index: number): Promise<string> => {
    if (state.status !== "open") return Promise.reject(new Error("not open"));
    const file = state.twin.atlases[index]?.file;
    const signed = file ? state.files[file] : undefined;
    if (!file || !signed) return Promise.reject(new Error(`no atlas ${index}`));
    let p = urls.current.get(file);
    if (!p) { p = fetch(signed).then(r => { if (!r.ok) throw new Error(`atlas ${index}: ${r.status}`); return r.blob(); }).then(b => URL.createObjectURL(b)); urls.current.set(file, p); }
    return p;
  }, [state]);

  const backTo = from ?? "/admin/pilot?tab=twins";
  const backLabel = from ? (/[?&]tab=reviews/.test(from) ? "Reviews" : "Back") : "Field Twins";
  if (state.status !== "open") {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6 sm:p-10">
        <Seo title="Open a participant's Field Twin, Swardus" noindex />
        <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="h-4 w-4" />{backLabel}</Link>
        <h1 className="font-display text-2xl">Open a participant's Field Twin</h1>
        <p className="text-sm text-muted-foreground">This shows their field and crops of their photographs. It works only if they allowed troubleshooting access, and the opening is logged where they can see it, with your reason.</p>
        {review && (
          <div className="rounded-md border bg-card p-3">
            <p className="mb-1.5 text-xs font-medium">The review you came from{focus ? ": this finding is selected when the twin opens" : ""}</p>
            <ReviewNote review={review} />
          </div>
        )}
        <form onSubmit={openIt} className="space-y-3">
          <div><label htmlFor="reason" className="text-sm font-medium">Why are you opening it?</label><Input id="reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="For example: their feedback says the weeds near the gate are wrong" required /></div>
          <Button type="submit" disabled={state.status === "opening" || !reason.trim()}>{state.status === "opening" && <Loader2 className="h-4 w-4 animate-spin" />}Open read-only</Button>
        </form>
        {state.status === "error" && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{state.message}</p>}
      </div>
    );
  }
  const asked = focus ? findingLabel(focus.kind, focus.id) : null;
  return (
    <div className="flex h-[100dvh] flex-col bg-[#0f0f0f] text-neutral-200">
      <Seo title={`${state.name} (read-only), Swardus`} noindex />
      <header className="flex flex-wrap items-center gap-3 border-b border-[#262626] bg-[#121212] px-3 py-1.5 text-sm">
        <Link to={backTo} className="inline-flex items-center gap-1 text-xs text-neutral-300 hover:text-neutral-100"><ArrowLeft className="h-3.5 w-3.5" />{from ? backLabel : "Admin"}</Link>
        <h1 className="font-display text-base">{state.name}</h1>
        <span className="text-[11px] text-amber-300">Read-only, opened for troubleshooting. Your reviews are not added to theirs.</span>
      </header>
      {(review || focus) && (
        <div className="border-b border-[#262626] bg-[#151815] px-3 py-2" role="status">
          {review ? <ReviewNote review={review} dark /> : <p className="text-xs text-neutral-200">{asked}</p>}
          {focus && found === "missing" && <p className="mt-1 text-xs text-amber-300">{asked} is not in this saved Field Twin, so nothing was selected.</p>}
          {focus && found && found !== "missing" && review?.status && found.status !== review.status && <p className="mt-1 text-xs text-amber-300">The saved twin calls this finding "{found.status}"; the review recorded "{review.status}".</p>}
          {review && !focus && <p className="mt-1 text-xs text-neutral-400">{review.kind === "boundary" ? "The boundary is drawn on the map; there is no single finding to select." : "Patches, pressure regions and scouting zones are numbered within one search, so this one cannot be picked out reliably. The twin is open with nothing selected."}</p>}
        </div>
      )}
      <main className="relative min-h-0 flex-1"><FieldTwinView twin={state.twin} atlasUrl={atlasUrl} audience="founder" focus={focus} onFocus={onFocus} /></main>
    </div>
  );
}
