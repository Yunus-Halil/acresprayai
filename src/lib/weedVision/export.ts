// JSON and CSV export of a research preview result. Pure functions plus one browser download helper.
import type { WeedVisionResult } from "./client";

const esc = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const INSTANCE_CSV_COLUMNS = [
  "id", "centroid_x_px", "centroid_y_px", "area_px", "max_span_px", "perpendicular_span_px", "obb_length_px", "obb_width_px", "obb_angle_deg",
  "equivalent_diameter_px", "solidity", "pieces", "touches_border", "tiny", "score", "score_kind", "flags",
] as const;

export function resultToCsv(r: WeedVisionResult): string {
  const head = ["# Weed Vision Research Preview, research-only, pixel units only, no physical calibration",
    `# image ${r.image.filename} ${r.image.width}x${r.image.height}; algorithm ${r.algorithm.name}; processing scale ${r.processing.scale}; run ${r.run_id}; service ${r.versions.service}`];
  const rows = r.instances.map(i => [
    i.id, i.centroid_px[0], i.centroid_px[1], i.area_px, i.max_span_px, i.perpendicular_span_px, i.obb.length_px, i.obb.width_px, i.obb.angle_deg,
    i.equivalent_diameter_px, i.solidity ?? "", i.pieces, i.touches_border, i.tiny, i.score ?? "", i.score_kind, i.flags.join("; "),
  ].map(esc).join(","));
  return [...head, INSTANCE_CSV_COLUMNS.join(","), ...rows].join("\n") + "\n";
}

export function summaryToCsv(r: WeedVisionResult): string {
  const lines = [["key", "value"].join(",")];
  const put = (k: string, v: unknown) => lines.push(`${esc(k)},${esc(v)}`);
  put("image", r.image.filename); put("width_px", r.image.width); put("height_px", r.image.height);
  put("algorithm", r.algorithm.name); put("algorithm_label", r.algorithm.label); put("benchmark", r.algorithm.benchmark);
  put("processing_scale", r.processing.scale); put("processing_width", r.processing.width); put("processing_height", r.processing.height); put("tiles", r.processing.tiles ?? "");
  put("weed_count", r.count);
  for (const [k, v] of Object.entries(r.timings_ms)) put(`timing_ms_${k}`, v);
  put("peak_working_set_mb", r.memory.peak_working_set_mb ?? "");
  put("service_version", r.versions.service); put("lab_version", r.versions.lab);
  if (r.model) put("checkpoint_sha256", r.model.checkpoint_sha256 ?? "");
  r.warnings.forEach((w, i) => put(`warning_${i + 1}`, w));
  put("note", r.measurement_note);
  return lines.join("\n") + "\n";
}

export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
