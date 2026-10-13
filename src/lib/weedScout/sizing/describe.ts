// A measurement in the operator's words and units. Pure; the popup and the
// closer look compose these, they never compute.
import { type UnitSystem, fmtAreaCm2, fmtLengthCm } from "../../units";
import type { SizeCategory, WeedMeasurement } from "./types";

export const SIZE_CATEGORY_LABEL: Record<SizeCategory, string> = { small: "small", medium: "medium", large: "large" };

/** Why the number should be read with care, in a few words; empty when nothing stands out. */
export function measurementCaveats(m: WeedMeasurement): string[] {
  const q = m.quality;
  if (!q) return [];
  const out: string[] = [];
  if (q.touchingNeighbours > 0) out.push(`touches ${q.touchingNeighbours} other plant${q.touchingNeighbours === 1 ? "" : "s"}`);
  if (q.touchesCrop) out.push("reaches a crop plant");
  if (q.cropContext === "unknown") out.push("crop positions unknown");
  if ((q.pixelsAcross ?? 99) < 12) out.push(`${q.pixelsAcross} px across`);
  if (q.sizeVsExpected != null && q.sizeVsExpected > 3) out.push(`${q.sizeVsExpected.toFixed(1)}x the map's reading`);
  if (q.centreOffsetM != null && q.centreOffsetM > 0.1) out.push(`centred ${Math.round(q.centreOffsetM * 100)} cm from the map's point`);
  if (m.source?.viewAngleDeg != null && m.source.viewAngleDeg > 15) out.push(`${m.source.viewAngleDeg.toFixed(0)}° off nadir`);
  return out;
}

/** One line for the spot: the size, or why there is none. */
export function measurementLine(m: WeedMeasurement | null | undefined, units: UnitSystem): string {
  if (!m) return "Size not measured yet.";
  if (m.status === "unavailable") return `Size not measured: ${m.reason ?? "no photo"}.`;
  if (m.status === "unknown" && m.strip) return `Continuous vegetation, not one plant: ${fmtLengthCm(m.strip.lengthCm, units).text} long, ${fmtLengthCm(m.strip.widthCm, units).text} across, ${fmtAreaCm2(m.strip.areaCm2, units).text} of canopy.`;
  if (m.status === "unknown") return `Size not measured in the photo: ${m.reason ?? "unknown"}.`;
  const d = fmtLengthCm(m.canopyDiameterCm!, units).text, a = fmtAreaCm2(m.canopyAreaCm2!, units).text;
  const cat = m.sizeCategory ? `, ${SIZE_CATEGORY_LABEL[m.sizeCategory]}` : "";
  const caveats = measurementCaveats(m);
  const conf = m.confidence != null ? `confidence ${m.confidence.toFixed(2)}` : "";
  const tail = [conf, ...caveats].filter(Boolean).join("; ");
  return `Canopy ${d} across, ${a}${cat} (measured in the photo${tail ? `; ${tail}` : ""}).`;
}

/** The rows of the measurement table: label and value. */
export function measurementRows(m: WeedMeasurement, units: UnitSystem): [string, string][] {
  const rows: [string, string][] = [];
  const cm = (v: number | null) => (v == null ? "" : fmtLengthCm(v, units).text);
  if (m.status === "measured") {
    rows.push(["Canopy", `${cm(m.canopyDiameterCm)} across, ${fmtAreaCm2(m.canopyAreaCm2!, units).text}`]);
    rows.push(["Longest axis", cm(m.maxExtentCm)]);
    rows.push(["Box (not the canopy)", `${cm(m.boxWidthCm)} × ${cm(m.boxHeightCm)}`]);
    rows.push(["Size class", `${m.sizeCategory} (small to ${cm(m.thresholds.smallMaxCm)}, medium to ${cm(m.thresholds.mediumMaxCm)})`]);
  } else {
    rows.push(["Status", m.status === "unknown" ? "not measured" : "unavailable"]);
    rows.push(["Why", m.reason ?? ""]);
  }
  if (m.clump) rows.push(["Whole clump", `${cm(m.clump.diameterCm)} across, ${m.clump.parts} plants`]);
  if (m.strip) rows.push(["Continuous vegetation", `${cm(m.strip.lengthCm)} long, ${cm(m.strip.widthCm)} across, ${fmtAreaCm2(m.strip.areaCm2, units).text}`]);
  if (m.confidence != null) rows.push(["Confidence", m.confidence.toFixed(2)]);
  if (m.gsdCmPx != null) rows.push(["Pixel size", `${fmtLengthCm(m.gsdCmPx, units).text}/px`]);
  if (m.sourceFrame) rows.push(["Photo", m.sourceFrame + (m.source?.viewAngleDeg != null ? `, ${m.source.viewAngleDeg.toFixed(0)}° from straight down` : "")]);
  if (m.quality) {
    const q = m.quality;
    const flags = [
      q.touchingNeighbours ? `touches ${q.touchingNeighbours} other plant${q.touchingNeighbours === 1 ? "" : "s"}` : "",
      q.touchesCrop ? "reaches a crop plant" : "",
      q.cropContext === "unknown" ? "crop positions unknown" : "",
      q.touchesPhotoEdge ? "cut by the photo's edge" : q.touchesWindowEdge ? "runs past the window" : "",
      q.darkShare > 0.2 ? `${Math.round(q.darkShare * 100)}% of the window in deep shadow` : "",
      q.sizeVsExpected != null ? `${q.sizeVsExpected.toFixed(1)}x the map's reading` : "",
      q.centreOffsetM != null ? `centred ${Math.round(q.centreOffsetM * 100)} cm from the map's point` : "",
    ].filter(Boolean);
    rows.push(["Mask", `${q.pixelsAcross != null ? `${q.pixelsAcross} px across, ` : ""}contrast ${q.maskContrast == null ? "none" : q.maskContrast.toFixed(2)} (threshold from the ${q.thresholdSource === "context" ? "surroundings" : "window"})${flags.length ? "; " + flags.join(", ") : ""}`]);
  }
  rows.push(["Method", `${m.method ?? "none"} (${m.version})`]);
  return rows;
}
