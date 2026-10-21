// Weed pressure in the sidebar: one button that grades the field on a cell grid from the weeds Find weeds put between
// the rows; the field in one line; the classes with their published action point; the three things the operator
// asked to see apart (cells of many small weeds, large escapes, priority patches); and the selected cell's card
// with its cover, count, size, tier and, before canopy closure, the expected-loss band. Never a product rate, never
// a number to act on by itself: decision support, with every mark's evidence a click away.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Gauge, Loader2 } from "lucide-react";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtArea } from "@/lib/units";
import type { ScanSources } from "@/lib/sourceFrames/scan";
import { type AlgorithmInfo, type Health, fetchAlgorithms, fetchHealth } from "@/lib/weedVision/client";
import { useFrameRun } from "@/lib/weedVision/frameRunStore";
import { CLASS_LABEL, CLASS_ORDER, type PressureClass, type WeedObject, pressureLine } from "@/lib/weedVision/pressure/grade";
import { gradeField, selectPressureCell, showPressure, usePressure } from "@/lib/weedVision/pressure/pressureStore";
import { useTwoStage } from "@/lib/weedVision/twoStage/twoStageStore";
import { modelShaFor } from "./ModelDetectionsPanel";
import { PRESSURE_STROKES } from "./PressureLayer";

const PARAMS = { algorithm: "rfdetr_seg_large", threshold: 0.5, tile: 1024, overlap: 256, scale: 1 };
const pct = (v: number | null | undefined, d = 0) => (v == null ? "–" : `${(100 * v).toFixed(d)}%`);
const cm = (m: number | null | undefined) => (m == null ? "–" : `${Math.round(m * 100)} cm`);

