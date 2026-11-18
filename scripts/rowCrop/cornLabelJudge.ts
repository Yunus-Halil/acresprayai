// Development only: scoring a photograph's marks against hand labels (2026-11-17, moved here 2026-11-18 so the corn
// inspector and cornLabelScore.ts run the same code). Used by scripts/rowCrop/cornLabelScore.ts (SCORE.md onwards)
// and scripts/rowCrop/cornInspect.ts (the inspector's score job).
//
//   labelTiles   the 4 x 4 chessboard over a photograph: the dev tiles (r + c even, top-left dev), or the held-back ones
//   judgeTile    one tile: labels matched to marks one to one within R metres on the ground (augmenting paths, nearest
//                first), unsure labels after; every mark in the tile is found, on an unsure label, left over at the edge
//                (not judged) or wrong (a second mark on a labelled plant, or a mark on nothing)
//   fieldMarks   the field's final dots brought into one photograph (its camera and registration shift, kept only where
//                the pixel looks back at the dot within LOOKS_BACK_M), by tier
import { groundToPixel, pixelToGround, type GeorefFrame } from "../../src/lib/directGeoref/projection";
import type { CornFieldResult } from "../../src/lib/fieldTwin/cornField";
import type { PlacedDots } from "../../src/lib/fieldTwin/cornPlants";
import { type Reconstruction, shiftOf } from "../../src/lib/fieldTwin/plantsFirst";
import { fromEnu, toEnu } from "../../src/lib/sourceFrames/odm";

export type Tile = { id: string; x: number; y: number; w: number; h: number };
export type Label = { x: number; y: number; type: "plant" | "unsure" };
export type Mark = { u: number; v: number; e: number; n: number; tier: number; /** The field dot it is. */ i?: number };
export type Score = { tile: string; labelled: number; unsure: number; marks: number[]; found: number[]; wrong: number[]; /** The wrong marks, split: a second mark on a labelled plant of the tile (within the matching distance of one), and a mark on nothing. */ wrongSecond: number[]; wrongNothing: number[]; onUnsure: number[]; atEdge: number[]; missed: number };
export type Judged = { score: Score; ms: Mark[]; state: Int8Array; plantFound: boolean[]; /** Per labelled plant: the mark it has (index into `ms`), or -1. */ plantOf: Int32Array; pad: number };
// The last two: a dot on its row only because the plant spacing was not asked of it (SEQUENCE.placeOffSpacing), by where it came from.
export const TIERS = ["certain", "probable", "second look, 2+ photographs", "second look, 1 photograph", "by the option: a dot of the stricter marks", "by the option: a second-look dot"] as const;
export const LOOKS_BACK_M = 0.05;

/** The tiles of a GRID x GRID chessboard over `area`: dev where r + c is even, held back where it is odd. */
export function labelTiles(area: { x: number; y: number; w: number; h: number }, grid: number, hidden: boolean): Tile[] {
  const edge = (o: number, len: number, k: number) => Math.round(o + (len * k) / grid), out: Tile[] = [];
  for (let r = 0; r < grid; r++) for (let c = 0; c < grid; c++) if ((r + c) % 2 === (hidden ? 1 : 0)) { const x = edge(area.x, area.w, c), y = edge(area.y, area.h, r); out.push({ id: `r${r + 1}c${c + 1}`, x, y, w: edge(area.x, area.w, c + 1) - x, h: edge(area.y, area.h, r + 1) - y }); }
  return out;
}
export const within = (t: Tile, u: number, v: number, pad = 0) => u >= t.x - pad && u < t.x + t.w + pad && v >= t.y - pad && v < t.y + t.h + pad;

