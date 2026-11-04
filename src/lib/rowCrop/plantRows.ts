// Rows from plant positions: the experiment of 2026-11-04 (MaSC-assisted row reconstruction). NOT wired into the app:
// nothing in Photo Scout or the Field Twin imports this file; the benches in scripts/rowCrop use it.
//
// The corn readers find rows from green pixels. Where the colour mask cannot see the plants (dark seedlings, low
// contrast, thin stands) they read nothing, though a plant detector (MaSC) still boxes the plants. This module turns
// plant positions into rows on their own (rowsFromPoints) and beside a reader's rows (hybridRows). Its rules:
//   - a row is many plants in a line, never one box: at least PLANT_ROWS.minPlants along it;
//   - a row needs a neighbouring row at the planting's spacing (or twice it: one row missing between): positions that
//     form no repeated spacing make no rows at all;
//   - a row spans its plants only, cut where its plants stop for more than a few row spacings: never drawn through a
//     headland, a road or a gap;
//   - several row spacings are allowed (one per planting), each needing pairs of rows of its own.
// Beside a reader (hybridRows) the reader's rows are kept as they are; a plant row is added only when it lies on the
// reader's row lattice next to a corn row (a recovered corn row), or, away from the reader's rows, has neighbours of its
// own (a planted row whose crop is NOT confirmed: the detector boxes soybean seedlings as corn). A plant row between the
// reader's rows off their spacing is rejected. Plant boxes are evidence of a plant, never proof of maize.
//
// Directions follow the readers: directionDeg is the rows' direction in photo coordinates (y down); along a row
// u = x cos + y sin, across it v = -x sin + y cos.

export const PLANT_ROWS = {
  /** Fewer plant positions than this in a photo make no rows. */
  minPoints: 12,
  /** A row holds at least this many plants. */
  minPlants: 6,
  /** Strip length along the rows, in plant spacings (the median nearest-neighbour distance). */
  stripSpacings: 10,
  /** A strip's cluster across the rows needs this many plants to be a piece of a row. */
  minPerStrip: 2,
  /** A row's spacing to a neighbour matches a planting's within this share of that spacing. */
  pitchTol: 0.2,
  /** A row's plants sit on its centreline: their median distance from it is at most this share of the row spacing
   * (a plant spacing's half before the spacing is known) ... */
  maxResidualShare: 0.12,
  /** ... and fill at least this share of the plant positions its length holds at the photo's plant spacing. */
  minFill: 0.25,
  /** A row is cut where its plants stop for more than this many row spacings. */
  maxGapPitches: 2.5,
  /** A row spacing is the planting's when at least this many neighbouring row pairs show it. */
  minPairsForPitch: 2,
  /** Beside a reader: a plant row within this share of the spacing of a reader row is that row (confirms it). */
  sameRowShare: 0.25,
  /** ... a recovered corn row lies at most this many row spacings from a corn row (reader's or recovered). */
  maxSlots: 2,
  /** ... and holds at least this share of detector plants (green patches alone never make a row). */
  minDetectorShare: 0.5,
  /** A reader row is contradicted by a plant row beside it (closer than a row spacing allows) when, over the stretch
   * they share, it holds at most this share of the plant row's detector plants ... */
  maxContradictedShare: 0.25,
  /** ... and is dropped when contradicted over at least this share of its length. */
  dropShare: 0.5,
  /** Weed candidates within this share of the spacing of a recovered row stand on that row. */
  onRowShare: 0.2,
};

export type PlantPoint = { x: number; y: number; src?: "detector" | "green" };
export type PlantRowStatus = "row" | "corn row" | "recovered corn row" | "corrected corn row" | "planted row, crop unconfirmed" | "confirms a reader row" | "rejected";
export type PlantRow = {
  /** Centreline, photo pixels: one point per strip the row crosses, in order along it. */
  points: [number, number][];
  /** Indices into the input points. */
  members: number[];
  detectorPlants: number;
  /** Along-span of its plants, photo pixels. */
  spanPx: number;
  status: PlantRowStatus;
  why?: string;
};
export type PlantRowsResult = {
  directionDeg: number | null;
  /** The main planting's row spacing, photo pixels, and every planting's. */
  pitchPx: number | null; pitchesPx: number[];
  /** Median nearest-neighbour distance of the plants (about the in-row plant spacing), photo pixels. */
  spacingPx: number | null;
  rows: PlantRow[]; rejected: PlantRow[];
  notes: string[]; ms: number;
};

