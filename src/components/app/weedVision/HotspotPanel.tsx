// The review areas in the sidebar: the field's one-line summary, the ranked
// list, and the selected area's card: what was measured, why it ranks where
// it does, how sure the model was, which photographs saw it, and the
// operator's own word on it. Confirming an area changes nothing on the field;
// "Mark on the field" is a separate, explicit click that writes an ordinary
// annotation, exactly like a hand-drawn one.
import { useEffect, useState } from "react";
import { Check, HelpCircle, Loader2, MapPin, X } from "lucide-react";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtArea, fmtAreaCm2 } from "@/lib/units";
import type { Hotspot, HotspotReview } from "@/lib/weedVision/hotspots";
import { summaryLine } from "@/lib/weedVision/hotspots";
import { type ViewMode, orphanedReviews, restoreHotspotReviews, reviewHotspot, selectHotspot, setViewMode, useFrameRun } from "@/lib/weedVision/frameRunStore";
import { REVIEW_COLOUR, reviewOf } from "./HotspotLayer";

const MODES: { id: ViewMode; label: string; title: string }[] = [
  { id: "priority", label: "Priority", title: "The areas worth a look, ranked, and nothing else at field zoom" },
  { id: "heatmap", label: "Heatmap", title: "Every occupied cell shaded by candidate weed canopy" },
  { id: "detections", label: "Detections", title: "Every plant the model found: dots zoomed out, outlines zoomed in" },
];

/** Ten buckets of confidence as a tiny text bar. */
function confidenceBar(h: Hotspot): string {
  const n = h.confidence.n;
  if (!n) return "no confidence values";
  return `median ${h.confidence.median!.toFixed(2)}, ${h.confidence.low} of ${n} under review threshold`;
}

