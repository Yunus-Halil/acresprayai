// The photographs aligned to each other, all together, by their plants (fieldTwin/alignTogether.ts).
import { describe, expect, it } from "vitest";
import { ALIGN_TOGETHER, alignTogether, matchedMarks, pairsOnEachOther } from "@/lib/fieldTwin/alignTogether";
import { type PhotoShift, type Sight, shiftOf } from "@/lib/fieldTwin/plantsFirst";

// A repeatable random number, so a failure can be run again.
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

/** Rows of plants with uneven spacing and skips, as corn stands: metres east and north. */
function planting(rand: () => number, rows = 14, lengthM = 26, rowM = 0.9, seedM = 0.14): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < rows; r++) for (let a = 0.05 * rand(); a < lengthM; a += seedM * (0.75 + 0.5 * rand()) + (rand() < 0.06 ? seedM : 0)) out.push([a, r * rowM + 0.01 * (rand() - 0.5)]);
  return out;
}

const PX = 0.006; // metres a pixel
type Wrong = { de: number; dn: number; turn: number; scale: number };

/** Photographs over the planting: each marks most of the plants in its frame, placed with its own error. */
function flight(rand: () => number, plants: [number, number][], wrong: (p: number) => Wrong, seen = 0.85) {
  const centres: [number, number][] = []; for (const n of [3.5, 8.5]) for (let e = 5; e <= 21; e += 4) centres.push([e, n]);
  const sights: Sight[] = [], halfE = 7, halfN = 5;
  centres.forEach(([ce, cn], p) => {
    const w = wrong(p);
    for (const [e, n] of plants) {
      const ge = e - ce, gn = n - cn; if (Math.abs(ge) > halfE || Math.abs(gn) > halfN || rand() > seen) continue;
      // Where the camera, a little turned and a little off in height, says the plant is.
      const c = Math.cos(w.turn), s = Math.sin(w.turn), we = ce + w.de + (1 + w.scale) * (c * ge - s * gn), wn = cn + w.dn + (1 + w.scale) * (s * ge + c * gn);
      sights.push({ p, u: 1200 + ge / PX, v: 900 - gn / PX, e: we + 0.004 * (rand() - 0.5), n: wn + 0.004 * (rand() - 0.5) });
    }
  });
  return { sights, photos: centres.length };
}

const still = (n: number): PhotoShift[] => Array.from({ length: n }, () => ({ e: [0, 0, 0], n: [0, 0, 0], u0: 1200, v0: 900, cells: 0 }));
const place = (sights: Sight[], shifts: PhotoShift[]) => { const xs = new Float64Array(sights.length), ys = new Float64Array(sights.length); sights.forEach((s, i) => { const [de, dn] = shiftOf(shifts[s.p], s.u, s.v); xs[i] = s.e + de; ys[i] = s.n + dn; }); return { xs, ys }; };

