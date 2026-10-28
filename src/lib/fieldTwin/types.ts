// The Swardus Field Twin: a field as vectors, built straight from the original drone photographs.
//
// No satellite layer and no orthomosaic: every object on the map was measured in the photographs themselves and
// carries the crops that show it (evidence). The bundle is written by scripts/directGeoref/buildTwin.ts and read
// by the Field Twin page (src/pages/app/FieldTwin.tsx). parseTwin is the only way in: anything that is not a
// well-formed bundle is refused with a reason, never half-drawn.

import type { TwinBoundary } from "./boundary";

export const FIELD_TWIN_FORMAT = "swardus-field-twin-v1";

export type LatLngPair = [number, number];

/** One crop of an original photograph showing the object, packed in an atlas image. */
export type TwinEvidence = {
  photo: string;
  /** Index into TwinBundle.atlases. */
  atlas: number;
  /** The crop's square cell in the atlas, pixels. */
  x: number;
  y: number;
  size: number;
  /** Ground width the cell shows, metres (null when unknown). */
  metresAcross: number | null;
  /** The object's outline in the cell's own pixels. */
  poly: [number, number][];
};

export type TwinRow = {
  id: number;
  /** Kept rows passed the evidence checks; the rest are listed with the reason they were dropped. */
  kept: boolean;
  reason: string | null;
  line: LatLngPair[];
  trees: number;
  inferred: number;
  photos: number;
  lengthM: number;
  straightnessSdM: number;
};

export type TwinTree = {
  id: number;
  lat: number;
  lng: number;
  crownRadiusM: number;
  /** Height of the crown's centre above the ground plane, from the photographs' parallax; null with one view. */
  heightM: number | null;
  seenBy: number;
  coveredBy: number;
  /** How far the views put the tree from its reconciled position (median), metres. */
  viewSpreadM: number;
  sizeCv: number;
  rowId: number | null;
  evidence: TwinEvidence[];
};

export type WeedStatus = "verified" | "single view" | "on a tree";
export type RowStatus = "on a row" | "between rows" | "no rows";

export type TwinWeed = {
  id: number;
  lat: number;
  lng: number;
  status: WeedStatus;
  rowStatus: RowStatus;
  diameterM: number;
  areaM2: number;
  spanM: number | null;
  heightM: number | null;
  seenBy: number;
  coveredBy: number;
  viewSpreadM: number;
  sizeCv: number;
  score: number | null;
  treeId: number | null;
  ring: LatLngPair[];
  evidence: TwinEvidence[];
};

export type TwinVegetation = { id: number; lat: number; lng: number; areaM2: number; seenBy: number; ring: LatLngPair[] };

export type TwinBundle = {
  format: typeof FIELD_TWIN_FORMAT;
  id: string;
  name: string;
  builtAt: string;
  source: {
    photographs: number; camera: string; capturedAt: string | null; groundPixelCm: number;
    method: string; weedModel: string; treeModel: string;
  };
  origin: { lat: number; lng: number };
  bounds: [LatLngPair, LatLngPair];
  field: { rowDirectionDeg: number; rowSpacingM: number; plantSpacingM: number };
  footprints: { photo: string; ring: LatLngPair[] }[];
  rows: TwinRow[];
  trees: TwinTree[];
  inferredTrees: { row: number; lat: number; lng: number }[];
  weeds: TwinWeed[];
  vegetation: TwinVegetation[];
  atlases: { file: string; width: number; height: number }[];
  stats: Record<string, unknown>;
  /**
   * The inferred cultivated block with its evidence (boundary.ts), written by the build; absent in older bundles.
   * Never an operational boundary: that is the operator's, kept by the app.
   */
  boundary?: TwinBoundary | null;
};

export type ParseResult = { ok: true; twin: TwinBundle } | { ok: false; reason: string };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isLatLng = (v: unknown): v is LatLngPair => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && Math.abs(v[0]) <= 90 && Math.abs(v[1]) <= 180;
const isArr = (v: unknown): v is unknown[] => Array.isArray(v);

