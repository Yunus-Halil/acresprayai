// A synthetic orchard fixture made in code: bare soil, tree crowns on a lattice, and patches of small green discs of
// known area in the alleys, with truth quadrats counted off the painted pixels themselves. The harness must score it
// near zero error: every pixel is either soil or plainly green, the quadrats sit on whole cells of the grade's own
// grid, and each patch is wider than the treatment unit, so nothing but the grade's own arithmetic is between the
// paint and the score. Its failure is a defect in the harness or the grade, never in the imagery.
import type { LatLng2 } from "../../../src/lib/geo";
import { type FieldRows, fieldReadPlan } from "../../../src/lib/weedVision/fieldRows";
import { latLngOfPx } from "../../../src/lib/weedVision/mapRun";
import { PRESSURE_CELL_M } from "../../../src/lib/weedVision/pressure/pressureStore";
import { gridFor } from "../../../src/lib/weedVision/twoStage/stage1";
import type { LoadedFixture, TruthQuadrat } from "./fixture";

const SOIL = [150, 115, 80], GREEN = [60, 160, 50];

/**
 * Patches: alley centre (m from the north edge), west edge (m), and the cover the disc lattice is spaced for. The truth
 * is counted off the painted pixels, not taken from this target (the lattice is cut to the patch, so a quadrat holds
 * somewhat less: 11 to 35% where the target is 12 to 30%, about 3% where it is 3%). Covers stay off the 5 to 10% band
 * between the patch rule and the action point, so act / don't act is unambiguous.
 */
export const SYNTHETIC_PATCHES: { alleyM: number; xM: number; target: number }[] = [
  { alleyM: 6, xM: 4, target: 0.2 }, { alleyM: 6, xM: 14, target: 0.03 }, { alleyM: 6, xM: 24, target: 0 }, { alleyM: 6, xM: 33, target: 0.2 },
  { alleyM: 12, xM: 4, target: 0.03 }, { alleyM: 12, xM: 14, target: 0.2 }, { alleyM: 12, xM: 24, target: 0 }, { alleyM: 12, xM: 33, target: 0.12 },
  { alleyM: 18, xM: 9, target: 0.3 }, { alleyM: 18, xM: 29, target: 0.03 },
  { alleyM: 24, xM: 9, target: 0 }, { alleyM: 24, xM: 24, target: 0.2 },
];

