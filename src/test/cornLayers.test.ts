// The corn pipeline's layers (fieldTwin/layers, 2026-11-18): each new option is off by default and, off, changes
// nothing; on, it does what its layer says.
//  - L5 records the plant spacing's spread (quartiles of the single spacings, fences) without anything reading it;
//  - 2a: the ground judged from L4's certain plants only, in place of the field's;
//  - 3a: the cores' blurs from the typical plant size, only when a size is given;
//  - 3b: the too-close limit from the spread's lower fence, held between two shares of the spacing;
//  - L7: without its option, or without a way to read the photographs, the reading passes through unchanged;
//  - L8: a plant is unsure where a photograph's mark of it was added by a core alone;
//  - the guard over a flight drops a misread photograph's look with its marks.
import { describe, expect, it } from "vitest";
import { type CornPhotoRead, cornFlightGuard } from "@/lib/fieldTwin/cornField";
import { reconstruct } from "@/lib/fieldTwin/layers/chain";
import { CORN_CORES, coresAsked } from "@/lib/fieldTwin/layers/l1Views";
import { gapsOnLines, groundFromObvious, quartiles, spacingSpread } from "@/lib/fieldTwin/layers/l5Profile";
import { secondLookOnField } from "@/lib/fieldTwin/layers/l7SecondLook";
import { unsureList } from "@/lib/fieldTwin/layers/l8Report";
import { LAYERS } from "@/lib/fieldTwin/layers/options";
import { type Dot, PLANTS_FIRST, SEQUENCE, type Sight } from "@/lib/fieldTwin/plantsFirst";
import { CORN_COUNT_GUARD } from "@/lib/rowCrop/cornV1";

// Six rows 0.9 m apart running east, a plant every 0.15 m from 0 to 24 m, each made by 5 of the 8 photographs that looked.
const S = 0.9, SEED = 0.15;
const dot = (e: number, n: number, photos = 5): Dot => ({ e, n, members: [], photos, spreadM: 0.01 });
const planting = (): Dot[] => { const d: Dot[] = []; for (let r = 0; r < 6; r++) for (let k = 0; k * SEED <= 24 + 1e-9; k++) d.push(dot(k * SEED + (k % 3 === 1 ? 0.012 : k % 3 === 2 ? -0.01 : 0), r * S)); return d; };
const read = (dots: Dot[], layers = LAYERS, q = SEQUENCE) => reconstruct(dots, new Int32Array(dots.length).fill(8), 0, S, PLANTS_FIRST, q, null, null, null, null, layers);

describe("L5: the plant spacing's spread", () => {
  it("quartiles and fences of the single spacings", () => {
    expect(quartiles([4, 1, 3, 2])).toEqual({ q1: 2, q2: 3, q3: 4, n: 4 });
    const sp = spacingSpread([0.14, 0.15, 0.16, 0.15, 0.30, 0.45], 0.15, 1.5);
    expect(sp.single.n).toBe(4); // 0.30 and 0.45 are two and three spacings
    expect(sp.lowerFenceM).toBeCloseTo(sp.single.q1! - 1.5 * (sp.single.q3! - sp.single.q1!), 9);
    expect(spacingSpread([0.1, 0.2], null).single.n).toBe(0);
  });
  it("is recorded on the reading, and the reading is otherwise as before", () => {
    const dots = planting(), off = read(dots);
    expect(off.profile?.spread.single.n).toBeGreaterThan(500);
    expect(gapsOnLines(off.courses, off.a).length).toBe(off.certainGaps);
    expect(off.tooCloseM).toBeCloseTo(0.5 * (off.geometry.seedM ?? NaN), 9);
  });
});

describe("3b: the too-close limit from the spread", () => {
  it("off: half the plant spacing; on: the lower fence, held between a quarter and three quarters of it", () => {
    const dots = planting(), off = read(dots), on = read(dots, { ...LAYERS, tooCloseFromSpread: true });
    const seed = on.geometry.seedM!, fence = on.profile!.spread.lowerFenceM!;
    expect(on.tooCloseM).toBeCloseTo(Math.min(0.75 * seed, Math.max(0.25 * seed, fence)), 9);
    expect(on.tooCloseM).not.toBeCloseTo(off.tooCloseM, 6);
    // Everything else read the same way: the certain plants and their rows.
    expect(Array.from(on.certainty).filter(c => c === 0).length).toBe(Array.from(off.certainty).filter(c => c === 0).length);
    expect(on.courses.length).toBe(off.courses.length);
  });
});

describe("2a: the ground from L4's certain plants only", () => {
  it("judges a planting from its certain plants, and is null with too few", () => {
    const dots = planting(), all = dots.map((_, i) => i);
    const g = groundFromObvious(dots, all, 0, S);
    expect(g).not.toBeNull();
    expect(g!.judged.planted).toBeGreaterThan(0);
    expect(g!.state(12, 2 * S)).toBe(1);
    expect(groundFromObvious(dots, all.slice(0, 20), 0, S)).toBeNull();
  });
  it("off, the ground given is used; on, L4's replaces it", () => {
    const dots = planting(), scatteredEverywhere = { state: () => 2 as const, dotState: null };
    const given = reconstruct(dots, new Int32Array(dots.length).fill(8), 0, S, PLANTS_FIRST, SEQUENCE, null, null, null, scatteredEverywhere, LAYERS);
    const fromL4 = reconstruct(dots, new Int32Array(dots.length).fill(8), 0, S, PLANTS_FIRST, SEQUENCE, null, null, null, scatteredEverywhere, { ...LAYERS, groundFromObvious: true });
    expect(given.rows.length).toBe(0); // all of it judged scattered: no row
    expect(fromL4.rows.length).toBe(6);
    expect(fromL4.profile?.groundL4).not.toBeNull();
  });
});

