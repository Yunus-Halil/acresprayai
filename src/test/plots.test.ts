// Plots (2026-11-23): the numbers for a region of a corn field, on a field whose every number is known.
import { describe, expect, it } from "vitest";
import { boxRing, fieldStand, measurePlot, plotContext, snapRows, llOf, fmtPerAcre } from "@/lib/fieldTwin/plots";
import { localFrame } from "@/lib/fieldTwin/rowEdits";
import { SIMPLE, averageColour, fieldColourOf, fmtPerAcreShort, hueOf, plotNumberTone, rowBars, stretched } from "@/lib/fieldTwin/simpleView";
import { packLooks } from "@/lib/fieldTwin/cornPlantLook";
import { M2_PER_ACRE } from "@/lib/units";
import { FIELD_TWIN_FORMAT, type LatLngPair, type TwinBundle, type TwinCornRow } from "@/lib/fieldTwin/types";

const LAT = 31.58, LNG = -83.586, S = 0.76, STEP = 0.2;
/**
 * Four rows S apart running east, each 10 m with a plant every 20 cm (51 plants). Row 4 has no plant confirmed from 4 to
 * 6 m (its plants there are missing, the stretch drawn as the row's course). Plus a double on row 1 and green between
 * rows 1 and 2, neither counted.
 */
function exactTwin(opts: { dropRow2At?: number } = {}): TwinBundle {
  const f = localFrame(LAT, LNG), at = (e: number, n: number) => f.toLL(e, n);
  const points: LatLngPair[] = [], certainty: number[] = [], rows: TwinCornRow[] = [];
  let id = 1;
  const stretch = (row: number, e0: number, e1: number, seen: boolean) => rows.push({ id: id++, status: seen ? "corn" : "unconfirmed", line: [at(e0, row * S), at(e1, row * S)], lengthM: e1 - e0, seenBy: 0, cornBy: 0, coveredBy: 0, why: seen ? `Plants seen along it (row ${row}: 51 plants, 51 seen by most photographs over them, 5.0 a metre).` : `The row probably continues here (row ${row}), no plant confirmed.`, row, plants: seen ? 1 : 0 });
  for (let row = 1; row <= 4; row++) {
    for (let i = 0; i <= 50; i++) {
      const e = i * STEP;
      if (row === 4 && e > 4.01 && e < 5.99) continue;
      if (row === 2 && opts.dropRow2At != null && Math.abs(e - opts.dropRow2At) < 1e-6) continue;
      points.push(at(e, row * S)); certainty.push(0);
    }
    if (row === 4) { stretch(4, 0, 4, true); stretch(4, 4, 6, false); stretch(4, 6, 10, true); } else stretch(row, 0, 10, true);
  }
  points.push(at(3.05, 1 * S)); certainty.push(7);
  for (let k = 0; k < 5; k++) { points.push(at(2 + k * 0.3, 1.5 * S)); certainty.push(2); }
  return {
    format: FIELD_TWIN_FORMAT, id: "exact", name: "Exact", builtAt: "test",
    source: { photographs: 4, camera: "test", capturedAt: null, groundPixelCm: 0.6, method: "test", weedModel: "none", treeModel: "none" },
    origin: { lat: LAT, lng: LNG }, bounds: [at(-5, -5), at(15, 8)], field: { rowDirectionDeg: 0, rowSpacingM: S, plantSpacingM: STEP },
    footprints: [], rows: [], trees: [], inferredTrees: [], weeds: [], vegetation: [], atlases: [], stats: {},
    corn: {
      version: 1, engine: "test", enteredCrop: "corn", rowSpacingM: S, rowDirectionDeg: 0, rowAgreementM: 0.01,
      photographs: { read: 4, withRows: 4, failed: [] }, rows, weeds: [], gaps: [],
      plants: { points, certainty, photos: points.map(() => 2), note: "test", summary: { plants: points.length, certain: points.length, probable: 0, onNoRow: 5, betweenRows: 0, confirmedM: 38, notConfirmedM: 2, doubles: 1 } },
      summary: { cornRows: 5, unconfirmedRows: 1, cornRowLengthM: 38, offLatticeDropped: 0, weeds: { confirmed: 0, unconfirmed: 0, contested: 0 }, gaps: { confirmed: 0, withheld: 0, confirmedLengthM: 0 }, perPhoto: { weedCandidates: 0, standGaps: 0, rows: 0 } },
      notes: ["Stand gaps are not reported on this flight: over the planted ground the photographs hold 59 % of the row length it carries, so they miss rows and plants that are there.", "Review-only."],
    },
  };
}
const rect = (e0: number, n0: number, e1: number, n1: number): LatLngPair[] => { const f = localFrame(LAT, LNG); return [f.toLL(e0, n0), f.toLL(e1, n0), f.toLL(e1, n1), f.toLL(e0, n1)]; };

