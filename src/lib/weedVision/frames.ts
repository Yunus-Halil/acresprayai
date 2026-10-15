// A model's instances in one photograph, carried to the ground, and the same
// plant seen from several photographs collapsed to one.
//
// Pixel spaces, as in sourceFrames/detections.ts: the service answers in the
// ORIGINAL photo's pixels (native, after EXIF orientation); the camera pose is
// expressed in the frame ODM reconstructed from (cam.width wide); native over
// frame is `nativeScale`. Every polygon vertex is a ray meeting the flat
// ground plane at the scan's estimated height (odm.ts pixelToGround), so a
// plant lands where its photo says it is, with the same error budget as a
// detector box: tens of centimetres per metre of height error at the frame
// edge. Pure: nothing here fetches or stores.
import type { LatLng2 } from "../geo";
import { type LatLngAlt, type Shot, type SourceFrameSet, pixelToGround, projectToFrame, toEnu } from "../sourceFrames/odm";
import type { InstanceClass, WeedInstance, WeedVisionResult } from "./client";
import { type RowContext, type RowStatus, rowStatusOf } from "./rowFilter";

export type FrameDetection = {
  /** `${frame}#${class}${instance id}`: stable for a photo and a run key. */
  id: string;
  /** The photograph, by ODM's name. */
  frame: string;
  instanceId: number;
  klass: InstanceClass;
  /** The detector's confidence (RF-DETR) or the mean weed probability / index (older algorithms). */
  score: number | null;
  scoreKind: string;
  /** The largest outer polygon in the original photo's pixels, thinned to at most MAX_RING_POINTS vertices. */
  nativePolygon: [number, number][];
  nativeCentroid: [number, number];
  nativeBbox: [number, number, number, number];
  areaPx: number;
  equivalentDiameterPx: number;
  /** The polygon on the ground. Null when a vertex's ray misses the plane. */
  ring: LatLng2[] | null;
  centre: LatLng2 | null;
  /** Ground metres per native pixel at the plant, from the camera pose. */
  gsdM: number | null;
  areaM2: number | null;
  diameterM: number | null;
  /** Angle between the ray to the plant and straight down: small is a good, undistorted view. */
  viewAngleDeg: number | null;
  status: "ok" | "off_ground";
  flags: string[];
  tiny: boolean;
  touchesBorder: boolean;
  fusedFromTiles: number;
  /** Against the photo's planting pattern (rowFilter.ts); absent on rows saved before it existed. */
  rowStatus?: RowStatus;
};

/** One plant on the ground after the photographs are merged: the best view, with the others listed. */
export type GroundPlant = FrameDetection & {
  /** Every photograph that showed this plant, best view first. */
  seenIn: string[];
  /** Detections merged into this one (0 when a single photo saw it). */
  duplicates: number;
};

export const MAX_RING_POINTS = 40;

const strip = (p: LatLngAlt): LatLng2 => ({ lat: p.lat, lng: p.lng });

/** Keep at most n vertices, evenly spaced, the first always kept. */
export function thinPolygon(poly: [number, number][], n: number = MAX_RING_POINTS): [number, number][] {
  if (poly.length <= n) return poly;
  const step = poly.length / n;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push(poly[Math.floor(i * step)]);
  return out;
}

export type GroundInput = {
  set: SourceFrameSet;
  shot: Shot;
  groundAltM: number;
  /** The service's answer for this photograph. */
  result: WeedVisionResult;
  /** The photograph's planting pattern in its own pixels, when it was read; null marks every weed "no-rows". */
  rowContext?: RowContext | null;
};

function groundOne(input: GroundInput, inst: WeedInstance, klass: InstanceClass, nativeScale: number): FrameDetection {
  const { set, shot, groundAltM } = input;
  const poly = thinPolygon(inst.polygons_px[0] ?? [], MAX_RING_POINTS);
  const toGround = (x: number, y: number) => pixelToGround(set, shot, x / nativeScale, y / nativeScale, groundAltM);
  const ringPts = poly.map(([x, y]) => toGround(x, y));
  const ring = poly.length >= 3 && ringPts.every((p): p is LatLngAlt => !!p) ? ringPts.map(strip) : null;
  const centreG = toGround(inst.centroid_px[0], inst.centroid_px[1]);
  let gsdM: number | null = null, viewAngleDeg: number | null = null;
  if (centreG) {
    const pr = projectToFrame(set, shot, centreG);
    if (pr) { gsdM = pr.gsdM / nativeScale; viewAngleDeg = pr.viewAngleDeg; }
  }
  return {
    id: `${shot.filename}#${klass}${inst.id}`,
    frame: shot.filename, instanceId: inst.id, klass,
    score: inst.score, scoreKind: inst.score_kind,
    nativePolygon: poly, nativeCentroid: inst.centroid_px, nativeBbox: inst.bbox_px,
    areaPx: inst.area_px, equivalentDiameterPx: inst.equivalent_diameter_px,
    ring, centre: centreG ? strip(centreG) : null,
    gsdM, areaM2: gsdM != null ? inst.area_px * gsdM * gsdM : null, diameterM: gsdM != null ? inst.equivalent_diameter_px * gsdM : null,
    viewAngleDeg,
    status: centreG ? "ok" : "off_ground",
    flags: inst.flags ?? [], tiny: !!inst.tiny, touchesBorder: !!inst.touches_border,
    fusedFromTiles: inst.fused_from_tiles ?? 1,
    rowStatus: klass === "weed" ? rowStatusOf(input.rowContext ?? null, inst.centroid_px[0], inst.centroid_px[1]) : undefined,
  };
}

