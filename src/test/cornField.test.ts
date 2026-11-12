// Corn V1 over a field (src/lib/fieldTwin/cornField.ts): three overlapping straight-down cameras over a known corn
// field, each photograph's "read" made from the truth through Direct's own camera model, with single-photograph errors
// planted, to check that the field keeps what the photographs agree on and withholds what one of them made up.
import { describe, expect, it } from "vitest";
import { FIELD, FIELD_V2, cornField, type CornPhotoRead } from "@/lib/fieldTwin/cornField";
import { IDENTITY, enuFromCamera, groundToPixel, mulM, type GeorefFrame, type M3 } from "@/lib/directGeoref/projection";
import { fromEnu, toEnu } from "@/lib/sourceFrames/odm";

const ORIGIN = { lat: 40, lng: -90, altM: 0 };
const PITCH = 0.762;
const M0 = enuFromCamera({ yawDeg: 0, pitchDeg: 0, rollDeg: 0, basis: "t" }, { rotation: IDENTITY, basis: "t" });
const M0t: M3 = [M0[0], M0[3], M0[6], M0[1], M0[4], M0[7], M0[2], M0[5], M0[8]];
// Straight down, image x to the east, image y to the south.
const NADIR: M3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];

function camera(name: string, e: number, n: number): GeorefFrame {
  const p = fromEnu([e, n, 0], ORIGIN);
  return {
    name,
    intrinsics: { width: 4000, height: 3000, fx: 2000, fy: 2000, cx: 2000, cy: 1500, distortion: null, basis: "test" },
    pose: { lat: p.lat, lng: p.lng, altM: 10, datum: "test", attitude: { yawDeg: 0, pitchDeg: 0, rollDeg: 0, basis: "t" }, boresight: { rotation: mulM(M0t, NADIR), basis: "t" }, basis: "test" },
    ground: { kind: "flat", altM: 0, datum: "test", basis: "test" },
  };
}
const px = (f: GeorefFrame, e: number, n: number) => { const p = fromEnu([e, n, 0], ORIGIN), h = groundToPixel(f, p.lat, p.lng, 0)!; return h.inside ? ([h.u, h.v] as [number, number]) : null; };

// The truth: rows along north at east = k x pitch; a real gap on row 2 from north 1.0 to 2.0 m.
const ROWS = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];
const inRealGap = (k: number, n: number) => k === 2 && n > 1.0 && n < 2.0;

function readOf(f: GeorefFrame, extra: Partial<CornPhotoRead> = {}): CornPhotoRead {
  const rows: CornPhotoRead["rows"] = [], plants: [number, number][] = [];
  for (const k of ROWS) {
    const pts: [number, number][] = [];
    for (let n = -20; n <= 30; n += 0.5) { const q = px(f, k * PITCH, n); if (q) pts.push(q); }
    if (pts.length >= 2) rows.push({ points: pts, identity: "corn", evidence: "both reads agree", confidence: "high" });
    for (let n = -20; n <= 30; n += 0.2) { if (inRealGap(k, n)) continue; const q = px(f, k * PITCH, n); if (q) plants.push(q); }
  }
  return { name: f.name, scale: 1, rows, patches: [], gaps: [], plants, ...extra };
}
const patch = (f: GeorefFrame, e: number, n: number, verdict: CornPhotoRead["patches"][number]["verdict"]) => { const c = px(f, e, n)!; const r = 12; return { x: c[0], y: c[1], hull: [[c[0] - r, c[1] - r], [c[0] + r, c[1] - r], [c[0] + r, c[1] + r], [c[0] - r, c[1] + r]] as [number, number][], touchesEdge: false, verdict }; };
const gap = (f: GeorefFrame, k: number, n1: number, n2: number) => { const a = px(f, k * PITCH, n1)!, b = px(f, k * PITCH, n2)!; return { x1: a[0], y1: a[1], x2: b[0], y2: b[1], verdict: "stand gap" as const }; };

