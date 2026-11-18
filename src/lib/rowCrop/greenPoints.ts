// Plant positions from the green itself, no model (Corn V1, 2026-11-04).
//
// The row builder of plantRows.ts (rowsFromPoints) needs plant positions, not pixels. MaSC gives them as boxes; this
// gives them from the seedling mask (green judged against the soil beside it, seedlingGreen.ts) so the same geometry
// runs in the browser with nothing to download and no licence to clear. A piece of green up to a few typical plants is
// one point at its centre; a larger piece (plants touching along a row, leaves of neighbours meeting) is cut into
// squares about two typical plants across, one point per square with enough green. Weeds are points too: the row
// builder only keeps points that line up in parallel, evenly spaced rows, and scattered green makes no rows.
import type { PhotoPixels } from "../photoScout/pattern";
import type { PlantPoint } from "./plantRows";
import { corePeaks, coresView, vividGreen } from "./greenCores";
import { convexHull } from "./readRowCrop";
import { type SeedlingCache, sharedSeedlingMask } from "./seedlingGreen";

export const GREEN_POINTS = {
  /** The mask is judged at the photo's pixel and read at this long side (pieces and points). */
  workLongSide: 1600,
  /** A work pixel is green when at least this share of its photo pixels is. */
  shrinkShare: 0.25,
  /** Pieces smaller than this (work pixels) are specks, not plants. */
  minPiecePx: 4,
  /** A piece up to this many typical plants is one point. */
  wholeUpTo: 4,
  /** A piece over this share of the frame does not size the typical plant. */
  maxPlantShare: 0.002,
  /** A piece sizes the typical plant only when the ground around it (its own size on every side) is at most this share
   * green: a plant on soil, not a bit of sward ... */
  aloneGreenShare: 0.15,
  /** ... given at least this many such pieces (else every piece sizes it). */
  minSizingPieces: 20,
  /** Pieces under this share of the typical plant are specks. */
  speckShare: 0.15,
  /** A larger piece filling more than this share of its box and wider than coverPlants typical plants both ways is
   * cover (a lawn, a canopy): no points. */
  coverFill: 0.35,
  coverPlants: 6,
  /** A long piece gives a point per this many typical plant diameters along its long axis. */
  stepPlants: 1.5,
  /** A lone plant smaller than this (photo pixels) is too few pixels to say what shape its leaves are. */
  shapeMinPx: 60,
  /** Points stop here (a frame of cover gives no plant positions anyway). */
  maxPoints: 15000,
  /** With the vivid cores asked for: a core belongs to the piece under it, or to the nearest one within this many work pixels. */
  coreReachPx: 2,
};

/**
 * The vivid cores asked of a photograph (greenCores.ts): the two blurs in its own pixels, and the bar a core must reach.
 * `reference`:
 *   "strongest"  at or over `share` of the photograph's strongest core (the first way; one grass verge in the frame
 *                sets that core so high that no crop core passes);
 *   "marks"      at or over `factor` times the median strength of the cores that sit on the read's own marks in this
 *                photograph: per piece of green that holds marks, as many of its strongest cores as it has marks.
 *                With no core on any mark the photograph gets no cores.
 */
export type CoresAsked = { finePx: number; widePx: number; share: number; reference?: "strongest" | "marks"; factor?: number };
/** What the cores pass found (for the record and for measuring): strengths are as measured, not shares. */
export type CoresInfo = {
  reference: "strongest" | "marks"; strongest: number;
  /** "marks": the cores on the read's marks, their median strength, and every local peak's strength (ascending). */
  onMarks?: number; medianOnMarks?: number | null; peakStrengths?: Float32Array;
  /** The bar, and the cores at or over it with where each stands: in a piece read as cover (never a mark), in another piece, or on none. */
  threshold: number | null; kept: { x: number; y: number; v: number; where: "cover" | "piece" | "none" }[];
};

/** A lone plant's outline at the photo's own pixel: how a grass (corn's narrow, spread leaves) differs from a broadleaf
 * seedling (beet, sunflower, soybean: round leaves, a compact rosette). */