export function PressurePanel({ taskId, sources, crop, scanWeeds = [], fetchImpl }: { taskId: string; sources: ScanSources | null; crop: string | null; /** The scan's spots kept as weeds (Scan this field, the operator's verdicts applied): graded when the model has not run. */ scanWeeds?: WeedObject[]; fetchImpl?: typeof fetch }) {
  const s = usePressure(taskId);
  const ts = useTwoStage(taskId);
  const run = useFrameRun(taskId);
  const units = useUnitSystem();
  const area = (m2: number) => fmtArea(m2, units).text;
  const [health, setHealth] = useState<Health | null>(null);
  const [algorithms, setAlgorithms] = useState<Record<string, AlgorithmInfo>>({});
  useEffect(() => {
    const f = fetchImpl ?? fetch;
    let on = true;
    (async () => {
      const h = await fetchHealth(f);
      if (!on || !h.ok) return;
      setHealth(h.value);
      const a = await fetchAlgorithms(f);
      if (on && a.ok) setAlgorithms(a.value.algorithms);
    })();
    return () => { on = false; };
  }, [fetchImpl]);
  const modelSha = modelShaFor(algorithms[PARAMS.algorithm], health);
  const gsdCm = sources?.stats?.odm_processing_statistics?.average_gsd;
  const photoGsdM = typeof gsdCm === "number" ? gsdCm / 100 : null;

  const gr = s.grade;
  const selected = useMemo(() => (gr && s.selectedCell ? gr.cells.find(c => c.key === s.selectedCell) ?? null : null), [gr, s.selectedCell]);
  const btn = "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] disabled:opacity-40 disabled:cursor-not-allowed";
  const reading = s.state === "reading" || ts.stage1State === "reading";
  const haveWeeds = run.plants.length > 0 || scanWeeds.length > 0 || Object.keys(ts.runs).length > 0;
  const stale = gr && (run.plants.length > 0 || scanWeeds.length > 0) && gr.cells.reduce((a, c) => a + c.count, 0) === 0 && gr.summary.belowFloor === 0;

  return (
    <div className="p-4 border-b border-[#1f1f1f] space-y-2 text-[11px]" data-testid="pressure-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-[12px] font-semibold inline-flex items-center gap-2"><Gauge className="h-3.5 w-3.5 text-[#fb923c]" /> Weed pressure</h3>
        {gr && <label className="inline-flex items-center gap-1 text-neutral-400"><input type="checkbox" checked={s.show} onChange={e => showPressure(taskId, e.target.checked)} /> show on map</label>}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className={`${btn} border-[#fb923c] text-[#fb923c]`} disabled={reading || !run.mapAvailable} data-testid="pressure-grade"
          onClick={() => void gradeField(taskId, { crop, stage1: { params: PARAMS, modelSha, photoGsdM }, scanWeeds })}>
          {gr ? "Grade again" : "Grade the field"}
        </button>
        {reading && <span className="inline-flex items-center gap-1 text-neutral-400"><Loader2 className="h-3 w-3 animate-spin" /> reading the field into cells{ts.stage1Progress ? ` ${Math.round(100 * ts.stage1Progress)}%` : ""}…</span>}
        {!haveWeeds && !gr && <span className="text-neutral-500">The grade reads this scan's weeds: scan the field, or run Find weeds, first.</span>}
      </div>
      {s.error && <p className="text-amber-400 flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {s.error}</p>}
      {stale && <p className="text-amber-400">The grade found none of this scan's weeds between the rows: grade again, or check the rows.</p>}

      {gr && (
        <div className="space-y-2" data-testid="pressure-summary">
          <p className="text-neutral-200">{pressureLine(gr, area)}</p>
          <p className="text-neutral-500">
            Graded as {gr.group === "orchard" ? "an orchard" : gr.group === "cereal" ? "a drilled cereal" : "a wide-row crop"}{gr.crop ? ` (${gr.crop})` : ""}: action at {pct(gr.scheme.action)} cover, high at {pct(gr.scheme.high)}. {gr.scheme.source}.
            {s.source && ` Weeds from ${s.source === "map" ? "the model on the field map" : s.source === "photos" ? "the model on the kept photographs" : s.source === "scan" ? "the scan's spots kept as weeds" : "the two-stage windows"}.`}
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1" data-testid="pressure-legend">
            {CLASS_ORDER.filter(k => k !== "none").map(k => (
              <span key={k} className="inline-flex items-center gap-1 text-neutral-400">
                <span className="inline-block h-2.5 w-3 rounded-sm" style={{ background: PRESSURE_STROKES[k] }} /> {CLASS_LABEL[k]} {bound(k, gr.scheme)} <span className="text-neutral-600">({gr.summary.byClass[k]})</span>
              </span>
            ))}
            <span className="inline-flex items-center gap-1 text-neutral-400"><span className="inline-block h-2.5 w-3 rounded-sm border border-dashed border-neutral-400" /> possible, for review ({gr.summary.possible})</span>
            <span className="inline-flex items-center gap-1 text-neutral-400"><span className="inline-block h-2.5 w-3 rounded-sm" style={{ background: "repeating-linear-gradient(45deg, rgba(255,255,255,0.6) 0 1px, transparent 1px 4px)" }} /> not assessed ({gr.summary.notAssessed})</span>
          </div>
          {gr.summary.treatWhileSmall > 0 && <p className="text-neutral-300" data-testid="pressure-small">{gr.summary.treatWhileSmall} cell{gr.summary.treatWhileSmall === 1 ? "" : "s"} of many small weeds, stepped up one class: treat while small.</p>}
          {gr.escapes.length > 0 && (
            <div data-testid="pressure-escapes">
              <p className="text-neutral-300">{gr.escapes.length} large escape{gr.escapes.length === 1 ? "" : "s"} ({cm(gr.params.escapeDiameterM)} across or more): a seed and resistance risk apart from any cell's class.</p>
              <ul className="text-neutral-500 list-disc pl-4">
                {gr.escapes.slice(0, 5).map(e => (
                  <li key={e.id}><button type="button" className="underline hover:text-neutral-300" onClick={() => selectPressureCell(taskId, e.cell)}>{cm(e.diameterM)} across</button>{e.views > 1 ? `, seen in ${e.views} photographs` : ""}{e.tier === "possible" ? ", possible" : ""}</li>
                ))}
                {gr.escapes.length > 5 && <li>and {gr.escapes.length - 5} more</li>}
              </ul>
            </div>
          )}
          {gr.patches.some(p => p.priority) && (
            <p className="text-neutral-300" data-testid="pressure-patches">
              Priority patches: {gr.patches.filter(p => p.priority).slice(0, 4).map(p => `${area(p.areaM2)} at ${pct(p.meanCover)}`).join("; ")}{gr.patches.filter(p => p.priority).length > 4 ? "; and more" : ""}. Priority at {gr.params.patchPriorityAreaM2} m² of ground or {pct(gr.scheme.high)} cover (the area bar is ours).
            </p>
          )}
          {gr.summary.medianRelativeCover != null && gr.canopyClosed === false && (
            <p className="text-neutral-500">In cells at the action point or over, weeds hold a median {pct(gr.summary.medianRelativeCover)} of all cover (weeds and crop together): the measure that tracks yield loss, before canopy closure.</p>
          )}
          <ul className="text-neutral-600 list-disc pl-4 space-y-0.5">{gr.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}

      {gr && selected && (
        <div className="rounded-sm border border-[#3a3a3a] p-2 space-y-1" data-testid="pressure-cell">
          <p className="text-neutral-200">
            Cell {selected.key}: {selected.assessed ? `${CLASS_LABEL[selected.klass]}${selected.treatWhileSmall ? " (stepped up: many small weeds)" : ""}, ${selected.tier === "none" ? "nothing found" : selected.tier}` : `not assessed (${selected.whyNot.join(", ")})`}.
          </p>
          {selected.assessed && (
            <p className="text-neutral-400">
              Cover {pct(selected.cover, 1)} of {area(selected.groundM2)} visible ground; {selected.count} object{selected.count === 1 ? "" : "s"}{selected.count ? `, ${selected.density.toFixed(1)} per m², median ${cm(selected.medianDiameterM)} across, largest ${cm(selected.maxDiameterM)}` : ""}{selected.multiView ? `; ${selected.multiView} seen in two or more photographs` : ""}.
            </p>
          )}
          {selected.relativeCover != null && (
            <p className="text-neutral-400">
              Weeds hold {pct(selected.relativeCover)} of all cover here.{selected.lossBand ? ` Left as they are, the expected yield loss band is ${pct(selected.lossBand[0])} to ${pct(selected.lossBand[1])} (Kropff and Spitters, q 0.54 to 1; a band, not a prediction).` : gr.canopyClosed ? " No loss band after canopy closure." : ""}
            </p>
          )}
          <button type="button" className={`${btn} border-[#333] text-neutral-500`} onClick={() => selectPressureCell(taskId, null)}>Leave it</button>
        </div>
      )}
    </div>
  );
}

function bound(k: PressureClass, s: { low: number; moderate: number; action: number; high: number }): string {
  const p = (v: number) => `${Math.round(100 * v)}%`;
  if (k === "trace") return s.low > 0 ? `under ${p(s.low)}` : "";
  if (k === "low") return s.low > 0 ? `${p(s.low)} to ${p(s.moderate)}` : `under ${p(s.moderate)}`;
  if (k === "moderate") return `${p(s.moderate)} to ${p(s.action)}`;
  if (k === "action") return `${p(s.action)} to ${p(s.high)}`;
  if (k === "high") return `${p(s.high)} and over`;
  return "";
}
