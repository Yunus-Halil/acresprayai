// The original photos, for the small weeds.
//
// The field map at 5 cm per pixel gives the pattern and the crop; it loses
// the small weeds (about half at 8 cm). The scan kept the originals, at 1 to
// 2 cm per pixel, and ODM left a pose for every one. So, after the map pass
// has shown its result, the photos that cover the field are read one by one
// with the same pass, and each off-pattern blob is carried to the ground
// through the pose (odm.ts pixelToGround), the way a detector box is in
// sourceFrames/detections.ts. A photo's row block counts only where it
// agrees with the map's pattern (direction within PHOTO_BLOCK_ANGLE_DEG,
// spacing within PHOTO_BLOCK_PITCH_TOL), so a hedge or a neighbour's field
// at a photo's edge adds nothing. A plant seen in two photos is one
// finding, kept from the photo that holds it nearest its centre; one the
// map pass already found is left to the map pass.
//
// Which photos: one per spot, the spot's own best photo, and no others. The
// map pass found the spots; the pass reads the photo each one was matched
// to (the photo holding the most spots first), and for every spot whose best
// photo it is, keeps the window around it (rows as lines, plants as circles,
// in the original's pixels) on the spot as its look. The closer look opens
// on that; nothing is read one spot at a time, and the field's other photos
// are not read at all: a photo no spot sits in has nothing to show for a
// spot, and reading every photo of a field was what ran the browser out of
// memory. The photos are at most `maxPhotoReads`.
//
// Budgeted: at most `maxPhotos` photos, the ones covering most of the field
// first, one at a time in the pattern worker. The result lands as ordinary
// candidates with the photo as their source and a chip cut from the photo
// itself, so review, verdicts and the archive need nothing new.
import { type LatLng2, pointInAnyRing } from "../geo";
import { type DecodedPhoto, decodePhoto } from "../photoScout/decode";
import { type PhotoParams, type PhotoPattern, type PhotoPixels, rowSegmentsPx } from "../photoScout/pattern";
import { analysePhotoOffThread } from "../photoScout/runPattern";
import { type FrameManifestEntry, lookupOriginal } from "../sourceFrames/manifest";
import { type LatLngAlt, type Shot, type SourceFrameSet, frameFootprint, offNadirDeg, pixelToGround, projectToFrame, toEnu } from "../sourceFrames/odm";
import { type PhotoLook, lookFromPattern, patternLookSideM } from "../sourceFrames/patternLook";
import type { ScanSources } from "../sourceFrames/scan";
import type { UnitSystem } from "../units";
import { describe } from "./describe";
import type { FieldPattern } from "./fieldPattern";
import { localFrame } from "./rows";
import { tileIdAt, tileLattice } from "./tiles";
import type { Blob as ScoutBlob, Candidate, ScoutParams, ScoutResult, SourceImages } from "./types";

/** Photos read per scan unless the operator raises it. About five seconds each. */
export const PHOTO_PASS_MAX_PHOTOS = 150;
/** The pass's window on a photo, metres. */
export const PHOTO_PASS_WINDOW_M = 4;
/** A photo is read when at least this share of its footprint is inside the field. */
export const PHOTO_MIN_INSIDE_SHARE = 0.2;
/** A photo's row block agrees with the map's when its direction is within this many degrees... */
export const PHOTO_BLOCK_ANGLE_DEG = 10;
/** ...and its spacing within this share. */
export const PHOTO_BLOCK_PITCH_TOL = 0.15;
/** A finding this near an existing candidate, or another finding, is the same plant. */
export const PHOTO_DUPLICATE_M = 0.4;
/** The chip cut from the photo spans this many plant diameters, never under half a metre. */
export const PHOTO_CHIP_SPAN_MULT = 4;
/** Plants given a picture in the list; past this the pictures alone were tens of megabytes a run. The look still opens for every plant. */
export const PHOTO_CHIP_MAX = 150;