describe("alignTogether", () => {
  it("brings photographs that are each a little turned and scaled onto each other, and says so", () => {
    const rand = rng(7), plants = planting(rand);
    const F = flight(rand, plants, () => ({ de: 0.03 * (rand() - 0.5), dn: 0.03 * (rand() - 0.5), turn: 0.008 * (rand() - 0.5), scale: 0.008 * (rand() - 0.5) }));
    const start = still(F.photos), A = alignTogether(F.sights, F.photos, start, 0.048);
    expect(A.report.applied).toBe(true);
    expect(A.report.why).toBeNull();
    // The check it applies by: more marks have another photograph's mark within 2 cm.
    const before = place(F.sights, start), after = place(F.sights, A.shifts);
    const m0 = matchedMarks(F.sights, before.xs, before.ys, 0.02), m1 = matchedMarks(F.sights, after.xs, after.ys, 0.02);
    expect(A.report.matched).toEqual([m0, m1]);
    expect(m1).toBeGreaterThan(m0 + 0.2 * F.sights.length);
    expect(m1 / F.sights.length).toBeGreaterThan(0.8);
    expect(A.report.medianM[1]).toBeLessThan(0.01);
    expect(A.report.overGate[1]).toBeLessThan(A.report.overGate[0]);
    // And it did not get there by moving the field: no mark went further than the errors put in could ask.
    expect(A.report.movedMostM).toBeLessThan(0.25);
  });

  it("is not fooled by a whole plant spacing: marks end on their own plant, not the next one along the row", () => {
    const rand = rng(11), plants = planting(rand);
    // Every other photograph placed 9 cm along the rows from the rest. Plants stand 14 cm apart, so the NEXT plant's
    // repeat lies only 5 cm the other way: a search for the nearest match would take that one and be a plant off.
    const F = flight(rand, plants, p => ({ de: p % 2 ? 0.09 : 0, dn: 0, turn: 0, scale: 0 }));
    const start = still(F.photos), A = alignTogether(F.sights, F.photos, start, 0.048);
    expect(A.report.applied).toBe(true);
    // The photographs' corrections differ by the 9 cm put in, not by the 5 cm the other way.
    const d = (p: number) => shiftOf(A.shifts[p], 1200, 900)[0];
    for (let p = 1; p < F.photos; p += 2) { expect(d(p - 1) - d(p)).toBeGreaterThan(0.075); expect(d(p - 1) - d(p)).toBeLessThan(0.105); }
  });

  it("sees photographs put a whole plant along the row from where they belong, which the matched share alone does not", () => {
    const rand = rng(5), plants = planting(rand), F = flight(rand, plants, () => ({ de: 0, dn: 0, turn: 0, scale: 0 }));
    const right = place(F.sights, still(F.photos)), on = pairsOnEachOther(F.sights, right.xs, right.ys, F.photos, 0.048);
    expect(on.pairs).toBeGreaterThan(5);
    expect(on.on).toBe(on.pairs);
    // Every other photograph slid one plant spacing along the rows: plants still fall on plants, the wrong ones.
    const slid = { xs: Float64Array.from(right.xs, (x, i) => x + (F.sights[i].p % 2 ? 0.14 : 0)), ys: right.ys }, off = pairsOnEachOther(F.sights, slid.xs, slid.ys, F.photos, 0.048);
    expect(off.on).toBeLessThan(0.7 * off.pairs);
    // The share of marks with a match stays high all the same: it is not the test for this.
    expect(matchedMarks(F.sights, slid.xs, slid.ys, 0.02)).toBeGreaterThan(0.4 * F.sights.length);
    // And the alignment reports the pairs it read.
    const A = alignTogether(F.sights, F.photos, still(F.photos), 0.048);
    expect(A.report.pairs).toBeGreaterThan(5);
    expect(A.report.pairsOn).toBeGreaterThanOrEqual(ALIGN_TOGETHER.pairsOn * A.report.pairs);
    // Per photograph, how much of its ground the others agree with: all of them here.
    expect(A.report.photoOn.length).toBe(F.photos);
    for (const v of A.report.photoOn) expect(v).toBeGreaterThan(0.8);
    // One photograph put a plant along the rows from the rest reads low, and only that one.
    const one = rng(9), P2 = planting(one), F2 = flight(one, P2, p => ({ de: p === 3 ? 0.14 : 0, dn: 0, turn: 0, scale: 0 }));
    const A2 = alignTogether(F2.sights, F2.photos, still(F2.photos), 0.048, { ...ALIGN_TOGETHER, rounds: 1, holdM: 0.00002, minGain: -Infinity, pairsOn: 0 }); // held so hard that nothing moves: the measure alone
    expect(A2.report.photoOn[3]).toBeLessThan(0.5);
    expect(A2.report.photoOn.filter((v, p) => p !== 3 && v < 0.5).length).toBe(0);
  });

  it("leaves the photographs as they were where their marks share no plants", () => {
    const rand = rng(3), n = 6, sights: Sight[] = [];
    // Scattered green, different in every photograph: nothing to align on.
    for (let p = 0; p < n; p++) for (let k = 0; k < 1500; k++) { const e = 20 * rand(), nn = 10 * rand(); sights.push({ p, u: e / PX, v: nn / PX, e, n: nn }); }
    const start = still(n), A = alignTogether(sights, n, start, 0.048);
    expect(A.report.applied).toBe(false);
    expect(A.report.why).toBeTruthy();
    expect(A.shifts).toBe(start);
  });

  it("is on in the app's preset with the merge gate kept, off in the old path, and has its own kill switch", async () => {
    const { PLANTS_FIRST } = await import("@/lib/fieldTwin/plantsFirst"), { CORN_PRESET_SETTINGS, cornAlignOn } = await import("@/lib/fieldTwin/cornPreset");
    expect(Object.keys(PLANTS_FIRST)).not.toContain("together");
    expect(CORN_PRESET_SETTINGS.today.plants.together).toBeUndefined();
    expect(CORN_PRESET_SETTINGS.final3.plants.together).toEqual({ gate: "kept" });
    expect(cornAlignOn({})).toBe(true);
    expect(cornAlignOn({ VITE_CORN_ALIGN: "1" })).toBe(true);
    expect(cornAlignOn({ VITE_CORN_ALIGN: "0" })).toBe(false);
    expect(ALIGN_TOGETHER.checkM).toBe(0.02);
  });
});