export type PlantShape = {
  areaPx: number;
  /** Area over the convex hull's: a few narrow leaves spread out fill little of their hull, round leaves most of it. */
  solidity: number;
  /** Mean width of the plant's leaves, photo pixels (twice the area over the outline's length). */
  widthPx: number;
};
export type GreenPoint = PlantPoint & { shape?: PlantShape };

export type GreenPoints = {
  points: GreenPoint[];
  /** The typical plant piece's diameter, photo pixels (the median piece's square root). */
  typicalPx: number;
  /** Share of the frame that is green. */
  greenShare: number;
  workFactor: number;
  /** With the vivid cores asked for: the points added from them (they follow the read's own points in `points`). */
  coresAdded?: number; coresInfo?: CoresInfo;
};

/**
 * Plant positions over a whole photograph, photo pixels.
 * `cores` (off unless given): the plants of a piece counted by its vivid cores as well. Every point above is kept; in a
 * piece that holds more cores than points, each point takes its nearest core (one to one, nearest pairs first) and the
 * cores left over are added as points, so the piece carries as many points as it has cores. Cover gets none.
 */
export function plantPointsFromGreen(px: PhotoPixels, o = GREEN_POINTS, seedlings?: SeedlingCache, cores: CoresAsked | null = null): GreenPoints {
  const W = px.width, H = px.height, f = Math.max(1, Math.round(Math.max(W, H) / o.workLongSide));
  // The mask the emergence reader also reads: from the photograph's shared cache when there is one.
  const full = sharedSeedlingMask(seedlings, px);
  const w = Math.floor(W / f), h = Math.floor(H / f), mask = new Uint8Array(w * h), need = Math.max(1, Math.ceil(f * f * o.shrinkShare));
  let green = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = 0;
    for (let yy = 0; yy < f; yy++) { const row = (y * f + yy) * W + x * f; for (let xx = 0; xx < f; xx++) c += full[row + xx]; }
    if (c >= need) { mask[y * w + x] = 1; green++; }
  }
  // 8-connected pieces.
  const label = new Int32Array(w * h).fill(-1), stack = new Int32Array(w * h);
  const area: number[] = [], sx: number[] = [], sy: number[] = [], bx0: number[] = [], by0: number[] = [], bx1: number[] = [], by1: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i] >= 0) continue;
    const id = area.length; let top = 0, a = 0, ax = 0, ay = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack[top++] = i; label[i] = id;
    while (top) {
      const j = stack[--top], x = j % w, y = (j - x) / w;
      a++; ax += x; ay += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx; if (mask[k] && label[k] < 0) { label[k] = id; stack[top++] = k; }
      }
    }
    area.push(a); sx.push(ax); sy.push(ay); bx0.push(x0); by0.push(y0); bx1.push(x1); by1.push(y1);
  }
  // The typical plant: the area-weighted median piece (half the green lies in smaller pieces), so specks of soil
  // texture, however many, do not set it. Pieces under a share of it are specks.
  // Pieces over maxPlantShare of the frame (a lawn, a canopy, rows grown together) say nothing of a plant's size.
  const kept = area.map((a, id) => id).filter(id => area[id] >= o.minPiecePx).sort((p, q) => area[p] - area[q]);
  // Only pieces standing alone on soil size the plant: inside grass or a verge (green all around) the pieces are bits of
  // a sward, and they once set the typical plant so large that a whole frame's seedlings fell under the speck cut
  // (Yunus's emergence photo 4: 61 plants located, 2026-11-04).
  const integ = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += mask[y * w + x]; integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + row; } }
  const greenIn = (x0: number, y0: number, x1: number, y1: number) => { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1); return { g: integ[y1 * (w + 1) + x1] - integ[y0 * (w + 1) + x1] - integ[y1 * (w + 1) + x0] + integ[y0 * (w + 1) + x0], n: Math.max(1, (x1 - x0) * (y1 - y0)) }; };
  const alone = (id: number) => { const bw = bx1[id] - bx0[id] + 1, bh = by1[id] - by0[id] + 1, m = Math.max(bw, bh); const r = greenIn(bx0[id] - m, by0[id] - m, bx1[id] + 1 + m, by1[id] + 1 + m); return (r.g - area[id]) / Math.max(1, r.n - bw * bh) <= o.aloneGreenShare; };
  const small = kept.filter(id => area[id] <= o.maxPlantShare * w * h), isolated = small.filter(alone);
  const sizing = isolated.length >= o.minSizingPieces ? isolated : small;
  const total = sizing.reduce((s, id) => s + area[id], 0);
  let typical = o.minPiecePx;
  for (let acc = 0, i = 0; i < sizing.length; i++) { acc += area[sizing[i]]; if (acc >= total / 2) { typical = area[sizing[i]]; break; } }
  const d = Math.sqrt(typical), minPiece = Math.max(o.minPiecePx, typical * o.speckShare);
  const toPhoto = (x: number, y: number): PlantPoint => ({ x: (x + 0.5) * f, y: (y + 0.5) * f });
  const points: GreenPoint[] = [];
  /** The piece each point came from, and the pieces read as cover (only kept for the vivid cores). */
  const pieceOf: number[] = [], cover = new Set<number>();
  /** The piece's own pixels at the photo's pixel: its outline, hull and leaf width. */
  const shapeOf = (id: number): PlantShape | undefined => {
    const X0 = bx0[id] * f, Y0 = by0[id] * f, X1 = Math.min(W, (bx1[id] + 1) * f), Y1 = Math.min(H, (by1[id] + 1) * f);
    const inP = (X: number, Y: number) => X >= X0 && Y >= Y0 && X < X1 && Y < Y1 && full[Y * W + X] === 1 && label[Math.min(h - 1, (Y / f) | 0) * w + Math.min(w - 1, (X / f) | 0)] === id;
    let A = 0, P = 0; const edge: [number, number][] = [];
    for (let Y = Y0; Y < Y1; Y++) for (let X = X0; X < X1; X++) {
      if (!inP(X, Y)) continue;
      A++;
      if (!inP(X - 1, Y) || !inP(X + 1, Y) || !inP(X, Y - 1) || !inP(X, Y + 1)) { P++; edge.push([X, Y]); }
    }
    if (A < o.shapeMinPx || edge.length < 3) return undefined;
    const hull = convexHull(edge);
    let ha = 0, hp = 0;
    for (let i = 0; i < hull.length; i++) { const [ax, ay] = hull[i], [bx, by] = hull[(i + 1) % hull.length]; ha += ax * by - bx * ay; hp += Math.hypot(bx - ax, by - ay); }
    const hullArea = Math.abs(ha) / 2 + hp / 2 + 1;
    return { areaPx: A, solidity: Math.min(1, A / hullArea), widthPx: (2 * A) / P };
  };
  for (const id of kept) {
    const a = area[id]; if (a < minPiece) continue;
    if (a <= o.wholeUpTo * typical) { points.push({ ...toPhoto(sx[id] / a, sy[id] / a), shape: shapeOf(id) }); pieceOf.push(id); continue; }
    // A large piece: cover (it fills its box, wide both ways) gives no points: squares cut from a lawn or a canopy line
    // up in a perfect lattice the row builder would take for rows. A long piece (plants touching along a row) gives
    // points along its long axis, one per typical plant.
    const bw = bx1[id] - bx0[id] + 1, bh = by1[id] - by0[id] + 1, fill = a / (bw * bh);
    if (fill > o.coverFill && Math.min(bw, bh) > o.coverPlants * d) { cover.add(id); continue; }
    const mx = sx[id] / a, my = sy[id] / a;
    let cxx = 0, cyy = 0, cxy = 0;
    for (let y = by0[id]; y <= by1[id]; y++) for (let x = bx0[id]; x <= bx1[id]; x++) if (label[y * w + x] === id) { cxx += (x - mx) ** 2; cyy += (y - my) ** 2; cxy += (x - mx) * (y - my); }
    const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy), ux = Math.cos(th), uy = Math.sin(th), step = Math.max(2, d * o.stepPlants);
    const bins = new Map<number, [number, number, number]>();
    for (let y = by0[id]; y <= by1[id]; y++) for (let x = bx0[id]; x <= bx1[id]; x++) if (label[y * w + x] === id) {
      const k = Math.floor(((x - mx) * ux + (y - my) * uy) / step), b = bins.get(k) ?? [0, 0, 0]; b[0]++; b[1] += x; b[2] += y; bins.set(k, b);
    }
    for (const [n, bxs, bys] of bins.values()) if (n >= minPiece) { points.push(toPhoto(bxs / n, bys / n)); pieceOf.push(id); }
    if (points.length > o.maxPoints) break;
  }
  if (!cores || points.length > o.maxPoints) return { points, typicalPx: d * f, greenShare: green / (w * h || 1), workFactor: f };
  // The vivid cores (greenCores.ts), each in the piece under it or the nearest within reach.
  const pointsIn = new Map<number, number[]>(); pieceOf.forEach((id, k) => (pointsIn.get(id) ?? pointsIn.set(id, []).get(id)!).push(k));
  const byMarks = cores.reference === "marks", view = coresView(vividGreen(px), W, H, cores.finePx, cores.widePx), reach = o.coreReachPx;
  // By the strongest core: the peaks at or over the share. By the marks: every peak first, the bar from those on the marks.
  const peaks = corePeaks(view.strength, W, H, view.top, byMarks ? 0 : cores.share);
  const pieceAtCore = (c: { x: number; y: number }) => {
    const cx = Math.round(c.x / f - 0.5), cy = Math.round(c.y / f - 0.5); let best = -1, bd = Infinity;
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) { const xx = cx + dx, yy = cy + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const id = label[yy * w + xx]; if (id < 0) continue; const q = dx * dx + dy * dy; if (q < bd) { bd = q; best = id; } }
    return best >= 0 && bd <= reach * reach ? best : -1;
  };
  const info: CoresInfo = { reference: byMarks ? "marks" : "strongest", strongest: view.top, threshold: byMarks ? null : cores.share * view.top, kept: [] };
  let found = peaks;
  if (byMarks) {
    const pieceOfPeak = peaks.map(pieceAtCore), inPiece = new Map<number, number[]>(), on: number[] = [];
    peaks.forEach((c, k) => { const id = pieceOfPeak[k]; if (id >= 0 && pointsIn.has(id)) (inPiece.get(id) ?? inPiece.set(id, []).get(id)!).push(c.v); });
    for (const [id, vs] of inPiece) { vs.sort((p, q) => q - p); for (const v of vs.slice(0, pointsIn.get(id)!.length)) on.push(v); }
    on.sort((p, q) => p - q);
    info.onMarks = on.length; info.medianOnMarks = on.length ? on[on.length >> 1] : null; info.peakStrengths = Float32Array.from(peaks.map(c => c.v)).sort();
    info.threshold = info.medianOnMarks != null ? (cores.factor ?? 1) * info.medianOnMarks : null;
    found = info.threshold == null ? [] : peaks.filter(c => c.v >= info.threshold!);
  }
  const coresIn = new Map<number, number[]>();
  found.forEach((c, k) => {
    const cx = Math.round(c.x / f - 0.5), cy = Math.round(c.y / f - 0.5); let best = -1, bd = Infinity;
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) { const xx = cx + dx, yy = cy + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const id = label[yy * w + xx]; if (id < 0) continue; const q = dx * dx + dy * dy; if (q < bd) { bd = q; best = id; } }
    const inPiece = best >= 0 && bd <= reach * reach;
    info.kept.push({ x: c.x, y: c.y, v: c.v, where: !inPiece ? "none" : cover.has(best) ? "cover" : "piece" });
    if (inPiece && !cover.has(best)) (coresIn.get(best) ?? coresIn.set(best, []).get(best)!).push(k);
  });
  let coresAdded = 0;
  for (const [id, cs] of coresIn) {
    const ms = pointsIn.get(id) ?? []; if (cs.length <= ms.length) continue;
    const pairs: [number, number, number][] = []; for (const m of ms) for (const c of cs) pairs.push([Math.hypot(points[m].x - found[c].x, points[m].y - found[c].y), m, c]);
    pairs.sort((p, q) => p[0] - q[0]); const usedM = new Set<number>(), usedC = new Set<number>();
    for (const [, m, c] of pairs) { if (usedM.has(m) || usedC.has(c)) continue; usedM.add(m); usedC.add(c); }
    for (const c of cs) if (!usedC.has(c)) { points.push({ x: found[c].x, y: found[c].y }); coresAdded++; }
    if (points.length > o.maxPoints) break;
  }
  return { points, typicalPx: d * f, greenShare: green / (w * h || 1), workFactor: f, coresAdded, coresInfo: info };
}

