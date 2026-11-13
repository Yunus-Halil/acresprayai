// The operator's corrections to a corn twin's rows (2026-11-13): keep a row, remove a row, add a row the twin missed.
// A layer folded over the saved twin when it is viewed; the twin itself is never changed (its rows keep their ids and
// their machine status, and the operator's word is drawn beside it, as the corrected boundary is).
//
// Adding is one tap. The tap resolves to a slot, and the slot comes from the rows on either side, not from a field-wide
// lattice: the twin stores one direction and one spacing but no lattice phase, and its spacing can differ from the
// rows' own by a few per cent, which over a hundred rows is metres. Between two drawn rows whose separation is about a
// whole number of spacings, that separation is divided evenly; beyond the outermost row, the step is the local gap
// between the nearest pair. The new row follows its neighbours' course (their curvature), and where located plants are
// known it is moved onto them, by at most a quarter spacing. A tap within a quarter spacing of a drawn row is that row.
//
// Saved on this device for now (localStorage, per twin). Saving to the account needs a new review kind for an added
// row and a payload on corn row reviews (a migration not yet applied); see docs/features/corn-row-editing.md.
import type { LatLngPair, TwinBundle } from "./types";

export type RowVerdict = "keep" | "remove";
export type AddedRow = {
  uid: string;
  line: LatLngPair[];
  at: string;
  /** How the slot was found: between two rows (slot k of n), beyond the outermost, or with no row near. */
  snap: { method: "between" | "beyond" | "alone"; neighbours: (number | string)[]; slot: number; of: number; plants: number; spacingM: number };
  /** What the operator could see and how they tapped: a correction made over photographs weighs differently from one over marks. */
  onScreen: string;
  pointer: string;
};
export type RowEdits = {
  version: 1;
  verdicts: Record<string, RowVerdict>;
  added: AddedRow[];
  /** A twin row's ends as the operator moved them (its course kept: trimmed inside, carried straight on beyond). */
  ends: Record<string, [LatLngPair, LatLngPair]>;
};
export const NO_ROW_EDITS: RowEdits = { version: 1, verdicts: {}, added: [], ends: {} };

const KEY = (twinId: string) => `swathwise:twin-row-edits:${twinId}`;
export function loadRowEdits(twinId: string): RowEdits {
  try {
    const raw = localStorage.getItem(KEY(twinId));
    if (!raw) return NO_ROW_EDITS;
    const v = JSON.parse(raw) as Partial<RowEdits>;
    const verdicts: Record<string, RowVerdict> = {};
    for (const [k, x] of Object.entries(v.verdicts ?? {})) if (x === "keep" || x === "remove") verdicts[k] = x;
    const added = Array.isArray(v.added) ? v.added.filter(a => a && typeof a.uid === "string" && Array.isArray(a.line) && a.line.length >= 2) : [];
    const ends: Record<string, [LatLngPair, LatLngPair]> = {};
    const pt = (x: unknown): x is LatLngPair => Array.isArray(x) && x.length === 2 && x.every(n => typeof n === "number" && Number.isFinite(n));
    for (const [k, x] of Object.entries(v.ends ?? {})) if (Array.isArray(x) && x.length === 2 && pt(x[0]) && pt(x[1])) ends[k] = [x[0], x[1]];
    return { version: 1, verdicts, added, ends };
  } catch { return NO_ROW_EDITS; }
}
export function saveRowEdits(twinId: string, e: RowEdits): boolean {
  try { localStorage.setItem(KEY(twinId), JSON.stringify(e)); return true; } catch { return false; }
}
export function newUid(): string {
  try { return crypto.randomUUID(); } catch { return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
}

/** A local metric frame at the field: metres east and north of an origin. */
export function localFrame(lat0: number, lng0: number) {
  const phi = (lat0 * Math.PI) / 180;
  const mLat = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi), mLng = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
  return {
    toEN: (lat: number, lng: number): [number, number] => [(lng - lng0) * mLng, (lat - lat0) * mLat],
    toLL: (e: number, n: number): LatLngPair => [Math.round((lat0 + n / mLat) * 1e8) / 1e8, Math.round((lng0 + e / mLng) * 1e8) / 1e8],
  };
}