describe("Corn V1 over a field", () => {
  // Footprints 20 x 15 m (east x north); cameras 4 m apart along north: every point in the middle seen three times.
  const A = camera("A", 0, -2), B = camera("B", 0, 2), C = camera("C", 0, 6);
  const frames = new Map([A, B, C].map(f => [f.name, f]));
  const weed = { e: 0.5 * PITCH, n: 2.5 }, fake = { e: 1.5 * PITCH, n: 3.2 }, onRow = { e: 3 * PITCH, n: 1.5 };
  const reads = [
    readOf(A, { patches: [patch(A, weed.e, weed.n, "weed candidate"), patch(A, onRow.e, onRow.n, "weed candidate")], gaps: [gap(A, 2, 1.0, 2.0)] }),
    readOf(B, { patches: [patch(B, weed.e, weed.n, "weed candidate"), patch(B, fake.e, fake.n, "weed candidate"), patch(B, onRow.e, onRow.n, "crop on a row")], gaps: [gap(B, 2, 1.0, 2.0), gap(B, -3, 3.0, 4.0)] }),
    readOf(C, { patches: [patch(C, weed.e, weed.n, "weed candidate")], gaps: [gap(C, 2, 1.0, 2.0)] }),
  ];
  const f = cornField(reads, frames);

  it("places the rows on the field's lattice, all photographs agreeing", () => {
    expect(Math.abs(f.pitchM! - PITCH)).toBeLessThan(0.01);
    expect(Math.abs(f.directionDeg! - 90)).toBeLessThan(0.5);
    expect(f.rowAgreementM!).toBeLessThan(0.01);
    expect(f.rows.length).toBe(ROWS.length);
    expect(f.rows.every(r => r.identity === "corn" && r.seenBy === 3)).toBe(true);
    // Each field row lies on its true line.
    for (const r of f.rows) { const e = r.lineEN.map(p => p[0]).sort((a, b) => a - b)[r.lineEN.length >> 1]; expect(Math.abs(e / PITCH - Math.round(e / PITCH))).toBeLessThan(0.02); }
  });

  it("keeps the weed all three photographs report, withholds the one only one reports, and a patch one calls the crop", () => {
    // Field positions are about the cameras' mean; the truth is about ORIGIN: compare through latitude and longitude.
    const at = (p: { e: number; n: number }) => f.weeds.find(w => { const q = toEnu({ lat: w.lat, lng: w.lng, altM: 0 }, ORIGIN); return Math.hypot(q[0] - p.e, q[1] - p.n) < 0.2; })!;
    expect(at(weed).verdict).toBe("weed candidate");
    expect(at(weed).votes["weed candidate"]).toBe(3);
    expect(at(fake).verdict).toBe("unknown vegetation");
    expect(at(onRow).verdict).toBe("crop on a row");
    expect(f.summary.weeds).toBe(1);
  });

  it("keeps the gap every photograph reports and no photograph sees a plant in; withholds the one another photograph sees plants in", () => {
    const real = f.gaps.find(g => Math.abs(g.aEN[0] - 2 * PITCH) < 0.1)!;
    expect(real.verdict).toBe("stand gap");
    expect(real.reportedBy.length).toBe(3);
    const made = f.gaps.find(g => Math.abs(g.aEN[0] + 3 * PITCH) < 0.1)!;
    expect(made.verdict).toBe("withheld");
    expect(made.plantSeenBy.length).toBeGreaterThan(0);
  });

  it("calls a row only one of three covering photographs holds a planted row, not corn", () => {
    // Photo C alone draws an extra row between the true rows at east 7.5 pitches (off the truth): seen by 1 of 3.
    const extraPts: [number, number][] = [];
    for (let n = 0; n <= 8; n += 0.5) { const q = px(C, 7 * PITCH, n); if (q) extraPts.push(q); }
    const r2 = [reads[0], reads[1], { ...reads[2], rows: [...reads[2].rows, { points: extraPts, identity: "corn" as const, evidence: "both reads agree", confidence: "high" as const }] }];
    const g = cornField(r2, frames);
    const extra = g.rows.find(r => Math.abs(r.lineEN[0][0] - 7 * PITCH) < 0.1)!;
    expect(extra.seenBy).toBe(1);
    expect(extra.coveredBy).toBeGreaterThanOrEqual(3);
    expect(extra.identity).toBe("probable crop");
  });

  it("leaves out an unconfirmed row between corn rows off their spacing, keeps one on the lattice", () => {
    // Photo C draws a row half a spacing off (between rows 1 and 2) and photo B one exactly on row 3's line but
    // calls it not confirmed... both seen once while three photographs cover them.
    const line = (f: GeorefFrame, e: number) => { const pts: [number, number][] = []; for (let n = 0; n <= 8; n += 0.5) { const q = px(f, e, n); if (q) pts.push(q); } return pts; };
    const half = { points: line(C, 1.5 * PITCH), identity: "probable crop" as const, evidence: "plant read only", confidence: "medium" as const };
    const r2 = [reads[0], reads[1], { ...reads[2], rows: [...reads[2].rows, half] }];
    const g = cornField(r2, frames);
    expect(g.summary.offLatticeDropped).toBe(1);
    expect(g.rows.some(r => Math.abs(r.lineEN[0][0] - 1.5 * PITCH) < 0.1)).toBe(false);
    expect(g.rows.length).toBe(ROWS.length);
  });

  // 2026-11-05, checked by eye on three UAV3DCrop flights: a covering photograph that reports nothing is not a vote
  // against (the weed is there, under a leaf from that angle); where a weed stands is judged on the field's rows.
  it("confirms a weed two photographs report though four covering it are silent; withholds one on a row's line or beyond the outer corn row", () => {
    const cams = ["P", "Q", "R", "S", "T", "U"].map((name, i) => camera(name, 0, -1 + 0.8 * i));
    const fr = new Map(cams.map(c => [c.name, c]));
    // Corn rows k <= 2; rows 3 to 6 a planted row whose crop no photograph confirms.
    const quiet = { e: -1.5 * PITCH, n: 1.2 }, onLine = { e: -3 * PITCH + 0.05, n: 1.4 }, beyond = { e: 3.5 * PITCH, n: 1.3 };
    const rd = cams.map((c, i) => {
      const base = readOf(c);
      // readOf builds one row per entry of ROWS, in order (every camera here sees all of them).
      const ided = base.rows.map((r, j) => (ROWS[j] >= 3 ? { ...r, identity: "probable crop" as const, confidence: "medium" as const, evidence: "green read only" } : r));
      const patches = i < 2 ? [patch(c, quiet.e, quiet.n, "weed candidate"), patch(c, onLine.e, onLine.n, "weed candidate"), patch(c, beyond.e, beyond.n, "weed candidate")] : [];
      return { ...base, rows: ided, patches };
    });
    const g = cornField(rd, fr);
    const at = (p: { e: number; n: number }) => g.weeds.find(w => { const q = toEnu({ lat: w.lat, lng: w.lng, altM: 0 }, ORIGIN); return Math.hypot(q[0] - p.e, q[1] - p.n) < 0.2; })!;
    expect(g.rows.filter(r => r.identity === "corn").length).toBe(9);
    expect(at(quiet).coveredBy).toBe(6);
    expect(at(quiet).seenBy).toBe(2);
    expect(at(quiet).verdict).toBe("weed candidate");
    expect(at(onLine).verdict).toBe("crop on a row");
    expect(at(beyond).verdict).toBe("unknown vegetation");
    expect(at(beyond).why).toMatch(/not between the rows beside a corn row/);
  });

  it("reports in latitude and longitude as well as local metres", () => {
    const r = f.rows[0], [lat, lng] = r.line[0], back = toEnu({ lat, lng, altM: 0 }, f.origin);
    expect(Math.hypot(back[0] - r.lineEN[0][0], back[1] - r.lineEN[0][1])).toBeLessThan(1e-3);
  });
});

