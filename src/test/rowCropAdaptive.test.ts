// The field assessment and the adaptive corn reader on rendered stands (scripts/cropProfiles/scenes.ts): two plantings
// at different spacings side by side with a lawn beside them must come out as two "rows" regions at their own pitches
// and a cover region, read without being told a stage and without the plantings' corn becoming weeds; a seedling
// stand must come out as seedlings; bare ground must read as nothing; and a stage reader handed the geometry it
// would have measured must read what it reads on its own (the geometry hook changes nothing else).
import { describe, expect, it } from "vitest";
import { renderScene, type Scene } from "../../scripts/cropProfiles/scenes";
import type { PhotoPixels } from "@/lib/photoScout/pattern";
import { assessField } from "@/lib/rowCrop/assess";
import { adaptiveAsRead, readCornAdaptive } from "@/lib/rowCrop/adaptive";
import { readRowCrop } from "@/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "@/lib/rowCrop/params";
import { cropProfileFor } from "@/lib/cropProfiles/registry";

const profile = cropProfileFor("corn")!;
const GSD = 0.005;
const scene = (over: Partial<Scene>): Scene => ({ name: "t", widthM: 10, heightM: 8, gsdM: GSD, angleDeg: 90, pitchM: 0.762, twinM: null, alongM: 0.16, leafM: 0.15, soil: "dark", straw: null, weedsPerM2: 0, weedRadiusM: 0.05, inRowWeedsPerM: 0, seed: 7, ...over });

/** Frames side by side (same height), then a band of lawn (random green) of `lawnM` metres below. */
function composite(parts: PhotoPixels[], lawnM: number): PhotoPixels {
  const W = parts.reduce((u, p) => u + p.width, 0), H0 = parts[0].height, lawn = Math.round(lawnM / GSD), H = H0 + lawn;
  const rgba = new Uint8ClampedArray(W * H * 4);
  let x0 = 0;
  for (const p of parts) { for (let y = 0; y < H0; y++) rgba.set(p.rgba.subarray(y * p.width * 4, (y + 1) * p.width * 4), (y * W + x0) * 4); x0 += p.width; }
  let s = 12345;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let y = H0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, g = rnd() < 0.8; rgba[o] = g ? 70 + rnd() * 30 : 120; rgba[o + 1] = g ? 150 + rnd() * 50 : 100; rgba[o + 2] = g ? 50 + rnd() * 20 : 80; rgba[o + 3] = 255; }
  return { width: W, height: H, rgba };
}