type Seg = { u: number; v: number; members: number[] };
type Cand = { segs: Seg[]; members: number[]; u0: number; u1: number };
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };

/** Median nearest-neighbour distance (a sample of at most 3000 points). */
export function nnSpacing(pts: PlantPoint[]): number | null {
  if (pts.length < 2) return null;
  const step = Math.max(1, Math.floor(pts.length / 3000)), d: number[] = [];
  for (let i = 0; i < pts.length; i += step) { let b = Infinity; for (let j = 0; j < pts.length; j++) if (j !== i) b = Math.min(b, (pts[i].x - pts[j].x) ** 2 + (pts[i].y - pts[j].y) ** 2); if (b > 0 && b < Infinity) d.push(Math.sqrt(b)); }
  return d.length ? median(d) : null;
}

/** The direction (degrees, [0, 180)) along which the plants line up best: their positions across it pile into the
 * fewest bins of a third of a plant spacing. */
export function plantDirection(pts: PlantPoint[], spacingPx: number): number {
  const w = Math.max(1, spacingPx / 3);
  const score = (deg: number) => { const t = (deg * Math.PI) / 180, s = Math.sin(t), c = Math.cos(t), h = new Map<number, number>(); for (const p of pts) { const k = Math.floor((-p.x * s + p.y * c) / w); h.set(k, (h.get(k) ?? 0) + 1); } let q = 0; for (const n of h.values()) q += n * n; return q; };
  let best = 0, bs = -1;
  for (let d = 0; d < 180; d += 1) { const s = score(d); if (s > bs) { bs = s; best = d; } }
  for (let d = best - 1; d <= best + 1; d += 0.1) { const s = score(d); if (s > bs) { bs = s; best = d; } }
  return ((best % 180) + 180) % 180;
}

const frame = (deg: number) => { const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t); return { uv: (x: number, y: number) => [x * c + y * s, -x * s + y * c] as [number, number], xy: (u: number, v: number) => [u * c - v * s, u * s + v * c] as [number, number] }; };

/** Across position of a polyline (in u,v) at along position u: linear between its points, held at its ends. */
function vAt(line: [number, number][], u: number): number {
  if (u <= line[0][0]) return line[0][1];
  for (let i = 1; i < line.length; i++) if (u <= line[i][0]) { const [u0, v0] = line[i - 1], [u1, v1] = line[i]; return u1 === u0 ? v1 : v0 + ((u - u0) / (u1 - u0)) * (v1 - v0); }
  return line[line.length - 1][1];
}

