// Developer check: the ortho chip against the native crop, for the scout's
// top shapes on this scan, scored by the baseline detector through the
// server. The same record and page as `npm run bench:frames`, produced in
// the browser as the signed-in operator. Nothing is saved; the detector's
// boxes decide nothing.
import { useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { runBrowserBench } from "@/lib/sourceFrames/benchBrowser";
import { renderReport } from "@/lib/sourceFrames/benchReport";
import type { BenchRun } from "@/lib/sourceFrames/benchTypes";
import { BASELINE_SETTINGS, detectWithBaseline } from "@/lib/sourceFrames/detectClient";
import type { ScanSources } from "@/lib/sourceFrames/scan";
import type { Candidate } from "@/lib/weedScout/types";

const btn = "inline-flex items-center gap-1.5 text-xs border border-[#333] text-neutral-300 hover:bg-[#1f1f1f] disabled:opacity-40 rounded-sm px-3 py-1.5";

export function BenchmarkPanel({ sources, candidates, scan, verdictOf, stored }: {
  sources: ScanSources | null;
  candidates: Candidate[];
  scan: { taskId: string; odmUuid: string | null; userId: string | null };
  verdictOf: (c: Candidate) => { verdict: string | null; verdictSource: string | null; species: string | null };
  stored: (c: Candidate) => { prediction: unknown; modelVersion: string | null } | null;
}) {
  const [limit, setLimit] = useState(12);
  const [useDetector, setUseDetector] = useState(true);
  const [busy, setBusy] = useState<{ done: number; total: number; line: string } | null>(null);
  const [run, setRun] = useState<BenchRun | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const html = useMemo(() => (run ? renderReport(run) : null), [run]);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!html) { setDownloadUrl(null); return; }
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    setDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [html]);

  const ready = !!sources?.set && candidates.length > 0 && !busy;
  const why = !sources?.set ? "no camera positions for this scan" : !candidates.length ? "scan the field first" : sources.frames ? null : "no originals kept for this scan: crops cannot be cut";

  const start = async () => {
    if (!sources) return;
    setError(null);
    setBusy({ done: 0, total: Math.min(limit, candidates.length), line: "starting" });
    try {
      const result = await runBrowserBench({
        sources, candidates, limit, scan, verdictOf, stored,
        detect: useDetector ? detectWithBaseline : null,
        modelSettings: useDetector ? BASELINE_SETTINGS : null,
        onProgress: (done, total, line) => setBusy({ done, total, line }),
      });
      setRun(result);
      setOpen(true);
    } catch (e) {
      setError((e as Error)?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const s = run?.summary;
  return (
    <details className="text-[11px]" data-testid="benchmark-panel">
      <summary className="cursor-pointer text-neutral-500 hover:text-neutral-300">Benchmark: ortho chip against the native crop</summary>
      <div className="pt-2 space-y-2">
        <p className="text-neutral-500 leading-relaxed">
          For the top shapes, cut the same ground from the kept original photo at the camera's resolution and show it beside the
          map's chip, each with the baseline detector's boxes. A developer check; the detector is not ground truth and decides nothing.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-neutral-400">Shapes
            <input type="number" min={1} max={120} value={limit} onChange={e => setLimit(Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
              className="ml-1 w-14 bg-[#0f0f0f] border border-[#222] rounded-sm px-1.5 py-0.5 text-[11px] text-neutral-200" data-testid="benchmark-limit" />
          </label>
          <label className="text-neutral-400 inline-flex items-center gap-1">
            <input type="checkbox" checked={useDetector} onChange={e => setUseDetector(e.target.checked)} /> baseline detector
          </label>
          <button type="button" className={btn} disabled={!ready} onClick={start} data-testid="benchmark-run">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Compare
          </button>
          {run && <button type="button" className={btn} onClick={() => setOpen(true)}>Open report</button>}
          {downloadUrl && run && (
            <a className={btn} href={downloadUrl} download={`bench-${(scan.odmUuid ?? scan.taskId).slice(0, 8)}-${run.generatedAt.slice(0, 10)}.html`}>
              <Download className="h-3 w-3" /> Save page
            </a>
          )}
        </div>
        {why && !busy && <p className="text-neutral-600">{why}.</p>}
        {busy && <p className="text-neutral-400">{busy.done} of {busy.total}: {busy.line}</p>}
        {error && <p className="text-red-400">{error}</p>}
        {s && (
          <p className="text-neutral-400" data-testid="benchmark-summary">
            {s.findings} run; {Object.entries(s.byStatus).map(([k, v]) => `${k} ${v}`).join(", ")}. Native detections {s.nativeDetections} on {s.nativeWithDetections};
            ortho detections {s.orthoDetections} on {s.orthoWithDetections} of {s.orthoScored} scored.
          </p>
        )}
      </div>
      <Dialog open={open && !!html} onOpenChange={o => setOpen(o)}>
        <DialogContent className="max-w-[94vw] w-[1400px] h-[90vh] bg-[#121212] border-[#222] text-[#f0f0f0] p-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-4 pt-3">
            <DialogTitle className="text-sm">Ortho chip against the native crop</DialogTitle>
            <DialogDescription className="text-[11px] text-neutral-400">The same page `npm run bench:frames` writes, made in this browser. Save page keeps it as a file.</DialogDescription>
          </DialogHeader>
          {html && <iframe title="Benchmark report" srcDoc={html} sandbox="" className="flex-1 w-full border-0 bg-[#111]" data-testid="benchmark-report" />}
        </DialogContent>
      </Dialog>
    </details>
  );
}
