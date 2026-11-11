// One Field Twin, full screen. Opened from the account, or (right after a build) from this tab while its save
// finishes, so the participant sees the twin at once and the save carries on beneath.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import Seo from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { usePilotRole } from "@/lib/pilot/access";
import { type TwinRecord, completeRecordFacts, effectiveStatus, getTwinRecord } from "@/lib/fieldTwin/registry";
import { loadAtlas, loadTwin } from "@/lib/fieldTwin/store";
import type { TwinBundle } from "@/lib/fieldTwin/types";
import { retrySave, sessionTwin, useBuildSession } from "@/lib/fieldTwin/buildSession";
import { track } from "@/lib/pilot/telemetry";
import FieldTwinView from "@/components/app/fieldTwin/FieldTwinView";
import { FeedbackButton } from "@/components/pilot/FeedbackDialog";

type Source = { kind: "account"; key: string } | { kind: "tab"; files: Map<string, Blob>; pending: Promise<Map<string, Blob>> };
type State =
  | { status: "loading" }
  | { status: "open"; twin: TwinBundle; record: TwinRecord | null; source: Source }
  | { status: "missing" }
  | { status: "incomplete"; record: TwinRecord }
  | { status: "error"; message: string };

const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null);

/** Why a saved twin would not open, in plain words. */
export function plainOpenError(message: string): string {
  if (/format|not a Field Twin|unknown|missing|has no/i.test(message)) return "This Field Twin was saved in a form this version of Swardus cannot read.";
  if (/compressed twin/i.test(message)) return "This browser cannot read a saved Field Twin. Use a recent Chrome, Edge, Safari or Firefox.";
  if (/fetch|network|Failed/i.test(message)) return "The Field Twin could not be downloaded. Check your connection and try again.";
  return `The Field Twin could not be opened (${message}).`;
}

export default function TwinOpen() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const founder = usePilotRole() === "founder";
  const session = useBuildSession();
  const [state, setState] = useState<State>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const urls = useRef(new Map<string, Promise<string>>());
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let live = true;
    const t0 = performance.now();
    setState({ status: "loading" });
    (async () => {
      // This tab's own build: open it from memory while it saves.
      const mine = sessionTwin(id);
      // A list that cannot be reached is not a twin that does not exist: this tab's own build still opens from memory,
      // anything else says the connection failed and offers to try again.
      let record: TwinRecord | null = null;
      try { record = await getTwinRecord(id); }
      catch (e) { if (!mine) throw new Error(`Failed to fetch the Field Twin's entry (${(e as Error).message})`); }
      if (mine) { if (live) setState({ status: "open", twin: mine.twin, record, source: { kind: "tab", files: mine.files, pending: mine.pending } }); return; }
      if (!record) { if (live) setState({ status: "missing" }); return; }
      if (effectiveStatus(record) !== "ready") { if (live) setState({ status: "incomplete", record }); return; }
      const twin = await loadTwin(userId, record.storage_key);
      if (!live) return;
      setState({ status: "open", twin, record, source: { kind: "account", key: record.storage_key } });
      track("twin_opened", { twinId: record.id, durationMs: performance.now() - t0, outcome: "ok", counts: { atlases: twin.atlases.length } });
      void completeRecordFacts(record, twin).catch(() => undefined);
    })().catch(e => {
      if (!live) return;
      const message = (e as Error).message;
      track("twin_open_failed", { twinId: id, outcome: "error", error: message });
      setState({ status: "error", message: plainOpenError(message) });
    });
    return () => { live = false; };
  }, [id, userId, nonce]);

  // When this tab's save finishes, the twin is read from the account from then on.
  useEffect(() => {
    if (session.status === "saved" && session.record?.id === id && state.status === "open" && state.source.kind === "tab") {
      setState({ ...state, record: session.record, source: { kind: "account", key: session.record.storage_key } });
    }
  }, [session, id, state]);

  useEffect(() => () => { for (const p of urls.current.values()) void p.then(u => { if (u.startsWith("blob:")) URL.revokeObjectURL(u); }).catch(() => undefined); }, []);

  const atlasUrl = useCallback((index: number): Promise<string> => {
    if (state.status !== "open" || !userId) return Promise.reject(new Error("no twin open"));
    const file = state.twin.atlases[index]?.file;
    if (!file) return Promise.reject(new Error(`no atlas ${index}`));
    const k = `${state.source.kind}:${file}`;
    let p = urls.current.get(k);
    if (!p) {
      const src = state.source;
      p = src.kind === "account" ? loadAtlas(userId, src.key, file)
        : (async () => { let b = src.files.get(file); if (!b) { await src.pending; b = src.files.get(file); } if (!b) throw new Error(`${file} is not among the files`); return URL.createObjectURL(b); })();
      urls.current.set(k, p);
    }
    return p;
  }, [state, userId]);

  const back = <Link to="/app/twins" className="inline-flex items-center gap-1 text-xs text-neutral-300 hover:text-neutral-100"><ArrowLeft className="h-3.5 w-3.5" />Field Twins</Link>;

  if (state.status !== "open") {
    return (
      <div className="flex h-full items-center justify-center bg-[#0f0f0f] p-6 text-neutral-200">
        <Seo title="Field Twin, Swardus" noindex />
        <div className="w-full max-w-md space-y-3 text-sm">
          {back}
          {state.status === "loading" && <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Opening the Field Twin…</p>}
          {state.status === "missing" && <p>This Field Twin does not exist in your account, or it was deleted.</p>}
          {state.status === "incomplete" && <p>"{state.record.name}" did not finish saving, so it cannot be opened. Delete it from the list and build it again from the photographs.</p>}
          {state.status === "error" && (
            <>
              <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />{state.message}</p>
              <div className="flex gap-2"><Button size="sm" onClick={() => setNonce(n => n + 1)}>Try again</Button><FeedbackButton kind="problem" twinId={id} context={{ error: state.message }} label="Report this problem" /></div>
            </>
          )}
        </div>
      </div>
    );
  }

  const { twin, record, source } = state;
  const saving = source.kind === "tab" && session.status !== "idle" && session.record?.id === id ? session : null;
  const facts = [fmtDay(record?.captured_at ?? null) && `flown ${fmtDay(record?.captured_at ?? null)}`, `${twin.source.photographs.toLocaleString()} photographs`, twin.source.camera].filter(Boolean).join(" · ");

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0f0f0f] text-neutral-200">
      <Seo title={`${record?.name ?? twin.name}, Swardus`} noindex />
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#262626] bg-[#121212] px-3 py-1.5">
        {back}
        <h1 className="font-display text-base">{record?.name ?? twin.name}</h1>
        <span className="text-[11px] text-neutral-500">{facts}</span>
        {saving && (saving.status === "saving"
          ? <span role="status" className="ml-auto flex items-center gap-1.5 text-xs text-amber-300"><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving to your account{saving.save ? `: ${saving.save.done} of ${saving.save.total} files` : ""}. Keep this tab open.</span>
          : saving.status === "save-failed"
            ? <span role="alert" className="ml-auto flex items-center gap-2 text-xs text-red-300">Not saved: {saving.error}<Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={retrySave}>Try again</Button></span>
            : null)}
        {!saving && <span className="ml-auto"><FeedbackButton kind="other" twinId={record?.id ?? null} label="Feedback" variant="ghost" /></span>}
      </header>
      <main className="relative min-h-0 flex-1">
        <FieldTwinView twin={twin} atlasUrl={atlasUrl} audience={founder ? "founder" : "participant"} expose={import.meta.env.DEV}
          review={{ twinId: record?.id ?? null }} />
      </main>
    </div>
  );
}
