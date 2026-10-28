// Build a Field Twin from a flight's photographs, in the browser: pick the files, name the field, choose whether
// the weed model runs (the local service, development builds only), watch the stages, then save the twin to the
// account or view it as it is. The work runs in a worker (lib/fieldTwin/build/runBuild.ts); this is the panel.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { type BuildResult, type BuildRun, BuildAborted, startTwinBuild } from "@/lib/fieldTwin/build/runBuild";
import type { BuildReport } from "@/lib/fieldTwin/build/pipeline";
import { BUILD_STAGES, type BuildProgress, type BuildStage } from "@/lib/fieldTwin/build/types";
import type { TwinBundle } from "@/lib/fieldTwin/types";
import { fetchHealth } from "@/lib/weedVision/client";
import { weedModelAvailable } from "@/lib/weedVision/flag";

export type BuiltTwin = BuildResult;

type Props = {
  onBuilt: (b: BuiltTwin) => void;
  onClose: () => void;
  /** Development builds: publish the result on window.__twinBuild for the benchmark script. */
  expose?: boolean;
};
declare global { interface Window { __twinBuild?: { report: BuildReport; twin: { trees: number; rows: number; weeds: number; verified: number; atlases: number; blockHa: number | null; rowList: { id: number; kept: boolean; trees: number; photos: number; straightnessSdM: number; reason: string | null }[]; field: TwinBundle["field"] }; atlasesDone: boolean; error?: string } } }

const btn = "inline-flex items-center gap-1.5 rounded-sm border border-[#333] px-2.5 py-1 text-xs text-neutral-300 hover:bg-[#1f1f1f] disabled:opacity-40";
const primary = "inline-flex items-center gap-1.5 rounded-sm bg-[#f0a63a] px-3 py-1 text-xs font-semibold text-[#171a18] disabled:opacity-40";

const fmtMs = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);

