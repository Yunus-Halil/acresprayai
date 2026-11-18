// Development only, read-only. A second pass measured beside the hand-label score of ONE photograph (cornLabelScore.ts
// --single --cores): counting the plants inside a green piece by its vivid cores. Nothing here is in the rules.
//
// The filter, at the photograph's own size:
//   green  = (2g - r - b) / (r + g + b), kept where it is above GREEN_MIN
//   vivid  = saturation x green on those pixels (0 elsewhere), saturation = (max - min) / max
//   cores  = vivid blurred at `fine` px less vivid blurred at `wide` px, negatives to zero (a Gaussian blur, the pixels its
//            standard deviation)
//   a core = a local peak of that (a pixel no lower than its eight neighbours), above a share of the photograph's strongest
//
// Run at three shares and three sizes of the blur pair. Per setting, on the dev tiles only:
//   a) the cores alone as marks
//   b) the read's marks kept, and cores added only in green pieces where the cores outnumber the marks: each mark of the
//      piece takes its nearest core, one to one, and the cores left over are added
// The green pieces are the plant read's own, found as cornLabelLook.ts touchReport finds them.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { GREEN_POINTS } from "../../src/lib/rowCrop/greenPoints";
import { SEEDLING_GREEN, SEEDLING_V1, seedlingMask, soilLevels } from "../../src/lib/rowCrop/seedlingGreen";
import { type LJudged, type LLabel, type LMark, type LTile, pieceAt, piecesOf } from "./cornLabelLook";

type Judge = (t: LTile, marks: LMark[], place: (u: number, v: number) => [number, number] | null, R: number) => LJudged;
export const GREEN_MIN = 0.06, SHARES = [0.25, 0.35, 0.45], SIZES = [{ key: "halved", fine: 2, wide: 8.5 }, { key: "as-given", fine: 4, wide: 17 }, { key: "doubled", fine: 8, wide: 34 }];
export type Core = { x: number; y: number; /** Its strength as a share of the photograph's strongest core. */ s: number };
export type CoresCtx = {
  out: string; px: PhotoPixels; darkApplied: boolean; marks: [number, number][]; tiles: LTile[]; labels: Map<string, LLabel[]>; judge: Judge; R: number;
  within: (t: LTile, u: number, v: number, pad?: number) => boolean; /** The tiles whose pieces are listed one by one. */ closeTiles: string[];
  /** Called once per size with the cores image (0 to `top`) and every core at or over the lowest share. */
  picture: (size: (typeof SIZES)[number], strength: Float32Array, top: number, cores: Core[]) => void;
};

/** A Gaussian blur, standard deviation `sigma` pixels, cut at three of them; the photograph's edge is repeated outward. */
function blur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.ceil(3 * sigma), k = new Float32Array(2 * r + 1); let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(w * h), line = new Float32Array(w + 2 * r);
  for (let y = 0; y < h; y++) {
    const o = y * w; for (let x = 0; x < w; x++) line[x + r] = src[o + x];
    for (let x = 0; x < r; x++) { line[x] = src[o]; line[w + r + x] = src[o + w - 1]; }
    for (let x = 0; x < w; x++) { let a = 0; for (let j = 0; j < k.length; j++) a += k[j] * line[x + j]; tmp[o + x] = a; }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let j = -r; j <= r; j++) { const yy = Math.min(h - 1, Math.max(0, y + j)) * w, kk = k[j + r]; for (let x = 0; x < w; x++) out[o + x] += kk * tmp[yy + x]; }
  }
  return out;
}