/** Row pieces from points in the rotated frame: strips along the rows, clusters across them, linked strip to strip. */
function candidates(uv: [number, number][], idx: number[], spacing: number, joinPx: number, maxGapPx: number, resTol: number): Cand[] {
  if (idx.length < PLANT_ROWS.minPlants) return [];
  const L = PLANT_ROWS.stripSpacings * spacing, step = L / 2;
  let uMin = Infinity, uMax = -Infinity; for (const i of idx) { uMin = Math.min(uMin, uv[i][0]); uMax = Math.max(uMax, uv[i][0]); }
  const strips: Seg[][] = [];
  for (let u0 = uMin; u0 <= uMax; u0 += step) {
    const inS = idx.filter(i => uv[i][0] >= u0 && uv[i][0] < u0 + L).sort((a, b) => uv[a][1] - uv[b][1]);
    const segs: Seg[] = []; let cur: number[] = [];
    const close = () => { if (cur.length >= PLANT_ROWS.minPerStrip) segs.push({ u: u0 + L / 2, v: median(cur.map(i => uv[i][1])), members: cur }); cur = []; };
    for (const i of inS) { if (cur.length && uv[i][1] - uv[cur[cur.length - 1]][1] > joinPx) close(); cur.push(i); }
    close(); strips.push(segs);
  }
  // Link: each open chain takes the nearest piece of the next strip within joinPx (one to one), surviving one empty strip.
  type Chain = { segs: Seg[]; last: number };
  const open: Chain[] = [], done: Chain[] = [];
  strips.forEach((segs, k) => {
    const pairs: { c: number; s: number; d: number }[] = [];
    open.forEach((ch, ci) => segs.forEach((sg, si) => { const d = Math.abs(sg.v - ch.segs[ch.segs.length - 1].v); if (d <= joinPx) pairs.push({ c: ci, s: si, d }); }));
    pairs.sort((a, b) => a.d - b.d);
    const usedC = new Set<number>(), usedS = new Set<number>();
    for (const p of pairs) { if (usedC.has(p.c) || usedS.has(p.s)) continue; usedC.add(p.c); usedS.add(p.s); open[p.c].segs.push(segs[p.s]); open[p.c].last = k; }
    segs.forEach((sg, si) => { if (!usedS.has(si)) open.push({ segs: [sg], last: k }); });
    for (let i = open.length - 1; i >= 0; i--) if (k - open[i].last > 2) done.push(...open.splice(i, 1));
  });
  done.push(...open);
  // Each chain's plants, cut where they stop for more than maxGapPx along the row.
  const out: Cand[] = [];
  for (const ch of done) {
    const mem = [...new Set(ch.segs.flatMap(s => s.members))].sort((a, b) => uv[a][0] - uv[b][0]);
    let piece: number[] = [];
    const flush = () => {
      if (piece.length >= PLANT_ROWS.minPlants) {
        const u0 = uv[piece[0]][0], u1 = uv[piece[piece.length - 1]][0];
        const segs = ch.segs.filter(s => s.u >= u0 - L / 2 && s.u <= u1 + L / 2);
        const c: Cand = { segs: segs.length ? segs : ch.segs, members: piece, u0, u1 };
        // A row, not a chain of scattered plants: tight on its line, and dense enough along it.
        const line = lineUV(c, uv), res = median(piece.map(i => Math.abs(uv[i][1] - vAt(line, uv[i][0]))));
        if (res <= resTol && piece.length >= PLANT_ROWS.minFill * ((u1 - u0) / spacing + 1)) out.push(c);
      }
      piece = [];
    };
    for (const i of mem) { if (piece.length && uv[i][0] - uv[piece[piece.length - 1]][0] > maxGapPx) flush(); piece.push(i); }
    flush();
  }
  return out;
}

/** The row's centreline in (u, v): its pieces' across positions, ends at its first and last plant. */
function lineUV(c: Cand, uv: [number, number][]): [number, number][] {
  const pts = c.segs.map(s => [s.u, s.v] as [number, number]).sort((a, b) => a[0] - b[0]);
  const inner = pts.filter(([u]) => u > c.u0 && u < c.u1);
  const vFirst = median(c.members.slice(0, Math.min(5, c.members.length)).map(i => uv[i][1])), vLast = median(c.members.slice(-5).map(i => uv[i][1]));
  return [[c.u0, inner.length ? vAt(inner, c.u0) : vFirst], ...inner, [c.u1, inner.length ? vAt(inner, c.u1) : vLast]];
}

/** Signed median across offset of row a from row b over a's points where b overlaps (null with no overlap). */
function offsetFrom(a: [number, number][], b: [number, number][], allowExtend = false): number | null {
  const lo = b[0][0], hi = b[b.length - 1][0], d: number[] = [];
  for (const [u, v] of a) if (allowExtend || (u >= lo && u <= hi)) d.push(v - vAt(b, u));
  if (!d.length && !allowExtend) { const span = Math.min(hi - lo, a[a.length - 1][0] - a[0][0]); if (a[0][0] <= hi + span && a[a.length - 1][0] >= lo - span) return offsetFrom(a, b, true); }
  return d.length ? median(d) : null;
}

