// Crops make rows, rows never make crops (2026-11-16): what plantsFirst.ts holds to on unplanted ground.
//  - a cell of ground with plenty of certain plants and no row pattern in them holds no row (rowNumbers patternOnly);
//    a cell with too few plants still takes its neighbour's pattern, as before;
//  - on ground the field's plants show as scattered (cornField.ts FieldGround) no plant makes a row, no dot is a
//    probable plant, no candidate is taken, and a row is cut where its course would cross that ground;
//  - rows guide the search and never make a plant: a candidate of the second look, or a dot the loosened placement would
//    take, is kept only along a stretch of row whose band beats the ground between the rows (SEQUENCE.alleyTest);
//  - a candidate long along the rows is split at the plant spacing the field measured, not the one a photograph assumes;
//  - "between two rows" is said only of a dot off every row's line;
//  - with the rules as they stood (SEQUENCE_V1) everything reads as before.
import { describe, expect, it } from "vitest";
import { type GeorefFrame, UNCALIBRATED_BORESIGHT } from "@/lib/directGeoref/projection";
import type { CornPhotoRead } from "@/lib/fieldTwin/cornField";
import { candidatePoints } from "@/lib/fieldTwin/cornPlants";
import { type Dot, type GroundJudge, PLANTS_FIRST, SEQUENCE, SEQUENCE_V1, bandAndAlley, courseAt, reconstruct, rowNumbers } from "@/lib/fieldTwin/plantsFirst";
import { ROW_GUIDED, bandBeatsControls, bandTail } from "@/lib/fieldTwin/rowGuided";
import { ROW_POINTS, rowPlantPoints } from "@/lib/rowCrop/greenPoints";

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

describe("the band against the ground between the rows", () => {
  it("is rowGuided.ts's test: a band passes on five marks with none between the rows, never on four", () => {
    expect(bandTail(5, 5)).toBeLessThan(ROW_GUIDED.alpha); expect(bandTail(4, 4)).toBeGreaterThan(ROW_GUIDED.alpha);
    expect(bandBeatsControls(5, 0, ROW_GUIDED.stretchM)).toBe(true);
    expect(bandBeatsControls(4, 0, ROW_GUIDED.stretchM)).toBe(false);
    expect(bandBeatsControls(8, 8, ROW_GUIDED.stretchM)).toBe(false);
    expect(bandBeatsControls(30, 8, ROW_GUIDED.stretchM)).toBe(true);
  });

  it("counts the dots on each row's line and in its two mid-alley strips, per stretch", () => {
    const dots = [...planting(), dot(7, 0.45), dot(7.5, 0.45), dot(12, 2 * S + 0.5)], R = read(dots, SEQUENCE_V1);
    const BA = bandAndAlley(R.courses, R.a, R.c, new Int8Array(dots.length), 1, R.geometry.spacingM, PLANTS_FIRST.onRowShare * R.geometry.spacingM, 0.6);
    expect(BA.controlScale).toBe(1);
    // 24 m of row in stretches of 5 m: four, the last taking the 4 m left over.
    expect(BA.first[1] - BA.first[0]).toBe(4);
    const row = R.courses.findIndex(c => Math.abs(courseAt(c, 7)) < 0.05), st = BA.stretches[BA.stretchOf(row, 7)];
    expect([st.a0, st.a1]).toEqual([5, 10]);
    expect(st.band[0]).toBe(33);   // plants at 5.1 ... 9.9
    expect(st.alley[0]).toBe(2);   // the two dots half a spacing above the row
    expect(BA.stretches[BA.stretchOf(row, 23)].a1).toBeCloseTo(24, 6);
  });
});

