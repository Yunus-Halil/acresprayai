// Weed Scout, simply: one button that finds the weeds between the crop rows
// and puts them on the map. Everything behind it runs with fixed, sensible
// settings: RF-DETR at confidence 0.5 on every kept photo, each photo's crop
// rows read and the weeds on them left out, every outline aligned to the
// orthomosaic, everything saved. The full set of options is one link away.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Search, Square } from "lucide-react";
import type { ScanSources } from "@/lib/sourceFrames/scan";
import type { PhotoReadStore } from "@/lib/weedScout/photoPass";
import type { ScoutParams } from "@/lib/weedScout/types";
import { type AlgorithmInfo, type Health, algorithmReady, fetchAlgorithms, fetchHealth } from "@/lib/weedVision/client";
import { type FrameRunParams, countByRow, frameRunKey } from "@/lib/weedVision/frames";
import { listFrameRunKeys } from "@/lib/weedVision/frameRunCache";
import { alignRun, patchFrameRun, restoreFrameRun, scorableFrames, startFrameRun, stopFrameRun, unalignedFrames, useFrameRun } from "@/lib/weedVision/frameRunStore";
import { makeRowContextFor } from "@/lib/weedVision/photoRows";
import { PLANT_COLOUR } from "./ModelDetectionLayer";
import { modelShaFor } from "./ModelDetectionsPanel";

const SIMPLE_PARAMS: Omit<FrameRunParams, "algorithm"> = { threshold: 0.5, tile: 1024, overlap: 256, scale: 1 };
const PREFERRED_ALGORITHM = "rfdetr_seg_large";
/** Scans whose saved run was sent for alignment in this visit: an unmatched photo is not retried on every render. */
const alignTried = new Set<string>();
const PHASE_LABEL = { rows: "Reading the crop rows, photo", model: "Looking for weeds, photo", align: "Lining up with the map, photo" } as const;

