// The page: for each finding, the ortho chip, the native crop, and the native
// crop with the detector's boxes, with the numbers that say what was cut from
// where. Self-contained HTML. On disk the images are files next to the page;
// in the browser they are data URLs and the page is shown in a frame.
import type { BenchRun, Detection, FindingResult, ModelResult } from "./benchTypes";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const cm = (m: number | null | undefined) => (m == null ? "unknown" : `${(m * 100).toFixed(2)} cm/px`);
const pct = (v: number | null | undefined) => (v == null ? "" : `${Math.round(v * 100)}%`);
const fix = (v: number | null | undefined, d = 1) => (v == null ? "unknown" : v.toFixed(d));

function boxes(dets: Detection[]): string {
  return dets.map(d => {
    const x = d.x - d.width / 2, y = d.y - d.height / 2;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${d.width.toFixed(1)}" height="${d.height.toFixed(1)}" class="det"/>` +
      `<text x="${(x + 2).toFixed(1)}" y="${Math.max(10, y - 3).toFixed(1)}" class="lbl">${esc(d.klass)} ${d.confidence.toFixed(2)}</text>`;
  }).join("");
}

function outline(points: { x: number; y: number }[] | null): string {
  if (!points || points.length < 3) return "";
  return `<polygon points="${points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}" class="outline"/>`;
}

function panel(title: string, file: string | null, w: number | null, h: number | null, overlay: string, caption: string): string {
  if (!file || !w || !h) return `<figure class="panel empty"><figcaption><b>${esc(title)}</b><br>${esc(caption)}</figcaption></figure>`;
  return `<figure class="panel"><div class="frame"><img src="${esc(file)}" width="${w}" height="${h}" loading="lazy" alt="${esc(title)}">` +
    `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${overlay}</svg></div><figcaption><b>${esc(title)}</b><br>${esc(caption)}</figcaption></figure>`;
}

function modelLine(m: ModelResult | null): string {
  if (!m) return "not scored";
  if (m.status === "MODEL_SKIPPED") return "detector not run";
  if (m.status === "API_ERROR") return `detector error: ${m.error ?? "unknown"}`;
  return `${m.count} detection${m.count === 1 ? "" : "s"}${m.count ? `, max ${m.maxConfidence!.toFixed(2)}, mean ${m.meanConfidence!.toFixed(2)}` : ""}`;
}

function finding(r: FindingResult): string {
  const nm = r.native?.model ?? null;
  const om = r.ortho.model;
  const orthoCap = r.ortho.status === "OK"
    ? `${cm(r.ortho.gsdM)}, ${fix(r.ortho.spanM)} m across. ${modelLine(om)}`
    : r.ortho.status === "NOT_COMPARED" ? "ortho chip not compared" : r.ortho.status === "NO_ORTHO_CHIP" ? "no chip for this finding" : "the chip could not be read";
  const nativeCap = r.native
    ? `${r.selectedFrame}, ${cm(r.nativeGsdM)} (${fix(r.nativeScale, 2)}x the uploaded frame), ${r.native.width}x${r.native.height} px`
    : `${r.status}${r.reason ? `: ${r.reason}` : ""}`;
  const native = r.native ? panel("Native crop", r.native.file, r.native.width, r.native.height, outline(r.outlineCropPx), nativeCap) : panel("Native crop", null, null, null, "", nativeCap);
  const withDet = r.native
    ? panel("Native crop, detector", r.native.file, r.native.width, r.native.height, outline(r.outlineCropPx) + (nm ? boxes(nm.detections) : ""), modelLine(nm))
    : panel("Native crop, detector", null, null, null, "", "no crop to score");
  const ortho = panel("Ortho chip", r.ortho.file, r.ortho.width, r.ortho.height, outline(r.ortho.outlinePx) + (om ? boxes(om.detections) : ""), orthoCap);
  const rows: [string, string][] = [
    ["Finding", esc(`${r.findingId}${r.rowId ? ` (row ${r.rowId})` : ""}, ${r.kind}${r.findingClass ? `, ${r.findingClass}` : ""}, from ${r.source}`)],
    ["Operator verdict", esc(r.operatorVerdict.verdict ? `${r.operatorVerdict.verdict} (${r.operatorVerdict.verdictSource ?? "source unknown"})${r.operatorVerdict.species ? `, ${r.operatorVerdict.species}` : ""}` : "none recorded")],
    ["Stored prediction", r.storedPrediction ? `${esc(JSON.stringify(r.storedPrediction.prediction))} by ${esc(r.storedPrediction.modelVersion ?? "?")}` : "none"],
    ["Status", esc(`${r.status}${r.reason ? `: ${r.reason}` : ""}`)],
    ["Source frames", esc(`${r.candidateFrames} hold part of the shape; chosen to cover it: ${r.chosenFrames.length ? r.chosenFrames.join(", ") : "none"}; selected ${r.selectedFrame ?? "none"}${r.coverage != null ? ` holding ${pct(r.coverage)}` : ""}`)],
    ["Angles", `ray ${fix(r.viewAngleDeg)}° from straight down; camera ${fix(r.offNadirDeg)}° off nadir`],
    ["Pixels", `ortho ${cm(r.orthoGsdM)}; uploaded frame ${cm(r.uploadedGsdM)}; native ${cm(r.nativeGsdM)}; scale measured ${fix(r.nativeScale, 3)} (EXIF implied ${fix(r.exifScale, 3)})`],
    ["Original", r.originalPath ? esc(`${r.originalPath} (${r.originalSource}, matched by ${r.matchedBy}), ${r.originalBytes} bytes, ${r.originalWidth}x${r.originalHeight}, sha256 ${r.originalSha256}`) : "none"],
    ["Crop window", r.cropWindow ? `x ${r.cropWindow.x}, y ${r.cropWindow.y}, ${r.cropWindow.width}x${r.cropWindow.height} native px` : "none"],
    ["Detector, native", esc(modelLine(nm) + (nm?.modelId ? ` (${nm.modelId})` : ""))],
    ["Detector, ortho", esc(modelLine(om) + (om?.modelId ? ` (${om.modelId})` : ""))],
  ];
  return `<section class="finding ${esc(r.status)}"><h2>${esc(r.findingId)} <span class="status">${esc(r.status)}</span></h2>` +
    `<div class="panels">${ortho}${native}${withDet}</div>` +
    `<table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join("")}</table></section>`;
}

