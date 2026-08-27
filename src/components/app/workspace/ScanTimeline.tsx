// The field's scans, as a side panel over the one map — not a separate page.
//
// This replaces the History tab. History was a second surface with its own
// maps; every affordance it carried (open a scan, plan a mission, compare two
// flights, the timelapse) now lives beside the Field View so the orthomosaic
// under discussion is always the one on screen.
//
// THREE STATES, NEVER BLURRED. A scan card says "No grid assessment yet",
// "Grid run failed: <reason>", or shows the assessed result — and an assessed
// result of zero zones says so in words. The one thing a card never does is
// print "0 zones · 0.00 ac" for a scan nobody assessed: a number that looks
// measured and isn't is worse than no number. Assessment comes from the
// TREATMENT GRID (lib/scanAssessment.ts); results left behind by the removed
// legacy vision path are shown, but always marked as legacy so no number is
// ambiguous about which system produced it. See analysisStateOf in
// lib/compareGround.
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  AlertTriangle, CheckCircle2, Clock, Columns2, FileBarChart, Grid3x3, Loader2,
  Plane, RefreshCw, Trash2, X,
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
      toast.error("Couldn't re-render the map tiles", {
        description: `Nothing was changed. Check your connection and try again. (${String((e as Error)?.message ?? e)})`,
      });
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

/**
 * A failure the retired vision path left on the scan. Said plainly, and NOT
 * as a grid failure: the grid computes over pixels and calls no service, so
 * "AI is not configured" can only have come from the deleted system.
 */
function LegacyFailureLine({ at }: { at: string | null; error: string }) {
  // The raw error is always some flavour of "the old system was never set
  // up" (missing AI_API_KEY and friends) — server vocabulary that means
  // nothing to an operator who never saw that system. It stays in the data,
  // it does not print.
  return (
    <div className="text-[10px] leading-snug text-amber-500/80">
      An older automatic analysis (no longer part of SwathWise) failed here
      {at && ` on ${new Date(at).toLocaleDateString()}`}. Not a treatment-grid
      result, and nothing the grid needs.
    </div>
  );
}

function AnalysisLine({ scan }: { scan: FieldScan }) {
  const state = analysisStateOf(scan);
  if (state.kind === "none") {
    return (
      <div>
        <div
          className="text-[11px] text-neutral-500"
          title="Mark stressed and healthy reference cells in the Treatment Grid tab to assess this scan."
        >
          No grid assessment yet
        </div>
        {state.legacyFailure && <LegacyFailureLine {...state.legacyFailure} />}
      </div>
    );
  }
  if (state.kind === "failed") {
    return (
      <div className="text-[11px] text-red-400 leading-snug">
        <span className="font-medium">Grid run failed</span>
        {state.at && <span className="text-red-400/70"> · {new Date(state.at).toLocaleString()}</span>}
        <div className="text-red-400/80">{state.error}</div>
      </div>
    );
  }
  const zones = state.zones;
  const stressed = stressedAcres(zones);
  return (
    <div className="text-[11px] text-neutral-400">
      {state.source === "legacy" && (
        <span
          className="mr-1.5 rounded-sm border border-amber-700/60 px-1 py-px text-[9px] uppercase tracking-wider text-amber-400"
          title="Produced by an older automatic analysis that is no longer part of SwathWise, not by the treatment grid. Re-assess in the Treatment Grid tab; this result is kept until you clear it."
        >
          Old analysis
        </span>
      )}
      {zones.length === 0
        ? <span className="text-emerald-400/90">Assessed · nothing marked for treatment</span>
        : <>
            <span className="text-neutral-100">{zones.length}</span> zone{zones.length === 1 ? "" : "s"} ·{" "}
            <span className="text-neutral-100">{stressed.toFixed(2)} ac</span> marked
          </>}
      {state.rerunFailed && (
        <div className="text-amber-500/80 leading-snug">
          A later grid run failed ({state.rerunFailed.error}); showing the last good state.
        </div>
      )}
      {state.legacyFailure && <LegacyFailureLine {...state.legacyFailure} />}
    </div>
  );
}

