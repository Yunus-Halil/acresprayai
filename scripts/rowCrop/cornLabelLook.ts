// Development only, read-only. Two measurements beside the hand-label score (cornLabelScore.ts):
//
//   lookReport   "does corn have a look?" (--look, a stored flight): for every dot of the dev tiles, what the photograph's
//                own read measures of the green piece under it (size, strength of green, brightness over the soil, length
//                and shape) and how many photographs saw it, each as a ratio to the median of the certain plants; per
//                group of dots the quartiles, and the one cut that best tells the labelled plants from the rest.
//   touchReport  touching plants (--single --touch, one photograph): the labelled plants not found that lie in a green
//                piece which already holds a found plant, those pieces' length along the row against the distance
//                between the photograph's own marks on a row, and the score if every piece longer than 1.5 times that
//                distance were cut into equal parts. Nothing is cut in the read: the cut is made here, on the marks.
//
// The green and the pieces are the read's own: seedlingGreen.ts for the mask (the same rules, the same soil levels),
// greenPoints.ts's way of finding pieces (8-connected). Nothing here changes a rule.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { GREEN_POINTS } from "../../src/lib/rowCrop/greenPoints";
import { convexHull } from "../../src/lib/rowCrop/readRowCrop";
import { SEEDLING_GREEN, SEEDLING_ROW, SEEDLING_V1, type SoilLevels, seedlingMask, soilLevels } from "../../src/lib/rowCrop/seedlingGreen";

export type LTile = { id: string; x: number; y: number; w: number; h: number };
export type LLabel = { x: number; y: number; type: "plant" | "unsure" };
export type LMark = { u: number; v: number; e: number; n: number; tier: number; i?: number };
export type LJudged = { ms: LMark[]; state: Int8Array; plantFound: boolean[]; plantOf: Int32Array; pad: number; score: { tile: string; labelled: number; unsure: number; marks: number[]; found: number[]; wrong: number[]; wrongSecond: number[]; wrongNothing: number[]; onUnsure: number[]; atEdge: number[]; missed: number } };
type Judge = (t: LTile, marks: LMark[], place: (u: number, v: number) => [number, number] | null, R: number) => LJudged;
const med = (xs: number[]) => { const t = xs.filter(Number.isFinite).sort((x, y) => x - y); return t.length ? t[t.length >> 1] : NaN; };
const qt = (xs: number[], f: number) => { const t = xs.filter(Number.isFinite).sort((x, y) => x - y); return t.length ? t[Math.min(t.length - 1, Math.floor(f * t.length))] : NaN; };

/** 8-connected pieces of a mask (1 = green), as greenPoints.ts finds them. */
export function piecesOf(mask: Uint8Array, w: number, h: number): { label: Int32Array; area: number[] } {
  const label = new Int32Array(w * h).fill(-1), stack = new Int32Array(w * h), area: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i] >= 0) continue;
    const id = area.length; let top = 0, a = 0; stack[top++] = i; label[i] = id;
    while (top) {
      const j = stack[--top], x = j % w, y = (j - x) / w; a++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const k = yy * w + xx; if (mask[k] && label[k] < 0) { label[k] = id; stack[top++] = k; } }
    }
    area.push(a);
  }
  return { label, area };
}
/** The piece at a place, or the nearest one within `tol` pixels (a mark sits at the middle of its green, which a spread seedling leaves bare); -1: none. */
export function pieceAt(label: Int32Array, w: number, h: number, x: number, y: number, tol: number): number {
  const cx = Math.round(x), cy = Math.round(y); let best = -1, bd = Infinity;
  for (let dy = -tol; dy <= tol; dy++) for (let dx = -tol; dx <= tol; dx++) { const xx = cx + dx, yy = cy + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const id = label[yy * w + xx]; if (id < 0) continue; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = id; } }
  return bd <= tol * tol ? best : -1;
}
/** Marks in rows: the rows' direction from each mark to its nearest other one (angles doubled), a new row where the next mark stands further across than a share of the median nearest distance; the distances between neighbours on a row. */
export function rowsOfPoints(pts: { x: number; y: number }[]): { th: number; gaps: number[]; rows: number } {
  let c2 = 0, s2 = 0; const nn: number[] = [];
  // Nearest neighbours by a coarse grid.
  const cell = 200, grid = new Map<number, number[]>(), key = (i: number, j: number) => i * 100003 + j;
  pts.forEach((p, k) => { const kk = key(Math.floor(p.x / cell), Math.floor(p.y / cell)); (grid.get(kk) ?? grid.set(kk, []).get(kk)!).push(k); });
  pts.forEach((p, k) => { let bd = Infinity, bx = 0, by = 0; for (let i = Math.floor(p.x / cell) - 2; i <= Math.floor(p.x / cell) + 2; i++) for (let j = Math.floor(p.y / cell) - 2; j <= Math.floor(p.y / cell) + 2; j++) for (const o of grid.get(key(i, j)) ?? []) { if (o === k) continue; const d = Math.hypot(pts[o].x - p.x, pts[o].y - p.y); if (d < bd) { bd = d; bx = pts[o].x - p.x; by = pts[o].y - p.y; } } if (bd < Infinity) { nn.push(bd); const a2 = 2 * Math.atan2(by, bx); c2 += Math.cos(a2); s2 += Math.sin(a2); } });
  const th = Math.atan2(s2, c2) / 2, ct = Math.cos(th), st = Math.sin(th), cut = Math.max(20, 0.3 * med(nn));
  const ls = pts.map(p => ({ a: p.x * ct + p.y * st, c: -p.x * st + p.y * ct })).sort((x, y) => x.c - y.c);
  const rows: (typeof ls)[] = []; ls.forEach((l, k) => { if (!k || l.c - ls[k - 1].c > cut) rows.push([]); rows[rows.length - 1].push(l); });
  const gaps: number[] = []; for (const r of rows) { r.sort((x, y) => x.a - y.a); for (let k = 1; k < r.length; k++) gaps.push(Math.hypot(r[k].a - r[k - 1].a, r[k].c - r[k - 1].c)); }
  return { th, gaps, rows: rows.length };
}

