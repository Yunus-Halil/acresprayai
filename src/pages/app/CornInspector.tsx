// Development only: the corn inspector. Load a flight's folder (or one photograph) and step through what the corn
// algorithm does, drawn on one photograph at a time; switch options and see what changes; score a photograph against
// hand labels. Everything shown is computed by the app's own code on the dev server (scripts/rowCrop/cornInspect.ts,
// run by scripts/rowCrop/cornInspectorPlugin.ts; the scoring is scripts/rowCrop/cornLabelJudge.ts, the scorer of
// SCORE.md onwards); this page only draws it, using the app's own projection to bring field positions into the
// photograph. Mounted under import.meta.env.DEV only (App.tsx), not linked from the app, never in a production build.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type GeorefFrame, groundToPixel, pixelToGround } from "@/lib/directGeoref/projection";
import { framesFromAnalysis, type TwinAnalysis } from "@/lib/fieldTwin/analysis";
import { PLANTS_FIRST, PLANTS_FIRST_V1, type PhotoShift, SEQUENCE, SEQUENCE_V1, shiftOf } from "@/lib/fieldTwin/plantsFirst";
import { CORN_CORES, CORN_COUNT_GUARD } from "@/lib/rowCrop/cornV1";
import { CORN_CANDIDATE_FINAL3 } from "@/lib/fieldTwin/cornSetups";
import { LAYERS } from "@/lib/fieldTwin/layers/options";
import { fromEnu, toEnu, type LatLngAlt } from "@/lib/sourceFrames/odm";

const API = "/__corn-inspector";
type Job = { state: "waiting" | "running" | "done" | "failed"; error?: string; done?: number; total?: number; started?: number; ended?: number };
type Opts = Record<string, unknown>;
type Setup = { key: string; readKey: string; fieldKey: string; read: Opts; field: Opts; fieldJob?: Job };
type Session = { id: string; kind: "flight" | "photo"; path: string; photos: { name: string; file: string }[]; analysis: string | null; analysisSource: string | null; build?: Job; reads: Record<string, Job>; setups: Record<string, Setup>; photoJobs: Record<string, Job>; scores: Record<string, Job>; labels: { images: { image: string; plants: number; unsure: number }[] } | null };
type Pt = [number, number];
type PhotoInfo = {
  name: string; width: number; height: number; flight: boolean; readMs: number; ms: number; gsdM: number | null; gsdBasis: string; readScale: { gsdM: number; basis: string };
  plans: { stage: string; share: number; pitchPx: number }[]; rowSpacingPx: number | null; greenShare: number; firstPass: Pt[]; typicalPx: number; coresAdded: Pt[]; marks: Pt[];
  cores: { finePx: number; widePx: number; reference: string; factor: number; share: number; strongest: number; medianOnMarks: number | null; onMarks: number | null; threshold: number | null; peaks: number | null; kept: number; keptInCover: number; keptOnNoPiece: number; added: number; white: number } | null;
  /** L2: the marks of the pass with the cores asked (or the first pass), and per mark which views found it (1 green, 2 a core, 3 both). */
  foundPoints?: Pt[]; foundBy?: number[];
  coresOn: boolean; readMarks: number; readMarksAreTheExpectedPass: boolean | null; candidates: number | null;
  rows: { points: Pt[]; identity: string; evidence: string; plants: number | null }[];
  guard: { on: boolean; share: number | null; cut: number; withheld: boolean | null };
  summary: Record<string, unknown>; notes: string[];
  scout: { rows: { points: Pt[]; identity?: string; gaps: { x1: number; y1: number; x2: number; y2: number }[] }[]; weeds: { x: number; y: number; hull: Pt[]; areaM2: number }[]; excluded: number; summary: Record<string, unknown>; cornV1?: Record<string, unknown>; notes: string[] } | null;
};
type FieldMeta = {
  analysis: string; photographsRead: number; photographs: number; fieldOptionsOfTheRecordEqualFIELD: boolean; failed?: string;
  origin: LatLngAlt; directionDeg: number | null; pitchM: number | null; photos: string[]; shifts: PhotoShift[]; strict: number; repeatM: number; gateM: number; nDots: number; nSights: number; nCand: number;
  frames: TwinAnalysis["frames"]; ground: { e0: number; n0: number; cell: number; gw: number; gh: number; dcell: number; dw: number; dh: number; spacingM: number } | null; groundAsked: boolean;
  planting: { judged: boolean; why: string | null; plantedM2: number; scatteredM2: number; plantSpacingM: number | null };
  geometry: { spacingM: number; directionDeg: number; seedM: number | null; rowLengthMedianM: number; perMMedian: number; certainDots: number; certainRows: number };
  tooCloseM: number; certainGaps: number; spacingRules: boolean; gaps: { filled: number; gapM: number; bridged: number; notConfirmedStretches: number; cutOverMaxBridge: number; cutOverScattered: number }; alleyRefused: number; alone: number;
  rows: { id: number; kind: "certain" | "geometry"; plants: number; lengthM: number; perM: number; line: Pt[]; segments: { a0: number; a1: number; confirmed: boolean }[] }[];
  sequence: Record<string, unknown>; placing: Record<string, unknown>; settledNames: Record<string, string>; settledLine: Record<string, number>; source: string; lines: { certainEvidence: number; reconstruct: number; placeDots: number };
  report: { plants: Record<string, number> | null; plantsNote: string | null; plantPoints: Pt[]; plantShown: number[]; field: Record<string, unknown>; weeds: { e: number; n: number; verdict: string; areaM2: number; seenBy: number; coveredBy: number }[]; gaps: { aEN: Pt; bEN: Pt; verdict: string; lengthM: number }[]; fieldRows: number };
  arrays: { name: string; type: "f32" | "f64" | "i32" | "u8"; length: number; offset: number }[];
  /** L5's record (layers/l5Profile.ts fieldProfile; readsProfile where the flight made no dot). */
  profile?: Record<string, { value: unknown; measured: boolean; note?: string }> & { perPhoto?: Record<string, unknown>[] };
  /** L7 (LAYERS.secondLook): every spot looked at again. */
  secondLook?: { examined: { gaps: number; refused: number }; added: { inGaps: number; refusedPlaced: number }; refusedBecause: Record<string, number>; photographsRead: number;
    spots: { kind: "gap" | "refused"; e: number; n: number; decision: "added" | "refused"; reason: string; added: number[]; looked: number; shows: number; dot?: number; looks: { photo: string; u: number; v: number; shows: boolean; why: string }[] }[] } | null;
  /** L8's unsure list (LAYERS.unsureList). */
  unsure?: { recorded: boolean; plantsLooked: number; count: number; coresOnly: number; dots: { dot: number; kind: string; photographs: { name: string; foundBy: number }[] }[] } | null;
};
type Field = { meta: FieldMeta; a: Record<string, Float32Array | Float64Array | Int32Array | Uint8Array>; frames: Map<string, GeorefFrame>; sightDot: Int32Array; candDot: Int32Array };
type ScoreT = { tile: string; labelled: number; unsure: number; marks: number[]; found: number[]; wrong: number[]; wrongSecond: number[]; wrongNothing: number[]; onUnsure: number[]; atEdge: number[]; missed: number };
type Tally = { marks: number; found: number; wrongSecond: number; wrongNothing: number; onUnsure: number; atEdge: number };
type ScoreFile = { secondLook?: { marksInTiles: Tally } | null; unsure?: { count: number; marksInTiles: Tally } | null; image: string; hidden: boolean; unit: "m" | "px"; R: number; Rfull: number | null; tiers: string[]; tiles: { id: string; x: number; y: number; w: number; h: number }[]; heldBack?: { id: string; x: number; y: number; w: number; h: number }[]; half: ScoreT[]; full: ScoreT[] | null; labels: { x: number; y: number; type: string; tile: string; found: boolean }[]; marks: { u: number; v: number; tier: number; state: number; second: number; tile: string }[] };

// ---- The options on this branch, read from the code (their defaults are the code's own).
type OptionDef = { group: "read" | "field"; path: string[]; label: string; def: unknown; values?: string[]; where: string };
const OPTIONS: OptionDef[] = [
  { group: "read", path: ["cores"], label: "Vivid cores (marks added where a piece holds more cores than marks)", def: CORN_CORES.on, where: "rowCrop/cornV1.ts CORN_CORES.on" },
  { group: "read", path: ["coresReference"], label: "What a core is measured against", def: CORN_CORES.reference, values: ["marks", "strongest"], where: "rowCrop/cornV1.ts CORN_CORES.reference" },
  { group: "read", path: ["countGuard"], label: "Emergence guard (withhold the count past the cut)", def: CORN_COUNT_GUARD.on, where: "rowCrop/cornV1.ts CORN_COUNT_GUARD.on" },
  { group: "read", path: ["rowSpans"], label: "Candidates carry their extent along the rows", def: true, where: "fieldTwin/build/corn.ts cornPhotoRead (rowSpans)" },
  ...Object.entries(SEQUENCE).filter(([k, v]) => k !== "free" && (typeof v === "boolean" || typeof v === "string")).map(([k, v]): OptionDef => ({ group: "field", path: ["sequence", k], label: k, def: v, ...(k === "alleyTest" ? { values: ["none", "row", "own", "all"] } : k === "loneMarkCompany" ? { values: ["located", "certain"] } : {}), where: `fieldTwin/plantsFirst.ts SEQUENCE.${k}` })),
  ...Object.entries(PLANTS_FIRST).filter(([, v]) => typeof v === "boolean").map(([k, v]): OptionDef => ({ group: "field", path: ["placing", k], label: k, def: v, where: `fieldTwin/plantsFirst.ts PLANTS_FIRST.${k}` })),
  { group: "field", path: ["free"], label: "free (loosened placement; not scored)", def: false, where: "fieldTwin/cornPlants.ts CornPlantsOptions.free (SEQUENCE.free and ROW_RECALL.anyView)" },
  { group: "field", path: ["fieldSeed"], label: "fieldSeed (split candidates at the measured spacing)", def: true, where: "fieldTwin/cornPlants.ts placeDots (fieldSeed)" },
  { group: "field", path: ["groundAsked"], label: "groundAsked (the field's ground judgement passed in)", def: true, where: "fieldTwin/build/corn.ts cornStage (passes the ground)" },
];
const getAt = (o: Opts, path: string[]): unknown => path.reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Opts)[k] : undefined), o);
/** Only what differs from the defaults: {} is the defaults. */
function normal(o: { read: Opts; field: Opts }) {
  const read: Opts = {}, field: Opts = {}, seq: Opts = {}, plc: Opts = {};
  for (const [k, v] of Object.entries(o.read)) { const d = OPTIONS.find(x => x.group === "read" && x.path[0] === k); if (v !== undefined && (!d || v !== d.def)) read[k] = v; }
  for (const [k, v] of Object.entries((o.field.sequence ?? {}) as Opts)) if (v !== (SEQUENCE as Opts)[k]) seq[k] = v;
  for (const [k, v] of Object.entries((o.field.placing ?? {}) as Opts)) if (v !== (PLANTS_FIRST as Opts)[k]) plc[k] = v;
  if (Object.keys(seq).length) field.sequence = seq; if (Object.keys(plc).length) field.placing = plc;
  for (const k of ["free", "fieldSeed", "groundAsked"]) { const d = OPTIONS.find(x => x.path[0] === k)!; if (o.field[k] !== undefined && o.field[k] !== d.def) field[k] = o.field[k]; }
  // The layers' own options (layers/options.ts): only what differs from LAYERS.
  const lay: Opts = {}; for (const [k, v] of Object.entries((o.field.layers ?? {}) as Opts)) if (v !== (LAYERS as Opts)[k]) lay[k] = v;
  if (Object.keys(lay).length) field.layers = lay;
  if (read.coresBySize === undefined || read.coresBySize === null || read.coresBySize === false) delete read.coresBySize;
  return { read, field };
}
const diffOf = (a: Opts, b: Opts) => Object.fromEntries(Object.entries(a).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(b[k])));
const PRESETS: { name: string; set: { read: Opts; field: Opts } }[] = [
  { name: "Defaults", set: { read: {}, field: {} } },
  // The old rules as cornLabelScore.ts run a and cornScoreboard.ts `base` set them: SEQUENCE_V1, PLANTS_FIRST_V1, no ground, no extents.
  { name: "Old rules", set: { read: { rowSpans: false }, field: { sequence: diffOf(SEQUENCE_V1 as Opts, SEQUENCE as Opts), placing: diffOf(PLANTS_FIRST_V1 as Opts, PLANTS_FIRST as Opts), groundAsked: false } } },
  { name: "Candidate: variant A with the cores", set: { read: { cores: true }, field: { sequence: { placeOffSpacing: true, offSpacingStricterOnly: true } } } },
  // The setup frozen for FINAL-3.md (fieldTwin/cornSetups.ts).
  { name: CORN_CANDIDATE_FINAL3.name, set: { read: CORN_CANDIDATE_FINAL3.read, field: CORN_CANDIDATE_FINAL3.field as Opts } },
];
/** The frozen preset (FINAL-3), the Layers panel's base. */
const FROZEN = { read: CORN_CANDIDATE_FINAL3.read as Opts, field: CORN_CANDIDATE_FINAL3.field as Opts };
/** The layers' options the panel switches (phases 2a, 3a, 3b, 4), each off at the frozen preset. */
const LAYER_SWITCHES: { key: string; layer: string; label: string; group: "read" | "field"; where: string }[] = [
  { key: "groundFromObvious", layer: "L5", label: "2a. Ground judged from L4's plants only", group: "field", where: "layers/l5Profile.ts groundFromObvious (LAYERS.groundFromObvious)" },
  { key: "coresBySize", layer: "L1", label: "3a. Cores' blurs from the typical plant size (re-reads the flight with the frozen preset's L5 sizes)", group: "read", where: "layers/l1Views.ts coresAsked (LAYERS.coresBySize)" },
  { key: "tooCloseFromSpread", layer: "L6", label: "3b. Too-close limit from the spacing's spread", group: "field", where: "layers/l5Profile.ts rowProfile (LAYERS.tooCloseFromSpread)" },
  { key: "secondLook", layer: "L7", label: "4. Second look where L6 and L5 disagree", group: "field", where: "layers/l7SecondLook.ts secondLookOnField (LAYERS.secondLook)" },
  { key: "unsureList", layer: "L8", label: "4. Unsure list (recorded only)", group: "field", where: "layers/l8Report.ts unsureList (LAYERS.unsureList)" },
];
const sortDeep = (v: unknown): unknown => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v as Opts).sort().map(k => [k, sortDeep((v as Opts)[k])])) : v);
const same = (a: unknown, b: unknown) => JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));

