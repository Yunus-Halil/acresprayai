// The cameras a corn build aligned, and each photograph's own plant marks, read back from its analysis record
// (analysis.ts), for the founder's photographs of a selected plant (components/app/fieldTwin/PlantPhotos.tsx). The
// record's code is loaded only when it is asked for: opening a twin does not carry it.
//
// The marks are there to align each crop: the build registers every photograph against the others and merges their
// marks into the twin's plants, so a plant drawn into one photograph through its camera alone misses that
// photograph's own mark of it (measured on the private seedling flight, 2026-11-19: median 6.1 cm through the camera
// alone, 3.1 cm once the crop is aligned on the photograph's own marks of the plants around it; the rest is the merge
// itself: a plant is the mean of several photographs' marks).
import type { GeorefFrame } from "@/lib/directGeoref/projection";

export type PlantCameras = {
  frames: GeorefFrame[];
  /** Per photograph, the plants it marked itself (its stricter marks and its candidates), in its own pixels. */
  marks: Map<string, [number, number][]>;
};

/** The record's cameras and marks, or null when it is not a record this version reads (no camera, no crops). */
export async function camerasFromAnalysisJson(json: unknown): Promise<PlantCameras | null> {
  if (json == null) return null;
  const { framesFromAnalysis, parseTwinAnalysis } = await import("./analysis");
  const a = parseTwinAnalysis(json);
  if (!a.ok) return null;
  const marks = new Map<string, [number, number][]>();
  for (const r of a.analysis.reads) marks.set(r.name, [...r.plants, ...(r.low ?? [])].map(([x, y]) => [x * r.scale, y * r.scale] as [number, number]));
  return { frames: [...framesFromAnalysis(a.analysis).values()], marks };
}

/** One read per twin: the first call reads, later calls share its answer; a read that failed is tried again next time. */
export function cameraSource(read: () => Promise<unknown | null>): () => Promise<PlantCameras | null> {
  let p: Promise<PlantCameras | null> | null = null;
  return () => {
    if (!p) { p = read().then(camerasFromAnalysisJson); p.catch(() => { p = null; }); }
    return p;
  };
}