// ---------------------------------------------------------------------------------------------------------- touching
export type TouchCtx = { out: string; px: PhotoPixels; darkApplied: boolean; marks: [number, number][]; tiles: LTile[]; labels: Map<string, LLabel[]>; judge: Judge; R: number; within: (t: LTile, u: number, v: number, pad?: number) => boolean };
export function touchReport(X: TouchCtx) {
  const { px, tiles, R } = X, W = px.width, H = px.height, o = GREEN_POINTS;
  // The plant read's own mask and pieces (greenPoints.ts:66-92): the mask at the photograph's pixel, shrunk f times, 8-connected.
  const full = seedlingMask(px, X.darkApplied ? SEEDLING_GREEN : SEEDLING_V1, soilLevels(px, SEEDLING_GREEN));
  const f = Math.max(1, Math.round(Math.max(W, H) / o.workLongSide)), w = Math.floor(W / f), h = Math.floor(H / f), mask = new Uint8Array(w * h), need = Math.max(1, Math.ceil(f * f * o.shrinkShare));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let c = 0; for (let yy = 0; yy < f; yy++) { const row = (y * f + yy) * W + x * f; for (let xx = 0; xx < f; xx++) c += full[row + xx]; } if (c >= need) mask[y * w + x] = 1; }
  const { label, area } = piecesOf(mask, w, h);
  const at = (x: number, y: number, tolPhoto: number) => pieceAt(label, w, h, x / f - 0.5, y / f - 0.5, Math.max(0, Math.round(tolPhoto / f)));
  // The photograph's own marks on a row: the distance between neighbours.
  const mk = X.marks.map(([x, y]) => ({ x, y })), MR = rowsOfPoints(mk), D = med(MR.gaps), ux = Math.cos(MR.th), uy = Math.sin(MR.th);
  const gs = [...MR.gaps].sort((a, b) => a - b);
  // Each piece's reach along the rows (photograph pixels), and the marks in it.
  const lo = new Float64Array(area.length).fill(Infinity), hi = new Float64Array(area.length).fill(-Infinity);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const id = label[y * w + x]; if (id < 0) continue; const t = ((x + 0.5) * ux + (y + 0.5) * uy) * f; if (t < lo[id]) lo[id] = t; if (t > hi[id]) hi[id] = t; }
  const lenOf = (id: number) => hi[id] - lo[id] + f;
  const TOL_MARK = 12, TOL_LABEL = 6;
  const markPiece = mk.map(m => at(m.x, m.y, TOL_MARK)), marksIn = new Map<number, number[]>(); markPiece.forEach((id, k) => { if (id >= 0) (marksIn.get(id) ?? marksIn.set(id, []).get(id)!).push(k); });
  const asMarks = (pts: { x: number; y: number }[]): LMark[] => pts.map(p => ({ u: p.x, v: p.y, e: p.x, n: p.y, tier: 0 }));
  const ident = (u: number, v: number): [number, number] => [u, v];
  // As the read stands: per dev tile, the plants not found and the piece each lies in.
  const before = tiles.map(t => X.judge(t, asMarks(mk), ident, R));
  const perTile: Record<string, unknown>[] = [], piecesWithMissed = new Map<number, { tile: string; found: number; missed: number }>();
  let missedAll = 0, missedInAPiece = 0, missedInAPieceExact = 0, missedWithFound = 0, missedPieceHasAMark = 0;
  tiles.forEach((t, ti) => {
    const J = before[ti], plants = X.labels.get(t.id)!.filter(l => l.type === "plant"), pieceOfPlant = plants.map(p => at(p.x, p.y, TOL_LABEL));
    const foundIn = new Map<number, number>(); plants.forEach((_, i) => { if (J.plantFound[i] && pieceOfPlant[i] >= 0) foundIn.set(pieceOfPlant[i], (foundIn.get(pieceOfPlant[i]) ?? 0) + 1); });
    let m = 0, inP = 0, exact = 0, withFound = 0, hasMark = 0;
    plants.forEach((p, i) => {
      if (J.plantFound[i]) return; m++;
      const id = pieceOfPlant[i]; if (id < 0) return; inP++;
      if (at(p.x, p.y, 0) >= 0) exact++;
      if ((marksIn.get(id)?.length ?? 0) > 0) hasMark++;
      if (foundIn.has(id)) { withFound++; const r = piecesWithMissed.get(id) ?? { tile: t.id, found: foundIn.get(id)!, missed: 0 }; r.missed++; piecesWithMissed.set(id, r); }
    });
    missedAll += m; missedInAPiece += inP; missedInAPieceExact += exact; missedWithFound += withFound; missedPieceHasAMark += hasMark;
    perTile.push({ tile: t.id, labelled: plants.length, notFound: m, notFoundInAGreenPiece: inP, ofThemInAPieceThatHoldsAFoundPlant: withFound, ofThemInAPieceThatHoldsAMark: hasMark });
  });
  const pieces = [...piecesWithMissed.entries()].map(([id, r]) => ({ piece: id, tile: r.tile, plantsFound: r.found, plantsNotFound: r.missed, plantsLabelled: r.found + r.missed, marks: marksIn.get(id)?.length ?? 0, lengthPx: Math.round(lenOf(id)), lengthOverD: Math.round((lenOf(id) / D) * 100) / 100, areaWorkPx: area[id] }));
  // The cut, made here on the marks: every piece that holds a mark and is longer along the rows than 1.5 D gives up its
  // marks and gets one in each of k equal parts along the rows (k = its length over D, rounded, at least 2), at the middle of the green in that part.
  const cutIds = [...marksIn.keys()].filter(id => lenOf(id) > 1.5 * D), cutSet = new Set(cutIds), kOf = new Map(cutIds.map(id => [id, Math.max(2, Math.round(lenOf(id) / D))]));
  const acc = new Map<number, Float64Array>(); for (const id of cutIds) acc.set(id, new Float64Array(3 * kOf.get(id)!));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const id = label[y * w + x]; if (id < 0 || !cutSet.has(id)) continue; const k = kOf.get(id)!, t = ((x + 0.5) * ux + (y + 0.5) * uy) * f, b = Math.min(k - 1, Math.floor(((t - lo[id]) / (hi[id] - lo[id] + 1e-9)) * k)), a = acc.get(id)!; a[3 * b]++; a[3 * b + 1] += (x + 0.5) * f; a[3 * b + 2] += (y + 0.5) * f; }
  const cutMarks: { x: number; y: number }[] = mk.filter((_, k) => !cutSet.has(markPiece[k]));
  let added = 0, removed = mk.length - cutMarks.length;
  for (const id of cutIds) { const a = acc.get(id)!, k = kOf.get(id)!; for (let b = 0; b < k; b++) if (a[3 * b] > 0) { cutMarks.push({ x: a[3 * b + 1] / a[3 * b], y: a[3 * b + 2] / a[3 * b] }); added++; } }
  const after = tiles.map(t => X.judge(t, asMarks(cutMarks), ident, R));
  const row = (J: LJudged) => ({ tile: J.score.tile, labelled: J.score.labelled, found: J.score.found[0], notFound: J.score.missed, marks: J.score.marks[0], wrong: J.score.wrong[0], wrongSecond: J.score.wrongSecond[0], wrongNothing: J.score.wrongNothing[0], atEdge: J.score.atEdge[0], countError: J.score.marks[0] - J.score.onUnsure[0] - J.score.labelled });
  const out = {
    mask: X.darkApplied ? "the stricter mask with the dark-leaf rule" : "the earlier mask, without the dark-leaf rule (what the plant read used on this photograph)", workFactor: f, pieces: area.length, marks: mk.length, marksInAPiece: markPiece.filter(id => id >= 0).length, toleranceMarkPx: TOL_MARK, toleranceLabelPx: TOL_LABEL, matchPx: R,
    marksOnARow: { rowsOfMarks: MR.rows, pairs: MR.gaps.length, lowQuarterPx: gs[gs.length >> 2], medianPx: D, highQuarterPx: gs[(3 * gs.length) >> 2], directionDeg: (MR.th * 180) / Math.PI },
    notFound: { all: missedAll, inAGreenPiece: missedInAPiece, ofThemWithTheLabelOnGreenItself: missedInAPieceExact, inAPieceThatHoldsAFoundPlant: missedWithFound, inAPieceThatHoldsAMark: missedPieceHasAMark }, perTile, piecesWithAFoundAndANotFoundPlant: pieces,
    cut: { longerThanPx: 1.5 * D, piecesCut: cutIds.length, marksTakenOut: removed, marksPutIn: added, marksAfter: cutMarks.length, parts: Object.fromEntries([...new Set(kOf.values())].sort((a, b) => a - b).map(k => [k, [...kOf.values()].filter(x => x === k).length])) },
    before: before.map(row), after: after.map(row),
  };
  writeFileSync(join(X.out, "touch.json"), JSON.stringify(out, null, 1));
  const tot = (rs: ReturnType<typeof row>[]) => rs.reduce((a, r) => ({ found: a.found + r.found, wrong: a.wrong + r.wrong, err: a.err + r.countError }), { found: 0, wrong: 0, err: 0 });
  console.log(`Touching plants: ${area.length} pieces, ${mk.length} marks (${out.marksInAPiece} in a piece); marks on a row ${MR.gaps.length} pairs, median ${D.toFixed(1)} px. Not found ${missedAll}: in a green piece ${missedInAPiece}, in a piece that holds a found plant ${missedWithFound}. Cut: ${cutIds.length} pieces longer than ${(1.5 * D).toFixed(1)} px, ${removed} marks out, ${added} in. Before ${JSON.stringify(tot(out.before))}, after ${JSON.stringify(tot(out.after))}.`);
  return { cutMarks: asMarks(cutMarks) };
}