export function SimpleWeedFinder({ taskId, userId, sources, readStore, passParams, onShowOptions, fetchImpl }: {
  taskId: string;
  userId: string | null;
  sources: ScanSources | null;
  readStore: PhotoReadStore | null;
  passParams: Pick<ScoutParams, "rowSpacingAuto" | "rowSpacingM" | "minBlobCm2"> | null;
  onShowOptions: () => void;
  fetchImpl?: typeof fetch;
}) {
  const run = useFrameRun(taskId);
  const [health, setHealth] = useState<Health | null>(null);
  const [algorithms, setAlgorithms] = useState<Record<string, AlgorithmInfo>>({});
  const [serviceDown, setServiceDown] = useState(false);
  const frames = useMemo(() => scorableFrames(sources), [sources]);

  // The map shows the weeds between the rows, nothing else.
  useEffect(() => { patchFrameRun(taskId, { viewMode: "detections", showWeeds: true, showCrops: false, showOnRow: false, selectedHotspotId: null }); }, [taskId]);
  useEffect(() => {
    const f = fetchImpl ?? fetch;
    let on = true;
    (async () => {
      const h = await fetchHealth(f);
      if (!on) return;
      if (!h.ok) { setServiceDown(true); return; }
      setHealth(h.value); setServiceDown(false);
      const a = await fetchAlgorithms(f);
      if (on && a.ok) setAlgorithms(a.value.algorithms);
    })();
    return () => { on = false; };
  }, [fetchImpl]);

  const algorithm = algorithms[PREFERRED_ALGORITHM] ? PREFERRED_ALGORITHM : Object.keys(algorithms).find(k => k !== "selected" && algorithmReady(algorithms[k], health)) ?? PREFERRED_ALGORITHM;
  const info = algorithms[algorithm];
  const ready = algorithmReady(info, health);
  const modelSha = modelShaFor(info, health);

  // The last saved run comes back by itself, whatever its settings.
  useEffect(() => {
    if (!sources || !info || run.running || run.plants.length) return;
    let on = true;
    (async () => {
      // Newest first; only a run of this model at its current weights restores.
      const keys = await listFrameRunKeys(taskId);
      const latest = keys.find(k => k.params && k.params.algorithm === algorithm && frameRunKey(k.params, modelSha) === k.paramsKey);
      if (!on || !latest?.params) return;
      const restored = await restoreFrameRun(taskId, { sources, params: latest.params, modelSha, algorithmLabel: info.label });
      // A run saved before outlines were aligned to the map gets aligned now, once.
      if (on && restored && unalignedFrames(taskId).length && !alignTried.has(taskId)) { alignTried.add(taskId); alignRun(taskId, { userId, sources }); }
    })();
    return () => { on = false; };
  }, [taskId, sources, info, modelSha]); // eslint-disable-line react-hooks/exhaustive-deps

  const rowContextFor = useMemo(() => makeRowContextFor(sources, readStore, passParams), [sources, readStore, passParams]);
  const find = () => {
    if (!userId || !sources || !info) return;
    startFrameRun(taskId, { userId, sources, params: { algorithm, ...SIMPLE_PARAMS }, algorithmLabel: info.label, modelSha, rowContextFor });
  };

  const rows = countByRow(run.plants);
  const photosIn = Object.keys(run.frames).length;
  const lined = run.running ? null : photosIn - unalignedFrames(taskId).length;
  const between = rows.offRow + rows.noRows;
  const p = run.progress;
  const pct = p && p.framesTotal ? Math.round((100 * p.framesDone) / p.framesTotal) : 0;
  const problem = serviceDown
    ? "The weed model isn't running on this computer. In a terminal, run  npm run weed-vision:service  then press Find weeds again."
    : !sources ? "Loading this scan's photos…"
      : !frames.length ? "This scan has no original photos kept, so there is nothing to look at closely. Upload the field again from the field page with the original photos."
        : health && !ready ? "The weed model is still loading. Try again in a moment."
          : null;

  return (
    <div className="p-4 space-y-4" data-testid="simple-weed-finder">
      <div>
        <h2 className="text-sm font-semibold">Weed Scout</h2>
        <p className="text-[11px] text-neutral-500 mt-0.5">Finds the weeds growing between the crop rows and shows them on the map.</p>
      </div>

      {!run.running ? (
        <button type="button" onClick={find} disabled={!!problem || !userId} data-testid="find-weeds"
          className="w-full inline-flex items-center justify-center gap-2 rounded-sm bg-[#ffe600] text-black font-semibold text-[13px] py-2.5 hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed">
          <Search className="h-4 w-4" /> {run.plants.length ? "Find weeds again" : "Find weeds"}
        </button>
      ) : (
        <div className="space-y-1.5" data-testid="finding">
          <div className="flex items-center justify-between text-[12px] text-neutral-300">
            <span className="inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {PHASE_LABEL[p?.phase ?? "model"]} {Math.min((p?.framesDone ?? 0) + 1, p?.framesTotal ?? 1)} of {p?.framesTotal ?? "…"}</span>
            <button type="button" onClick={() => stopFrameRun(taskId)} className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-300"><Square className="h-3 w-3" /> Stop</button>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-[#ffe600] transition-[width] duration-500" style={{ width: `${Math.max(2, pct)}%` }} /></div>
          <p className="text-[10px] text-neutral-600">Weeds appear on the map as each photo finishes. You can leave this tab; it keeps going.</p>
        </div>
      )}

      {problem && !run.running && (
        <p className="text-[11px] text-amber-400 flex items-start gap-1.5" data-testid="simple-problem"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {problem}</p>
      )}
      {run.error && !run.running && <p className="text-[11px] text-red-400 flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {run.error}</p>}

      {run.plants.length > 0 && (
        <div className="rounded-sm border border-[#2a2a2a] p-3 space-y-1" data-testid="simple-result">
          <div className="text-[22px] font-semibold leading-none" style={{ color: PLANT_COLOUR.weed }}>{between.toLocaleString()}</div>
          <div className="text-[12px] text-neutral-300">weed{between === 1 ? "" : "s"} between the rows</div>
          {rows.onRow > 0 && <div className="text-[11px] text-neutral-500">{rows.onRow.toLocaleString()} on the crop rows left out</div>}
          {lined != null && photosIn > 0 && (
            <div className={`text-[11px] ${lined < photosIn ? "text-amber-400" : "text-neutral-500"}`} data-testid="simple-aligned">
              {lined === photosIn ? `Lined up with the map in all ${photosIn} photos` : `Lined up with the map in ${lined} of ${photosIn} photos; the rest are placed by the camera position alone and can sit up to a metre off`}
            </div>
          )}
          <div className="text-[11px] text-neutral-500 pt-1">Zoom in on the map to see each weed's outline; click one for its details.</div>
        </div>
      )}

      <button type="button" onClick={onShowOptions} className="text-[11px] underline text-neutral-500 hover:text-neutral-300" data-testid="show-all-options">Show all options</button>
    </div>
  );
}