/** A finding the photo pass made, as opposed to one the map pass made. */
export const isPhotoFinding = (c: Pick<Candidate, "id">): boolean => c.id.startsWith("c-p:");

export type PhotoFinding = {
  id: string;
  filename: string;
  centroid: LatLng2;
  areaM2: number;
  equivDiameterM: number;
  cls: "off-row" | "between plants";
  distanceToRowM: number | null;
  /** Where in the decoded photo, pixels. */
  photoPx: { x: number; y: number };
  /** Where in the original photo, pixels. */
  nativePx: { u: number; v: number };
  /** 1 at the photo's centre, 0 at its edge: the photo that holds a plant nearest its centre wins a tie. */
  centrality: number;
  gsdM: number;
};

export type PhotoBlockMatch = { id: number; groundAngleDeg: number; groundPitchM: number; matched: boolean };

export type PhotoRead = {
  filename: string;
  status: "read" | "skipped" | "failed";
  reason?: string;
  windows: number;
  usableWindows: number;
  blocks: number;
  matchedBlocks: number;
  findings: number;
  /** Spots of the map pass this photo is the best photo of, given their look here. */
  looks: number;
  ms: number;
};

export type PhotoPassProgress = { done: number; total: number; found: number; looks: number; note: string };

export type PhotoPassResult = {
  reads: PhotoRead[];
  candidates: Candidate[];
  /** Looks for spots the map pass found, by spot id; the photo pass's own findings carry theirs. */
  looks: Record<string, PhotoLook>;
  notes: string[];
};

const strip = (p: LatLngAlt): LatLng2 => ({ lat: p.lat, lng: p.lng });
const angleDiff = (a: number, b: number) => { const d = Math.abs((((a - b) % 180) + 180) % 180); return Math.min(d, 180 - d); };

/** The photos the map's spots were matched to, the ones holding most spots first. They are read first: the spots are what the operator is waiting on. */
export function photosOfSpots(candidates: readonly Pick<Candidate, "sourceImages">[]): string[] {
  const counts = new Map<string, number>();
  for (const c of candidates) { const f = c.sourceImages?.best; if (f) counts.set(f, (counts.get(f) ?? 0) + 1); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
}

/** The spots' own photos as shots, in `photosOfSpots` order, at most `max`; a filename with no shot is skipped. */
export function shotsOfSpots(set: SourceFrameSet, candidates: readonly Pick<Candidate, "sourceImages">[], max = PHOTO_PASS_MAX_PHOTOS): Shot[] {
  const byName = new Map(set.shots.map(s => [s.filename, s]));
  const out: Shot[] = [];
  for (const f of photosOfSpots(candidates)) { const s = byName.get(f); if (s) out.push(s); if (out.length >= max) break; }
  return out;
}

/** The photos that cover the field, at most `max`: those in `first` in that order, then the ones covering most of it first. The benchmark's choice; the run reads `shotsOfSpots`. */
export function choosePhotos(set: SourceFrameSet, groundAltM: number, boundary: LatLng2[][], max = PHOTO_PASS_MAX_PHOTOS, first: string[] = []): Shot[] {
  const views: { shot: Shot; share: number; tilt: number }[] = [];
  for (const shot of set.shots) {
    const fp = frameFootprint(set, shot, groundAltM);
    if (!fp) continue;
    let inside = 0;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
      const s = i / 4, t = j / 4;
      const top = { lat: fp[0].lat * (1 - s) + fp[1].lat * s, lng: fp[0].lng * (1 - s) + fp[1].lng * s };
      const bottom = { lat: fp[3].lat * (1 - s) + fp[2].lat * s, lng: fp[3].lng * (1 - s) + fp[2].lng * s };
      const p = { lat: top.lat * (1 - t) + bottom.lat * t, lng: top.lng * (1 - t) + bottom.lng * t };
      if (pointInAnyRing(p, boundary)) inside++;
    }
    const share = inside / 25;
    if (share < PHOTO_MIN_INSIDE_SHARE) continue;
    views.push({ shot, share, tilt: offNadirDeg(shot) });
  }
  views.sort((a, b) => b.share - a.share || a.tilt - b.tilt);
  if (first.length) {
    const rank = new Map(first.map((f, i) => [f, i]));
    // A finite rank for the rest: Infinity minus Infinity is NaN, which a comparator must never return.
    const r = (v: { shot: Shot }) => rank.get(v.shot.filename) ?? first.length;
    views.sort((a, b) => r(a) - r(b));
  }
  return views.slice(0, max).map(v => v.shot);
}