// The steps are the pipeline's layers (fieldTwin/layers, 2026-11-18), then the score against hand labels.
const STEPS = ["L1 Views", "L2 Find", "L3 Place", "L4 Obvious", "L5 Field profile", "L6 Judge", "L7 Second look", "L8 Report", "Labels and score"] as const;
const FLIGHT_ONLY = new Set([2, 3, 4, 5, 6]);
const VERDICT: Record<string, { col: string; words: string; placed: boolean }> = {
  certainRow: { col: "#3cff5a", words: "placed: a certain plant on a row the certain plants made", placed: true },
  placedAtSpacing: { col: "#40d8ff", words: "placed: on a row's line, a whole number of plant spacings from the nearest plant on it", placed: true },
  placedOffSpacing: { col: "#b4ff50", words: "placed by the spacing option: on a row's line, off the spacing", placed: true },
  freePlaced: { col: "#b4ff50", words: "placed by the loosened placement", placed: true },
  geometryRow: { col: "#ff60ff", words: "placed on a row found in a free slot of the planter's pattern", placed: true },
  scattered: { col: "#a0703c", words: "refused: on ground the field judged scattered", placed: false },
  noRow: { col: "#8c8c8c", words: "refused: no row's line reaches it", placed: false },
  noSpacing: { col: "#8c8c8c", words: "refused: the plant spacing is not measured on this flight, so the rule that would place it does not run", placed: false },
  alley: { col: "#b482ff", words: "refused: a second-look dot where its row's band does not beat the ground between the rows", placed: false },
  tooClose: { col: "#ff3c3c", words: "refused: closer to a plant on its row than the too-close limit (a second mark on a plant)", placed: false },
  tooFar: { col: "#ff9a00", words: "refused: more plant spacings from the nearest plant on its row than the reach allows", placed: false },
  offSpacing: { col: "#ffe628", words: "refused: not a whole number of plant spacings from the nearest plant on its row", placed: false },
  freeAlley: { col: "#b482ff", words: "refused by the loosened placement: band does not beat the alley", placed: false },
  freeTooClose: { col: "#ff3c3c", words: "refused by the loosened placement: too close to a plant on the row", placed: false },
  alone: { col: "#ff78c8", words: "taken off its row by the final sweep: a second-look mark with no located plant near it on that row", placed: false },
  secondLook: { col: "#ff40ff", words: "placed by the second look (L7): photographs show a plant of its own there", placed: true },
  cutFromRow: { col: "#ffffff", words: "placed on a row, then left on no row when the row was built (a piece of under three plants, a stretch with no plant over the bridge limit, or over ground judged scattered)", placed: false },
  none: { col: "#000000", words: "settled by no named test", placed: false },
};
const TIER = ["a mark of the stricter bar", "second look, 2+ photographs", "second look, 1 photograph near its frame's middle", "second look, 1 photograph anywhere"];
const SHOWN = [{ col: "#3cff5a", name: "certain" }, { col: "#40d8ff", name: "probable" }, { col: "#8c8c8c", name: "on no row" }, { col: "#ff9a00", name: "between rows" }, { col: "#ffe628", name: "along a row, 2+ photographs" }, { col: "#ff78c8", name: "along a row, 1 photograph" }, { col: "#ff40ff", name: "added by the second look (L7)" }];
const ADDED = "#ff40ff", REMOVED = "#ff3030";
const fmt = (x: number | null | undefined, d = 0) => (x == null || !Number.isFinite(x) ? "–" : x.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
const cm = (m: number | null | undefined) => (m == null ? "not measured" : `${fmt(m * 100, 1)} cm`);
const sgn = (x: number) => (x > 0 ? `+${fmt(x)}` : fmt(x));
const sum = (a: number[]) => a.reduce((t, x) => t + x, 0);

async function loadField(id: string, st: Setup): Promise<Field> {
  const base = `${API}/cache/${id}/R-${st.readKey}/F-${st.fieldKey}`;
  const mr = await fetch(`${base}/field.json`), br = await fetch(`${base}/field.bin`);
  if (!mr.ok || !br.ok) throw new Error(`the field of this setup is not on the dev server (${mr.status}, ${br.status})`);
  const meta = (await mr.json()) as FieldMeta;
  const buf = await br.arrayBuffer(), a: Field["a"] = {};
  for (const d of meta.arrays) a[d.name] = d.type === "f32" ? new Float32Array(buf, d.offset, d.length) : d.type === "f64" ? new Float64Array(buf, d.offset, d.length) : d.type === "i32" ? new Int32Array(buf, d.offset, d.length) : new Uint8Array(buf, d.offset, d.length);
  const frames = meta.frames ? framesFromAnalysis({ frames: meta.frames } as TwinAnalysis) : new Map<string, GeorefFrame>();
  const sightDot = new Int32Array(meta.nSights ?? 0).fill(-1), candDot = new Int32Array(meta.nCand ?? 0).fill(-1);
  if (a["dot.memberStart"]) { const st0 = a["dot.memberStart"], mem = a["dot.members"]; for (let i = 0; i < meta.nDots; i++) for (let k = st0[i]; k < st0[i + 1]; k++) (i < meta.strict ? sightDot : candDot)[mem[k]] = i; }
  return { meta, a, frames, sightDot, candDot };
}

/** Field positions into one photograph, and back: the app's projection with this photograph's registration shift
 * (plantsFirst.ts shiftOf), kept only where the pixel looks back at the place within 5 cm (the round-trip guard). */
function projector(F: Field, name: string) {
  const f = F.frames.get(name), pi = F.meta.photos.indexOf(name);
  if (!f || pi < 0) return null;
  const O = F.meta.origin, sh = F.meta.shifts[pi], altM = (f.ground as { altM?: number }).altM ?? 0, W = f.intrinsics.width, H = f.intrinsics.height;
  const pixelOf = (e: number, n: number, shifted = true): Pt | null => {
    let de = 0, dn = 0, u = 0, v = 0;
    for (let it = 0; it < (shifted ? 4 : 1); it++) { const p = fromEnu([e - de, n - dn, 0], O), h = groundToPixel(f, p.lat, p.lng, altM); if (!h) return null; u = h.u; v = h.v; if (shifted) [de, dn] = shiftOf(sh, u, v); }
    if (u < 0 || v < 0 || u >= W || v >= H) return null;
    const g = pixelToGround(f, u, v); if (!g) return null;
    const b = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, O), [se, sn] = shifted ? shiftOf(sh, u, v) : [0, 0];
    return Math.hypot(b[0] + se - e, b[1] + sn - n) <= 0.05 ? [u, v] : null;
  };
  const groundOf = (u: number, v: number): Pt | null => { const g = pixelToGround(f, u, v); if (!g) return null; const b = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, O), [se, sn] = shiftOf(sh, u, v); return [b[0] + se, b[1] + sn]; };
  return { f, pi, W, H, pixelOf, groundOf, shift: shiftOf(sh, W / 2, H / 2) };
}