describe("rows guide the search, they never make a plant", () => {
  // The planting with a bare strip across every row from 9 to 15 m (wheel tracks): no plant there.
  const bare = planting(a => a > 9.05 && a < 14.95), n0 = bare.length;
  // Specks in the strip, one photograph each: four on every row's line at the plant spacing from its last plant, and
  // as many half way between the rows.
  const specks: Dot[] = [];
  for (let r = 0; r < 6; r++) for (const a of [9.15, 9.3, 9.45, 9.6]) { specks.push(dot(a, r * S, 1)); specks.push(dot(a, r * S + 0.45, 1)); }
  const onLine = specks.map((d, k) => k).filter(k => k % 2 === 0);
  const tiers = [...bare.map(() => 0), ...specks.map(() => 2)];
  const kept = (R: ReturnType<typeof read>) => onLine.filter(k => R.rowOf[n0 + k] >= 0).length;

  it("specks on a row's line across bare ground are plants by the spacing alone, and are refused where the stretch's alley holds as many", () => {
    // Bare from 4 m on, so the stretch from 5 to 10 m holds no plant: specks on the lines from the last plant on, and
    // as many between the rows.
    const cut = planting(a => a > 4.05 && a < 14.95), m0 = cut.length, sp: Dot[] = [];
    for (let r = 0; r < 6; r++) for (let k = 1; k <= 12; k++) { sp.push(dot(4.05 + k * SEED, r * S, 1)); sp.push(dot(4.05 + k * SEED, r * S + 0.45, 1)); }
    const dots = [...cut, ...sp], t = [...cut.map(() => 0), ...sp.map(() => 2)];
    const keptIn = (R: ReturnType<typeof read>, from: number) => sp.filter((d, k) => k % 2 === 0 && d.e >= from && R.rowOf[m0 + k] >= 0).length;
    // By the spacing alone they march on from plant to speck to speck.
    expect(keptIn(read(dots, SEQUENCE_V1, null, t), 5)).toBe(36);
    const row = read(dots, { ...SEQUENCE_V1, alleyTest: "row" }, null, t), own = read(dots, { ...SEQUENCE_V1, alleyTest: "own" }, null, t);
    expect(keptIn(row, 5)).toBe(0); expect(keptIn(own, 5)).toBe(0);
    expect(row.alleyRefused).toBeGreaterThanOrEqual(36);
    // The stricter marks' plants read the same.
    const base = read(cut, SEQUENCE_V1);
    for (let i = 0; i < m0; i++) expect(row.rowOf[i] >= 0).toBe(base.rowOf[i] >= 0);
  });

  it("a bare strip shorter than a stretch shares it with planted row: the row's band passes, the candidates' own count does not", () => {
    const dots = [...bare, ...specks];
    expect(kept(read(dots, SEQUENCE_V1, null, tiers))).toBe(24);
    // The stretch from 5 to 10 m holds the row's plants up to 9 m: with them the band beats the alley (the known limit).
    expect(kept(read(dots, { ...SEQUENCE_V1, alleyTest: "row" }, null, tiers))).toBe(24);
    expect(kept(read(dots, { ...SEQUENCE_V1, alleyTest: "all" }, null, tiers))).toBe(24);
    // Candidates against candidates: four on the line, eight between the rows.
    const own = read(dots, { ...SEQUENCE_V1, alleyTest: "own" }, null, tiers);
    expect(kept(own)).toBe(0); expect(own.alleyRefused).toBe(24);
  });

  it("marks one photograph made between the rows do not speak against marks several photographs made on the row", () => {
    // The bare strip again. On every row's line six candidates two photographs made; between the rows twelve specks
    // one photograph made anywhere in its frame (tier 3: only the loosened placement carries them).
    const strong: Dot[] = [], weak: Dot[] = [];
    for (let r = 0; r < 6; r++) for (let k = 0; k < 6; k++) { strong.push(dot(9.15 + k * SEED, r * S, 2)); weak.push(dot(9.1 + k * 0.13, r * S + 0.45, 1)); weak.push(dot(9.17 + k * 0.13, r * S - 0.45, 1)); }
    const dots = [...bare, ...strong, ...weak], t = [...bare.map(() => 0), ...strong.map(() => 1), ...weak.map(() => 3)];
    const R = read(dots, { ...SEQUENCE_V1, alleyTest: "own" }, null, t);
    expect(strong.filter((d, k) => R.rowOf[n0 + k] >= 0).length).toBe(36);
    // The same specks as candidates of the same tier as the marks on the row: now the alley holds as many, and they go.
    const same = read(dots, { ...SEQUENCE_V1, alleyTest: "own" }, null, [...bare.map(() => 0), ...strong.map(() => 1), ...weak.map(() => 1)]);
    expect(strong.filter((d, k) => same.rowOf[n0 + k] >= 0).length).toBe(0);
  });

  it("three candidates in a gap of a full row cannot outvote anything on their own; with the row's plants, found without a row, the band passes", () => {
    const gap = planting(a => a > 9.05 && a < 9.55), extra = [dot(9.15, 2 * S, 2), dot(9.3, 2 * S, 2), dot(9.45, 2 * S, 1)];
    const dots = [...gap, ...extra], t = [...gap.map(() => 0), 1, 1, 2], k = gap.length;
    const own = read(dots, { ...SEQUENCE_V1, alleyTest: "own" }, null, t), row = read(dots, { ...SEQUENCE_V1, alleyTest: "row" }, null, t);
    expect([0, 1, 2].map(j => own.rowOf[k + j] >= 0)).toEqual([false, false, false]);
    expect([0, 1, 2].map(j => row.rowOf[k + j] >= 0)).toEqual([true, true, true]);
    expect(row.alleyRefused).toBe(0);
  });

  it("the loosened placement takes a dot off the spacing in the planting, and not where a line runs on through scattered plants", () => {
    // As the rules stood the rows run on through the headland (no ground judged): the lines exist there.
    const hl = headland(), gapped = planting(a => a > 9.05 && a < 10.85);
    // In the planting: a dot two photographs made, in a gap, 22 cm from the last plant (not at the spacing).
    const inPlanting = dot(9.22, 2 * S, 2);
    // Dots two photographs made (not certain), standing anywhere in the headland.
    let seed = 5; const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
    const weak = Array.from({ length: 300 }, () => dot(27 + 18 * rnd(), -0.4 + 5.3 * rnd(), 2));
    const dots = [...gapped, ...hl, inPlanting, ...weak], k = gapped.length + hl.length;
    const free = read(dots, { ...SEQUENCE_V1, free: true }), guided = read(dots, { ...SEQUENCE_V1, free: true, alleyTest: "row" });
    expect(free.rowOf[k]).toBeGreaterThanOrEqual(0); expect(guided.rowOf[k]).toBeGreaterThanOrEqual(0);
    expect(guided.loose[k]).toBe(1);
    const looseInHeadland = (R: typeof free) => dots.filter((d, i) => d.e > 26 && R.loose[i]).length;
    expect(looseInHeadland(free)).toBeGreaterThan(0);
    expect(looseInHeadland(guided)).toBe(0);
  });

  it("is the default (row), and not asked by the rules as they stood", () => {
    expect(SEQUENCE.alleyTest).toBe("row"); expect(SEQUENCE_V1.alleyTest).toBe("none");
  });
});