/** One tile judged: `marks` in the photograph with their place on the ground, `place` a pixel's place on the same ground, `R` metres, `labels` the tile's own. */
export function judgeTile(t: Tile, marks: Mark[], place: (u: number, v: number) => [number, number] | null, R: number, labels: Label[]): Judged {
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2, g0 = place(cx, cy), g1 = place(cx + 100, cy), g2 = place(cx, cy + 100);
  if (!g0 || !g1 || !g2) throw new Error(`${t.id}: the photograph's camera does not reach the ground there`);
  const pad = (R * 100) / ((Math.hypot(g1[0] - g0[0], g1[1] - g0[1]) + Math.hypot(g2[0] - g0[0], g2[1] - g0[1])) / 2);
  const labs = labels.map(p => { const g = place(p.x, p.y); if (!g) throw new Error(`${t.id}: a label the camera does not put on the ground`); return { ...p, e: g[0], n: g[1] }; });
  const plants = labs.filter(l => l.type === "plant"), unsure = labs.filter(l => l.type === "unsure"), ms = marks.filter(k => within(t, k.u, k.v, pad)), msIn = ms.map(k => within(t, k.u, k.v));
  const near = (l: { e: number; n: number }[]) => l.map(a => ms.map((k, j) => [Math.hypot(k.e - a.e, k.n - a.n), j] as [number, number]).filter(x => x[0] <= R).sort((x, y) => x[0] - y[0]));
  // taken[j]: the label that has mark j, -1 free, -2 not to be had.
  const match = (cand: [number, number][][], taken: Int32Array) => {
    const of = new Int32Array(cand.length).fill(-1), order = cand.map((c, i) => [c.length ? c[0][0] : Infinity, i] as [number, number]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
    const tryL = (i: number, seen: Set<number>): boolean => { for (const [, j] of cand[i]) { if (taken[j] === -2 || seen.has(j)) continue; seen.add(j); if (taken[j] < 0 || tryL(taken[j], seen)) { taken[j] = i; of[i] = j; return true; } } return false; };
    for (const i of order) tryL(i, new Set());
    // A label an augmenting path moved to another mark: read back from the marks.
    of.fill(-1); taken.forEach((i, j) => { if (i >= 0) of[i] = j; });
    return of;
  };
  const takenP = new Int32Array(ms.length).fill(-1), plantOf = match(near(plants), takenP);
  const takenU = Int32Array.from(takenP, x => (x >= 0 ? -2 : -1)); match(near(unsure), takenU);
  const s: Score = { tile: t.id, labelled: plants.length, unsure: unsure.length, marks: [0, 0, 0, 0, 0, 0], found: [0, 0, 0, 0, 0, 0], wrong: [0, 0, 0, 0, 0, 0], wrongSecond: [0, 0, 0, 0, 0, 0], wrongNothing: [0, 0, 0, 0, 0, 0], onUnsure: [0, 0, 0, 0, 0, 0], atEdge: [0, 0, 0, 0, 0, 0], missed: 0 };
  // 1 on a labelled plant, 2 on an unsure label, 3 left over at the tile's edge (not judged), 0 left over (wrong), 4 outside the tile and left over (not this tile's).
  const state = new Int8Array(ms.length);
  ms.forEach((k, j) => {
    const nearEdge = k.u < t.x + pad || k.u >= t.x + t.w - pad || k.v < t.y + pad || k.v >= t.y + t.h - pad;
    state[j] = takenP[j] >= 0 ? 1 : takenU[j] >= 0 ? 2 : !msIn[j] ? 4 : nearEdge ? 3 : 0;
    if (!msIn[j]) return;
    s.marks[k.tier]++; if (state[j] === 0) { s.wrong[k.tier]++; (plants.some(pl => Math.hypot(pl.e - k.e, pl.n - k.n) <= R) ? s.wrongSecond : s.wrongNothing)[k.tier]++; } else if (state[j] === 2) s.onUnsure[k.tier]++; else if (state[j] === 3) s.atEdge[k.tier]++;
  });
  const plantFound = plants.map((_, i) => plantOf[i] >= 0);
  plants.forEach((_, i) => { if (plantOf[i] >= 0) s.found[ms[plantOf[i]].tier]++; else s.missed++; });
  return { score: s, ms, state, plantFound, plantOf, pad };
}

/** The field's final dots in one photograph (photograph `pi` of P.photos, camera `f`), by tier; the dots on no row of the stricter marks beside them. */
export function fieldMarks(P: PlacedDots, rec: Reconstruction, F: CornFieldResult, f: GeorefFrame, pi: number) {
  const n = P.all.length, W = f.intrinsics.width, H = f.intrinsics.height, altM = (f.ground as { altM: number }).altM ?? 0;
  // -1 on no row; else the tier, as cornScoreboard.ts counts it.
  const tierOf = (i: number) => (rec.rowOf[i] < 0 ? -1 : rec.offSpacing[i] ? (i < P.strict ? 4 : 5) : P.tier?.[i] === 1 ? 2 : P.tier?.[i] === 2 ? 3 : rec.certainty[i] === 0 ? 0 : 1);
  const whole = [0, 0, 0, 0, 0, 0]; let onNoRow = 0; for (let i = 0; i < n; i++) { const t = tierOf(i); if (t >= 0) whole[t]++; else if (i < P.strict) onNoRow++; }
  // A field dot in this photograph, and whether its pixel looks back at it (cornPictures.ts pixelOf).
  const pixelOf = (e: number, nn: number): [number, number, boolean] | null => {
    let de = 0, dn = 0, u = 0, v = 0;
    for (let it = 0; it < 4; it++) { const p = fromEnu([e - de, nn - dn, 0], F.origin), h = groundToPixel(f, p.lat, p.lng, altM); if (!h) return null; u = h.u; v = h.v; [de, dn] = shiftOf(P.shifts[pi], u, v); }
    if (u < 0 || v < 0 || u >= W || v >= H) return null;
    const g = pixelToGround(f, u, v); if (!g) return [u, v, false];
    const b = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, F.origin), [se, sn] = shiftOf(P.shifts[pi], u, v);
    return [u, v, Math.hypot(b[0] + se - e, b[1] + sn - nn) <= LOOKS_BACK_M];
  };
  const place = (u: number, v: number): [number, number] | null => { const g = pixelToGround(f, u, v); if (!g) return null; const b = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, F.origin), [se, sn] = shiftOf(P.shifts[pi], u, v); return [b[0] + se, b[1] + sn]; };
  let landed = 0, fold = 0; const marks: Mark[] = [], noRow: Mark[] = [], inPhoto = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const t = tierOf(i); if (t < 0 && i >= P.strict) continue;
    const q = pixelOf(P.all[i].e, P.all[i].n); if (!q) continue;
    landed++; if (!q[2]) { fold++; continue; }
    (t >= 0 ? marks : noRow).push({ u: q[0], v: q[1], e: P.all[i].e, n: P.all[i].n, tier: Math.max(0, t), i }); if (t >= 0) inPhoto[t]++;
  }
  return { tierOf, whole, onNoRow, pixelOf, place, landed, fold, marks, noRow, inPhoto };
}