export function HotspotPanel({ taskId, userId, onOpenPhotos, onMarkArea }: {
  taskId: string;
  userId: string | null;
  /** Open the area in the original photographs that saw it. */
  onOpenPhotos?: (h: Hotspot) => void;
  /** Write the area to the field as an ordinary annotation; resolves to the annotation id. */
  onMarkArea?: (h: Hotspot) => Promise<string | null>;
}) {
  const run = useFrameRun(taskId);
  const units = useUnitSystem();
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => { void restoreHotspotReviews(taskId); }, [taskId]);
  const hs = run.hotspots;
  const selected = run.selectedHotspotId && hs ? hs.hotspots.find(h => h.id === run.selectedHotspotId) ?? null : null;
  useEffect(() => { setNotes(selected ? run.reviews[selected.id]?.notes ?? "" : ""); setSaveError(null); }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!run.plants.length) return null;
  const orphans = orphanedReviews(run);
  const review = async (h: Hotspot, verdict: HotspotReview | null) => {
    setBusy(h.id);
    const r = await reviewHotspot(taskId, { userId, hotspotId: h.id, verdict, notes });
    setBusy(null);
    setSaveError(r.ok ? null : `Kept for this session; not saved: ${r.error ?? "unknown"}`);
  };
  const btn = "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] disabled:opacity-40";
  return (
    <div className="p-4 border-b border-[#1f1f1f] space-y-2" data-testid="hotspot-panel">
      <div className="flex items-center gap-1" data-testid="view-mode-select">
        <span className="text-[10px] uppercase tracking-wider text-neutral-500 mr-1">View</span>
        {MODES.map(m => (
          <button key={m.id} type="button" onClick={() => setViewMode(taskId, m.id)} title={m.title}
            className={`rounded-sm border px-2 py-0.5 text-[11px] ${run.viewMode === m.id ? "border-[#ff9800] text-[#ff9800]" : "border-[#333] text-neutral-300 hover:bg-[#1f1f1f]"}`}>{m.label}</button>
        ))}
      </div>
      {hs && (
        <p className="text-[12px] text-neutral-200" data-testid="hotspot-summary">{summaryLine(hs.summary)}</p>
      )}
      {hs && hs.summary.rowReadShare < 0.5 && (
        <p className="text-[10px] text-neutral-600">Row context backs {Math.round(hs.summary.rowReadShare * 100)}% of the plants; where it is missing, areas are ranked by density and canopy alone.</p>
      )}
      {hs && run.viewMode === "priority" && !selected && (
        <ol className="space-y-1 max-h-64 overflow-y-auto pr-1" data-testid="hotspot-list">
          {hs.hotspots.map(h => {
            const rv = reviewOf(h, run.reviews);
            return (
              <li key={h.id}>
                <button type="button" onClick={() => selectHotspot(taskId, h.id)} className="w-full text-left rounded-sm border border-[#222] hover:border-[#444] px-2 py-1 text-[11px]">
                  <span className="inline-block w-5 font-semibold" style={{ color: REVIEW_COLOUR[rv] }}>{h.rank}</span>
                  <span className="text-neutral-200">{h.plants} plant{h.plants === 1 ? "" : "s"}</span>
                  <span className="text-neutral-500"> · {fmtArea(h.areaM2, units).text}{h.coveredM2 != null ? ` · ${fmtAreaCm2(h.coveredM2 * 1e4, units).text} canopy` : ""}{h.onRow ? ` · ${h.onRow} to review` : ""}</span>
                  {rv !== "unreviewed" && <span className="ml-1 text-[10px] uppercase tracking-wider" style={{ color: REVIEW_COLOUR[rv] }}>{rv}</span>}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {selected && (() => {
        const rv = reviewOf(selected, run.reviews);
        const h = selected;
        return (
          <div className="space-y-2 rounded-sm border border-[#333] p-2" data-testid="hotspot-card">
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-semibold"><span style={{ color: REVIEW_COLOUR[rv] }}>Area {h.rank}</span> <span className="text-neutral-500 font-normal">of {hs!.hotspots.length} · review priority {(h.priority * 100).toFixed(0)}</span></div>
              <button type="button" onClick={() => selectHotspot(taskId, null)} className="text-[10px] underline text-neutral-500 hover:text-neutral-300" data-testid="back-to-field">back to the field</button>
            </div>
            <div className="text-[11px] text-neutral-300">
              {h.plants} plant{h.plants === 1 ? "" : "s"} in {fmtArea(h.areaM2, units).text}{h.coveredM2 != null ? `, ${fmtAreaCm2(h.coveredM2 * 1e4, units).text} of candidate weed canopy` : ", canopy not measured (no ground sampling)"};
              {" "}{h.observations} sighting{h.observations === 1 ? "" : "s"} in {h.frames.length} photo{h.frames.length === 1 ? "" : "s"}.
            </div>
            <div className="text-[11px] text-neutral-400">
              {h.rowReliable ? <>Rows: {h.offRow} between rows, {h.onRow} on crop plants or row lines{h.noRows ? `, ${h.noRows} unread` : ""}.</> : <>No row read for these photos.</>}
              {" "}Confidence: {confidenceBar(h)}.
            </div>
            <ul className="text-[11px] text-neutral-300 list-disc pl-4 space-y-0.5" data-testid="hotspot-reasons">
              {h.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            <p className="text-[10px] text-neutral-600">Potential weed pressure, not a verdict: the model's classification is uncertain on this crop. Open the photos before deciding.</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {onOpenPhotos && <button type="button" onClick={() => onOpenPhotos(h)} className={`${btn} border-[#4CAF50] text-[#4CAF50] hover:bg-[#4CAF50]/10`} data-testid="hotspot-open-photos">Open the photos</button>}
              <button type="button" onClick={() => void review(h, "confirmed")} disabled={busy === h.id} className={`${btn} ${rv === "confirmed" ? "border-[#4CAF50] text-[#4CAF50]" : "border-[#333] text-neutral-300"}`} data-testid="hotspot-confirm"><Check className="h-3 w-3" /> Confirm</button>
              <button type="button" onClick={() => void review(h, "uncertain")} disabled={busy === h.id} className={`${btn} ${rv === "uncertain" ? "border-[#ffe600] text-[#ffe600]" : "border-[#333] text-neutral-300"}`} data-testid="hotspot-uncertain"><HelpCircle className="h-3 w-3" /> Uncertain</button>
              <button type="button" onClick={() => void review(h, "dismissed")} disabled={busy === h.id} className={`${btn} ${rv === "dismissed" ? "border-neutral-400 text-neutral-300" : "border-[#333] text-neutral-300"}`} data-testid="hotspot-dismiss"><X className="h-3 w-3" /> Dismiss</button>
              {rv !== "unreviewed" && <button type="button" onClick={() => void review(h, null)} className="text-[10px] underline text-neutral-500 hover:text-neutral-300">clear</button>}
              {busy === h.id && <Loader2 className="h-3 w-3 animate-spin text-neutral-500" />}
            </div>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (saved with your review)" className="w-full bg-[#0f0f0f] border border-[#222] rounded-sm px-2 py-1 text-[11px] text-neutral-200" />
            {saveError && <p className="text-[10px] text-amber-400">{saveError}</p>}
            {onMarkArea && (
              run.markedAreas[h.id]
                ? <p className="text-[11px] text-[#4CAF50]">Marked on the field.</p>
                : <button type="button" disabled={rv !== "confirmed"} title={rv !== "confirmed" ? "Confirm the area first" : "Writes an ordinary annotation (issue: Weed pressure) the Field View and the Planner already understand. Nothing else is decided for you."}
                    onClick={async () => { const id = await onMarkArea(h); if (id) { /* the store records it */ } }}
                    className={`${btn} border-[#333] text-neutral-300 hover:bg-[#1f1f1f]`} data-testid="hotspot-mark"><MapPin className="h-3 w-3" /> Mark on the field</button>
            )}
          </div>
        );
      })()}
      {orphans.length > 0 && (
        <p className="text-[10px] text-neutral-600" data-testid="orphaned-reviews">{orphans.length} earlier review{orphans.length === 1 ? "" : "s"} belong to areas that no longer exist in this grouping; they are kept, not applied.</p>
      )}
      {hs && (
        <details className="text-[10px] text-neutral-500" data-testid="hotspot-numbers">
          <summary className="cursor-pointer hover:text-neutral-300">Numbers behind this view</summary>
          <ul className="pl-4 list-disc space-y-0.5 pt-1">
            <li>{run.raw.toLocaleString()} raw observations in {Object.keys(run.frames).length} photos</li>
            <li>{(run.raw - run.plants.length - run.outside).toLocaleString()} repeat sightings merged; {run.outside.toLocaleString()} merged plants outside the field, hidden</li>
            <li>{hs.summary.uniqueWeeds.toLocaleString()} unique weed estimates ({Math.round(hs.summary.rowReadShare * 100)}% with row context) and {run.plants.filter(p => p.klass === "crop").length.toLocaleString()} crop plants</li>
            <li>{hs.summary.areas} review areas on a {hs.params.cellM} m grid (a cell needs {hs.params.minPlants} plants or {hs.params.minCoveredM2} m² canopy); {hs.summary.isolated.toLocaleString()} isolated findings kept outside areas</li>
            <li>priority weights: canopy {hs.params.weights.coveredArea}, density {hs.params.weights.density}, plants {hs.params.weights.plants}, between rows {hs.params.weights.offRow}, low confidence {hs.params.weights.lowConfidence}, sightings {hs.params.weights.observations}</li>
            <li>{run.algorithmLabel ?? "model"}{run.params ? `, confidence ≥ ${run.params.threshold}, ${run.params.tile} px tiles` : ""}</li>
          </ul>
        </details>
      )}
    </div>
  );
}