describe("3a: the cores' blurs from the typical plant size", () => {
  it("from the row spacing without a size; from the size with one", () => {
    const byPitch = coresAsked(200, "marks"), bySize = coresAsked(200, "marks", 50);
    expect(byPitch!.finePx).toBeCloseTo(CORN_CORES.fineShare * 200, 9);
    expect(bySize!.finePx).toBeCloseTo(LAYERS.coresSizeFine * 50, 9);
    expect(bySize!.widePx).toBeCloseTo(LAYERS.coresSizeWide * 50, 9);
    expect(coresAsked(null, "marks")).toBeNull();
  });
  it("on the photograph the shares were anchored on, the size gives the row spacing's blurs", () => {
    // 53.JPG: row spacing 212.1 px, typical plant 49.6 px.
    expect(coresAsked(null, "marks", 49.6)!.finePx).toBeCloseTo(CORN_CORES.fineShare * 212.1, 1);
    expect(coresAsked(null, "marks", 49.6)!.widePx).toBeCloseTo(CORN_CORES.wideShare * 212.1, 1);
  });
});

describe("L7: the second look", () => {
  it("passes the reading through when off, or with no way to read the photographs", () => {
    const dots = planting(), rec = read(dots), P = { all: dots, strict: dots.length, tier: null, covered: new Int32Array(dots.length).fill(8), photos: [], shifts: [] };
    const off = secondLookOnField(P, rec, new Map(), { lat: 0, lng: 0, altM: 0 }, [], () => null, LAYERS);
    expect(off.rec).toBe(rec); expect(off.P).toBe(P); expect(off.record.examined).toEqual({ gaps: 0, refused: 0 });
    const noLooker = secondLookOnField(P, rec, new Map(), { lat: 0, lng: 0, altM: 0 }, [], null, { ...LAYERS, secondLook: true });
    expect(noLooker.rec).toBe(rec);
  });
});

describe("L8: the unsure list", () => {
  it("lists a plant on a row whose mark a core alone added in some photograph", () => {
    const dots = planting().slice(0, 170), rec = read(dots);
    const sights: Sight[] = [];
    // Two photographs; every plant seen in both; plant 10's mark in photograph 1 was added by a core.
    const all = dots.map((d, i) => { const m = [sights.length, sights.length + 1]; sights.push({ p: 0, u: i, v: 0, e: d.e, n: d.n, k: i }, { p: 1, u: i, v: 0, e: d.e, n: d.n, k: i }); return { ...d, members: m }; });
    const look = (fb: number[]) => ({ typicalPx: 10, size: fb.map(() => 10), green: fb.map(() => 0.2), solidity: fb.map(() => null), foundBy: fb, cores: null });
    const fb0 = all.map(() => 1), fb1 = all.map((_, i) => (i === 10 ? 2 : 3));
    const reads = [{ name: "a", scale: 1, rows: [], patches: [], gaps: [], plants: all.map((_, i) => [i, 0] as [number, number]), look: look(fb0) }, { name: "b", scale: 1, rows: [], patches: [], gaps: [], plants: all.map((_, i) => [i, 0] as [number, number]), look: look(fb1) }] as CornPhotoRead[];
    const U = unsureList({ all, strict: all.length, photos: ["a", "b"], sights }, rec, reads);
    expect(U.recorded).toBe(true);
    expect(U.dots.map(d => d.dot)).toEqual(rec.rowOf[10] >= 0 ? [10] : []);
    expect(U.dots[0]?.kind).toBe("photographs disagree");
    expect(unsureList({ all, strict: all.length, photos: ["a", "b"], sights }, rec, reads.map(r => ({ ...r, look: undefined }))).recorded).toBe(false);
  });
});

describe("the guard over a flight", () => {
  it("drops a misread photograph's look with its marks", () => {
    const mk = (name: string, px: number): CornPhotoRead => ({ name, scale: 1, rows: [], patches: [], gaps: [], plants: [[1, 1]], guard: { rowGreenShare: 0.1, rowSpacingPx: px, gsdM: 0.004 }, look: { typicalPx: 10, size: [10], green: [0.2], solidity: [null], foundBy: [1], cores: null } });
    const G = cornFlightGuard([mk("a", 190), mk("b", 191), mk("c", 600)], { ...CORN_COUNT_GUARD, misreadRatio: 1.5 });
    const c = G.reads.find(r => r.name === "c")!;
    expect(c.plants).toEqual([]); expect(c.look?.size).toEqual([]); expect(c.look?.foundBy).toEqual([]); expect(c.look?.typicalPx).toBe(10);
    expect(G.reads.find(r => r.name === "a")!.look?.size).toEqual([10]);
  });
});
