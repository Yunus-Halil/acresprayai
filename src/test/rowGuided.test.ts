// Reading along the rows the field already knows (src/lib/fieldTwin/rowGuided.ts), on rendered photographs: a straight-down
// camera over soil with seedlings on rows and a few weeds between them, so every behaviour is checked against a known truth.
import { describe, expect, it } from "vitest";
import { IDENTITY, enuFromCamera, mulM, type GeorefFrame, type M3 } from "@/lib/directGeoref/projection";
import { fromEnu } from "@/lib/sourceFrames/odm";
import { ROW_GUIDED, chooseLevel, mergeAlongRows, registerAlong, rowExtents, searchPhoto, seedSpacing, shiftAlong, type PhotoSearch, type RowLine } from "@/lib/fieldTwin/rowGuided";

const ORIGIN = { lat: 40, lng: -90, altM: 0 };
const PITCH = 0.76, GSD = 0.005, W = 1000, H = 800, FX = 1000, ALT = FX * GSD;
const M0 = enuFromCamera({ yawDeg: 0, pitchDeg: 0, rollDeg: 0, basis: "t" }, { rotation: IDENTITY, basis: "t" });
const M0t: M3 = [M0[0], M0[3], M0[6], M0[1], M0[4], M0[7], M0[2], M0[5], M0[8]];
const NADIR: M3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];
/** Straight down at (e, n), image x to the east, image y to the south. */
function camera(name: string, e: number, n: number): GeorefFrame {
  const p = fromEnu([e, n, 0], ORIGIN);
  return { name, intrinsics: { width: W, height: H, fx: FX, fy: FX, cx: W / 2, cy: H / 2, distortion: null, basis: "test" }, pose: { lat: p.lat, lng: p.lng, altM: ALT, datum: "test", attitude: { yawDeg: 0, pitchDeg: 0, rollDeg: 0, basis: "t" }, boresight: { rotation: mulM(M0t, NADIR), basis: "t" }, basis: "test" }, ground: { kind: "flat", altM: 0, datum: "test", basis: "test" } };
}
const ROWS = [-3, -2, -1, 0, 1, 2, 3];
/** Plants on the rows every 15 cm (a few missing, jittered); weeds scattered between rows, far fewer. */
function truth(seed = 3) {
  let s = seed; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  const plants: [number, number][] = [], weeds: [number, number][] = [];
  for (const k of ROWS) for (let n = -2.2; n <= 2.2; n += 0.15) if (rnd() > 0.1) plants.push([k * PITCH + (rnd() - 0.5) * 0.02, n + (rnd() - 0.5) * 0.03]);
  // Weeds anywhere between the rows (not on a row's line), about 1.5 a square metre.
  for (let i = 0; i < 25; i++) weeds.push([(Math.floor(rnd() * 6) - 3) * PITCH + 0.15 + rnd() * (PITCH - 0.3), -2.2 + rnd() * 4.4]);
  return { plants, weeds };
}
/** The photograph a camera at (e, n) takes of that truth: pale soil with noise, olive seedlings, smaller weeds. */
function render(e0: number, n0: number, t = truth()) {
  let s = 11; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { const q = (rnd() - 0.5) * 16; rgba[i * 4] = 182 + q; rgba[i * 4 + 1] = 164 + q; rgba[i * 4 + 2] = 132 + q; rgba[i * 4 + 3] = 255; }
  const blob = (e: number, n: number, rM: number, c: [number, number, number]) => {
    const u = W / 2 + (e - e0) / GSD, v = H / 2 - (n - n0) / GSD, r = rM / GSD;
    for (let y = Math.floor(v - r); y <= v + r; y++) for (let x = Math.floor(u - r); x <= u + r; x++) { if (x < 0 || y < 0 || x >= W || y >= H || Math.hypot(x - u, y - v) > r) continue; const o = (y * W + x) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; }
  };
  for (const [e, n] of t.plants) blob(e, n, 0.012, [92, 128, 64]);
  for (const [e, n] of t.weeds) blob(e, n, 0.008, [100, 124, 70]);
  return { width: W, height: H, rgba };
}
const rows: RowLine[] = ROWS.map((k, i) => ({ id: i + 1, a0: -2.4, stepM: 0.2, en: Array.from({ length: 25 }, (_, j) => [k * PITCH, -2.4 + j * 0.2] as [number, number]) }));
const perM = (s: PhotoSearch, strip: number) => { const bar = ROW_GUIDED.ladder[chooseLevel(s).level]; return (s.candidates.filter(c => c.strip === strip && c.z >= bar).length / s.rowM) * (strip === 0 ? 1 : s.controlScale); };