/** Everything of one setup's field that falls in a photograph, projected once. */
function inPhotoOf(field: Field, P: NonNullable<ReturnType<typeof projector>>) {
  const a = field.a, n = field.meta.nDots;
  const corners = [[0, 0], [P.W, 0], [0, P.H], [P.W, P.H], [P.W / 2, 0], [P.W / 2, P.H], [0, P.H / 2], [P.W, P.H / 2]].map(([u, v]) => P.groundOf(u, v)).filter((x): x is Pt => !!x);
  const e0 = Math.min(...corners.map(c => c[0])) - 1, e1 = Math.max(...corners.map(c => c[0])) + 1, n0 = Math.min(...corners.map(c => c[1])) - 1, n1 = Math.max(...corners.map(c => c[1])) + 1;
  const dots: { i: number; u: number; v: number }[] = [];
  for (let i = 0; i < n; i++) { const e = a["dot.e"][i], nn = a["dot.n"][i]; if (e < e0 || e > e1 || nn < n0 || nn > n1) continue; const q = P.pixelOf(e, nn); if (q) dots.push({ i, u: q[0], v: q[1] }); }
  const at = new Map(dots.map(d => [d.i, d]));
  const sights: { k: number; u: number; v: number; dot: number }[] = []; for (let k = 0; k < field.meta.nSights; k++) if (a["sight.p"][k] === P.pi) sights.push({ k, u: a["sight.u"][k], v: a["sight.v"][k], dot: field.sightDot[k] });
  const cands: { k: number; u: number; v: number; dot: number; lone: boolean }[] = []; for (let k = 0; k < field.meta.nCand; k++) if (a["cand.p"][k] === P.pi) cands.push({ k, u: a["cand.u"][k], v: a["cand.v"][k], dot: field.candDot[k], lone: a["cand.sight"][k] >= 0 });
  const rows = field.meta.rows.map(r => ({ ...r, px: r.line.map(([e, nn]) => P.pixelOf(e, nn)) }));
  let shade: HTMLCanvasElement | null = null; const G = field.meta.ground;
  if (G) {
    const S = 24, w = Math.ceil(P.W / S), h = Math.ceil(P.H / S); shade = document.createElement("canvas"); shade.width = w; shade.height = h;
    const ctx = shade.getContext("2d")!, im = ctx.createImageData(w, h), st = a["ground.state"];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const g = P.groundOf((x + 0.5) * S, (y + 0.5) * S); if (!g) continue;
      const i = Math.floor((g[0] - G.e0) / G.cell), j = Math.floor((g[1] - G.n0) / G.cell); const s = i >= 0 && j >= 0 && i < G.gw && j < G.gh ? st[j * G.gw + i] : 0;
      const o = (y * w + x) * 4, c = s === 1 ? [60, 255, 90] : s === 2 ? [255, 60, 60] : [150, 150, 150]; im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
  }
  const plants = field.meta.report.plantPoints.map(([lat, lng], k) => { const b = toEnu({ lat, lng, altM: 0 }, field.meta.origin), q = P.pixelOf(b[0], b[1]); return q ? { u: q[0], v: q[1], shown: field.meta.report.plantShown[k] } : null; }).filter((x): x is { u: number; v: number; shown: number } => !!x);
  const weeds = field.meta.report.weeds.map(w => ({ ...w, px: P.pixelOf(w.e, w.n, false) })).filter(w => w.px);
  const gaps = field.meta.report.gaps.map(g => ({ ...g, a: P.pixelOf(g.aEN[0], g.aEN[1], false), b: P.pixelOf(g.bEN[0], g.bEN[1], false) })).filter(g => g.a && g.b);
  return { dots, at, sights, cands, rows, shade, plants, weeds, gaps };
}
type InPhoto = ReturnType<typeof inPhotoOf>;
/** For each point of `a`, whether `b` has one within `tol` pixels (a grid; one to one is not asked). */
function matched(a: { u: number; v: number }[], b: { u: number; v: number }[], tol: number): Uint8Array {
  const g = new Map<string, { u: number; v: number }[]>(), key = (x: number, y: number) => `${Math.floor(x / tol)},${Math.floor(y / tol)}`;
  for (const p of b) { const k = key(p.u, p.v); (g.get(k) ?? g.set(k, []).get(k)!).push(p); }
  return Uint8Array.from(a, p => { const cx = Math.floor(p.u / tol), cy = Math.floor(p.v / tol); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const q of g.get(`${cx + dx},${cy + dy}`) ?? []) if (Math.hypot(q.u - p.u, q.v - p.v) <= tol) return 1; return 0; });
}