/** One row in the along / across frame: its vertices sorted along, and its across offset anywhere along it. */
type ARow = { key: number | string; a: Float64Array; c: Float64Array; a0: number; a1: number };
function cAt(r: ARow, a: number): number {
  const A = r.a, C = r.c, n = A.length;
  if (a <= A[0]) return C[0];
  if (a >= A[n - 1]) return C[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (A[m] <= a) lo = m; else hi = m; }
  const t = (a - A[lo]) / (A[hi] - A[lo] || 1);
  return C[lo] + t * (C[hi] - C[lo]);
}

export type RowModel = {
  frame: ReturnType<typeof localFrame>;
  /** Unit vector along the rows, east / north. */
  d: [number, number];
  spacingM: number;
  rows: ARow[];
  toAC: (lat: number, lng: number) => [number, number];
  fromAC: (a: number, c: number) => LatLngPair;
};

/**
 * The rows as the operator sees them now: the twin's rows less those they removed, plus those they added. The row
 * direction is the length-weighted mean of the rows' own segments (doubled angles, so a row drawn either way agrees).
 */
export function rowModel(twin: TwinBundle, edits: RowEdits): RowModel | null {
  const K = twin.corn;
  if (!K) return null;
  const frame = localFrame(twin.origin.lat, twin.origin.lng);
  const lines: { key: number | string; en: [number, number][] }[] = [];
  for (const r of K.rows) if (edits.verdicts[String(r.id)] !== "remove" && r.line.length >= 2) lines.push({ key: r.id, en: r.line.map(([la, ln]) => frame.toEN(la, ln)) });
  for (const r of edits.added) lines.push({ key: r.uid, en: r.line.map(([la, ln]) => frame.toEN(la, ln)) });
  let sx = 0, sy = 0;
  for (const l of lines) for (let i = 1; i < l.en.length; i++) { const de = l.en[i][0] - l.en[i - 1][0], dn = l.en[i][1] - l.en[i - 1][1], len = Math.hypot(de, dn); if (len <= 0) continue; const th = 2 * Math.atan2(dn, de); sx += len * Math.cos(th); sy += len * Math.sin(th); }
  let th: number;
  if (sx || sy) th = Math.atan2(sy, sx) / 2;
  else if (K.rowDirectionDeg != null) th = (K.rowDirectionDeg * Math.PI) / 180;
  else return null;
  const d: [number, number] = [Math.cos(th), Math.sin(th)];
  const toAC = (lat: number, lng: number): [number, number] => { const [e, n] = frame.toEN(lat, lng); return [e * d[0] + n * d[1], -e * d[1] + n * d[0]]; };
  const fromAC = (a: number, c: number): LatLngPair => frame.toLL(a * d[0] - c * d[1], a * d[1] + c * d[0]);
  const rows: ARow[] = lines.map(l => {
    const ac = l.en.map(([e, n]) => [e * d[0] + n * d[1], -e * d[1] + n * d[0]] as [number, number]).sort((x, y) => x[0] - y[0]);
    const r: ARow = { key: l.key, a: Float64Array.from(ac.map(p => p[0])), c: Float64Array.from(ac.map(p => p[1])), a0: ac[0][0], a1: ac[ac.length - 1][0] };
    const moved = typeof l.key === "number" ? edits.ends[String(l.key)] : undefined;
    if (!moved) return r;
    const [x0, x1] = moved.map(([la, ln]) => { const [e, n] = frame.toEN(la, ln); return e * d[0] + n * d[1]; });
    return withSpan(r, Math.min(x0, x1), Math.max(x0, x1));
  });
  // The spacing: the twin's, else the median gap between neighbouring rows in the middle of the field.
  let spacingM = K.rowSpacingM ?? 0;
  if (!(spacingM > 0.2)) {
    const mid = rows.length ? (Math.min(...rows.map(r => r.a0)) + Math.max(...rows.map(r => r.a1))) / 2 : 0;
    const cs = rows.filter(r => r.a0 <= mid && r.a1 >= mid).map(r => cAt(r, mid)).sort((x, y) => x - y), gaps: number[] = [];
    for (let i = 1; i < cs.length; i++) gaps.push(cs[i] - cs[i - 1]);
    gaps.sort((x, y) => x - y);
    spacingM = gaps.length ? gaps[gaps.length >> 1] : 0.76;
  }
  return { frame, d, spacingM, rows, toAC, fromAC };
}

