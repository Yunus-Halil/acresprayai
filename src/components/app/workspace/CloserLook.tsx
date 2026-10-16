// Step two of the two-step look. The map found an area; this opens the whole
// original photograph that holds it, at the camera's full resolution, in a
// viewer that zooms under the cursor and pans by dragging, opened on the
// spot with the area's outline drawn where the map put it, and, in the
// pattern view, what the pass sees there: the rows as lines and every plant
// as its own outline coloured by what it is. The scan's photo pass read that
// photo whole during the run and left the spot its look (patternLook.ts), so
// the pattern view opens on it at once; a spot without one has its photo read
// here, whole, once, and the read is kept for the next spot in the same photo.
// It shows; it does not judge. Nothing here saves anything. On request it
// asks the baseline detector about the crop, through the server, and draws
// the boxes: an experiment's yardstick, never a verdict and never a
// treatment input.
import { useEffect, useMemo, useRef, useState } from "react";
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
import { BLOB_COLOUR, CUT_DISPOSITION_COLOUR, type CutDisposition, type CutOutline, type LookCut, type PhotoLook, ROW_COLOUR, cutDisposition, cutLookWindow, lookFromPattern, outlinesInCut, patternLookSideM, significantLook } from "@/lib/sourceFrames/patternLook";
import { STRIP_ELONGATION, STRIP_MIN_LENGTH_M } from "@/lib/weedScout/structure/group";
import { DEFAULT_STRUCTURE_PARAMS } from "@/lib/weedScout/structure/types";
import { analysePhotoOffThread } from "@/lib/photoScout/runPattern";
import { decodePhoto } from "@/lib/photoScout/decode";
import type { PhotoPattern } from "@/lib/photoScout/pattern";
import { type PhotoReadStore, photoPassParams } from "@/lib/weedScout/photoPass";
import type { WeedMeasurement } from "@/lib/weedScout/sizing/types";
import type { ScoutParams } from "@/lib/weedScout/types";
import { storageKey } from "@/lib/storage";
import { type AlgorithmInfo, type Health, type WeedVisionResult, algorithmReady, detectWeeds, fetchAlgorithms, fetchHealth } from "@/lib/weedVision/client";
import { type FrameDetection, countByClass, countByRow } from "@/lib/weedVision/frames";
import { addFrameDetections } from "@/lib/weedVision/frameRunStore";
import { type RowContext, isOnRow, rowContextFromPattern } from "@/lib/weedVision/rowFilter";
import { PLANT_COLOUR } from "../weedVision/ModelDetectionLayer";
import { DEFAULT_FRAME_PARAMS, modelShaFor } from "../weedVision/ModelDetectionsPanel";
import { PhotoViewer } from "./PhotoViewer";

/** The model chosen in the closer look, kept like the other display settings. */
const CLOSER_LOOK_MODEL_KEY = storageKey("weedVision", "closerLookModel");
function loadModelChoice(): { algorithm: string; threshold: number } {
  try {
    const raw = localStorage.getItem(CLOSER_LOOK_MODEL_KEY);
    if (raw) { const p = JSON.parse(raw); if (typeof p.algorithm === "string") return { algorithm: p.algorithm, threshold: typeof p.threshold === "number" ? p.threshold : DEFAULT_FRAME_PARAMS.threshold }; }
  } catch { /* defaults */ }
  return { algorithm: DEFAULT_FRAME_PARAMS.algorithm, threshold: DEFAULT_FRAME_PARAMS.threshold };
}

type ModelRunState =
  | { state: "running"; tilesDone: number; tilesTotal: number | null }
  | { state: "done"; result: WeedVisionResult; grounded: FrameDetection[] | null; ms: number; rowContext: RowContext | null }
  | { state: "error"; error: string };

/** The measured canopy's outline, drawn in this colour: it is neither a row nor a class. */
export const MEASURED_COLOUR = "#ffffff";

/** A photo read whole in this session, kept so the next spot in it opens at once. */
type WholePhotoRead = { pattern: PhotoPattern; nativeScale: number };
const wholePhotoReads = new Map<string, Promise<WholePhotoRead>>();
const WHOLE_PHOTO_READS_KEPT = 4;

/**
 * Read a whole original with the pass, once per photo per session: from the
 * scan's saved reads when it has one (no download, no decode), else from the
 * photo, and then saved for the next time. The pass needs several rows in
 * view, so never a cut. The settings are the run's own, so a read made here
 * and one made by the photo pass are the same read.
 */
