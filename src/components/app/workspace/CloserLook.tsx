// Step two of the two-step look. The map found an area; this shows that area
// in the original photographs the map was built from, at the camera's full
// resolution, with the area's outline drawn where the map put it, and, in
// the pattern view, what the pass sees there: the rows as lines and every
// plant as a circle coloured by what it is. It shows; it does not judge. Nothing here saves anything. On request it asks the
// baseline detector about the crop, through the server, and draws the boxes:
// an experiment's yardstick, never a verdict and never a treatment input.
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type UnitSystem, fmtLengthCm } from "@/lib/units";
import type { ModelResult } from "@/lib/sourceFrames/benchTypes";
import { type CloserLook as Look, renderCloserLook } from "@/lib/sourceFrames/crop";
import { detectWithBaseline } from "@/lib/sourceFrames/detectClient";
import { type GroundedDetection, debugLine, groundDetections } from "@/lib/sourceFrames/detections";
import { lookupOriginal } from "@/lib/sourceFrames/manifest";
import { type ScanSources, downloadFrame } from "@/lib/sourceFrames/scan";
import type { SpotSources } from "@/lib/sourceFrames/spot";
import { BLOB_COLOUR, type PatternCut, type PatternOverlay, ROW_COLOUR, cutPatternWindow, overlayFromPattern, overlayLegend, patternLookSideM } from "@/lib/sourceFrames/patternLook";
import { analysePhotoOffThread } from "@/lib/photoScout/runPattern";
import type { PhotoPattern } from "@/lib/photoScout/pattern";

/** `id` names the finding on the map; the detector's boxes are filed under it. */
export type CloserLookTarget = { id?: string; title: string; spot: SpotSources };