describe("a plot's numbers", () => {
  it("round the whole field come to the field panel's stand, to the plant", () => {
    const t = exactTwin(), ctx = plotContext(t)!, F = fieldStand(t)!, W = measurePlot(ctx, rect(-5, -5, 15, 8));
    expect(F.plants).toBe(4 * 51 - 9);
    expect(W.plants).toBe(F.plants);
    expect(W.seenM).toBeCloseTo(F.seenM, 6);
    expect(W.notSeenM).toBeCloseTo(2, 6);
    expect(W.perAcre!).toBeCloseTo(F.perAcre!, 6);
    expect(F.perAcre!).toBeCloseTo((195 / (38 * S)) * M2_PER_ACRE, 6);
    expect(fmtPerAcre(W.perAcre!)).toBe(fmtPerAcre(F.perAcre!));
    expect(W.readShare!).toBeCloseTo(38 / 40, 6);
  });
  it("count only the plants the field counts, and the green apart", () => {
    const ctx = plotContext(exactTwin())!;
    // Rows 1 and 2, 1 to 4 m: the double at 3.05 m and the five green marks lie inside.
    const P = measurePlot(ctx, rect(1.1, 0.5 * S, 4.1, 2.5 * S));
    expect(P.plants).toBe(2 * 15);
    expect(P.greenNotCorn).toBe(5);
    expect(P.possibleWeeds).toEqual({ total: 5, confirmed: 0 });
  });
  it("give possible weeds as one number: the green that is not corn and the weed candidates, each place once", () => {
    const t = exactTwin(), f = localFrame(LAT, LNG);
    const weed = (id: number, e: number, n: number, status: "confirmed" | "unconfirmed") => { const [lat, lng] = f.toLL(e, n); return { id, status, lat, lng, areaM2: 0.01, votes: { weed: 2, crop: 0, unknown: 0 }, seenBy: 2, coveredBy: 3, photos: [], why: "test", evidence: [] }; };
    // One candidate where a green mark already stands (the same place: counted once), one on its own, confirmed.
    t.corn!.weeds = [weed(1, 2, 1.5 * S, "unconfirmed"), weed(2, 3.7, 1.2, "confirmed")];
    const P = measurePlot(plotContext(t)!, rect(1.1, 0.5 * S, 4.1, 2.5 * S));
    expect(P.greenNotCorn).toBe(5);
    expect(P.weeds).toEqual({ confirmed: 1, unconfirmed: 1, contested: 0 });
    expect(P.possibleWeeds).toEqual({ total: 6, confirmed: 1 });
  });
  it("per acre is the plants over the row inside with plants seen times the row spacing", () => {
    const ctx = plotContext(exactTwin())!;
    const P = measurePlot(ctx, rect(0.1, 1.5 * S, 5.1, 3.5 * S));
    expect(P.plants).toBe(2 * 25);
    expect(P.seenM).toBeCloseTo(10, 2);
    expect(P.perAcre! / ((50 / (10 * S)) * M2_PER_ACRE)).toBeCloseTo(1, 3);
    expect(P.areaM2).toBeCloseTo(5 * 2 * S, 2);
  });
  it("measure spacing only inside, and never across a stretch with no plant confirmed", () => {
    const ctx = plotContext(exactTwin())!;
    const P = measurePlot(ctx, rect(-1, 3.5 * S, 11, 4.5 * S));
    // Row 4: 21 plants on 0..4 m and 21 on 6..10 m: 20 + 20 spacings of 20 cm; the 2 m across the unconfirmed stretch is not one.
    expect(P.rows).toHaveLength(1);
    expect(P.rows[0].n).toBe(40);
    expect(P.spacing!.meanM).toBeCloseTo(STEP, 4);
    expect(P.spacing!.cv).toBeLessThan(0.01);
    expect(P.spacing!.long).toBe(0);
    expect(P.readShare!).toBeCloseTo(0.8, 6);
  });
  it("list a spacing over 1.5 times the median apart (a missed plant or a skip)", () => {
    const ctx = plotContext(exactTwin({ dropRow2At: 5 }))!;
    const P = measurePlot(ctx, rect(-1, 1.5 * S, 11, 2.5 * S));
    expect(P.spacing!.n).toBe(49);
    expect(P.spacing!.long).toBe(1);
    expect(P.spacing!.cv).toBeGreaterThan(0);
  });
  it("say the gaps were not measured when the build left them out, and flag a small plot", () => {
    const ctx = plotContext(exactTwin())!;
    const P = measurePlot(ctx, rect(0.1, 0.5 * S, 2.1, 1.5 * S));
    expect(P.gaps.measured).toBe(false);
    expect(P.gaps.measured === false && P.gaps.why).toMatch(/Each photo covers too little of each row/);
    expect(P.small).not.toBeNull();
    expect(P.small!.margin).toBeCloseTo(1 / Math.sqrt(P.plants), 6);
  });
});