/** A row cut to, or carried straight on to, the along span [a0, a1]: its vertices inside, and its course at each end. */
function withSpan(r: ARow, a0: number, a1: number): ARow {
  const A: number[] = [a0], Cs: number[] = [cAt(r, a0)];
  for (let i = 0; i < r.a.length; i++) if (r.a[i] > a0 && r.a[i] < a1) { A.push(r.a[i]); Cs.push(r.c[i]); }
  A.push(a1); Cs.push(cAt(r, a1));
  return { key: r.key, a: Float64Array.from(A), c: Float64Array.from(Cs), a0, a1 };
}
const lineOf = (m: RowModel, r: ARow): LatLngPair[] => Array.from(r.a, (a, i) => m.fromAC(a, r.c[i]));

/** A row's course as the operator sees it now (moved ends applied), latitude / longitude; null for a removed or unknown row. */
export function rowLineNow(m: RowModel, key: number | string): LatLngPair[] | null {
  const r = m.rows.find(x => x.key === key);
  return r ? lineOf(m, r) : null;
}
/** A row's two ends now, the lower along first (the handles the editor draws). */
export function rowEndsNow(m: RowModel, key: number | string): [LatLngPair, LatLngPair] | null {
  const r = m.rows.find(x => x.key === key);
  return r ? [m.fromAC(r.a0, cAt(r, r.a0)), m.fromAC(r.a1, cAt(r, r.a1))] : null;
}
/**
 * One end of a row moved to where (lat, lng) lies along the row: the row is cut inside, or carried straight on beyond
 * its end along the field's direction. `which` 0 is the end the handles list first. Null when the row would be
 * shorter than `minM` (remove it instead).
 */
export function moveRowEnd(m: RowModel, key: number | string, which: 0 | 1, lat: number, lng: number, minM = 1): { line: LatLngPair[]; ends: [LatLngPair, LatLngPair] } | null {
  const r = m.rows.find(x => x.key === key);
  if (!r) return null;
  const a = m.toAC(lat, lng)[0];
  const a0 = which === 0 ? a : r.a0, a1 = which === 1 ? a : r.a1;
  if (a1 - a0 < minM) return null;
  const nr = withSpan(r, a0, a1);
  return { line: lineOf(m, nr), ends: [m.fromAC(a0, cAt(nr, a0)), m.fromAC(a1, cAt(nr, a1))] };
}

export type Snap =
  | { kind: "row"; key: number | string }
  | { kind: "new"; line: LatLngPair[]; snap: AddedRow["snap"] }
  | { kind: "none"; why: string };

/** Plants in the along / across frame, for the snap's refinement. */
export type PlantIndex = { a: Float64Array; c: Float64Array; order: Int32Array };
export function plantIndex(m: RowModel, points: LatLngPair[]): PlantIndex {
  const n = points.length, a = new Float64Array(n), c = new Float64Array(n);
  points.forEach(([la, ln], i) => { const p = m.toAC(la, ln); a[i] = p[0]; c[i] = p[1]; });
  const order = Int32Array.from({ length: n }, (_, i) => i).sort((x, y) => a[x] - a[y]);
  return { a, c, order };
}
function plantsNear(P: PlantIndex, a0: number, a1: number, fn: (i: number) => void) {
  const { a, order } = P; let lo = 0, hi = order.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[order[m]] < a0) lo = m + 1; else hi = m; }
  for (let k = lo; k < order.length && a[order[k]] <= a1; k++) fn(order[k]);
}

/**
 * Where a tap at (lat, lng) puts a row (see the header). `reachM`: along the rows, how far either side of the tap the
 * plants refine the new row's place.
 */