export function coresReport(X: CoresCtx) {
  const { px, tiles, R } = X, W = px.width, H = px.height, d = px.rgba, o = GREEN_POINTS;
  // The plant read's own mask and pieces (greenPoints.ts:66-92), as touchReport finds them.
  const full = seedlingMask(px, X.darkApplied ? SEEDLING_GREEN : SEEDLING_V1, soilLevels(px, SEEDLING_GREEN));
  const f = Math.max(1, Math.round(Math.max(W, H) / o.workLongSide)), w = Math.floor(W / f), h = Math.floor(H / f), mask = new Uint8Array(w * h), need = Math.max(1, Math.ceil(f * f * o.shrinkShare));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let c = 0; for (let yy = 0; yy < f; yy++) { const row = (y * f + yy) * W + x * f; for (let xx = 0; xx < f; xx++) c += full[row + xx]; } if (c >= need) mask[y * w + x] = 1; }
  const { label, area } = piecesOf(mask, w, h);
  const at = (x: number, y: number, tolPhoto: number) => pieceAt(label, w, h, x / f - 0.5, y / f - 0.5, Math.max(0, Math.round(tolPhoto / f)));
  const TOL_MARK = 12, TOL_LABEL = 6, TOL_CORE = 6;
  const mk = X.marks.map(([x, y]) => ({ x, y })), markPiece = mk.map(m => at(m.x, m.y, TOL_MARK));
  const marksIn = new Map<number, number[]>(); markPiece.forEach((id, k) => { if (id >= 0) (marksIn.get(id) ?? marksIn.set(id, []).get(id)!).push(k); });
  const asMarks = (pts: { x: number; y: number }[]): LMark[] => pts.map(p => ({ u: p.x, v: p.y, e: p.x, n: p.y, tier: 0 }));
  const ident = (u: number, v: number): [number, number] => [u, v];
  const row = (J: LJudged) => ({ tile: J.score.tile, labelled: J.score.labelled, found: J.score.found[0], notFound: J.score.missed, marks: J.score.marks[0], wrong: J.score.wrong[0], wrongSecond: J.score.wrongSecond[0], wrongNothing: J.score.wrongNothing[0], onUnsure: J.score.onUnsure[0], atEdge: J.score.atEdge[0], countError: J.score.marks[0] - J.score.onUnsure[0] - J.score.labelled });
  const today = tiles.map(t => row(X.judge(t, asMarks(mk), ident, R)));

  // The vivid green, once.
  const vivid = new Float32Array(W * H); let greenPx = 0;
  for (let i = 0, q = 0; i < W * H; i++, q += 4) {
    const r = d[q], g = d[q + 1], b = d[q + 2], sum = r + g + b; if (!sum) continue;
    const gr = (2 * g - r - b) / sum; if (gr <= GREEN_MIN) continue;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); vivid[i] = ((mx - mn) / mx) * gr; greenPx++;
  }
  // The pieces of the close tiles, by what they hold inside the tile: labelled plants, unsure labels, the read's marks.
  const close = tiles.filter(t => X.closeTiles.includes(t.id));
  type PieceRow = { tile: string; piece: number; plants: number; unsure: number; marks: number; areaWorkPx: number; cores: Record<string, number> };
  const pieceRows = new Map<string, PieceRow>(), loose: Record<string, { tile: string; plantsInNoPiece: number; marksInNoPiece: number; coresInNoPiece: Record<string, number> }> = {};
  const pr = (t: LTile, id: number) => { const key = `${t.id}|${id}`; let r = pieceRows.get(key); if (!r) { r = { tile: t.id, piece: id, plants: 0, unsure: 0, marks: 0, areaWorkPx: area[id], cores: {} }; pieceRows.set(key, r); } return r; };
  for (const t of close) {
    const L = (loose[t.id] = { tile: t.id, plantsInNoPiece: 0, marksInNoPiece: 0, coresInNoPiece: {} });
    for (const l of X.labels.get(t.id)!) { const id = at(l.x, l.y, TOL_LABEL); if (id < 0) { if (l.type === "plant") L.plantsInNoPiece++; continue; } if (l.type === "plant") pr(t, id).plants++; else pr(t, id).unsure++; }
    mk.forEach((m, k) => { if (!X.within(t, m.x, m.y)) return; if (markPiece[k] < 0) L.marksInNoPiece++; else pr(t, markPiece[k]).marks++; });
  }

  const settings: Record<string, unknown>[] = [];
  for (const size of SIZES) {
    const t0 = Date.now(), a = blur(vivid, W, H, size.fine), b = blur(vivid, W, H, size.wide);
    let top = 0; for (let i = 0; i < W * H; i++) { const v = a[i] - b[i]; a[i] = v > 0 ? v : 0; if (a[i] > top) top = a[i]; }
    // Local peaks: no lower than the eight neighbours; of equal neighbours the first in reading order is the peak.
    const lowest = Math.min(...SHARES) * top, peaks: Core[] = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, v = a[i]; if (v < lowest) continue;
      if (a[i - W - 1] >= v || a[i - W] >= v || a[i - W + 1] >= v || a[i - 1] >= v || a[i + 1] > v || a[i + W - 1] > v || a[i + W] > v || a[i + W + 1] > v) continue;
      peaks.push({ x, y, s: v / top });
    }
    console.log(`Cores ${size.key} (blur ${size.fine} px less ${size.wide} px): ${peaks.length} local peaks at or over ${Math.min(...SHARES)} of the strongest, in ${Date.now() - t0} ms.`);
    X.picture(size, a, top, peaks);
    const corePiece = peaks.map(c => at(c.x, c.y, TOL_CORE));
    for (const share of SHARES) {
      const key = `${size.key}@${share}`, idx = peaks.map((c, k) => (c.s >= share ? k : -1)).filter(k => k >= 0), cores = idx.map(k => peaks[k]);
      // a) The cores alone as marks.
      const alone = tiles.map(t => row(X.judge(t, asMarks(cores), ident, R)));
      // b) The read's marks kept; in a piece where the cores outnumber the marks, each mark takes its nearest core (one to
      //    one, nearest pairs first) and the cores left over are added.
      const coresIn = new Map<number, number[]>(); for (const k of idx) { const id = corePiece[k]; if (id >= 0) (coresIn.get(id) ?? coresIn.set(id, []).get(id)!).push(k); }
      const addedPts: { x: number; y: number }[] = []; let piecesAddedTo = 0;
      for (const [id, cs] of coresIn) {
        const ms = marksIn.get(id) ?? []; if (cs.length <= ms.length) continue;
        const pairs: [number, number, number][] = []; for (const m of ms) for (const c of cs) pairs.push([Math.hypot(mk[m].x - peaks[c].x, mk[m].y - peaks[c].y), m, c]);
        pairs.sort((p, q) => p[0] - q[0]); const usedM = new Set<number>(), usedC = new Set<number>();
        for (const [, m, c] of pairs) { if (usedM.has(m) || usedC.has(c)) continue; usedM.add(m); usedC.add(c); }
        piecesAddedTo++; for (const c of cs) if (!usedC.has(c)) addedPts.push(peaks[c]);
      }
      const added = tiles.map(t => row(X.judge(t, asMarks([...mk, ...addedPts]), ident, R)));
      const inDev = (p: { x: number; y: number }) => tiles.some(t => X.within(t, p.x, p.y));
      // The close tiles' pieces: the cores inside the tile, by piece.
      for (const t of close) {
        let none = 0; for (const k of idx) { const c = peaks[k]; if (!X.within(t, c.x, c.y)) continue; const id = corePiece[k]; if (id < 0) { none++; continue; } const r = pr(t, id); r.cores[key] = (r.cores[key] ?? 0) + 1; }
        loose[t.id].coresInNoPiece[key] = none;
      }
      settings.push({ key, size: size.key, fine: size.fine, wide: size.wide, share, coresInDevTiles: cores.filter(inDev).length, coresInDevTilesInNoPiece: idx.filter(k => corePiece[k] < 0 && inDev(peaks[k])).length, addedInDevTiles: addedPts.filter(inDev).length, alone, added });
      const tot = (rs: ReturnType<typeof row>[]) => rs.reduce((s, r) => ({ found: s.found + r.found, wrong: s.wrong + r.wrong, err: s.err + r.countError }), { found: 0, wrong: 0, err: 0 });
      console.log(`  ${key}: cores alone ${JSON.stringify(tot(alone))}; marks kept and cores added ${JSON.stringify(tot(added))} (${addedPts.filter(inDev).length} cores added in the dev tiles)`);
    }
  }
  const out = {
    filter: { greenMin: GREEN_MIN, blur: "Gaussian, the pixels its standard deviation, cut at three of them", peak: "a pixel no lower than its eight neighbours", shares: SHARES, sizes: SIZES },
    mask: X.darkApplied ? "the stricter mask with the dark-leaf rule" : "the earlier mask, without the dark-leaf rule (what the plant read used on this photograph)", workFactor: f, toleranceMarkPx: TOL_MARK, toleranceLabelPx: TOL_LABEL, toleranceCorePx: TOL_CORE, matchPx: R,
    marks: mk.length, today, settings, closeTiles: X.closeTiles, pieces: [...pieceRows.values()].sort((p, q) => (p.tile < q.tile ? -1 : p.tile > q.tile ? 1 : p.piece - q.piece)), loose: Object.values(loose),
  };
  writeFileSync(join(X.out, "cores.json"), JSON.stringify(out, null, 1));
  const t = today.reduce((s, r) => ({ found: s.found + r.found, wrong: s.wrong + r.wrong, err: s.err + r.countError }), { found: 0, wrong: 0, err: 0 });
  console.log(`Today's marks: ${JSON.stringify(t)}. Green pixels over ${GREEN_MIN}: ${greenPx} of ${W * H}.`);
}