/**
 * The look around each spot this photo is the best photo of: the spot
 * carried into the photo through the pose, then the window around it from
 * the photo's pattern. Pure. `decodedWidth` is the width the pattern was
 * read on, `nativeWidth` the original's.
 */
export function looksInPhoto(input: {
  set: SourceFrameSet; shot: Shot; groundAltM: number; pattern: PhotoPattern; decodedWidth: number; nativeWidth: number;
  candidates: readonly Pick<Candidate, "id" | "centroid" | "sourceImages" | "blob" | "look">[]; rowSpacingM: number | null;
}): Record<string, PhotoLook> {
  const { set, shot, groundAltM, pattern, decodedWidth, nativeWidth } = input;
  const cam = set.cameras[shot.cameraKey];
  const k = cam.width / decodedWidth, nativeScale = nativeWidth / decodedWidth;
  const sideM = patternLookSideM(input.rowSpacingM);
  const out: Record<string, PhotoLook> = {};
  for (const c of input.candidates) {
    if (c.sourceImages?.best !== shot.filename || c.look) continue;
    const pr = projectToFrame(set, shot, { ...c.centroid, altM: groundAltM });
    if (!pr || !pr.inside) continue;
    out[c.id] = lookFromPattern(pattern, { x: pr.u / k, y: pr.v / k, diameterM: c.blob?.equivDiameterM ?? null }, { filename: shot.filename, sideM, nativeScale });
  }
  return out;
}

/** Ground metres per pixel of the frame ODM posed, from its footprint's top edge. */
export function frameGsdM(set: SourceFrameSet, shot: Shot, groundAltM: number): number | null {
  const fp = frameFootprint(set, shot, groundAltM);
  if (!fp) return null;
  const a = toEnu(fp[0], set.reference), b = toEnu(fp[1], set.reference);
  return Math.hypot(a[0] - b[0], a[1] - b[1]) / set.cameras[shot.cameraKey].width;
}

export type GroundInput = {
  set: SourceFrameSet;
  shot: Shot;
  groundAltM: number;
  pattern: PhotoPattern;
  /** Width of the decoded photo the pattern was read on, pixels. */
  decodedWidth: number;
  /** Width of the original photo, pixels. */
  nativeWidth: number;
  /** The map's pattern, to agree with; null reads the photo on its own. */
  fieldPattern: FieldPattern | null;
};

/**
 * A photo's pattern on the ground: which of its row blocks agree with the
 * map's, and every off-pattern blob of those blocks carried to the ground
 * through the pose. Pure.
 */
