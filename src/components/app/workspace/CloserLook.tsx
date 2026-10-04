// Step two of the two-step look. The map found an area; this shows that area
// in the original photographs the map was built from, at the camera's full
// resolution, with the area's outline drawn where the map put it. It shows;
// it does not judge. Nothing here saves anything. On request it asks the
// baseline detector about the crop, through the server, and draws the boxes:
// an experiment's yardstick, never a verdict and never a treatment input.
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type UnitSystem, fmtLengthCm } from "@/lib/units";
import type { ModelResult } from "@/lib/sourceFrames/benchTypes";
import { type CloserLook as Look, renderCloserLook } from "@/lib/sourceFrames/crop";
import { detectWithBaseline } from "@/lib/sourceFrames/detectClient";
import { lookupOriginal } from "@/lib/sourceFrames/manifest";
import { type ScanSources, downloadFrame } from "@/lib/sourceFrames/scan";
import type { SpotSources } from "@/lib/sourceFrames/spot";

export type CloserLookTarget = { title: string; spot: SpotSources };

export function CloserLookDialog({ target, sources, units, onClose }: {
  target: CloserLookTarget | null;
  sources: ScanSources | null;
  units: UnitSystem;
  onClose: () => void;
}) {
  const [viewIndex, setViewIndex] = useState(0);
  const [look, setLook] = useState<Look | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  // The detector's word on the crop on screen: asked for, never automatic.
  const [detection, setDetection] = useState<{ state: "asking" } | { state: "done"; result: ModelResult } | null>(null);
  const views = target?.spot.lookable ?? [];
  const view = views[viewIndex] ?? null;
  const scale = target?.spot.nativeScale ?? null;

  useEffect(() => { setViewIndex(0); setFull(false); }, [target]);
  useEffect(() => { setDetection(null); }, [look]);

  const askDetector = async () => {
    if (!look || detection?.state === "asking") return;
    setDetection({ state: "asking" });
    const result = await detectWithBaseline(look.clean, "image/jpeg");
    setDetection({ state: "done", result });
  };
  const boxes = detection?.state === "done" ? detection.result.detections : [];

  useEffect(() => {
    if (!view || !scale) return;
    const found = lookupOriginal(sources?.frames ?? null, view.filename);
    if (found.ok === false) return;
    const entry = found.entry;
    let cancelled = false;
    let made: string | null = null;
    setLook(null); setError(null);
    (async () => {
      const blob = await downloadFrame(entry);
      if (!blob) throw new Error("the original photo could not be read from storage");
      const l = await renderCloserLook(blob, view.outlinePx, view.box, scale, view.gsdM);
      if (!l) throw new Error("the original photo could not be decoded");
      made = l.url;
      if (cancelled) URL.revokeObjectURL(l.url); else setLook(l);
    })().catch(e => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [view, scale, sources]);

  const gsd = (m: number | null | undefined) => (m ? `${fmtLengthCm(m * 100, units).text}/px` : "unknown");
  const orthoGsd = target?.spot.orthoGsdM ?? null;

  return (
    <Dialog open={!!target} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[92vw] w-[1200px] bg-[#121212] border-[#222] text-[#f0f0f0]" data-testid="closer-look">
        <DialogHeader>
          <DialogTitle className="text-sm">Closer look: {target?.title}</DialogTitle>
          <DialogDescription className="text-[11px] text-neutral-400">
            {view ? (
              <>
                Original photo <span className="font-mono">{view.filename}</span>, {target?.spot.nearestOnly ? "the nearest photo (the area is not confirmed in it)" : `holding ${Math.round(view.coverage * 100)}% of the area`},
                {" "}{view.viewAngleDeg.toFixed(0)}° from straight down. {look ? `${gsd(look.gsdM)} here` : ""}
                {orthoGsd && look ? `, against ${gsd(orthoGsd)} on the map (${(orthoGsd / look.gsdM).toFixed(1)}x the detail).` : "."}
                {" "}The dashed line is the area the map flagged.
              </>
            ) : noPhotoReason(target?.spot ?? null)}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          {views.map((v, i) => (
            <button key={v.filename} type="button" onClick={() => setViewIndex(i)}
              className={`rounded-sm border px-2 py-1 ${i === viewIndex ? "border-[#4CAF50] text-[#4CAF50]" : "border-[#333] text-neutral-300 hover:bg-[#1f1f1f]"}`}>
              Photo {i + 1} of {views.length} · holds {Math.round(v.coverage * 100)}% · {v.viewAngleDeg.toFixed(0)}°
            </button>
          ))}
          <span className="text-neutral-600">
            {target ? `${target.spot.chosen.length} photo${target.spot.chosen.length === 1 ? "" : "s"} chosen to cover this shape, of ${target.spot.views.length} that saw it` : ""}
            {target && target.spot.chosen.length > views.length ? `; ${target.spot.chosen.length - views.length} not kept as originals.` : "."}
          </span>
          <button type="button" onClick={askDetector} disabled={!look || detection?.state === "asking"}
            className="ml-auto rounded-sm border border-[#333] px-2 py-1 text-neutral-300 hover:bg-[#1f1f1f] disabled:opacity-40 inline-flex items-center gap-1.5"
            title="Sends this crop to the experimental baseline detector through the server. Its boxes are a yardstick, not a verdict." data-testid="closer-look-detect">
            {detection?.state === "asking" && <Loader2 className="h-3 w-3 animate-spin" />} Ask the baseline detector
          </button>
          <button type="button" onClick={() => setFull(f => !f)} className="rounded-sm border border-[#333] px-2 py-1 text-neutral-300 hover:bg-[#1f1f1f]" data-testid="closer-look-zoom">
            {full ? "Fit to window" : "Full resolution"}
          </button>
        </div>
        {detection?.state === "done" && (
          <p className="text-[11px] text-neutral-400" data-testid="closer-look-detection">{detectionLine(detection.result)}</p>
        )}
        <div className="rounded-sm border border-[#222] bg-black overflow-auto" style={{ maxHeight: "70vh" }}>
          {error && <p className="p-4 text-[12px] text-red-400">Could not show the photo: {error}</p>}
          {!error && !look && <p className="p-4 text-[12px] text-neutral-400 inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the original photo.</p>}
          {look && (
            <div className="relative" style={full ? { width: look.width } : { width: "100%" }}>
              <img src={look.url} alt={`The flagged area in ${view?.filename}`} data-testid="closer-look-image"
                style={full ? { width: look.width, maxWidth: "none", display: "block" } : { width: "100%", height: "auto", display: "block" }} />
              {boxes.length > 0 && (
                <svg viewBox={`0 0 ${look.width} ${look.height}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none" data-testid="closer-look-boxes">
                  {boxes.map((d, i) => (
                    <g key={i}>
                      <rect x={d.x - d.width / 2} y={d.y - d.height / 2} width={d.width} height={d.height} fill="none" stroke="#ff4d6d" strokeWidth={Math.max(2, look.width / 300)} />
                      <text x={d.x - d.width / 2 + 2} y={Math.max(12, d.y - d.height / 2 - 4)} fill="#ff4d6d" fontSize={Math.max(12, look.width / 40)} fontFamily="ui-monospace, monospace" stroke="#000" strokeWidth={3} paintOrder="stroke">
                        {d.klass} {d.confidence.toFixed(2)}
                      </text>
                    </g>
                  ))}
                </svg>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One line for the detector's answer, with what it is and is not. */
export function detectionLine(m: ModelResult): string {
  if (m.status === "API_ERROR") return `The detector could not be asked: ${m.error ?? "unknown error"}.`;
  if (m.status === "MODEL_SKIPPED") return "No detector is configured.";
  const model = m.modelId ? ` (${m.modelId})` : "";
  if (!m.count) return `The baseline detector${model} drew no boxes on this crop. A yardstick, not a verdict.`;
  return `The baseline detector${model} drew ${m.count} box${m.count === 1 ? "" : "es"}, highest confidence ${m.maxConfidence!.toFixed(2)}. A yardstick, not a verdict: your call stands.`;
}

/** Why there is nothing to show, in the operator's terms. */
export function noPhotoReason(spot: SpotSources | null): string {
  if (!spot) return "No photo to show.";
  if (spot.unavailable === "no reconstruction") return "No camera positions for this scan: an imported map, or its processing archive is missing, so no photo can be matched.";
  if (spot.unavailable === "no ground height") return "The scan's archive carried no ground sample distance, so photos cannot be matched to this area.";
  if (spot.unavailable === "not seen by any photo" || !spot.chosen.length) return "No photo holds this area.";
  if (!spot.originalsKept) return "The original photos were not kept for this scan. \"Keep original photos\" on the field page adds them.";
  return `${spot.chosen.length} photo${spot.chosen.length === 1 ? "" : "s"} hold this area, but ${spot.chosen.length === 1 ? "its original was" : "their originals were"} not kept.`;
}