/** Row spacings shown by neighbouring rows: adjacent across offsets clustered within the tolerance, each needing pairs. */
function pitchModes(lines: [number, number][][]): number[] {
  const order = lines.map((l, i) => ({ i, v: median(l.map(p => p[1])) })).sort((a, b) => a.v - b.v);
  const gaps: number[] = [];
  for (let k = 0; k + 1 < order.length; k++) for (let j = k + 1; j < Math.min(order.length, k + 4); j++) {
    const o = offsetFrom(lines[order[j].i], lines[order[k].i]); if (o != null && o > 0) { gaps.push(o); break; }
  }
  gaps.sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const g of gaps) { const last = groups[groups.length - 1]; if (last && g <= median(last) * (1 + PLANT_ROWS.pitchTol / 2)) last.push(g); else groups.push([g]); }
  return groups.filter(g => g.length >= PLANT_ROWS.minPairsForPitch).sort((a, b) => b.length - a.length).map(g => median(g));
}
const fitsLattice = (off: number, pitches: number[], maxN: number) => pitches.some(p => { const n = Math.round(Math.abs(off) / p); return n >= 1 && n <= maxN && Math.abs(Math.abs(off) / p - n) <= PLANT_ROWS.pitchTol; });

/**
 * Rows from plant positions alone. `prior` (a reader's direction and spacing) skips the estimates. Rows need
 * PLANT_ROWS.minPlants plants and a neighbouring row at a planting's spacing (or twice it).
 */
export function rowsFromPoints(pts: PlantPoint[], prior: { directionDeg?: number | null; pitchPx?: number | null } = {}): PlantRowsResult {
  const t0 = Date.now(), notes: string[] = [];
  const empty = (why: string): PlantRowsResult => ({ directionDeg: prior.directionDeg ?? null, pitchPx: null, pitchesPx: [], spacingPx: null, rows: [], rejected: [], notes: [why], ms: Date.now() - t0 });
  if (pts.length < PLANT_ROWS.minPoints) return empty(`${pts.length} plant positions: too few for rows.`);
  const spacing = nnSpacing(pts);
  if (!spacing) return empty("Plant positions coincide: no spacing.");
  const dir = prior.directionDeg ?? plantDirection(pts, spacing);
  const F = frame(dir), uv = pts.map(p => F.uv(p.x, p.y)), all = pts.map((_, i) => i);
  // First pass at the plant spacing (no row spacing known yet), then again at the row spacing it shows.
  let pitch = prior.pitchPx ?? null, pitches: number[] = pitch ? [pitch] : [];
  if (!pitch) {
    const c1 = candidates(uv, all, spacing, spacing, Infinity, 0.5 * spacing);
    pitches = pitchModes(c1.map(c => lineUV(c, uv)));
    pitch = pitches[0] ?? null;
    if (!pitch) return { ...empty("The plant positions show no repeated row spacing: no rows."), directionDeg: dir, spacingPx: spacing };
  }
  const cands = candidates(uv, all, spacing, Math.max(spacing, pitch / 3), PLANT_ROWS.maxGapPitches * pitch, Math.max(PLANT_ROWS.maxResidualShare * pitch, 0.25 * spacing));
  const lines = cands.map(c => lineUV(c, uv));
  if (!prior.pitchPx) { const m = pitchModes(lines); if (m.length) { pitches = m; pitch = m[0]; } }
  const rows: PlantRow[] = [], rejected: PlantRow[] = [];
  cands.forEach((c, i) => {
    const supported = lines.some((l, j) => { if (j === i) return false; const o = offsetFrom(lines[i], l); return o != null && fitsLattice(o, pitches, 2); });
    const row: PlantRow = { points: lines[i].map(([u, v]) => F.xy(u, v)), members: c.members, detectorPlants: c.members.filter(k => pts[k].src !== "green").length, spanPx: c.u1 - c.u0, status: supported ? "row" : "rejected", ...(supported ? {} : { why: "no neighbouring row at the planting's spacing" }) };
    (supported ? rows : rejected).push(row);
  });
  if (pitches.length > 1) notes.push(`${pitches.length} row spacings: ${pitches.map(p => Math.round(p)).join(", ")} px.`);
  notes.push(`${rows.length} rows from ${pts.length} plant positions${rejected.length ? `; ${rejected.length} lines of plants rejected (no neighbouring row at the spacing)` : ""}.`);
  return { directionDeg: dir, pitchPx: pitch, pitchesPx: pitches, spacingPx: spacing, rows, rejected, notes, ms: Date.now() - t0 };
}

