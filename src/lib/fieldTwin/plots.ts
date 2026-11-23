// Plots (2026-11-23): a region of a corn field the operator draws, with the numbers for just that region. For research
// trials, and for a farmer's "the wet corner".
//
// A plot belongs to the ground, not to the flight: it is kept as a ring of latitude / longitude points (a rectangle or a
// snapped plot also keeps the box it was drawn as, in a frame given in real coordinates, so its handles still work when
// it is edited). Today plots are saved with the twin on this device (plotStore.ts); fields, and matching a later flight
// of the same field to them, come when a field is flown again.
//
// Nothing here changes what the twin found. The numbers read the twin as it is:
//   plants          the plants the field count counts (cornRender.ts cornPlantCount) whose centre is inside;
//   plants per acre plants ÷ (row length inside with plants seen along it × the field's row spacing), the field panel's
//                   rule, so a plot drawn round the whole field gives the panel's number;
//   rows read       of the row drawn inside, the share with plants seen along it (the rest is where a row continues but
//                   no plant was confirmed: the photographs missed the plants, or there are none);
//   plant spacing   along each row, between neighbouring counted plants that are both inside, within a stretch of row
//                   with plants seen (never across a stretch where no plant was confirmed): mean, spread, coefficient of
//                   variation, and the spacings over 1.5 times the plot's median (missed plants or skips: the
//                   photographs cannot tell which);
//   plant span      the median length of the counted plants' leaf line, tip to tip, from the plants whose look the
//                   photographs agreed on (cornPlantLook.ts): a whole plant's span, not one leaf;
//   weeds           the green that is not corn inside (not counted, unconfirmed as weeds) and the weed candidates;
//   gaps            only on a flight whose gaps were measured;
//   small plot      under 100 counted plants or 50 ft of row with plants seen: the number moves by about 1 / √plants.
import { M2_PER_ACRE, M_PER_FT, M_PER_MILE } from "../units";
import { cornPlantCount, isOnRow, plantsSorted } from "./cornRender";
import { unpackLooks } from "./cornPlantLook";
import { cornFieldRows, fieldRowOf } from "./cornView";
import { localFrame } from "./rowEdits";
import type { LatLngPair, TwinBundle, TwinCornWeed } from "./types";

/** A rectangle along the rows, in a frame given in real coordinates: origin (lat, lng) and the along direction as a math
 * angle (degrees from east towards north). a: metres along, c: metres across (left of along). */
export type PlotBox = { lat: number; lng: number; dirDeg: number; a0: number; a1: number; c0: number; c1: number };
export type PlotShape = { tool: "polygon" } | { tool: "rectangle"; box: PlotBox } | { tool: "rows"; box: PlotBox; rows: number };
export type Plot = { uid: string; number: number; name: string; colour: string; ring: LatLngPair[]; shape: PlotShape; at: string; updatedAt: string };

export const PLOT_COLOURS = ["#f5d547", "#4fc3f7", "#f06292", "#81c784", "#ffb74d", "#ba68c8"];
export const PLOT = {
  /** A plot with fewer counted plants than this, or less row with plants seen than `smallRowM`, gets the small-plot note. */
  smallPlants: 100, smallRowM: 50 * M_PER_FT,
  /** A spacing over this many times the plot's median is listed apart: a missed plant, or a skip. */
  longSpacing: 1.5,
  /** A plant is on a stretch when within this share of the row spacing across from it. */
  assignAcross: 0.5,
  cellM: 2,
};