export function renderReport(run: BenchRun): string {
  const s = run.summary;
  const statusRows = Object.entries(s.byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ortho vs native: ${esc(run.scan.odmUuid ?? run.scan.taskId ?? "offline")}</title>
<style>
:root{color-scheme:dark}
body{margin:0;padding:16px;background:#111;color:#eee;font:13px/1.45 system-ui,sans-serif}
h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:0 0 8px;font-family:ui-monospace,monospace}
.muted{color:#9a9a9a}.status{font-weight:normal;color:#9a9a9a;margin-left:8px}
.caveat{border:1px solid #6b4f12;background:#1d1708;padding:8px 12px;border-radius:4px;margin:12px 0}
.summary{display:flex;gap:24px;flex-wrap:wrap;margin:12px 0}
table{border-collapse:collapse;font-size:12px}th{text-align:left;color:#9a9a9a;font-weight:normal;padding:2px 10px 2px 0;vertical-align:top;white-space:nowrap}td{padding:2px 0;word-break:break-all}
.finding{border-top:1px solid #2a2a2a;padding:16px 0}
.finding.SUCCESS h2 .status{color:#7dc37d}.finding.API_ERROR h2 .status,.finding.ORIGINAL_DOWNLOAD_FAILED h2 .status{color:#e07a7a}
.panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin:8px 0 12px}
.panel{margin:0}.panel.empty .frame{display:none}.panel.empty figcaption{border:1px dashed #333;padding:24px 12px;color:#9a9a9a}
.frame{position:relative;background:#000;border:1px solid #333}.frame img{display:block;width:100%;height:auto}
.frame svg{position:absolute;inset:0;width:100%;height:100%}
.outline{fill:none;stroke:#fbbf24;stroke-width:3;stroke-dasharray:12 6;vector-effect:non-scaling-stroke}
.det{fill:none;stroke:#ff4d6d;stroke-width:2;vector-effect:non-scaling-stroke}.lbl{fill:#ff4d6d;font:12px ui-monospace,monospace;paint-order:stroke;stroke:#000;stroke-width:3px}
figcaption{font-size:12px;color:#c8c8c8;margin-top:4px}
</style></head><body>
<h1>Ortho chip against the native crop</h1>
<div class="muted">Scan ${esc(run.scan.taskId ?? "offline")}${run.scan.odmUuid ? `, ODM ${esc(run.scan.odmUuid)}` : ""}; generated ${esc(run.generatedAt)}.
Reconstruction: ${esc(run.scan.reconstruction)}, ${run.scan.posedFrames} posed frames, ground altitude ${run.scan.groundAltM == null ? "unknown" : `${run.scan.groundAltM.toFixed(1)} m`}.
Originals: ${esc(run.scan.originalsSource)}${run.scan.framesKept == null ? ", no frame list" : `, ${run.scan.framesKept} kept`}. Findings: ${esc(run.scan.findingsSource)}.
Detector: ${run.model.configured ? esc(JSON.stringify(run.model.settings)) : "none (geometry and crops only)"}.</div>
<div class="caveat">The detector is an experimental baseline, not ground truth. Its boxes do not change a treatment decision, do not touch an operator's verdict, and are not evidence that weed detection works. This page is about whether the camera's own pixels show more than the map's.</div>
<div class="summary"><table><tr><th>Findings</th><td>${s.findings}</td></tr>${statusRows}</table>
<table><tr><th>Native detections</th><td>${s.nativeDetections} on ${s.nativeWithDetections} findings</td></tr><tr><th>Ortho detections</th><td>${s.orthoDetections} on ${s.orthoWithDetections} of ${s.orthoScored} scored</td></tr></table></div>
${run.notes.length ? `<ul class="muted">${run.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
${run.findings.map(finding).join("\n")}
</body></html>`;
}