/**
 * Every instance of a service result on the ground. Weeds come from
 * `instances`; crops from `crop_instances` when the algorithm gives them
 * (RF-DETR). An algorithm with no class on its instances is a weed finder.
 */
export function groundFrameResult(input: GroundInput): FrameDetection[] {
  const cam = input.set.cameras[input.shot.cameraKey];
  if (!cam) return [];
  const nativeScale = input.result.image.width / cam.width;
  const out: FrameDetection[] = [];
  for (const inst of input.result.instances) out.push(groundOne(input, inst, inst.class ?? "weed", nativeScale));
  for (const inst of input.result.crop_instances ?? []) out.push(groundOne(input, inst, inst.class ?? "crop", nativeScale));
  return out;
}

/** Metres between two ground points on the set's local plane. */
export function metresBetween(set: SourceFrameSet, a: LatLng2, b: LatLng2, altM: number): number {
  const p = toEnu({ ...a, altM }, set.reference), q = toEnu({ ...b, altM }, set.reference);
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

export const MERGE_MIN_M = 0.3;
export const MERGE_DIAMETER_FACTOR = 0.75;

/** Two detections of the same class are one plant when their centres are closer than max(MERGE_MIN_M, 0.75 x the larger diameter). */
export function mergeRadiusM(a: FrameDetection, b: FrameDetection): number {
  return Math.max(MERGE_MIN_M, MERGE_DIAMETER_FACTOR * Math.max(a.diameterM ?? 0, b.diameterM ?? 0));
}

/** The better view of a plant: the more nadir ray, then the higher score. */
export function betterView(a: FrameDetection, b: FrameDetection): boolean {
  const va = a.viewAngleDeg ?? 90, vb = b.viewAngleDeg ?? 90;
  if (Math.abs(va - vb) > 0.5) return va < vb;
  return (a.score ?? 0) > (b.score ?? 0);
}

/**
 * Collapse detections from overlapping photographs to one plant each, per
 * class. Greedy from the best view: a detection joins the first kept plant of
 * its class within the merge radius, else starts one. A 2 m grid keeps it
 * linear for tens of thousands of detections. Off-ground detections (no
 * centre) are kept as they are, unmerged.
 */
export function mergeAcrossFrames(set: SourceFrameSet, altM: number, dets: FrameDetection[]): GroundPlant[] {
  const CELL = 2;
  const sorted = [...dets].sort((a, b) => (betterView(a, b) ? -1 : betterView(b, a) ? 1 : 0));
  const grid = new Map<string, GroundPlant[]>();
  const enu = new Map<string, [number, number]>();
  const key = (e: [number, number]) => `${Math.floor(e[0] / CELL)}:${Math.floor(e[1] / CELL)}`;
  const kept: GroundPlant[] = [];
  for (const d of sorted) {
    if (!d.centre) { kept.push({ ...d, seenIn: [d.frame], duplicates: 0 }); continue; }
    const e = toEnu({ ...d.centre, altM }, set.reference);
    const p: [number, number] = [e[0], e[1]];
    enu.set(d.id, p);
    const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL);
    let home: GroundPlant | null = null;
    outer: for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const q of grid.get(`${gx}:${gy}`) ?? []) {
          if (q.klass !== d.klass || q.frame === d.frame) continue;
          const qe = enu.get(q.id)!;
          if (Math.hypot(qe[0] - p[0], qe[1] - p[1]) <= mergeRadiusM(q, d)) { home = q; break outer; }
        }
      }
    }
    if (home) {
      if (!home.seenIn.includes(d.frame)) home.seenIn.push(d.frame);
      home.duplicates += 1;
    } else {
      const g: GroundPlant = { ...d, seenIn: [d.frame], duplicates: 0 };
      kept.push(g);
      const k = key(p);
      const cell = grid.get(k);
      if (cell) cell.push(g); else grid.set(k, [g]);
    }
  }
  return kept;
}

export type FrameRunParams = { algorithm: string; threshold: number; tile: number; overlap: number; scale: number };

export const FRAME_RUN_VERSION = "frame-detect-v1";

/** The cache key of a run: the version, the settings and the checkpoint, so a changed model is a different run. */
export function frameRunKey(p: FrameRunParams, modelSha: string | null): string {
  return `${FRAME_RUN_VERSION}|${p.algorithm}|t${p.threshold}|tile${p.tile}|ov${p.overlap}|s${p.scale}|m${(modelSha ?? "none").slice(0, 16)}`;
}

/** Counts for a summary line. */
export function countByClass(dets: { klass: InstanceClass }[]): Record<InstanceClass, number> {
  const out = { crop: 0, weed: 0 };
  for (const d of dets) out[d.klass] += 1;
  return out;
}

/** Weeds by their standing against the rows: off the rows (shown), on crop plants or row lines (set aside), unread photos. */
export function countByRow(dets: { klass: InstanceClass; rowStatus?: RowStatus }[]): { offRow: number; onRow: number; noRows: number } {
  const out = { offRow: 0, onRow: 0, noRows: 0 };
  for (const d of dets) {
    if (d.klass !== "weed") continue;
    if (d.rowStatus === "on-crop" || d.rowStatus === "on-row") out.onRow += 1;
    else if (d.rowStatus === "off-row") out.offRow += 1;
    else out.noRows += 1;
  }
  return out;
}