type Grid = { x0: number; y0: number; nx: number; ny: number; start: Int32Array; items: Int32Array };
function gridOf(xs: Float64Array, ys: Float64Array, cell: number): Grid {
  const n = xs.length;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { if (xs[i] < x0) x0 = xs[i]; if (xs[i] > x1) x1 = xs[i]; if (ys[i] < y0) y0 = ys[i]; if (ys[i] > y1) y1 = ys[i]; }
  if (!n) { x0 = y0 = 0; x1 = y1 = 0; }
  const nx = Math.max(1, Math.floor((x1 - x0) / cell) + 1), ny = Math.max(1, Math.floor((y1 - y0) / cell) + 1);
  const count = new Int32Array(nx * ny + 1), key = new Int32Array(n);
  for (let i = 0; i < n; i++) { key[i] = Math.floor((ys[i] - y0) / cell) * nx + Math.floor((xs[i] - x0) / cell); count[key[i] + 1]++; }
  for (let k = 1; k <= nx * ny; k++) count[k] += count[k - 1];
  const start = count.slice(), fill = count.slice(0, nx * ny), items = new Int32Array(n);
  for (let i = 0; i < n; i++) items[fill[key[i]]++] = i;
  return { x0, y0, nx, ny, start, items };
}
function inBox(g: Grid, cell: number, bx0: number, by0: number, bx1: number, by1: number, fn: (i: number) => void) {
  const i0 = Math.max(0, Math.floor((bx0 - g.x0) / cell)), i1 = Math.min(g.nx - 1, Math.floor((bx1 - g.x0) / cell));
  const j0 = Math.max(0, Math.floor((by0 - g.y0) / cell)), j1 = Math.min(g.ny - 1, Math.floor((by1 - g.y0) / cell));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * g.nx + i; for (let q = g.start[k]; q < g.start[k + 1]; q++) fn(g.items[q]); }
}

/** A stretch of row (a stored `TwinCornRow`) in metres east / north of the twin's origin. */
type Stretch = { pts: Float64Array; seen: boolean; scale: number; row: number; bbox: [number, number, number, number]; plants: Int32Array };

export type PlotContext = {
  twinId: string;
  frame: ReturnType<typeof localFrame>;
  /** Unit vector along the rows, east / north; its math angle in degrees. */
  d: [number, number]; dirDeg: number;
  spacingM: number;
  origin: { lat: number; lng: number };
  toAC: (e: number, n: number) => [number, number];
  fromAC: (a: number, c: number) => [number, number];
  /** Counted plants: east, north, along, the stretch each stands on (-1 none), its span in metres (NaN: not measured). */
  pE: Float64Array; pN: Float64Array; pA: Float64Array; pStretch: Int32Array; pSpan: Float32Array; pIndex: Int32Array; pGrid: Grid;
  /** Green that is not corn (a sorted twin's plants off the rows). */
  gE: Float64Array; gN: Float64Array; gGrid: Grid;
  weeds: { e: number; n: number; status: TwinCornWeed["status"]; id: number }[];
  stretches: Stretch[];
  /** Per field row: its course as along / across vertices, sorted along (for snapping). */
  courses: { row: number; a: Float64Array; c: Float64Array; a0: number; a1: number }[];
  gaps: { measured: true; list: { e0: number; n0: number; e1: number; n1: number; lengthM: number; status: "confirmed" | "withheld" }[] } | { measured: false; why: string };
  /** The single photographs' read share the build reported (0..1), when it left gaps out for it. */
  readShare: number | null;
  sorted: boolean;
};

/** What the build said when it left the gaps out (cornField.ts), as a share. */
export function readShareOf(notes: string[]): number | null {
  for (const n of notes) { const m = /photographs hold (\d+) % of the row length/.exec(n); if (m) return Number(m[1]) / 100; }
  return null;
}

