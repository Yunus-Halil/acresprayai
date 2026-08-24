// The field's scans, as a side panel over the one map — not a separate page.
//
// This replaces the History tab. History was a second surface with its own
// maps; every affordance it carried (open a scan, plan a mission, compare two
// flights, the timelapse) now lives beside the Field View so the orthomosaic
// under discussion is always the one on screen.
//
// THREE STATES, NEVER BLURRED. A scan card says "Not analyzed", "Analysis
// failed: <reason>", or shows the analyzed result — and an analyzed result of
// zero zones says so in words. The one thing a card never does is print
// "0 zones · 0.00 ac" for a scan nobody analyzed: a number that looks measured
// and isn't is worse than no number. See analysisStateOf in lib/compareGround.
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  AlertTriangle, CheckCircle2, Clock, Columns2, FileBarChart, Loader2,
  Plane, RefreshCw, Sparkles, X,
} from "lucide-react";
import Timelapse from "@/components/app/Timelapse";
import { isPlayable } from "@/lib/timelapse";
import { FN_BASE, NDVI_BASE } from "./constants";
import {
  type ScanIndexInfo, isComparable, notComparableReason, rgbLayerLabel,
} from "@/lib/scanLayers";
import { analysisStateOf, stressedAcres } from "@/lib/compareGround";

type Ring = { lat: number; lng: number }[];

export type FieldScan = {
  id: string;
  odm_uuid: string | null;
  status: string;
  created_at: string;
  image_count: number;
  ai_analysis: unknown;
  ai_analysis_at: string | null;
  tiles_baked: boolean | null;
};

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export function useFieldScans(fieldId: string | null, nonce: number) {
  const [scans, setScans] = useState<FieldScan[]>([]);
  const [flownIds, setFlownIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!fieldId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: ts } = await supabase
        .from("odm_tasks")
        .select("id, odm_uuid, status, created_at, image_count, ai_analysis, ai_analysis_at, tiles_baked")
        .eq("field_id", fieldId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      const all = (ts as FieldScan[] | null) ?? [];
      setScans(all);
      if (all.length) {
        const { data: ls } = await supabase
          .from("flight_logs")
          .select("scan_id")
          .in("scan_id", all.map(t => t.id));
        if (!cancelled) {
          setFlownIds(new Set(
            ((ls as { scan_id: string | null }[] | null) ?? [])
              .map(l => l.scan_id)
              .filter((x): x is string => !!x),
          ));
        }
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [fieldId, nonce]);

  return { scans, flownIds, loading };
}

/**
 * Per-scan band/render info from the index endpoint, cached for the session.
 * Drives the honest imagery labels and the "re-render tiles" hint.
 */
const infoCache = new Map<string, ScanIndexInfo | null>();

export function useScanInfo(taskId: string | null, token: string | null) {
  const [info, setInfo] = useState<ScanIndexInfo | null>(
    taskId ? infoCache.get(taskId) ?? null : null,
  );
  useEffect(() => {
    if (!taskId || !token) { setInfo(null); return; }
    if (infoCache.has(taskId)) { setInfo(infoCache.get(taskId) ?? null); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${NDVI_BASE}/info?task_id=${taskId}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const j = r.ok ? ((await r.json()) as ScanIndexInfo) : null;
        infoCache.set(taskId, j);
        if (!cancelled) setInfo(j);
      } catch {
        if (!cancelled) setInfo(null);
      }
    })();
    return () => { cancelled = true; };
  }, [taskId, token]);
  return info;
}

/** Forget cached info for a scan whose tiles were just re-rendered. */
export function forgetScanInfo(taskId: string) {
  infoCache.delete(taskId);
}

// ---------------------------------------------------------------------------
// Rebake
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Drive a full tile re-render for one scan. The first call passes ?rebake=1
 * (clears the completion latch and re-derives the render plan); the rest let
 * the persisted plan carry the bake, same loop the workspace shell uses.
 */
export function useRebake(token: string | null, onDone: (taskId: string) => void) {
  const [rebaking, setRebaking] = useState<{ taskId: string; completed: number; total: number } | null>(null);
  const busy = useRef(false);

  const rebake = async (taskId: string) => {
    if (!token || busy.current) return;
    busy.current = true;
    setRebaking({ taskId, completed: 0, total: 0 });
    try {
      let first = true;
      let stalled = 0;
      let last = -1;
      for (let pass = 0; pass < 400; pass++) {
        const r = await fetch(
          `${FN_BASE}/bake-tiles?task_id=${taskId}${first ? "&rebake=1" : ""}`,
          { method: "POST", headers: { Authorization: `Bearer ${token}` } },
        );
        first = false;
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          if (r.status === 503) { await sleep(3000); continue; }
          throw new Error(j?.error ?? "Tile re-render failed");
        }
        setRebaking({ taskId, completed: j.completed ?? 0, total: j.total ?? 0 });
        if (j.done) {
          forgetScanInfo(taskId);
          toast.success("Map tiles re-rendered.");
          onDone(taskId);
          return;
        }
        if (j.completed === last) stalled += 1;
        else { stalled = 0; last = j.completed ?? -1; }
        if (stalled >= 8) throw new Error("Tile re-rendering stalled, try again in a moment.");
        await sleep(j.retrying ? 2000 : 250);
      }
      throw new Error("Tile re-rendering did not finish.");
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    } finally {
      busy.current = false;
      setRebaking(null);
    }
  };

  return { rebaking, rebake };
}

