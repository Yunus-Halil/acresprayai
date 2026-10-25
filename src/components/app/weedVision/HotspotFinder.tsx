// The simple view's weed search, in two quick steps once the crop rows are known: the hotspots between the rows in
// seconds with no model (Stage 1 of lib/weedVision/twoStage: every 2 m cell's green off the crop, its density of
// small green patches, and its uncertainty), then the model on the hotspots only, with a random check elsewhere, its
// weeds shown as outlines like any model run. Nothing here changes a verdict or a treatment.
import { useEffect } from "react";
import { AlertTriangle, Loader2, Search, Square } from "lucide-react";
import type { FrameRunParams } from "@/lib/weedVision/frames";
import { setExternalDetections, useFrameRun } from "@/lib/weedVision/frameRunStore";
import { patchTwoStage, runStage1, runStage2, stopTwoStage, twoStagePlants, useTwoStage } from "@/lib/weedVision/twoStage/twoStageStore";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtLengthCm } from "@/lib/units";

const pct = (v: number) => `${Math.round(100 * v)}%`;
/**
 * The hotspots read the finest pixel the map has (0.2-1.6 cm on a low flight, where the rows and the grade read at
 * 3-4 cm), so a weed the map can show is a patch here. Within 250 million pixels, about 3,800 tiles and a few
 * minutes (Stage 1 runs about 20 ms a million pixels; fetching the tiles is the most of it): a 6 ha field at
 * 1 cm reads at zoom 23, a test patch at 0.3 cm at its own pixel. A patch of 9 pixels (3 x 3) counts, the smallest
 * the imagery shows; on a coarse read the 30 cm2 floor stands.
 */
export const HOTSPOT_READ = { readMpp: 0, maxReadPixels: 250e6, blobMinPx: 9 } as const;

export function HotspotFinder({ taskId, userId, params, modelSha, photoGsdM, modelReady, modelAvailable = true, algorithmLabel }: {
  taskId: string; userId: string | null; params: FrameRunParams; modelSha: string | null; photoGsdM: number | null; modelReady: boolean;
  /** False on the live site: the hotspots stand on their own, with no model check offered. */
  modelAvailable?: boolean; algorithmLabel: string | null;
}) {
  const s = useTwoStage(taskId);
  const run = useFrameRun(taskId);
  const units = useUnitSystem();
  const st = s.stage1;
  // Rows the operator stands behind: a marked planting layout, or crop rows read from the map and confirmed on it.
  const rowsKnown = run.fieldRowsSource === "layout" || (run.fieldRowsSource === "pattern" && run.fieldRowsConfirmed);
  // The simple view shows pressure and hotspots, never the model's windows.
  useEffect(() => { patchTwoStage(taskId, { layers: { pressure: true, candidates: true, windows: false, weeds: false }, labelMode: false }); }, [taskId]);
  // The model's weeds from the hotspot check, shown as outlines through the scan's plants.
  const runCount = Object.keys(s.runs).length;
  useEffect(() => {
    if (!runCount) return;
    setExternalDetections(taskId, "hotspot-check", twoStagePlants(s), algorithmLabel);
  }, [taskId, runCount, s.running]); // eslint-disable-line react-hooks/exhaustive-deps
  const btn = "w-full inline-flex items-center justify-center gap-2 rounded-sm font-semibold text-[13px] py-2.5 disabled:opacity-40 disabled:cursor-not-allowed";
  const busy = s.running || s.stage1State === "reading";
  const inspected = s.routing ? s.routing.order.length : 0;
  const ms = st ? (st.ms < 1000 ? `${Math.round(st.ms)} ms` : `${(st.ms / 1000).toFixed(1)} s`) : "";
  return (
    <div className="space-y-2" data-testid="hotspot-finder">
      {!rowsKnown && run.fieldRowsState !== "reading" && (
        <p className="text-[11px] text-neutral-500">Confirm the crop rows above first: the hotspots are what grows between them.</p>
      )}
      <button type="button" className={`${btn} bg-[#ff9100] text-black hover:brightness-95`} disabled={busy || !rowsKnown} data-testid="find-hotspots"
        onClick={() => void runStage1(taskId, { params, modelSha, photoGsdM, stage1Params: HOTSPOT_READ })}>
        {s.stage1State === "reading" ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading the field{s.stage1Progress ? ` ${pct(s.stage1Progress)}` : ""}…</> : <><Search className="h-4 w-4" /> {st ? "Find weed hotspots again" : "Find weed hotspots"}</>}
      </button>
      {st && (
        <div className="rounded-sm border border-[#2a2a2a] p-3 space-y-1 text-[11px]" data-testid="hotspot-summary">
          <div className="text-[22px] font-semibold leading-none text-[#ff9100]">{st.summary.candidates.toLocaleString()}</div>
          <div className="text-[12px] text-neutral-300">weed hotspot{st.summary.candidates === 1 ? "" : "s"} between the rows, {pct(st.summary.flaggedShare)} of the field{st.summary.highPriority ? `, ${st.summary.highPriority} large or dense` : ""}</div>
          <div className="text-neutral-500" data-testid="hotspot-read">Green off the crop rows and crowns, read from the map at {fmtLengthCm(st.grid.mpp * 100, units).text} a pixel in {ms}. {modelAvailable ? "No model yet: a" : "A"} hotspot is where there is vegetation to look at, not a verdict.</div>
          {st.summary.uncertainShare > 0.05 && <div className="text-amber-400">{pct(st.summary.uncertainShare)} of the field could not be judged ({Object.entries(st.summary.reasons).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ")}); hatched on the map.</div>}
        </div>
      )}
      {modelAvailable && st && s.routing && (
        <div className="space-y-1.5">
          {!s.running ? (
            <button type="button" className={`${btn} bg-[#ffe600] text-black hover:brightness-95`} disabled={!modelReady || !userId} data-testid="check-hotspots"
              onClick={() => runStage2(taskId, { userId, mode: "routed" })}>
              <Search className="h-4 w-4" /> {runCount ? "Check the hotspots with the model again" : `Check the hotspots with the model (${inspected} of ${s.windows.length} parts)`}
            </button>
          ) : (
            <div className="flex items-center justify-between text-[12px] text-neutral-300">
              <span className="inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking at part {Math.min((s.stage2?.done ?? 0) + 1, s.stage2?.total ?? 1)} of {s.stage2?.total ?? "…"}</span>
              <button type="button" onClick={() => stopTwoStage(taskId)} className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-300"><Square className="h-3 w-3" /> Stop</button>
            </div>
          )}
          {!modelReady && <p className="text-[11px] text-neutral-500">The weed model is not running on this computer; the hotspots above stand on their own.</p>}
          {runCount > 0 && !s.running && <p className="text-[11px] text-neutral-500">The model looked at {runCount} part{runCount === 1 ? "" : "s"}: the hotspots, the parts it could not judge, and {s.routing.counts.audit} at random elsewhere. Its weeds are the yellow outlines.</p>}
        </div>
      )}
      {s.error && <p className="text-[11px] text-red-400 flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {s.error}</p>}
    </div>
  );
}