export function groundPhotoFindings(input: GroundInput): { findings: PhotoFinding[]; blocks: PhotoBlockMatch[] } {
  const { set, shot, groundAltM, pattern, decodedWidth, nativeWidth, fieldPattern } = input;
  const cam = set.cameras[shot.cameraKey];
  const k = cam.width / decodedWidth;
  const ground = (x: number, y: number): LatLngAlt | null => pixelToGround(set, shot, x * k, y * k, groundAltM);
  const g = pattern.gsdM;
  const blocks: PhotoBlockMatch[] = [];
  const matched = new Set<number>();
  for (const b of pattern.blocks) {
    const first = pattern.windows[b.windows[0]];
    if (!first) continue;
    const { fit } = first;
    const th = (fit.angleDeg * Math.PI) / 180;
    // Photo-local metres, y up, to decoded pixels, y down.
    const cx = fit.centre.x / g, cy = -fit.centre.y / g;
    const alongPx = { x: Math.cos(th), y: -Math.sin(th) }, acrossPx = { x: -Math.sin(th), y: -Math.cos(th) };
    const step = fit.pitchM / g;
    const g0 = ground(cx, cy), g1 = ground(cx + alongPx.x * step, cy + alongPx.y * step), g2 = ground(cx + acrossPx.x * step, cy + acrossPx.y * step);
    if (!g0 || !g1 || !g2) { blocks.push({ id: b.id, groundAngleDeg: NaN, groundPitchM: NaN, matched: false }); continue; }
    const e0 = toEnu(g0, set.reference), e1 = toEnu(g1, set.reference), e2 = toEnu(g2, set.reference);
    const groundAngleDeg = ((((Math.atan2(e1[1] - e0[1], e1[0] - e0[0]) * 180) / Math.PI) % 180) + 180) % 180;
    const groundPitchM = Math.hypot(e2[0] - e0[0], e2[1] - e0[1]);
    const ok = !fieldPattern || fieldPattern.windows.some(w => w.blocks.some(fb =>
      angleDiff(fb.angleDeg, groundAngleDeg) <= PHOTO_BLOCK_ANGLE_DEG && Math.abs(groundPitchM / fb.pitchM - 1) <= PHOTO_BLOCK_PITCH_TOL));
    blocks.push({ id: b.id, groundAngleDeg, groundPitchM, matched: ok });
    if (ok) matched.add(b.id);
  }
  const findings: PhotoFinding[] = [];
  const nativeScale = nativeWidth / decodedWidth;
  for (const blob of pattern.blobs) {
    if ((blob.cls !== "off-row" && blob.cls !== "between plants") || blob.touchesBorder || blob.window == null) continue;
    const blockId = pattern.windows[blob.window]?.block;
    if (blockId == null || !matched.has(blockId)) continue;
    const gp = ground(blob.x, blob.y);
    if (!gp) continue;
    const centrality = 1 - Math.max(Math.abs(blob.x / pattern.width - 0.5), Math.abs(blob.y / pattern.height - 0.5)) * 2;
    findings.push({
      id: `p:${shot.filename}:${blob.id}`, filename: shot.filename, centroid: strip(gp),
      areaM2: blob.areaM2, equivDiameterM: blob.equivDiameterM, cls: blob.cls, distanceToRowM: blob.acrossM,
      photoPx: { x: blob.x, y: blob.y }, nativePx: { u: blob.x * nativeScale, v: blob.y * nativeScale },
      centrality, gsdM: g,
    });
  }
  return { findings, blocks };
}

/**
 * One finding per plant: a finding within PHOTO_DUPLICATE_M of an existing
 * candidate is that candidate; among the rest, the one nearest its photo's
 * centre stands for every other within half a plant of it.
 */
export function dedupeFindings(findings: PhotoFinding[], existing: LatLng2[]): PhotoFinding[] {
  if (!findings.length) return [];
  const frame = localFrame(findings[0].centroid);
  const cell = 2;
  const key = (x: number, y: number) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
  const grid = new Map<string, { x: number; y: number; r: number }[]>();
  const put = (x: number, y: number, r: number) => { const k = key(x, y); const l = grid.get(k) ?? []; l.push({ x, y, r }); grid.set(k, l); };
  const near = (x: number, y: number, r: number): boolean => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const q of grid.get(`${cx + i}:${cy + j}`) ?? []) if (Math.hypot(q.x - x, q.y - y) <= Math.max(r, q.r)) return true;
    }
    return false;
  };
  for (const p of existing) { const { x, y } = frame.toXY(p); put(x, y, PHOTO_DUPLICATE_M); }
  const out: PhotoFinding[] = [];
  for (const f of [...findings].sort((a, b) => b.centrality - a.centrality)) {
    const { x, y } = frame.toXY(f.centroid);
    const r = Math.max(PHOTO_DUPLICATE_M, f.equivDiameterM / 2);
    if (near(x, y, r)) continue;
    put(x, y, r);
    out.push(f);
  }
  return out;
}