describe("snapping a plot to the rows", () => {
  it("takes the rows from the press to the pointer, its long sides halfway to the next row out", () => {
    const ctx = plotContext(exactTwin())!;
    // Pressed on row 2 at 1 m, dragged to near row 3 at 9 m.
    const sn = snapRows(ctx, 1, 2 * S + 0.05, 9, 3 * S - 0.1)!;
    expect(sn.rows).toBe(2);
    expect(sn.box.c0).toBeCloseTo(1.5 * S, 3);
    expect(sn.box.c1).toBeCloseTo(3.5 * S, 3);
    expect(sn.box.a1 - sn.box.a0).toBeCloseTo(8, 3);
    // Its area is rows x spacing x length, so the per-acre rule and the area agree.
    const P = measurePlot(ctx, boxRing(sn.box));
    expect(P.areaM2).toBeCloseTo(2 * S * 8, 2);
    expect(P.seenM).toBeCloseTo(16, 3);
  });
  it("gives the outer row half a spacing beyond it", () => {
    const ctx = plotContext(exactTwin())!;
    const sn = snapRows(ctx, 1, 4 * S, 3, 4 * S)!;
    expect(sn.rows).toBe(1);
    expect(sn.box.c1 - sn.box.c0).toBeCloseTo(S, 3);
    expect(llOf(ctx, sn.box.a0, sn.box.c0)[0]).toBeGreaterThan(LAT);
  });
});