export const ROW_POINTS = {
  /** Pieces smaller than this (photo pixels) are specks ... */
  minPiecePx: 30,
  /** ... and so are pieces under this share of the typical plant. */
  speckShare: 0.15,
  /** A piece over this share of the frame does not size the typical plant. */
  maxPlantShare: 0.002,
  /** Without a row direction, a piece up to this many typical plants is one point (as plantPointsFromGreen). */
  wholeUpTo: 4,
  coverFill: 0.35, coverPlants: 6,
  /** With a row direction: a piece longer ALONG THE ROW than this many plant spacings holds more than one plant, and
   * gets one point per spacing along the row. Its width across the row never splits it (a seedling's leaves spread
   * across the furrow). */
  splitFrom: 1.5,
  /** The plant spacing assumed in one photograph, metres (the field's own is only known once the photographs are
   * combined; corn is sown at 0.12 to 0.2). */
  seedM: 0.15,
  maxSplit: 8,
  maxPoints: 20000,
};

/**
 * Plant positions for the rows (2026-11-16), from a mask at the photo's own pixel (the lower bar, SEEDLING_ROW): the
 * pieces are found at full size, not on the mask shrunk three times, so two seedlings a couple of pixels apart stay two
 * (measured: 7 % more plants on the rows). One point per piece at its centre; a piece long along the row direction
 * (`rowAngle`, radians in the photo, null when the photograph made no row) is plants touching and gets a point per
 * plant spacing along the row. These are candidates for the field's rows only (plantsFirst.ts): never weeds, never rows
 * of their own in a photograph.
 * `defer` (off by default): with a row direction no piece is split here. Every piece is one point at its centre, and
 * `defer.span` receives, per point, how far the piece reaches along the row either way of that centre (pixels, back
 * and forward): the field splits the long ones at the plant spacing it measured (cornPlants.ts), not at `seedM`.
 */
