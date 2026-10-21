// The two-stage prototype in the sidebar (behind "Show all options"):
//   1. Stage 1 reads weed pressure between the rows on a cell grid, in seconds.
//   2. Stage 2 runs RF-DETR only where Stage 1 points, where it is unsure, and
//      on a random audit; or everywhere, as the reference to compare with.
//   3. The scorecard: cost, agreement with the reference, the audit, and the
//      operator's blind cell labels. Nothing here is a validated weed map, and
//      the panel says so. Plan: docs/features/two-stage-weed-intelligence.md.
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, FlaskConical, Loader2, Square, Upload } from "lucide-react";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtArea } from "@/lib/units";
import type { ScanSources } from "@/lib/sourceFrames/scan";
import { type AlgorithmInfo, type Health, algorithmReady, fetchAlgorithms, fetchHealth } from "@/lib/weedVision/client";
import { type Rate, COVER_CLASSES, scoreTwoStage } from "@/lib/weedVision/twoStage/score";
import { type LabelFile, type PaintComparison, type TwoStageLayers, exportLabels, importLabels, labelCell, nextRandomCell, paintComparison, patchTwoStage, runStage1, runStage2, setPaintCrop, stopTwoStage, twoStagePlants, useTwoStage } from "@/lib/weedVision/twoStage/twoStageStore";
import { LABEL_COLOURS, TWO_STAGE_COLOURS } from "./TwoStageLayer";
import { modelShaFor } from "./ModelDetectionsPanel";

const PARAMS = { algorithm: "rfdetr_seg_large", threshold: 0.5, tile: 1024, overlap: 256, scale: 1 };

const pct = (v: number | null | undefined, d = 0) => (v == null ? "–" : `${(100 * v).toFixed(d)}%`);
const sec = (ms: number | null | undefined) => (ms == null ? "–" : ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);
function rateText(r: Rate): string {
  if (!r) return "none to count";
  return `${r.k} of ${r.n} (${pct(r.p)}, 95% interval ${pct(r.lo)} to ${pct(r.hi)})`;
}