function readWholePhoto(
  frame: Blob, filename: string, nativeGsdM: number, passParams: ReturnType<typeof photoPassParams>, store: PhotoReadStore | null, onProgress: (fraction: number) => void,
): Promise<WholePhotoRead> {
  const have = wholePhotoReads.get(filename);
  if (have) return have;
  const p = (async () => {
    const saved = store?.get(filename);
    if (saved) return { pattern: saved.pattern, nativeScale: saved.nativeWidth / saved.decodedWidth };
    const decoded = await decodePhoto(frame);
    decoded.bitmap.close?.();
    const nativeScale = decoded.nativeWidth / decoded.pixels.width;
    const pattern = await analysePhotoOffThread(
      decoded.pixels,
      { gsdM: nativeGsdM * nativeScale, ...passParams },
      { onProgress: (done, total) => onProgress(total ? done / total : 0), transfer: true },
    );
    void store?.put(filename, { pattern, decodedWidth: decoded.pixels.width, nativeWidth: decoded.nativeWidth });
    return { pattern, nativeScale };
  })();
  wholePhotoReads.set(filename, p);
  p.catch(() => wholePhotoReads.delete(filename));
  while (wholePhotoReads.size > WHOLE_PHOTO_READS_KEPT) {
    const oldest = wholePhotoReads.keys().next().value;
    if (oldest == null) break;
    wholePhotoReads.delete(oldest);
  }
  return p;
}

/** Test seam. */
export function resetWholePhotoReads(): void { wholePhotoReads.clear(); }

/** `id` names the finding on the map; the detector's boxes are filed under it. */
export type CloserLookTarget = { id?: string; title: string; spot: SpotSources };