export function rowPlantPoints(mask: Uint8Array, W: number, H: number, rowAngle: number | null, gsdM: number | null, o = ROW_POINTS, defer: { span: [number, number][] } | null = null): PlantPoint[] {
  const N = W * H, seen = new Uint8Array(N);
  type Piece = { a: number; cx: number; cy: number; x0: number; y0: number; x1: number; y1: number; start: number; tLo: number; tHi: number };
  const ux = rowAngle != null ? Math.cos(rowAngle) : 0, uy = rowAngle != null ? Math.sin(rowAngle) : 0, spans = !!defer && rowAngle != null;
  const pieces: Piece[] = [], stack: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!mask[i] || seen[i]) continue;
    let a = 0, sx = 0, sy = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, tLo = Infinity, tHi = -Infinity;
    seen[i] = 1; stack.push(i);
    while (stack.length) {
      const j = stack.pop()!, x = j % W, y = (j - x) / W;
      a++; sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (spans) { const t = x * ux + y * uy; if (t < tLo) tLo = t; if (t > tHi) tHi = t; }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const k = yy * W + xx; if (mask[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
    }
    if (a >= o.minPiecePx) pieces.push({ a, cx: sx / a, cy: sy / a, x0, y0, x1, y1, start: i, tLo, tHi });
  }
  // The typical plant: the area-weighted median piece (as plantPointsFromGreen; these frames are seedlings on soil).
  const sizing = pieces.filter(p => p.a <= o.maxPlantShare * N).sort((p, q) => p.a - q.a), total = sizing.reduce((t, p) => t + p.a, 0);
  let typical = o.minPiecePx;
  for (let acc = 0, i = 0; i < sizing.length; i++) { acc += sizing[i].a; if (acc >= total / 2) { typical = sizing[i].a; break; } }
  const d = Math.sqrt(typical), minPiece = Math.max(o.minPiecePx, typical * o.speckShare);
  const seedPx = gsdM && gsdM > 0 ? o.seedM / gsdM : 2 * d;
  const points: PlantPoint[] = [];
  /** A piece's own pixels again (its bounding box holds other pieces too: only those connected to its first pixel). */
  const pixelsOf = (p: Piece, fn: (x: number, y: number) => void) => {
    const bw = p.x1 - p.x0 + 1, bh = p.y1 - p.y0 + 1, vis = new Uint8Array(bw * bh), st: number[] = [p.start];
    vis[((p.start - (p.start % W)) / W - p.y0) * bw + ((p.start % W) - p.x0)] = 1;
    while (st.length) {
      const j = st.pop()!, x = j % W, y = (j - x) / W; fn(x, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < p.x0 || yy < p.y0 || xx > p.x1 || yy > p.y1) continue;
        const k = yy * W + xx, v = (yy - p.y0) * bw + (xx - p.x0); if (mask[k] && !vis[v]) { vis[v] = 1; st.push(k); }
      }
    }
  };
  for (const p of pieces) {
    if (p.a < minPiece) continue;
    const bw = p.x1 - p.x0 + 1, bh = p.y1 - p.y0 + 1;
    // Cover (a lawn, a canopy): no points, as in plantPointsFromGreen.
    if (p.a > o.wholeUpTo * typical && p.a / (bw * bh) > o.coverFill && Math.min(bw, bh) > o.coverPlants * d) continue;
    if (spans) { const tc = p.cx * ux + p.cy * uy; points.push({ x: p.cx + 0.5, y: p.cy + 0.5 }); defer!.span.push([p.tLo - tc - 0.5, p.tHi - tc + 0.5]); continue; }
    const px: number[] = [], py: number[] = [];
    let ax = ux, ay = uy;
    if (rowAngle == null) {
      // No row in this photograph: a piece up to a few plants is one point; a larger one is cut along its own length
      // (as plantPointsFromGreen does).
      if (p.a <= o.wholeUpTo * typical) { points.push({ x: p.cx + 0.5, y: p.cy + 0.5 }); continue; }
      let cxx = 0, cyy = 0, cxy = 0;
      pixelsOf(p, (x, y) => { cxx += (x - p.cx) ** 2; cyy += (y - p.cy) ** 2; cxy += (x - p.cx) * (y - p.cy); px.push(x); py.push(y); });
      const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy); ax = Math.cos(th); ay = Math.sin(th);
    } else {
      // Its length along the row: bounded by the box first (cheap), measured only when that could reach the split.
      if (Math.abs(bw * ux) + Math.abs(bh * uy) <= o.splitFrom * seedPx) { points.push({ x: p.cx + 0.5, y: p.cy + 0.5 }); continue; }
      pixelsOf(p, (x, y) => { px.push(x); py.push(y); });
    }
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < px.length; i++) { const t = px[i] * ax + py[i] * ay; if (t < lo) lo = t; if (t > hi) hi = t; }
    const along = hi - lo + 1;
    if (along <= o.splitFrom * seedPx) { points.push({ x: p.cx + 0.5, y: p.cy + 0.5 }); continue; }
    const k = Math.min(o.maxSplit, Math.max(2, Math.round(along / seedPx))), n = new Float64Array(k), bx = new Float64Array(k), by = new Float64Array(k);
    for (let i = 0; i < px.length; i++) { const b = Math.min(k - 1, Math.floor(((px[i] * ax + py[i] * ay - lo) / along) * k)); n[b]++; bx[b] += px[i]; by[b] += py[i]; }
    for (let b = 0; b < k; b++) if (n[b] >= minPiece / 2) points.push({ x: bx[b] / n[b] + 0.5, y: by[b] / n[b] + 0.5 });
    if (points.length > o.maxPoints) break;
  }
  return points;
}