/** The plot context of a corn twin with plants and rows, or null. Built once per twin (a few tens of milliseconds). */
export function plotContext(twin: TwinBundle, plantsOverride: { points: LatLngPair[]; certainty?: number[] | null } | null = null): PlotContext | null {
  const K = twin.corn;
  if (!K || !K.rows.length) return null;
  const points = plantsOverride?.points ?? K.plants?.points;
  if (!points?.length) return null;
  const certainty = plantsOverride ? plantsOverride.certainty ?? null : K.plants?.certainty ?? null;
  const sorted = plantsSorted(K.plants);
  const frame = localFrame(twin.origin.lat, twin.origin.lng);
  // The row direction: the length-weighted mean of the rows' own segments (doubled angles), as the row editor's.
  const lines = K.rows.map(r => r.line.map(([la, ln]) => frame.toEN(la, ln)));
  let sx = 0, sy = 0;
  for (const l of lines) for (let i = 1; i < l.length; i++) { const de = l[i][0] - l[i - 1][0], dn = l[i][1] - l[i - 1][1], len = Math.hypot(de, dn); if (len <= 0) continue; const th = 2 * Math.atan2(dn, de); sx += len * Math.cos(th); sy += len * Math.sin(th); }
  const th = sx || sy ? Math.atan2(sy, sx) / 2 : ((K.rowDirectionDeg ?? 0) * Math.PI) / 180;
  const d: [number, number] = [Math.cos(th), Math.sin(th)];
  const toAC = (e: number, n: number): [number, number] => [e * d[0] + n * d[1], -e * d[1] + n * d[0]];
  const fromAC = (a: number, c: number): [number, number] => [a * d[0] - c * d[1], a * d[1] + c * d[0]];
  const spacingM = K.rowSpacingM ?? twin.field.rowSpacingM ?? 0.76;

  // The stretches, each with the scale that makes its drawn line's length its stored length (a whole-field plot then
  // sums exactly the panel's row length).
  const stretches: Stretch[] = K.rows.map((r, k) => {
    const en = lines[k], pts = new Float64Array(en.length * 2);
    let L = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    en.forEach(([e, n], i) => { pts[2 * i] = e; pts[2 * i + 1] = n; if (i) L += Math.hypot(e - en[i - 1][0], n - en[i - 1][1]); x0 = Math.min(x0, e); x1 = Math.max(x1, e); y0 = Math.min(y0, n); y1 = Math.max(y1, n); });
    return { pts, seen: r.status === "corn", scale: L > 0 ? r.lengthM / L : 1, row: fieldRowOf(K, r) ?? -r.id, bbox: [x0, y0, x1, y1], plants: new Int32Array(0) };
  });

  // Counted plants (the field count's rule) and the green that is not corn.
  const counted: number[] = [], green: number[] = [];
  const n = points.length, classes = certainty && certainty.length === n ? certainty : null;
  for (let i = 0; i < n; i++) {
    const c = classes ? classes[i] : 0;
    if (!sorted || !classes || isOnRow(c)) counted.push(i);
    else if (c !== 7) green.push(i);
  }
  const m = counted.length, pE = new Float64Array(m), pN = new Float64Array(m), pA = new Float64Array(m), pIndex = Int32Array.from(counted);
  counted.forEach((i, k) => { const [e, no] = frame.toEN(points[i][0], points[i][1]); pE[k] = e; pN[k] = no; pA[k] = toAC(e, no)[0]; });
  const gE = new Float64Array(green.length), gN = new Float64Array(green.length);
  green.forEach((i, k) => { const [e, no] = frame.toEN(points[i][0], points[i][1]); gE[k] = e; gN[k] = no; });
  const looks = unpackLooks(K.plants?.look ?? null, n), pSpan = new Float32Array(m).fill(NaN);
  if (looks && !plantsOverride) counted.forEach((i, k) => { if (looks.size[i]) pSpan[k] = looks.size[i] / 200; });

  // Each counted plant to the nearest stretch with plants seen, within half a row spacing across.
  const segE0: number[] = [], segN0: number[] = [], segE1: number[] = [], segN1: number[] = [], segOf: number[] = [];
  // Segments cut into pieces of at most a metre, so a lookup only reaches a metre or so.
  stretches.forEach((s, k) => {
    if (!s.seen) return;
    for (let i = 1; i < s.pts.length / 2; i++) {
      const ax = s.pts[2 * i - 2], ay = s.pts[2 * i - 1], bx = s.pts[2 * i], by = s.pts[2 * i + 1], parts = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
      for (let p = 0; p < parts; p++) { const t0 = p / parts, t1 = (p + 1) / parts; segE0.push(ax + t0 * (bx - ax)); segN0.push(ay + t0 * (by - ay)); segE1.push(ax + t1 * (bx - ax)); segN1.push(ay + t1 * (by - ay)); segOf.push(k); }
    }
  });
  const cell = PLOT.cellM, mids = { x: new Float64Array(segOf.length), y: new Float64Array(segOf.length) };
  segOf.forEach((_, j) => { mids.x[j] = (segE0[j] + segE1[j]) / 2; mids.y[j] = (segN0[j] + segN1[j]) / 2; });
  const reach = 0.5;
  const sGrid = gridOf(mids.x, mids.y, cell), pStretch = new Int32Array(m).fill(-1), maxD = PLOT.assignAcross * spacingM;
  for (let k = 0; k < m; k++) {
    let best = maxD, at = -1;
    inBox(sGrid, cell, pE[k] - reach - maxD, pN[k] - reach - maxD, pE[k] + reach + maxD, pN[k] + reach + maxD, j => {
      const dx = segE1[j] - segE0[j], dy = segN1[j] - segN0[j], L2 = dx * dx + dy * dy || 1e-12, t = Math.max(0, Math.min(1, ((pE[k] - segE0[j]) * dx + (pN[k] - segN0[j]) * dy) / L2));
      const dd = Math.hypot(segE0[j] + t * dx - pE[k], segN0[j] + t * dy - pN[k]);
      if (dd < best) { best = dd; at = segOf[j]; }
    });
    pStretch[k] = at;
  }
  const per = stretches.map(() => [] as number[]);
  for (let k = 0; k < m; k++) if (pStretch[k] >= 0) per[pStretch[k]].push(k);
  per.forEach((list, s) => { list.sort((x, y) => pA[x] - pA[y]); stretches[s].plants = Int32Array.from(list); });

  // Each field row's course in the along / across frame (all its stretches).
  const byRow = new Map<number, [number, number][]>();
  stretches.forEach(s => { const v = byRow.get(s.row) ?? byRow.set(s.row, []).get(s.row)!; for (let i = 0; i < s.pts.length / 2; i++) v.push(toAC(s.pts[2 * i], s.pts[2 * i + 1])); });
  const courses = [...byRow].map(([row, v]) => { v.sort((x, y) => x[0] - y[0]); return { row, a: Float64Array.from(v.map(p => p[0])), c: Float64Array.from(v.map(p => p[1])), a0: v[0][0], a1: v[v.length - 1][0] }; });

  const readShare = readShareOf(K.notes);
  const plantsFirst = cornFieldRows(K).some(r => r.plantsFirst);
  const gaps: PlotContext["gaps"] = readShare != null
    ? { measured: false, why: `Single photographs held only ${Math.round(100 * readShare)} % of the row length, so a stretch with no plant seen can't be told from plants the photographs missed.` }
    : plantsFirst && !K.gaps.length
      ? { measured: false, why: "Gaps aren't measured yet on rows built from the located plants." }
      : { measured: true, list: K.gaps.map(g => { const [e0, n0] = frame.toEN(g.a[0], g.a[1]), [e1, n1] = frame.toEN(g.b[0], g.b[1]); return { e0, n0, e1, n1, lengthM: g.lengthM, status: g.status }; }) };

  return {
    twinId: twin.id, frame, d, dirDeg: (th * 180) / Math.PI, spacingM, origin: { ...twin.origin }, toAC, fromAC,
    pE, pN, pA, pStretch, pSpan, pIndex, pGrid: gridOf(pE, pN, cell),
    gE, gN, gGrid: gridOf(gE, gN, cell),
    weeds: K.weeds.map(w => { const [e, no] = frame.toEN(w.lat, w.lng); return { e, n: no, status: w.status, id: w.id }; }),
    stretches, courses, gaps, readShare, sorted,
  };
}

