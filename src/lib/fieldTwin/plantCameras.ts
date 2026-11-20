// The cameras a corn build aligned, read back from its analysis record (analysis.ts), for the founder's photographs of
// a selected plant (components/app/fieldTwin/PlantPhotos.tsx). The record's code is loaded only when it is asked for:
// opening a twin does not carry it.
import type { GeorefFrame } from "@/lib/directGeoref/projection";

/** The record's cameras, or null when it is not a record this version reads (the reason is not needed here: no camera, no crops). */
export async function camerasFromAnalysisJson(json: unknown): Promise<GeorefFrame[] | null> {
  if (json == null) return null;
  const { framesFromAnalysis, parseTwinAnalysis } = await import("./analysis");
  const a = parseTwinAnalysis(json);
  return a.ok ? [...framesFromAnalysis(a.analysis).values()] : null;
}

/** One read per twin: the first call reads, later calls share its answer; a read that failed is tried again next time. */
export function cameraSource(read: () => Promise<unknown | null>): () => Promise<GeorefFrame[] | null> {
  let p: Promise<GeorefFrame[] | null> | null = null;
  return () => {
    if (!p) { p = read().then(camerasFromAnalysisJson); p.catch(() => { p = null; }); }
    return p;
  };
}