// ---------------------------------------------------------------------------
// One scan card
// ---------------------------------------------------------------------------

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
const shortTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function AnalysisLine({ scan }: { scan: FieldScan }) {
  const state = analysisStateOf(scan);
  if (state.kind === "none") {
    return <div className="text-[11px] text-neutral-500">Not analyzed yet</div>;
  }
  if (state.kind === "failed") {
    return (
      <div className="text-[11px] text-red-400 leading-snug">
        <span className="font-medium">Analysis failed</span>
        {state.at && <span className="text-red-400/70"> · {new Date(state.at).toLocaleString()}</span>}
        <div className="text-red-400/80">{state.error}</div>
      </div>
    );
  }
  const zones = state.zones;
  const stressed = stressedAcres(zones);
  return (
    <div className="text-[11px] text-neutral-400">
      {zones.length === 0
        ? <span className="text-emerald-400/90">Analyzed · no stressed areas found</span>
        : <>
            <span className="text-neutral-100">{zones.length}</span> zone{zones.length === 1 ? "" : "s"} ·{" "}
            <span className="text-neutral-100">{stressed.toFixed(2)} ac</span> stressed
          </>}
      {state.rerunFailed && (
        <div className="text-amber-500/80 leading-snug">
          A later re-run failed ({state.rerunFailed.error}); showing the last good result.
        </div>
      )}
    </div>
  );
}