export default function TwinBuilder({ onBuilt, onClose, expose = false }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [modelState, setModelState] = useState<"checking" | "ready" | "missing" | "unavailable">(weedModelAvailable() ? "checking" : "unavailable");
  const [weeds, setWeeds] = useState<"model" | "colour" | "none">("colour");
  const [run, setRun] = useState<BuildRun | null>(null);
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  const [doneStages, setDoneStages] = useState<BuildStage[]>([]);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuiltTwin | null>(null);
  const started = useRef<number>(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!weedModelAvailable()) return;
    let live = true;
    fetchHealth().then(h => { if (!live) return; const ready = h.ok && !!h.value.models?.rfdetr?.loaded; setModelState(ready ? "ready" : "missing"); if (ready) setWeeds("model"); });
    return () => { live = false; };
  }, []);

  const pick = (list: FileList | null) => {
    if (!list) return;
    const jpegs = [...list].filter(f => /\.jpe?g$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
    setFiles(jpegs);
    if (!name && jpegs.length) { const folder = (jpegs[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split("/")[0]; if (folder) setName(folder); }
    setError(null); setResult(null);
  };
  const start = () => {
    if (!files.length) { setError("Pick the flight's photographs first (the original JPEG files, straight from the drone)."); return; }
    const fieldName = name.trim() || "Field";
    setError(null); setResult(null); setLines([]); setDoneStages([]); setProgress(null); started.current = Date.now();
    let r: BuildRun;
    try {
      const helpers = Number(new URLSearchParams(window.location.search).get("helpers") ?? "") || undefined;
      r = startTwinBuild(files, { name: fieldName, weeds, helpers }, {
        onProgress: p => { setProgress(prev => { if (prev && prev.stage !== p.stage) setDoneStages(d => (d.includes(prev.stage) ? d : [...d, prev.stage])); return p; }); },
        onLog: line => setLines(l => [...l.slice(-11), line]),
      });
    } catch (e) { setError((e as Error).message); return; }
    setRun(r);
    const summary = (out: BuildResult, atlasesDone: boolean) => ({ report: out.report, twin: { trees: out.twin.trees.length, rows: out.twin.rows.filter(x => x.kept).length, weeds: out.twin.weeds.length, verified: out.twin.weeds.filter(w => w.status === "verified").length, atlases: out.twin.atlases.length, blockHa: out.twin.boundary ? out.twin.boundary.cultivated.areaM2 / 10_000 : null, rowList: out.twin.rows.map(r => ({ id: r.id, kept: r.kept, trees: r.trees, photos: r.photos, straightnessSdM: r.straightnessSdM, reason: r.reason })), field: out.twin.field }, atlasesDone });
    r.done.then(out => {
      setResult(out); setDoneStages(BUILD_STAGES.filter(s => s.id !== "bundle").map(s => s.id)); setRun(null);
      if (expose) window.__twinBuild = summary(out, false);
      out.atlases.then(() => { setDoneStages(BUILD_STAGES.map(s => s.id)); if (expose) window.__twinBuild = summary(out, true); }).catch(() => undefined);
    }).catch(e => { const msg = e instanceof BuildAborted ? "Build cancelled." : (e as Error).message; setError(msg); setRun(null); if (expose) window.__twinBuild = { report: null as unknown as BuildReport, twin: { trees: 0, rows: 0, weeds: 0, verified: 0, atlases: 0, blockHa: null, rowList: [], field: { rowDirectionDeg: 0, rowSpacingM: 0, plantSpacingM: 0 } }, atlasesDone: false, error: msg }; });
  };
  const stageIndex = progress ? BUILD_STAGES.findIndex(s => s.id === progress.stage) : -1;
  const size = files.reduce((s, f) => s + f.size, 0);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 text-sm text-neutral-200" aria-label="Build a Field Twin">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base">Build a twin from photographs</h2>
        <button type="button" className="text-neutral-400 hover:text-neutral-100" onClick={onClose} aria-label="Close the builder" disabled={!!run}><X className="h-4 w-4" /></button>
      </div>
      <p className="text-xs text-neutral-400">The original photographs of one flight, straight from the drone (DJI JPEG files with their position and gimbal angles). The twin is built from them alone: cameras aligned on the soil, rows and trees, weeds when the model is on, the cultivated block. No orthomosaic.</p>

      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileInput} type="file" multiple accept=".jpg,.jpeg,image/jpeg" className="hidden" onChange={e => pick(e.target.files)} />
        <input ref={folderInput} type="file" className="hidden" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={e => pick(e.target.files)} />
        <button type="button" className={btn} onClick={() => fileInput.current?.click()} disabled={!!run}>Pick photographs</button>
        <button type="button" className={btn} onClick={() => folderInput.current?.click()} disabled={!!run}>Pick a folder</button>
        <span className="text-xs text-neutral-400">{files.length ? `${files.length} photographs, ${(size / 1e6).toFixed(0)} MB` : "none picked"}</span>
      </div>
      <label className="block text-xs text-neutral-400">Field name
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Apricot orchard, north block" disabled={!!run} className="mt-0.5 w-full rounded-sm border border-[#3a3f3a] bg-[#111311] px-2 py-1 text-sm text-neutral-100" />
      </label>
      <fieldset className="text-xs text-neutral-300" disabled={!!run}>
        <legend className="text-[11px] text-neutral-400">Weeds</legend>
        {([
          ["colour", "Colour rules, no model (seconds on any computer)", "Green patches over bare soil, between the rows and off the crowns, from the photographs' own pixels. Misses the small, the dark and the yellowing; on the apricot flight it found about three quarters of what the model finds."],
          ["model", "The weed model (RF-DETR through the local service, about 8 s per photograph on this GPU)", modelState === "checking" ? "Checking the local service…" : modelState === "ready" ? "The local weed-vision service is up with RF-DETR loaded. Answers are cached, so a rebuild does not run it again." : modelState === "missing" ? "The local service is not reachable or RF-DETR is not loaded." : "Only in a development build with the local service."],
          ["none", "No weed pass", "Rows, trees, other vegetation and the cultivated block only."],
        ] as const).map(([v, label, hint]) => (
          <label key={v} className="flex items-start gap-2 py-0.5">
            <input type="radio" name="weed-tier" className="mt-0.5 accent-[#f0a63a]" value={v} checked={weeds === v} onChange={() => setWeeds(v)} disabled={v === "model" && modelState !== "ready"} />
            <span>{label}<span className="block text-[10px] leading-snug text-neutral-500">{hint}</span></span>
          </label>
        ))}
      </fieldset>

      {!run && !result && <button type="button" className={primary} onClick={start} disabled={!files.length}>Build the twin</button>}

      {(run || result || progress) && (
        <div className="rounded-md border border-[#2e322e] bg-[#111311] p-3">
          <ol className="space-y-1 text-xs">
            {BUILD_STAGES.map((s, i) => {
              const done = doneStages.includes(s.id) || !!result, active = !result && progress?.stage === s.id;
              return (
                <li key={s.id} className={`flex items-start gap-2 ${done ? "text-neutral-400" : active ? "text-neutral-100" : "text-neutral-600"}`}>
                  <span className="w-4 shrink-0 text-center">{done ? "✓" : active ? <Loader2 className="inline h-3 w-3 animate-spin" /> : i + 1}</span>
                  <span>{s.label}{active && progress ? <span className="block text-[10px] text-neutral-500">{progress.total != null ? `${progress.done} of ${progress.total}: ` : ""}{progress.message} · {fmtMs(Date.now() - started.current)}</span> : null}</span>
                </li>
              );
            })}
          </ol>
          {lines.length > 0 && <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap border-t border-[#2e322e] pt-2 text-[10px] leading-snug text-neutral-500">{lines.join("\n")}</pre>}
          {run && <button type="button" className={`${btn} mt-2`} onClick={() => run.cancel()}>Cancel</button>}
          {stageIndex < 0 && run && <p className="mt-1 text-[10px] text-neutral-500">Starting…</p>}
        </div>
      )}

      {error && <p className="flex items-start gap-1.5 text-xs text-red-400"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</p>}

      {result && (
        <div className="rounded-md border border-[#2e322e] bg-[#111311] p-3 text-xs">
          <p className="font-semibold text-neutral-100">Built in {fmtMs(result.report.totalMs)}</p>
          <ul className="mt-1 space-y-0.5 text-neutral-300">
            <li>{result.report.photographs.read} of {result.report.photographs.given} photographs with a camera{result.report.photographs.refused.length ? ` (${result.report.photographs.refused.length} left out)` : ""}; soil ties agree to {typeof result.report.cameras.residualM === "number" && Number.isFinite(result.report.cameras.residualM) ? `${(result.report.cameras.residualM * 100).toFixed(0)} cm` : "n/a"}</li>
            <li>{result.twin.trees.length} trees on {result.twin.rows.filter(r => r.kept).length} rows{result.twin.field.rowSpacingM ? ` (${result.twin.field.rowSpacingM} m apart, plants ${result.twin.field.plantSpacingM} m)` : ""}</li>
            <li>{result.twin.weeds.length ? `${result.twin.weeds.filter(w => w.status === "verified").length} verified weed candidates of ${result.twin.weeds.length} objects (${result.report.weeds.detections} ${result.twin.stats.weedTier === "colour" ? "green patches, colour rules" : "detections"})` : "no weeds (no weed pass)"}</li>
            <li>{result.report.boundary ? `cultivated block ${(result.report.boundary.areaM2 / 10_000).toFixed(2)} ha, ${Math.round(100 * result.report.boundary.supportPhotographs)} % of the edges seen in the photographs` : "no cultivated block"}</li>
            <li>{result.report.crops} evidence crops in {result.twin.atlases.length} atlases{result.progress.done < result.progress.total ? " (being cut in the background; the twin opens without waiting)" : ""}</li>
          </ul>
          {result.report.notes.length > 0 && <ul className="mt-1.5 space-y-0.5 border-t border-[#2e322e] pt-1.5 text-[10px] leading-snug text-neutral-500">{result.report.notes.map(n => <li key={n}>{n}</li>)}</ul>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" className={primary} onClick={() => onBuilt(result)}>Open and save to my account</button>
            <button type="button" className={btn} onClick={() => { setResult(null); setProgress(null); setDoneStages([]); }}>Build another</button>
          </div>
        </div>
      )}
    </div>
  );
}
