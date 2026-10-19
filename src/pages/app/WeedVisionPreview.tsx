// Weed Vision Research Preview: upload a photograph, run the research
// detectors through the local Python service, inspect the result.
//
// TEMPORARY RESEARCH INTEGRATION (branch experiment/weed-vision-preview). Dev
// builds only, behind VITE_WEED_VISION_PREVIEW=true; see src/lib/weedVision/flag.ts
// for the removal list. Nothing here writes to Supabase or touches a field.
// Measurements are pixels: no centimetres, no coordinates, no calibration.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FlaskConical, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PhotoViewer } from "@/components/app/workspace/PhotoViewer";
import { WeedOverlay, RUN_COLOURS } from "@/components/app/weedVision/WeedOverlay";
import { detectWeeds, evaluateWithReference, fetchAlgorithms, fetchHealth, instanceAt, type AlgorithmInfo, type Health, type Progress, type WeedInstance, type WeedVisionResult } from "@/lib/weedVision/client";
import { compareRuns } from "@/lib/weedVision/compare";
import { downloadText, resultToCsv, summaryToCsv } from "@/lib/weedVision/export";

type Loaded = { file: File; url: string; width: number; height: number };

const fmt = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? "–" : n.toFixed(d));

function readDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve({ width: im.naturalWidth, height: im.naturalHeight });
    im.onerror = () => reject(new Error("the browser could not decode this file"));
    im.src = url;
  });
}