// --- geometry in metres east / north -------------------------------------------------------------------------------

type Ring = { x: Float64Array; y: Float64Array; bbox: [number, number, number, number] };
function ringOf(ctx: PlotContext, ring: LatLngPair[]): Ring {
  const k = ring.length, x = new Float64Array(k), y = new Float64Array(k);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  ring.forEach(([la, ln], i) => { const [e, n] = ctx.frame.toEN(la, ln); x[i] = e; y[i] = n; x0 = Math.min(x0, e); x1 = Math.max(x1, e); y0 = Math.min(y0, n); y1 = Math.max(y1, n); });
  return { x, y, bbox: [x0, y0, x1, y1] };
}
function inside(R: Ring, px: number, py: number): boolean {
  const { x, y } = R, k = x.length;
  let c = false;
  for (let i = 0, j = k - 1; i < k; j = i++) if ((y[i] > py) !== (y[j] > py) && px < ((x[j] - x[i]) * (py - y[i])) / (y[j] - y[i]) + x[i]) c = !c;
  return c;
}
export function ringAreaM2(xs: ArrayLike<number>, ys: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) s += (xs[j] + xs[i]) * (ys[j] - ys[i]);
  return Math.abs(s) / 2;
}
/** Length of a polyline (x, y interleaved) inside the ring. */
function lengthInside(R: Ring, pts: Float64Array): number {
  const { x, y } = R, k = x.length;
  let L = 0;
  for (let i = 1; i < pts.length / 2; i++) {
    const ax = pts[2 * i - 2], ay = pts[2 * i - 1], bx = pts[2 * i], by = pts[2 * i + 1], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    if (len <= 0) continue;
    const ts = [0, 1];
    for (let p = 0, q = k - 1; p < k; q = p++) {
      const ex = x[p] - x[q], ey = y[p] - y[q], den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-15) continue;
      const t = ((x[q] - ax) * ey - (y[q] - ay) * ex) / den, u = ((x[q] - ax) * dy - (y[q] - ay) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
    ts.sort((p, q) => p - q);
    for (let s = 1; s < ts.length; s++) { const tm = (ts[s - 1] + ts[s]) / 2; if (ts[s] > ts[s - 1] && inside(R, ax + tm * dx, ay + tm * dy)) L += (ts[s] - ts[s - 1]) * len; }
  }
  return L;
}

// --- the numbers ---------------------------------------------------------------------------------------------------

export type SpacingStats = { n: number; meanM: number; sdM: number; cv: number; medianM: number; long: number };
export type PlotRowStats = SpacingStats & { row: number; plants: number; /** Its place across the plot: 1 the row furthest to the right of the rows' direction. */ order: number };
export type PlotNumbers = {
  areaM2: number;
  plants: number;
  /** Row inside with plants seen along it, and where a row continues with no plant confirmed, metres. */
  seenM: number; notSeenM: number;
  /** seenM over all the row drawn inside (null: no row inside). */
  readShare: number | null;
  perAcre: number | null;
  spacing: SpacingStats | null;
  rows: PlotRowStats[];
  span: { medianM: number; n: number } | null;
  greenNotCorn: number;
  weeds: { confirmed: number; unconfirmed: number; contested: number };
  gaps: { measured: false; why: string } | { measured: true; confirmed: number; withheld: number; lengthM: number };
  /** Set when the plot is too small for a stable number: the share it could move by (1 / √plants). */
  small: { margin: number; why: "plants" | "row" } | null;
};

function statsOf(v: number[], longAt?: number): SpacingStats | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b), n = s.length, mean = s.reduce((t, x) => t + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(s.reduce((t, x) => t + (x - mean) ** 2, 0) / (n - 1)) : 0;
  const median = n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2, cut = PLOT.longSpacing * (longAt ?? median);
  return { n, meanM: mean, sdM: sd, cv: mean > 0 ? sd / mean : 0, medianM: median, long: s.filter(x => x > cut).length };
}