// -------------------------------------------------------------------------------------------------------------- look
export type LookCtx = {
  out: string; px: PhotoPixels; tiles: LTile[]; labels: Map<string, LLabel[]>; judge: Judge; R: number; marks: LMark[]; noRow: LMark[];
  place: (u: number, v: number) => [number, number] | null; pixelOf: (e: number, n: number) => [number, number, boolean] | null; within: (t: LTile, u: number, v: number, pad?: number) => boolean;
  /** Per dot of the flight: photographs that saw it and that looked; the rows' direction on the ground (unit vector east, north). */
  photos: (i: number) => number; looked: (i: number) => number; alongEN: [number, number];
};
export function lookReport(X: LookCtx) {
  const { px, tiles } = X, W = px.width, H = px.height, d = px.rgba;
  // The green as the read judges it: the soil levels (seedlingGreen.ts:113), the lower bar's mask (SEEDLING_ROW) at the
  // photograph's own pixel, and the stricter bar's beside it.
  const lv: SoilLevels = soilLevels(px, SEEDLING_GREEN), low = seedlingMask(px, SEEDLING_ROW, lv), strict = seedlingMask(px, SEEDLING_GREEN, lv);
  const { label, area } = piecesOf(low, W, H), dark = SEEDLING_GREEN.dark!;
  const TOL = 8;
  type Dot = { i: number; u: number; v: number; e: number; n: number; group: number; certain: boolean; piece: number };
  const dots: Dot[] = []; const left = { onUnsure: 0, atEdge: 0 };
  // The groups: 1 a first mark on a labelled plant, 2 a second mark on one, 3 a mark on nothing (planted tiles), 4 a dot on a tile with no labelled plant (on a row or not).
  for (const t of tiles) {
    const J = X.judge(t, X.marks, X.place, X.R), planted = J.score.labelled > 0;
    const plants = X.labels.get(t.id)!.filter(l => l.type === "plant").map(l => X.place(l.x, l.y)!);
    J.ms.forEach((k, j) => {
      if (!X.within(t, k.u, k.v)) return;
      const st = J.state[j]; let g = 0;
      if (!planted) g = 4; else if (st === 1) g = 1; else if (st === 0) g = plants.some(p => Math.hypot(p[0] - k.e, p[1] - k.n) <= X.R) ? 2 : 3; else { if (st === 2) left.onUnsure++; else left.atEdge++; }
      dots.push({ i: k.i!, u: k.u, v: k.v, e: k.e, n: k.n, group: g, certain: k.tier === 0, piece: -1 });
    });
    if (!planted) for (const k of X.noRow) if (X.within(t, k.u, k.v)) dots.push({ i: k.i!, u: k.u, v: k.v, e: k.e, n: k.n, group: 4, certain: false, piece: -1 });
  }
  for (const k of dots) k.piece = pieceAt(label, W, H, k.u, k.v, TOL);
  // Each piece's measures, once: only the pieces under a dot.
  const want = new Set(dots.map(k => k.piece).filter(id => id >= 0));
  type Acc = { n: number; tint: number; bright: number; strictN: number; x0: number; y0: number; x1: number; y1: number; edge: [number, number][]; per: number };
  const acc = new Map<number, Acc>(); for (const id of want) acc.set(id, { n: 0, tint: 0, bright: 0, strictN: 0, x0: W, y0: H, x1: 0, y1: 0, edge: [], per: 0 });
  for (let y = 0; y < H; y++) { const row = Math.floor(y / lv.B) * lv.gw; for (let x = 0; x < W; x++) {
    const i = y * W + x, id = label[i]; if (id < 0) continue; const a = acc.get(id); if (!a) continue;
    const q = i * 4, r = d[q], g = d[q + 1], b = d[q + 2], c = row + Math.floor(x / lv.B), sL = lv.soilL[c], sT = lv.soilT[c];
    const t = g - (r + b) / 2, L = 0.3 * r + 0.59 * g + 0.11 * b, dt = t - sT, dl = L - sL;
    // The tint over the soil's as the rule reads it: for a pixel darker than its soil, also at the soil's brightness (seedlingGreen.ts:163-164).
    const s = dl < 0 && L > dark.minL ? Math.max(dt, t * Math.min(dark.maxGain, sL / L) - sT) : dt;
    a.n++; a.tint += s; a.bright += dl; if (strict[i]) a.strictN++;
    if (x < a.x0) a.x0 = x; if (x > a.x1) a.x1 = x; if (y < a.y0) a.y0 = y; if (y > a.y1) a.y1 = y;
    const out = (xx: number, yy: number) => xx < 0 || yy < 0 || xx >= W || yy >= H || label[yy * W + xx] !== id;
    if (out(x - 1, y) || out(x + 1, y) || out(x, y - 1) || out(x, y + 1)) { a.per++; a.edge.push([x, y]); }
  } }
  const MEASURES = ["size of the green piece (pixels)", "strength of green (tint over the soil's, mean over the piece)", "brightness over the soil (mean over the piece)", "length along the row (pixels)", "width across the row (pixels)", "length over width", "how much of its outline's hull the piece fills", "leaf width (twice the area over the outline's length, pixels)", "share of the piece the stricter bar also holds", "photographs that saw it", "share of the photographs that looked which saw it"] as const;
  const dotsOnPiece = new Map<number, number>(); for (const k of dots) if (k.piece >= 0 && k.group !== 4) dotsOnPiece.set(k.piece, (dotsOnPiece.get(k.piece) ?? 0) + 1);
  const valuesOf = (k: Dot): number[] => {
    const ph = X.photos(k.i), lk = X.looked(k.i), a = k.piece >= 0 ? acc.get(k.piece)! : null;
    if (!a) return [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, ph, lk ? ph / lk : NaN];
    // The rows' direction in the photograph at this dot.
    const p1 = X.pixelOf(k.e + 0.3 * X.alongEN[0], k.n + 0.3 * X.alongEN[1]); let ux = 0, uy = 1; if (p1) { const L = Math.hypot(p1[0] - k.u, p1[1] - k.v) || 1; ux = (p1[0] - k.u) / L; uy = (p1[1] - k.v) / L; }
    let lo = Infinity, hi = -Infinity, cl = Infinity, ch = -Infinity; for (const [x, y] of a.edge) { const t = x * ux + y * uy, c = -x * uy + y * ux; if (t < lo) lo = t; if (t > hi) hi = t; if (c < cl) cl = c; if (c > ch) ch = c; }
    const len = hi - lo + 1, wid = ch - cl + 1;
    let hull = NaN; if (a.edge.length >= 3) { const hl = convexHull(a.edge); let ha = 0, hp = 0; for (let i = 0; i < hl.length; i++) { const [ax, ay] = hl[i], [bx, by] = hl[(i + 1) % hl.length]; ha += ax * by - bx * ay; hp += Math.hypot(bx - ax, by - ay); } hull = Math.min(1, a.n / (Math.abs(ha) / 2 + hp / 2 + 1)); }
    return [a.n, a.tint / a.n, a.bright / a.n, len, wid, len / wid, hull, (2 * a.n) / Math.max(1, a.per), a.strictN / a.n, ph, lk ? ph / lk : NaN];
  };
  const vals = dots.map(valuesOf), G = [1, 2, 3, 4].map(g => dots.map((k, j) => (k.group === g ? j : -1)).filter(j => j >= 0));
  const cert = dots.map((k, j) => (k.certain ? j : -1)).filter(j => j >= 0);
  const GN = ["first marks on a labelled plant", "second marks on a labelled plant", "marks on nothing, planted tiles", "dots on the headland tiles"];
  const measures = MEASURES.map((name, m) => {
    const ref = med(cert.map(j => vals[j][m])), ratio = (j: number) => vals[j][m] / ref;
    const groups = G.map((g, gi) => { const r = g.map(ratio); return { group: GN[gi], dots: g.length, measured: r.filter(Number.isFinite).length, lowQuarter: qt(r, 0.25), median: qt(r, 0.5), highQuarter: qt(r, 0.75) }; });
    // The one cut that best tells the plants from the other three groups: the plants' share passing less the mean of the
    // other three groups' shares passing (each group weighing the same); a dot with no measure does not pass.
    const all = [...new Set(G.flat().map(ratio).filter(Number.isFinite))].sort((a, b) => a - b);
    let best = { score: -Infinity, at: NaN, atLeast: true, pass: [0, 0, 0, 0] };
    for (const atLeast of [true, false]) for (const c of all) {
      const pass = G.map(g => g.filter(j => { const r = ratio(j); return Number.isFinite(r) && (atLeast ? r >= c : r <= c); }).length);
      const sc = pass[0] / Math.max(1, G[0].length) - (pass[1] / Math.max(1, G[1].length) + pass[2] / Math.max(1, G[2].length) + pass[3] / Math.max(1, G[3].length)) / 3;
      if (sc > best.score) best = { score: sc, at: c, atLeast, pass };
    }
    return { measure: name, medianOfTheCertainPlants: ref, groups, cut: { ratio: best.at, pass: best.atLeast ? "at or over" : "at or under", plants: best.pass[0], secondMarks: best.pass[1], onNothing: best.pass[2], headland: best.pass[3], plantsShareLessTheOthersMeanShare: best.score } };
  });
  const noPiece = G.map(g => g.filter(j => dots[j].piece < 0).length), shared = G.map(g => g.filter(j => dots[j].piece >= 0 && (dotsOnPiece.get(dots[j].piece) ?? 0) > 1).length);
  const out = { tolerancePx: TOL, pieces: area.length, certainPlantsMeasured: cert.length, certainWithAPiece: cert.filter(j => dots[j].piece >= 0).length, groups: GN.map((n, gi) => ({ group: n, dots: G[gi].length, noGreenPieceWithinTolerance: noPiece[gi], onAPieceWithAnotherMark: shared[gi] })), leftOut: left, measures };
  writeFileSync(join(X.out, "look.json"), JSON.stringify(out, null, 1));
  console.log(`Look: ${dots.length} dots (${G.map((g, gi) => `${GN[gi]} ${g.length}`).join("; ")}); certain plants measured ${cert.length}; left out ${JSON.stringify(left)}.`);
  for (const m of measures) console.log(`  ${m.measure}: cut ${m.cut.pass} ${m.cut.ratio.toFixed(2)} x the certain plants' median: plants ${m.cut.plants}/${G[0].length}, second ${m.cut.secondMarks}/${G[1].length}, nothing ${m.cut.onNothing}/${G[2].length}, headland ${m.cut.headland}/${G[3].length}`);
}
