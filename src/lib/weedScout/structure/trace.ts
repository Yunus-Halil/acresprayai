// Where every vegetation component went. A reader looking at a photo with
// some plants outlined and some not deserves to know why, component by
// component: the crop, a weed candidate measured or refused, vegetation the
// pattern could not place, a fragment that went to coverage, an object cut
// by the edge, a plant under the display floor, a strip too long to be one
// plant. Pure; the demo and the closer look both read it.
//
// Nothing here calls a component a weed. "Candidate" is a plant off the
// pattern that a person may call one.
import type { PhotoBlob, PhotoPattern } from "../../photoScout/pattern";
import { DEFAULT_STRUCTURE_PARAMS, type StructureParams } from "./types";
import { STRIP_ELONGATION, STRIP_MIN_LENGTH_M, isStrip } from "./group";

export type Disposition =
  | "crop"
  | "candidate: measured"
  | "candidate: refused"
  | "candidate: not measured"
  | "strip: continuous vegetation"
  | "uncertain: no trusted rows"
  | "filtered: cut by the edge"
  | "filtered: under the measurable size"
  | "hidden: under the display floor";

export const DISPOSITION_COLOUR: Record<Disposition, string> = {
  "crop": "#4CAF50",
  "candidate: measured": "#ef5350",
  "candidate: refused": "#ff00ff",
  "candidate: not measured": "#ffa726",
  "strip: continuous vegetation": "#ff7043",
  "uncertain: no trusted rows": "#9e9e9e",
  "filtered: cut by the edge": "#42a5f5",
  "filtered: under the measurable size": "#ab47bc",
  "hidden: under the display floor": "#ffeb3b",
};

export type TraceOptions = {
  params?: Partial<StructureParams>;
  /** Weeds under this many metres across are hidden by the display setting. */
  displayFloorM?: number;
  /** What the measurement said about a candidate, by the pass blob's id, when it was tried. */
  measured?: Map<number, { status: string; reason: string | null }>;
};

export type TracedComponent = { blob: PhotoBlob; disposition: Disposition; reason: string | null };

export type VegetationTrace = {
  components: TracedComponent[];
  counts: Record<Disposition, number>;
  /** Fragments under the component floor, counted into coverage; never a disposition of their own since they are not components. */
  fragments: number;
  minMeasurableM: number;
  notes: string[];
};

/** One component's fate, by the rules the structure and the sizer apply, in the order they apply them. */
export function dispositionOf(b: PhotoBlob, minMeasurableM: number, displayFloorM: number, measured?: { status: string; reason: string | null } | null): { disposition: Disposition; reason: string | null } {
  if (b.cls === "on pattern" || b.cls === "double") return { disposition: "crop", reason: null };
  if (b.touchesBorder) return { disposition: "filtered: cut by the edge", reason: "touches the photo's edge: size and centre unknown" };
  if (b.cls === "unplaced") return { disposition: "uncertain: no trusted rows", reason: "no row pattern was trusted in its window, so it is vegetation of unknown standing" };
  if (b.widthM != null && b.heightM != null && isStrip(b.equivDiameterM, Math.max(b.widthM, b.heightM))) {
    return { disposition: "strip: continuous vegetation", reason: `${Math.max(b.widthM, b.heightM).toFixed(1)} m long, ${(Math.max(b.widthM, b.heightM) / b.equivDiameterM).toFixed(1)}x its equivalent diameter: not one plant` };
  }
  // A measurement made at the photo's native scale outranks the pass's coarser size floor: a plant the sizer measured is measured.
  if (measured) {
    if (measured.status === "measured") return { disposition: "candidate: measured", reason: b.equivDiameterM < displayFloorM ? `measured; under the ${(displayFloorM * 100).toFixed(0)} cm display floor, so drawn in the diagnostic view only` : null };
    return { disposition: "candidate: refused", reason: measured.reason };
  }
  if (b.equivDiameterM < minMeasurableM) return { disposition: "filtered: under the measurable size", reason: `${(b.equivDiameterM * 100).toFixed(0)} cm across, under ${(minMeasurableM * 100).toFixed(0)} cm at this scale: counted as coverage` };
  if (b.equivDiameterM < displayFloorM) return { disposition: "hidden: under the display floor", reason: `${(b.equivDiameterM * 100).toFixed(0)} cm across, under the ${(displayFloorM * 100).toFixed(0)} cm the display shows` };
  return { disposition: "candidate: not measured", reason: "a candidate the measurement was not asked about" };
}

export function traceVegetation(pattern: PhotoPattern, opts: TraceOptions = {}): VegetationTrace {
  const params = { ...DEFAULT_STRUCTURE_PARAMS, ...(opts.params ?? {}) };
  const minMeasurableM = params.minPixelsAcross * pattern.gsdM;
  const displayFloorM = opts.displayFloorM ?? 0;
  const counts = Object.fromEntries(Object.keys(DISPOSITION_COLOUR).map(k => [k, 0])) as Record<Disposition, number>;
  const components: TracedComponent[] = pattern.blobs.map(blob => {
    const d = dispositionOf(blob, minMeasurableM, displayFloorM, opts.measured?.get(blob.id) ?? null);
    counts[d.disposition]++;
    return { blob, ...d };
  });
  const fragments = pattern.fragments ? pattern.fragments.cells.reduce((n, c) => n + c[2], 0) : pattern.summary.specks;
  const notes: string[] = [];
  const unplaced = counts["uncertain: no trusted rows"];
  if (unplaced) notes.push(`${unplaced} component(s) sit in windows where no row pattern was trusted (${pattern.summary.windows - pattern.summary.usableWindows} of ${pattern.summary.windows} windows): vegetation of unknown standing, neither crop nor candidate.`);
  const strips = counts["strip: continuous vegetation"];
  if (strips) notes.push(`${strips} component(s) are continuous strips (over ${STRIP_MIN_LENGTH_M} m long and ${STRIP_ELONGATION}x their equivalent diameter): represented by length, width and area, never a plant diameter.`);
  notes.push(`${fragments.toLocaleString()} fragments under the component floor are coverage, not components.`);
  return { components, counts, fragments, minMeasurableM, notes };
}

/** The trace's counts as one line. */
export function traceLine(t: VegetationTrace): string {
  return (Object.keys(t.counts) as Disposition[]).filter(k => t.counts[k]).map(k => `${t.counts[k]} ${k}`).join("; ") + `; ${t.fragments.toLocaleString()} fragments as coverage`;
}