export function CloserLookDialog({ target, sources, units, onClose, onDetections, rowSpacingM = null, spotDiameterM = null, spotLook = null, spotMeasurement = null, passParams = null, readStore = null, minWeedM = 0, modelRun = null, fetchImpl }: {
  target: CloserLookTarget | null;
  sources: ScanSources | null;
  units: UnitSystem;
  onClose: () => void;
  /** The detector's boxes carried to the ground, for the map's experimental overlay. */
  onDetections?: (list: GroundedDetection[]) => void;
  /** The scan this photo belongs to, so a model run on the photo also lands on the map and is saved; null keeps it on the photo. */
  modelRun?: { taskId: string; userId: string | null } | null;
  /** The fetch the model service is reached with (tests). */
  fetchImpl?: typeof fetch;
  /** The field's row spacing from the scan's pattern, so the photo is read at it rather than searched. */
  rowSpacingM?: number | null;
  /** The spot's own size on the map, metres across, for the ring when the photo pass places nothing at it. */
  spotDiameterM?: number | null;
  /** The look the scan's photo pass left on this spot, when it read the spot's photo. */
  spotLook?: PhotoLook | null;
  /** The spot's size measurement, drawn as the canopy's outline when it was measured in the photo on screen. */
  spotMeasurement?: WeedMeasurement | null;
  /** The run's parameters, so a photo read here is read the way the pass reads it. Defaults when absent. */
  passParams?: (Pick<ScoutParams, "rowSpacingAuto" | "rowSpacingM" | "minBlobCm2"> & { structure?: ScoutParams["structure"] }) | null;
  /** The scan's saved photo reads, when signed in. */
  readStore?: PhotoReadStore | null;
  /** Weeds under this many metres across are not drawn in the photo. */
  minWeedM?: number;
}) {
  const [viewIndex, setViewIndex] = useState(0);
  const [look, setLook] = useState<Look | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  // The detector's word on the crop on screen: asked for, never automatic.
  const [detection, setDetection] = useState<{ state: "asking" } | { state: "done"; result: ModelResult; grounded: GroundedDetection[] | null } | null>(null);
  const [copied, setCopied] = useState(false);
  // The pattern view: a wider cut around the spot, read by the pass, drawn as lines and circles.
  const [patternOn, setPatternOn] = useState(true);
  // The diagnostic view: every outline coloured by where it went (crop, candidate, strip, uncertain, filtered, hidden) with the counts.
  const [diagnostic, setDiagnostic] = useState(false);
  const [patternLook, setPatternLook] = useState<{ cut: LookCut; look: PhotoLook; fromRun: boolean; outlines: CutOutline[] | null } | null>(null);
  const [patternState, setPatternState] = useState<"idle" | "reading" | "failed">("idle");
  const [patternProgress, setPatternProgress] = useState<number | null>(null);
  const [patternError, setPatternError] = useState<string | null>(null);
  const frameRef = useRef<Blob | null>(null);
  const views = target?.spot.lookable ?? [];
  const view = views[viewIndex] ?? null;
  const scale = target?.spot.nativeScale ?? null;
  // The local model service: which models it offers and whether each is loaded. Asked once per opening of the dialog.
  const [svc, setSvc] = useState<{ health: Health | null; algorithms: Record<string, AlgorithmInfo>; error: string | null } | null>(null);
  const [modelChoice, setModelChoice] = useState(loadModelChoice);
  const [modelRunState, setModelRunState] = useState<ModelRunState | null>(null);
  const [showModel, setShowModel] = useState(true);
  const [showModelOnRow, setShowModelOnRow] = useState(false);

  useEffect(() => { setViewIndex(0); }, [target]);
  useEffect(() => { setDetection(null); setCopied(false); setModelRunState(null); }, [look]);
  useEffect(() => { try { localStorage.setItem(CLOSER_LOOK_MODEL_KEY, JSON.stringify(modelChoice)); } catch { /* private mode */ } }, [modelChoice]);
  useEffect(() => {
    if (!target) return;
    let on = true;
    const f = fetchImpl ?? fetch;
    (async () => {
      const h = await fetchHealth(f);
      if (!h.ok) { if (on) setSvc({ health: null, algorithms: {}, error: h.error }); return; }
      const a = await fetchAlgorithms(f);
      if (on) setSvc({ health: h.value, algorithms: a.ok ? a.value.algorithms : {}, error: a.ok ? null : a.error });
    })();
    return () => { on = false; };
  }, [target, fetchImpl]);
  const modelInfo = svc?.algorithms[modelChoice.algorithm];
  const modelReady = algorithmReady(modelInfo, svc?.health ?? null);
  const modelChoices = useMemo(() => Object.entries(svc?.algorithms ?? {}).filter(([k]) => k !== "selected").sort(([, a], [, b]) => (a.family === "rfdetr" ? -1 : b.family === "rfdetr" ? 1 : 0)), [svc]);

  /** The chosen model over this whole original photo: outlines on the photo, and on the map when the scan can place them. */
  const runModel = async () => {
    const blob = frameRef.current;
    if (!blob || !view || !modelInfo || modelRunState?.state === "running") return;
    setModelRunState({ state: "running", tilesDone: 0, tilesTotal: null });
    const t0 = Date.now();
    const res = await detectWeeds(blob, view.filename, { algorithm: modelChoice.algorithm, scale: 1, tile: DEFAULT_FRAME_PARAMS.tile, overlap: DEFAULT_FRAME_PARAMS.overlap, threshold: modelChoice.threshold, includeCrop: true },
      { fetchImpl, onProgress: p => setModelRunState(s => (s?.state === "running" ? { state: "running", tilesDone: p.tilesDone, tilesTotal: p.tilesTotal } : s)) });
    if (!res.ok) { setModelRunState({ state: "error", error: res.error }); return; }
    // The photo's rows and crop plants, when this session or the scan has read them: weeds on them are set aside.
    let rowContext: RowContext | null = null;
    try {
      const whole = wholePhotoReads.get(view.filename) ? await wholePhotoReads.get(view.filename)! : null;
      const saved = whole ?? (readStore?.get(view.filename) ? { pattern: readStore.get(view.filename)!.pattern, nativeScale: readStore.get(view.filename)!.nativeWidth / readStore.get(view.filename)!.decodedWidth } : null);
      rowContext = saved ? rowContextFromPattern(saved.pattern, saved.nativeScale) : null;
    } catch { rowContext = null; }
    let grounded: FrameDetection[] | null = null;
    if (modelRun && sources) {
      grounded = await addFrameDetections(modelRun.taskId, {
        userId: modelRun.userId, sources, shot: view.shot, result: res.value,
        params: { ...DEFAULT_FRAME_PARAMS, algorithm: modelChoice.algorithm, threshold: modelChoice.threshold },
        modelSha: modelShaFor(modelInfo, svc?.health ?? null), algorithmLabel: modelInfo.label, rowContext, blob,
      });
    }
    setModelRunState({ state: "done", result: res.value, grounded, ms: Date.now() - t0, rowContext });
  };

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
    setLook(null); setError(null); setPatternLook(null); setPatternState("idle"); frameRef.current = null; setFullUrl(null);
    let whole: string | null = null;
    (async () => {
      const blob = await downloadFrame(entry);
      if (!blob) throw new Error("the original photo could not be read from storage");
      frameRef.current = blob;
      // The whole photo for the viewer: the browser decodes the JPEG itself, nothing is cut.
      whole = URL.createObjectURL(blob);
      if (!cancelled) setFullUrl(whole);
      const l = await renderCloserLook(blob, view.outlinePx, view.box, scale, view.gsdM, sources?.set?.cameras[view.shot.cameraKey]?.width);
      if (!l) throw new Error("the original photo could not be decoded");
      made = l.url;
      if (cancelled) URL.revokeObjectURL(l.url); else setLook(l);
    })().catch(e => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); if (whole) URL.revokeObjectURL(whole); };
  }, [view, scale, sources]);

  // The pattern around the spot, once the photo is on screen. The look the
  // scan left on the spot is drawn at once when it is this photo's; otherwise
  // the whole photo is read here (a cut of a few rows is not enough for the
  // pass to trust a fit) and the same look is built from it.
  //
  // The run is owned by a counter, not by the effect's closure: setting the
  // state to "reading" re-renders the dialog, and an effect that cancelled
  // itself on every re-render threw away every read it finished. That was the
  // spinner that never ended. A read is stale only when a newer one started.
  const patternRun = useRef(0);
  useEffect(() => {
    if (!look || !patternOn || !view) return;
    const frame = frameRef.current;
    if (!frame) return;
    const run = ++patternRun.current;
    const alive = () => patternRun.current === run;
    setPatternLook(null); setPatternState("reading"); setPatternProgress(null); setPatternError(null);
    (async () => {
      let pl: PhotoLook, fromRun = false;
      if (spotLook && spotLook.filename === view.filename) {
        pl = spotLook; fromRun = true;
      } else {
        const centre = { x: look.window.x + look.window.width / 2, y: look.window.y + look.window.height / 2 };
        setPatternProgress(0);
        const pp = photoPassParams(passParams ?? { rowSpacingAuto: true, rowSpacingM: 0.762, minBlobCm2: 1 });
        const read = await readWholePhoto(frame, view.filename, look.gsdM, pp, readStore, f => { if (alive()) setPatternProgress(f); });
        pl = lookFromPattern(read.pattern, { x: centre.x / read.nativeScale, y: centre.y / read.nativeScale, diameterM: spotDiameterM },
          { filename: view.filename, sideM: patternLookSideM(rowSpacingM), nativeScale: read.nativeScale });
      }
      const cut = await cutLookWindow(frame, pl.window);
      if (!cut) throw new Error("the window could not be cut from the photo");
      if (!alive()) { URL.revokeObjectURL(cut.url); return; }
      // The vegetation's own outlines in the cut, classed by the pattern's circles: what is drawn, where they can be made.
      const f = 1 / cut.factor;
      const outlines = outlinesInCut(cut.pixels, pl.gsdM * cut.factor, pl.circles.map(c => ({ ...c, x: c.x * f, y: c.y * f, r: c.r * f })));
      const { pixels: _px, ...cutOnly } = cut;
      setPatternLook({ cut: cutOnly, look: pl, fromRun, outlines });
      setPatternState("idle");
    })().catch(e => { if (alive()) { setPatternState("failed"); setPatternError((e as Error)?.message ?? String(e)); } });
    return () => { patternRun.current++; };
  }, [look, patternOn, view, spotLook, rowSpacingM, spotDiameterM, passParams, readStore]);
  useEffect(() => () => { if (patternLook) URL.revokeObjectURL(patternLook.cut.url); }, [patternLook]);

  const gsd = (m: number | null | undefined) => (m ? `${fmtLengthCm(m * 100, units).text}/px` : "unknown");

  // Where the viewer opens: on the spot, showing the pattern's window around it when there is one, else the map's area with its margin.
  const viewerInitial = useMemo(() => {
    const win = patternOn && patternLook ? patternLook.look.window : look?.window ?? null;
    if (!win) return { cx: 0, cy: 0, fitWidthPx: null };
    return { cx: win.x + win.width / 2, cy: win.y + win.height / 2, fitWidthPx: Math.max(win.width, win.height) };
  }, [patternOn, patternLook, look]);

  // Where each outlined component went, by the rules the structure and the sizer apply; the diagnostic view colours by it and keys the counts.
  const dispositions = useMemo(() => {
    if (!patternLook?.outlines) return null;
    const g = patternLook.look.gsdM * patternLook.cut.factor;
    const list = patternLook.outlines.map(o => cutDisposition(o, g, passParams?.structure?.minPixelsAcross ?? DEFAULT_STRUCTURE_PARAMS.minPixelsAcross, minWeedM, STRIP_MIN_LENGTH_M, STRIP_ELONGATION));
    const counts = new Map<CutDisposition, number>();
    for (const d of list) counts.set(d, (counts.get(d) ?? 0) + 1);
    return { list, counts };
  }, [patternLook, passParams, minWeedM]);

  // Everything drawn over the photo, in its native pixels: the area the map
  // flagged (dashed), the rows, the plants as their own outlines (circles of
  // the equivalent diameter only where the cut could not be outlined), the
  // measured canopy, and the detector's boxes.
  const overlayNodes = useMemo(() => {
    if (!look) return null;
    const nodes: JSX.Element[] = [];
    const thin = { vectorEffect: "non-scaling-stroke" as const };
    if (view && view.outlinePx.length >= 3) {
      nodes.push(<polygon key="area" points={view.outlinePx.map(p => `${p.u * look.scale},${p.v * look.scale}`).join(" ")} fill="none" stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="8 4" {...thin} data-testid="closer-look-area" />);
    }
    if (patternOn && patternLook) {
      const pl = significantLook(patternLook.look, minWeedM);
      const ox = pl.window.x, oy = pl.window.y, f = patternLook.cut.factor;
      pl.lines.forEach((l, i) => nodes.push(<line key={`l${i}`} x1={l.x1 + ox} y1={l.y1 + oy} x2={l.x2 + ox} y2={l.y2 + oy} stroke={ROW_COLOUR} strokeWidth={1.2} {...thin} />));
      if (patternLook.outlines) {
        const g = pl.gsdM * f;
        patternLook.outlines.forEach((o, i) => {
          const cls = o.cls ?? "unplaced";
          const dM = 2 * Math.sqrt((o.areaPx * g * g) / Math.PI);
          const d = dispositions?.list[i];
          // The diagnostic view draws everything, in the colour of its fate; the pattern view keeps the display floor.
          if (!diagnostic && (cls === "off-row" || cls === "between plants") && dM < minWeedM) return;
          const colour = diagnostic && d ? CUT_DISPOSITION_COLOUR[d] : BLOB_COLOUR[cls];
          nodes.push(<polygon key={`o${i}`} points={o.ring.map(q => `${ox + q.x * f},${oy + q.y * f}`).join(" ")} fill="none" stroke={colour} strokeWidth={diagnostic && d === "strip: continuous vegetation" ? 2 : 1.2} strokeDasharray={diagnostic && d === "strip: continuous vegetation" ? "6 3" : undefined} {...thin} />);
        });
      } else {
        pl.circles.forEach((c, i) => nodes.push(<circle key={`c${i}`} cx={c.x + ox} cy={c.y + oy} r={c.r} fill="none" stroke={BLOB_COLOUR[c.cls]} strokeWidth={1.2} {...thin} />));
      }
      if (spotMeasurement?.status === "measured" && spotMeasurement.sourceFrame === view?.filename && spotMeasurement.outlinePx?.length) {
        nodes.push(<polygon key="measured" points={spotMeasurement.outlinePx.map(q => `${q.x},${q.y}`).join(" ")} fill="none" stroke={MEASURED_COLOUR} strokeWidth={2} {...thin} data-testid="closer-look-measured" />);
      }
    }
    if (detection?.state === "done") {
      // The detector saw the map's crop: its boxes are in that crop's pixels, which start at its window's corner.
      detection.result.detections.forEach((d, i) => {
        const x = look.window.x + d.x - d.width / 2, y = look.window.y + d.y - d.height / 2;
        nodes.push(<g key={`d${i}`} data-testid="closer-look-box">
          <rect x={x} y={y} width={d.width} height={d.height} fill="none" stroke="#ff4d6d" strokeWidth={2} {...thin} />
          <text x={x + 2} y={Math.max(12, y - 4)} fill="#ff4d6d" fontSize={Math.max(12, look.originalWidth / 200)} fontFamily="ui-monospace, monospace" stroke="#000" strokeWidth={3} paintOrder="stroke">{d.klass} {d.confidence.toFixed(2)}</text>
        </g>);
      });
    }
    if (showModel && modelRunState?.state === "done") {
      // The model saw the whole original: its outlines are already in this photo's pixels.
      const r = modelRunState.result;
      const font = Math.max(12, look.originalWidth / 220);
      (r.crop_instances ?? []).forEach((c, i) => c.polygons_px.forEach((poly, j) =>
        nodes.push(<polygon key={`mc${i}-${j}`} points={poly.map(p => `${p[0]},${p[1]}`).join(" ")} fill={PLANT_COLOUR.crop} fillOpacity={0.08} stroke={PLANT_COLOUR.crop} strokeWidth={1.2} strokeDasharray="6 4" {...thin} data-testid="closer-look-model-crop" />)));
      // Weeds the photo's pattern puts on a crop plant or a row line are set aside: drawn faint and dashed, only when asked.
      const onRowOf = (w: typeof r.instances[number]) => {
        const g = modelRunState.grounded?.find(d => d.klass === "weed" && d.instanceId === w.id);
        return g ? isOnRow(g.rowStatus) : false;
      };
      r.instances.forEach((w, i) => {
        const onRow = onRowOf(w);
        if (onRow && !showModelOnRow) return;
        w.polygons_px.forEach((poly, j) => nodes.push(<polygon key={`mw${i}-${j}`} points={poly.map(p => `${p[0]},${p[1]}`).join(" ")} fill={PLANT_COLOUR.weed} fillOpacity={onRow ? 0.05 : 0.18} stroke={PLANT_COLOUR.weed} strokeWidth={onRow ? 1.2 : 2} strokeDasharray={onRow ? "6 4" : undefined} {...thin} data-testid={onRow ? "closer-look-model-weed-onrow" : "closer-look-model-weed"} />));
        if (w.score != null && !onRow) nodes.push(<text key={`mt${i}`} x={w.bbox_px[0]} y={Math.max(font, w.bbox_px[1] - 4)} fill={PLANT_COLOUR.weed} fontSize={font} fontFamily="ui-monospace, monospace" stroke="#000" strokeWidth={3} paintOrder="stroke">{w.score.toFixed(2)}</text>);
      });
    }
    return nodes;
  }, [look, view, patternOn, patternLook, minWeedM, spotMeasurement, detection, diagnostic, dispositions, modelRunState, showModel, showModelOnRow]);
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
                {" "}The whole photo is on screen: scroll to zoom, drag to move; the dashed line is the area the map flagged.
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
          <span className="ml-auto inline-flex items-center gap-1.5" data-testid="closer-look-model">
            <select value={modelChoice.algorithm} disabled={modelRunState?.state === "running" || !modelChoices.length} data-testid="closer-look-model-select"
              onChange={e => { const a = svc?.algorithms[e.target.value]; setModelChoice(c => ({ algorithm: e.target.value, threshold: a?.default_threshold ?? c.threshold })); }}
              className="bg-[#0f0f0f] border border-[#333] rounded-sm px-1.5 py-1 text-neutral-200 max-w-[260px]" title={svc?.error ? `The local model service is not running: ${svc.error}` : modelInfo?.description ?? "Choose a model"}>
              {!modelChoices.length && <option value={modelChoice.algorithm}>{svc?.error ? "model service not running" : "loading models…"}</option>}
              {modelChoices.map(([k, a]) => <option key={k} value={k} disabled={!algorithmReady(a, svc?.health ?? null)}>{a.label}{algorithmReady(a, svc?.health ?? null) ? "" : " (not loaded)"}</option>)}
            </select>
            {modelInfo?.family === "rfdetr" && (
              <label className="inline-flex items-center gap-1 text-neutral-400" title="Confidence cut: lower finds more small weeds, higher trusts fewer, surer ones.">
                ≥<input type="number" min={0.1} max={0.9} step={0.05} value={modelChoice.threshold} disabled={modelRunState?.state === "running"} data-testid="closer-look-model-threshold"
                  onChange={e => setModelChoice(c => ({ ...c, threshold: Math.min(0.9, Math.max(0.1, Number(e.target.value) || c.threshold)) }))}
                  className="w-14 bg-[#0f0f0f] border border-[#333] rounded-sm px-1 py-0.5 text-neutral-200" />
              </label>
            )}
            <button type="button" onClick={runModel} disabled={!look || !modelReady || modelRunState?.state === "running"}
              className="rounded-sm border border-[#ffe600] px-2 py-1 text-[#ffe600] hover:bg-[#ffe600]/10 disabled:opacity-40 inline-flex items-center gap-1.5"
              title={!modelReady ? "The model is not loaded on the local service" : "Sends this whole original photo to the chosen model on the local service. Outlines are drawn on the photo and placed on the map; nothing is marked by itself."} data-testid="closer-look-run-model">
              {modelRunState?.state === "running" ? <><Loader2 className="h-3 w-3 animate-spin" /> {modelRunState.tilesTotal ? `tile ${modelRunState.tilesDone}/${modelRunState.tilesTotal}` : "sending"}</> : "Run model on this photo"}
            </button>
          </span>
          <button type="button" onClick={askDetector} disabled={!look || detection?.state === "asking"}
            className="rounded-sm border border-[#333] px-2 py-1 text-neutral-300 hover:bg-[#1f1f1f] disabled:opacity-40 inline-flex items-center gap-1.5"
            title="Sends this crop to the experimental baseline detector through the server. Its boxes are a yardstick, not a verdict." data-testid="closer-look-detect">
            {detection?.state === "asking" && <Loader2 className="h-3 w-3 animate-spin" />} Ask the baseline detector
          </button>
          <button type="button" onClick={() => setPatternOn(p => !p)} className={`rounded-sm border px-2 py-1 ${patternOn ? "border-[#ffeb3b] text-[#ffeb3b]" : "border-[#333] text-neutral-300 hover:bg-[#1f1f1f]"}`} data-testid="closer-look-pattern">
            {patternOn ? "Pattern view" : "Show the pattern"}
          </button>
          {patternOn && patternLook?.outlines && (
            <button type="button" onClick={() => setDiagnostic(d => !d)} className={`rounded-sm border px-2 py-1 ${diagnostic ? "border-[#ab47bc] text-[#ab47bc]" : "border-[#333] text-neutral-300 hover:bg-[#1f1f1f]"}`}
              title="Colour every outlined piece of vegetation by where it went: crop, candidate, a continuous strip, uncertain where no rows were trusted, filtered at the edge or under the measurable size, hidden under the display floor." data-testid="closer-look-diagnostic">
              {diagnostic ? "Diagnostic view" : "Where everything went"}
            </button>
          )}
        </div>
        {patternOn && look && (
          <p className="text-[11px] text-neutral-400" data-testid="closer-look-pattern-line">
            {patternState === "reading" && <><Loader2 className="inline h-3 w-3 animate-spin mr-1" /> {patternProgress == null ? "Opening the pattern around this spot." : `Reading the rows and plants in this whole photo (${Math.round(patternProgress * 100)}%).`}</>}
            {patternState === "failed" && `The pattern could not be read in this photo${patternError ? ` (${patternError})` : ""}.`}
            {patternLook && diagnostic && dispositions && (
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1" data-testid="closer-look-diagnostic-key">
                {(Object.keys(CUT_DISPOSITION_COLOUR) as CutDisposition[]).map(d => (
                  <span key={d} className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 border-2" style={{ borderColor: CUT_DISPOSITION_COLOUR[d], borderRadius: "40% 60% 55% 45%", borderStyle: d.startsWith("strip") ? "dashed" : "solid" }} aria-hidden="true" />
                    {d}<span className="text-neutral-500">{dispositions.counts.get(d) ?? 0}</span>
                  </span>
                ))}
                <span className="text-neutral-500">Every outlined piece of vegetation in this cut, by where it went. Fragments under the component floor are coverage and are not outlined.</span>
              </span>
            )}
            {patternLook && !diagnostic && <PatternKey look={significantLook(patternLook.look, minWeedM)} detail={`${gsd(patternLook.look.gsdM)}${patternLook.outlines ? "; the shapes are the vegetation's own outlines" : "; circles: the cut had no soil-to-plant contrast to outline on"}`} measured={spotMeasurement?.status === "measured" && spotMeasurement.sourceFrame === view?.filename ? spotMeasurement : null} units={units} outlines={!!patternLook.outlines} />}
          </p>
        )}
        {modelRunState?.state === "error" && (
          <p className="text-[11px] text-amber-400" data-testid="closer-look-model-error">The model could not run: {modelRunState.error}</p>
        )}
        {modelRunState?.state === "done" && (() => {
          const r = modelRunState.result;
          const nCrop = r.crop_instances?.length ?? 0;
          const g = modelRunState.grounded;
          const gc = g ? countByClass(g) : null;
          const rows = g ? countByRow(g) : null;
          const offRow = rows ? rows.offRow + rows.noRows : r.count;
          return (
            <p className="text-[11px] text-neutral-300 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="closer-look-model-line">
              <span><span style={{ color: PLANT_COLOUR.weed }} className="font-semibold">{offRow} weed{offRow === 1 ? "" : "s"}{rows && rows.onRow > 0 ? " off the rows" : ""}</span>{r.classes?.includes("crop") ? <> and <span style={{ color: PLANT_COLOUR.crop }}>{nCrop} crop plant{nCrop === 1 ? "" : "s"}</span></> : ""} in this photo</span>
              {rows && rows.onRow > 0 && (
                <label className="inline-flex items-center gap-1 cursor-pointer text-neutral-400" title="The photo's pattern placed these on a crop plant or a row line: most likely the crop. Dashed and faint when shown."><input type="checkbox" checked={showModelOnRow} onChange={e => setShowModelOnRow(e.target.checked)} className="accent-[#ffe600]" data-testid="closer-look-show-onrow" /> {rows.onRow} on the crop rows, set aside</label>
              )}
              {modelRunState.rowContext == null && rows && rows.noRows > 0 && <span className="text-neutral-500">no row read for this photo yet (open the pattern view, or scan the field)</span>}
              <span className="text-neutral-500">{r.algorithm.label} · {(modelRunState.ms / 1000).toFixed(1)} s{r.processing.device ? ` on ${r.processing.device.replace(/ \(.*\)$/, "")}` : ""}{r.processing.threshold != null ? ` · confidence ≥ ${r.processing.threshold}` : ""}</span>
              {gc ? <span className="text-neutral-500">{gc.weed + gc.crop} placed on the map{modelRun?.userId ? " and saved" : ""}; click a plant there for its card.</span> : modelRun ? <span className="text-amber-400">Not placed on the map: this scan has no camera poses or ground height.</span> : null}
              <label className="inline-flex items-center gap-1 cursor-pointer text-neutral-400"><input type="checkbox" checked={showModel} onChange={e => setShowModel(e.target.checked)} className="accent-[#ffe600]" /> outlines on the photo</label>
              {r.warnings.length > 0 && <span className="text-neutral-600" title={r.warnings.join("\n")}>{r.warnings.length} note{r.warnings.length === 1 ? "" : "s"}</span>}
            </p>
          );
        })()}
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
        <div className="rounded-sm border border-[#222] bg-black">
          {error && <p className="p-4 text-[12px] text-red-400">Could not show the photo: {error}</p>}
          {!error && !(look && fullUrl) && <p className="p-4 text-[12px] text-neutral-400 inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the original photo.</p>}
          {look && fullUrl && (
            <PhotoViewer src={fullUrl} width={look.originalWidth} height={look.originalHeight} alt={`The original photo ${view?.filename ?? ""}, opened on the flagged area`}
              initial={viewerInitial} overlay={overlayNodes} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The key to the pattern view, in a row above the photo: one swatch and one word per mark, with how many of each are in the cut. */
export function PatternKey({ look, detail, measured = null, units = "metric", outlines = false }: { look: PhotoLook; detail: string; measured?: WeedMeasurement | null; units?: UnitSystem; /** Whether the plants are drawn as their outlines (true) or as circles of their equivalent diameter. */ outlines?: boolean }) {
  const c = look.counts;
  const shape: "circle" | "blob" = outlines ? "blob" : "circle";
  const items: { colour: string; shape: "line" | "circle" | "outline" | "blob"; label: string; count: number | null }[] = [
    { colour: ROW_COLOUR, shape: "line", label: "Row", count: null },
    { colour: BLOB_COLOUR["on pattern"], shape, label: "Crop plant on the pattern", count: c.onPattern },
    { colour: BLOB_COLOUR["off-row"], shape, label: "Plant off the row", count: c.offRow },
    { colour: BLOB_COLOUR["between plants"], shape, label: "Plant between crop plants", count: c.between },
    { colour: BLOB_COLOUR["double"], shape, label: "Two plants grown together", count: c.doubles },
  ];
  if (outlines) items.push({ colour: BLOB_COLOUR.unplaced, shape, label: "Vegetation the pattern did not place", count: null });
  if (measured?.canopyDiameterCm != null) items.push({ colour: MEASURED_COLOUR, shape: "outline", label: `Measured canopy, ${fmtLengthCm(measured.canopyDiameterCm, units).text} across`, count: null });
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-neutral-300" data-testid="closer-look-key">
      {items.map(it => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          {it.shape === "line"
            ? <span className="inline-block w-5 border-t-2" style={{ borderColor: it.colour }} aria-hidden="true" />
            : it.shape === "outline"
              ? <span className="inline-block h-3 w-3 border-2 border-dashed" style={{ borderColor: it.colour }} aria-hidden="true" />
              : it.shape === "blob"
                ? <span className="inline-block h-3 w-3 border-2" style={{ borderColor: it.colour, borderRadius: "40% 60% 55% 45%" }} aria-hidden="true" />
                : <span className="inline-block h-3 w-3 rounded-full border-2" style={{ borderColor: it.colour }} aria-hidden="true" />}
          {it.label}{it.count != null ? <span className="text-neutral-500">{it.count}</span> : null}
        </span>
      ))}
      <span className="text-neutral-500">{look.blocks === 0 ? "No row pattern was read in this photo." : look.lines.length === 0 ? "The rows do not run through this cut." : ""} {detail}</span>
    </div>
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
