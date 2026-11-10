// The analysis record of a corn Field Twin (2026-11-10): what the build knew and the twin does not keep.
//
// A saved twin holds the field's findings and small crops of the photographs behind them. The build knew more: what
// Corn V1 read in every photograph, where every aligned camera stood, where each finding lies in each photograph, and
// which pixels each crop was cut from. Once the build's tab closes that is gone, and with it any way to combine the
// photographs over the field again (cornField needs the reads and the cameras, not the twin). This record keeps it,
// beside the twin and apart from it:
//
//   orthos/<user id>/field-twins/<twin id>/analysis.json.gz
//
// It is NOT part of the twin: twin.json is byte for byte what it is without it, the viewer never reads it, a twin
// without one (every twin saved before it, every orchard twin) is whole, and a failed upload of it never touches the
// twin's save (buildSession.ts). It is private like the twin (the account's own folder), deleted with it, never
// opened by the founder's twin viewer, and nothing in the app sends it anywhere else. No pixels are in it, and no
// digest of the original files: a photograph is named, sized and dated, which is what the twin already says of it.
//
// OFF by default (TWIN_ANALYSIS_ENABLED, analysisConfig.ts): no build makes one until the founder switches it on.
//
// What it allows later, none of it built here: reproducing the field's combination exactly (reproduceCornField, used
// by the tests and scripts only), combining again with an operator's corrections, and cutting new crops at a known
// place once the operator selects the original photographs again.
import type { GeorefFrame, Intrinsics, CameraPose } from "../directGeoref/projection";
import { CORN_V1_VERSION } from "../rowCrop/cornV1";
import { CORN_FIELD_VERSION, FIELD, type CornFieldResult, type CornPhotoRead, type FieldGap, type FieldWeed, cornField } from "./cornField";
import type { TwinBundle } from "./types";

export { TWIN_ANALYSIS_ENABLED, TWIN_ANALYSIS_FILE, TWIN_ANALYSIS_MAX_BYTES } from "./analysisConfig";
export const TWIN_ANALYSIS_FORMAT = "swardus-twin-analysis-v1";

/** One aligned camera, as the field combination used it. The ground is the build's flat plane (its height here). */
export type AnalysisFrame = { name: string; intrinsics: Intrinsics; pose: CameraPose; ground: { altM: number; datum: string; basis: string } };
/** The pixels of the original photograph an evidence crop was cut from; (atlas, x, y) is the crop's cell, as its evidence entry in the twin names it. */
export type AnalysisCrop = { atlas: number; x: number; y: number; photo: string; x0: number; y0: number; size: number };

export type TwinAnalysis = {
  format: typeof TWIN_ANALYSIS_FORMAT;
  /** The twin this belongs to (its id is also its folder). */
  twinId: string;
  builtAt: string;
  crop: "corn";
  engine: { cornV1: number; cornField: number; twinEngine: string };
  /** The field combination's settings at the build: a later re-read uses these, whatever the code's have become. */
  fieldOptions: typeof FIELD;
  /** The photographs the field was combined from. Name, size and date only: no pixels, no digest. */
  photographs: { name: string; bytes: number | null; width: number; height: number; capturedAt: string | null }[];
  frames: AnalysisFrame[];
  /** Corn V1's read of every photograph, exactly as the field combination received it (no rounding beyond its own). */
  reads: CornPhotoRead[];
  /** Where each finding of the twin lies in each photograph that reported it (original-frame pixels), by the twin's own ids. */
  sightings: { weeds: { id: number; sightings: FieldWeed["sightings"] }[]; gaps: { id: number; sightings: FieldGap["sightings"] }[] };
  crops: AnalysisCrop[];
  /** Anything left out, with the reason. */
  notes: string[];
};

export type AnalysisInputs = {
  twin: TwinBundle;
  reads: CornPhotoRead[];
  field: CornFieldResult;
  frames: Map<string, GeorefFrame>;
  crops: AnalysisCrop[];
  /** Each photograph's file size and capture time, where known. */
  photographs: Map<string, { bytes: number | null; capturedAt: string | null }>;
};

/**
 * The record of a corn build, or null when there is nothing to record (not a corn twin, or a camera whose ground is
 * not the flat plane: a surface is a function and cannot be written down). Reads its inputs only: the twin, the reads
 * and the field are not changed.
 */
