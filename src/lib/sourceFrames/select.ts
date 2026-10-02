// Which photograph to read a finding from, and why.
//
// Two entry points. `selectFramesForArea` is the one the product uses: a
// finding is an area on the map, and the photographs that hold it are ranked
// by how much of it they hold. `selectFrames` ranks by a point and a radius
// and is kept for the per-point geometry checks.
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

/** One photograph's view of an area: where its outline lands and how much of it the frame holds. */
export type AreaView = {
  filename: string;
  shot: Shot;
  /** The outline in the uploaded frame's pixels, every vertex, inside or not. */
  outlinePx: { u: number; v: number }[];
  /** Fraction of outline vertices inside the frame, 0..1. */
  coverage: number;
  /** Which outline vertices the frame holds, in outline order. */
  insideMask: boolean[];
  /** The outline's bounding box in uploaded-frame pixels, clamped to the frame. */
  box: { x0: number; y0: number; x1: number; y1: number };
  viewAngleDeg: number;
  /** Ground metres per pixel at the area's centre, uploaded frame. */
  gsdM: number;
  score: number;
};

/**
 * The photographs that saw an area, best first. An area is an outline on the
 * ground (a finding's region, or a square around a point). The best view
 * holds all of it; then the least tilted, the most central, the finest. A
 * large area may be held by no single frame, so coverage is reported rather
 * than required.
 */
export function selectFramesForArea(set: SourceFrameSet, outline: LatLngAlt[], centre: LatLngAlt): AreaView[] {
  if (!outline.length) return [];
  const found: { view: AreaView; centrality: number }[] = [];
  for (const shot of set.shots) {
    const cam = set.cameras[shot.cameraKey];
    const mid = projectToFrame(set, shot, centre);
    if (!mid) continue;
    const projected = outline.map(p => projectToFrame(set, shot, p));
    if (projected.some(q => !q)) continue;
    const pts = projected.map(q => ({ u: q!.u, v: q!.v }));
    const insideMask = projected.map(q => q!.inside);
    const inside = insideMask.filter(Boolean).length;
    if (inside === 0) continue;
    const us = pts.map(p => p.u), vs = pts.map(p => p.v);
    const box = {
      x0: Math.max(0, Math.min(...us)), y0: Math.max(0, Math.min(...vs)),
      x1: Math.min(cam.width, Math.max(...us)), y1: Math.min(cam.height, Math.max(...vs)),
    };
    const offCentre = Math.hypot((box.x0 + box.x1) / 2 - cam.width / 2, (box.y0 + box.y1) / 2 - cam.height / 2);
    found.push({
      view: {
        filename: shot.filename, shot, outlinePx: pts, coverage: inside / outline.length, insideMask, box,
        viewAngleDeg: mid.viewAngleDeg, gsdM: mid.gsdM, score: 0,
      },
      centrality: 1 - Math.min(1, offCentre / Math.hypot(cam.width / 2, cam.height / 2)),
    });
  }
  const bestGsd = Math.min(...found.map(f => f.view.gsdM));
  for (const { view, centrality } of found) {
    const angle = Math.max(0, 1 - view.viewAngleDeg / 30);
    const resolution = bestGsd / view.gsdM;
    view.score = (3 * view.coverage + centrality + angle + resolution) / 6;
  }
  return found.map(f => f.view).sort((a, b) => b.score - a.score);
}

/**
 * The photos taken nearest a point, as views that make no claim: coverage 0,
 * the whole frame as the box. The fallback when the geometry finds no photo
 * holding a shape, so the operator still gets the closest picture rather
 * than nothing, told plainly that the shape is not confirmed in it.
 */
export function nearestViews(set: SourceFrameSet, centre: LatLngAlt, outline: LatLngAlt[], n = 2): AreaView[] {
  const c = toEnu(centre, set.reference);
  return [...set.shots]
    .map(shot => { const s = toEnu(shot.centre, set.reference); return { shot, d: Math.hypot(s[0] - c[0], s[1] - c[1]) }; })
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map(({ shot }) => {
      const cam = set.cameras[shot.cameraKey];
      const mid = projectToFrame(set, shot, centre);
      const pts = outline.map(p => projectToFrame(set, shot, p)).filter((q): q is Projection => !!q).map(q => ({ u: q.u, v: q.v }));
      return {
        filename: shot.filename, shot, outlinePx: pts.length === outline.length ? pts : [], coverage: 0,
        insideMask: outline.map(() => false), box: { x0: 0, y0: 0, x1: cam.width, y1: cam.height },
        viewAngleDeg: mid?.viewAngleDeg ?? 0, gsdM: mid?.gsdM ?? 0, score: 0,
      };
    });
}

/** The most photos ever chosen for one zone. Past this a zone is better walked than browsed. */
export const MAX_PHOTOS_PER_ZONE = 6;

/**
 * How many photos a zone needs, and which: the fewest that between them hold
 * the whole outline. One photo when the best holds it whole, which is every
 * small zone; for a zone wider than a photo, the best is taken first and each
 * next pick is the one holding most of what is still uncovered, until the
 * outline is covered, nothing more can be added, or the cap is reached.
 * Views come in best-first order from `selectFramesForArea`.
 */
export function coverZone(views: readonly AreaView[], max = MAX_PHOTOS_PER_ZONE): AreaView[] {
  if (!views.length) return [];
  const n = views[0].insideMask.length;
  const covered = new Array<boolean>(n).fill(false);
  const chosen: AreaView[] = [];
  const take = (v: AreaView) => { chosen.push(v); v.insideMask.forEach((m, i) => { if (m) covered[i] = true; }); };
  take(views[0]);
  while (chosen.length < max && covered.some(c => !c)) {
    let best: AreaView | null = null, gain = 0;
    for (const v of views) {
      if (chosen.includes(v)) continue;
      const g = v.insideMask.filter((m, i) => m && !covered[i]).length;
      if (g > gain) { gain = g; best = v; }
    }
    if (!best) break;
    take(best);
  }
  return chosen;
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