function ScanCard({
  scan, index, isCurrent, flown, boundaryDrawn, token,
  analyzingId, onAnalyze, onOpenScan,
  compareOn, pickBadge, onPick,
  rebaking, onRebake,
}: {
  scan: FieldScan;
  index: number;
  isCurrent: boolean;
  flown: boolean;
  boundaryDrawn: boolean;
  token: string | null;
  analyzingId: string | null;
  onAnalyze: (id: string) => void;
  onOpenScan: (id: string) => void;
  compareOn: boolean;
  pickBadge: "A" | "B" | null;
  onPick: (id: string) => void;
  rebaking: { taskId: string; completed: number; total: number } | null;
  onRebake: (id: string) => void;
}) {
  const state = analysisStateOf(scan);
  const blocked = notComparableReason(scan);
  const info = useScanInfo(scan.id, token);
  const imagery = rgbLayerLabel(info);
  const analyzing = analyzingId === scan.id;
  const isRebaking = rebaking?.taskId === scan.id;
  const analyzeLabel = state.kind === "done" ? "Re-analyze"
    : state.kind === "failed" ? "Retry analysis"
    : "Analyze";

  return (
    <div
      onClick={() => { if (compareOn && !blocked) onPick(scan.id); }}
      title={compareOn ? blocked ?? undefined : undefined}
      className={`rounded-sm border bg-[#111] p-3 transition-colors ${
        compareOn && !blocked ? "cursor-pointer" : ""
      } ${
        pickBadge
          ? "border-cyan-500 ring-1 ring-cyan-500/40"
          : compareOn && blocked
            ? "border-[#1f1f1f] opacity-60"
            : "border-[#1f1f1f] hover:border-[#333]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">
            Scan {index + 1}{isCurrent && " · open now"} · {shortTime(scan.created_at)}
          </div>
          <div className="truncate text-sm font-medium text-neutral-100">{longDate(scan.created_at)}</div>
        </div>
        {pickBadge && (
          <div className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-cyan-500 text-[11px] font-semibold text-black">
            {pickBadge}
          </div>
        )}
      </div>

      <div className="mt-2 space-y-1">
        <AnalysisLine scan={scan} />
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          {flown ? (
            <span className="inline-flex items-center gap-1 rounded-sm border border-emerald-700 px-1.5 py-0.5 text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> Mission flown
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 rounded-sm border border-[#2a2a2a] px-1.5 py-0.5 text-neutral-500"
              title="No flown mission has been logged for this scan. Log one from the workspace Settings tab after flying."
            >
              <Clock className="h-3 w-3" /> No mission logged
            </span>
          )}
          <span className="text-neutral-600">{imagery.label}</span>
        </div>
        {blocked && <div className="text-[11px] text-amber-500/80">{blocked}</div>}
        {imagery.caveat && (
          <div className="flex items-start gap-1 text-[10px] leading-snug text-amber-500/80">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {imagery.caveat}
          </div>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenScan(scan.id); }}
          className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm border border-[#222] px-2 text-[11px] text-neutral-300 transition-colors hover:border-[#333] hover:text-white"
        >
          {flown ? <FileBarChart className="h-3 w-3" /> : <Plane className="h-3 w-3" />}
          {flown ? "View Report" : "Plan Mission"}
        </button>
        <button
          type="button"
          disabled={!!analyzingId || !boundaryDrawn || !!blocked}
          title={
            !boundaryDrawn ? "Draw the field boundary first so the AI only analyzes your farmland."
            : blocked ?? (state.kind === "done" ? "Run the AI analysis again on this scan" : "Run the AI analysis on this scan")
          }
          onClick={(e) => { e.stopPropagation(); onAnalyze(scan.id); }}
          className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm bg-[#4CAF50] px-2 text-[11px] font-semibold text-black transition-colors hover:bg-[#43a047] disabled:bg-[#1a1a1a] disabled:text-neutral-600"
        >
          {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {analyzing ? "Analyzing…" : analyzeLabel}
        </button>
      </div>
      <button
        type="button"
        disabled={!!rebaking || !!blocked}
        onClick={(e) => { e.stopPropagation(); onRebake(scan.id); }}
        title="Bake this scan's map tiles again with the current renderer. Fixes opaque black borders and wrong colours left by older renders."
        className={`mt-1.5 inline-flex items-center gap-1 text-[10px] transition-colors disabled:opacity-50 ${
          imagery.needsRebake ? "text-amber-400 hover:text-amber-300" : "text-neutral-600 hover:text-neutral-400"
        }`}
      >
        <RefreshCw className={`h-3 w-3 ${isRebaking ? "animate-spin" : ""}`} />
        {isRebaking
          ? `Re-rendering… ${rebaking!.completed}/${rebaking!.total || "?"}`
          : "Re-render map tiles"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export function ScanPanel({
  open, onClose, fieldName, scans, flownIds, loading, currentTaskId,
  boundary, token, analyzingId, onAnalyze, onOpenScan,
  compareOn, onToggleCompare, picked, onPick, aId, bId, onTilesRebaked,
}: {
  open: boolean;
  onClose: () => void;
  fieldName: string;
  scans: FieldScan[];
  flownIds: Set<string>;
  loading: boolean;
  currentTaskId: string;
  boundary: Ring[] | null;
  token: string | null;
  analyzingId: string | null;
  onAnalyze: (id: string) => void;
  onOpenScan: (id: string) => void;
  compareOn: boolean;
  onToggleCompare: () => void;
  picked: string[];
  onPick: (id: string) => void;
  aId: string | null;
  bId: string | null;
  onTilesRebaked: (taskId: string) => void;
}) {
  const { rebaking, rebake } = useRebake(token, onTilesRebaked);
  if (!open) return null;

  const playable = scans.filter(isPlayable);
  const comparableCount = scans.filter(isComparable).length;
  const boundaryDrawn = (boundary ?? []).some(r => r.length >= 3);

  return (
    <div
      data-testid="scan-panel"
      className="absolute bottom-0 right-0 top-0 z-[1050] flex w-[360px] max-w-[90vw] flex-col border-l border-[#1f1f1f] bg-[#0f0f0f]/95 backdrop-blur"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-[#1f1f1f] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">Scans</div>
          <div className="truncate text-sm font-medium text-neutral-100">{fieldName}</div>
        </div>
        {comparableCount >= 2 && (
          <button
            type="button"
            onClick={onToggleCompare}
            className={`inline-flex h-7 items-center gap-1.5 rounded-sm border px-2 text-[11px] transition-colors ${
              compareOn
                ? "border-cyan-500 bg-cyan-500/15 text-cyan-300"
                : "border-[#222] text-neutral-300 hover:border-[#333] hover:text-white"
            }`}
          >
            <Columns2 className="h-3 w-3" /> {compareOn ? "Comparing" : "Compare"}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close scan panel"
          className="grid h-7 w-7 place-items-center rounded-sm text-neutral-500 transition-colors hover:bg-[#1a1a1a] hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {compareOn && (
          <div className="rounded-sm border border-cyan-900/50 bg-cyan-500/5 px-2.5 py-2 text-[11px] leading-snug text-cyan-200/90">
            {picked.length < 2
              ? `Pick ${picked.length === 0 ? "two scans" : "one more scan"} to compare. A is the older flight, B the newer.`
              : "Comparing. Drag the divider on the map; pick a different scan to swap it in."}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 py-4 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading scans…
          </div>
        )}
        {!loading && scans.length === 0 && (
          <div className="rounded-sm border border-[#1f1f1f] bg-[#111] p-6 text-center text-sm text-neutral-500">
            No scans yet for this field.
          </div>
        )}
        {scans.map((s, i) => (
          <ScanCard
            key={s.id}
            scan={s}
            index={i}
            isCurrent={s.id === currentTaskId}
            flown={flownIds.has(s.id)}
            boundaryDrawn={boundaryDrawn}
            token={token}
            analyzingId={analyzingId}
            onAnalyze={onAnalyze}
            onOpenScan={onOpenScan}
            compareOn={compareOn}
            pickBadge={s.id === aId ? "A" : s.id === bId ? "B" : null}
            onPick={onPick}
            rebaking={rebaking}
            onRebake={rebake}
          />
        ))}

        {playable.length >= 2 && (
          <div className="border-t border-[#1f1f1f] pt-3">
            <Timelapse scans={playable} boundary={boundary} token={token} />
          </div>
        )}
      </div>
    </div>
  );
}