export function buildTwinAnalysis(inp: AnalysisInputs): TwinAnalysis | null {
  const { twin, field } = inp;
  if (!twin.corn) return null;
  const notes: string[] = [];
  const used = inp.reads.filter(r => inp.frames.has(r.name));
  const frames: AnalysisFrame[] = [];
  for (const r of used) {
    const f = inp.frames.get(r.name)!;
    if (f.ground.kind !== "flat") return null;
    frames.push({ name: f.name, intrinsics: f.intrinsics, pose: f.pose, ground: { altM: f.ground.altM, datum: f.ground.datum, basis: f.ground.basis } });
  }
  // The twin numbers its weed observations itself (those some photograph called a weed, in the field's order); a
  // sighting list is attached only where the twin's observation is provably the field's (same place).
  const same = (a: number, b: number) => Math.abs(a - b) < 5e-9;
  const fieldWeeds = field.weeds.filter(w => w.votes["weed candidate"] > 0);
  const weedsMatch = fieldWeeds.length === twin.corn.weeds.length && fieldWeeds.every((w, i) => same(w.lat, twin.corn!.weeds[i].lat) && same(w.lng, twin.corn!.weeds[i].lng));
  if (!weedsMatch) notes.push("weed sightings left out: the twin's weed observations could not be matched to the field's one for one");
  const gapsMatch = field.gaps.length === twin.corn.gaps.length && field.gaps.every((g, i) => g.id === twin.corn!.gaps[i].id);
  if (!gapsMatch) notes.push("gap sightings left out: the twin's gaps could not be matched to the field's one for one");
  return {
    format: TWIN_ANALYSIS_FORMAT, twinId: twin.id, builtAt: twin.builtAt, crop: "corn",
    engine: { cornV1: CORN_V1_VERSION, cornField: CORN_FIELD_VERSION, twinEngine: twin.corn.engine },
    fieldOptions: FIELD,
    photographs: used.map(r => { const f = inp.frames.get(r.name)!, p = inp.photographs.get(r.name); return { name: r.name, bytes: p?.bytes ?? null, width: f.intrinsics.width, height: f.intrinsics.height, capturedAt: p?.capturedAt ?? null }; }),
    frames, reads: used,
    sightings: {
      weeds: weedsMatch ? fieldWeeds.map((w, i) => ({ id: twin.corn!.weeds[i].id, sightings: w.sightings })) : [],
      gaps: gapsMatch ? field.gaps.map(g => ({ id: g.id, sightings: g.sightings })) : [],
    },
    crops: inp.crops, notes,
  };
}

/** The record as JSON bytes (the page gzips them when it saves). */
export const analysisBytes = (a: TwinAnalysis): Uint8Array => new TextEncoder().encode(JSON.stringify(a));

export type AnalysisParse = { ok: true; analysis: TwinAnalysis } | { ok: false; reason: string };
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A record from parsed JSON, or the reason it cannot be one. */
export function parseTwinAnalysis(json: unknown): AnalysisParse {
  if (!json || typeof json !== "object") return { ok: false, reason: "not a JSON object" };
  const a = json as Partial<TwinAnalysis>;
  if (a.format !== TWIN_ANALYSIS_FORMAT) return { ok: false, reason: `format is ${JSON.stringify(a.format)}, expected ${TWIN_ANALYSIS_FORMAT}` };
  if (typeof a.twinId !== "string" || a.crop !== "corn") return { ok: false, reason: "no twin id, or not a corn record" };
  if (!a.engine || !isNum(a.engine.cornV1) || !isNum(a.engine.cornField)) return { ok: false, reason: "no engine versions" };
  if (!a.fieldOptions || typeof a.fieldOptions !== "object") return { ok: false, reason: "no field settings" };
  for (const k of ["photographs", "frames", "reads", "crops", "notes"] as const) if (!Array.isArray(a[k])) return { ok: false, reason: `${k} is not a list` };
  if (!a.sightings || !Array.isArray(a.sightings.weeds) || !Array.isArray(a.sightings.gaps)) return { ok: false, reason: "no sightings" };
  const names = new Set<string>();
  for (const f of a.frames!) {
    const k = f?.intrinsics, p = f?.pose;
    if (!f || typeof f.name !== "string" || !k || !p || !f.ground) return { ok: false, reason: "a camera is missing its name, lens, pose or ground" };
    if (![k.width, k.height, k.fx, k.fy, k.cx, k.cy, p.lat, p.lng, p.altM, f.ground.altM].every(isNum)) return { ok: false, reason: `camera ${f.name} has a number missing` };
    if (!p.attitude || ![p.attitude.yawDeg, p.attitude.pitchDeg, p.attitude.rollDeg].every(isNum) || !p.boresight || !Array.isArray(p.boresight.rotation) || p.boresight.rotation.length !== 9) return { ok: false, reason: `camera ${f.name} has no attitude or boresight` };
    names.add(f.name);
  }
  for (const r of a.reads!) {
    if (!r || typeof r.name !== "string" || !isNum(r.scale) || !Array.isArray(r.rows) || !Array.isArray(r.patches) || !Array.isArray(r.gaps) || !Array.isArray(r.plants)) return { ok: false, reason: "a photograph's read is incomplete" };
    if (!names.has(r.name)) return { ok: false, reason: `the read of ${r.name} has no camera` };
  }
  return { ok: true, analysis: a as TwinAnalysis };
}

/** The cameras of a record, as the field combination takes them. */
export function framesFromAnalysis(a: TwinAnalysis): Map<string, GeorefFrame> {
  return new Map(a.frames.map(f => [f.name, { name: f.name, intrinsics: f.intrinsics, pose: f.pose, ground: { kind: "flat" as const, altM: f.ground.altM, datum: f.ground.datum, basis: f.ground.basis } }]));
}

/**
 * The field's combination again, from the record alone: the same reads, cameras and settings give the same rows,
 * weeds and gaps as the build (its timing aside). For the tests and scripts; the app does not call it.
 */
export function reproduceCornField(a: TwinAnalysis): CornFieldResult {
  return cornField(a.reads, framesFromAnalysis(a), a.fieldOptions);
}