function checkEvidence(e: unknown, atlases: number): string | null {
  if (!e || typeof e !== "object") return "evidence entry is not an object";
  const x = e as Partial<TwinEvidence>;
  if (typeof x.photo !== "string" || !isNum(x.atlas) || !isNum(x.x) || !isNum(x.y) || !isNum(x.size) || !isArr(x.poly)) return "evidence entry is missing fields";
  if (x.atlas < 0 || x.atlas >= atlases) return `evidence points at atlas ${x.atlas}, the bundle has ${atlases}`;
  return null;
}

/** A Field Twin bundle from parsed JSON, or the reason it cannot be one. */
export function parseTwin(json: unknown): ParseResult {
  if (!json || typeof json !== "object") return { ok: false, reason: "not a JSON object" };
  const t = json as Partial<TwinBundle>;
  if (t.format !== FIELD_TWIN_FORMAT) return { ok: false, reason: `format is ${JSON.stringify(t.format)}, expected ${FIELD_TWIN_FORMAT}` };
  if (typeof t.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(t.id)) return { ok: false, reason: "id must be lowercase letters, digits and dashes" };
  if (typeof t.name !== "string") return { ok: false, reason: "no name" };
  if (!t.origin || !isNum(t.origin.lat) || !isNum(t.origin.lng)) return { ok: false, reason: "no origin" };
  if (!isArr(t.bounds) || t.bounds.length !== 2 || !t.bounds.every(isLatLng)) return { ok: false, reason: "bounds are not two latitude/longitude pairs" };
  for (const k of ["footprints", "rows", "trees", "inferredTrees", "weeds", "vegetation", "atlases"] as const) if (!isArr(t[k])) return { ok: false, reason: `${k} is not a list` };
  const nAtlas = t.atlases!.length;
  for (const a of t.atlases!) if (!a || typeof a.file !== "string" || !/^atlas-\d+\.jpg$/.test(a.file)) return { ok: false, reason: "an atlas file name is not atlas-N.jpg" };
  for (const r of t.rows!) if (!isArr(r.line) || r.line.length < 2 || !r.line.every(isLatLng)) return { ok: false, reason: `row ${r.id} has no line` };
  for (const tr of t.trees!) {
    if (!isNum(tr.lat) || !isNum(tr.lng) || !isNum(tr.crownRadiusM)) return { ok: false, reason: `tree ${tr.id} has no position or crown` };
    for (const e of tr.evidence ?? []) { const why = checkEvidence(e, nAtlas); if (why) return { ok: false, reason: `tree ${tr.id}: ${why}` }; }
  }
  for (const w of t.weeds!) {
    if (!isNum(w.lat) || !isNum(w.lng) || !isNum(w.diameterM)) return { ok: false, reason: `weed ${w.id} has no position or size` };
    if (!["verified", "single view", "on a tree"].includes(w.status as string)) return { ok: false, reason: `weed ${w.id} has an unknown status` };
    if (!isArr(w.ring) || !w.ring.every(isLatLng)) return { ok: false, reason: `weed ${w.id} has a broken outline` };
    for (const e of w.evidence ?? []) { const why = checkEvidence(e, nAtlas); if (why) return { ok: false, reason: `weed ${w.id}: ${why}` }; }
  }
  if (t.boundary != null) {
    const b = t.boundary as Partial<TwinBoundary>;
    if (b.version !== 1 || !b.cultivated || !isArr(b.cultivated.ring) || b.cultivated.ring.length < 3 || !b.cultivated.ring.every(isLatLng)) return { ok: false, reason: "boundary is not a version 1 record with a ring of latitude/longitude pairs" };
    if (!isArr(b.cultivated.vertices) || b.cultivated.vertices.length !== b.cultivated.ring.length) return { ok: false, reason: "boundary vertices do not match its ring" };
    if (!isNum(b.cultivated.areaM2) || !isArr(b.cultivated.failures)) return { ok: false, reason: "boundary has no area or failure list" };
  }
  return { ok: true, twin: t as TwinBundle };
}