// cornField v3 (2026-11-12): the located plants say where the planting is. The first flight of someone else's field
// (very early corn beside a weedy headland) had 2,100 m of "rows" strung through the headland's weeds.
describe("Corn V1 over a field: the planting, from the located plants", () => {
  const A = camera("A", 0, -2), B = camera("B", 0, 2), C = camera("C", 0, 6);
  const frames = new Map([A, B, C].map(f => [f.name, f]));
  const eOf = (r: { lineEN: [number, number][] }, g: { origin: { lat: number; lng: number } }) => { const m = r.lineEN[r.lineEN.length >> 1], p = fromEnu([m[0], m[1], 0], { ...g.origin, altM: 0 }); return toEnu({ lat: p.lat, lng: p.lng, altM: 0 }, ORIGIN)[0]; };
  const line = (f: GeorefFrame, e0: number, n0: number, e1: number, n1: number) => { const pts: [number, number][] = []; for (let t = 0; t <= 1.0001; t += 0.05) { const q = px(f, e0 + (e1 - e0) * t, n0 + (n1 - n0) * t); if (q) pts.push(q); } return pts; };
  const unconfirmed = (points: [number, number][]) => ({ points, identity: "probable crop" as const, evidence: "plant read only", confidence: "medium" as const });
  // A headland east of the last row (east 4.6 m): weeds scattered at six a square metre, and each photograph
  // stringing three "rows" through them along the planting.
  let s = 7; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  const weeds: [number, number][] = []; for (let i = 0; i < 6 * 5 * 30; i++) weeds.push([5.2 + 4.6 * rnd(), -12 + 30 * rnd()]);
  const withHeadland = (f: GeorefFrame): CornPhotoRead => {
    const base = readOf(f);
    return { ...base, plants: [...base.plants, ...weeds.map(([e, n]) => px(f, e, n)).filter((q): q is [number, number] => !!q)], rows: [...base.rows, ...[6.6, 7.5, 8.7].map(e => unconfirmed(line(f, e, -8, e + 0.1, 12))).filter(r => r.points.length >= 2)] };
  };

  it("leaves out the rows strung through a headland's scattered weeds, and keeps every row of the planting to its edge", () => {
    const reads = [A, B, C].map(withHeadland);
    const old = cornField(reads, frames, FIELD_V2), g = cornField(reads, frames);
    expect(old.rows.filter(r => eOf(r, old) > 6).length).toBeGreaterThanOrEqual(3);
    expect(g.planting.judged).toBe(true);
    expect(g.planting.scatteredM2).toBeGreaterThan(40);
    expect(g.planting.scatteredRowM).toBeGreaterThan(50);
    expect(g.rows.filter(r => eOf(r, g) > 5.4).length).toBe(0);
    const corn = g.rows.filter(r => r.identity === "corn");
    expect(corn.length).toBe(ROWS.length);
    expect(Math.max(...corn.map(r => eOf(r, g)))).toBeCloseTo(6 * PITCH, 1);
    expect(Math.abs(g.planting.plantSpacingM! - PITCH)).toBeLessThan(0.01);
    expect(g.notes.join(" ")).toMatch(/plants are scattered/);
  });

  it("leaves out a piece a photograph drew across the planting", () => {
    // On the bare soil west of the planting, so that nothing else could remove it (blocks off: it is also a scrap).
    const reads = [readOf(A), { ...readOf(B), rows: [...readOf(B).rows, unconfirmed(line(B, -9, 0, -6, 5))] }, readOf(C)];
    const old = cornField(reads, frames, FIELD_V2), g = cornField(reads, frames, { ...FIELD, block: null });
    expect(old.rows.length).toBe(ROWS.length + 1);
    expect(g.rows.length).toBe(ROWS.length);
    expect(g.planting.crossDirectionRowM).toBeGreaterThan(5);
    expect(g.planting.scatteredRowM).toBe(0);
  });

  it("leaves out a scrap of unconfirmed row standing apart from the planting, and keeps a confirmed one unless it is a few metres", () => {
    // West of the planting the soil is bare (no plants: the ground is not judged there). A 2 m line 4 m from the outer row.
    const scrap = (f: GeorefFrame, identity: "corn" | "probable crop") => ({ points: line(f, -8.6, 1, -8.6, 3), identity, evidence: "plant read only", confidence: "medium" as const });
    const one = cornField([{ ...readOf(A), rows: [...readOf(A).rows, scrap(A, "probable crop")] }, readOf(B), readOf(C)], frames);
    expect(one.planting.scrapRows).toBe(1);
    expect(one.rows.length).toBe(ROWS.length);
    // The planting here holds about 300 m of row: a confirmed 2 m is under a hundredth of it, a confirmed 5 m is not.
    const all = cornField([A, B, C].map(f => ({ ...readOf(f), rows: [...readOf(f).rows, scrap(f, "corn")] })), frames);
    expect(all.planting.scrapRows).toBe(1);
    expect(all.rows.length).toBe(ROWS.length);
    const longer = (f: GeorefFrame) => ({ points: line(f, -8.6, 0, -8.6, 5), identity: "corn" as const, evidence: "both reads agree", confidence: "high" as const });
    const five = cornField([A, B, C].map(f => ({ ...readOf(f), rows: [...readOf(f).rows, longer(f)] })), frames);
    expect(five.planting.scrapRows).toBe(0);
    expect(five.rows.length).toBe(ROWS.length + 1);
  });

  it("reports no stand gap on a flight whose photographs each miss a third of the rows", () => {
    // Every row is held by two of the three photographs covering it: enough to be corn, not enough for "no plant seen"
    // to mean a gap. The true gap on row 2 (no plant in it in any photograph) is reported by both photographs holding it.
    const missing = (f: GeorefFrame, m: number, gaps: CornPhotoRead["gaps"]) => { const base = readOf(f); return { ...base, rows: base.rows.filter((_, j) => (((ROWS[j] % 3) + 3) % 3) !== m), gaps }; };
    const reads = [missing(A, 0, [gap(A, 2, 1.0, 2.0)]), missing(B, 1, [gap(B, 2, 1.0, 2.0)]), missing(C, 2, [])];
    const old = cornField(reads, frames, FIELD_V2), g = cornField(reads, frames);
    expect(old.gaps.some(q => q.verdict === "stand gap")).toBe(true);
    expect(g.rows.filter(r => r.identity === "corn").length).toBe(ROWS.length);
    expect(g.planting.readShare!).toBeGreaterThan(0.6);
    expect(g.planting.readShare!).toBeLessThan(0.75);
    expect(g.gaps.length).toBe(0);
    expect(g.planting.gapsNotReported).toBe(1);
    expect(g.notes.join(" ")).toMatch(/Stand gaps are not reported on this flight/);
    // The well-read field of the tests above keeps its gap: every photograph holds every row.
    expect(cornField([A, B, C].map(f => readOf(f, { gaps: [gap(f, 2, 1.0, 2.0)] })), frames).planting.readShare!).toBeGreaterThan(0.9);
  });

  it("judges nothing by the plants where none are located (a canopy), and then changes no row", () => {
    const reads = [A, B, C].map(f => ({ ...withHeadland(f), plants: [] }));
    const old = cornField(reads, frames, FIELD_V2), g = cornField(reads, frames, { ...FIELD, block: null });
    expect(g.planting.judged).toBe(false);
    expect(g.planting.why).toMatch(/too few plants/);
    expect(g.rows).toEqual(old.rows);
  });

  it("gives cornField v2's result when asked for it", () => {
    const g = cornField([A, B, C].map(withHeadland), frames, FIELD_V2);
    expect(g.planting).toMatchObject({ judged: false, scatteredRowM: 0, crossDirectionRowM: 0, scrapRows: 0, readShare: null });
  });
});