export default function CornInspector() {
  const [path, setPath] = useState(() => { try { return localStorage.getItem("cornInspector.path") ?? ""; } catch { return ""; } });
  const [analysisPath, setAnalysisPath] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState<{ path: string; photographs: number }[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [view, setView] = useState<"photo" | "green" | "cores">("photo");
  const [draft, setDraft] = useState<{ read: Opts; field: Opts }>({ read: {}, field: {} });
  const [applied, setApplied] = useState<{ read: Opts; field: Opts }>({ read: {}, field: {} });
  const [showDiff, setShowDiff] = useState(true);
  // What "this setup" is compared with: the defaults, or (the Layers panel) the frozen preset.
  const [base, setBase] = useState<"defaults" | "frozen">("defaults");
  const [fields, setFields] = useState<Record<string, Field>>({});
  const [infos, setInfos] = useState<Record<string, PhotoInfo>>({});
  const [scores, setScores] = useState<Record<string, ScoreFile>>({});
  const [picked, setPicked] = useState<number | null>(null);
  const [hiddenTick, setHiddenTick] = useState(false), [spent, setSpent] = useState<Record<string, unknown>[]>([]);
  const [images, setImages] = useState<{ photo?: HTMLImageElement; green?: HTMLImageElement; cores?: HTMLImageElement }>({});
  const canvas = useRef<HTMLCanvasElement | null>(null), xf = useRef({ s: 0.2, x: 0, y: 0 }), [tick, setTick] = useState(0);
  // What has been asked of the dev server already (a field, a photograph's views, a score), so each is fetched once.
  const asked = useRef(new Set<string>());

  useEffect(() => { fetch(`${API}/known`).then(r => r.json()).then(setKnown).catch(() => setKnown([])); fetch(`${API}/hidden-spent`).then(r => r.json()).then(setSpent).catch(() => setSpent([])); }, []);
  const open = async () => {
    setError(null); setFields({}); setInfos({}); setScores({}); asked.current.clear(); setPhoto(null); setPicked(null); setApplied({ read: {}, field: {} }); setDraft({ read: {}, field: {} }); setHiddenTick(false); setBase("defaults");
    try { localStorage.setItem("cornInspector.path", path); } catch { /* not kept */ }
    const r = await fetch(`${API}/open`, { method: "POST", body: JSON.stringify({ path, analysis: analysisPath || undefined }) }), j = await r.json();
    if (!r.ok) { setError(j.error); return; }
    setSession(j); setPhoto(j.photos[0]?.name ?? null);
  };
  const setupFor = (o: { read: Opts; field: Opts }) => (session ? Object.values(session.setups).find(s => same(s.read, o.read) && same(s.field, o.field)) ?? null : null);
  const baseSet = useMemo(() => (base === "frozen" ? normal(FROZEN) : { read: {}, field: {} }), [base]), BN = base === "frozen" ? "the frozen preset" : "the defaults", BNc = base === "frozen" ? "Frozen preset" : "Defaults";
  const defSetup = setupFor(baseSet), curSetup = setupFor(applied), isDefault = same(applied, baseSet);
  const apply = async (o: { read: Opts; field: Opts }) => {
    if (!session) return;
    const n = normal(o); setApplied(n); setDraft(n); setPicked(null);
    const r = await fetch(`${API}/setup/${session.id}`, { method: "POST", body: JSON.stringify(n) }); if (r.ok) setSession(await r.json());
  };
  /** The Layers panel: the frozen preset with these layer options; the frozen preset itself is run first (the base). */
  const applyLayers = async (on: Record<string, boolean>) => {
    if (!session) return;
    setBase("frozen");
    let sess = session;
    if (!setupFor(normal(FROZEN))) { const r = await fetch(`${API}/setup/${session.id}`, { method: "POST", body: JSON.stringify(normal(FROZEN)) }); if (r.ok) { sess = await r.json(); setSession(sess); } }
    const frozenKey = Object.values(sess.setups).find(x => same(x.read, normal(FROZEN).read) && same(x.field, normal(FROZEN).field))?.key;
    const lay: Opts = {}; for (const d of LAYER_SWITCHES) if (d.group === "field" && on[d.key]) lay[d.key] = true;
    const set = { read: { ...FROZEN.read, ...(on.coresBySize ? { coresBySize: session.kind === "flight" ? `setup:${frozenKey}` : "self" } : {}) }, field: { ...FROZEN.field, ...(Object.keys(lay).length ? { layers: lay } : {}) } };
    await apply(set);
  };
  // The session's jobs, polled while any runs.
  useEffect(() => {
    if (!session) return;
    const jobs = [session.build, ...Object.values(session.reads), ...Object.values(session.setups).map(s => s.fieldJob), ...Object.values(session.photoJobs), ...Object.values(session.scores)];
    if (!jobs.some(j => j && (j.state === "running" || j.state === "waiting"))) return;
    const t = setTimeout(async () => { const r = await fetch(`${API}/session/${session.id}`); if (r.ok) setSession(await r.json()); }, 1500);
    return () => clearTimeout(t);
  }, [session]);
  // The fields of the default and the applied setup.
  useEffect(() => {
    if (!session || session.kind !== "flight") return;
    for (const st of [defSetup, curSetup]) if (st && st.fieldJob?.state === "done" && !asked.current.has(`field:${st.key}`)) { const k = st.key; asked.current.add(`field:${k}`); loadField(session.id, st).then(F => setFields(f => ({ ...f, [k]: F }))).catch(e => setError(String(e))); }
  }, [session, defSetup, curSetup, fields]);
  // The photograph's views and marks, for the default's read options and the applied one's.
  const photoKeys = useMemo(() => { const out: { rk: string; read: Opts }[] = []; for (const st of [defSetup, curSetup]) if (st && !out.some(x => x.rk === st.readKey)) out.push({ rk: st.readKey, read: st.read }); if (!defSetup && !out.length) out.push({ rk: "default", read: {} }); return out; }, [defSetup, curSetup]);
  useEffect(() => {
    if (!session || !photo) return;
    for (const { rk, read } of photoKeys) { const k = `${rk}/${photo}`; if (session.photoJobs[k]) continue; fetch(`${API}/photo/${session.id}/${encodeURIComponent(photo)}`, { method: "POST", body: JSON.stringify({ read }) }).then(r => r.json()).then(j => setSession(s => (s ? { ...s, photoJobs: { ...s.photoJobs, [k]: j } } : s))); }
  }, [session?.id, photo, photoKeys]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!session || !photo) return;
    for (const { rk } of photoKeys) { const k = `${rk}/${photo}`; if (session.photoJobs[k]?.state === "done" && !asked.current.has(`info:${k}`)) { asked.current.add(`info:${k}`); fetch(`${API}/cache/${session.id}/R-${rk}/photo/${encodeURIComponent(photo)}/info.json`).then(async r => { if (!r.ok) { asked.current.delete(`info:${k}`); return; } const j = await r.json(); setInfos(x => ({ ...x, [k]: j })); }); } }
  }, [session, photo, photoKeys, infos]);
  const curRk = curSetup?.readKey ?? "default", info = photo ? infos[`${curRk}/${photo}`] ?? null : null, baseInfo = photo ? infos[`${defSetup?.readKey ?? "default"}/${photo}`] ?? null : null, photoJob = photo && session ? session.photoJobs[`${curRk}/${photo}`] : undefined;
  useEffect(() => {
    if (!session || !photo) return;
    const load = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });
    setImages(s => ({ photo: s.photo?.dataset.name === photo ? s.photo : undefined }));
    load(`${API}/photo-file/${session.id}/${encodeURIComponent(photo)}`).then(im => { im.dataset.name = photo; setImages(s => ({ ...s, photo: im })); const c = canvas.current; if (c) { const s = Math.min(c.clientWidth / im.width, c.clientHeight / im.height); xf.current = { s, x: (c.clientWidth - im.width * s) / 2, y: (c.clientHeight - im.height * s) / 2 }; setTick(t => t + 1); } });
  }, [session?.id, photo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!session || !photo || photoJob?.state !== "done") return;
    const load = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });
    const b = `${API}/cache/${session.id}/R-${curRk}/photo/${encodeURIComponent(photo)}`;
    load(`${b}/green.png`).then(im => setImages(s => ({ ...s, green: im }))).catch(() => undefined); load(`${b}/cores.jpg`).then(im => setImages(s => ({ ...s, cores: im }))).catch(() => undefined);
  }, [session?.id, photo, photoJob?.state, curRk]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Labels and scores.
  const labelsFor = session?.labels?.images.find(i => i.image.replace(/\.[^.]+$/, "") === photo) ?? null;
  const scoreKey = (st: Setup | null, hidden: boolean) => (st && photo ? `${st.key}/${photo}/${hidden ? "hidden" : "dev"}` : "");
  const scoreDir = (st: Setup) => (session?.kind === "flight" ? `R-${st.readKey}/F-${st.fieldKey}` : `R-${st.readKey}`);
  useEffect(() => {
    if (!session || !photo) return;
    for (const st of [defSetup, curSetup]) for (const h of [false, true]) { if (!st) continue; const k = scoreKey(st, h); if (session.scores[k]?.state === "done" && !asked.current.has(`score:${k}`)) { asked.current.add(`score:${k}`); fetch(`${API}/cache/${session.id}/${scoreDir(st)}/score-${encodeURIComponent(photo)}${h ? "-hidden" : ""}.json`).then(async r => { if (!r.ok) { asked.current.delete(`score:${k}`); return; } const j = await r.json(); setScores(x => ({ ...x, [k]: j })); }); } }
  }, [session, photo, defSetup, curSetup, scores]); // eslint-disable-line react-hooks/exhaustive-deps
  const uploadLabels = async (file: File) => {
    if (!session) return;
    const r = await fetch(`${API}/labels/${session.id}`, { method: "POST", body: await file.text() }), j = await r.json();
    if (!r.ok) { setError(j.error); return; }
    setScores({}); for (const k of [...asked.current]) if (k.startsWith("score:") && !k.endsWith("/hidden")) asked.current.delete(k); const s = await fetch(`${API}/session/${session.id}`); if (s.ok) setSession(await s.json());
  };
  const score = async (hidden: boolean) => {
    if (!session || !photo) return;
    for (const st of hidden ? [curSetup] : [defSetup, curSetup]) { if (!st) continue; await fetch(`${API}/score/${session.id}`, { method: "POST", body: JSON.stringify({ setup: st.key, name: photo, hidden, ...(hidden ? { spend: "spend" } : {}) }) }); }
    const s = await fetch(`${API}/session/${session.id}`); if (s.ok) setSession(await s.json());
    if (hidden) fetch(`${API}/hidden-spent`).then(r => r.json()).then(setSpent);
  };
  const scoreCur = scores[scoreKey(curSetup, false)] ?? null, scoreDef = scores[scoreKey(defSetup, false)] ?? null, scoreHidden = scores[scoreKey(curSetup, true)] ?? null;
  const shownScore = hiddenTick && scoreHidden ? scoreHidden : scoreCur;

  // ---- The two setups' fields in this photograph.
  const fieldCur = curSetup ? fields[curSetup.key] ?? null : null, fieldDef = defSetup ? fields[defSetup.key] ?? null : null;
  const P = useMemo(() => (fieldCur && photo ? projector(fieldCur, photo) : null), [fieldCur, photo]);
  const Pd = useMemo(() => (fieldDef && photo ? projector(fieldDef, photo) : null), [fieldDef, photo]);
  const D = useMemo(() => (fieldCur && P ? inPhotoOf(fieldCur, P) : null), [fieldCur, P]);
  const Dd = useMemo(() => (isDefault ? D : fieldDef && Pd ? inPhotoOf(fieldDef, Pd) : null), [isDefault, D, fieldDef, Pd]);
  const comparing = !isDefault && showDiff;
  // What differs from the defaults in this photograph, matched by place (within TOL pixels).
  const TOL = 4;
  const diff = useMemo(() => {
    if (!comparing) return null;
    const out: Record<string, { added: { u: number; v: number }[]; removed: { u: number; v: number }[] }> = {};
    const pair = (name: string, a: { u: number; v: number }[], b: { u: number; v: number }[]) => { const ma = matched(a, b, TOL), mb = matched(b, a, TOL); out[name] = { added: a.filter((_, i) => !ma[i]), removed: b.filter((_, i) => !mb[i]) }; };
    if (info?.marks && baseInfo?.marks) pair("marks", info.marks.map(([u, v]) => ({ u, v })), baseInfo.marks.map(([u, v]) => ({ u, v })));
    if (D && Dd && fieldCur && fieldDef) {
      pair("dots", D.dots, Dd.dots);
      pair("certain", D.dots.filter(d => fieldCur.a["dot.certainty"][d.i] === 0), Dd.dots.filter(d => fieldDef.a["dot.certainty"][d.i] === 0));
      pair("onRows", D.dots.filter(d => fieldCur.a["dot.rowOf"][d.i] >= 0), Dd.dots.filter(d => fieldDef.a["dot.rowOf"][d.i] >= 0));
      pair("plants", D.plants, Dd.plants);
    }
    return out;
  }, [comparing, info, baseInfo, D, Dd, fieldCur, fieldDef]);

  // ---- Drawing.
  const draw = useCallback(() => {
    const c = canvas.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1; if (c.width !== c.clientWidth * dpr) { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; }
    const ctx = c.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = "#141414"; ctx.fillRect(0, 0, c.clientWidth, c.clientHeight);
    const { s, x, y } = xf.current, T = (u: number, v: number): Pt => [x + u * s, y + v * s];
    const base = images.photo; if (!base) return;
    ctx.imageSmoothingEnabled = s < 1;
    if (step === 0 && view === "cores" && images.cores) ctx.drawImage(images.cores, x, y, base.width * s, base.height * s);
    else { ctx.drawImage(base, x, y, base.width * s, base.height * s); if (step === 0 && view === "green" && images.green) { ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(x, y, base.width * s, base.height * s); ctx.drawImage(images.green, x, y, base.width * s, base.height * s); } }
    const dot = (u: number, v: number, r: number, col: string, fill = true) => { const [X, Y] = T(u, v); ctx.beginPath(); ctx.arc(X, Y, r, 0, 2 * Math.PI); if (fill) { ctx.fillStyle = col; ctx.fill(); } else { ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); } };
    const cross = (u: number, v: number, r: number, col: string, w = 2) => { const [X, Y] = T(u, v); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(X - r, Y - r); ctx.lineTo(X + r, Y + r); ctx.moveTo(X + r, Y - r); ctx.lineTo(X - r, Y + r); ctx.stroke(); };
    const square = (u: number, v: number, r: number, col: string) => { const [X, Y] = T(u, v); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(X - r, Y - r, 2 * r, 2 * r); };
    const line = (pts: (Pt | null)[], col: string, w = 2, dash: number[] = []) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash); ctx.beginPath(); let pen = false; for (const p of pts) { if (!p) { pen = false; continue; } const [X, Y] = T(p[0], p[1]); if (pen) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); pen = true; } ctx.stroke(); ctx.setLineDash([]); };
    const r = Math.max(2, Math.min(6, 2 + s * 4));
    const showDiffOf = (name: string) => { const d = diff?.[name]; if (!d) return false; for (const p of d.added) dot(p.u, p.v, r + 1.5, ADDED); for (const p of d.removed) cross(p.u, p.v, r + 2, REMOVED, 2.5); return true; };
    const a = fieldCur?.a;
    if (step === 1 && info) { if (comparing && diff?.marks) { for (const [u, v] of info.marks ?? []) dot(u, v, r * 0.6, "rgba(64,216,255,0.5)"); showDiffOf("marks"); } else if (info.foundBy) { info.foundPoints!.forEach(([u, v], k) => dot(u, v, info.foundBy![k] === 2 ? r + 1 : r, info.foundBy![k] === 1 ? "#40d8ff" : info.foundBy![k] === 3 ? "#3cff5a" : "#ff9a00")); } else { for (const [u, v] of info.firstPass) dot(u, v, r, "#40d8ff"); for (const [u, v] of info.coresAdded) dot(u, v, r + 1, "#ff9a00"); } }
    if (step === 2 && D && a) {
      for (const d of D.dots) dot(d.u, d.v, r + 2, d.i < fieldCur!.meta.strict ? "rgba(255,255,255,0.9)" : "rgba(255,230,40,0.45)", false);
      for (const sg of D.sights) { const t = sg.dot >= 0 ? D.at.get(sg.dot) : null; if (t) line([[sg.u, sg.v], [t.u, t.v]], "rgba(64,216,255,0.9)", 1); dot(sg.u, sg.v, r * 0.7, sg.dot >= 0 ? "#40d8ff" : "#ff3c3c"); }
      for (const cd of D.cands) { const t = cd.dot >= 0 ? D.at.get(cd.dot) : null; if (t) line([[cd.u, cd.v], [t.u, t.v]], "rgba(255,154,0,0.8)", 1); dot(cd.u, cd.v, r * 0.6, cd.dot >= 0 ? "#ff9a00" : "rgba(255,154,0,0.35)"); }
      if (comparing) showDiffOf("dots");
    }
    if (step === 3 && D && a) { for (const d of D.dots) { if (a["dot.certainty"][d.i] === 0) dot(d.u, d.v, r, comparing ? "rgba(60,255,90,0.45)" : "#3cff5a"); else if (!comparing) dot(d.u, d.v, r * 0.6, "rgba(200,200,200,0.45)"); } if (comparing) showDiffOf("certain"); }
    if (step === 4 && D) {
      if (D.shade) { ctx.globalAlpha = 0.28; ctx.imageSmoothingEnabled = false; ctx.drawImage(D.shade, x, y, base.width * s, base.height * s); ctx.globalAlpha = 1; }
      if (comparing && Dd) for (const row of Dd.rows) line(row.px, "rgba(255,255,255,0.8)", 1.5, [6, 5]);
      for (const row of D.rows) line(row.px, row.kind === "certain" ? "#40d8ff" : "#ff60ff", 2);
    }
    if (step === 6 && fieldCur?.meta.secondLook && photo) {
      // L7: every spot it looked at in this photograph: a ring where it looked (filled where this photograph shows a
      // plant there), green where the second look added, red where it refused.
      for (const sp of fieldCur.meta.secondLook.spots) for (const l of sp.looks) if (l.photo === photo) { const col = sp.decision === "added" ? "#3cff5a" : "#ff3030"; dot(l.u, l.v, r + (sp.kind === "gap" ? 6 : 4), col, false); if (l.shows) dot(l.u, l.v, r * 0.6, col); }
    }
    if ((step === 5 || step === 6) && D && a && fieldCur) { for (const d of D.dots) { const name = fieldCur.meta.settledNames[a["dot.settled"][d.i]] ?? "none"; dot(d.u, d.v, comparing ? r * 0.7 : r, comparing ? "rgba(140,140,140,0.5)" : VERDICT[name]?.col ?? "#000"); } if (comparing) showDiffOf("onRows"); }
    if (step === 7) {
      if (fieldCur && D) { for (const g of D.gaps) if (g.verdict === "stand gap") line([g.a, g.b], "#ff9a00", 3); for (const p of D.plants) dot(p.u, p.v, comparing ? r * 0.7 : r, comparing ? "rgba(140,140,140,0.5)" : SHOWN[p.shown]?.col ?? "#fff"); for (const w of D.weeds) if (w.verdict === "weed candidate") dot(w.px![0], w.px![1], r + 5, "#ff3c3c", false); if (comparing) showDiffOf("plants");
        // L8's unsure list: a violet ring on each unsure plant.
        for (const u of fieldCur.meta.unsure?.dots ?? []) { const q = D.at.get(u.dot); if (q) dot(q.u, q.v, r + 4, "#b482ff", false); } }
      else if (info?.scout) { for (const row of info.scout.rows) { line(row.points, row.identity === "corn" ? "#40d8ff" : "#ffe628", 2, row.identity === "corn" ? [] : [8, 6]); for (const g of row.gaps) line([[g.x1, g.y1], [g.x2, g.y2]], "#ff9a00", 3); } for (const w of info.scout.weeds) line([...w.hull, w.hull[0]], "#ff3c3c", 2); }
    }
    if (step === 8 && shownScore) {
      // The tiles: the scored ones outlined, the held-back ones greyed out (their labels are never sent here unless the check is spent).
      for (const t of shownScore.heldBack ?? []) { const [X, Y] = T(t.x, t.y); ctx.fillStyle = "rgba(40,40,40,0.82)"; ctx.fillRect(X, Y, t.w * s, t.h * s); }
      for (const t of shownScore.tiles) { const [X, Y] = T(t.x, t.y); ctx.strokeStyle = shownScore.hidden ? "#ff9a00" : "rgba(255,255,255,0.6)"; ctx.lineWidth = 1.5; ctx.strokeRect(X, Y, t.w * s, t.h * s); }
      for (const m of shownScore.marks) { if (m.state === 1) dot(m.u, m.v, r + 3, "#ffffff", false); else if (m.state === 0) cross(m.u, m.v, r + 2, m.second ? "#ff9a00" : "#ff3030", 2.5); else if (m.state === 3) dot(m.u, m.v, r + 3, "rgba(170,170,170,0.8)", false); else if (m.state === 2) dot(m.u, m.v, r + 3, "#b482ff", false); }
      for (const l of shownScore.labels) { if (l.type === "unsure") cross(l.x, l.y, r, "#b482ff", 1.5); else if (l.found) dot(l.x, l.y, r * 0.8, "#3cff5a"); else { square(l.x, l.y, r + 4, "#ff3030"); dot(l.x, l.y, r * 0.8, "#ff3030"); } }
    } else if (step === 8 && labelsFor && !shownScore) { /* labels are drawn once scored */ }
    if (picked != null && D) { const d = D.at.get(picked); if (d) { dot(d.u, d.v, r + 7, "#ffffff", false); dot(d.u, d.v, r + 9, "#000000", false); } }
  }, [images, step, view, info, D, Dd, fieldCur, picked, comparing, diff, shownScore, labelsFor]);
  useEffect(() => { draw(); }, [draw, tick]);
  useEffect(() => { const f = () => setTick(t => t + 1); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);

  // ---- Zoom, pan and a click on a dot.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const onWheel = (e: React.WheelEvent) => { const c = canvas.current!, b = c.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top, k = Math.exp(-e.deltaY * 0.0015), t = xf.current; xf.current = { s: t.s * k, x: mx - (mx - t.x) * k, y: my - (my - t.y) * k }; setTick(v => v + 1); };
  const onDown = (e: React.MouseEvent) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; };
  const onMove = (e: React.MouseEvent) => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true; xf.current = { ...xf.current, x: xf.current.x + dx, y: xf.current.y + dy }; d.x = e.clientX; d.y = e.clientY; setTick(v => v + 1); };
  const onUp = (e: React.MouseEvent) => {
    const d = drag.current; drag.current = null; if (!d || d.moved || !D || step < 2 || step > 6) return;
    const b = canvas.current!.getBoundingClientRect(), { s, x, y } = xf.current, u = (e.clientX - b.left - x) / s, v = (e.clientY - b.top - y) / s;
    let best: number | null = null, bd = 12 / s; for (const q of D.dots) { const dd = Math.hypot(q.u - u, q.v - v); if (dd < bd) { bd = dd; best = q.i; } }
    setPicked(best);
  };

  // ---- What went in and what came out, per step.
  const flight = session?.kind === "flight", M = fieldCur?.meta, A = fieldCur?.a, Md = fieldDef?.meta;
  const counts = (pick: (i: number) => string, list: number[]) => { const c: Record<string, number> = {}; for (const i of list) { const k = pick(i); c[k] = (c[k] ?? 0) + 1; } return c; };
  const change = (name: string, unit = "") => { const d = diff?.[name]; return d ? [[`Against ${BN}: added (magenta) / removed (red ×)${unit}`, `+${fmt(d.added.length)} / −${fmt(d.removed.length)} (${sgn(d.added.length - d.removed.length)})`]] as [string, string][] : []; };
  const waitingFlight = (): { title: string; rows: [string, string][] }[] => {
    const st = curSetup, rj = st ? session?.reads[st.readKey] : undefined;
    return [{ title: "Waiting", rows: [["The flight", session?.build?.state === "running" ? "building its cameras (the app's build pipeline)" : rj?.state === "running" ? `reading its photographs for this setup: ${rj.done ?? 0} of ${rj.total ?? "?"}` : st?.fieldJob?.state === "running" ? "combining the photographs over the field" : st?.fieldJob?.state === "failed" || rj?.state === "failed" || session?.build?.state === "failed" ? `failed: ${st?.fieldJob?.error ?? rj?.error ?? "see the logs in the session's folder"}` : "waiting"]] }];
  };
  const numbers = (): { title: string; rows: [string, string][] }[] => {
    if (step === 8) return [];
    if (!info && step < 2) return [{ title: "Waiting", rows: [["This photograph", photoJob?.state === "failed" ? `failed: ${photoJob.error ?? "see the log"}` : photoJob?.error ?? "being read on the dev server"]] }];
    if (FLIGHT_ONLY.has(step) && !flight) return [{ title: "Cannot run on a single photograph", rows: [["Why", "This step combines a flight's photographs through their cameras: it needs a folder of one flight's photographs."]] }];
    if (FLIGHT_ONLY.has(step) || (step === 7 && flight)) { if (!M || !A) return waitingFlight(); if (M.failed) return [{ title: "The field", rows: [["Result", M.failed]] }]; if (!P) return [{ title: "This photograph", rows: [["In the flight", "no: it has no camera in the flight's record"]] }]; }
    const I = info;
    if (step === 0 && I) return [
      { title: "In", rows: [["Photograph", `${I.width} × ${I.height} px`], ["Pixel size", `${fmt((I.gsdM ?? NaN) * 1000, 2)} mm (${I.gsdBasis})`], ["Pixel size the read used", `${fmt(I.readScale.gsdM * 1000, 2)} mm (${I.readScale.basis})`]] },
      { title: "Out", rows: [["Green (the plant read's mask)", `${fmt(I.greenShare * 100, 2)} % of the photograph`], ["The green read's plans", I.plans.map(p => `${p.stage} ${fmt(p.share * 100, 0)} %`).join(", ") || "none"], ["Row spacing it holds", I.rowSpacingPx ? `${fmt(I.rowSpacingPx, 1)} px` : "none: no cores are made"],
        ...(I.cores ? [["Cores view: the two blurs", `${fmt(I.cores.finePx, 1)} and ${fmt(I.cores.widePx, 1)} px`], ["A core is kept at or over", I.cores.reference === "marks" ? `${I.cores.factor} × the median core on the read's own marks (${fmt(I.cores.medianOnMarks, 4)}) = ${fmt(I.cores.threshold, 4)}` : `${I.cores.share} × the strongest core (${fmt(I.cores.strongest, 4)}) = ${fmt(I.cores.threshold, 4)}`], ["Strongest core in the photograph", fmt(I.cores.strongest, 4)], ["Cores kept", `${fmt(I.cores.kept)} (${fmt(I.cores.keptInCover)} in cover, ${fmt(I.cores.keptOnNoPiece)} on no piece)`], ["Cores view brightness", `white at ${fmt(I.cores.white, 4)}, three times the bar`]] as [string, string][] : []),
        ["Count guard", `${I.guard.on ? "on" : "off"}; green on ${I.guard.share == null ? "–" : fmt(I.guard.share * 100, 1) + " %"} of the rows' length, cut ${fmt(I.guard.cut * 100, 1)} %${I.guard.withheld ? ": COUNT WITHHELD" : ""}`], ["Time", `read ${fmt(I.readMs / 1000, 1)} s, all views ${fmt(I.ms / 1000, 1)} s`]] },
    ];
    if (step === 1 && I) return [
      { title: "In", rows: [["The green view", `${fmt(I.greenShare * 100, 2)} % green`], ["A typical plant", `${fmt(I.typicalPx, 0)} px across`]] },
      { title: "Out", rows: [["First-pass marks (blue)", fmt(I.firstPass.length)], ["Marks the cores add (orange)", `${fmt(I.coresAdded.length)} (the cores option is ${I.coresOn ? "ON in this setup: the later steps use them" : "off in this setup: the later steps do not use them"})`], ["Marks the read carries", `${fmt(I.readMarks)} (equal to the pass expected: ${I.readMarksAreTheExpectedPass == null ? "count withheld" : I.readMarksAreTheExpectedPass ? "yes" : "NO"})`], ...(comparing && baseInfo ? [["Marks the read carries with the defaults", fmt(baseInfo.readMarks)] as [string, string]] : []), ...change("marks"), ["Second-look candidates (lower bar)", I.candidates == null ? "not made on this photograph (the dark-leaf rule does not apply)" : fmt(I.candidates)], ["Rows in this photograph", `${I.rows.length} (${I.rows.filter(r => r.identity === "corn").length} corn)`]] },
    ];
    if (!M || !A || !P || !D) return [];
    const mine = D.sights.length, merged = D.sights.filter(s => s.dot >= 0).length;
    if (step === 2) return [
      { title: "In", rows: [["This photograph's marks", fmt(mine)], ["Its second-look sightings", `${fmt(D.cands.length)} (${fmt(D.cands.filter(c => c.lone).length)} of them its own lone marks)`], ["The flight", `${M.photos.length} photographs, ${fmt(M.nSights)} marks, ${fmt(M.nCand)} second-look sightings`]] },
      { title: "Out", rows: [["This photograph's marks in a dot (blue, a line to it)", `${fmt(merged)}`], ["… in no dot (red: no other photograph made it)", fmt(mine - merged)], ["Its second-look sightings in a candidate dot (orange)", fmt(D.cands.filter(c => c.dot >= 0).length)], ["Dots in this photograph", `${fmt(D.dots.filter(d => d.i < M.strict).length)} of the stricter marks (white rings), ${fmt(D.dots.filter(d => d.i >= M.strict).length)} candidates (yellow rings)`], ["Dots over the flight", `${fmt(M.strict)} + ${fmt(M.nDots - M.strict)} candidates${comparing && Md ? ` (defaults: ${fmt(Md.strict)} + ${fmt(Md.nDots - Md.strict)})` : ""}`], ...change("dots"), ["Merging gate", cm(M.gateM)], ["Repeat distance (registration)", cm(M.repeatM)], ["This photograph's shift at its centre", `${fmt(Math.hypot(P.shift[0], P.shift[1]) * 100, 1)} cm`], ["Rule", `placeDots, src/lib/fieldTwin/cornPlants.ts:${M.lines.placeDots}`]] },
    ];
    if (step === 3) { const c = D.dots.filter(d => A["dot.certainty"][d.i] === 0).length; return [
      { title: "In", rows: [["Dots in this photograph", fmt(D.dots.length)], ["Rule", `certain when at least ${M.sequence.certainViews} photographs made it and at least ${fmt(Number(M.sequence.certainShare) * 100, 0)} % of those that looked: ${M.source}:${M.lines.certainEvidence}`]] },
      { title: "Out", rows: [["Certain dots here (green)", fmt(c)], ["Certain dots over the flight", `${fmt(M.geometry.certainDots)}${comparing && Md ? ` (defaults ${fmt(Md.geometry.certainDots)})` : ""}`], ...change("certain")] },
    ]; }
    if (step === 4) return [
      { title: "In", rows: [["Certain dots over the flight", fmt(M.geometry.certainDots)]] },
      { title: "Out", rows: [["Rows (certain: blue, found in a free slot: magenta)", `${M.rows.length}: ${M.rows.filter(r => r.kind === "certain").length} + ${M.rows.filter(r => r.kind === "geometry").length}; ${M.geometry.certainRows} row lines from the certain plants${comparing && Md ? ` (defaults: ${Md.rows.length} rows, ${Md.geometry.certainRows} lines; dashed white)` : ""}`], ["Row spacing", `${cm(M.geometry.spacingM)} (${M.geometry.certainRows ? "measured" : "not measured: no row line from the certain plants"})`], ["Plant spacing", M.geometry.seedM == null ? "not measured" : `${cm(M.geometry.seedM)} (measured)`], ...profileRows(), ["Too-close limit", `${cm(M.tooCloseM)} (${M.sequence.tooCloseFromField ? `learned from ${fmt(M.certainGaps)} gaps between certain plants` : "half the plant spacing"})`], ["Rows' direction", `${fmt(M.geometry.directionDeg, 1)}°`], ["Spacing rules run", M.spacingRules ? "yes" : "no: the plant spacing is not measured"], ["A gap is long from", M.spacingRules ? cm(M.gaps.gapM) : "–"],
        ["Ground (shaded)", !M.groundAsked ? "not asked in this setup (groundAsked off)" : M.planting.judged ? `judged: ${fmt(M.planting.plantedM2)} m² planted (green), ${fmt(M.planting.scatteredM2)} m² scattered (red), the rest not judged (grey)` : `not judged on this flight${M.planting.why ? `: ${M.planting.why}` : ""}`]] },
    ];
    if (step === 6) { const SL = M.secondLook; if (!SL) return [{ title: "L7 Second look: off in this setup", rows: [["What it does", "Only where L6 and L5 disagree (a gap over the spacing spread's upper fence; a dot L6 refused on a row's line that 3 or more photographs made): the spot read again in the photographs over it, the green view to find, the cores view to part. A plant is added only where photographs show one (fieldTwin/layers/l7SecondLook.ts). Switch it on in the Layers panel."], ["The picture", "L6's"]] }];
      const here = SL.spots.filter(sp => sp.looks.some(l => l.photo === photo)), tal = scoreCur?.secondLook?.marksInTiles;
      return [{ title: "L7 Second look", rows: [["Spots examined (flight)", `${fmt(SL.examined.gaps)} gaps, ${fmt(SL.examined.refused)} refused dots`], ["Added (flight)", `${fmt(SL.added.inGaps)} in gaps, ${fmt(SL.added.refusedPlaced)} refused dots put on their row`], ["Photographs read again", fmt(SL.photographsRead)], ["In this photograph", `${fmt(here.length)} spots looked at: ${fmt(here.filter(x => x.decision === "added").length)} added (green rings), ${fmt(here.filter(x => x.decision === "refused").length)} refused (red); a filled centre where this photograph shows a plant`], ...(tal ? [["Its marks in the scored tiles", `${fmt(tal.marks)}: ${fmt(tal.found)} on a labelled plant, ${fmt(tal.wrongSecond)} second marks, ${fmt(tal.wrongNothing)} on nothing`] as [string, string]] : [])] },
        { title: "Refused, and why (flight)", rows: Object.entries(SL.refusedBecause).sort((x, y) => y[1] - x[1]).map(([k, v]) => [k, fmt(v)] as [string, string]) }]; }
    if (step === 5) { const name = (i: number) => M.settledNames[A["dot.settled"][i]] ?? "none", here = counts(name, D.dots.map(d => d.i)), all = counts(name, Array.from({ length: M.nDots }, (_, i) => i)); return [
      ...(comparing ? [{ title: `Against ${BN} (on a row)`, rows: change("onRows", ", on a row") }] : []),
      { title: "Verdicts (here / over the flight); click a dot", rows: Object.keys(VERDICT).filter(k => all[k]).map(k => [`${VERDICT[k].placed ? "✓" : "✗"} ${k}`, `${fmt(here[k] ?? 0)} / ${fmt(all[k])}  (${M.source}:${M.settledLine[k] ?? "?"})`] as [string, string]) },
    ]; }
    if (step === 7) { const R = M.report, p = R.plants, pd = Md?.report.plants, vs = (k: string) => (comparing && pd ? ` (${BN} ${fmt(pd[k])}, ${sgn((p?.[k] ?? 0) - pd[k])})` : ""); return [
      { title: "Plants (as the Field Twin keeps them)", rows: p ? [["Plants", `${fmt(p.plants)}${vs("plants")}`], ["certain / probable", `${fmt(p.certain)} / ${fmt(p.probable)}`], ["on no row / between rows", `${fmt(p.onNoRow)} / ${fmt(p.betweenRows)}`], ...(p.alongRowsTwo != null ? [["along the rows, 2+ / 1 photograph", `${fmt(p.alongRowsTwo)} / ${fmt(p.alongRowsOne)}`]] as [string, string][] : []), ["Rows", `${fmt(p.rows)}${vs("rows")}`], ["Row length with plants seen / not confirmed", `${fmt(p.confirmedM)} / ${fmt(p.notConfirmedM)} m`], ["In this photograph", fmt(D.plants.length)], ...change("plants")] : [["Plants", R.plantsNote ?? "–"]] },
      ...(M.unsure ? [{ title: "L8 Unsure list (violet rings)", rows: [["Plants the views disagree on", `${fmt(M.unsure.count)} of ${fmt(M.unsure.plantsLooked)} plants on a row (${fmt(M.unsure.coresOnly)} found by a core alone in every photograph)`], ["In this photograph", fmt(M.unsure.dots.filter(u => D.at.has(u.dot)).length)], ...(scoreCur?.unsure ? [["Unsure marks in the scored tiles", `${fmt(scoreCur.unsure.marksInTiles.marks)}: ${fmt(scoreCur.unsure.marksInTiles.found)} on a labelled plant, ${fmt(scoreCur.unsure.marksInTiles.wrongSecond)} second marks, ${fmt(scoreCur.unsure.marksInTiles.wrongNothing)} on nothing`] as [string, string]] : [])] as [string, string][] }] : []),
      { title: "The field", rows: [["Corn rows / planted rows", `${R.field.cornRows} / ${R.field.probableRows}`], ["Weed candidates (red rings)", `${R.field.weeds} (withheld ${R.field.weedsWithheld}); here ${D.weeds.filter(w => w.verdict === "weed candidate").length}`], ["Stand gaps (orange)", `${R.field.gaps}; here ${D.gaps.filter(g => g.verdict === "stand gap").length}`]] },
    ]; }
    return [];
  };
  /** L5's record as rows: every value with measured / not measured. */
  const profileRows = (): [string, string][] => {
    const R = M?.profile; if (!R) return [["Profile", "not in this field's record (made before the profile was recorded)"]];
    const ms = (k: string) => (R[k]?.measured ? "measured" : "not measured"), V = (k: string) => R[k]?.value as Record<string, unknown> | null;
    const sp = V("plantSpacingSpreadM") as { all: Record<string, number | null>; single: Record<string, number | null>; lowerFenceM: number | null; upperFenceM: number | null } | null;
    const tp = V("typicalPlant") as Record<string, number | null> | null, rl = V("rowLengthM") as Record<string, number | null> | null, mr = V("misreads") as { medianSpacingM: number | null; photographs: { name: string; ratio: number }[]; count: number } | null;
    const cr = V("coresReference") as { reference: string; photographs: number; threshold: Record<string, number | null>; finePx: Record<string, number | null>; widePx: Record<string, number | null> } | null, g4 = V("groundFromObvious") as Record<string, number> | null;
    const mine = R.perPhoto?.find(x => x.name === photo) as Record<string, unknown> | undefined, mineAll = mine?.allMarks as Record<string, number | null> | undefined;
    return [
      ["Plant spacing spread", sp ? `single spacings: ${cm(sp.single.q1)} / ${cm(sp.single.q2)} / ${cm(sp.single.q3)} (quartiles, ${fmt(sp.single.n as number)} gaps); every gap: ${cm(sp.all.q1)} / ${cm(sp.all.q2)} / ${cm(sp.all.q3)}; fences ${cm(sp.lowerFenceM)} and ${cm(sp.upperFenceM)} (${ms("plantSpacingSpreadM")})` : "not measured"],
      ["Typical plant (flight, L4's plants)", tp ? `${fmt(tp.sizePx, 1)} px across, green ${fmt(tp.green, 3)}, solidity ${fmt(tp.solidity, 2)} (${fmt(tp.sightings)} sightings; ${ms("typicalPlant")})` : `${R.typicalPlant?.note ?? "not measured"}`],
      ["… in this photograph", mine ? (mine.look === null ? "its read does not record the look" : `${fmt(mine.sizePx as number, 1)} px, green ${fmt(mine.green as number, 3)}, solidity ${fmt(mine.solidity as number, 2)} from ${fmt(mine.certainSightings as number)} certain sightings; all its marks: ${fmt(mineAll?.sizePx, 1)} px, green ${fmt(mineAll?.green, 3)}`) : "–"],
      ["Row length (certain lines)", rl ? `mean ${fmt(rl.mean, 1)} m, median ${fmt(rl.median, 1)} m over ${fmt(rl.n)} lines (${ms("rowLengthM")})` : "not measured"],
      ["Row spacing misread", mr ? `${fmt(mr.count)} photographs over ${fmt(CORN_COUNT_GUARD.misreadRatio ?? NaN, 1)} × the flight's median ${cm(mr.medianSpacingM)}${mr.photographs.length ? `: ${mr.photographs.map(x => `${x.name.replace(/^DJI_\d+_/, "")} ×${fmt(x.ratio, 2)}`).join(", ")}` : ""} (${ms("misreads")})` : "not measured"],
      ["Cores reference", cr ? `${cr.reference}: bar ${fmt(cr.threshold.q2, 4)} (quartiles ${fmt(cr.threshold.q1, 4)}–${fmt(cr.threshold.q3, 4)}) over ${fmt(cr.photographs)} photographs; blurs ${fmt(cr.finePx.q2, 1)} and ${fmt(cr.widePx.q2, 1)} px (recorded from the reads, L1)` : R.coresReference?.note ?? "not recorded"],
      ["Ground from L4 only (2a)", g4 ? `${fmt(g4.planted)} planted, ${fmt(g4.scattered)} scattered of ${fmt(g4.judged)} squares judged (${fmt(g4.points)} sightings of certain plants)` : R.groundFromObvious?.note ?? "off"],
    ];
  };
  const scoutNumbers = (): { title: string; rows: [string, string][] }[] => {
    const S = info?.scout; if (!S) return [];
    const s = S.summary as Record<string, number | null>, v = S.cornV1 as Record<string, unknown> | undefined;
    return [{ title: "Photo Scout's read (as the page shows it)", rows: [["Rows", `${s.rows} (${v?.cornRows ?? "?"} corn: blue; ${v?.probableRows ?? "?"} crop not confirmed: dashed yellow)`], ["Plants located", v?.plants == null ? `withheld: ${String(v?.countWithheld ?? "–")}` : fmt(v.plants as number)], ["Weed candidates (red outlines)", fmt(s.weeds)], ["Stand gaps (orange)", `${fmt(s.gaps)}, ${fmt(s.gapLengthM, 1)} m`], ["Not judged", `${fmt(S.excluded)} borders, cover or withheld findings`], ["Pixel size", `${fmt(info!.readScale.gsdM * 1000, 2)} mm (${info!.readScale.basis})`]] }];
  };
  /** This setup against the base: the change in found, wrong and count error (half the spacing). */
  const scoreTotals = (S: ScoreFile) => { const ts = S.half, lab = sum(ts.map(t => t.labelled)), f = sum(ts.map(t => sum(t.found))), w = sum(ts.map(t => sum(t.wrong))), m = sum(ts.map(t => sum(t.marks))), un = sum(ts.map(t => sum(t.onUnsure))); return { f, w, err: m - un - lab }; };
  const scoreDelta = (a: ScoreFile, b: ScoreFile): string[] => { const x = scoreTotals(a), y = scoreTotals(b); return [`found ${sgn(x.f - y.f)}`, "", `wrong ${sgn(x.w - y.w)}`, "", `count error ${sgn(x.err)} vs ${sgn(y.err)}`]; };
  /** A score as a table row: found of N, found in 100, wrong (second / nothing), wrong in 100 marks, count error. */
  const scoreRow = (S: ScoreFile, half = true): string[] => {
    const ts = half ? S.half : S.full!, lab = sum(ts.map(t => t.labelled)), f = sum(ts.map(t => sum(t.found))), w = sum(ts.map(t => sum(t.wrong))), ws = sum(ts.map(t => sum(t.wrongSecond))), wn = sum(ts.map(t => sum(t.wrongNothing))), m = sum(ts.map(t => sum(t.marks))), un = sum(ts.map(t => sum(t.onUnsure))), err = m - un - lab;
    return [`${fmt(f)} of ${fmt(lab)}`, fmt((100 * f) / lab, 1), `${fmt(w)} (${fmt(ws)} / ${fmt(wn)})`, fmt((100 * w) / m, 1), `${sgn(err)} (${err > 0 ? "+" : ""}${fmt((100 * err) / lab, 1)} %)`];
  };

  // ---- The picked dot.
  const dotPanel = () => {
    if (picked == null || !M || !A) return null;
    const i = picked, name = M.settledNames[A["dot.settled"][i]] ?? "none", V = VERDICT[name], st = A["dot.memberStart"], mem = A["dot.members"];
    const members: string[] = []; for (let k = st[i]; k < st[i + 1]; k++) { const m = mem[k]; if (i < M.strict) members.push(`${M.photos[A["sight.p"][m]]} (${Math.round(A["sight.u"][m])}, ${Math.round(A["sight.v"][m])})`); else members.push(`${M.photos[A["cand.p"][m]]} (${Math.round(A["cand.u"][m])}, ${Math.round(A["cand.v"][m])})${A["cand.sight"][m] >= 0 ? ", a lone stricter mark" : ", a lower-bar mark"}`); }
    const row = A["dot.rowOf"][i];
    return (
      <div className="mt-3 rounded border border-white/20 p-2 text-xs">
        <div className="mb-1 font-semibold">Dot {i}</div>
        <div>Tier: {i < M.strict ? TIER[0] : TIER[A["dot.tier"][i]] ?? "?"}</div>
        <div>Photographs that made it: {A["dot.photos"][i]} of {A["dot.covered"][i]} that looked{A["dot.certainEvidence"][i] ? " (certain on its own evidence)" : ""}</div>
        <div>Certainty: {["certain", "probable", "uncertain"][A["dot.certainty"][i]]}; {row >= 0 ? `on row ${M.rows[row]?.id} (${M.rows[row]?.kind})` : "on no row"}{A["dot.between"][i] ? "; between two rows" : ""}{A["dot.offSpacing"][i] ? "; placed by the spacing option" : ""}</div>
        <div className="mt-1" style={{ color: V?.col }}>{V?.words ?? name}</div>
        <div className="text-white/70">Rule: {M.source}:{M.settledLine[name] ?? "?"} ({name})</div>
        <div className="mt-1 text-white/70">Its sightings ({members.length}): {members.slice(0, 12).join("; ")}{members.length > 12 ? "; …" : ""}</div>
        <div className="text-white/50">Spread of its sightings: {fmt(A["dot.spread"][i] * 100, 1)} cm</div>
      </div>
    );
  };

  // ---- The switches.
  const setOpt = (d: OptionDef, v: unknown) => setDraft(o => { const n = { read: { ...o.read }, field: JSON.parse(JSON.stringify(o.field)) as Opts }; if (d.group === "read") n.read[d.path[0]] = v; else if (d.path.length === 2) { n.field[d.path[0]] = { ...((n.field[d.path[0]] ?? {}) as Opts), [d.path[1]]: v }; } else n.field[d.path[0]] = v; return n; });
  const valueOf = (o: { read: Opts; field: Opts }, d: OptionDef) => { const v = d.group === "read" ? o.read[d.path[0]] : getAt(o.field, d.path); return v === undefined ? d.def : v; };
  const switches = () => (
    <details className="mt-3 rounded border border-white/15 p-2 text-xs" open={!isDefault}>
      <summary className="cursor-pointer font-semibold">Switches {isDefault ? "(all as the code has them)" : "(this setup differs from the defaults)"}</summary>
      <div className="mt-2 flex flex-wrap gap-1">{PRESETS.map(p => <button key={p.name} className={`rounded px-2 py-0.5 ${same(normal(p.set), applied) ? "bg-sky-700" : "bg-white/10 hover:bg-white/20"}`} onClick={() => apply(p.set)}>{p.name}</button>)}</div>
      {(["read", "field"] as const).map(g => (
        <div key={g} className="mt-2">
          <div className="text-white/50">{g === "read" ? "Each photograph's read (re-reads the flight)" : "The field: plants first (re-runs from step 3)"}</div>
          {OPTIONS.filter(d => d.group === g).map(d => { const v = valueOf(draft, d), changed = v !== d.def; return (
            <label key={d.path.join(".")} className={`flex items-center justify-between gap-2 py-0.5 ${changed ? "text-amber-300" : ""}`} title={d.where}>
              <span>{d.label} <span className="text-white/40">(default {String(d.def)})</span></span>
              {d.values ? <select className="rounded bg-white/10 px-1" value={String(v)} onChange={e => setOpt(d, e.target.value)}>{d.values.map(x => <option key={x} value={x} className="bg-neutral-800">{x}</option>)}</select>
                : <input type="checkbox" checked={Boolean(v)} onChange={e => setOpt(d, e.target.checked)} />}
            </label>
          ); })}
        </div>
      ))}
      <div className="mt-2 flex items-center gap-2"><button className="rounded bg-sky-600 px-2 py-1 hover:bg-sky-500" onClick={() => apply(draft)}>Run this setup</button>{!same(normal(draft), applied) && <span className="text-amber-300">changed, not run yet</span>}</div>
      {!isDefault && <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={showDiff} onChange={e => setShowDiff(e.target.checked)} />Show what changed against {BN} (magenta added, red × removed)</label>}
      {!isDefault && <div className="mt-1 text-white/50">Applied: {JSON.stringify(applied)}</div>}
    </details>
  );

  // ---- The Layers panel: the new layer options against the frozen preset.
  const layersPanel = () => {
    if (!session) return null;
    const frozenNow = same(applied, normal(FROZEN)), onOf = (k: string) => (k === "coresBySize" ? applied.read.coresBySize != null : !!((applied.field.layers ?? {}) as Opts)[k]);
    const inFrozenFamily = base === "frozen";
    const tot = scoreCur && scoreDef && !isDefault ? { c: scoreTotals(scoreCur), d: scoreTotals(scoreDef) } : null;
    const flip = (k: string, v: boolean) => { const on: Record<string, boolean> = {}; for (const d of LAYER_SWITCHES) on[d.key] = inFrozenFamily ? onOf(d.key) : false; on[k] = v; applyLayers(on); };
    return (
      <details className="mt-3 rounded border border-sky-500/40 p-2 text-xs" open>
        <summary className="cursor-pointer font-semibold">Layers {inFrozenFamily ? `(against the frozen preset${frozenNow ? ": this is it" : ""})` : "(compared with the defaults until a layer is switched)"}</summary>
        <div className="mt-2"><button className={`rounded px-2 py-0.5 ${inFrozenFamily && frozenNow ? "bg-sky-700" : "bg-white/10 hover:bg-white/20"}`} onClick={() => applyLayers({})}>Frozen preset (FINAL-3)</button></div>
        <div className="mt-2 text-white/50">L1 Views, L2 Find, L3 Place and L4 Obvious are shown in the steps below but have no switch here: they run as the frozen preset sets them.</div>
        {LAYER_SWITCHES.map(d => (
          <label key={d.key} className={`flex items-center justify-between gap-2 py-0.5 ${inFrozenFamily && onOf(d.key) ? "text-amber-300" : ""}`} title={d.where}>
            <span><span className="text-white/50">{d.layer}</span> {d.label} <span className="text-white/40">(default off)</span></span>
            <input type="checkbox" checked={inFrozenFamily && onOf(d.key)} disabled={session.kind !== "flight" && d.key !== "coresBySize"} onChange={e => flip(d.key, e.target.checked)} />
          </label>
        ))}
        <div className="mt-1 text-white/50">A switch re-runs from the layer it changes: L1 re-reads the photographs; L5 to L8 re-run the field from the cached reads. Magenta: added against the frozen preset; red ×: removed. {session.kind !== "flight" ? "On a single photograph only L1 runs: the other layers need a flight." : ""}</div>
        {tot ? <div className="mt-1">Dev tiles: found {sgn(tot.c.f - tot.d.f)}, wrong {sgn(tot.c.w - tot.d.w)}, count error {sgn(tot.c.err)} (frozen preset {sgn(tot.d.err)})</div> : labelsFor ? <button className="mt-1 rounded bg-sky-600 px-2 py-0.5 hover:bg-sky-500" onClick={() => score(false)}>Score this photograph with both</button> : null}
      </details>
    );
  };

  // ---- Labels and score (step 8).
  const labelsPanel = () => {
    const spentHere = spent.filter(x => String(x.image) === photo);
    const scoreJob = (st: Setup | null, h: boolean) => (st ? session?.scores[scoreKey(st, h)] : undefined);
    return (
      <div className="mt-3 space-y-2 text-xs">
        <label className="block">Labels file from the labeler: <input type="file" accept=".json" className="mt-1 block w-full text-xs" onChange={e => e.target.files?.[0] && uploadLabels(e.target.files[0])} /></label>
        {session?.labels && <div className="text-white/60">Loaded: {session.labels.images.filter(i => i.plants + i.unsure).map(i => `${i.image} (${i.plants} plant, ${i.unsure} unsure)`).join("; ")}</div>}
        {session?.labels && !labelsFor && <div className="text-amber-300">The labels file holds nothing for this photograph.</div>}
        {labelsFor && <button className="rounded bg-sky-600 px-2 py-1 hover:bg-sky-500" onClick={() => score(false)}>Score this photograph (dev tiles){isDefault ? "" : `: this setup and ${BN}`}</button>}
        {[[BNc, defSetup], ...(isDefault ? [] : [["This setup", curSetup]])].map(([nm, st]) => { const j = scoreJob(st as Setup | null, false); return j && j.state !== "done" ? <div key={String(nm)}>{String(nm)}: {j.state}{j.error ? `: ${j.error}` : ""}</div> : null; })}
        {(scoreDef || scoreCur) && (
          <table className="w-full"><thead><tr className="text-white/50"><td>Dev tiles, matched within {scoreCur ? (scoreCur.unit === "m" ? cm(scoreCur.R) : `${fmt(scoreCur.R, 1)} px`) : ""}</td><td>Found</td><td>in 100</td><td>Wrong (second / nothing)</td><td>in 100 marks</td><td>Count error</td></tr></thead>
            <tbody>
              {scoreDef && <tr><td>{BNc}</td>{scoreRow(scoreDef).map((c, i) => <td key={i}>{c}</td>)}</tr>}
              {!isDefault && scoreCur && <tr className="text-amber-300"><td>This setup</td>{scoreRow(scoreCur).map((c, i) => <td key={i}>{c}</td>)}</tr>}
              {!isDefault && scoreCur && scoreDef && <tr className="text-white/70"><td>Change</td>{scoreDelta(scoreCur, scoreDef).map((c, i) => <td key={i}>{c}</td>)}</tr>}
              {scoreDef?.full && <tr className="text-white/60"><td>{BNc}, one full spacing</td>{scoreRow(scoreDef, false).map((c, i) => <td key={i}>{c}</td>)}</tr>}
              {!isDefault && scoreCur?.full && <tr className="text-amber-300/70"><td>This setup, one full spacing</td>{scoreRow(scoreCur, false).map((c, i) => <td key={i}>{c}</td>)}</tr>}
            </tbody></table>
        )}
        {shownScore && <div className="text-white/60">Drawn: {shownScore.hidden ? "the HELD-BACK tiles" : "the dev tiles"} of {isDefault ? BN : "this setup"}. Green dot: a labelled plant found (white ring: its mark). Red square: a labelled plant missed. Orange ×: a second mark on a plant. Red ×: a mark on nothing. Grey ring: a mark at a tile's edge, not judged. Violet: unsure. The held-back tiles are greyed out.</div>}
        {shownScore && <table className="w-full"><thead><tr className="text-white/50"><td>Tile</td><td>Labelled</td><td>Found</td><td>Wrong</td><td>Count error</td></tr></thead><tbody>{shownScore.half.map(t => <tr key={t.tile}><td>{t.tile}</td><td>{t.labelled}</td><td>{sum(t.found)}</td><td>{sum(t.wrong)}</td><td>{sgn(sum(t.marks) - sum(t.onUnsure) - t.labelled)}</td></tr>)}</tbody></table>}
        {labelsFor && (
          <div className="rounded border border-amber-500/40 p-2">
            <label className="flex items-center gap-2"><input type="checkbox" checked={hiddenTick} onChange={e => setHiddenTick(e.target.checked)} />Show hidden half</label>
            {hiddenTick && !scoreHidden && (
              <div className="mt-1 space-y-1 text-amber-300">
                <div>Scoring the held-back tiles SPENDS the hidden-half check for this photograph: once their score is seen, a later change can no longer be judged on them fairly. It is recorded in data/corn-inspector/hidden-spent.json.</div>
                <div>{spentHere.length ? `Already spent for this photograph: ${spentHere.map(x => `${String(x.when).slice(0, 10)}: ${String(x.what)}`).join("; ")}.` : "Not spent before for this photograph."}</div>
                <button className="rounded bg-amber-600 px-2 py-1 text-black hover:bg-amber-500" onClick={() => score(true)}>Spend it: score the held-back tiles with {isDefault ? "the defaults" : "this setup"}</button>
              </div>
            )}
            {hiddenTick && scoreHidden && <table className="mt-1 w-full"><tbody><tr className="text-amber-300"><td>HIDDEN HALF, {isDefault ? "defaults" : "this setup"}</td>{scoreRow(scoreHidden).map((c, i) => <td key={i}>{c}</td>)}</tr></tbody></table>}
            {hiddenTick && scoreJob(curSetup, true) && scoreJob(curSetup, true)!.state !== "done" && <div>{scoreJob(curSetup, true)!.state}{scoreJob(curSetup, true)!.error ? `: ${scoreJob(curSetup, true)!.error}` : ""}</div>}
          </div>
        )}
      </div>
    );
  };

  const jobLine = (label: string, j?: Job) => j ? <div>{label}: {j.state}{j.done != null && j.total ? ` (${j.done}/${j.total})` : ""}{j.error ? `: ${j.error}` : ""}{j.started ? ` (${fmt(((j.ended ?? Date.now()) - j.started) / 1000)} s)` : ""}</div> : null;
  const blocks = step === 7 && !flight ? scoutNumbers() : numbers();
  const legend: Record<number, [string, string][]> = {
    1: comparing ? [[ADDED, "a mark this setup adds"], [REMOVED, "a mark of the defaults it removes"]] : [["#40d8ff", "found by the green alone"], ["#3cff5a", "found by the green, a core on it"], ["#ff9a00", "added by a core"]],
    2: [["#40d8ff", "this photo's mark, a line to its dot"], ["#ff3c3c", "this photo's mark in no dot"], ["#ff9a00", "this photo's second-look sighting"], ["#ffffff", "dot of the stricter marks (ring)"], ["#ffe628", "candidate dot (ring)"], ...(comparing ? [[ADDED, "dot only in this setup"], [REMOVED, "dot only in the defaults"]] as [string, string][] : [])],
    3: comparing ? [[ADDED, "certain only in this setup"], [REMOVED, "certain only in the defaults"]] : [["#3cff5a", "certain dot"], ["#c8c8c8", "other dots"]],
    4: [["#40d8ff", "row from the certain plants"], ["#ff60ff", "row found in a free slot"], ["#3cff5a", "ground planted"], ["#ff3c3c", "ground scattered"], ["#969696", "ground not judged"], ...(comparing ? [["#ffffff", "the defaults' rows (dashed)"]] as [string, string][] : [])],
    6: [...(fieldCur?.meta.secondLook ? [["#3cff5a", "spot the second look added (ring)"], ["#ff3030", "spot it refused (ring)"]] as [string, string][] : []), ...(comparing ? [[ADDED, `on a row only in this setup`], [REMOVED, `on a row only in ${BN}`]] as [string, string][] : Object.entries(VERDICT).filter(([k]) => k !== "none").map(([k, v]) => [v.col, k] as [string, string]))],
    5: comparing ? [[ADDED, "on a row only in this setup"], [REMOVED, "on a row only in the defaults"]] : Object.entries(VERDICT).filter(([k]) => k !== "none").map(([k, v]) => [v.col, k]),
    7: flight ? (comparing ? [[ADDED, "a plant only in this setup"], [REMOVED, "a plant only in the defaults"]] : [...SHOWN.map(s => [s.col, s.name] as [string, string]), ["#ff3c3c", "weed candidate (ring)"], ["#ff9a00", "stand gap"]]) : [["#40d8ff", "corn row"], ["#ffe628", "row, crop not confirmed"], ["#ff3c3c", "weed candidate"], ["#ff9a00", "stand gap"]],
  };

  return (
    <div className="flex h-screen bg-[#141414] text-white">
      <aside className="w-[400px] shrink-0 overflow-y-auto border-r border-white/10 p-3 text-sm">
        <div className="mb-2 text-base font-semibold">Corn inspector <span className="text-xs font-normal text-white/50">(dev only)</span></div>
        <label className="block text-xs text-white/60">A flight's folder, or one photograph</label>
        <input className="mb-1 w-full rounded bg-white/10 px-2 py-1" value={path} onChange={e => setPath(e.target.value)} placeholder="C:\\…\\photos or C:\\…\\photo.JPG" />
        <label className="block text-xs text-white/60">Analysis record (optional: found or built when empty)</label>
        <input className="mb-2 w-full rounded bg-white/10 px-2 py-1" value={analysisPath} onChange={e => setAnalysisPath(e.target.value)} list="corn-inspector-known" placeholder="…\\analysis.json" />
        <datalist id="corn-inspector-known">{known.map(k => <option key={k.path} value={k.path}>{k.photographs} photographs</option>)}</datalist>
        <button className="rounded bg-sky-600 px-3 py-1 font-medium hover:bg-sky-500" onClick={open}>Open</button>
        {error && <div className="mt-2 text-red-400">{error}</div>}
        {session && (
          <div className="mt-3 space-y-1 text-xs text-white/70">
            <div>{session.kind === "flight" ? `Flight: ${session.photos.length} photographs` : "One photograph, no flight"}</div>
            {session.kind === "flight" && <div>Cameras: {session.analysis ? `${session.analysis} (${session.analysisSource})` : "none yet"}</div>}
            {jobLine("Build", session.build)}{curSetup && jobLine("Reads", session.reads[curSetup.readKey])}{curSetup && jobLine("Field", curSetup.fieldJob)}{photo && jobLine("This photograph", photoJob)}
            {M && <div>Field: {M.photographsRead} of {M.photographs} photographs read; the record's field settings {M.fieldOptionsOfTheRecordEqualFIELD ? "equal" : "differ from"} the build's (FIELD); the build's are used.</div>}
          </div>
        )}
        {session && (
          <>
            <div className="mt-3 text-xs text-white/60">Photograph</div>
            <select className="w-full rounded bg-white/10 px-2 py-1" value={photo ?? ""} onChange={e => { setPhoto(e.target.value); setPicked(null); setHiddenTick(false); }}>{session.photos.map(p => <option key={p.name} value={p.name} className="bg-neutral-800">{p.name}</option>)}</select>
            {layersPanel()}
            {switches()}
            <ol className="mt-3 space-y-1">
              {STEPS.map((sname, k) => {
                const off = FLIGHT_ONLY.has(k) && !flight;
                return <li key={sname}><button className={`w-full rounded px-2 py-1 text-left ${step === k ? "bg-sky-700" : "bg-white/5 hover:bg-white/10"} ${off ? "text-white/35" : ""}`} onClick={() => { setStep(k); setPicked(null); }}>{k + 1}. {sname}{off ? " (needs a flight)" : ""}</button></li>;
              })}
            </ol>
            {step === 0 && <div className="mt-2 flex gap-2 text-xs">{(["photo", "green", "cores"] as const).map(v => <button key={v} className={`rounded px-2 py-1 ${view === v ? "bg-sky-700" : "bg-white/10"}`} onClick={() => setView(v)}>{v === "photo" ? "Photo" : v === "green" ? "Green view" : "Cores view"}</button>)}</div>}
            {dotPanel()}
            {step === 8 && labelsPanel()}
            <div className="mt-3 space-y-3">
              {blocks.map(b => (
                <div key={b.title}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-white/60">{b.title}</div>
                  <table className="w-full text-xs"><tbody>{b.rows.map(([k, v]) => <tr key={k} className="align-top"><td className="py-0.5 pr-2 text-white/60">{k}</td><td className="py-0.5">{v}</td></tr>)}</tbody></table>
                </div>
              ))}
            </div>
            {legend[step] && <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">{legend[step].map(([c, t]) => <span key={t} className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />{t}</span>)}</div>}
            {info?.notes?.length ? <details className="mt-3 text-xs text-white/60"><summary>The read's notes</summary>{info.notes.map(n => <p key={n} className="mt-1">{n}</p>)}</details> : null}
          </>
        )}
      </aside>
      <main className="relative flex-1">
        <canvas ref={canvas} className="h-full w-full cursor-crosshair" onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => (drag.current = null)} />
        {!images.photo && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white/40">{session ? "Loading the photograph…" : "Open a flight's folder or a photograph."}</div>}
        <div className="pointer-events-none absolute bottom-2 right-3 text-xs text-white/40">wheel: zoom · drag: pan{step >= 2 && step <= 6 ? " · click: a dot" : ""}</div>
      </main>
    </div>
  );
}