// The Simple view (2026-11-23): each plant's own green stretched about the field's average, and the rows' bars.
describe("the Simple view's stretched colours", () => {
  const F = { hue: hueOf(68, 66, 36), lum: 0.3 * 68 + 0.59 * 66 + 0.11 * 36 };
  const lum = (c: ArrayLike<number>) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  it("draw the field's average plant in the one set green", () => {
    expect(stretched([68, 66, 36], F)).toEqual(averageColour());
  });
  it("keep the direction of every difference: paler lighter, darker darker, yellower more yellow, greener greener", () => {
    const avg = averageColour(), paler = stretched([82, 79, 43], F), darker = stretched([58, 56, 31], F), yellower = stretched([84, 66, 36], F), greener = stretched([60, 70, 36], F);
    expect(lum(paler)).toBeGreaterThan(lum(avg));
    expect(lum(darker)).toBeLessThan(lum(avg));
    expect(Math.abs(hueOf(paler[0], paler[1], paler[2]) - SIMPLE.hue)).toBeLessThan(4);
    expect(hueOf(yellower[0], yellower[1], yellower[2])).toBeLessThan(SIMPLE.hue - 10);
    expect(hueOf(greener[0], greener[1], greener[2])).toBeGreaterThan(SIMPLE.hue + 5);
  });
  it("widen a difference, and never past its limits", () => {
    // 10 % brighter than the field: its lightness rises by lightGain x 0.1, far more than 10 % of the average's.
    const p = stretched([68 * 1.1, 66 * 1.1, 36 * 1.1], F), l = (c: ArrayLike<number>) => (Math.max(c[0], c[1], c[2]) + Math.min(c[0], c[1], c[2])) / 510;
    expect(l(p) - SIMPLE.light).toBeCloseTo(SIMPLE.lightGain * 0.1, 1);
    const white = stretched([250, 250, 250], F), orange = stretched([200, 90, 20], F);
    expect(l(white)).toBeLessThanOrEqual(SIMPLE.lightMax + 0.01);
    expect(hueOf(orange[0], orange[1], orange[2])).toBeGreaterThanOrEqual(SIMPLE.hueMin - 1);
  });
  it("take the field's average from the middle of its plants' measured colours", () => {
    const pack = (r: number, g: number, b: number) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
    const f = fieldColourOf(Uint16Array.from([pack(68, 66, 36), pack(68, 66, 36), pack(92, 86, 52), 0]))!;
    expect(f.hue).toBeCloseTo(hueOf(68, 66, 36), 0);
    expect(fieldColourOf(new Uint16Array(4))).toBeNull();
  });
  it("word a plot's label, its number amber when the stand is well under the field's or the plot is small", () => {
    expect(fmtPerAcreShort(29_501)).toBe("29.5k/ac");
    expect(plotNumberTone(29_000, 29_500, false)).toBe("green");
    expect(plotNumberTone(25_000, 29_500, false)).toBe("amber");
    expect(plotNumberTone(31_000, 29_500, true)).toBe("amber");
  });
});

describe("the Simple view's row bars", () => {
  it("cut each stretch with plants seen into pieces, full where the row is as full as the field", () => {
    const B = rowBars(plotContext(exactTwin())!);
    // Rows 1 to 3: 10 m in three pieces; row 4: two 4 m stretches, a piece each (the stretch with no plant confirmed has none).
    expect(B.n).toBe(3 * 3 + 2);
    expect(Math.min(...B.full)).toBeGreaterThan(0.9);
    // No colour was measured on this twin: every piece is the neutral colour.
    expect(B.field).toBeNull();
    expect(B.rgb.every(c => c.join() === SIMPLE.neutral.join())).toBe(true);
  });
  it("make a piece fainter where plants are missing, and colour it by its plants' average", () => {
    const t = exactTwin(), P = t.corn!.plants!, f = localFrame(LAT, LNG);
    // Row 2 loses its plants from 4 to 6 m (9 of the 17 or so in its middle piece).
    const keep = P.points.map(([la, ln], i) => { const [e, n] = f.toEN(la, ln); return !(P.certainty[i] === 0 && Math.abs(n - 2 * S) < 0.05 && e > 4.05 && e < 5.95); });
    P.points = P.points.filter((_, i) => keep[i]); P.certainty = P.certainty.filter((_, i) => keep[i]); P.photos = P.photos.filter((_, i) => keep[i]);
    // Every plant the field's olive, row 3's a paler one.
    P.look = packLooks(P.points.map(([la, ln]) => { const n = f.toEN(la, ln)[1]; return { dirDeg: null, shape: 1 as const, sizeM: 0.12, rgb: (Math.abs(n - 3 * S) < 0.05 ? [92, 86, 44] : [68, 66, 36]) as [number, number, number] }; }));
    const ctx = plotContext(t)!, B = rowBars(ctx);
    expect(B.field).not.toBeNull();
    const at = (k: number) => f.toEN((B.a[k][0] + B.b[k][0]) / 2, (B.a[k][1] + B.b[k][1]) / 2);
    const piece = (row: number, e: number) => Array.from({ length: B.n }, (_, k) => k).find(k => { const [pe, pn] = at(k); return Math.abs(pn - row * S) < 0.05 && Math.abs(pe - e) < 1.7; })!;
    expect(B.full[piece(2, 5)]).toBeLessThan(0.6);
    expect(B.full[piece(2, 1.6)]).toBeGreaterThan(0.9);
    const lum = (c: ArrayLike<number>) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    expect(lum(B.rgb[piece(3, 5)])).toBeGreaterThan(lum(B.rgb[piece(1, 5)]) + 20);
  });
});