/** The numbers for one plot (see the header). Fast enough to run on every pointer move while drawing. */
export function measurePlot(ctx: PlotContext, ring: LatLngPair[]): PlotNumbers {
  const R = ringOf(ctx, ring), [bx0, by0, bx1, by1] = R.bbox, cell = PLOT.cellM;
  const areaM2 = ring.length >= 3 ? ringAreaM2(R.x, R.y) : 0;
  const inPlot = new Uint8Array(ctx.pE.length);
  let plants = 0;
  const spans: number[] = [];
  if (ring.length >= 3) inBox(ctx.pGrid, cell, bx0, by0, bx1, by1, k => { if (inside(R, ctx.pE[k], ctx.pN[k])) { inPlot[k] = 1; plants++; if (!Number.isNaN(ctx.pSpan[k])) spans.push(ctx.pSpan[k]); } });
  let greenNotCorn = 0;
  if (ring.length >= 3) inBox(ctx.gGrid, cell, bx0, by0, bx1, by1, k => { if (inside(R, ctx.gE[k], ctx.gN[k])) greenNotCorn++; });
  const weeds = { confirmed: 0, unconfirmed: 0, contested: 0 };
  if (ring.length >= 3) for (const w of ctx.weeds) if (w.e >= bx0 && w.e <= bx1 && w.n >= by0 && w.n <= by1 && inside(R, w.e, w.n)) weeds[w.status]++;
  let seenM = 0, notSeenM = 0;
  const byRow = new Map<number, { spacings: number[]; plants: number; c: number }>(), all: number[] = [];
  if (ring.length >= 3) for (const s of ctx.stretches) {
    if (s.bbox[2] < bx0 || s.bbox[0] > bx1 || s.bbox[3] < by0 || s.bbox[1] > by1) continue;
    const L = lengthInside(R, s.pts) * s.scale;
    if (s.seen) seenM += L; else notSeenM += L;
    if (!s.seen || !s.plants.length) continue;
    const r = byRow.get(s.row) ?? byRow.set(s.row, { spacings: [], plants: 0, c: 0 }).get(s.row)!;
    let prev = -1;
    for (const k of s.plants) {
      if (!inPlot[k]) { prev = -1; continue; }
      r.plants++; r.c += -ctx.pE[k] * ctx.d[1] + ctx.pN[k] * ctx.d[0];
      if (prev >= 0) { const g = Math.abs(ctx.pA[k] - ctx.pA[prev]); r.spacings.push(g); all.push(g); }
      prev = k;
    }
  }
  const spacing = statsOf(all);
  const rows = [...byRow].filter(([, v]) => v.spacings.length).sort((a, b) => a[1].c / a[1].plants - b[1].c / b[1].plants).map(([row, v], i) => ({ row, plants: v.plants, order: i + 1, ...statsOf(v.spacings, spacing?.medianM)! }));
  const span = spans.length ? { medianM: statsOf(spans)!.medianM, n: spans.length } : null;
  let gaps: PlotNumbers["gaps"];
  if (ctx.gaps.measured === false) gaps = { measured: false, why: ctx.gaps.why };
  else {
    let confirmed = 0, withheld = 0, lengthM = 0;
    for (const g of ctx.gaps.list) {
      const L = lengthInside(R, Float64Array.from([g.e0, g.n0, g.e1, g.n1]));
      if (L <= 0) continue;
      if (g.status === "confirmed") { confirmed++; lengthM += L; } else withheld++;
    }
    gaps = { measured: true, confirmed, withheld, lengthM };
  }
  const perAcre = seenM > 0 ? (plants / (seenM * ctx.spacingM)) * M2_PER_ACRE : null;
  const small = plants < PLOT.smallPlants ? { margin: 1 / Math.sqrt(Math.max(1, plants)), why: "plants" as const } : seenM < PLOT.smallRowM ? { margin: 1 / Math.sqrt(Math.max(1, plants)), why: "row" as const } : null;
  return { areaM2, plants, seenM, notSeenM, readShare: seenM + notSeenM > 0 ? seenM / (seenM + notSeenM) : null, perAcre, spacing, rows, span, greenNotCorn, weeds, gaps, small };
}