function ScanCard({
  scan, index, isCurrent, flown, token,
  onOpenGrid, onOpenScan, onLegacyCleared,
  compareOn, pickBadge, onPick,
  rebaking, onRebake,
}: {
  scan: FieldScan;
  index: number;
  isCurrent: boolean;
  flown: boolean;
  token: string | null;
  /** Opens the Treatment Grid tab — only meaningful for the current scan. */
  onOpenGrid: () => void;
  onOpenScan: (id: string) => void;
  onLegacyCleared: () => void;
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
  const isRebaking = rebaking?.taskId === scan.id;
  const isLegacyResult = state.kind === "done" && state.source === "legacy";
  // Mutually exclusive with kind "failed" by construction: a row holds one
  // `last_run`, and it is either the grid's or the retired path's.
  const hasLegacyFailure = state.kind !== "failed" && !!state.legacyFailure;
  // A scan carrying ONLY a stale failure has no grid assessment to protect —
  // clearing it is tidying a fossil, not discarding an assessment.
  const failureOnly = hasLegacyFailure && !isLegacyResult;

  // User-initiated removal of what the retired vision path left behind.
  // Deliberate and confirmed — legacy data is never deleted silently.
  const clearLegacy = async () => {
    if (!window.confirm(
      failureOnly
        ? "Remove the failed run an older automatic analysis (no longer part of SwathWise) " +
          "recorded on this scan? It is not a treatment-grid result and nothing depends on it. " +
          "Your grid assessment, if any, is kept."
        : "Remove this scan's old analysis result? An older automatic analysis produced it, " +
          "and the treatment grid will not recreate it. This cannot be undone.",
    )) return;
    // A failure-only fossil can sit beside a real grid snapshot in the same
    // column, so strip just the stale marker and leave everything else — the
    // key is deleted outright rather than set undefined, which JSON drops
    // silently and which would read as "no failure" only by accident.
    let patch: Record<string, unknown>;
    if (failureOnly) {
      const rest = { ...(scan.ai_analysis as Record<string, unknown> | null ?? {}) };
      delete rest.last_run;
      patch = { ai_analysis: rest };
    } else {
      patch = { ai_analysis: null, ai_analysis_at: null };
    }
    const { error } = await supabase.from("odm_tasks")
      .update(patch as never)
      .eq("id", scan.id);
    if (error) {
      toast.error("Couldn't clear the old analysis record", {
        description: `Nothing was removed. Check your connection and try again. (${error.message})`,
      });
    }
    else { toast.success("Legacy record cleared."); onLegacyCleared(); }
  };

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
            Scan {index + 1}{isCurrent && " · viewing"} · {shortTime(scan.created_at)}
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
              title="No flown mission has been logged for this scan. Log one from the Flight Planner: fly the mission, then press Mark as Flown."
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
        {/* Assessment is reference points placed by a person, so the action is
            opening the grid, not a run button pretending it can go headless.
            For another scan, opening that scan's workspace is the road there. */}
        <button
          type="button"
          disabled={!!blocked}
          title={
            blocked ??
            (isCurrent
              ? "Mark stressed and healthy reference cells; the grid extrapolates and this card follows."
              : "Open this scan's workspace, then its Treatment Grid tab.")
          }
          onClick={(e) => {
            e.stopPropagation();
            if (isCurrent) onOpenGrid(); else onOpenScan(scan.id);
          }}
          className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm bg-[#4CAF50] px-2 text-[11px] font-semibold text-black transition-colors hover:bg-[#43a047] disabled:bg-[#1a1a1a] disabled:text-neutral-600"
        >
          <Grid3x3 className="h-3 w-3" />
          {state.kind === "failed" ? "Retry in grid"
            : state.kind === "done" && !isLegacyResult ? "Re-assess"
            : "Treatment Grid"}
        </button>
      </div>
      {(isLegacyResult || hasLegacyFailure) && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void clearLegacy(); }}
          className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-neutral-600 transition-colors hover:text-red-400"
        >
          <Trash2 className="h-3 w-3" />
          {failureOnly ? "Clear old failure record" : "Clear old analysis result"}
        </button>
      )}
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
  boundary, token, onOpenGrid, onScansChanged, onOpenScan,
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
  /** Opens the Treatment Grid tab for the current scan. */
  onOpenGrid: () => void;
  /** A scan row changed (legacy result cleared) — refetch the list. */
  onScansChanged: () => void;
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
            token={token}
            onOpenGrid={onOpenGrid}
            onOpenScan={onOpenScan}
            onLegacyCleared={onScansChanged}
            compareOn={compareOn}
            pickBadge={s.id === aId ? "A" : s.id === bId ? "B" : null}
            onPick={onPick}
            rebaking={rebaking}
            onRebake={rebake}
          />
        ))}

        {playable.length >= 2 ? (
          <div className="border-t border-[#1f1f1f] pt-3">
            <Timelapse scans={playable} boundary={boundary} token={token} />
          </div>
        ) : scans.length >= 2 ? (
          // The timelapse used to simply vanish here — an operator who saw it
          // once and then uploaded a scan whose tiles hadn't baked never
          // learned why it was gone.
          <div className="border-t border-[#1f1f1f] pt-3 text-[11px] text-neutral-600">
            The timelapse appears once two scans have finished baking their map
            tiles ({playable.length} of {scans.length} ready).
          </div>
        ) : null}
      </div>
    </div>
  );
}
