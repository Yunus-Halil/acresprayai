// Development only: a stored flight's photographs placed two ways, as the registration leaves them and aligned
// together (fieldTwin/alignTogether.ts), and where a photograph's file is. For the alignment's check scripts.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GeorefFrame } from "../../src/lib/directGeoref/projection";
import { ALIGN_TOGETHER, type AlignReport, type AlignTogetherOptions, alignTogether } from "../../src/lib/fieldTwin/alignTogether";
import { type TwinAnalysis, framesFromAnalysis } from "../../src/lib/fieldTwin/analysis";
import { type CornPhotoRead, FIELD, cornFieldAndGround, cornFlightGuard } from "../../src/lib/fieldTwin/cornField";
import { PLANTS_FIRST, type PhotoShift, type Sight, projectSightings, registerPhotos } from "../../src/lib/fieldTwin/plantsFirst";
import type { LatLngAlt } from "../../src/lib/sourceFrames/odm";

export type AlignStates = { frames: Map<string, GeorefFrame>; photos: string[]; sights: Sight[]; origin: LatLngAlt; directionDeg: number; pitchM: number | null; gateM: number; before: PhotoShift[]; after: PhotoShift[]; report: AlignReport };

/**
 * The photographs' corrections as a build makes them (the guard over the flight, the field's origin, registerPhotos),
 * and with alignTogether after. The field (slow on a large flight) is kept beside the record in `<analysis>.field.json`.
 * `force`: the corrections as fitted, whatever the check says (to look at what it would have done).
 */
export function alignStates(analysisPath: string, force = true, own: Partial<AlignTogetherOptions> = {}): AlignStates {
  const A = JSON.parse(readFileSync(analysisPath, "utf8")) as TwinAnalysis, frames = framesFromAnalysis(A), reads = cornFlightGuard(A.reads as CornPhotoRead[]).reads, cache = `${analysisPath}.field.json`;
  let F: { origin: LatLngAlt; directionDeg: number; pitchM: number | null };
  if (existsSync(cache)) F = JSON.parse(readFileSync(cache, "utf8"));
  else { const { field } = cornFieldAndGround(reads, frames, FIELD); F = { origin: field.origin, directionDeg: field.directionDeg ?? 0, pitchM: field.pitchM ?? null }; writeFileSync(cache, JSON.stringify(F)); }
  const { sights, photos } = projectSightings(reads, frames, F.origin), reg = registerPhotos(sights, photos.length, PLANTS_FIRST);
  const gateM = Math.min(PLANTS_FIRST.gateMax, Math.max(PLANTS_FIRST.gateMin, PLANTS_FIRST.gateTimes * reg.repeatM));
  const T = alignTogether(sights, photos.length, reg.shifts, gateM, { ...ALIGN_TOGETHER, ...own, ...(force ? { minGain: -Infinity, pairsOn: 0 } : {}) });
  return { frames, photos, sights, origin: F.origin, directionDeg: F.directionDeg, pitchM: F.pitchM, gateM, before: reg.shifts, after: T.shifts, report: T.report };
}

/** A photograph's file under `dir` (any depth): the path without its extension, separators as "_", is the name or ends with it. */
export function photoFiles(dir: string): (name: string) => string | null {
  const all: [string, string][] = [];
  const walk = (d: string, rel: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, rel ? `${rel}_${f}` : f); else if (/\.jpe?g$/i.test(f)) all.push([`${rel ? `${rel}_` : ""}${f}`.replace(/\.[^.]+$/, ""), p]); } };
  walk(dir, "");
  return name => all.find(([key]) => key === name || key.endsWith(`_${name}`) || name.endsWith(`_${key}`))?.[1] ?? null;
}