export function snapRow(m: RowModel, lat: number, lng: number, plants: PlantIndex | null = null, reachM = 6, defaultHalfM = 15, gapM = 1.5, minPlants = 5): Snap {
  const [a, c] = m.toAC(lat, lng), s = m.spacingM, q = 0.25 * s;
  // Rows that reach this far along (a little beyond their ends counts: the tap is near their end).
  const here = m.rows.filter(r => a >= r.a0 - 2 * s && a <= r.a1 + 2 * s).map(r => ({ r, c: cAt(r, a) })).sort((x, y) => x.c - y.c);
  const near = here.reduce<{ r: ARow; d: number } | null>((b, x) => { const dd = Math.abs(x.c - c); return dd <= q && (!b || dd < b.d) ? { r: x.r, d: dd } : b; }, null);
  if (near) return { kind: "row", key: near.r.key };
  const lower = [...here].reverse().find(x => x.c < c) ?? null, upper = here.find(x => x.c > c) ?? null;
  let course: (aa: number) => number, span: [number, number], snap: AddedRow["snap"];
  if (lower && upper) {
    const g = upper.c - lower.c, n = Math.round(g / s);
    if (n < 2) return { kind: "none", why: "There is no room for a row between these two: they are about one spacing apart." };
    const k = Math.min(n - 1, Math.max(1, Math.round((c - lower.c) / (g / n)))), f = k / n;
    course = aa => cAt(lower.r, aa) + f * (cAt(upper.r, aa) - cAt(lower.r, aa));
    span = [Math.max(lower.r.a0, upper.r.a0), Math.min(lower.r.a1, upper.r.a1)];
    if (span[1] - span[0] < 2) span = [Math.min(lower.r.a0, upper.r.a0), Math.max(lower.r.a1, upper.r.a1)];
    snap = { method: "between", neighbours: [lower.r.key, upper.r.key], slot: k, of: n, plants: 0, spacingM: s };
  } else if (lower || upper) {
    const o = (lower ?? upper)!, side = lower ? 1 : -1;
    // The local step: the gap from this outer row to its next neighbour inward, when it is about one spacing.
    const inward = lower ? [...here].reverse().find(x => x.c < o.c) : here.find(x => x.c > o.c);
    const gap = inward ? Math.abs(o.c - inward.c) : s, step = gap >= 0.6 * s && gap <= 1.6 * s ? gap : s;
    const k = Math.max(1, Math.round(Math.abs(c - o.c) / step));
    course = aa => cAt(o.r, aa) + side * k * step;
    span = [o.r.a0, o.r.a1];
    snap = { method: "beyond", neighbours: [o.r.key], slot: k, of: 0, plants: 0, spacingM: s };
  } else {
    course = () => c;
    span = [a - defaultHalfM, a + defaultHalfM];
    snap = { method: "alone", neighbours: [], slot: 0, of: 0, plants: 0, spacingM: s };
  }
  // The located plants near the tap, within a quarter spacing of the slot: the row moves onto them (their median
  // offset), never further than that quarter spacing.
  let shift = 0;
  if (plants) {
    const res: number[] = [];
    plantsNear(plants, a - reachM, a + reachM, i => { const r = plants.c[i] - course(plants.a[i]); if (Math.abs(r) <= q) res.push(r); });
    if (res.length >= 3) { res.sort((x, y) => x - y); shift = Math.max(-q, Math.min(q, res[res.length >> 1])); snap.plants = res.length; }
    // How long: as far as the located plants on this line carry on from the tap, a gap of up to `gapM` bridged (a
    // missed plant or two); never past the neighbours' span. With too few plants, the neighbours' span stands and the
    // operator moves the ends.
    const on: number[] = [];
    plantsNear(plants, span[0], span[1], i => { if (Math.abs(plants.c[i] - course(plants.a[i]) - shift) <= 0.5 * q) on.push(plants.a[i]); });
    on.sort((x, y) => x - y);
    if (on.length >= minPlants) {
      // The run of plants holding the tap, or the nearest one to it.
      const runs: [number, number, number][] = [];
      for (let i = 0; i < on.length;) { let j = i; while (j + 1 < on.length && on[j + 1] - on[j] <= gapM) j++; runs.push([on[i], on[j], j - i + 1]); i = j + 1; }
      const dist = (r: [number, number, number]) => (a < r[0] ? r[0] - a : a > r[1] ? a - r[1] : 0);
      const best = runs.filter(r => r[2] >= minPlants).sort((x, y) => dist(x) - dist(y))[0];
      if (best && dist(best) <= gapM) span = [Math.max(span[0], best[0] - 0.1), Math.min(span[1], best[1] + 0.1)];
    }
  }
  const len = span[1] - span[0], step = Math.max(1, len / 200), line: LatLngPair[] = [];
  for (let aa = span[0]; aa < span[1]; aa += step) line.push(m.fromAC(aa, course(aa) + shift));
  line.push(m.fromAC(span[1], course(span[1]) + shift));
  return { kind: "new", line, snap };
}

/** A row's id or uid, as the verdicts map keys it. */
export const rowKey = (key: number | string) => String(key);
export function editCounts(e: RowEdits): { kept: number; removed: number; added: number; ends: number } {
  let kept = 0, removed = 0;
  for (const v of Object.values(e.verdicts)) { if (v === "keep") kept++; else removed++; }
  return { kept, removed, added: e.added.length, ends: Object.keys(e.ends).length };
}