describe("a candidate long along the rows", () => {
  it("is not split in the photograph when asked for its extent: one point, with how far its green reaches along the row", () => {
    const W = 600, H = 400, m = new Uint8Array(W * H), rect = (x0: number, y0: number, w: number, h: number) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) m[y * W + x] = 1; };
    rect(100, 50, 6, 46);                                                        // 46 px along a vertical row
    for (let k = 0; k < 12; k++) rect(420 + (k % 4) * 20, 200 + Math.floor(k / 4) * 20, 7, 7);
    expect(rowPlantPoints(m, W, H, Math.PI / 2, 0.01).filter(p => Math.abs(p.x - 103) < 8).length).toBe(3);
    const defer = { span: [] as [number, number][] }, pts = rowPlantPoints(m, W, H, Math.PI / 2, 0.01, ROW_POINTS, defer);
    expect(pts.length).toBe(13); expect(defer.span.length).toBe(13);
    const k = pts.findIndex(p => Math.abs(p.x - 103) < 8);
    expect(pts.filter(p => Math.abs(p.x - 103) < 8).length).toBe(1);
    expect(defer.span[k][1] - defer.span[k][0]).toBeCloseTo(46, 6);
    expect(pts[k].y + defer.span[k][0]).toBeCloseTo(50, 6); expect(pts[k].y + defer.span[k][1]).toBeCloseTo(96, 6);
    // Without a row direction nothing is deferred: the points are as before.
    const none = { span: [] as [number, number][] };
    expect(rowPlantPoints(m, W, H, null, 0.01, ROW_POINTS, none)).toEqual(rowPlantPoints(m, W, H, null, 0.01));
  });

  it("is split at the plant spacing the field measured", () => {
    // A camera 20 m up, 4000 px focal length: 5 mm a pixel. A candidate whose green runs 120 px (0.6 m) along the rows.
    const frame = {
      name: "a", intrinsics: { width: 4000, height: 3000, fx: 4000, fy: 4000, cx: 2000, cy: 1500, distortion: null, basis: "test" },
      pose: { lat: 40, lng: -90, altM: 20, datum: "test", attitude: { yawDeg: 0, pitchDeg: -90, rollDeg: 0, basis: "test" }, boresight: UNCALIBRATED_BORESIGHT, basis: "test" },
      ground: { kind: "flat", altM: 0, datum: "test", basis: "test" },
    } as unknown as GeorefFrame;
    const origin = { lat: 40, lng: -90, altM: 0 };
    const r: CornPhotoRead = { name: "a", scale: 1, rows: [], patches: [], gaps: [], plants: [], low: [[2000, 1500], [1000, 1000]], lowSpan: [[-60, 60], [-15, 15]], lowAxis: [1, 0] };
    const at15 = candidatePoints(r, frame, origin, 0.15), at20 = candidatePoints(r, frame, origin, 0.2), at30 = candidatePoints(r, frame, origin, 0.3);
    expect(at15.length).toBe(5);   // four along the long one, the short one whole
    expect(at20.length).toBe(4);
    expect(at30.length).toBe(3);   // 0.6 m is two plants at 0.3 m
    expect(at15.slice(0, 4).map(p => p[0])).toEqual([1955, 1985, 2015, 2045]);
    expect(at15[4]).toEqual([1000, 1000]);
    // A read without extents is returned as it is.
    const plain: CornPhotoRead = { ...r, lowSpan: undefined, lowAxis: undefined };
    expect(candidatePoints(plain, frame, origin, 0.15)).toEqual(plain.low);
  });
});