/**
 * The field's own stand, the corn panel's rule, from the field count and the stored row lengths (not through the plot
 * code: a plot round the whole field must come to the same, and the tests hold them to it).
 */
export function fieldStand(twin: TwinBundle): { plants: number; seenM: number; notSeenM: number; spacingM: number; perAcre: number | null; readShare: number | null; lowerPerAcre: number | null } | null {
  const K = twin.corn, count = cornPlantCount(K);
  if (!K || !count || K.rowSpacingM == null) return null;
  const rows = cornFieldRows(K), seenM = rows.reduce((t, r) => t + r.confirmedM, 0), notSeenM = rows.reduce((t, r) => t + r.notConfirmedM, 0);
  const perAcre = seenM > 0 ? (count.total / (seenM * K.rowSpacingM)) * M2_PER_ACRE : null;
  // If every stretch with no plant confirmed were a real gap, the same plants over all the row drawn.
  const lowerPerAcre = seenM + notSeenM > 0 ? (count.total / ((seenM + notSeenM) * K.rowSpacingM)) * M2_PER_ACRE : null;
  return { plants: count.total, seenM, notSeenM, spacingM: K.rowSpacingM, perAcre, readShare: seenM + notSeenM > 0 ? seenM / (seenM + notSeenM) : null, lowerPerAcre };
}

// --- shapes --------------------------------------------------------------------------------------------------------