describe("reading along the rows", { timeout: 60_000 }, () => {
  const t = truth();
  it("finds the seedlings on the rows and few candidates on the strips between them", () => {
    const s = searchPhoto("A", render(0, 0, t), camera("A", 0, 0), rows, ORIGIN, PITCH, 0.06);
    expect(s.rowM).toBeGreaterThan(20);
    expect(perM(s, 0)).toBeGreaterThan(4);
    expect(perM(s, 0)).toBeGreaterThan(5 * Math.max(perM(s, 1), perM(s, 2), 0.05));
    // Candidates sit where the plants are: within 2 cm across of the row line.
    const bar = ROW_GUIDED.ladder[chooseLevel(s).level], on = s.candidates.filter(c => c.strip === 0 && c.z >= bar);
    expect(on.filter(c => Math.abs(c.off) <= 0.02).length).toBeGreaterThan(0.8 * on.length);
  });

  it("finds a photograph's rows where its camera is off across the rows by a third of a spacing", () => {
    // The photograph is taken 25 cm east of where its camera says: the field's rows project between its plants.
    const s = searchPhoto("B", render(0.25, 0, t), camera("B", 0, 0), rows, ORIGIN, PITCH, 0.06);
    expect(s.registration.applied).toBe(true);
    expect(Math.abs(Math.abs(s.registration.shiftM) - 0.25)).toBeLessThan(0.03);
    expect(perM(s, 0)).toBeGreaterThan(5 * Math.max(perM(s, 1), perM(s, 2), 0.05));
    // Without looking for it (a search a centimetre wide), the same photograph finds next to nothing on its rows.
    const blind = searchPhoto("B", render(0.25, 0, t), camera("B", 0, 0), rows, ORIGIN, PITCH, 0.06, { ...ROW_GUIDED, registerShare: 0.01 });
    expect(perM(blind, 0)).toBeLessThan(0.3 * perM(s, 0));
  });

  it("merges one plant seen by two photographs into one mark, once their along offset is measured", () => {
    // Photograph D is 12 cm off along the rows: without the along registration its plants and C's do not meet.
    const c = searchPhoto("C", render(0, 0, t), camera("C", 0, 0), rows, ORIGIN, PITCH, 0.06);
    const d = searchPhoto("D", render(0, 0.12, t), camera("D", 0, 0), rows, ORIGIN, PITCH, 0.06);
    const bars = [c, d].map(s => ROW_GUIDED.ladder[chooseLevel(s).level]);
    const shift = registerAlong([c, d], bars, 0.15).map(s => s.a);
    expect(Math.abs(Math.abs(shift[0] - shift[1]) - 0.12)).toBeLessThan(0.03);
    // How far a two-view mark lies from the nearest true plant: unregistered, a plant and its neighbour 3 cm off pair up
    // and the mark falls between them.
    const error = (marks: { row: number; a: number; views: number }[]) => {
      const two = marks.filter(m => m.views === 2), ds = two.map(m => Math.min(...t.plants.filter(([e]) => Math.abs(e - ROWS[m.row - 1] * PITCH) < 0.05).map(([, n]) => Math.abs(n - m.a)))).sort((x, y) => x - y);
      return ds[ds.length >> 1];
    };
    // Camera C is where it says; its marks are in field coordinates, so register D onto C (C unmoved).
    const reg = shiftAlong([c, d], [0, shift[1] - shift[0]]);
    const before = error(mergeAlongRows([c, d], rows, 0.04).marks), after = error(mergeAlongRows(reg, rows, 0.04).marks);
    expect(after).toBeLessThan(0.006);
    expect(before).toBeGreaterThan(2 * after);
    // Most plants both photographs cover are one mark of two views (the frames see north -2 to 2 m, less the 12 cm).
    const covered = t.plants.filter(([, n]) => n > -1.75 && n < 1.75).length;
    expect(mergeAlongRows(reg, rows, 0.04).marks.filter(m => m.views === 2).length).toBeGreaterThan(0.75 * covered);
  });

  it("registers a photograph whose camera is turned 2 degrees: plants at its edges are off along the rows in opposite directions", () => {
    // Photograph F sees the field turned 2 degrees about its centre: a plant on the outer row (2.3 m out) lies 8 cm
    // along from where its camera puts it, the opposite way on the other side. One offset for the frame cannot fix both.
    const th = (2 * Math.PI) / 180, turned = { plants: t.plants.map(([e, n]) => [e * Math.cos(th) - n * Math.sin(th), e * Math.sin(th) + n * Math.cos(th)] as [number, number]), weeds: t.weeds };
    const e = searchPhoto("E", render(0, 0, t), camera("E", 0, 0), rows, ORIGIN, PITCH, 0.06);
    const f = searchPhoto("F", render(0, 0, turned), camera("F", 0, 0), rows, ORIGIN, PITCH, 0.06);
    const bars = [e, f].map(s => ROW_GUIDED.ladder[chooseLevel(s).level]);
    const twoView = (shift: Parameters<typeof shiftAlong>[1]) => mergeAlongRows(shiftAlong([e, f], shift), rows, 0.04).marks.filter(m => m.views === 2).length;
    const plane = registerAlong([e, f], bars, 0.15), single = registerAlong([e, f], bars, 0.15, 0.45, 5, false);
    expect(plane[1].cells).toBeGreaterThanOrEqual(4);
    // Registered as a plane, most plants both photographs see merge; as one offset, the outer rows' do not.
    const covered = t.plants.filter(([, n]) => n > -1.9 && n < 1.9).length;
    expect(twoView(plane)).toBeGreaterThan(0.75 * covered);
    expect(twoView(plane)).toBeGreaterThan(1.2 * twoView(single));
  });
});

