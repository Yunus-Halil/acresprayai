// Crops make rows, rows never make crops (2026-11-16): what plantsFirst.ts holds to on unplanted ground.
//  - a cell of ground with plenty of certain plants and no row pattern in them holds no row (rowNumbers patternOnly);
//    a cell with too few plants still takes its neighbour's pattern, as before;
//  - on ground the field's plants show as scattered (cornField.ts FieldGround) no plant makes a row, no dot is a
//    probable plant, no candidate is taken, and a row is cut where its course would cross that ground;
//  - with the rules as they stood (SEQUENCE_V1) everything reads as before.
import { describe, expect, it } from "vitest";
import { type Dot, type GroundJudge, PLANTS_FIRST, SEQUENCE, SEQUENCE_V1, reconstruct, rowNumbers } from "@/lib/fieldTwin/plantsFirst";

// Six rows 0.9 m apart running east, a plant every 0.15 m from 0 to 24 m, each made by 5 of the 8 photographs that
// looked (certain). East of them a headland from 26 to 46 m: 400 plants as certain, standing anywhere.
const S = 0.9, SEED = 0.15;
const dot = (e: number, n: number, photos = 5): Dot => ({ e, n, members: [], photos, spreadM: 0.01 });
const planting = (skip: (a: number) => boolean = () => false): Dot[] => { const d: Dot[] = []; for (let r = 0; r < 6; r++) for (let k = 0; k * SEED <= 24 + 1e-9; k++) if (!skip(k * SEED)) d.push(dot(k * SEED, r * S)); return d; };
const headland = (): Dot[] => { let s = 11; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff); return Array.from({ length: 400 }, () => dot(26 + 20 * rnd(), -0.4 + 5.3 * rnd())); };
const read = (dots: Dot[], q = SEQUENCE, ground: GroundJudge | null = null, tiers: number[] | null = null) => {
  const tier = tiers ? Uint8Array.from(tiers) : null;
  return reconstruct(dots, new Int32Array(dots.length).fill(8), 0, S, PLANTS_FIRST, q, tier ? Uint8Array.from(tier, t => (t ? 1 : 0)) : null, tier, null, ground);
};

describe("a cell of ground with plants and no row pattern", () => {
  const dots = [...planting(), ...headland()], n0 = planting().length;
  const A = Float64Array.from(dots, d => d.e), C = Float64Array.from(dots, d => d.n), certain = new Uint8Array(dots.length).fill(1);

  it("took its neighbour's pattern before, and gives its plants no row number now", () => {
    const before = rowNumbers(A, C, certain, S), now = rowNumbers(A, C, certain, S, undefined, undefined, undefined, true);
    const deep = dots.map((d, i) => i).filter(i => i >= n0 && dots[i].e >= 30);
    expect(deep.length).toBeGreaterThan(250);
    expect(before.flat).toBe(0);
    expect(deep.every(i => Number.isFinite(before.resid[i]))).toBe(true);
    // A fifth of a spacing either side of a carried line is two fifths of the ground: that share became row plants.
    expect(deep.filter(i => Math.abs(before.resid[i]) <= 0.2 * S).length).toBeGreaterThan(0.25 * deep.length);
    expect(now.flat).toBeGreaterThan(0);
    expect(deep.every(i => now.resid[i] === Infinity)).toBe(true);
    // The planting's own plants keep their rows.
    for (let i = 0; i < n0; i++) expect(Math.abs(now.resid[i])).toBeLessThan(0.02);
  });

  it("a cell with too few plants still takes its neighbour's pattern", () => {
    // Ten plants only, far along the rows' lines: too few to say there is no pattern.
    const few = [...planting(), ...Array.from({ length: 10 }, (_, k) => dot(40 + k * 0.3, 2 * S))];
    const a = Float64Array.from(few, d => d.e), c = Float64Array.from(few, d => d.n);
    const now = rowNumbers(a, c, new Uint8Array(few.length).fill(1), S, undefined, undefined, undefined, true);
    expect(now.flat).toBe(0);
    for (let i = n0; i < few.length; i++) { expect(now.j[i]).toBe(now.j[2 * (n0 / 6)]); expect(Math.abs(now.resid[i])).toBeLessThan(0.02); }
  });

  it("holds no row: the rows end with the planting instead of running on through the headland", () => {
    // The ground is judged on this flight (nowhere scattered): the rule only acts on a flight whose ground the field judged.
    const judged: GroundJudge = { state: () => 0 };
    const before = read(dots, SEQUENCE_V1, judged), now = read(dots, { ...SEQUENCE_V1, patternCellsOnly: true }, judged);
    expect(read(dots, { ...SEQUENCE_V1, patternCellsOnly: true }).unplanted.flatCells).toBe(0);
    expect(Math.max(...before.rows.map(r => r.a1))).toBeGreaterThan(35);
    // The cell that holds the planting's last 4 m also holds the headland's first 4 m: the rows may reach to its end.
    expect(Math.max(...now.rows.map(r => r.a1))).toBeLessThanOrEqual(30 + SEQUENCE.maxGapSeeds * SEED);
    expect(now.unplanted.flatCells).toBeGreaterThan(0);
    const onRowsDeep = (R: typeof now) => dots.filter((d, i) => i >= n0 && d.e >= 30 && R.rowOf[i] >= 0).length;
    expect(onRowsDeep(before)).toBeGreaterThan(20);
    expect(onRowsDeep(now)).toBe(0);
    // The planting itself reads the same.
    for (let i = 0; i < n0; i++) expect(now.rowOf[i] >= 0).toBe(before.rowOf[i] >= 0);
  });
});

