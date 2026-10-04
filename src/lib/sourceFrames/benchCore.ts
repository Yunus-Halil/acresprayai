// The part of the benchmark that is pure geometry, shared by the terminal
// tool and the in-app panel: from a finding to the photograph that holds it
// best, with every reason it cannot get there named. Reading the original,
// cutting the pixels and calling the detector differ by runtime and live in
// the callers.
import type { Candidate } from "../weedScout/types";
import { type ImageMeta, offNadirDeg } from "./odm";
import type { AreaView } from "./select";
import type { ScanSources } from "./sources";
import { type SpotSources, spotSources } from "./spot";
import type { BenchStatus, FindingResult, FindingSource } from "./benchTypes";

/** What the benchmark knows about a finding before it looks at any pixels. */
export type FindingInput = {
  id: string;
  rowId: string | null;
  source: FindingSource;
  candidate: Candidate;
  kind: string;
  findingClass: string | null;
  verdict: string | null;
  verdictSource: string | null;
  species: string | null;
  /** A stored chip's key in the weed-chips bucket, when the finding came from the archive. */
  chipPath: string | null;
  storedPrediction: unknown;
  storedModelVersion: string | null;
};

/** A record with nothing done yet: every field null, status pending the first step. */
export function baseResult(f: FindingInput, compareOrtho: boolean): FindingResult {
  return {
    findingId: f.id, rowId: f.rowId, source: f.source, kind: f.kind, findingClass: f.findingClass,
    operatorVerdict: { verdict: f.verdict, verdictSource: f.verdictSource, species: f.species },
    storedPrediction: f.storedPrediction ? { prediction: f.storedPrediction, modelVersion: f.storedModelVersion } : null,
    status: "RECONSTRUCTION_UNAVAILABLE", reason: null,
    candidateFrames: 0, chosenFrames: [], selectedFrame: null, matchedBy: null,
    originalPath: null, originalBytes: null, originalSha256: null, originalSource: null,
    coverage: null, viewAngleDeg: null, offNadirDeg: null,
    orthoGsdM: f.candidate.chipGsdM, uploadedGsdM: null, nativeGsdM: null, nativeScale: null, exifScale: null,
    originalWidth: null, originalHeight: null, cropWindow: null, outlineCropPx: null,
    native: null,
    ortho: {
      status: compareOrtho ? "NO_ORTHO_CHIP" : "NOT_COMPARED", file: null, width: null, height: null,
      gsdM: f.candidate.chipGsdM, spanM: f.candidate.chipSpanM, outlinePx: null, model: null,
    },
  };
}

export type FrameChoice =
  | { ok: true; spot: SpotSources; view: AreaView; meta: ImageMeta | undefined; uploadedWidth: number }
  | { ok: false; status: BenchStatus; reason: string; candidateFrames: number; chosenFrames: string[] };

/** The app's own step three, read as a benchmark step: the best photograph, or why there is none. */
export function chooseFrame(sources: ScanSources, candidate: Candidate): FrameChoice {
  const spot = spotSources(sources, candidate);
  if (spot.unavailable === "no reconstruction") {
    return { ok: false, status: "RECONSTRUCTION_UNAVAILABLE", reason: `no camera poses for this scan (reconstruction: ${sources.reconstruction})`, candidateFrames: 0, chosenFrames: [] };
  }
  if (spot.unavailable === "no ground height") {
    return { ok: false, status: "RECONSTRUCTION_UNAVAILABLE", reason: "no ground height: ODM's stats carried no average GSD", candidateFrames: 0, chosenFrames: [] };
  }
  if (spot.nearestOnly || !spot.views.length) {
    return { ok: false, status: "PROJECTION_FAILED", reason: "no photograph holds any of this shape; the nearest photo would be a guess and is not cut", candidateFrames: spot.views.length, chosenFrames: [] };
  }
  const view = spot.views[0];
  const meta = sources.set!.images[view.filename];
  const cam = sources.set!.cameras[view.shot.cameraKey];
  return { ok: true, spot, view, meta, uploadedWidth: meta?.width ?? cam.width };
}

/** Write a choice into the record. Returns the failed record, or null when the choice was a frame. */
export function recordChoice(r: FindingResult, choice: FrameChoice): FindingResult | null {
  if (choice.ok === false) {
    return { ...r, status: choice.status, reason: choice.reason, candidateFrames: choice.candidateFrames, chosenFrames: choice.chosenFrames };
  }
  const { spot, view } = choice;
  Object.assign(r, {
    candidateFrames: spot.views.length, chosenFrames: spot.chosen.map(v => v.filename),
    selectedFrame: view.filename, coverage: view.coverage, viewAngleDeg: view.viewAngleDeg, offNadirDeg: offNadirDeg(view.shot),
    uploadedGsdM: view.gsdM, exifScale: spot.nativeScale,
  });
  return null;
}

/** The finding's outline in the crop's pixels, from the uploaded-frame pixels, the scale and the window. */
export function outlineInCrop(view: AreaView, scale: number, win: { x: number; y: number }): { x: number; y: number }[] {
  return view.outlinePx.map(p => ({ x: p.u * scale - win.x, y: p.v * scale - win.y }));
}

/**
 * A region's ring in the ortho chip's pixels, from the chip's span: the chip
 * is centred on the centroid and `spanM` across. Null for a point finding.
 */
export function outlineInChip(c: Candidate, width: number, height: number): { x: number; y: number }[] | null {
  if (!c.region || !c.chipSpanM) return null;
  const mPerLat = 111_320, mPerLng = 111_320 * Math.cos((c.centroid.lat * Math.PI) / 180);
  const pxPerM = width / c.chipSpanM;
  return c.region.rings[0].map(p => ({
    x: width / 2 + (p.lng - c.centroid.lng) * mPerLng * pxPerM,
    y: height / 2 - (p.lat - c.centroid.lat) * mPerLat * pxPerM,
  }));
}

/** A bytes-to-hex SHA-256 that works in the browser and in Node. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}