/** The four corners of a box, latitude / longitude. */
export function boxRing(b: PlotBox): LatLngPair[] {
  const f = localFrame(b.lat, b.lng), th = (b.dirDeg * Math.PI) / 180, d = [Math.cos(th), Math.sin(th)];
  const at = (a: number, c: number) => f.toLL(a * d[0] - c * d[1], a * d[1] + c * d[0]);
  const a0 = Math.min(b.a0, b.a1), a1 = Math.max(b.a0, b.a1), c0 = Math.min(b.c0, b.c1), c1 = Math.max(b.c0, b.c1);
  return [at(a0, c0), at(a1, c0), at(a1, c1), at(a0, c1)];
}
/** A box in the twin's frame (its origin and row direction) from along / across values. */
export function boxIn(ctx: PlotContext, a0: number, a1: number, c0: number, c1: number): PlotBox {
  return { lat: ctx.origin.lat, lng: ctx.origin.lng, dirDeg: ctx.dirDeg, a0: Math.min(a0, a1), a1: Math.max(a0, a1), c0: Math.min(c0, c1), c1: Math.max(c0, c1) };
}
/** A latitude / longitude in the twin's along / across frame. */
export function acOf(ctx: PlotContext, lat: number, lng: number): [number, number] { const [e, n] = ctx.frame.toEN(lat, lng); return ctx.toAC(e, n); }
export function llOf(ctx: PlotContext, a: number, c: number): LatLngPair { const [e, n] = ctx.fromAC(a, c); return ctx.frame.toLL(e, n); }

function courseC(co: PlotContext["courses"][number], a: number): number {
  const A = co.a, C = co.c, n = A.length;
  if (a <= A[0]) return C[0];
  if (a >= A[n - 1]) return C[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (A[m] <= a) lo = m; else hi = m; }
  return C[lo] + ((a - A[lo]) / (A[hi] - A[lo] || 1)) * (C[hi] - C[lo]);
}
/** The rows that reach this far along (a row spacing past their ends counts), their across positions, sorted. */
export function rowsAt(ctx: PlotContext, a: number): { row: number; c: number }[] {
  const s = ctx.spacingM;
  return ctx.courses.filter(co => a >= co.a0 - s && a <= co.a1 + s).map(co => ({ row: co.row, c: courseC(co, a) })).sort((x, y) => x.c - y.c);
}

/**
 * Snap to rows: pressed at along `a0` and across `cStart`, dragged to (a1, c1). The rows from the one nearest the press
 * to the one nearest the pointer; the long sides halfway to the next row out (half a spacing where there is none).
 * Null when no row reaches the press.
 */
export function snapRows(ctx: PlotContext, a0: number, cStart: number, a1: number, c1: number): { box: PlotBox; rows: number; rowIds: number[] } | null {
  const here = rowsAt(ctx, a0);
  if (!here.length) return null;
  const near = (c: number) => here.reduce((b, x, i) => (Math.abs(x.c - c) < Math.abs(here[b].c - c) ? i : b), 0);
  const i0 = near(cStart), i1 = near(c1), lo = Math.min(i0, i1), hi = Math.max(i0, i1), s = ctx.spacingM;
  const below = lo > 0 ? (here[lo - 1].c + here[lo].c) / 2 : here[lo].c - s / 2;
  const above = hi < here.length - 1 ? (here[hi].c + here[hi + 1].c) / 2 : here[hi].c + s / 2;
  return { box: boxIn(ctx, a0, a1, below, above), rows: hi - lo + 1, rowIds: here.slice(lo, hi + 1).map(x => x.row) };
}

// --- words (US units, as the corn panel) ---------------------------------------------------------------------------

export const ftOf = (m: number) => m / M_PER_FT;
export function fmtFt(m: number): string {
  if (m >= 0.5 * M_PER_MILE) return `${(m / M_PER_MILE).toFixed(2)} mi`;
  const ft = m / M_PER_FT;
  return ft >= 100 ? `${Math.round(ft).toLocaleString("en-US")} ft` : `${ft.toFixed(ft >= 10 ? 0 : 1)} ft`;
}
export const fmtIn = (m: number, digits = 1) => `${(m / 0.0254).toFixed(digits)} in`;
export function fmtAcres(m2: number): string {
  const ac = m2 / M2_PER_ACRE;
  if (ac >= 0.1) return `${ac.toFixed(2)} ac`;
  return `${Math.round(m2 / (M_PER_FT * M_PER_FT)).toLocaleString("en-US")} sq ft`;
}
/** A per-acre stand, to the nearest hundred (the precision a stand count carries). */
export const fmtPerAcre = (v: number) => (Math.round(v / 100) * 100).toLocaleString("en-US");
export const fmtPct = (v: number) => `${Math.round(100 * v)} %`;
