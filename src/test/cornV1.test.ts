// Corn V1 (src/lib/rowCrop/cornV1.ts): rows, identity and findings only where the evidence holds them.
// The fusion rules on hand-made reads (exact cases), plants located on rendered photos (greenPoints.ts), and the whole
// read on a rendered stand.
import { describe, expect, it } from "vitest";
import { renderScene, type Scene } from "../../scripts/cropProfiles/scenes";
import type { AdaptiveRead } from "@/lib/rowCrop/adaptive";
import { cornV1AsRead, fuseCornV1, readCornV1 } from "@/lib/rowCrop/cornV1";
import { plantPointsFromGreen } from "@/lib/rowCrop/greenPoints";
import { rowCropParamsFor } from "@/lib/rowCrop/params";
import type { PlantPoint } from "@/lib/rowCrop/plantRows";
import type { RowCropStage } from "@/lib/rowCrop/readRowCrop";
import { cropProfileFor } from "@/lib/cropProfiles/registry";

const profile = cropProfileFor("corn")!;
const PITCH = 190, GSD = 0.004; // 76 cm rows at 0.4 cm per pixel

/** Plants on vertical rows at x = 1000 + k * pitch, every `step` pixels from y0 to y1, minus the `skip` stretches. */
function plants(ks: number[], o: { pitch?: number; step?: number; y0?: number; y1?: number; skip?: [number, number][]; x0?: number } = {}): PlantPoint[] {
  const out: PlantPoint[] = [], pitch = o.pitch ?? PITCH, x0 = o.x0 ?? 1000;
  for (const k of ks) for (let y = o.y0 ?? 1000; y <= (o.y1 ?? 3000); y += o.step ?? 40) if (!(o.skip ?? []).some(([a, b]) => y > a && y < b)) out.push({ x: x0 + k * pitch + ((y * 7) % 5) - 2, y });
  return out;
}
type GreenRow = { k: number; plan?: number; gaps?: { y1: number; y2: number; kind?: "uncertain" }[]; support?: number; y0?: number; y1?: number };
type Weed = { x: number; y: number; tier?: "small green" };
/** A green read with vertical rows at x = 1000 + k * pitch (k may be fractional: drawn off the plants). */
function greenRead(rows: GreenRow[], weeds: Weed[] = [], o: { stage?: RowCropStage; scale?: "given" | "assumed spacing"; plans?: { id: number; stage: RowCropStage; ownedShare: number }[] } = {}): AdaptiveRead {
  const plans = o.plans ?? [{ id: 0, stage: o.stage ?? "establishment", ownedShare: 1 }];
  return {
    scaleBasis: o.scale ?? "given", gsdM: GSD, directionDeg: 90, width: 4000, height: 4000,
    plans: plans.map(p => ({ ...p, cluster: 0, pitchPx: PITCH, regions: [], ms: 0, read: { pitchM: PITCH * GSD, gsdM: GSD, version: 2, stage: p.stage, workFactor: 1, matchedSpacingM: null, seedlings: null, notes: [], crop: null, summary: { betweenRowCover: null, cropComponents: 0, noRowsPatches: 0, leafTips: 0, specks: 0, coherence: null, vegetationFraction: 0 } } })),
    rows: rows.map(r => ({ plan: r.plan ?? 0, k: Math.round(r.k), points: [[1000 + r.k * PITCH, r.y0 ?? 1000], [1000 + r.k * PITCH, r.y1 ?? 3000]], supportShare: r.support ?? 0.9, gaps: (r.gaps ?? []).map(g => ({ x1: 1000 + r.k * PITCH, y1: g.y1, x2: 1000 + r.k * PITCH, y2: g.y2, lengthM: (g.y2 - g.y1) * GSD, ...(g.kind ? { kind: g.kind } : {}) })), bandHalfWidthM: 0.1, greenShare: 0.3, plants: null, plantPoints: null, lengthM: 8, id: 1 })),
    weeds: weeds.map((w, i) => ({ id: i, x: w.x, y: w.y, areaM2: 0.001, equivDiameterM: 0.03, hull: [[w.x - 3, w.y - 3], [w.x + 3, w.y - 3], [w.x + 3, w.y + 3]], distToRowM: null, bandHalfWidthM: null, touchesEdge: false, status: "between rows", plan: 0, verdict: "weed candidate", ...(w.tier ? { tier: w.tier } : {}) })),
  } as unknown as AdaptiveRead;
}
const P = rowCropParamsFor(profile, GSD);

