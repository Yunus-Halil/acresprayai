// Which photograph to read a finding from, and why.
//
// A finding on the orthomosaic was seen by several frames. The first one, or
// the one whose GPS dot is nearest, is not the best one: a frame that holds
// the finding near its centre at nadir, close to the ground, with a fast
// shutter, is. Every term below comes from the reconstruction or the EXIF;
// terms that need the pixels (sharpness, exposure, occlusion) are left null
// until the frames themselves are retained, and the score says which terms it
// used. The ranking is a suggestion for the diagnostic; nothing downstream
// treats it as a measurement.
import {
  type LatLngAlt, type Projection, type Shot, type SourceFrameSet, fromEnu, projectToFrame, toEnu,
} from "./odm";

export type Finding = {
  centroid: LatLngAlt;
  /** Half the finding's ground span: every point this far from the centroid must be in frame. */
  radiusM: number;
};

export type FrameCandidate = {
  filename: string;
  shot: Shot;
  centre: Projection;
  /** The finding's extent in this frame: all four cardinal points inside. */
  fullyInside: boolean;
  /** Ground metres per pixel at the finding, in the uploaded frame. */
  gsdM: number;
  /** The same, in the frame the camera produced, when EXIF recorded its size. Null otherwise. */
  nativeGsdM: number | null;
  /** Estimated motion blur in uploaded-frame pixels, from speed and shutter. Null when either is unknown. */
  blurPx: number | null;
  score: number;
  parts: Record<string, number | null>;
};

export type SelectionResult = {
  /** Every frame that holds the centroid, best first. */
  candidates: FrameCandidate[];
  best: FrameCandidate | null;
  /** How many frames hold the centroid. Consistency across views is a later version's job. */
  views: number;
};

const WEIGHTS = { coverage: 2.0, centrality: 1.5, resolution: 1.5, viewAngle: 1.0, blur: 1.0 };

/** Ground speed at a shot from its neighbours in time, metres per second. */
function speedAt(set: SourceFrameSet, index: number, ordered: Shot[]): number | null {
  const s = ordered[index];
  const prev = ordered[index - 1], next = ordered[index + 1];
  const pair = next ?? prev;
  if (!pair || s.capturedAt == null || pair.capturedAt == null) return null;
  const dt = Math.abs(pair.capturedAt - s.capturedAt);
  if (dt <= 0 || dt > 30) return null;
  const a = toEnu(s.centre, set.reference), b = toEnu(pair.centre, set.reference);
  return Math.hypot(a[0] - b[0], a[1] - b[1]) / dt;
}

export function selectFrames(set: SourceFrameSet, finding: Finding): SelectionResult {
  const ordered = [...set.shots].sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0));
  const indexOf = new Map(ordered.map((s, i) => [s.filename, i]));
  const c = toEnu(finding.centroid, set.reference);
  const r = finding.radiusM;
  const extent: LatLngAlt[] = r > 0
    ? ([[r, 0], [-r, 0], [0, r], [0, -r]] as const).map(([dx, dy]) => fromEnu([c[0] + dx, c[1] + dy, c[2]], set.reference))
    : [];
  const candidates: FrameCandidate[] = [];
  for (const shot of set.shots) {
    const cam = set.cameras[shot.cameraKey];
    const centre = projectToFrame(set, shot, finding.centroid);
    if (!centre || !centre.inside) continue;
    const fullyInside = extent.every(p => projectToFrame(set, shot, p)?.inside);
    const meta = set.images[shot.filename];
    const nativeScale = meta?.exifWidth && meta.width ? meta.width / meta.exifWidth : null;
    const nativeGsdM = nativeScale ? centre.gsdM * nativeScale : null;
    const speed = speedAt(set, indexOf.get(shot.filename) ?? -1, ordered);
    const blurPx = speed != null && meta?.exposureS ? (speed * meta.exposureS) / centre.gsdM : null;
    // Each part in [0, 1]; null parts are left out of the sum and its weight.
    const halfMin = Math.min(cam.width, cam.height) / 2;
    const parts: Record<string, number | null> = {
      coverage: fullyInside ? 1 : 0,
      centrality: Math.max(0, Math.min(1, centre.edgeDistancePx / halfMin)),
      resolution: null,
      viewAngle: Math.max(0, 1 - centre.viewAngleDeg / 30),
      blur: blurPx == null ? null : Math.max(0, 1 - blurPx / 2),
      sharpness: null, exposure: null, occlusion: null,
    };
    candidates.push({ filename: shot.filename, shot, centre, fullyInside, gsdM: centre.gsdM, nativeGsdM, blurPx, score: 0, parts });
  }
  // Resolution is relative to the best GSD any candidate offers for this finding.
  const bestGsd = Math.min(...candidates.map(k => k.gsdM));
  for (const k of candidates) {
    k.parts.resolution = Number.isFinite(bestGsd) ? Math.max(0, Math.min(1, bestGsd / k.gsdM)) : null;
    let sum = 0, wsum = 0;
    for (const [name, w] of Object.entries(WEIGHTS)) {
      const v = k.parts[name];
      if (v == null) continue;
      sum += w * v; wsum += w;
    }
    k.score = wsum ? sum / wsum : 0;
  }
  candidates.sort((a, b) => b.score - a.score || a.centre.viewAngleDeg - b.centre.viewAngleDeg);
  return { candidates, best: candidates[0] ?? null, views: candidates.length };
}