export type PhotoChip = { dataUrl: string; spanM: number; gsdM: number };

/** A chip cut from the decoded photo around a point, upscaled without smoothing. Browser only. */
export function chipFromPhoto(px: PhotoPixels, x: number, y: number, spanM: number, gsdM: number, outPx = 256): PhotoChip | null {
  if (typeof document === "undefined") return null;
  const half = Math.max(4, Math.round(spanM / gsdM / 2));
  const x0 = Math.max(0, Math.round(x) - half), y0 = Math.max(0, Math.round(y) - half);
  const x1 = Math.min(px.width, Math.round(x) + half), y1 = Math.min(px.height, Math.round(y) + half);
  const w = x1 - x0, h = y1 - y0;
  if (w < 2 || h < 2) return null;
  const crop = new Uint8ClampedArray(w * h * 4);
  for (let yy = 0; yy < h; yy++) crop.set(px.rgba.subarray(((y0 + yy) * px.width + x0) * 4, ((y0 + yy) * px.width + x1) * 4), yy * w * 4);
  const source = document.createElement("canvas");
  source.width = w; source.height = h;
  const sctx = source.getContext("2d");
  if (!sctx) return null;
  sctx.putImageData(new ImageData(crop, w, h), 0, 0);
  const scale = Math.max(1, Math.ceil(outPx / Math.max(w, h)));
  const out = document.createElement("canvas");
  out.width = w * scale; out.height = h * scale;
  const octx = out.getContext("2d");
  if (!octx) return null;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(source, 0, 0, out.width, out.height);
  return { dataUrl: out.toDataURL("image/png"), spanM: Math.max(w, h) * gsdM, gsdM };
}

/** A finding as the review, the verdicts and the archive know one. */
export function photoCandidate(f: PhotoFinding, tileId: string, chip: PhotoChip | null): Candidate {
  const blob: ScoutBlob = {
    id: f.id, tileId, centroid: f.centroid, areaM2: f.areaM2, equivDiameterM: f.equivDiameterM,
    widthM: f.equivDiameterM, heightM: f.equivDiameterM, extent: 0.7,
    chromaR: 0, chromaG: 0, chromaB: 0, exgMean: 0, brightness: 0,
    gsdM: f.gsdM, touchesBorder: false, distanceToRowM: f.distanceToRowM, rowConfidence: null,
  };
  const sourceImages: SourceImages = { photos: 1, best: f.filename, coverage: 1, chosen: [f.filename], nearestOnly: false, kept: true };
  return {
    id: `c-${f.id}`, tileId, centroid: f.centroid,
    kind: f.cls === "between plants" ? "between plants" : "off-row vegetation",
    // Under the map pass's own findings of the same kind, and a small plant below a large one: the list stays worst first.
    score: Math.min(0.6, (f.cls === "between plants" ? 0.35 : 0.3) + 0.3 * Math.min(1, f.equivDiameterM / 0.5)),
    distanceToRowM: f.distanceToRowM, rowConfidence: null, anomalyZ: null, anomalyFeature: null, blobZ: null, blobZFeature: null,
    blob, region: null, areaM2: f.areaM2, feedback: null, estimate: null, prediction: null,
    // The classifier was not asked: the plant was found in a photo, not chipped from the map. Null, never a half-made record.
    inference: null,
    sourceImages, chip: chip?.dataUrl ?? null, chipSpanM: chip?.spanM ?? null, chipGsdM: chip?.gsdM ?? null,
  };
}

