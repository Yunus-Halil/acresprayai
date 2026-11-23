// Weed patches on a corn twin (2026-11-23), for the corn panel's "What to look at": where the green that is not corn
// stands thick. A grouping in the viewer of marks the twin already holds (a sorted twin's plants off the rows, not
// counted): nothing is detected again and nothing in the count moves. Unconfirmed: the twin does not tell a weed from
// dark ground or a shadow, so a patch is a place to look at, never a weed finding.
//
// The rule: one-metre cells holding at least `minPerM2` marks; cells touching (side or corner) make one patch; a patch
// of fewer than `minMarks` marks is left out.
//
// Only inside the field boundary (2026-11-23, his report: weeds were shown outside a clear boundary). The photographs
// see the verge and the neighbouring ground too, and green there is not this field's weeds: with a boundary in use
// (the operator's correction, else the inferred one, else the rows' block) only the marks inside it make patches.
import type { PlotContext } from "./plots";
import type { LatLngPair } from "./types";

export const WEED_PATCH = { cellM: 1, minPerM2: 2, minMarks: 15 };
/** A patch's pin, on the map and in the list. */
export const WEED_PATCH_COLOUR = "#f5d547";

export type WeedPatch = {
  /** 1 the largest. */
  number: number;
  marks: number;
  areaM2: number;
  /** Its middle (the marks' mean) and a box round its cells, latitude / longitude. */
  lat: number; lng: number;
  bounds: [LatLngPair, LatLngPair];
  /** Where it lies in the field, in words ("south-west", "middle"). */
  where: string;
  /** Its cells' corners, metres east / north of the twin's origin (for drawing its outline). */
  cells: [number, number][];
};

const COMPASS = ["east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east"];

/**
 * Which marks of green that is not corn lie inside the ring (latitude / longitude): `keep` a mark each in the
 * context's order (null: no ring, every mark is kept), and how many lie outside it.
 */
export function greenInside(ctx: PlotContext, ring: LatLngPair[] | null): { keep: Uint8Array | null; outside: number } {
  if (!ring || ring.length < 3) return { keep: null, outside: 0 };
  const en = ring.map(([la, ln]) => ctx.frame.toEN(la, ln)), m = en.length, n = ctx.gE.length, keep = new Uint8Array(n);
  let outside = 0;
  for (let i = 0; i < n; i++) {
    const x = ctx.gE[i], y = ctx.gN[i];
    let inside = false;
    for (let a = 0, b = m - 1; a < m; b = a++) { const [xa, ya] = en[a], [xb, yb] = en[b]; if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside; }
    if (inside) keep[i] = 1; else outside++;
  }
  return { keep, outside };
}