describe("seedlings that are dark but barely green", { timeout: 60_000 }, () => {
  it("are found along the rows when darkness against the soil counts, and missed on greenness alone", () => {
    // The same field with every plant stressed brown: no greener than the soil, but well darker than it.
    const t = truth(), brown = (() => { const r = render(0, 0, { plants: [], weeds: [] }); return r; })();
    // Draw brown seedlings onto the bare render (the render draws green ones; here the plants are brown).
    for (const [e, n] of t.plants) { const u = W / 2 + e / GSD, v = H / 2 - n / GSD, rr = 0.012 / GSD; for (let y = Math.floor(v - rr); y <= v + rr; y++) for (let x = Math.floor(u - rr); x <= u + rr; x++) { if (x < 0 || y < 0 || x >= W || y >= H || Math.hypot(x - u, y - v) > rr) continue; const o = (y * W + x) * 4; brown.rgba[o] = 96; brown.rgba[o + 1] = 84; brown.rgba[o + 2] = 70; } }
    const tintOnly = searchPhoto("G", brown, camera("G", 0, 0), rows, ORIGIN, PITCH, 0.06);
    const withDark = searchPhoto("G", brown, camera("G", 0, 0), rows, ORIGIN, PITCH, 0.06, { ...ROW_GUIDED, darkWeight: 1 });
    expect(perM(withDark, 0)).toBeGreaterThan(4);
    expect(perM(withDark, 0)).toBeGreaterThan(5 * Math.max(perM(withDark, 1), perM(withDark, 2), 0.05));
    expect(perM(tintOnly, 0)).toBeLessThan(0.3 * perM(withDark, 0));
  });
});

describe("what the marks say along a row", () => {
  it("measures the seed spacing though plants are missing, within what corn is sown at", () => {
    let s = 5; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
    const marks: { row: number; a: number }[] = [];
    for (let row = 1; row <= 6; row++) for (let a = 0; a < 30; a += 0.15) if (rnd() > 0.4) marks.push({ row, a: a + (rnd() - 0.5) * 0.03 });
    const sp = seedSpacing(marks, 0.76);
    expect(sp.spacingM).not.toBeNull();
    expect(Math.abs(sp.spacingM! - 0.15)).toBeLessThan(0.01);
    expect(sp.allowedM[0]).toBeLessThan(0.15); expect(sp.allowedM[1]).toBeGreaterThan(0.15);
  });

  it("lets a row cross a wheel track, and stops it before a few strays in the headland", () => {
    const marks: { row: number; a: number; strip: 0 }[] = [];
    for (let a = 0; a <= 10; a += 0.15) if (a < 4 || a > 5) marks.push({ row: 1, a, strip: 0 });
    for (const a of [13, 16.5]) marks.push({ row: 1, a, strip: 0 });
    const e = rowExtents(marks, [1], 0.15).get(1)!;
    expect(e[0]).toBeLessThan(0.1); expect(e[1]).toBeGreaterThan(9.9); expect(e[1]).toBeLessThan(11);
  });
});