describe("between two rows", () => {
  // In the planting: a second leaf of a plant on row 2 (9 cm along from it), a dot on row 2's line off the plant
  // spacing in a gap, and a dot half way between rows 2 and 3.
  const gapped = planting(a => a > 9.05 && a < 10.85), n0 = gapped.length;
  const dots = [...gapped, dot(12.09, 2 * S, 2), dot(9.22, 2 * S, 2), dot(15.0, 2.5 * S, 2)];

  it("was said of a dot standing on a row's line, counting that row as one of the two", () => {
    const R = read(dots, SEQUENCE_V1);
    expect(Array.from(R.rowOf.slice(n0))).toEqual([-1, -1, -1]);
    expect(Array.from(R.between.slice(n0))).toEqual([1, 1, 1]);
    expect(Array.from(R.why.slice(n0))).toEqual([4, 4, 4]);
  });

  it("is said only of a dot off every row's line; a dot on a line keeps the reason it was left off the row", () => {
    const R = read(dots, { ...SEQUENCE_V1, betweenOffLines: true });
    expect(Array.from(R.rowOf.slice(n0))).toEqual([-1, -1, -1]);
    expect(Array.from(R.between.slice(n0))).toEqual([0, 0, 1]);
    expect(Array.from(R.why.slice(n0))).toEqual([2, 3, 4]);   // a double; not at the plant spacing; between two rows
    // Nothing else moves: the same dots on the same rows.
    const before = read(dots, SEQUENCE_V1);
    expect(Array.from(R.rowOf)).toEqual(Array.from(before.rowOf));
    expect(R.rows.length).toBe(before.rows.length);
  });

  it("leaves the other reasons standing: scattered ground, and a stretch whose band does not beat the alley", () => {
    // A candidate on row 2's line just past its end, on ground judged scattered.
    const base = planting(), d1 = [...base, dot(24.15, 2 * S, 2)], t1 = [...base.map(() => 0), 1];
    const scatteredEast: GroundJudge = { state: e => (e > 24.07 ? 2 : 1) };
    expect(read(d1, SEQUENCE, scatteredEast, t1).why[base.length]).toBe(5);
    expect(read(d1, { ...SEQUENCE, betweenOffLines: false }, scatteredEast, t1).why[base.length]).toBe(4);
    // Specks on the lines across bare ground, as many between the rows: refused, and said so.
    const bare = planting(a => a > 9.05 && a < 14.95), specks: Dot[] = [];
    for (let r = 0; r < 6; r++) for (const a of [9.15, 9.3, 9.45, 9.6]) { specks.push(dot(a, r * S, 1)); specks.push(dot(a, r * S + 0.45, 1)); }
    const R = read([...bare, ...specks], { ...SEQUENCE, alleyTest: "own" }, null, [...bare.map(() => 0), ...specks.map(() => 2)]);
    // (Past the last row a speck has a row on one side only: no row reaches it.)
    specks.forEach((sp, k) => { expect(R.rowOf[bare.length + k]).toBe(-1); expect(R.why[bare.length + k]).toBe(k % 2 === 0 ? 6 : k < 40 ? 4 : 1); });
  });

  it("is the default, and not in the rules as they stood", () => {
    expect(SEQUENCE.betweenOffLines).toBe(true); expect(SEQUENCE_V1.betweenOffLines).toBe(false);
  });
});