/** The weed patches; with `ring` (the field boundary in use, latitude / longitude) only from the marks inside it. */
export function weedPatches(ctx: PlotContext, o = WEED_PATCH, ring: LatLngPair[] | null = null): WeedPatch[] {
  const { keep } = greenInside(ctx, ring);
  const gE = keep ? ctx.gE.filter((_, i) => keep[i] === 1) : ctx.gE, gN = keep ? ctx.gN.filter((_, i) => keep[i] === 1) : ctx.gN, n = gE.length;
  if (!n) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, gE[i]); x1 = Math.max(x1, gE[i]); y0 = Math.min(y0, gN[i]); y1 = Math.max(y1, gN[i]); }
  const c = o.cellM, nx = Math.floor((x1 - x0) / c) + 1, ny = Math.floor((y1 - y0) / c) + 1;
  const count = new Int32Array(nx * ny), sx = new Float64Array(nx * ny), sy = new Float64Array(nx * ny);
  for (let i = 0; i < n; i++) { const k = Math.floor((gN[i] - y0) / c) * nx + Math.floor((gE[i] - x0) / c); count[k]++; sx[k] += gE[i]; sy[k] += gN[i]; }
  const thick = (k: number) => count[k] >= o.minPerM2 * c * c;
  const label = new Int32Array(nx * ny).fill(-1), found: { cells: number[]; marks: number; sx: number; sy: number }[] = [];
  for (let k0 = 0; k0 < nx * ny; k0++) {
    if (!thick(k0) || label[k0] >= 0) continue;
    const id = found.length, stack = [k0], g = { cells: [] as number[], marks: 0, sx: 0, sy: 0 };
    label[k0] = id;
    while (stack.length) {
      const k = stack.pop()!, i = k % nx, j = (k - i) / nx;
      g.cells.push(k); g.marks += count[k]; g.sx += sx[k]; g.sy += sy[k];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const q = jj * nx + ii; if (label[q] < 0 && thick(q)) { label[q] = id; stack.push(q); }
      }
    }
    found.push(g);
  }
  // Where in the field: from the middle of the counted plants, by compass; "middle" within a fifth of the field's size.
  let cx = 0, cy = 0, px0 = Infinity, px1 = -Infinity, py0 = Infinity, py1 = -Infinity;
  for (let i = 0; i < ctx.pE.length; i++) { cx += ctx.pE[i]; cy += ctx.pN[i]; px0 = Math.min(px0, ctx.pE[i]); px1 = Math.max(px1, ctx.pE[i]); py0 = Math.min(py0, ctx.pN[i]); py1 = Math.max(py1, ctx.pN[i]); }
  if (ctx.pE.length) { cx /= ctx.pE.length; cy /= ctx.pE.length; }
  const size = Math.max(1, Math.hypot(px1 - px0, py1 - py0));
  const kept = found.filter(g => g.marks >= o.minMarks).sort((a, b) => b.cells.length - a.cells.length || b.marks - a.marks);
  return kept.map((g, idx) => {
    const e = g.sx / g.marks, no = g.sy / g.marks, de = e - cx, dn = no - cy;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    const cells = g.cells.map(k => { const i = k % nx, j = (k - i) / nx, ex = x0 + i * c, ny0 = y0 + j * c; bx0 = Math.min(bx0, ex); by0 = Math.min(by0, ny0); bx1 = Math.max(bx1, ex + c); by1 = Math.max(by1, ny0 + c); return [ex, ny0] as [number, number]; });
    // A patch reaching across much of the field (a headland strip) is "along" its side, not at a point of it.
    const dir = COMPASS[Math.round(((Math.atan2(dn, de) * 180) / Math.PI + 360) / 45) % 8], long = Math.hypot(bx1 - bx0, by1 - by0) > 0.4 * size;
    const where = long ? `along the ${dir} side` : Math.hypot(de, dn) < 0.2 * size ? "middle" : dir;
    const [lat, lng] = ctx.frame.toLL(e, no);
    return { number: idx + 1, marks: g.marks, areaM2: g.cells.length * c * c, lat, lng, bounds: [ctx.frame.toLL(bx0, by0), ctx.frame.toLL(bx1, by1)], where, cells };
  });
}

/** Rows much thinner than the rest: counted plants per foot of row with plants seen under `share` of the median row's,
 * on rows with at least `minM` of row seen. */
export function thinRows(ctx: PlotContext, share = 0.7, minM = 10): { rows: { row: number; perM: number; seenM: number; lat: number; lng: number; lengthM: number }[]; medianPerM: number | null; lowestShare: number | null } {
  const byRow = new Map<number, { plants: number; seenM: number; mid: [number, number] | null; lengthM: number }>();
  ctx.stretches.forEach(s => {
    const r = byRow.get(s.row) ?? byRow.set(s.row, { plants: 0, seenM: 0, mid: null, lengthM: 0 }).get(s.row)!;
    let L = 0; for (let i = 1; i < s.pts.length / 2; i++) L += Math.hypot(s.pts[2 * i] - s.pts[2 * i - 2], s.pts[2 * i + 1] - s.pts[2 * i - 1]);
    r.lengthM += L * s.scale;
    if (!s.seen) return;
    r.seenM += L * s.scale; r.plants += s.plants.length;
    if (!r.mid) { const m = Math.floor(s.pts.length / 4); r.mid = [s.pts[2 * m], s.pts[2 * m + 1]]; }
  });
  const rows = [...byRow].filter(([, v]) => v.seenM >= minM && v.mid).map(([row, v]) => ({ row, perM: v.plants / v.seenM, seenM: v.seenM, lengthM: v.lengthM, mid: v.mid! }));
  if (!rows.length) return { rows: [], medianPerM: null, lowestShare: null };
  const per = rows.map(r => r.perM).sort((a, b) => a - b), med = per[per.length >> 1];
  return {
    rows: rows.filter(r => r.perM < share * med).sort((a, b) => a.perM - b.perM).map(r => { const [lat, lng] = ctx.frame.toLL(r.mid[0], r.mid[1]); return { row: r.row, perM: r.perM, seenM: r.seenM, lat, lng, lengthM: r.lengthM }; }),
    medianPerM: med, lowestShare: per[0] / med,
  };
}