export function TwoStagePanel({ taskId, userId, sources, fetchImpl }: { taskId: string; userId: string | null; sources: ScanSources | null; fetchImpl?: typeof fetch }) {
  const s = useTwoStage(taskId);
  const units = useUnitSystem();
  const [health, setHealth] = useState<Health | null>(null);
  const [algorithms, setAlgorithms] = useState<Record<string, AlgorithmInfo>>({});
  const [importNote, setImportNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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
  const info = algorithms[PARAMS.algorithm];
  const ready = algorithmReady(info, health);
  const modelSha = modelShaFor(info, health);
  const gsdCm = sources?.stats?.odm_processing_statistics?.average_gsd;
  const photoGsdM = typeof gsdCm === "number" ? gsdCm / 100 : null;

  const [paintCmp, setPaintCmp] = useState<PaintComparison | null>(null);
  useEffect(() => {
    let on = true;
    void paintComparison(taskId).then(c => { if (on) setPaintCmp(c); });
    return () => { on = false; };
  }, [taskId, s.runs, s.paintCrop, s.keyBase]);
  const report = useMemo(() => {
    if (!s.stage1 || !s.routing) return null;
    const ran = new Map(Object.entries(s.runs).map(([k, v]) => [k, v.ms]));
    return scoreTwoStage({ stage1: s.stage1, routing: s.routing, plants: twoStagePlants(s), ran, allWindows: s.windows.map(w => w.name), labels: s.labels });
  }, [s.stage1, s.routing, s.runs, s.windows, s.labels]); // eslint-disable-line react-hooks/exhaustive-deps

  const st = s.stage1;
  const active = s.activeCell ? st?.cells.find(c => c.key === s.activeCell) ?? null : null;
  const activeLabel = active ? s.labels[active.key] : undefined;
  const nLabels = Object.keys(s.labels).length;
  const btn = "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] disabled:opacity-40 disabled:cursor-not-allowed";
  const setLayer = (k: keyof TwoStageLayers) => patchTwoStage(taskId, x => ({ layers: { ...x.layers, [k]: !x.layers[k] } }));
  const download = () => {
    const f = exportLabels(taskId);
    if (!f) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(f, null, 1)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: `cell-labels-${taskId.slice(0, 8)}.json` }).click();
    URL.revokeObjectURL(url);
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    try { const n = importLabels(taskId, JSON.parse(await file.text()) as LabelFile); setImportNote(n ? `${n} labels taken from the file.` : "No labels taken: the file is for another scan or grid."); }
    catch { setImportNote("That file could not be read."); }
  };

  return (
    <details className="p-4 border-b border-[#1f1f1f] space-y-2 text-[11px]" data-testid="two-stage-panel">
      <summary className="cursor-pointer text-[12px] font-semibold inline-flex items-center gap-2"><FlaskConical className="h-3.5 w-3.5 text-[#22d3ee]" /> Two-stage weed pressure (prototype)</summary>
      <p className="text-amber-400 flex items-start gap-1.5 mt-2"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> Development prototype. No field has been validated yet, so treat every number as a test reading, not a weed map.</p>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" className={`${btn} border-[#22d3ee] text-[#22d3ee]`} disabled={s.running || s.stage1State === "reading"} data-testid="two-stage-run1"
            onClick={() => void runStage1(taskId, { params: PARAMS, modelSha, photoGsdM })}>1. Read weed pressure</button>
          {s.stage1State === "reading" && <span className="inline-flex items-center gap-1 text-neutral-400"><Loader2 className="h-3 w-3 animate-spin" /> reading the map{s.stage1Progress ? ` ${Math.round(100 * s.stage1Progress)}%` : ""}…</span>}
        </div>
        {st && (
          <div className="text-neutral-300 space-y-1" data-testid="two-stage-summary">
            <p>{st.summary.cells.toLocaleString()} cells of {st.params.cellM} m. {st.summary.candidates} candidate area{st.summary.candidates === 1 ? "" : "s"} ({st.summary.highPriority} high priority) cover {pct(st.summary.flaggedShare)} of them. Read in {sec(st.ms)} in this browser.</p>
            {st.summary.uncertainShare > 0 && (
              <p className="text-neutral-500">Uncertain: {pct(st.summary.uncertainShare)} of cells ({Object.entries(st.summary.reasons).filter(([, n]) => n).map(([r, n]) => `${r} ${n.toLocaleString()}`).join(", ")}).</p>
            )}
            {!st.rowsUsed && <p className="text-amber-400">No crop rows were found, so Stage 1 cannot tell weeds from the crop here. Every cell is uncertain and every window is inspected.</p>}
            {s.routing && (
              <p className="text-neutral-400">RF-DETR windows: {s.routing.order.length} of {s.windows.length} ({pct(s.windows.length ? s.routing.order.length / s.windows.length : 0)}): {s.routing.counts.hotspot} for candidates, {s.routing.counts.uncertain} for uncertain cells, {s.routing.counts.audit} random audit.</p>
            )}
          </div>
        )}
      </div>

      {st && s.routing && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" className={`${btn} border-[#ffe600] text-[#ffe600]`} disabled={s.running || !ready || !userId} data-testid="two-stage-run2"
              onClick={() => runStage2(taskId, { userId, mode: "routed" })}>2. Inspect with RF-DETR</button>
            <button type="button" className={`${btn} border-[#333] text-neutral-300`} disabled={s.running || !ready || !userId} data-testid="two-stage-reference"
              onClick={() => runStage2(taskId, { userId, mode: "everywhere" })}>Reference: RF-DETR everywhere (slow)</button>
            {s.running && <button type="button" onClick={() => stopTwoStage(taskId)} className="inline-flex items-center gap-1 text-neutral-500 hover:text-neutral-300"><Square className="h-3 w-3" /> Stop</button>}
          </div>
          {!ready && <p className="text-neutral-500">The weed model is not running on this computer, or still loading.</p>}
          {s.stage2 && (
            <p className="text-neutral-400 inline-flex items-center gap-1.5">
              {s.running && <Loader2 className="h-3 w-3 animate-spin" />}
              {s.stage2.mode === "routed" ? "Routed" : "Reference"}: {s.stage2.done} of {s.stage2.total} windows{s.stage2.fromCache ? `, ${s.stage2.fromCache} already scored` : ""}.
            </p>
          )}
        </div>
      )}
      {s.error && <p className="text-red-400 flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {s.error}</p>}

      {report && (Object.keys(s.runs).length > 0 || nLabels > 0) && (
        <div className="rounded-sm border border-[#2a2a2a] p-2.5 space-y-2" data-testid="two-stage-report">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500">Cost</div>
            <p className="text-neutral-300">Stage 1 {sec(report.cost.stage1Ms)} in the browser. RF-DETR on {report.cost.routedWindows} of {report.cost.allWindows} windows: {sec(report.cost.stage2Ms)}{report.cost.referenceMs != null ? ` against ${sec(report.cost.referenceMs)} everywhere (${pct(report.cost.gpuShare)} of the model time)` : ""}.</p>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500">Against RF-DETR everywhere</div>
            {!report.vsReference ? <p className="text-neutral-500">Run the reference once to compare. It is agreement with RF-DETR, not accuracy.</p> : (
              <div className="text-neutral-300 space-y-0.5" data-testid="two-stage-vs-reference">
                <p>{report.vsReference.patches} patches over 5% cover, {report.vsReference.highPriority} high priority.</p>
                <p><span className="text-neutral-500">High-priority patches inspected:</span> {rateText(report.vsReference.highPriorityRecallRouted)}</p>
                <p><span className="text-neutral-500">All patches inspected:</span> {rateText(report.vsReference.recallRouted)}</p>
                <p><span className="text-neutral-500">Flagged by Stage 1 alone:</span> {rateText(report.vsReference.recallStage1)}</p>
                <p><span className="text-neutral-500">Candidate areas with no weed cover over 1%:</span> {rateText(report.vsReference.falseCandidates)}</p>
                <p><span className="text-neutral-500">Cover per cell, Stage 1 against RF-DETR:</span> off by {report.vsReference.coverMaePp.toFixed(1)} points on average, {report.vsReference.coverBiasPp >= 0 ? "over" : "under"} by {Math.abs(report.vsReference.coverBiasPp).toFixed(1)} overall.</p>
                <p><span className="text-neutral-500">Patch cells in Stage 1's top 10 / 20 / 30%:</span> {report.vsReference.recallAtBudget.map(b => pct(b.recall?.p)).join(" / ")}</p>
                {report.vsReference.missed.length > 0 && (
                  <p className="text-amber-400">Not inspected: {report.vsReference.missed.slice(0, 5).map(m => `${fmtArea(m.areaM2, units).text}${m.highPriority ? " (high priority)" : ""}`).join(", ")}{report.vsReference.missed.length > 5 ? ` and ${report.vsReference.missed.length - 5} more` : ""}.</p>
                )}
              </div>
            )}
          </div>
          {report.audit && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">Random audit</div>
              <p className="text-neutral-300" data-testid="two-stage-audit">RF-DETR found weed cover over 5% in {rateText(report.audit.withPatchCover)} randomly checked cells outside the candidates. That is how often it disagrees with Stage 1 there, not a measured miss rate.</p>
            </div>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500">Against your cell labels</div>
            {!report.labels ? <p className="text-neutral-500">No cells labelled yet.</p> : !report.labels.enough ? (
              <p className="text-neutral-500" data-testid="two-stage-labels-few">{report.labels.n} cells labelled. Label at least 30 before any figure is shown.</p>
            ) : (
              <div className="text-neutral-300 space-y-0.5" data-testid="two-stage-vs-labels">
                <p>{report.labels.n} cells labelled.</p>
                <p><span className="text-neutral-500">Your high-priority cells flagged:</span> {rateText(report.labels.highPriorityRecall)}</p>
                <p><span className="text-neutral-500">Your cells over 5% flagged:</span> {rateText(report.labels.patchRecall)}{report.labels.referencePatchRecall ? `; RF-DETR everywhere: ${rateText(report.labels.referencePatchRecall)}` : ""}</p>
                <p><span className="text-neutral-500">Flagged cells you put under 1%:</span> {rateText(report.labels.falseFlags)}</p>
                <p><span className="text-neutral-500">Cover off by, on average:</span> Stage 1 {report.labels.stage1MaePp?.toFixed(1) ?? "–"} points{report.labels.modelMaePp != null ? `, RF-DETR ${report.labels.modelMaePp.toFixed(1)} points` : ""}.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {st && (
        <div className="space-y-1.5 pt-1">
          <label className="inline-flex items-center gap-1.5 text-neutral-300">
            <input type="checkbox" checked={s.labelMode} onChange={() => patchTwoStage(taskId, x => ({ labelMode: !x.labelMode }))} data-testid="two-stage-label-mode" />
            Label cells (hides the model's layers)
          </label>
          {s.labelMode && (
            <div className="space-y-1.5 rounded-sm border border-[#2a2a2a] p-2.5" data-testid="two-stage-labelling">
              <p className="text-neutral-500">Look at the map only. Pick a random cell, judge its weed cover between the rows, and mark it. Click a cell on the map to change it.</p>
              <div className="flex items-center gap-2">
                <button type="button" className={`${btn} border-[#333] text-neutral-200`} onClick={() => nextRandomCell(taskId)} data-testid="two-stage-next-cell">Next random cell</button>
                <span className="text-neutral-500">{nLabels} labelled</span>
              </div>
              {active && (
                <div className="space-y-1">
                  <div className="flex flex-wrap gap-1">
                    {COVER_CLASSES.map((label, k) => (
                      <button key={label} type="button" onClick={() => labelCell(taskId, active.key, { coverClass: k as 0 | 1 | 2 | 3 | 4, highPriority: activeLabel?.highPriority ?? false })}
                        className={`rounded-sm border px-2 py-0.5 ${activeLabel?.coverClass === k ? "text-black" : "text-neutral-200"}`}
                        style={{ borderColor: LABEL_COLOURS[k], background: activeLabel?.coverClass === k ? LABEL_COLOURS[k] : "transparent" }}>{label}</button>
                    ))}
                  </div>
                  <label className="inline-flex items-center gap-1.5 text-neutral-300">
                    <input type="checkbox" disabled={!activeLabel} checked={!!activeLabel?.highPriority} onChange={() => activeLabel && labelCell(taskId, active.key, { coverClass: activeLabel.coverClass, highPriority: !activeLabel.highPriority })} />
                    Part of a high-priority patch
                  </label>
                  {activeLabel && <button type="button" className="underline text-neutral-500" onClick={() => labelCell(taskId, active.key, null)}>clear this label</button>}
                </div>
              )}
              <div className="flex items-center gap-2">
                <button type="button" className={`${btn} border-[#333] text-neutral-300`} onClick={download} disabled={!nLabels}><Download className="h-3 w-3" /> Export labels</button>
                <button type="button" className={`${btn} border-[#333] text-neutral-300`} onClick={() => fileRef.current?.click()}><Upload className="h-3 w-3" /> Import</button>
                <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={e => void upload(e.target.files?.[0])} />
              </div>
              {importNote && <p className="text-neutral-500">{importNote}</p>}
              <p className="text-neutral-600">Labels are kept in this browser only. Export them to keep them.</p>
            </div>
          )}
          {!s.labelMode && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-neutral-400" data-testid="two-stage-legend">
              <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "linear-gradient(90deg,#ffe600,#ff1e00)" }} /> pressure, low to high</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-3 rounded-sm border-2" style={{ borderColor: TWO_STAGE_COLOURS.candidate, boxShadow: "0 0 0 1px #000" }} /> candidate area</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-3 rounded-sm border-2" style={{ borderColor: TWO_STAGE_COLOURS.highPriority, boxShadow: "0 0 0 1px #000" }} /> high priority</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-3 rounded-sm" style={{ background: "repeating-linear-gradient(135deg,rgba(255,255,255,0.7) 0 1px,transparent 1px 4px)" }} /> uncertain</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-3 rounded-sm border border-white" /> RF-DETR window</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-3 rounded-sm border border-dashed" style={{ borderColor: "#22d3ee" }} /> random audit</span>
            </div>
          )}
          {!s.labelMode && (
            <div className="flex flex-wrap gap-3 text-neutral-400">
              {(["pressure", "candidates", "windows", "weeds"] as const).map(k => (
                <label key={k} className="inline-flex items-center gap-1"><input type="checkbox" checked={s.layers[k]} onChange={() => setLayer(k)} /> {k}</label>
              ))}
            </div>
          )}
          {s.rowsSig && (
            <div className="space-y-0.5" data-testid="two-stage-paint">
              <label className="inline-flex items-center gap-1 text-neutral-400" title="Painting is what Simple mode does. Leaving the crop in and dropping what lands on the rows is the published alternative; run both on the same windows to see what painting changes.">
                <input type="checkbox" checked={s.paintCrop} disabled={s.running} onChange={e => void setPaintCrop(taskId, e.target.checked)} /> paint the crop out before the model
              </label>
              {paintCmp && (
                <p className="text-neutral-500" data-testid="two-stage-paint-compare">
                  On {paintCmp.windows} window{paintCmp.windows === 1 ? "" : "s"} scored both ways: {paintCmp.painted} weeds between the rows with the crop painted out, {paintCmp.unpainted} with it left in ({paintCmp.unpaintedOnRow} more landed on the rows and were dropped). A difference between the rows is the painting's own doing.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </details>
  );
}