export type PhotoPassOptions = {
  result: ScoutResult;
  sources: ScanSources;
  boundary: LatLng2[][];
  params: ScoutParams;
  crop?: string;
  growthStage?: string | null;
  unitSystem?: UnitSystem;
  signal?: AbortSignal;
  onProgress?: (p: PhotoPassProgress) => void;
  /** New candidates, as each photo lands. */
  onFound?: (candidates: Candidate[]) => void;
  /** Looks for the map pass's own spots, as each photo lands, by spot id. */
  onLook?: (looks: Record<string, PhotoLook>) => void;
  /** Injected for tests. */
  fetchFrame?: (entry: FrameManifestEntry) => Promise<globalThis.Blob | null>;
  decode?: (blob: globalThis.Blob) => Promise<DecodedPhoto>;
  analyse?: (px: PhotoPixels, params: PhotoParams) => Promise<PhotoPattern>;
};

class Aborted extends Error {
  constructor() { super("Photo pass cancelled."); this.name = "Aborted"; }
}

/** Read the field's photos for the small weeds, one at a time, handing findings over as they land. */
export async function runPhotoPass(opts: PhotoPassOptions): Promise<PhotoPassResult> {
  const { result, sources, boundary, params } = opts;
  const notes: string[] = [];
  const reads: PhotoRead[] = [];
  const out: Candidate[] = [];
  const looks: Record<string, PhotoLook> = {};
  if (!sources.set || sources.groundAltM == null) { notes.push("The photos were not read: this scan has no camera positions."); return { reads, candidates: out, looks, notes }; }
  if (!sources.frames) { notes.push("The photos were not read: no originals were kept for this scan."); return { reads, candidates: out, looks, notes }; }
  const shots = shotsOfSpots(sources.set, result.candidates, params.maxPhotoReads);
  if (!shots.length) { notes.push("The photos were not read: no spot was matched to a photo."); return { reads, candidates: out, looks, notes }; }
  const rowSpacingM = result.pattern?.summary.rowSpacingM ?? null;
  const lattice = tileLattice(boundary, result.tileM);
  // The storage client is loaded only when a photo is actually fetched, so this module stays importable without a browser.
  const fetchFrame = opts.fetchFrame ?? (async (entry: FrameManifestEntry) => (await import("../sourceFrames/scan")).downloadFrame(entry));
  const decode = opts.decode ?? decodePhoto;
  const analyse = opts.analyse ?? ((px: PhotoPixels, p: PhotoParams) => analysePhotoOffThread(px, p, { signal: opts.signal }));
  const existing: LatLng2[] = result.candidates.filter(c => !c.region).map(c => c.centroid);
  const sys: UnitSystem = opts.unitSystem ?? "metric";
  let found = 0, skipped = 0, failed = 0, looked = 0;
  const check = () => { if (opts.signal?.aborted) throw new Aborted(); };
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    check();
    opts.onProgress?.({ done: i, total: shots.length, found, looks: looked, note: `photo ${i + 1} of ${shots.length}` });
    const t0 = Date.now();
    const read: PhotoRead = { filename: shot.filename, status: "read", windows: 0, usableWindows: 0, blocks: 0, matchedBlocks: 0, findings: 0, looks: 0, ms: 0 };
    reads.push(read);
    const lookup = lookupOriginal(sources.frames, shot.filename);
    if (!lookup.ok) { read.status = "skipped"; read.reason = "reason" in lookup ? lookup.reason : "no original was kept"; skipped++; continue; }
    try {
      const blob = await fetchFrame(lookup.entry);
      if (!blob) { read.status = "skipped"; read.reason = "the original could not be downloaded"; skipped++; continue; }
      check();
      const decoded = await decode(blob);
      decoded.bitmap?.close?.();
      const fg = frameGsdM(sources.set, shot, sources.groundAltM);
      if (!fg) { read.status = "skipped"; read.reason = "the photo's footprint does not reach the ground"; skipped++; continue; }
      const gsdM = (fg * sources.set.cameras[shot.cameraKey].width) / decoded.pixels.width;
      const pattern = await analyse(decoded.pixels, {
        gsdM, rowSpacingM: params.rowSpacingAuto ? "auto" : params.rowSpacingM, windowM: PHOTO_PASS_WINDOW_M, minBlobAreaCm2: params.minBlobCm2,
      });
      check();
      read.windows = pattern.summary.windows; read.usableWindows = pattern.summary.usableWindows; read.blocks = pattern.summary.blocks;
      const grounded = groundPhotoFindings({
        set: sources.set, shot, groundAltM: sources.groundAltM, pattern, decodedWidth: decoded.pixels.width, nativeWidth: decoded.nativeWidth, fieldPattern: result.pattern,
      });
      read.matchedBlocks = grounded.blocks.filter(b => b.matched).length;
      const fresh = dedupeFindings(grounded.findings.filter(f => pointInAnyRing(f.centroid, boundary)), existing);
      const batch: Candidate[] = [];
      for (const f of fresh) {
        const tileId = tileIdAt(lattice, f.centroid) ?? "photo";
        const span = Math.max(0.5, PHOTO_CHIP_SPAN_MULT * f.equivDiameterM);
        const chip = found + batch.length < PHOTO_CHIP_MAX ? chipFromPhoto(decoded.pixels, f.photoPx.x, f.photoPx.y, span, f.gsdM) : null;
        const c = photoCandidate(f, tileId, chip);
        c.estimate = describe(c, null, opts.crop ?? "", opts.growthStage ?? null, null, result.pattern?.summary.rowSpacingM ?? params.rowSpacingM, f.gsdM, sys);
        batch.push(c);
        existing.push(f.centroid);
      }
      // The look for every spot this photo is the best photo of: the map
      // pass's own spots, handed over by id, and this photo's findings,
      // which carry theirs from the start.
      const ownLooks = looksInPhoto({
        set: sources.set, shot, groundAltM: sources.groundAltM, pattern, decodedWidth: decoded.pixels.width, nativeWidth: decoded.nativeWidth,
        candidates: batch, rowSpacingM,
      });
      for (const c of batch) c.look = ownLooks[c.id] ?? null;
      const mapLooks = looksInPhoto({
        set: sources.set, shot, groundAltM: sources.groundAltM, pattern, decodedWidth: decoded.pixels.width, nativeWidth: decoded.nativeWidth,
        candidates: result.candidates, rowSpacingM,
      });
      for (const id of Object.keys(mapLooks)) looks[id] = mapLooks[id];
      read.looks = Object.keys(mapLooks).length;
      looked += read.looks;
      read.findings = batch.length;
      found += batch.length;
      out.push(...batch);
      if (batch.length) opts.onFound?.(batch);
      if (read.looks) opts.onLook?.(mapLooks);
    } catch (e) {
      if ((e as Error)?.name === "Aborted") throw e;
      read.status = "failed"; read.reason = (e as Error)?.message ?? String(e); failed++;
    } finally {
      read.ms = Date.now() - t0;
    }
    // A breath between photos: the page paints and the collector runs before the next 45 MB of pixels.
    await new Promise<void>(r => setTimeout(r, 0));
  }
  opts.onProgress?.({ done: shots.length, total: shots.length, found, looks: looked, note: "done" });
  const readCount = reads.filter(r => r.status === "read").length;
  const firstFailure = reads.find(r => r.status === "failed")?.reason;
  const spots = result.candidates.filter(c => c.sourceImages?.best).length;
  const wanted = photosOfSpots(result.candidates).length;
  notes.push(
    `${readCount} of ${shots.length} photo(s) read at full resolution, the spots' own photos only: ${found} more plant(s) off the pattern, ${looked} of ${spots} spot(s) shown in their photo` +
    `${skipped ? `, ${skipped} skipped` : ""}${failed ? `, ${failed} failed (${firstFailure})` : ""}${wanted > shots.length ? `; ${wanted - shots.length} photo(s) over the limit were not read` : ""}${found > PHOTO_CHIP_MAX ? `; the first ${PHOTO_CHIP_MAX} carry a picture, the rest open in their photo` : ""}.`,
  );
  return { reads, candidates: out, looks, notes };
}