/** A seeded generator (mulberry32), so the fixture is the same on every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function makeSyntheticFixture(opts: { lat?: number; lng?: number; widthM?: number; heightM?: number; seed?: number } = {}): LoadedFixture {
  const lat = opts.lat ?? 37.6, lng = opts.lng ?? -78.4, widthM = opts.widthM ?? 40, heightM = opts.heightM ?? 30;
  const dLat = heightM / 111_320, dLng = widthM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const ring: LatLng2[] = [{ lat, lng }, { lat, lng: lng + dLng }, { lat: lat - dLat, lng: lng + dLng }, { lat: lat - dLat, lng }];
  // The raster is the read plan's own extent at its own zoom, so the grade's grid starts at its top-left pixel.
  const maxNative = 22;
  const plan = fieldReadPlan([ring], maxNative, lat)!;
  const { z, left, top, width: W, height: H, mpp } = plan;
  const g = gridFor(plan, PRESSURE_CELL_M);
  const c = g.cellPx, cellM = c * mpp;
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) { rgba[p * 4] = SOIL[0]; rgba[p * 4 + 1] = SOIL[1]; rgba[p * 4 + 2] = SOIL[2]; rgba[p * 4 + 3] = 255; }
  const paint = (x: number, y: number) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; rgba[o] = GREEN[0]; rgba[o + 1] = GREEN[1]; rgba[o + 2] = GREEN[2]; };
  const disc = (cx: number, cy: number, r: number) => { for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) paint(x, y); };

  // Trees: rows west to east every 6 m from 3 m, a tree every 4 m from 2 m, crowns 1 m across the radius.
  const rowY = [3, 9, 15, 21, 27].filter(y => y < heightM), crownM = 1.0;
  const trees = rowY.flatMap(y => Array.from({ length: Math.floor((widthM - 2) / 4) + 1 }, (_, k) => ({ x: 2 + 4 * k, y })));
  for (const t of trees) disc(t.x / mpp, t.y / mpp, crownM / mpp);
  const rows: FieldRows = {
    z, left, top, mpp, rows: rowY.length, spacingM: 6, seedSpacingM: 4, directionDeg: 0, blocks: 1, source: "layout",
    ctx: {
      lines: rowY.map(y => ({ x1: 0, y1: y / mpp, x2: widthM / mpp, y2: y / mpp })),
      crops: trees.map(t => ({ x: t.x / mpp, y: t.y / mpp, r: crownM / mpp, paint: crownM / mpp, state: "confirmed" as const })),
      bandPx: 0.6 / mpp, gsdM: mpp,
    },
  };

  // Weed patches: six by six cells (3 m, wider than the 2.5 m unit), discs of radius 3 px on a jittered lattice spaced
  // for the target cover, kept whole inside the patch and two pixels apart (Stage 1 counts 4-connected blobs).
  const rand = rng(opts.seed ?? 20261022);
  const R = 3;
  const discPx = (() => { let n = 0; for (let y = -R - 1; y <= R; y++) for (let x = -R - 1; x <= R; x++) if ((x + 0.5) ** 2 + (y + 0.5) ** 2 <= R * R) n++; return n; })();
  const truth: TruthQuadrat[] = [];
  SYNTHETIC_PATCHES.forEach((p, n) => {
    const pi = Math.round(p.xM / cellM), pj = Math.round(p.alleyM / cellM) - 3;
    const x0 = pi * c, y0 = pj * c, side = 6 * c;
    if (p.target > 0) {
      const s = Math.sqrt(discPx / p.target), jitter = Math.max(0, (s - (2 * R + 3)) / 2);
      for (let y = y0 + s / 2; y < y0 + side; y += s) for (let x = x0 + s / 2; x < x0 + side; x += s) {
        const cx = Math.round(x + (rand() * 2 - 1) * jitter), cy = Math.round(y + (rand() * 2 - 1) * jitter);
        if (cx - R - 1 < x0 || cy - R - 1 < y0 || cx + R + 1 > x0 + side || cy + R + 1 > y0 + side) continue;
        disc(cx, cy, R);
      }
    }
    // The quadrat: the patch's middle two by two cells, its truth read off the painted pixels.
    const qx0 = x0 + 2 * c, qy0 = y0 + 2 * c, qs = 2 * c;
    let green = 0;
    for (let y = qy0; y < qy0 + qs; y++) for (let x = qx0; x < qx0 + qs; x++) if (rgba[(y * W + x) * 4 + 1] === GREEN[1]) green++;
    truth.push({ id: `p${n + 1}`, centre: latLngOfPx(left + qx0 + qs / 2, top + qy0 + qs / 2, z), sideM: qs * mpp, cover: green / (qs * qs), count: countBlobs(rgba, W, qx0, qy0, qs) });
  });
  return { name: "synthetic-orchard", crop: "olive", ring, raster: { z, left, top, width: W, height: H, rgba }, rows, plants: [], photoBased: false, canopyClosed: false, truth };
}

/** Green 4-connected blobs whose pixel centroid lies in the square (the way Stage 1 places a blob in a cell). */
function countBlobs(rgba: Uint8ClampedArray, W: number, x0: number, y0: number, s: number): number {
  const H = rgba.length / 4 / W;
  const isGreen = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && rgba[(y * W + x) * 4 + 1] === GREEN[1];
  const seen = new Set<number>();
  let n = 0;
  // Every blob with a pixel in the square, plus a margin for blobs centred inside but reaching out.
  for (let y = y0 - 8; y < y0 + s + 8; y++) for (let x = x0 - 8; x < x0 + s + 8; x++) {
    if (!isGreen(x, y) || seen.has(y * W + x)) continue;
    const stack = [[x, y]]; seen.add(y * W + x);
    let k = 0, sx = 0, sy = 0;
    while (stack.length) {
      const [px, py] = stack.pop()!;
      k++; sx += px; sy += py;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = px + dx, yy = py + dy; if (isGreen(xx, yy) && !seen.has(yy * W + xx)) { seen.add(yy * W + xx); stack.push([xx, yy]); } }
    }
    const cx = sx / k, cy = sy / k;
    if (cx >= x0 && cx < x0 + s && cy >= y0 && cy < y0 + s) n++;
  }
  return n;
}