describe("ground the field's plants show as scattered", () => {
  const scatteredEastOf = (e0: number): GroundJudge => ({ state: e => (e > e0 ? 2 : 1) });

  it("makes no row and takes no plant, certain or probable or candidate; the planting beside it reads as before", () => {
    const base = planting(), n0 = base.length, hl = headland();
    // On row 2's line, just past its last plant and at the plant spacing: a dot two photographs made, and a candidate.
    const extra = [dot(24.15, 2 * S, 2), dot(24.3, 2 * S, 2)];
    const dots = [...base, ...hl, ...extra], tiers = [...base.map(() => 0), ...hl.map(() => 0), 0, 1], k = n0 + hl.length;
    const before = read(dots, SEQUENCE_V1, scatteredEastOf(24.07), tiers), now = read(dots, { ...SEQUENCE_V1, refuseScattered: true }, scatteredEastOf(24.07), tiers);
    // As the rules stood, the ground is not asked even when it is handed in.
    expect(before.rowOf[k]).toBeGreaterThanOrEqual(0); expect(before.rowOf[k + 1]).toBeGreaterThanOrEqual(0);
    expect(before.unplanted.dotsOnScattered).toBe(0);
    expect(dots.filter((d, i) => d.e > 24.07 && before.rowOf[i] >= 0).length).toBeGreaterThan(20);
    expect(dots.filter((d, i) => d.e > 24.07 && now.rowOf[i] >= 0).length).toBe(0);
    expect(now.rowOf[k]).toBe(-1); expect(now.rowOf[k + 1]).toBe(-1);
    expect(now.unplanted.dotsOnScattered).toBe(hl.length + 2);
    expect(now.unplanted.certainOnScattered).toBe(hl.length);
    expect(Math.max(...now.rows.map(r => r.a1))).toBeCloseTo(24, 6);
    expect(now.rows.length).toBe(6);
    for (let i = 0; i < n0; i++) expect(now.rowOf[i]).toBeGreaterThanOrEqual(0);
  });

  it("cuts a row where a stretch with no plant confirmed would cross it, and bridges the same stretch on ground it does not judge scattered", () => {
    const dots = planting(a => a > 10.05 && a < 11.95);
    const strip: GroundJudge = { state: e => (e > 10.3 && e < 11.7 ? 2 : 1) }, noStrip: GroundJudge = { state: () => 0 };
    const bridged = read(dots, SEQUENCE, noStrip), cut = read(dots, SEQUENCE, strip);
    expect(bridged.rows.length).toBe(6);
    expect(bridged.rows.every(r => r.segments.some(g => !g.confirmed))).toBe(true);
    expect(bridged.gaps.cutOverScattered).toBe(0);
    expect(cut.rows.length).toBe(12);
    expect(cut.gaps.cutOverScattered).toBe(6);
    expect(cut.rows.every(r => r.segments.every(g => g.confirmed))).toBe(true);
    expect(cut.rows.every(r => r.a1 <= 10.05 + 1e-9 || r.a0 >= 11.95 - 1e-9)).toBe(true);
  });

  it("is the default, with the rules as they stood kept beside it", () => {
    expect(SEQUENCE.patternCellsOnly).toBe(true); expect(SEQUENCE.refuseScattered).toBe(true);
    expect(SEQUENCE_V1.patternCellsOnly).toBe(false); expect(SEQUENCE_V1.refuseScattered).toBe(false);
  });
});