export default function WeedVisionPreview() {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [algorithms, setAlgorithms] = useState<Record<string, AlgorithmInfo>>({});
  const [photo, setPhoto] = useState<Loaded | null>(null);
  const [algorithm, setAlgorithm] = useState("selected");
  const [compareWith, setCompareWith] = useState<string>("");
  const [scale, setScale] = useState(1);
  const [tile, setTile] = useState(1024);
  const [overlap, setOverlap] = useState(128);
  const [result, setResult] = useState<WeedVisionResult | null>(null);
  const [second, setSecond] = useState<WeedVisionResult | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState<"detect" | "compare" | "evaluate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [show, setShow] = useState({ outlines: true, fills: false, numbers: true, crops: true, regions: true, secondary: true });
  const [refFile, setRefFile] = useState<File | null>(null);
  const [showDiag, setShowDiag] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const h = await fetchHealth();
      if (!alive) return;
      if (h.ok) { setHealth(h.value); setHealthError(null); } else setHealthError(h.error);
      const a = await fetchAlgorithms();
      if (alive && a.ok) setAlgorithms(a.value.algorithms);
    })();
    return () => { alive = false; };
  }, []);

  const load = useCallback(async (file: File) => {
    setError(null); setResult(null); setSecond(null); setSelectedId(null);
    const url = URL.createObjectURL(file);
    try {
      const dim = await readDimensions(url);
      setPhoto(prev => { if (prev) URL.revokeObjectURL(prev.url); return { file, url, ...dim }; });
    } catch (e) {
      URL.revokeObjectURL(url);
      setError((e as Error).message);
    }
  }, []);

  const onFiles = (files: FileList | null) => { const f = files?.[0]; if (f) void load(f); };

  const run = async (alg: string, slot: "detect" | "compare") => {
    if (!photo) return;
    setError(null); setBusy(slot); setProgress({ phase: "uploading", tilesDone: 0, tilesTotal: null, elapsedMs: 0 });
    abort.current = new AbortController();
    const out = await detectWeeds(photo.file, photo.file.name, { algorithm: alg, scale, tile, overlap }, { onProgress: setProgress, signal: abort.current.signal });
    setBusy(null); setProgress(null);
    if (!out.ok) { setError(out.error); return; }
    if (slot === "detect") { setResult(out.value); setSecond(null); setSelectedId(null); } else setSecond(out.value);
  };

  const evaluate = async () => {
    if (!photo || !refFile) return;
    setError(null); setBusy("evaluate");
    const out = await evaluateWithReference(photo.file, photo.file.name, refFile, refFile.name, { algorithm, scale, tile, overlap });
    setBusy(null);
    if (!out.ok) { setError(out.error); return; }
    setResult(out.value); setSecond(null); setSelectedId(null);
  };

  const cancel = () => { abort.current?.abort(); };
  const clear = () => { setResult(null); setSecond(null); setSelectedId(null); setError(null); };

  const comparison = useMemo(() => (result && second ? compareRuns(result, second) : null), [result, second]);
  const selected: WeedInstance | null = useMemo(() => result?.instances.find(i => i.id === selectedId) ?? null, [result, selectedId]);
  const onPhotoClick = useCallback((x: number, y: number) => {
    if (!result) return;
    const hit = instanceAt(result.instances, x, y);
    setSelectedId(hit ? hit.id : null);
  }, [result]);

  const initial = useMemo(() => ({ cx: (photo?.width ?? 2) / 2, cy: (photo?.height ?? 2) / 2, fitWidthPx: null as number | null }), [photo?.width, photo?.height]);
  const fontPx = Math.max(10, Math.round((photo?.width ?? 1024) / 90));
  const modelOk = health?.model.loaded ?? false;
  const algList = Object.entries(algorithms).filter(([k]) => k !== "selected");

  return (
    <div className="p-8 space-y-6" data-testid="weed-vision-preview">
      <header>
        <h1 className="font-display text-3xl inline-flex items-center gap-2"><FlaskConical className="text-primary" /> Weed Vision Research Preview</h1>
        <p className="text-muted-foreground max-w-3xl mt-1">One photograph, the research detectors, pixel measurements. Nothing here is saved to a field or a scan.</p>
      </header>

      <Card role="status" className="p-4 text-sm border-amber-500/60 bg-amber-500/10" data-testid="research-banner">
        <span className="font-semibold">Research preview, private and non-commercial.</span> The ERFNet checkpoint is a PhenoBench research artefact with unresolved commercial permissions; results are pixel units only, uncalibrated, and not ground truth. Development builds only.
        {healthError && <div className="mt-2 text-red-400 inline-flex items-start gap-2"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span>{healthError}</span></div>}
        {health && !modelOk && <div className="mt-2 text-amber-300/90">Service up, but the ERFNet checkpoint is not loaded: {health.model.error ?? "unknown"}. Colour algorithms still run.</div>}
        {health && modelOk && <div className="mt-2 text-muted-foreground">Service {health.service}, lab {health.lab}, checkpoint {health.model.checkpoint_sha256}, {health.model.threads} threads.</div>}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[20rem_1fr] gap-6">
        <aside className="space-y-4">
          <label className="block rounded-sm border border-dashed border-[#333] p-4 text-sm cursor-pointer hover:bg-[#161616]"
            onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onFiles(e.dataTransfer.files); }}>
            <div className="inline-flex items-center gap-2"><Upload className="h-4 w-4" /> Drop a DJI photograph here or click to choose</div>
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/tiff,.jpg,.jpeg,.png,.tif,.tiff" className="hidden" onChange={e => onFiles(e.target.files)} data-testid="weed-vision-file" />
            {photo && <div className="mt-2 text-muted-foreground">{photo.file.name} · {photo.width} × {photo.height} px · {(photo.file.size / 1048576).toFixed(1)} MB</div>}
          </label>

          <div className="rounded-sm border border-[#222] p-4 space-y-3 text-sm" style={{ background: "#161616" }}>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Algorithm</div>
              <select value={algorithm} onChange={e => setAlgorithm(e.target.value)} className="w-full rounded-sm bg-black border border-[#333] px-2 py-1" data-testid="weed-vision-algorithm">
                <option value="selected">Selected pipeline (ERFNet + 1 px erosion)</option>
                {algList.map(([k, a]) => <option key={k} value={k} disabled={a.needs_model && !modelOk}>{a.label}</option>)}
              </select>
              {algorithms[algorithm === "selected" ? "erfnet_erode1" : algorithm] && <p className="text-xs text-muted-foreground mt-1">{algorithms[algorithm === "selected" ? "erfnet_erode1" : algorithm].description} Benchmark: {algorithms[algorithm === "selected" ? "erfnet_erode1" : algorithm].benchmark}.</p>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs">Scale<input type="number" min={0.1} max={1} step={0.05} value={scale} onChange={e => setScale(Number(e.target.value) || 1)} className="w-full rounded-sm bg-black border border-[#333] px-2 py-1 mt-1" data-testid="weed-vision-scale" /></label>
              <label className="text-xs">Tile px<input type="number" min={256} max={2048} step={8} value={tile} onChange={e => setTile(Number(e.target.value) || 1024)} className="w-full rounded-sm bg-black border border-[#333] px-2 py-1 mt-1" /></label>
              <label className="text-xs">Overlap<input type="number" min={0} max={512} step={8} value={overlap} onChange={e => setOverlap(Number(e.target.value) || 0)} className="w-full rounded-sm bg-black border border-[#333] px-2 py-1 mt-1" /></label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => run(algorithm, "detect")} disabled={!photo || busy !== null} data-testid="weed-vision-detect">
                {busy === "detect" ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Detecting</> : "Detect Weeds"}
              </Button>
              {busy && <Button variant="outline" onClick={cancel}><X className="h-4 w-4 mr-1" /> Cancel</Button>}
              <Button variant="outline" onClick={clear} disabled={!result && !second} data-testid="weed-vision-clear">Clear predictions</Button>
            </div>
            {progress && (
              <div className="text-xs text-muted-foreground" data-testid="weed-vision-progress">
                {progress.phase}{progress.tilesTotal ? ` · tile ${progress.tilesDone}/${progress.tilesTotal}` : ""} · {(progress.elapsedMs / 1000).toFixed(1)} s
                {progress.tilesTotal ? <div className="h-1 mt-1 bg-[#222] rounded"><div className="h-1 bg-primary rounded" style={{ width: `${(100 * progress.tilesDone) / progress.tilesTotal}%` }} /></div> : null}
              </div>
            )}
          </div>

          <div className="rounded-sm border border-[#222] p-4 space-y-2 text-sm" style={{ background: "#161616" }}>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Compare with</div>
            <select value={compareWith} onChange={e => setCompareWith(e.target.value)} className="w-full rounded-sm bg-black border border-[#333] px-2 py-1" data-testid="weed-vision-compare-select">
              <option value="">(choose a second algorithm)</option>
              {algList.map(([k, a]) => <option key={k} value={k} disabled={a.needs_model && !modelOk}>{a.label}</option>)}
            </select>
            <Button variant="outline" onClick={() => run(compareWith, "compare")} disabled={!photo || !result || !compareWith || busy !== null} data-testid="weed-vision-compare">
              {busy === "compare" ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Running</> : "Run comparison"}
            </Button>
            {comparison && second && (
              <div className="text-xs space-y-1" data-testid="weed-vision-comparison">
                <div><span style={{ color: RUN_COLOURS.primary }}>■</span> {result?.algorithm.label}: {comparison.countA} weeds, {fmt(comparison.runtimeMsA, 0)} ms</div>
                <div><span style={{ color: RUN_COLOURS.secondary }}>■</span> {second.algorithm.label}: {comparison.countB} weeds, {fmt(comparison.runtimeMsB, 0)} ms</div>
                <div>Count difference {comparison.countDiff >= 0 ? "+" : ""}{comparison.countDiff} · paired {comparison.pairs.length} · only first {comparison.onlyA.length} · only second {comparison.onlyB.length}</div>
                <div>Paired median area difference {fmt(comparison.medianAreaDiffPx, 0)} px² · span {fmt(comparison.medianSpanDiffPx, 1)} px</div>
                <div className="text-muted-foreground">Pairing by centroid proximity; neither run is ground truth.</div>
              </div>
            )}
          </div>

          <div className="rounded-sm border border-[#222] p-4 space-y-2 text-sm" style={{ background: "#161616" }}>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Reference comparison (optional)</div>
            <p className="text-xs text-muted-foreground">A PNG mask the same size as the photo: 16-bit instance ids, or 8-bit where nonzero is weed. Used for scoring only, after inference.</p>
            <input type="file" accept="image/png,.png" className="text-xs" onChange={e => setRefFile(e.target.files?.[0] ?? null)} data-testid="weed-vision-reference" />
            <Button variant="outline" onClick={evaluate} disabled={!photo || !refFile || busy !== null} data-testid="weed-vision-evaluate">
              {busy === "evaluate" ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Scoring</> : "Detect and score against reference"}
            </Button>
          </div>
        </aside>

        <section className="space-y-3">
          {error && <div className="text-red-400 text-sm inline-flex items-start gap-2" data-testid="weed-vision-error"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span>{error}</span></div>}
          {photo ? (
            <PhotoViewer src={photo.url} width={photo.width} height={photo.height} initial={initial} alt={photo.file.name} heightCss="72vh" onPhotoClick={onPhotoClick}
              overlay={result ? (
                <>
                  {second && show.secondary && <WeedOverlay instances={second.instances} colour={RUN_COLOURS.secondary} outlines={show.outlines} fills={false} numbers={false} testId="weed-vision-overlay-secondary" />}
                  <WeedOverlay instances={result.instances} outlines={show.outlines} fills={show.fills} numbers={show.numbers} selectedId={selectedId}
                    cropRegions={result.crop_regions_px} showCrops={show.crops} evaluation={result.evaluation ?? null} showRegions={show.regions} fontPx={fontPx} />
                </>
              ) : undefined} />
          ) : (
            <div className="rounded-sm border border-[#222] h-[72vh] flex items-center justify-center text-muted-foreground text-sm" style={{ background: "#161616" }}>No photograph loaded.</div>
          )}

          {result && (
            <div className="flex flex-wrap gap-4 text-sm items-center" data-testid="weed-vision-toggles">
              <span className="font-semibold" data-testid="weed-vision-count">{result.count} weeds predicted</span>
              {(["outlines", "fills", "numbers", "crops"] as const).map(k => (
                <label key={k} className="inline-flex items-center gap-1"><input type="checkbox" checked={show[k]} onChange={e => setShow(s => ({ ...s, [k]: e.target.checked }))} /> {k === "crops" ? "crop regions" : k}</label>
              ))}
              {result.evaluation && <label className="inline-flex items-center gap-1"><input type="checkbox" checked={show.regions} onChange={e => setShow(s => ({ ...s, regions: e.target.checked }))} /> TP / FP / missed regions</label>}
              {second && <label className="inline-flex items-center gap-1"><input type="checkbox" checked={show.secondary} onChange={e => setShow(s => ({ ...s, secondary: e.target.checked }))} /> second run (cyan)</label>}
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" onClick={() => downloadText(`${result.image.filename}.${result.algorithm.name}.json`, JSON.stringify(result, null, 1), "application/json")}>Export JSON</Button>
                <Button size="sm" variant="outline" onClick={() => downloadText(`${result.image.filename}.${result.algorithm.name}.instances.csv`, resultToCsv(result), "text/csv")}>Export CSV</Button>
                <Button size="sm" variant="outline" onClick={() => downloadText(`${result.image.filename}.${result.algorithm.name}.summary.csv`, summaryToCsv(result), "text/csv")}>Summary CSV</Button>
                <Button size="sm" variant="outline" onClick={() => setShowDiag(d => !d)}>{showDiag ? "Hide" : "Show"} diagnostics</Button>
              </span>
            </div>
          )}

          {result && result.warnings.length > 0 && (
            <div className="rounded border border-amber-900/50 bg-amber-500/5 p-3 text-xs text-amber-300/90 space-y-1" data-testid="weed-vision-warnings">
              {result.warnings.map((w, i) => <div key={i} className="inline-flex items-start gap-2 w-full"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{w}</div>)}
            </div>
          )}

          {result?.evaluation && (
            <div className="rounded-sm border border-[#222] p-4 text-sm grid grid-cols-2 md:grid-cols-4 gap-2" style={{ background: "#161616" }} data-testid="weed-vision-evaluation">
              <div className="col-span-full text-xs uppercase tracking-wide text-muted-foreground">Against the supplied reference (scoring only)</div>
              <div>Detections at IoU 0.5: TP {result.evaluation.detection["iou_0.5"].tp}, FP {result.evaluation.detection["iou_0.5"].fp}, FN {result.evaluation.detection["iou_0.5"].fn}</div>
              <div>Precision {fmt(result.evaluation.detection["iou_0.5"].precision, 3)} · Recall {fmt(result.evaluation.detection["iou_0.5"].recall, 3)} (at 0.3: {fmt(result.evaluation.detection["iou_0.3"].recall, 3)})</div>
              <div>Mask IoU {fmt(result.evaluation.mask_iou, 3)} · pixel P {fmt(result.evaluation.pixel_precision, 3)} R {fmt(result.evaluation.pixel_recall, 3)}</div>
              <div>Count error {result.evaluation.count_error >= 0 ? "+" : ""}{result.evaluation.count_error} · instance IoU median {fmt(result.evaluation.instance_iou_median, 3)}</div>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-sm border border-[#222] p-4 text-sm" style={{ background: "#161616" }} data-testid="weed-vision-instance">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Selected weed (click the photo)</div>
              {selected ? (
                <table className="text-xs w-full"><tbody>
                  {[
                    ["id", selected.id], ["centroid (x, y) px", `${fmt(selected.centroid_px[0])}, ${fmt(selected.centroid_px[1])}`], ["canopy area", `${fmt(selected.area_px, 0)} px²`],
                    ["max span", `${fmt(selected.max_span_px)} px`], ["perpendicular span", `${fmt(selected.perpendicular_span_px)} px`],
                    ["oriented box", `${fmt(selected.obb?.length_px)} × ${fmt(selected.obb?.width_px)} px at ${fmt(selected.obb?.angle_deg, 0)}°`],
                    ["equivalent diameter", `${fmt(selected.equivalent_diameter_px)} px`], ["solidity", fmt(selected.solidity, 3)], ["pieces", selected.pieces],
                    [selected.score_kind, fmt(selected.score, 3)], ["flags", selected.flags.join("; ") || "none"],
                  ].map(([k, v]) => <tr key={String(k)}><td className="text-muted-foreground pr-3 py-0.5">{k}</td><td className="font-mono">{v as string}</td></tr>)}
                </tbody></table>
              ) : <div className="text-muted-foreground text-xs">Nothing selected. Pixel units only; no calibration was applied.</div>}
            </div>
            <div className="rounded-sm border border-[#222] p-4 text-sm" style={{ background: "#161616" }}>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Run</div>
              {result ? (
                <table className="text-xs w-full"><tbody>
                  {[
                    ["algorithm", result.algorithm.label], ["image", `${result.image.width} × ${result.image.height} px, ${result.image.format ?? "?"}`],
                    ["processing", `scale ${result.processing.scale} → ${result.processing.width} × ${result.processing.height} px${result.processing.tiles ? `, ${result.processing.tiles} tiles of ${result.processing.tile_px} px, overlap ${result.processing.overlap_px}` : ""}`],
                    ["total time", `${fmt(result.timings_ms.total, 0)} ms`], ["inference", `${fmt(result.timings_ms.inference_forward, 0)} ms forward, ${fmt(result.timings_ms.inference_preprocess, 0)} ms preprocess, ${fmt(result.timings_ms.inference_blend, 0)} ms blend`],
                    ["post-processing", `${fmt(result.timings_ms.postprocess_mask, 0)} ms mask, ${fmt(result.timings_ms.components, 0)} ms components, ${fmt(result.timings_ms.geometry_and_polygons, 0)} ms geometry`],
                    ["memory", `${fmt(result.memory.peak_working_set_mb, 0)} MB peak working set (service)`], ["versions", `${result.versions.service}, ${result.versions.lab}${result.model ? `, ckpt ${result.model.checkpoint_sha256}` : ""}`],
                    ["pixel fractions", `weed ${fmt((result.pixel_fractions.weed ?? 0) * 100, 2)}%, crop ${fmt((result.pixel_fractions.crop ?? 0) * 100, 2)}%`],
                  ].map(([k, v]) => <tr key={k}><td className="text-muted-foreground pr-3 py-0.5 align-top">{k}</td><td className="font-mono break-all">{v}</td></tr>)}
                </tbody></table>
              ) : <div className="text-muted-foreground text-xs">No run yet.</div>}
              {showDiag && result && <pre className="mt-3 text-[10px] leading-tight overflow-auto max-h-64 bg-black p-2 rounded" data-testid="weed-vision-diagnostics">{JSON.stringify({ timings_ms: result.timings_ms, processing: result.processing, memory: result.memory, model: result.model, separation: result.algorithm.separation, exif: result.image.exif }, null, 1)}</pre>}
            </div>
          </div>

          {result && result.instances.length > 0 && (
            <div className="rounded-sm border border-[#222] p-2 text-xs overflow-auto max-h-64" style={{ background: "#161616" }} data-testid="weed-vision-table">
              <table className="w-full"><thead><tr className="text-muted-foreground text-left"><th>id</th><th>x</th><th>y</th><th>area px²</th><th>max span px</th><th>perp. px</th><th>box px</th><th>score</th><th>flags</th></tr></thead><tbody>
                {result.instances.map(i => (
                  <tr key={i.id} onClick={() => setSelectedId(i.id)} className={`cursor-pointer hover:bg-[#1f1f1f] ${i.id === selectedId ? "bg-[#2a1f2a]" : ""}`}>
                    <td className="font-mono">{i.id}</td><td>{fmt(i.centroid_px[0], 0)}</td><td>{fmt(i.centroid_px[1], 0)}</td><td>{fmt(i.area_px, 0)}</td><td>{fmt(i.max_span_px)}</td><td>{fmt(i.perpendicular_span_px)}</td><td>{fmt(i.obb?.length_px, 0)}×{fmt(i.obb?.width_px, 0)}</td><td>{fmt(i.score, 2)}</td><td className="text-amber-300/80">{i.flags.length ? i.flags.length : ""}</td>
                  </tr>))}
              </tbody></table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
