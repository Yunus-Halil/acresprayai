// Corn V1 over a field (src/lib/fieldTwin/cornField.ts): three overlapping straight-down cameras over a known corn
// field, each photograph's "read" made from the truth through Direct's own camera model, with single-photograph errors
// planted, to check that the field keeps what the photographs agree on and withholds what one of them made up.
import { describe, expect, it } from "vitest";
import { cornField, type CornPhotoRead } from "@/lib/fieldTwin/cornField";
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

  it("reports in latitude and longitude as well as local metres", () => {
    const r = f.rows[0], [lat, lng] = r.line[0], back = toEnu({ lat, lng, altM: 0 }, f.origin);
    expect(Math.hypot(back[0] - r.lineEN[0][0], back[1] - r.lineEN[0][1])).toBeLessThan(1e-3);
  });
});