describe("Corn V1 fusion", () => {
  it("rows where the plants and the green agree are corn; weeds between them stay findings, green on a row is the crop", () => {
    const ad = greenRead([0, 1, 2, 3].map(k => ({ k })), [{ x: 1000 + 1.5 * PITCH, y: 2000 }, { x: 1000 + 2 * PITCH + 3, y: 1500 }]);
    const v = fuseCornV1(ad, plants([0, 1, 2, 3]), P, { enteredCrop: "corn" });
    expect(v.rows.length).toBe(4);
    expect(v.rows.every(r => r.identity === "corn" && r.evidence === "both reads agree")).toBe(true);
    expect(v.weedVerdicts.map(w => w.verdict)).toEqual(["weed candidate", "crop on a row"]);
  });

  it("green where the planting's next row runs, on a row neither read held, is unknown vegetation, not a weed", () => {
    // Rows 0-2 read; row 3 (x = 1000 + 3 pitches) not read by either; green on its line and green between rows 1 and 2.
    const ad = greenRead([0, 1, 2].map(k => ({ k })), [{ x: 1000 + 3 * PITCH + 5, y: 2000 }, { x: 1000 + 1.5 * PITCH, y: 2000 }]);
    const v = fuseCornV1(ad, plants([0, 1, 2]), P, { enteredCrop: "corn" });
    expect(v.weedVerdicts.map(w => w.verdict)).toEqual(["unknown vegetation", "weed candidate"]);
  });

  it("drops green rows drawn on the soil between the plant rows; the plants' rows stand and the crop on them is not a weed", () => {
    // The green read's rows half a row off the plants (other people's frames, measured 2026-11-04).
    const ad = greenRead([0.5, 1.5, 2.5].map(k => ({ k, gaps: [{ y1: 1500, y2: 1800 }] })), [{ x: 1000 + 1 * PITCH, y: 2200 }]);
    const v = fuseCornV1(ad, plants([0, 1, 2, 3]), P, { enteredCrop: "corn", source: "detector" });
    expect(v.summary.greenRowsDropped).toBe(3);
    expect(v.rows.every(r => r.evidence === "plant read only")).toBe(true);
    expect(v.rows.every(r => r.identity === "corn")).toBe(true);
    expect(v.weedVerdicts[0].verdict).toBe("crop on a row");
    // The dropped rows' gaps are never reported.
    expect(v.summary.gaps).toBe(0);
    // Plants located on the green (the same pixels) alone are not enough to call corn.
    const g = fuseCornV1(ad, plants([0, 1, 2, 3]), P, { enteredCrop: "corn", source: "green" });
    expect(g.summary.greenRowsDropped).toBe(3);
    expect(g.summary.cornRows).toBe(0);
    expect(g.weedVerdicts[0].verdict).toBe("crop on a row");
  });

  it("reports a gap only where both reads see nothing", () => {
    const ad = greenRead([{ k: 0, gaps: [{ y1: 1500, y2: 1900 }] }, { k: 1, gaps: [{ y1: 1500, y2: 1900 }] }, { k: 2 }, { k: 3 }]);
    // Row 0: the plants are missing there too (a real gap). Row 1: the plant read finds plants inside the green read's gap.
    const pts = [...plants([0], { skip: [[1500, 1900]] }), ...plants([1, 2, 3])];
    const v = fuseCornV1(ad, pts, P, { enteredCrop: "corn" });
    const byRow = (gi: number) => v.gaps.find(g => g.greenRow === gi)!;
    expect(byRow(0).verdict).toBe("stand gap");
    expect(byRow(1).verdict).toBe("withheld");
    expect(v.summary.gaps).toBe(1);
  });

  it("withholds a gap the photo cannot tell (uncertain) even on a corn row", () => {
    const ad = greenRead([{ k: 0, gaps: [{ y1: 1500, y2: 1900, kind: "uncertain" }] }, { k: 1 }, { k: 2 }]);
    const v = fuseCornV1(ad, [...plants([0], { skip: [[1500, 1900]] }), ...plants([1, 2])], P, { enteredCrop: "corn" });
    expect(v.summary.gaps).toBe(0);
    expect(v.summary.gapsWithheld).toBe(1);
  });

  it("keeps a canopy's green rows as corn when the plants cannot be told apart, with their gaps", () => {
    const ad = greenRead([0, 1, 2, 3].map(k => ({ k, gaps: k === 1 ? [{ y1: 1500, y2: 1900 }] : [] })), [{ x: 1000 + 1.5 * PITCH, y: 2500 }], { stage: "mid" });
    const v = fuseCornV1(ad, [], P, { enteredCrop: "corn" });
    expect(v.rows.length).toBe(4);
    expect(v.rows.every(r => r.evidence === "green read only" && r.identity === "corn")).toBe(true);
    expect(v.summary.gaps).toBe(1);
    expect(v.summary.weeds).toBe(1);
  });

  it("a seedling green row no plant row confirms is not corn: its weeds are unknown vegetation, its gaps withheld", () => {
    // Plant rows on the left; the emergence read also holds rows far to the right that no plant row confirms.
    const ad = greenRead([...[0, 1, 2].map(k => ({ k })), ...[8, 9, 10].map(k => ({ k, gaps: [{ y1: 1500, y2: 1900 }] }))], [{ x: 1000 + 8.5 * PITCH, y: 2500 }], { stage: "emergence" });
    const v = fuseCornV1(ad, plants([0, 1, 2]), P, { enteredCrop: "corn" });
    const right = v.rows.filter(r => r.evidence === "green read only");
    expect(right.length).toBe(3);
    expect(right.every(r => r.identity === "probable crop" && r.confidence === "medium")).toBe(true);
    expect(v.weedVerdicts[0].verdict).toBe("unknown vegetation");
    expect(v.summary.gaps).toBe(0);
  });

  it("keeps an establishment row grown into a band as corn where the plants cannot be located one by one (Utah, V5-V7)", () => {
    const ad = greenRead([0, 1, 2, 3].map(k => ({ k, support: 0.9 })), [{ x: 1000 + 1.5 * PITCH, y: 2000 }], { stage: "establishment" });
    const v = fuseCornV1(ad, [], P, { enteredCrop: "corn" });
    expect(v.summary.cornRows).toBe(4);
    expect(v.summary.weeds).toBe(1);
    // A weakly held band row is not.
    const weak = fuseCornV1(greenRead([0, 1, 2].map(k => ({ k, support: 0.5 }))), [], P, { enteredCrop: "corn" });
    expect(weak.summary.cornRows).toBe(0);
  });

  it("does not trust a short green piece, nor one across the rows the plants line up in (French plots)", () => {
    const short = fuseCornV1(greenRead([0, 1, 2].map(k => ({ k, support: 0.9, y0: 1000, y1: 1400 })), [], { stage: "establishment" }), [], P, { enteredCrop: "corn" });
    expect(short.summary.cornRows).toBe(0);
    // Plant rows run vertically on the left; a diagonal green piece on the right is contradicted.
    const ad = greenRead([{ k: 0 }, { k: 1 }, { k: 2 }], [], { stage: "establishment" });
    (ad.rows as { points: [number, number][] }[]).push({ ...ad.rows[0], plan: 0, points: [[3000, 1000], [3800, 2400]] } as never);
    const v = fuseCornV1(ad, plants([0, 1, 2]), P, { enteredCrop: "corn" });
    const diag = v.rows.find(r => r.evidence === "green read only")!;
    expect(diag.identity).toBe("probable crop");
    expect(diag.why).toContain("across the rows");
  });

  it("does not trust a late read beside located seedlings", () => {
    const ad = greenRead([5, 6, 7].map(k => ({ k, support: 0.9 })), [], { stage: "late" });
    expect(fuseCornV1(ad, plants([0, 1, 2]), P, { enteredCrop: "corn" }).rows.filter(r => r.evidence === "green read only").every(r => r.identity === "probable crop")).toBe(true);
    expect(fuseCornV1(ad, [], P, { enteredCrop: "corn" }).summary.cornRows).toBe(3);
  });

  it("never says corn for a field not entered as corn, and reports nothing then", () => {
    const ad = greenRead([0, 1, 2].map(k => ({ k, gaps: [{ y1: 1500, y2: 1900 }] })), [{ x: 1000 + 0.5 * PITCH, y: 2000 }]);
    const v = fuseCornV1(ad, plants([0, 1, 2], { skip: [[1500, 1900]] }), P, { enteredCrop: null });
    expect(v.summary.cornRows).toBe(0);
    expect(v.summary.weeds).toBe(0);
    expect(v.summary.gaps).toBe(0);
  });

  it("calls rows at a spacing corn is never planted at planted rows, crop not confirmed (soybean drilled at 19 cm)", () => {
    const beet = 0.19 / GSD;
    const ad = greenRead([], []);
    const v = fuseCornV1(ad, plants([0, 1, 2, 3], { pitch: beet }), P, { enteredCrop: "corn", source: "detector" });
    expect(v.rows.length).toBe(4);
    expect(v.identity.spacingImpossible).toBe(true);
    expect(v.summary.cornRows).toBe(0);
    // Sugar beet at 45 cm sits between corn's own spacings: only noted (a pixel size from a flight height is not that good).
    const w = fuseCornV1(greenRead([], []), plants([0, 1, 2, 3], { pitch: 0.45 / GSD }), P, { enteredCrop: "corn" });
    expect(w.identity.spacingFits).toBe(false);
    expect(w.identity.spacingImpossible).toBe(false);
    expect(w.notes.some(n => n.includes("check the flight height"))).toBe(true);
  });

  it("cannot check the spacing when the scale was assumed from it", () => {
    const ad = greenRead([], [], { scale: "assumed spacing" });
    const v = fuseCornV1(ad, plants([0, 1, 2, 3], { pitch: 0.45 / GSD }), P, { enteredCrop: "corn", source: "detector" });
    expect(v.identity.spacingChecked).toBe(false);
    expect(v.summary.cornRows).toBe(4);
  });

  it("a second planting's rows in the green read are a planted row, crop not confirmed", () => {
    const ad = greenRead([...[0, 1, 2].map(k => ({ k, plan: 0 })), ...[6, 7, 8].map(k => ({ k, plan: 1 }))], [], { plans: [{ id: 0, stage: "establishment", ownedShare: 0.6 }, { id: 1, stage: "establishment", ownedShare: 0.3 }] });
    const v = fuseCornV1(ad, plants([0, 1, 2, 6, 7, 8]), P, { enteredCrop: "corn" });
    expect(v.rows.filter(r => r.identity === "corn").length).toBe(3);
    expect(v.rows.filter(r => r.identity === "probable crop" && r.why.includes("second planting")).length).toBe(3);
  });

  it("draws for Photo Scout: corn rows apart from planted rows, withheld findings as not judged", () => {
    const ad = greenRead([0.5, 1.5].map(k => ({ k })), [{ x: 1000 + 1 * PITCH, y: 2200 }, { x: 1000 + 1.5 * PITCH, y: 2600 }]);
    const v = fuseCornV1(ad, plants([0, 1, 2]), P, { enteredCrop: "corn", source: "detector" });
    // A minimal adaptive read has no assessment; cornV1AsRead needs only what adaptiveAsRead reads.
    (v.green as unknown as { assessment: unknown; excluded: unknown[]; uncertain: unknown[]; fieldEnds: unknown[]; fieldLines: unknown[]; seedlingPoints: unknown[]; pitchesM: number[]; notes: string[]; summary: Record<string, number> }).assessment = { workFactor: 1 };
    Object.assign(v.green, { excluded: [], uncertain: [], fieldEnds: [], fieldLines: [], seedlingPoints: [], pitchesM: [0.76], notes: [], summary: { rows: 2, gaps: 0, gapLengthM: 0, plants: null, ms: 0 } });
    const read = cornV1AsRead(v);
    expect(read.cornV1!.cornRows).toBe(3);
    expect(read.rows.every(r => r.identity === "corn")).toBe(true);
    expect(read.weeds.length).toBe(1);
    expect(read.excluded.some(e => e.reason.includes("the crop, not a weed"))).toBe(true);
  });
});