export type ReaderRows = { rows: { points: [number, number][] }[]; directionDeg: number | null; pitchPx: number | null };
export type HybridResult = PlantRowsResult & {
  /** Plant rows that lie on a reader row (they confirm it), and reader rows no detector plant stands on. */
  confirmed: number; readerRowsWithoutPlants: number;
  /** Indices (into reader.rows) of reader rows the detector's plants contradict: drawn beside the plants, off them. */
  droppedReaderRows: number[];
  /** Indices (into `candidates` given) of weed candidates standing on a recovered or planted row. */
  onRecoveredRows: number[];
};

/**
 * A reader's rows with plant evidence: `detector` plant centres (MaSC) and `green` patches the reader left unexplained
 * (its weed candidates, green on unsupported rows or uncertain ground). Reader rows are kept unchanged. A plant row
 * (>= minPlants, at least half detector plants) that duplicates a reader row confirms it; one on the reader's row
 * lattice within maxSlots of a corn row is a recovered corn row (grown outward row by row); one away from the reader's
 * rows with neighbours of its own is a planted row whose crop is not confirmed; anything else is rejected, in
 * particular plant lines between the reader's rows off their spacing. `weedCandidates` (centres) on a recovered or
 * planted row are returned as standing on it.
 */
export function hybridRows(reader: ReaderRows, detector: PlantPoint[], green: PlantPoint[], weedCandidates: [number, number][] = []): HybridResult {
  const t0 = Date.now();
  const pts: PlantPoint[] = [...detector.map(p => ({ ...p, src: "detector" as const })), ...green.map(p => ({ ...p, src: "green" as const }))];
  const haveReader = reader.rows.length > 0 && reader.directionDeg != null && reader.pitchPx != null && reader.pitchPx > 0;
  if (!haveReader) {
    // No reader rows: the detector's own rows (green patches add nothing without a row lattice), crop unconfirmed.
    const r = rowsFromPoints(detector, { directionDeg: reader.directionDeg });
    const rows = r.rows.map(x => ({ ...x, status: "planted row, crop unconfirmed" as const }));
    return { ...r, rows, confirmed: 0, readerRowsWithoutPlants: 0, droppedReaderRows: [], onRecoveredRows: onRows(rows, r.pitchPx, weedCandidates), notes: ["The reader read no rows: rows from the detector's plants alone, crop not confirmed.", ...r.notes], ms: Date.now() - t0 };
  }
  const dir = reader.directionDeg!, pitch = reader.pitchPx!;
  const base = rowsFromPoints(pts, { directionDeg: dir, pitchPx: pitch });
  const F = frame(dir), toUV = (l: [number, number][]) => l.map(([x, y]) => F.uv(x, y)).sort((a, b) => a[0] - b[0]);
  const readerIdx = reader.rows.map((r, i) => (r.points.length >= 2 ? i : -1)).filter(i => i >= 0);
  const readerUV: [number, number][][] = readerIdx.map(i => toUV(reader.rows[i].points));
  const readerN = readerUV.length;
  const ptsUV = pts.map(p => F.uv(p.x, p.y));
  const pool = [...base.rows, ...base.rejected].map(r => ({ r, uv: toUV(r.points) }));
  const rows: PlantRow[] = [], rejected: PlantRow[] = [];
  let confirmed = 0;
  const todo: typeof pool = [];
  for (const c of pool) {
    if (c.r.detectorPlants < Math.max(2, PLANT_ROWS.minDetectorShare * c.r.members.length)) { rejected.push({ ...c.r, status: "rejected", why: "mostly green patches: too few detector plants" }); continue; }
    if (readerUV.some(l => { const o = offsetFrom(c.uv, l); return o != null && Math.abs(o) <= PLANT_ROWS.sameRowShare * pitch; })) { confirmed++; rows.push({ ...c.r, status: "confirms a reader row" }); continue; }
    todo.push(c);
  }
  // Conflicts: a plant row closer to a reader row than a row spacing allows. Where, over the stretch they share, the
  // plant row holds the detector's plants and the reader row almost none, the reader row was drawn off the plants
  // (between the real rows, on soil or furrows): the plant row takes its place, and a reader row contradicted over most
  // of its length is dropped. Where the reader row holds plants too, the reader stands and the plant row is rejected.
  // Where the detector sees nothing (past V10) there are no plant rows and no conflicts: the reader always stands.
  const det = detector.map(p => F.uv(p.x, p.y));
  const detOn = (l: [number, number][], u0: number, u1: number) => det.filter(([u, v]) => u >= u0 && u <= u1 && Math.abs(v - vAt(l, u)) <= PLANT_ROWS.sameRowShare * pitch).length;
  const contradictedLen = new Array<number>(readerN).fill(0);
  const corrected: typeof todo = [];
  for (let i = todo.length - 1; i >= 0; i--) {
    const c = todo[i], cu0 = c.uv[0][0], cu1 = c.uv[c.uv.length - 1][0];
    const hits: { j: number; len: number }[] = []; let stands = false;
    for (let j = 0; j < readerN; j++) {
      const r = readerUV[j], u0 = Math.max(cu0, r[0][0]), u1 = Math.min(cu1, r[r.length - 1][0]);
      if (u1 <= u0) continue;
      const o = offsetFrom(c.uv, r); if (o == null) continue;
      const a = Math.abs(o); if (a <= PLANT_ROWS.sameRowShare * pitch || a >= (1 - PLANT_ROWS.pitchTol) * pitch) continue;
      const dc = c.r.members.filter(k => pts[k].src !== "green" && ptsUV[k][0] >= u0 && ptsUV[k][0] <= u1).length, dr = detOn(r, u0, u1);
      if (dc >= PLANT_ROWS.minPlants && dr <= PLANT_ROWS.maxContradictedShare * dc) hits.push({ j, len: u1 - u0 }); else stands = true;
    }
    if (stands) { rejected.push({ ...c.r, status: "rejected", why: "beside a reader row that holds plants too: the reader stands" }); todo.splice(i, 1); continue; }
    if (hits.length) { for (const h of hits) contradictedLen[h.j] += h.len; corrected.push(c); todo.splice(i, 1); }
  }
  const droppedLocal = new Set(readerUV.map((r, j) => (contradictedLen[j] >= PLANT_ROWS.dropShare * (r[r.length - 1][0] - r[0][0]) ? j : -1)).filter(j => j >= 0));
  const corn: [number, number][][] = readerUV.filter((_, j) => !droppedLocal.has(j));
  const keptReaderN = corn.length;
  for (const c of corrected) { rows.push({ ...c.r, status: "corrected corn row", why: "on the detector's plants where a reader row ran beside them, off the plants" }); corn.push(c.uv); }
  // Grow the corn rows outward: a plant row on the lattice within maxSlots of a corn row is a recovered corn row.
  for (let grew = true; grew;) {
    grew = false;
    for (let i = todo.length - 1; i >= 0; i--) {
      const c = todo[i];
      const near = corn.map(l => offsetFrom(c.uv, l)).filter((o): o is number => o != null).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
      if (near != null && fitsLattice(near, [pitch], PLANT_ROWS.maxSlots)) { rows.push({ ...c.r, status: "recovered corn row", why: `on the corn rows' spacing, ${Math.round(Math.abs(near) / pitch)} row${Math.round(Math.abs(near) / pitch) === 1 ? "" : "s"} from a corn row` }); corn.push(c.uv); todo.splice(i, 1); grew = true; }
    }
  }
  // Inside the reader's rows: a plant line between corn rows off their spacing is rejected.
  const inside = (l: [number, number][]) => { const offs = corn.slice(0, keptReaderN).map(c => offsetFrom(l, c)).filter((o): o is number => o != null); return offs.some(o => o > 0) && offs.some(o => o < 0); };
  // Another planting may have a row spacing of its own: shown by pairs of the remaining plant rows.
  const ownPitches = pitchModes(todo.map(t => t.uv));
  for (const c of todo) {
    if (inside(c.uv)) {
      // Between corn rows: on their spacing (several rows missing between) it is a corn row; off it, rejected.
      const near = corn.map(l => offsetFrom(c.uv, l)).filter((o): o is number => o != null).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
      if (near != null && fitsLattice(near, [pitch], 1000)) rows.push({ ...c.r, status: "recovered corn row", why: "between corn rows, on their spacing" });
      else rejected.push({ ...c.r, status: "rejected", why: "between the corn rows, off their spacing" });
      continue;
    }
    const others = todo.filter(o => o !== c).map(o => o.uv);
    const supported = others.some(l => { const o = offsetFrom(c.uv, l); return o != null && fitsLattice(o, [pitch, ...ownPitches], 2); });
    if (supported) rows.push({ ...c.r, status: "planted row, crop unconfirmed", why: "away from the corn rows: a planting, crop not confirmed" });
    else rejected.push({ ...c.r, status: "rejected", why: c.r.why ?? "no neighbouring row at the spacing" });
  }
  // Reader rows no detector plant stands on (the detector is blind past V10: information only).
  const readerRowsWithoutPlants = corn.slice(0, keptReaderN).filter(l => !det.some(([u, v]) => u >= l[0][0] && u <= l[l.length - 1][0] && Math.abs(v - vAt(l, u)) <= PLANT_ROWS.sameRowShare * pitch)).length;
  const added = rows.filter(r => r.status === "recovered corn row" || r.status === "corrected corn row" || r.status === "planted row, crop unconfirmed");
  const notes = [`Reader rows kept ${keptReaderN} of ${readerN}${droppedLocal.size ? ` (${droppedLocal.size} dropped: the detector's plants stand beside them, not on them)` : ""}; plant rows: ${confirmed} confirm a reader row, ${corrected.length} corrected corn rows, ${rows.filter(r => r.status === "recovered corn row").length} recovered corn rows, ${rows.filter(r => r.status === "planted row, crop unconfirmed").length} planted rows with the crop unconfirmed, ${rejected.length} rejected.`];
  return { ...base, rows, rejected, confirmed, readerRowsWithoutPlants, droppedReaderRows: [...droppedLocal].map(j => readerIdx[j]).sort((a, b) => a - b), onRecoveredRows: onRows(added, pitch, weedCandidates), notes, ms: Date.now() - t0 };
}

/** Indices of points within onRowShare of the spacing of any of the rows. */
function onRows(rows: PlantRow[], pitch: number | null, pts: [number, number][]): number[] {
  if (!pitch || !rows.length) return [];
  const tol = PLANT_ROWS.onRowShare * pitch, out: number[] = [];
  pts.forEach(([x, y], i) => { if (rows.some(r => distToLine(r.points, x, y) <= tol)) out.push(i); });
  return out;
}

/** Distance from a point to a polyline, photo pixels. */
export function distToLine(l: [number, number][], x: number, y: number): number {
  if (l.length === 1) return Math.hypot(x - l[0][0], y - l[0][1]);
  let best = Infinity;
  for (let i = 0; i + 1 < l.length; i++) {
    const [ax, ay] = l[i], [bx, by] = l[i + 1], vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
    best = Math.min(best, Math.hypot(x - ax - t * vx, y - ay - t * vy));
  }
  return best;
}

export type DetectorLedResult = {
  /** The detector's rows: "corn row" inside the reader's corn ground, else "planted row, crop unconfirmed". */
  rows: PlantRow[];
  /** The reader's rows where the detector has no rows (pieces of them, photo pixels): the detector is blind there. */
  readerPieces: [number, number][][];
  /** Indices (into reader.rows) of reader rows replaced in full by the detector's geometry. */
  replacedReaderRows: number[];
  pitchPx: number | null; directionDeg: number | null;
  onRows: number[];
  notes: string[]; ms: number;
};

/**
 * Detector-led geometry (variant D, 2026-11-04): where the plant detector's own rows stand (rowsFromPoints: many
 * plants, neighbouring rows at a repeated spacing), they are the rows; the reader's rows are kept only where no detector
 * row lies within a row spacing of them (the detector is blind there: past V10, or no plants boxed). A detector row is a
 * "corn row" when it lies inside the reader's corn ground (within a row spacing of the reader's rows, across and along),
 * else a "planted row, crop unconfirmed": the detector boxes soybean seedlings as corn, so its rows alone never confirm
 * the crop. Weed candidates within onRowShare of a spacing of a detector row are returned as standing on it. The
 * reader's green judgement is NOT redone: green the reader called corn on a reader row the detector replaced stays out
 * of the weed list (a limitation of this experiment).
 */
export function detectorLedRows(reader: ReaderRows, detector: PlantPoint[], weedCandidates: [number, number][] = []): DetectorLedResult {
  const t0 = Date.now();
  const B = rowsFromPoints(detector);
  const readerRows = reader.rows.filter(r => r.points.length >= 2);
  if (!B.rows.length || !B.pitchPx) return { rows: [], readerPieces: readerRows.map(r => r.points), replacedReaderRows: [], pitchPx: reader.pitchPx, directionDeg: reader.directionDeg, onRows: [], notes: ["The detector holds no rows: the reader's rows stand as they are.", ...B.notes], ms: Date.now() - t0 };
  const p = B.pitchPx, pr = reader.pitchPx && reader.pitchPx > 0 ? reader.pitchPx : p;
  // Reader rows, cut where a detector row lies within a row spacing (densified so long straight pieces are cut too).
  const densify = (l: [number, number][], step: number) => { const out: [number, number][] = [l[0]]; for (let i = 1; i < l.length; i++) { const [ax, ay] = l[i - 1], [bx, by] = l[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step)); for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]); } return out; };
  const nearDetector = (x: number, y: number) => B.rows.some(r => distToLine(r.points, x, y) <= p);
  const readerPieces: [number, number][][] = [], replaced: number[] = [];
  reader.rows.forEach((r, i) => {
    if (r.points.length < 2) return;
    const d = densify(r.points, p / 2); let run: [number, number][] = [], kept = 0;
    const flush = () => { if (run.length >= 2 && Math.hypot(run[run.length - 1][0] - run[0][0], run[run.length - 1][1] - run[0][1]) >= 1.5 * pr) { readerPieces.push(run); kept++; } run = []; };
    for (const q of d) { if (nearDetector(q[0], q[1])) flush(); else run.push(q); }
    flush();
    if (!kept) replaced.push(i);
  });
  // Corn ground: within a reader row spacing of a reader row.
  const inCornGround = (row: PlantRow) => { const pts = densify(row.points, p); const near = pts.filter(([x, y]) => readerRows.some(r => distToLine(r.points, x, y) <= pr)).length; return near >= 0.5 * pts.length; };
  const rows = B.rows.map(r => ({ ...r, status: inCornGround(r) ? ("corn row" as PlantRowStatus) : ("planted row, crop unconfirmed" as PlantRowStatus) }));
  const onR = onRows(rows, p, weedCandidates);
  const corn = rows.filter(r => r.status === "corn row").length;
  return { rows, readerPieces, replacedReaderRows: replaced, pitchPx: p, directionDeg: B.directionDeg, onRows: onR, notes: [`${rows.length} detector rows (${corn} in the reader's corn ground, ${rows.length - corn} with the crop unconfirmed); ${readerPieces.length} reader row pieces kept where the detector holds no rows; ${replaced.length} reader rows replaced in full.`], ms: Date.now() - t0 };
}