export function CloserLookDialog({ target, sources, units, onClose, onDetections, rowSpacingM = null }: {
  target: CloserLookTarget | null;
  sources: ScanSources | null;
  units: UnitSystem;
  onClose: () => void;
  /** The detector's boxes carried to the ground, for the map's experimental overlay. */
  onDetections?: (list: GroundedDetection[]) => void;
  /** The field's row spacing from the scan's pattern, so the photo is read at it rather than searched. */
  rowSpacingM?: number | null;
}) {
  const [viewIndex, setViewIndex] = useState(0);
  const [look, setLook] = useState<Look | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  // The detector's word on the crop on screen: asked for, never automatic.
  const [detection, setDetection] = useState<{ state: "asking" } | { state: "done"; result: ModelResult; grounded: GroundedDetection[] | null } | null>(null);
  const [copied, setCopied] = useState(false);
  // The pattern view: a wider cut around the spot, read by the pass, drawn as lines and circles.
  const [patternOn, setPatternOn] = useState(true);
  const [patternLook, setPatternLook] = useState<{ cut: PatternCut; pattern: PhotoPattern; overlay: PatternOverlay } | null>(null);
  const [patternState, setPatternState] = useState<"idle" | "reading" | "failed">("idle");
  const frameRef = useRef<Blob | null>(null);
  const views = target?.spot.lookable ?? [];
  const view = views[viewIndex] ?? null;
  const scale = target?.spot.nativeScale ?? null;

  useEffect(() => { setViewIndex(0); setFull(false); }, [target]);
  useEffect(() => { setDetection(null); setCopied(false); }, [look]);

  const askDetector = async () => {
    if (!look || !view || detection?.state === "asking") return;
    setDetection({ state: "asking" });
    const result = await detectWithBaseline(look.clean, "image/jpeg");
    // Each box, back on the ground through the same pose that found this photo.
    // Null when the scan has no ground height: the boxes stay on the photo only.
    const grounded = sources?.set && sources.groundAltM != null && target
      ? groundDetections({
          set: sources.set, shot: view.shot, groundAltM: sources.groundAltM, window: look.window, scale: look.scale,
          detections: result.detections, findingId: target.id ?? target.title, findingTitle: target.title, detectedAt: new Date().toISOString(),
        })
      : null;
    setDetection({ state: "done", result, grounded });
    if (grounded?.length) onDetections?.(grounded);
  };
  const boxes = detection?.state === "done" ? detection.result.detections : [];
  const grounded = detection?.state === "done" ? detection.grounded : null;
  const copyDebug = async () => {
    if (!grounded) return;
    try { await navigator.clipboard.writeText(grounded.map(debugLine).join("\n")); setCopied(true); } catch { setCopied(false); }
  };

  useEffect(() => {
    if (!view || !scale) return;
    const found = lookupOriginal(sources?.frames ?? null, view.filename);
    if (found.ok === false) return;
    const entry = found.entry;
    let cancelled = false;
    let made: string | null = null;
    setLook(null); setError(null); setPatternLook(null); setPatternState("idle"); frameRef.current = null;
    (async () => {
      const blob = await downloadFrame(entry);
      if (!blob) throw new Error("the original photo could not be read from storage");
      frameRef.current = blob;
      const l = await renderCloserLook(blob, view.outlinePx, view.box, scale, view.gsdM, sources?.set?.cameras[view.shot.cameraKey]?.width);
      if (!l) throw new Error("the original photo could not be decoded");
      made = l.url;
      if (cancelled) URL.revokeObjectURL(l.url); else setLook(l);
    })().catch(e => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [view, scale, sources]);

  // The pattern around the spot, read once the photo is on screen: a cut of
  // several row spacings a side at native resolution, at the field's own
  // spacing when the scan knows it, drawn over the photo in the crop's pixels.
  useEffect(() => {
    if (!look || !patternOn || patternLook || patternState !== "idle") return;
    const frame = frameRef.current;
    if (!frame) return;
    let cancelled = false;
    let made: string | null = null;
    setPatternState("reading");
    (async () => {
      const centre = { x: look.window.x + look.window.width / 2, y: look.window.y + look.window.height / 2 };
      const cut = await cutPatternWindow(frame, centre, patternLookSideM(rowSpacingM), look.gsdM);
      if (!cut) throw new Error("no cut");
      made = cut.url;
      const pattern = await analysePhotoOffThread(cut.pixels, { gsdM: cut.gsdM, rowSpacingM: rowSpacingM && rowSpacingM > 0 ? rowSpacingM : "auto", windowM: Math.min(4, (cut.width * cut.gsdM) / 3) });
      if (cancelled) { URL.revokeObjectURL(cut.url); return; }
      setPatternLook({ cut, pattern, overlay: overlayFromPattern(pattern) });
      setPatternState("idle");
    })().catch(() => { if (!cancelled) setPatternState("failed"); });
    return () => { cancelled = true; if (made && cancelled) { /* revoked when the state is replaced */ } };
  }, [look, patternOn, patternLook, patternState, rowSpacingM]);
  useEffect(() => () => { if (patternLook) URL.revokeObjectURL(patternLook.cut.url); }, [patternLook]);

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
          <button type="button" onClick={() => setPatternOn(p => !p)} className={`rounded-sm border px-2 py-1 ${patternOn ? "border-[#ffeb3b] text-[#ffeb3b]" : "border-[#333] text-neutral-300 hover:bg-[#1f1f1f]"}`} data-testid="closer-look-pattern">
            {patternOn ? "Pattern view" : "Show the pattern"}
          </button>
        </div>
        {patternOn && look && (
          <p className="text-[11px] text-neutral-400" data-testid="closer-look-pattern-line">
            {patternState === "reading" && <><Loader2 className="inline h-3 w-3 animate-spin mr-1" /> Reading the rows and plants around this spot in the photo.</>}
            {patternState === "failed" && "The pattern could not be read in this photo."}
            {patternLook && <>{overlayLegend(patternLook.overlay, patternLook.pattern)} Yellow lines are the rows. The dashed outline is the area the map flagged. {gsd(patternLook.cut.gsdM)} here.</>}
          </p>
        )}
        {detection?.state === "done" && (
          <div className="text-[11px] text-neutral-400 space-y-1">
            <p data-testid="closer-look-detection">
              {detectionLine(detection.result)}
              {grounded?.length ? ` ${grounded.filter(g => g.status === "ok").length} of ${grounded.length} placed on the map (experimental overlay).` : ""}
              {detection.result.count > 0 && !grounded ? " Not placed on the map: this scan has no ground height." : ""}
            </p>
            {grounded && grounded.length > 0 && (
              <details data-testid="closer-look-grounded">
                <summary className="cursor-pointer text-neutral-500 hover:text-neutral-300">
                  Where the boxes land: crop px → native px → frame px → ground
                  <button type="button" onClick={e => { e.preventDefault(); copyDebug(); }} className="ml-2 rounded-sm border border-[#333] px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-[#1f1f1f]">
                    {copied ? "copied" : "copy"}
                  </button>
                </summary>
                <table className="mt-1 w-full text-[10px] font-mono text-neutral-300">
                  <thead className="text-neutral-500"><tr><th className="text-left">box</th><th className="text-left">crop</th><th className="text-left">native</th><th className="text-left">frame</th><th className="text-left">ground</th><th className="text-left">size</th></tr></thead>
                  <tbody>
                    {grounded.map((g, i) => (
                      <tr key={g.id} className="border-t border-[#1f1f1f]">
                        <td>{i + 1} {g.klass} {g.confidence.toFixed(2)}</td>
                        <td>{g.cropPx.x.toFixed(0)},{g.cropPx.y.toFixed(0)}</td>
                        <td>{g.nativePx.u.toFixed(0)},{g.nativePx.v.toFixed(0)}</td>
                        <td>{g.framePx.u.toFixed(1)},{g.framePx.v.toFixed(1)}</td>
                        <td>{g.centre ? `${g.centre.lat.toFixed(6)}, ${g.centre.lng.toFixed(6)}` : "off ground"}</td>
                        <td>{g.widthM != null ? `${g.widthM.toFixed(2)}×${g.heightM!.toFixed(2)} m` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-neutral-600 pt-1">Flat ground at {grounded[0].groundAltM.toFixed(1)} m; scale {look?.scale.toFixed(3)} measured on the original ({look?.originalWidth} px wide).</p>
              </details>
            )}
          </div>
        )}
        <div className="rounded-sm border border-[#222] bg-black overflow-auto" style={{ maxHeight: "70vh" }}>
          {error && <p className="p-4 text-[12px] text-red-400">Could not show the photo: {error}</p>}
          {!error && !look && <p className="p-4 text-[12px] text-neutral-400 inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the original photo.</p>}
          {look && patternOn && patternLook && (() => {
            const { cut, overlay } = patternLook;
            const sw = Math.max(1.5, cut.width / 600);
            // The map's outline, from uploaded-frame pixels to this cut's pooled pixels.
            const outline = (view?.outlinePx ?? []).map(p => `${(p.u * look.scale - cut.window.x) / cut.factor},${(p.v * look.scale - cut.window.y) / cut.factor}`).join(" ");
            return (
              <div className="relative" style={full ? { width: cut.width } : { width: "100%" }}>
                <img src={cut.url} alt={`The rows and plants around the flagged area in ${view?.filename}`} data-testid="closer-look-pattern-image"
                  style={full ? { width: cut.width, maxWidth: "none", display: "block" } : { width: "100%", height: "auto", display: "block" }} />
                <svg viewBox={`0 0 ${cut.width} ${cut.height}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none" data-testid="closer-look-pattern-overlay">
                  {overlay.lines.map((l, i) => <line key={`l${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={ROW_COLOUR} strokeWidth={sw} strokeOpacity={0.85} />)}
                  {overlay.circles.map((c, i) => <circle key={`c${i}`} cx={c.x} cy={c.y} r={c.r} fill="none" stroke={BLOB_COLOUR[c.cls]} strokeWidth={sw} strokeOpacity={0.95} />)}
                  {outline && <polygon points={outline} fill="none" stroke="#fbbf24" strokeWidth={sw * 1.5} strokeDasharray={`${sw * 4} ${sw * 2}`} />}
                </svg>
              </div>
            );
          })()}
          {look && !(patternOn && patternLook) && (
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