describe("plants located on the green (no model)", () => {
  const scene = (over: Partial<Scene>): Scene => ({ name: "t", widthM: 8, heightM: 6, gsdM: 0.005, angleDeg: 90, pitchM: 0.762, twinM: null, alongM: 0.16, leafM: 0.08, soil: "dark", straw: null, weedsPerM2: 0, weedRadiusM: 0.05, inRowWeedsPerM: 0, seed: 11, ...over });

  it("places plants on the rendered rows and rows from them at the planting's spacing", { timeout: 60000 }, () => {
    const { px } = renderScene(scene({}));
    const g = plantPointsFromGreen(px);
    expect(g.points.length).toBeGreaterThan(50);
    const v = readCornV1(px, rowCropParamsFor(profile, 0.005), { enteredCrop: "corn" });
    expect(v.plants.rows.rows.length).toBeGreaterThanOrEqual(8);
    expect(Math.abs(v.plants.rows.pitchPx! * 0.005 - 0.762)).toBeLessThan(0.08);
    // The green read holds no rows on this frame: rows from plants located on the green alone are planted rows, not
    // corn; the same positions from a detector are corn.
    expect(v.green.rows.length).toBe(0);
    expect(v.summary.cornRows).toBe(0);
    expect(v.summary.probableRows).toBe(v.plants.rows.rows.length);
    const d = readCornV1(px, rowCropParamsFor(profile, 0.005), { enteredCrop: "corn", detectorPoints: g.points });
    expect(d.summary.cornRows).toBeGreaterThanOrEqual(8);
  });

  it("gives no plant positions on a lawn (no lattice cut from cover)", () => {
    const W = 1200, H = 900, rgba = new Uint8ClampedArray(W * H * 4);
    let s = 99; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < W * H; i++) { const lawn = (i % W) > W / 3, g = rnd() < 0.85; rgba[i * 4] = lawn && g ? 70 + rnd() * 30 : 110 + rnd() * 10; rgba[i * 4 + 1] = lawn && g ? 150 + rnd() * 50 : 85 + rnd() * 10; rgba[i * 4 + 2] = lawn && g ? 50 + rnd() * 20 : 65 + rnd() * 10; rgba[i * 4 + 3] = 255; }
    const g = plantPointsFromGreen({ width: W, height: H, rgba });
    const onLawn = g.points.filter(p => p.x > W / 3 + 20);
    expect(onLawn.length).toBeLessThan(10);
  });
});