describe("field assessment and adaptive reader on rendered stands", () => {
  const wide = renderScene(scene({ pitchM: 0.762, seed: 7 })).px;
  const narrow = renderScene(scene({ pitchM: 0.381, seed: 8 })).px;
  const two = composite([wide, narrow], 3);
  const P = rowCropParamsFor(profile, GSD);

  it("reads two plantings at their own spacings beside a lawn", () => {
    const a = assessField(two, P);
    expect(a.field).not.toBeNull();
    expect(Math.abs(a.field!.directionDeg - 90)).toBeLessThan(3);
    expect(a.field!.clusters.length).toBe(2);
    const pitchesM = a.field!.clusters.map(p => p * GSD).sort((u, v) => u - v);
    expect(Math.abs(pitchesM[0] - 0.381)).toBeLessThan(0.04);
    expect(Math.abs(pitchesM[1] - 0.762)).toBeLessThan(0.08);
    const rowsRegions = a.regions.filter(r => r.state === "rows" && r.cells.length >= 4);
    expect(rowsRegions.length).toBe(2);
    // The left region at the wide pitch, the right at the narrow one.
    const left = rowsRegions.find(r => r.x0 === 0)!, right = rowsRegions.find(r => r.x1 === two.width)!;
    expect(left.pitchPx! * GSD).toBeGreaterThan(0.6); expect(right.pitchPx! * GSD).toBeLessThan(0.5);
    // The lawn: cover, not rows.
    const lawnCells = a.cells.filter(c => c.y0 >= wide.height);
    expect(lawnCells.filter(c => c.state === "cover").length / lawnCells.length).toBeGreaterThan(0.6);
    expect(lawnCells.some(c => c.state === "rows")).toBe(false);
  });

  it("reads both plantings with the establishment reader and makes no weeds of their corn", () => {
    const ad = readCornAdaptive(two, P);
    const read = ad.plans.filter(p => p.read && p.stage === "establishment");
    expect(read.length).toBe(2);
    // About 13 rows at 76 cm over 10 m and 26 at 38 cm (the frame's edges can lose one).
    const leftRows = ad.rows.filter(r => r.points[0][0] < wide.width), rightRows = ad.rows.filter(r => r.points[0][0] >= wide.width);
    expect(leftRows.length).toBeGreaterThanOrEqual(11); expect(leftRows.length).toBeLessThanOrEqual(14);
    expect(rightRows.length).toBeGreaterThanOrEqual(23); expect(rightRows.length).toBeLessThanOrEqual(27);
    expect(ad.summary.weeds).toBeLessThanOrEqual(2);
    expect(ad.pitchesM.length).toBe(2);
    const asRead = adaptiveAsRead(ad);
    expect(asRead.rows.length).toBe(ad.rows.length);
    expect(asRead.stage).toBe("establishment");
  });

  it("reads a seedling stand as seedlings with the emergence reader", () => {
    // Bare soil at 1 cm a pixel, a 2 cm seedling every 16 cm on rows 76 cm apart (as the emergence test renders).
    const W = 1600, H = 1200, rgba = new Uint8ClampedArray(W * H * 4);
    let s = 11; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < W * H; i++) { const n = (rnd() - 0.5) * 24; rgba[i * 4] = 128 + n; rgba[i * 4 + 1] = 108 + n; rgba[i * 4 + 2] = 88 + n; rgba[i * 4 + 3] = 255; }
    for (let x = 30; x < W; x += 76) for (let y = 8 + rnd() * 8; y < H; y += 16) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = Math.round(x + (rnd() - 0.5) * 2) + dx, yy = Math.round(y) + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const o = (yy * W + xx) * 4; rgba[o] = 70; rgba[o + 1] = 150; rgba[o + 2] = 55; }
    const seedlings: PhotoPixels = { width: W, height: H, rgba };
    const Ps = rowCropParamsFor(profile, 0.01);
    const a = assessField(seedlings, Ps);
    const states = a.cells.filter(c => c.state !== "unknown" && c.state !== "bare");
    expect(states.filter(c => c.state === "seedlings").length / Math.max(1, states.length)).toBeGreaterThan(0.6);
    const ad = readCornAdaptive(seedlings, Ps);
    expect(ad.plans.some(p => p.read && p.stage === "emergence")).toBe(true);
    expect(ad.rows.length).toBeGreaterThanOrEqual(8);
  });

  it("reads bare ground as nothing, with no field and no findings", () => {
    const W = 800, H = 600, rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { rgba[i * 4] = 100 + (i % 7); rgba[i * 4 + 1] = 80 + (i % 5); rgba[i * 4 + 2] = 60; rgba[i * 4 + 3] = 255; }
    const ad = readCornAdaptive({ width: W, height: H, rgba }, P);
    expect(ad.assessment.field).toBeNull();
    expect(ad.rows.length).toBe(0); expect(ad.weeds.length).toBe(0);
    expect(ad.notes.some(n => /no row structure/i.test(n))).toBe(true);
  });

  it("reads the same with the measured geometry handed back to the stage reader", () => {
    const plain = readRowCrop(wide, P);
    expect(plain.rows.length).toBeGreaterThan(8);
    const given = readRowCrop(wide, { ...P, geometry: { directionDeg: plain.directionDeg!, pitchPx: plain.pitchM! / plain.gsdM } });
    expect(given.rows.length).toBe(plain.rows.length);
    expect(given.summary.weeds).toBe(plain.summary.weeds);
    expect(Math.abs(given.pitchM! - plain.pitchM!)).toBeLessThan(0.005);
  });
  it("keeps the corn of a thin row out of the weeds when the reader drops that row", () => {
    // Rows run along y (angle 90); two neighbouring rows keep one plant in twelve (about one every 1.9 m): too few for
    // the establishment reader to hold them, so their plants stand a pitch from the kept rows.
    const { px: thinPx, truth } = renderScene(scene({ pitchM: 0.762, seed: 21, leafM: 0.12 }));
    const W = thinPx.width, H = thinPx.height, rgba = new Uint8ClampedArray(thinPx.rgba);
    const cx = 10 / 2, rowOf = (x: number) => Math.round((x - cx) / 0.762);
    const thin = new Set([2, 3]);
    const keep = new Set<number>(), byRow = new Map<number, { x: number; y: number }[]>();
    truth.plants.forEach(p => { const k = rowOf(p.x); (byRow.get(k) ?? byRow.set(k, []).get(k)!).push(p); });
    for (const [k, ps] of byRow) ps.sort((u, v) => u.y - v.y).forEach((p, i) => { if (!thin.has(k) || i % 12 === 6) keep.add(truth.plants.indexOf(p)); });
    const soil = [86, 66, 52];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const q = j * W + i; if (truth.layer[q] !== 3) continue;
      const x = (i + 0.5) * GSD, y = -(j + 0.5) * GSD;
      if (!thin.has(rowOf(x))) continue;
      let best = -1, bd = Infinity;
      truth.plants.forEach((p, pi) => { if (rowOf(p.x) !== rowOf(x)) return; const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = pi; } });
      if (!keep.has(best)) { rgba[q * 4] = soil[0]; rgba[q * 4 + 1] = soil[1]; rgba[q * 4 + 2] = soil[2]; }
    }
    const thinStand: PhotoPixels = { width: W, height: H, rgba };
    const kept = [...keep].filter(i => thin.has(rowOf(truth.plants[i].x))).map(i => truth.plants[i]);
    const nearKept = (x: number, y: number) => kept.some(p => Math.hypot(p.x - x * GSD, p.y + y * GSD) < 0.12);
    // The frozen reader: the thin rows dropped, their surviving corn called weeds (the failure this guards against).
    const frozen = readRowCrop(thinStand, P);
    const frozenCornWeeds = frozen.weeds.filter(w => nearKept(w.x, w.y)).length;
    expect(frozenCornWeeds).toBeGreaterThanOrEqual(3);
    // The adaptive reader: none of that corn is a weed candidate; it is corn on an unsupported row (or on a held row).
    const ad = readCornAdaptive(thinStand, P);
    const asWeeds = ad.weeds.filter(w => w.verdict === "weed candidate" && nearKept(w.x, w.y)).length;
    expect(asWeeds).toBe(0);
    expect(ad.summary.weeds).toBeLessThanOrEqual(1);
  });
});
